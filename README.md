# SWS Job Map

SWS Job Map combines scheduled Google Calendar work, unscheduled jobs stored in Google Sheets, live SureCam truck locations, and an administrator-only Dropbox Production File/install-analysis workflow.

**Live app:** https://jake17388.github.io/sws-job-map/

## Authorization

- Jake Banks is the only administrator.
- Other PIN users are viewers. They can view the map and job list but cannot add, edit, or remove unscheduled jobs.
- Dropbox settings, Production Files, filenames, metadata, and install analyses are returned only to Jake after backend token verification.
- Roles are derived by the Apps Script backend. A role supplied by the browser is never trusted.
- PINs are stored only in the `PINS_V2` Script Property. There are no fallback PINs in source control, and the `AUTH_SECRET_V2` namespace invalidates sessions from older releases.

Provision or rotate a user through the Apps Script execution API by calling `replaceUserPin(pin, user)`. Never add a real PIN to `Code.js`, Git, logs, or documentation.

## Data sources

- Scheduled jobs: Google Calendar install, service, and excavation calendars.
- Unscheduled jobs: spreadsheet `1CTh3Fd3zvC0XDLTruuNz7RSLdgpVxy0TtCL9fZ2_9JU`, sheet gid `0`.
- Private install-analysis data: an owner-only spreadsheet created automatically and recorded in the `INSTALL_ANALYSIS_SPREADSHEET_ID` Script Property.
- Production Files: Dropbox Business Team Space path `/Summit West Signs Team Folder/01 Orders`.

## Dropbox App Console setup

1. Create a **Scoped access** Dropbox API app with **Full Dropbox** access. App Folder access cannot reach the SWS Team Space.
2. Enable only these permissions:
   - `files.metadata.read`
   - `files.content.read`
3. Add this exact OAuth redirect URI:

   `https://script.google.com/macros/s/AKfycbwfyJCV7R64CCB2RiRfgkOAtFb79JPhv_rXIxmkedaY4rqjEIJH7tumtXu_8UlwJW4P/exec`

4. Sign into SWS Job Map as Jake, open **Settings → Dropbox Production Files**, enter the Dropbox app key and secret, and save them.
5. Press **Connect** and approve Dropbox in the new tab. The authorization requests offline access and stores the resulting refresh token only in Apps Script Properties.

The browser never receives the Dropbox app secret, refresh token, access token, Team Space namespace, file ID, or analysis cache.

## OpenAI setup

In Apps Script **Project Settings → Script Properties**, add:

| Property | Value |
|---|---|
| `OPENAI_API_KEY` | An OpenAI project API key |
| `OPENAI_MODEL` | Optional; defaults to `gpt-5.6-terra` |

Production PDFs are sent server-side to the OpenAI Responses API using high-detail PDF input and strict structured output. PDFs over 30 MB are rejected to stay within Apps Script request/response limits. The result contains only recommended equipment, installation requirements, letter/letterset counts, monument status, and ACM/RPC/FCO/EMC/S/F/D/S/D/F/wireway/raceway details.

## Dropbox lookup rules

The backend does not use Dropbox search. It directly traverses:

1. `/Summit West Signs Team Folder/01 Orders`
2. Every numbered range folder containing the requested five- or six-digit job number
3. A job folder beginning with `{jobNumber}_` or `{jobNumber} `
4. A case-insensitive `Proofs` child folder
5. PDF files only

Every folder level is paginated. `_v10.pdf` correctly beats `_v9.pdf`; when no `_vN` suffix exists, the newest `server_modified` PDF wins. Team Space requests use `root_info.root_namespace_id` through `Dropbox-API-Path-Root`.

## Analysis processing and refreshes

- Adding or renumbering an unscheduled job queues analysis without delaying the save.
- `processInstallAnalysisQueue` handles a bounded number of jobs every five minutes.
- `scheduledInstallAnalysisRefresh_` checks current unscheduled jobs every six hours.
- An unchanged Dropbox file revision, model, and prompt version reuses the cached result.
- Transient failures retry with backoff and preserve the last known file metadata.
- Jake can use **Settings → Refresh Production Files** or **Retry Analysis** from a job.

After deploying the backend, run `setupInstallAnalysisTriggers` once from the Apps Script editor as the deploying account. Disconnecting Dropbox clears refresh/access tokens, OAuth state, and Team Space cache.

## Local verification

```bash
npm run check
npm run test:coverage
```

The test suite covers authorization, OAuth state, Team Space headers, pagination, range parsing, proof selection, output validation, viewer restrictions, UI states, safe HTML rendering, and existing SureCam behavior.

## Deployment

- `clasp push` uploads only `Code.js` and `appsscript.json`; `.claspignore` keeps tests and frontend files out of Apps Script.
- Update the existing Apps Script web-app deployment after pushing backend code.
- Push the verified repository to `main`. GitHub Pages deploys `index.html` and the updated version automatically.
- The PWA checks `version.json`; when it detects a newer version, the app shows **Update now**.

## Troubleshooting

- **Not configured:** Save both Dropbox app credentials in Jake's settings.
- **Not connected:** Confirm the exact `/exec` redirect URI in Dropbox and reconnect.
- **No Production File Available:** Verify the job number, range folder, job-folder prefix, `Proofs` folder, and that at least one PDF exists.
- **Team Space path not found:** Confirm Full Dropbox access and that the connected account can see the Summit West Signs Team Folder.
- **Analysis keeps retrying:** Confirm `OPENAI_API_KEY`, model access, Apps Script trigger authorization, and that the PDF is under 30 MB.
- **Viewer cannot edit:** Expected—only Jake is authorized to change unscheduled jobs.
