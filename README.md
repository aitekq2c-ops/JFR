# Jain Farms Call Reports Website

Static HTML, CSS, and JavaScript dashboard. Call records come directly from PostgreSQL through the n8n webhook; no PHP proxy is used.

## Files

- `index.html` — dashboard structure
- `styles.css` — responsive styling
- `app.js` — filters, staff sign-in, live refresh, totals, and call table

## Data flow

`https://jfr.aitekq2c.in/` calls `https://n8n.srv1864214.hstgr.cloud/webhook/jfr-call-reports`. The active n8n workflow authenticates the staff request, reads PostgreSQL, and returns JSON. The dashboard refreshes every 30 seconds while open.

## Access

- Staff username: `reports`
- Staff password: supplied privately to the resort team; entered at sign-in and kept in page memory only.
- The n8n credential stays in n8n. Never put it in `app.js` or website source.
- The webhook allows the `https://jfr.aitekq2c.in` origin only.

## Deploy

Upload `index.html`, `styles.css`, and `app.js` to the website's static hosting root. No server-side PHP files or local config files are needed.
