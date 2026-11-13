# Jain Farms Call Reports Website

HTML, CSS, JavaScript, and a small PHP proxy for the Hostinger shared-hosting API. No framework or package install required.

## Files

- `index.html` — dashboard structure
- `styles.css` — responsive styling
- `app.js` — filters, totals, and call table
- `api/calls.php` — staff-authenticated proxy to the protected n8n webhook
- `api/config.example.php` — template for server-only credentials

## Local preview

Open `index.html` in a browser. Local preview shows the layout only; live call data requires hosting.

## Data endpoint

The dashboard calls same-origin `GET /api/calls.php` with `from`, `to`, `search`, and `status` query parameters. The PHP proxy forwards those filters to the protected PostgreSQL-backed n8n endpoint and returns its JSON response.

## Hostinger setup

1. Upload this repository's files to the website's `public_html` directory, including `api/calls.php` and `api/.htaccess`.
2. In `api/`, copy `config.example.php` to `config.local.php`. This file is ignored by Git and blocked from direct web access.
3. Set `n8n_api_key` to the value in the n8n credential named `JFR Call Reports API Header`.
4. Set `staff_password_hash` to a PHP password hash for the staff password. The dashboard username is `reports`. Generate a hash with `php -r "echo password_hash('YOUR_STAFF_PASSWORD', PASSWORD_DEFAULT), PHP_EOL;"`.
5. Open `https://jfr.aitekq2c.in/`. The dashboard asks for the staff password and keeps it in memory only until the page closes.

The n8n webhook is `https://n8n.srv1864214.hstgr.cloud/webhook/jfr-call-reports`. Never put its API key in `app.js` or commit `api/config.local.php`.
