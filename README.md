# FleetMonitor app (flat layout)

Every file sits in one folder, so it uploads to GitHub with no folders to drag. Keep `index.html` at the root of the site.

- `index.html`: the page. `config.js`: Supabase URL, public key and the sign-in screen branding.
- `main.js`, `api.js`, `ui.js`, `actions.js`, `auth.js`, `shell.js`, `router.js`, `state.js`, `domain.js`: the app.
- `tasks.js`, `vehicles.js`, `drivers.js`, `history.js`, `placeholder.js`: one file per screen.
- `theme.css`, `app.css`: styles. `supabase.js`: the Supabase client library (version 2.117.2). `*.woff2`: fonts (Cascadia Code and Barlow Condensed, both open licence).

## Branding

The look follows alchemydrinks.co.uk: pink banner titles (#FF0066), dark ink buttons (#2E2E2E), gold accent (#A8895B), Cascadia Code type.
- After sign-in, colours and the logo come from the organisation's `brand` setting in the database (`colours.primary`, `colours.accent`, `logo_url`).
- The sign-in screen uses `brand` in `config.js`.
- The logo is currently loaded straight from alchemydrinks.co.uk. To host it yourself, save the logo in this folder as `logo.png`, set `logoUrl: 'logo.png'` in `config.js`, and set `logo_url` to `logo.png` in the database.

Serve it locally with `python3 -m http.server 8000` (ES modules need a web server).
After deploying, set the Supabase Site URL and Redirect URLs (Authentication, URL Configuration) to the deployed address.
