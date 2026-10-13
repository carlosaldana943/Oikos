# Envision Build Board

House construction tracker: 109-step build sequence, phase pipeline, Next up queue, subcontractor directory, and WhatsApp/email job briefs.

## Files

| File | What it is |
| --- | --- |
| `index.html` | The app. Identical to the Claude version. |
| `claude-shim.js` | Replaces Claude's runtime: database, sign-in, CSV export. |
| `firebase-config.js` | Your Firebase keys. Empty = local mode. |
| `firestore.rules` | Who can use the board (Google emails). |
| `import.html` | One-time import of your exported data into Firebase. |
| `data/*.json` | Your houses, subs and saved plan links, exported from Claude on 2026-10-12. Not committed (see `.gitignore`). |

## Where the data lives

The code holds no data. Every house, step status, date, note, sub assignment, brief log, sub record and plan link is a record in a database:

| Collection | One record per | Holds |
| --- | --- | --- |
| `houses` | house | lot/name, address, model, permit, plan link, super, buyer, start, notes, and `steps` (status, date, note, assigned sub, brief sent) for each of the 109 steps |
| `subs` | subcontractor | company, contact, phone, email, trades, WhatsApp/email, language, notes |
| `config/plans` | – | default plan link per model |
| `users` | person signed in (Firebase only) | display name for "Last updated by" |

House plan PDFs are not stored in the app. Each house keeps a link to the PDF in Google Drive or Dropbox, so the PDFs stay where they are.

## Option A: try it on your computer (local mode, 2 minutes)

Data stays in that one browser and is not shared.

```
cd envision-build-board
python3 -m http.server 8000
```

Open http://localhost:8000. It loads your exported houses and subs from `data/` on first run. (Opening `index.html` by double-clicking also works, but starts empty because browsers block reading `data/` from a file.)

## Option B: run it for the team (Firebase + GitHub Pages)

This keeps today's behavior: shared live data, everyone signs in, updates show up for everyone.

1. **Create the database.** Go to console.firebase.google.com → Add project. Then Build → Firestore Database → Create (production mode), and Build → Authentication → Get started → enable **Google**.
2. **Lock it down.** Firestore → Rules → paste `firestore.rules`, add your team's emails, Publish.
3. **Connect the app.** Project settings → Your apps → Web (`</>`) → copy the config into `firebase-config.js`.
4. **Import your data (once).** Run `python3 -m http.server 8000`, open http://localhost:8000/import.html, sign in, click **Import data**. It skips records already there, so it's safe to rerun.
5. **Publish.** Push to GitHub, then Settings → Pages → Deploy from branch → `main` / root. Then in Firebase → Authentication → Settings → Authorized domains, add `<your-user>.github.io`.

The repo can be public. The Firebase config is not secret, and the rules decide who gets in. Keep `data/` out of it (it is in `.gitignore`).

## Keeping both versions

After the import, Firebase and the Claude artifact are separate copies. Changes in one do not appear in the other. Pick one as the live board once the team moves over.
