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

## Code Guidelines
*   **Backend Scope:** All files in `src/backend/` run in the Apps Script global namespace. You can call functions and reference variables from other files directly without imports.
*   **Frontend Scope:** `src/frontend/app.js` runs in the browser context. Keep variables encapsulated and use local storage caching (`readCache`/`writeCache`) where appropriate.
