# FleetMonitor app (flat layout)

Every file sits in one folder, so it uploads to GitHub with no folders to drag. Keep `index.html` at the root of the site.

## What it does

- **Tasks:** everything coming due, from vehicle and driver compliance dates, insurance renewals, convictions, fines, accidents, lease ends and vehicles with no cover
- **Vehicles:** list, add, edit, dispose of, archive and restore; compliance, drivers, insurance cover, incidents, costs, documents, mileage and history tabs
- **Drivers:** work and personal phones, licence details, points and convictions (with dates worked out for you), employment periods with leave and rehire, incidents, documents, history
- **Incidents:** accidents, damage and fines in one register, with costs and deadlines
- **Insurance:** policies, vehicles covered, claims, documents
- **Settings** (superuser): the master list of depots
- **Audit log** (fleet admins and superuser): every change, searchable by period, vehicle and driver
- **Documents:** upload from files, a whole folder, the phone camera, a webcam, or drag and drop

## Files

- `index.html`: the page. `config.js`: Supabase URL, public key and the sign-in screen branding.
- `main.js`, `api.js`, `ui.js`, `actions.js`, `docs.js`, `auth.js`, `shell.js`, `router.js`, `state.js`, `domain.js`: the app.
- `tasks.js`, `vehicles.js`, `drivers.js`, `incidents.js`, `insurance.js`, `settings.js`, `audit.js`, `history.js`, `placeholder.js`: one file per screen.
- `theme.css`, `app.css`: styles. `supabase.js`: the Supabase client library (version 2.117.2). `*.woff2`: fonts (Cascadia Code and Barlow Condensed, both open licence).

## Branding

The look follows alchemydrinks.co.uk: pink banner titles (#FF0066), dark ink buttons (#2E2E2E), gold accent (#A8895B), Cascadia Code type.
- After sign-in, colours and the logo come from the organisation's `brand` setting in the database (`colours.primary`, `colours.accent`, `logo_url`).
- The sign-in screen uses `brand` in `config.js`.
- The logo is currently loaded straight from alchemydrinks.co.uk. To host it yourself, save the logo in this folder as `logo.png`, set `logoUrl: 'logo.png'` in `config.js`, and set `logo_url` to `logo.png` in the database.

## Notes

- Serve it locally with `python3 -m http.server 8000` (ES modules need a web server).
- After deploying, set the Supabase Site URL and Redirect URLs (Authentication, URL Configuration) to the deployed address.
- Documents are stored in a private bucket. Photos and PDFs only, up to 10 MB each. Large photos are shrunk before upload.
- The offence-code list (SP30, TS10 and so on) is a convenience: check it against current DVLA guidance.
