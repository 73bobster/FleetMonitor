# FleetMonitor app (flat layout)

Every file sits in one folder, so it uploads to GitHub with no folders to drag. Keep `index.html` at the root of the site.

## What it does

- **Dashboard** (opens first; the logo returns to it): fleet status and what needs attention, a stacked bar chart of vehicles available and unavailable by day, week or month (vans and HGVs in different colours), and, for a reporting period you can change (default last 30 days), accidents, damage and fines, garage downtime and a summary of drivers by points, accidents and damage
- **Red, amber, green:** a status with its reason for every vehicle and driver, for the vehicle pool, the driver pool and the admin function, and overall. Four tiles at the top of the Dashboard, a mark beside every plate and driver name, a "Red and amber only" filter on the Vehicles and Drivers lists, and the status with its reasons at the top of each vehicle and driver. The rules are in `rag.js`. The part that depends on licence results and points is worked out in the database, so Management see the colour without the detail
- **Tasks:** everything coming due, filterable by type and status, from compliance dates, insurance renewals, convictions, fines, accidents, lease ends, vehicles with no cover, garage bookings, vehicles overdue back from the garage, and SORN
- **Vehicles:** list, add, edit, dispose of, archive and restore; compliance, drivers, insurance cover, availability, incidents, costs, documents, mileage and history tabs
- **Availability:** garage visits (booked, current, finished) with the garage validated against the Garages list, and long-term off the road with a SORN
- **Planner:** looks ahead 2 to 8 weeks. Vehicles down the side and days across, with garage visits, SORN, lease ends and due dates, and for each vehicle type the number available against the number needed that day. Days when you are short are flagged, along with days at risk and due dates with no garage visit booked
- **Costs:** total cost of ownership for every vehicle, in the fleet or gone, over any period. Captured costs (tyres, servicing, repairs, tax, other) plus calculated ones: fuel (miles between readings, divided by mpg, times that month's price), the vehicle's share of insurance, lease or finance payments, accidents and fines from the incident register, and loss in value when an owned vehicle is sold. A month-by-month breakdown for each vehicle, with Excel and PDF downloads. A cost entered by hand for a month replaces the calculated one, so nothing is counted twice. **Fuel prices** are kept by month and fuel type (pence per litre, or per kWh for electric)
- **Leaving and returning:** a disposed vehicle can be brought back into the fleet, and a driver who left can be rehired. Each spell is kept as its own period. A driver assignment, mileage reading, garage visit or incident must be dated inside a period when the vehicle was in the fleet (and, where a driver is named, when they were employed): the database refuses anything else
- **Garages:** the master list with contact name, email, phone and types of work, plus a built-in Unknown garage
- **Drivers:** work and personal phones, licence details, points and convictions, employment periods with leave and rehire, incidents, documents, history
- **Incidents:** accidents, damage and fines in one register, with costs and deadlines
- **Insurance:** policies, vehicles covered, claims, documents
- **Reports:** vehicle damage (including accident damage), accidents, vehicle mileage, vehicle status; any period; download as Excel or PDF
- **Settings** (superuser): vehicles needed (the minimum of each vehicle type for each day of the week, read by the Planner), depots, users and access (invite by email as Superuser, Admin, Fleet manager or Management, which is read only; change a user's type, suspend, reinstate or remove them; nobody is deleted, so the audit log stays whole; a table shows who can do what), the date format used on every screen and download (dd-Mmm-yy unless changed), and the typical fuel economy used for vehicles with no figure of their own. **Audit log** (admins and the superuser): searchable by period, vehicle and driver, with links from each entry to the vehicle, driver, incident, policy or setting it is about
- **Dashboard display** (Settings, superuser): each of the dashboard's eight sections can be hidden or shown and given an order number from 0 to 99; sections are shown lowest number first, for everyone. The date range at the top is always shown and at least one section always stays on. Half-width panels that follow one another sit side by side; one on its own takes the full width. Stored in the organisation's `settings.dashboard` as `{ section: { seq, show } }`; the section list and its standard order are `DASH_SECTIONS` in `state.js`.
- **Screens on and off** (Settings, superuser): Planner, Incidents, Garages, Insurance, Costs, Reports and the Audit log screen can each be switched off for everyone. A switched-off screen leaves the menu, links to it are removed and its address shows "switched off". Nothing is deleted and every change is still audited. Dashboard, Tasks, Vehicles, Drivers, Settings and Help cannot be switched off. Stored in the organisation's `settings.hidden_screens`.
- **Feedback log:** "Send feedback" at the bottom of every screen lets anyone report an error or ask for a change, with the screen and its version recorded. Each person sees what they sent and the reply under Help. The superuser sees the whole log in Settings and sets who raised it, priority, target date, status and a reply (the database ignores those from anyone else). Items are never deleted (table `feedback_items`).
- **Help:** a link at the bottom of the side menu, above the signed-in user (under More on a phone): the basics, a guide to each screen, common questions with a search box, and the person's own feedback. It only describes screens that are switched on and that the person's user type can see.
- **Versions:** every screen shows its own version at the very bottom, as `v1.YYMMDDHHMM`: the date and time (UK) its own files were last changed. Screens that an update does not touch keep their earlier version. The list is in `versions.js`, which is written when an update is put together.
- **Documents:** upload from files, a folder, the phone camera, a webcam, or drag and drop

## Files

- `index.html`: the page. `config.js`: Supabase URL, public key and the sign-in screen branding.
- `main.js`, `api.js`, `ui.js`, `actions.js`, `docs.js`, `exports.js`, `auth.js`, `shell.js`, `router.js`, `state.js`, `domain.js`: the app. `exports.js` builds the Excel and PDF files with no outside library.
- `dashboard.js`, `availability-chart.js`, `planner.js`, `rag.js`, `costs.js`, `tco.js` (the cost sums), `reports.js`, `insight.js`, `tasks.js`, `vehicles.js`, `availability.js`, `garages.js`, `drivers.js`, `incidents.js`, `insurance.js`, `settings.js`, `feedback.js`, `help.js`, `versions.js` (the version of each screen), `audit.js`, `history.js`, `placeholder.js`: one file per screen or shared screen logic.
- `theme.css`, `app.css`: styles. `supabase.js`: the Supabase client library (version 2.117.2). `*.woff2`: fonts (Cascadia Code and Barlow Condensed, both open licence).

## Branding

The look follows alchemydrinks.co.uk: pink banner titles (#FF0066), dark ink buttons (#2E2E2E), gold accent (#A8895B), Cascadia Code type.
- After sign-in, colours and the logo come from the organisation's `brand` setting in the database (`colours.primary`, `colours.accent`, `logo_url`).
- The sign-in screen uses `brand` in `config.js`.
- The logo is currently loaded straight from alchemydrinks.co.uk. To host it yourself, save the logo in this folder as `logo.png`, set `logoUrl: 'logo.png'` in `config.js`, and set `logo_url` to `logo.png` in the database.

## Notes

- The app is built to fit a phone screen without sideways scrolling (checked at 320 to 412 px wide).

- Serve it locally with `python3 -m http.server 8000` (ES modules need a web server).
- After deploying, set the Supabase Site URL and Redirect URLs (Authentication, URL Configuration) to the deployed address.
- Documents are stored in a private bucket. Photos and PDFs only, up to 10 MB each. Large photos are shrunk before upload.
- The offence-code list (SP30, TS10 and so on) is a convenience: check it against current DVLA guidance.
