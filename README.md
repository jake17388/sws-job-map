# SWS Job Map

SWS Job Map combines scheduled Google Calendar work, unscheduled jobs stored in Google Sheets, and live SureCam truck locations.

**Live app:** https://jake17388.github.io/sws-job-map/

## Authorization

- Jake Banks is the only administrator.
- Other PIN users are viewers. They can view the map and job list but cannot add, edit, or remove unscheduled jobs.
- Roles are derived by the Apps Script backend. A role supplied by the browser is never trusted.
- PINs are stored only in the `PINS_V2` Script Property. There are no fallback PINs in source control, and the `AUTH_SECRET_V2` namespace invalidates sessions from older releases.

Provision or rotate a user through the Apps Script execution API by calling `replaceUserPin(pin, user)`. Never add a real PIN to `Code.js`, Git, logs, or documentation.

## Data sources

- Scheduled jobs: Google Calendar install, service, and excavation calendars.
- Unscheduled jobs: spreadsheet `1CTh3Fd3zvC0XDLTruuNz7RSLdgpVxy0TtCL9fZ2_9JU`, sheet gid `0`.
- Vehicle positions: SureCam session data refreshed by the companion sync process.

## Retired Dropbox analysis cleanup

The Dropbox Production File and Install Analysis features are retired. After deploying this backend version, run `setupInstallAnalysisTriggers` once from the Apps Script editor to delete their old scheduled triggers. Existing Dropbox and OpenAI properties can then be deleted from Apps Script Project Settings.

## Local verification

```bash
npm run check
npm run test:coverage
```

## Deployment

- `clasp push` uploads only `Code.js` and `appsscript.json`; `.claspignore` keeps tests and frontend files out of Apps Script.
- Update the existing Apps Script web-app deployment after pushing backend code.
- Push the verified repository to `main`. GitHub Pages deploys `index.html` and the updated version automatically.
- The PWA checks `version.json`; when it detects a newer version, the app shows **Update now**.

## Troubleshooting

- **Viewer cannot edit:** Expected—only Jake is authorized to change unscheduled jobs.
