# Jain Farms Call Reports

Private static staff dashboard for answered and missed call activity. The site uses plain HTML, CSS, and JavaScript. n8n handles API requests and PostgreSQL stores call records, staff accounts, and hashed sessions. No PHP or n8n secret is shipped to the browser.

## Site files

- `index.html` — sign-in, first-admin setup, call dashboard, and user-management interface.
- `styles.css` — responsive Jain Farms styling.
- `app.js` — session login, report filters, and role-aware user management.
- `migrations/001_report_access.sql` — idempotent PostgreSQL schema and account API functions.

## n8n API

The active workflow is `N3XSeb4IsTEX6fnI`. The static site calls these HTTPS webhooks:

- `POST /webhook/jfr-call-report-auth` — sign-in, session status/logout, and protected account actions.
- `GET /webhook/jfr-call-reports` — returns calls only for a valid bearer session.
- `POST /webhook/jfr-call-report-init` — initializes the access schema; protected by the existing `JFR Call Reports Staff Login` Basic Auth credential.
- `POST /webhook/jfr-call-report-bootstrap` — creates the first super admin once; protected by the same Basic Auth credential.

n8n uses the `Postgres account 2` credential. It must remain in n8n. The API allows the origin `https://jfr.aitekq2c.in` and returns JSON with CORS headers.

## First-time setup

1. Deploy the static site files to `https://jfr.aitekq2c.in/`.
2. Open the site. If the PostgreSQL access tables are missing, the setup panel appears.
3. Enter the existing reports Basic Auth username and password (the username has been `reports`) and select **Prepare access database**. The protected init webhook applies `migrations/001_report_access.sql` through n8n.
4. Enter the new super-admin name, email, and password (12–72 characters), then select **Set up super admin**.
5. Sign in with that email and password. Create further staff from **Manage users**.

The setup is one-time: bootstrap is rejected once any account exists. If the current Basic Auth password has changed, use the current credential configured for `JFR Call Reports Staff Login`.

## Roles and security

- `super_admin` can manage all roles and accounts.
- `admin` can create and manage `admin` and `user` accounts, but cannot access or assign the `super_admin` role.
- `user` can view call reports only.
- Passwords are hashed in PostgreSQL using `pgcrypto` bcrypt; plaintext passwords and hashes are never returned.
- Session tokens are random, expire after eight hours, and only their SHA-256 hashes are stored in PostgreSQL. The browser keeps the current token in memory only; reloading the page requires signing in again.
- Password reset and account deactivation revoke the affected account's sessions. At least one active super admin is preserved.

## Deploy

Publish `index.html`, `styles.css`, and `app.js` together to the static hosting root. Keep the cache-busting versions on the CSS and JavaScript references in `index.html` in sync when publishing edits. Do not add credentials, API tokens, or database connection details to these files.

## Digest schedule

The live n8n report schedule is 8:00 AM and 4:00 PM in `Asia/Kolkata`.
