# SWS Job Map

A web app for viewing scheduled install/service jobs from Google Calendar and managing unscheduled jobs, plotted on a map.

**Live app:** https://jake17388.github.io/sws-job-map/

---

## How it works

- **Scheduled jobs** are pulled directly from Google Calendar (Install + Service calendars) via the Google Calendar API
- **Unscheduled jobs** are stored in a Google Sheet and managed via the Google Sheets API
- **Authentication** uses Google OAuth 2.0 — users must sign in with a `summitwestsigns.com` Google account, plus enter a 4-digit PIN
- **Hosted** on GitHub Pages — every push to `main` deploys automatically

---

## Making changes

1. Edit `index.html` locally or directly on GitHub
2. Commit and push to `main`
3. GitHub Pages redeploys in ~60 seconds
4. Refresh the live URL to see changes

---

## Config (top of index.html)

All settings are in the `CONFIG` object near the top of `index.html`:

```js
const CONFIG = {
  CLIENT_ID: '...',           // Google OAuth Client ID
  MAPS_API_KEY: '...',        // Google Maps API key
  SHEET_ID: '...',            // Google Sheets ID for unscheduled jobs
  INSTALL_CAL_ID: '...',      // Install calendar ID
  SERVICE_CAL_ID: '...',      // Service calendar ID
  SKIP_KEYWORDS: [...],       // Calendar event titles to ignore
  PINS: { '2580': 'Jake Banks', '4567': 'Ryan Chapman' },
  ALLOWED_DOMAIN: 'summitwestsigns.com',
};
```

### Adding/changing PINs
Edit the `PINS` object — key is the 4-digit PIN, value is the display name.

### Adding skip keywords
Add lowercase strings to `SKIP_KEYWORDS`. Any calendar event whose title contains one of these strings will be hidden from the map.

---

## Google Cloud setup (already done)

- **Project:** SWS Scheduling (`sws-scheduling-496717`)
- **APIs enabled:** Google Calendar API, Google Sheets API, Maps JavaScript API
- **OAuth Client:** Web application, authorized origin: `https://jake17388.github.io`

---

## Google Sheet

**SWS Unscheduled Jobs**
Sheet ID: `1CTh3Fd3zvC0XDLTruuNz7RSLdgpVxy0TtCL9fZ2_9JU`

Columns: `job_num | title | address | added | id | added_by`

---

## Calendars

| Calendar | ID |
|---|---|
| Install | `summitwestsigns.com_5ehu6it6pfpcg2g9ifpcuv6gd8@group.calendar.google.com` |
| Service | `summitwestsigns.com_plamgq5u79k125mvl50ie49fu0@group.calendar.google.com` |
