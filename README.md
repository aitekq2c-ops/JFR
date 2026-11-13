# Jain Farms Call Reports Website

Static HTML, CSS, and JavaScript dashboard. Call records come directly from PostgreSQL through the n8n webhook; no PHP proxy is used.

## Files

- `index.html` — staff sign-in page and dashboard structure
- `styles.css` — responsive styling
- `app.js` — sign-in, filters, live refresh, totals, and call table

## Data flow

`https://jfr.aitekq2c.in/` calls `https://n8n.srv1864214.hstgr.cloud/webhook/jfr-call-reports`. The n8n workflow authenticates staff, reads PostgreSQL, and returns JSON. The dashboard refreshes every 30 seconds while signed in.

## Access

- Staff username: `reports`
- Staff enter the reports password on the sign-in page.
- The website keeps credentials in page memory only; it does not save them in browser storage.
- The n8n credential stays in n8n and must never be added to website source.
- The webhook allows the `https://jfr.aitekq2c.in` origin.

## Deploy

Upload `index.html`, `styles.css`, and `app.js` to the website's static hosting root. No server-side PHP files or local config files are needed.
