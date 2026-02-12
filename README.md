# InboxZero Heatmap

A web app to visualize email overload from Mailbox.

## Features
- Upload CSV via click or drag/drop
- Direct Gmail connect (Google OAuth + Gmail API metadata read)
- Email hit heatmap (day x hour)
- Top senders list (`who wastes most time`)
- Email type pie chart (category detection)
- Export each chart as PNG
- Export each chart to PDF (print-to-PDF)
- Sample data loader for instant preview

## Run
1. Copy env template:
```bash
cp .env.example .env
```
2. Fill `GOOGLE_CLIENT_ID` and `GOOGLE_API_KEY` in `.env`.
3. Start local server:
```bash
node server.js
```
4. Open `http://localhost:5500`.

## Google direct connect setup
1. In Google Cloud Console, enable `Gmail API`.
2. Create OAuth client credentials for a web app.
3. Add these exact origins in authorized JavaScript origins:
   - `http://localhost:5500`
   - `http://127.0.0.1:5500` (if you ever run on 127.0.0.1)
   - `https://<your-netlify-site>.netlify.app` (for Netlify deploys)
4. Create an API key and restrict it to Gmail API.
5. Set `GOOGLE_CLIENT_ID` and `GOOGLE_API_KEY` in `.env`.
6. Click `Connect Google Inbox` in the app.

Important:
- For this browser-based flow, the critical setting is **Authorized JavaScript origins**.
- `Authorized redirect URIs` is not used by this token flow and can be left empty.

Notes:
- Scope used: `https://www.googleapis.com/auth/gmail.readonly`
- Current client fetches up to 500 inbox messages from the last 365 days.

## CSV format
Use headers that include:
- `Date`
- `From`
- `Subject`

## Privacy-safe sample CSV downloads
Synthetic files (no real user data) are included for testing:
- `/sample-data/sample-email-small.csv`
- `/sample-data/sample-email-workload.csv`
- `/sample-data/sample-email-mixed.csv`

Example:

```csv
Date,From,Subject
2026-02-01 09:15:00,alerts@github.com,Deployment alert
2026-02-01 10:31:00,team@asana.com,Meeting moved to 2PM
```

## How to generate Gmail CSV
1. Open Google Takeout and choose only `Mail`.
2. Create export and download the archive.
3. Extract the archive; Gmail data is usually in `.mbox` format.
4. Convert `.mbox` to CSV using a converter/script so output has `Date`, `From`, `Subject`.
5. Upload the CSV in this app.

## Export charts
- Click `Export PNG` on any chart card for an image file.
- Click `Export PDF` to open print preview and save as PDF.

## Restrictions
As we are using free tier hosting, input mails are fixed to 500 mails max.

## Netlify deploy notes
This repo includes a Netlify Function that serves `/config.js` from Netlify environment variables.

1. In Netlify project settings, add:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_API_KEY`
2. Deploy the repo as-is (the `netlify.toml` is already configured).
3. Make sure your Google OAuth authorized JavaScript origins includes your Netlify domain.
