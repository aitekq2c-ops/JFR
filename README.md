# Jain Farms Call Reports Website

Plain HTML, CSS, and JavaScript dashboard. No framework or package install required.

## Files

- `index.html` — dashboard structure
- `styles.css` — responsive styling
- `app.js` — filters, totals, and call table

## Local preview

Open `index.html` in a browser. Local preview shows the layout only; live call data requires hosting.

## Data endpoint

The hosted page expects a same-origin `GET /api/calls` endpoint with `from`, `to`, `search`, and `status` query parameters. The response should contain `rows`, `total`, `answered`, `missed`, and `answerRate`. Connect this endpoint to the PostgreSQL webhook in n8n before using live data.
