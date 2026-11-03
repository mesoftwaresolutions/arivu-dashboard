# ARIVU Dashboard

**ARIVU = Automated Reach, Insights & Visibility Utility** · by ME Software Solutions

An installable web app (PWA) for pages run by the [ARIVU engine](https://github.com/mesoftwaresolutions/arivu-engine)
(private): next post, queue and calendar, followers and views per platform, post performance,
alerts and goals; **posts per day** (the sheet's Schedule tab), **Approve / Skip**, and **+ New post**
(upload your own photo or video with a caption, platforms and time). Phone and computer, light and dark.

- **Demo (sample data, no sign-in):** `https://mesoftwaresolutions.github.io/arivu-dashboard/?demo`

## How it works

- Static files on GitHub Pages; no server, no database, no cost.
- **Sign in with Google** in the browser (the page's own Google account, with its 2-step verification).
  Scopes: `spreadsheets` (read the page's sheets; write status, the Schedule tab and new post rows),
  `drive.file` (only files this app creates: the "ARIVU uploads" folder and your uploads, each shared
  read-only with the page's service account so the engine can post it) and `drive.appdata` (this
  app's own hidden settings file). The token stays in the browser tab only.
- The app reads the page's **Content sheet** and **analytics hub** (DailyStats, PostStats, Pages)
  directly from Google Sheets. It can read only what that Google account can open.
- Settings (sheet links, publish times, goals) are saved in the account's hidden Drive app folder,
  so they follow the account to every device. **This repository contains no secrets, sheet IDs or
  page data**; `demo/demo-data.json` is made-up data for the demo page "Daily Spark".

## One-time setup (owner)

1. Google Cloud project owned by ME Software Solutions (no billing): enable **Google Sheets API**
   and **Google Drive API**; OAuth consent screen External, **In production**, app name ARIVU,
   home/privacy/terms on mesoftwaresolutions.github.io.
2. OAuth client of type **Web application**; Authorized JavaScript origins:
   `https://mesoftwaresolutions.github.io` (and `http://localhost:8090` for local testing).
3. Put the client ID in `js/config.js` (client IDs are public by design).
4. Each page: open the dashboard, sign in with the page's Gmail, paste the Content sheet and hub links.
   Google shows "Google hasn't verified this app" once (sensitive Sheets scope, unverified):
   Advanced → Continue.

## Develop

```
python -m http.server 8090        # then open http://localhost:8090/?demo
npm test                          # Node 20+: tests for the data logic (js/model.js)
```

Bump `CONFIG.version` in `js/config.js` and `CACHE` in `sw.js` together for each release.

Copyright (c) 2026 ME Software Solutions. All rights reserved. See [LICENSE](LICENSE).
