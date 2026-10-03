# FleetMonitor app (flat layout)

Every file sits in one folder, so it uploads to GitHub with no folders to drag. Keep `index.html` at the root of the site.

- `index.html`: the page. `config.js`: Supabase URL and public key.
- `main.js`, `api.js`, `ui.js`, `actions.js`, `auth.js`, `shell.js`, `router.js`, `state.js`, `domain.js`: the app.
- `tasks.js`, `vehicles.js`, `drivers.js`, `history.js`, `placeholder.js`: one file per screen.
- `theme.css`, `app.css`: styles. `supabase.js`: the Supabase client library (version 2.117.2). `*.woff2`: fonts.

Serve it locally with `python3 -m http.server 8000` (ES modules need a web server).
After deploying, set the Supabase Site URL and Redirect URLs (Authentication, URL Configuration) to the deployed address.
