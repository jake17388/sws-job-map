# Claude Code & Codex Configuration Guide

This project is configured to keep token usage low by splitting monolithic Apps Script backend (`Code.js`) and frontend files (`index.html`) into modular files.

## Project Architecture
*   **`src/backend/`**: Contains the Apps Script backend files. They are prefixed numerically to ensure they concatenate in the correct order:
    *   `01-config.js` - Configuration, sheets IDs and constants
    *   `02-auth.js` - Security rules, user verify mechanisms, PIN hashing
    *   `03-routing.js` - `doGet`/`doPost` routes for REST API
    *   `04-calendar-jobs.js` - Google Calendar event fetching
    *   `05-unscheduled-jobs.js` - Reading and adding unscheduled job rows
    *   `06-current-jobs-sheet.js` - Reading current spreadsheet rows
    *   `07-surecam-integration.js` - Fetching and parsing truck GPS points
    *   `08-current-jobs-sheet-cont.js` - Sheet helpers continued
    *   `09-retired-triggers.js` - One-off cleanups for retired triggers
*   **`src/frontend/`**: Contains the modular frontend assets:
    *   `index.html` - Skeleton HTML file with injection placeholders
    *   `style.css` - Custom styling rules for the map and job views
    *   `app.js` - Client-side Javascript logic
*   **`Code.js`** (Root): **Generated File**. Concatenated automatically from `src/backend/*.js`. Do not edit!
*   **`index.html`** (Root): **Generated File**. Compiled automatically from `src/frontend/` assets. Do not edit!

---

## Developer Commands

### Build Commands
*   **Build Everything:** `npm run build` (Compiles both backend and frontend root files)
*   **Build Backend only:** `npm run build:backend`
*   **Build Frontend only:** `npm run build:frontend`

### Test & Verification Commands
*   **Run All Verifications (Recommended):** `npm run check` (Runs full build, check syntax, and tests)
*   **Syntax Check:** `npm run check:syntax`
*   **Unit Tests:** `npm test`
*   **Coverage Report:** `npm run test:coverage`

### Clasp Deployment
When deploying backend changes:
1. Make your changes in `src/backend/`.
2. Compile: `npm run build:backend`
3. Push: `clasp push`
4. Deploy (if needed): `clasp deploy -i <DEPLOYMENT_ID> -d "Description"`

---

## CI & Deployment Pipeline

Every push to `main` is gated on `npm run check`. Nothing reaches production if the suite fails.

| Workflow | Trigger | What it does |
| --- | --- | --- |
| `ci.yml` | push to `main`, any PR | Runs `npm run check` |
| `pages.yml` | push to `main` | `npm run check`, builds, deploys the site, then smoke-tests the live URL for `SWS Job Map` |
| `deploy.yml` | push touching `src/backend/**` or `appsscript.json` | `npm run check`, then `clasp push` + `clasp deploy` to the live `/exec` web app |

**The site is served by GitHub Actions, not from the branch.** The Pages setting is `build_type: workflow`. `Code.js` and `index.html` are generated and untracked, so `pages.yml` is the only thing that publishes the site.

Two traps, both of which have already caused a live outage once:

1.  **Never set the Pages `concurrency.group` to `"pages"`.** That name collides with the lock GitHub's built-in `pages-build-deployment` workflow holds, and every run hangs at status `pending` with zero jobs assigned, forever, on both `push` and `workflow_dispatch`. The group here is `pages-actions-deploy`.
2.  **Never switch Pages back to branch-based ("Deploy from a branch") without first re-tracking `index.html`.** The branch builder serves the committed tree, and the generated file is not in it, so the site 404s immediately.

To restore branch-based serving deliberately: re-track `index.html`, then `gh api -X PUT repos/jake17388/sws-job-map/pages -f build_type=legacy`. Note the API value for Actions-based is `workflow`, not `actions`, even though the UI calls it "GitHub Actions".

**`clasp` only ever pushes `Code.js` and `appsscript.json`** — `.claspignore` whitelists those two and `skipSubdirectories` is `true`, so `src/` is never uploaded to Apps Script.

---

## Code Guidelines
*   **Backend Scope:** All files in `src/backend/` run in the Apps Script global namespace. You can call functions and reference variables from other files directly without imports.
*   **Frontend Scope:** `src/frontend/app.js` runs in the browser context. Keep variables encapsulated and use local storage caching (`readCache`/`writeCache`) where appropriate.
