/*
 * claude-shim.js — lets the Build Board run outside Claude Artifacts.
 *
 * The app talks to its host only through window.claude.use(name) for three
 * things: "db" (shared database), "user" (who is signed in) and "downloads"
 * (CSV export). This file provides the same three, so index.html runs
 * unchanged.
 *
 *   - With a Firebase config in firebase-config.js: data lives in Cloud
 *     Firestore, shared live between everyone who signs in (same as today).
 *   - Without one: data lives in this browser only (localStorage). Use it to
 *     test on your own computer; it is not shared with anyone.
 */
(function () {
  "use strict";

  const FIREBASE_VERSION = "10.12.2";
  const LOCAL_KEY = "envision-build-board-v1";
  const cfg = window.FIREBASE_CONFIG;
  const useFirebase = !!(cfg && cfg.apiKey && cfg.projectId);

  const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
  // Claude's db.update() merges nested objects recursively and replaces arrays.
  function deepMerge(a, b) {
    for (const k of Object.keys(b)) {
      const v = b[k];
      if (v && typeof v === "object" && !Array.isArray(v) && a[k] && typeof a[k] === "object" && !Array.isArray(a[k])) deepMerge(a[k], v);
      else a[k] = clone(v);
    }
    return a;
  }
  const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(15)), (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("").slice(0, 20);
  const err = (code, message) => Object.assign(new Error(message || code), { code });

  /* ------------------------------------------------------------------ */
  /* Local mode: one browser, localStorage                               */
  /* ------------------------------------------------------------------ */
  async function localDb() {
    let store;
    try { store = JSON.parse(localStorage.getItem(LOCAL_KEY) || "null"); } catch (_) { store = null; }
    if (!store) {
      // First run: seed from the exported data files if they are served next to the page.
      store = { houses: {}, subs: {}, config: {} };
      // Browsers block reading files next to a double-clicked page; start empty then.
      if (location.protocol !== "file:") for (const c of Object.keys(store)) {
        try { const r = await fetch("data/" + c + ".json", { cache: "no-store" }); if (r.ok) store[c] = await r.json(); } catch (_) {}
      }
    }
    const persist = () => { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(store)); } catch (_) {} };
    persist();
    const listeners = new Set();
    const notify = () => setTimeout(() => listeners.forEach((f) => f()), 0);
    // Other tabs on this computer stay in sync.
    window.addEventListener("storage", (e) => { if (e.key === LOCAL_KEY && e.newValue) { store = JSON.parse(e.newValue); notify(); } });

    const docSnap = (c, id) => { const d = (store[c] || {})[id]; return { id, exists: !!d, data: () => clone(d) }; };
    const docRef = (c, id) => ({
      id, path: c + "/" + id,
      async get() { return docSnap(c, id); },
      async set(data) { if (!data || typeof data !== "object") throw err("invalid_argument"); (store[c] = store[c] || {})[id] = clone(data); persist(); notify(); },
      async update(data) { const d = (store[c] || {})[id]; if (!d) throw err("invalid_argument", "Document does not exist"); deepMerge(d, data); persist(); notify(); },
      async delete() { if (store[c]) delete store[c][id]; persist(); notify(); },
      onSnapshot(next) { const f = () => next(docSnap(c, id)); listeners.add(f); setTimeout(f, 0); return () => listeners.delete(f); },
      collection() { throw err("invalid_argument", "Subcollections are not used by this app"); },
    });
    const colRef = (c) => ({
      path: c,
      doc(id) { return docRef(c, id || newId()); },
      async get() { return { docs: Object.keys(store[c] || {}).sort().map((id) => docSnap(c, id)) }; },
      onSnapshot(next) { const f = () => next({ docs: Object.keys(store[c] || {}).sort().map((id) => docSnap(c, id)) }); listeners.add(f); setTimeout(f, 0); return () => listeners.delete(f); },
    });
    return {
      db: { collection: colRef, doc(p) { const [c, id] = p.split("/"); return docRef(c, id); } },
      user: { id: async () => "local", profiles: async () => ({}), isOwner: () => true, canEdit: () => true },
    };
  }

  /* ------------------------------------------------------------------ */
  /* Firebase mode: shared, live, signed-in                              */
  /* ------------------------------------------------------------------ */
  const loadScript = (src) => new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("Could not load " + src)); document.head.appendChild(s); });

  function signInOverlay(auth) {
    return new Promise((resolve) => {
      const unsub = auth.onAuthStateChanged((u) => { if (u) { unsub(); el && el.remove(); resolve(u); } });
      const el = document.createElement("div");
      el.style.cssText = "position:fixed;inset:0;z-index:100;display:grid;place-items:center;background:rgba(10,15,18,.55);padding:16px";
      el.innerHTML = '<div style="background:var(--surface,#fff);color:var(--ink,#192125);border-radius:16px;padding:24px;max-width:360px;width:100%;text-align:center;font-family:var(--f-body,system-ui)">' +
        '<div style="font:700 24px/1.1 var(--f-display,system-ui);text-transform:uppercase;margin-bottom:8px">Envision Build Board</div>' +
        '<p style="margin:0 0 16px;color:var(--muted,#5B676D)">Sign in with your Google account to open the board.</p>' +
        '<button id="shimSignIn" style="width:100%;padding:12px;border-radius:9px;border:0;background:var(--accent,#1D5FA8);color:var(--on-accent,#fff);font-weight:600;font-size:15px;cursor:pointer">Sign in with Google</button>' +
        '<p id="shimErr" style="margin:12px 0 0;color:var(--bad,#BC3B26);font-size:13px"></p></div>';
      const show = () => { if (!auth.currentUser && !document.body.contains(el)) document.body.appendChild(el); };
      if (document.body) setTimeout(show, 600); else document.addEventListener("DOMContentLoaded", () => setTimeout(show, 600));
      el.addEventListener("click", async (e) => {
        if (e.target.id !== "shimSignIn") return;
        const provider = new firebase.auth.GoogleAuthProvider();
        try { await auth.signInWithPopup(provider); }
        catch (x) {
          if (x && (x.code === "auth/popup-blocked" || x.code === "auth/operation-not-supported-in-this-environment")) return auth.signInWithRedirect(provider);
          el.querySelector("#shimErr").textContent = (x && x.message) || "Sign-in failed";
        }
      });
    });
  }

  async function firebaseDb() {
    const base = "https://www.gstatic.com/firebasejs/" + FIREBASE_VERSION + "/";
    await loadScript(base + "firebase-app-compat.js");
    await Promise.all([loadScript(base + "firebase-auth-compat.js"), loadScript(base + "firebase-firestore-compat.js")]);
    firebase.initializeApp(cfg);
    const auth = firebase.auth();
    const fs = firebase.firestore();
    const me = await signInOverlay(auth);
    // Keep a name for "Last updated by"; ignore failures.
    fs.collection("users").doc(me.uid).set({ name: me.displayName || me.email || "" }, { merge: true }).catch(() => {});

    const mapErr = (e) => err(String((e && e.code) || "unavailable").replace(/-/g, "_"), e && e.message);
    const norm = (s) => ({ id: s.id, exists: !!s.exists, data: () => (s.exists ? s.data() : undefined) });
    const docRef = (ref) => ({
      id: ref.id, path: ref.path,
      get: () => ref.get().then(norm, (e) => { throw mapErr(e); }),
      set: (data) => ref.set(data).catch((e) => { throw mapErr(e); }),
      // Firestore's own update() REPLACES nested maps (it would wipe every other
      // step on a house). set(..., {merge:true}) deep-merges like Claude's update().
      update: (data) => ref.set(data, { merge: true }).catch((e) => { throw mapErr(e); }),
      delete: () => ref.delete().catch((e) => { throw mapErr(e); }),
      onSnapshot: (next, onErr) => ref.onSnapshot((s) => next(norm(s)), (e) => onErr && onErr(mapErr(e))),
      collection: (p) => colRef(ref.collection(p)),
    });
    const qry = (q) => ({
      where: (f, op, v) => qry(q.where(f, op, v)),
      orderBy: (f, d) => qry(q.orderBy(f, d)),
      limit: (n) => qry(q.limit(n)),
      get: () => q.get().then((s) => ({ docs: s.docs.map(norm) }), (e) => { throw mapErr(e); }),
      onSnapshot: (next, onErr) => q.onSnapshot((s) => next({ docs: s.docs.map(norm) }), (e) => onErr && onErr(mapErr(e))),
    });
    const colRef = (c) => Object.assign(qry(c), { path: c.path, doc: (id) => docRef(id ? c.doc(id) : c.doc()) });
    return {
      db: { collection: (p) => colRef(fs.collection(p)), doc: (p) => docRef(fs.doc(p)) },
      user: {
        id: async () => me.uid,
        isOwner: () => true, canEdit: () => true,
        profiles: async (ids) => {
          const out = {};
          await Promise.all((ids || []).map(async (id) => {
            try { const s = await fs.collection("users").doc(id).get(); out[id] = { name: (s.exists && s.data().name) || "" }; } catch (_) { out[id] = { name: "" }; }
          }));
          return out;
        },
      },
    };
  }

  /* ------------------------------------------------------------------ */
  /* downloads: hand the CSV to the browser                              */
  /* ------------------------------------------------------------------ */
  const downloads = {
    async save({ filename, data }) {
      const blob = data instanceof Blob ? data : new Blob([data], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = filename || "download";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      return { status: "saved" };
    },
  };

  let backend = null;
  const getBackend = () => (backend = backend || (useFirebase ? firebaseDb() : localDb()).catch((e) => { console.error("[build-board]", e); return null; }));

  window.claude = {
    mode: useFirebase ? "firebase" : "local",
    async use(name) {
      if (name === "downloads") return downloads;
      if (name === "db") { const b = await getBackend(); return b && b.db; }
      if (name === "user") { const b = await getBackend(); return b && b.user; }
      return null;
    },
  };
})();
