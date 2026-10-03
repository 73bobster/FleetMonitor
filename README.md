# FleetMonitor app

Plain HTML, CSS and JavaScript. There is no build step and no framework. The Supabase client library and the fonts are
included in `vendor/` and `fonts/`, so the app has no runtime dependency on a CDN.

## What works now

- Sign in, create an account from an invitation link, reset a password, join with an invitation code
- **Tasks**: everything coming due, grouped by urgency. Record a renewal, set or correct a date, snooze, dismiss, restore, and email the driver (opens your email app, then records that you sent it)
- **Vehicles**: list, add, edit, archive. Detail tabs for compliance, drivers, odometer readings and change history
- **Drivers**: list, add, edit, archive. Detail tabs for licence checks (date of birth and licence details are visible only to fleet managers, fleet admins and superusers), compliance and change history
- Roles: reviewers see everything they are allowed to but get no buttons; the database enforces the same rules
- Organisation brand colour is applied from `organisations.brand.colours.primary`

## Not built yet

Insurance screens, Reports, the Audit log screen, Settings (depots, users and roles, compliance types, templates, branding),
sending email from FleetMonitor itself, WhatsApp and SMS. Depots can only be created in the database for now.

## Run it locally

ES modules need a web server (opening `index.html` as a file will not work):

    python3 -m http.server 8000
    # then open http://localhost:8000

## Deploy

Upload the folder to any static host (GitHub Pages, Netlify, Cloudflare Pages). Keep `index.html` at the root.

**Then, once, in the Supabase dashboard** (Authentication, URL Configuration): set the Site URL to your deployed address and add it to
the Redirect URLs. Without this, confirmation and password-reset emails link to the wrong place.
Supabase's built-in email sender is for testing and is heavily rate-limited: set up your own SMTP provider before real users arrive.

## First sign-in (Alchemy superuser)

Open `https://YOUR-SITE/?invite=THE-INVITATION-CODE`, choose Create account, use exactly the invited email address, confirm the
email, then sign in. The invitation is applied automatically. If you sign up some other way, paste the code on the
"not part of an organisation yet" screen instead.

## Files

    index.html            page shell
    config.js             Supabase URL and publishable key (public by design)
    css/                  theme tokens (brand colours, fonts) and styles
    js/main.js            boot, session and invitation flow, routes
    js/api.js             every database call, scoped to the current organisation
    js/ui.js              escaped-by-default templating, forms, modals, plates
    js/actions.js         task actions shared by Tasks, Vehicles and Drivers
    js/views/             one file per screen
    tests/                click-through tests (fake Supabase client + jsdom)

## Tests

    npm install
    npm test

61 checks across four scenarios: manager, reviewer, no organisation, invitation link. They run without a network or a browser.
They do not check how the pages look. Look at them in a real browser before showing anyone.

## Security notes

- All user and database text is escaped before it reaches the page (`html` templates in `js/ui.js`). Use `raw()` only for markup you wrote yourself.
- `config.js` holds only the public key. Never put a service_role key in this app.
- A strict Content-Security-Policy is a sensible next hardening step once the deployed app has been checked in a browser.
