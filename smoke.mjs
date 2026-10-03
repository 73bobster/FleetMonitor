// Click-through tests for the front end, run in jsdom against a fake Supabase client.
// Usage: node tests/smoke.mjs <scenario>   (scenarios: manager, reviewer, noaccess, invite)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';
import { makeFake } from './fake-supabase.js';

const here = dirname(fileURLToPath(import.meta.url));
const scenario = process.argv[2] || 'manager';

// ---- Browser environment ------------------------------------------------------------
const indexHtml = readFileSync(join(here, '..', 'index.html'), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
const url = scenario === 'invite' ? 'https://app.test/?invite=GOODCODE' : 'https://app.test/';
const dom = new JSDOM(indexHtml, { url, pretendToBeVisual: true });
const { window } = dom;
window.__FM_TEST__ = true;
window.scrollTo = () => {};
const D = window.HTMLDialogElement?.prototype;
Object.defineProperty(D, 'open', { get() { return this.hasAttribute('open'); }, configurable: true });
D.showModal = function showModal() { this.setAttribute('open', ''); };
D.close = function close() { if (this.hasAttribute('open')) { this.removeAttribute('open'); this.dispatchEvent(new window.Event('close')); } };
Object.assign(globalThis, { window, document: window.document, location: window.location, history: window.history, localStorage: window.localStorage });
window.addEventListener('error', (e) => { console.error('PAGE ERROR:', e.message); process.exitCode = 1; });

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms));
const type = (el, v) => { el.value = v; el.dispatchEvent(new window.Event('input', { bubbles: true })); el.dispatchEvent(new window.Event('change', { bubbles: true })); };
const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
const submit = (form) => (form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
const text = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
const dialog = () => $('#dialog');

let passed = 0; let failed = 0;
function check(cond, msg) { if (cond) { passed++; console.log(`  PASS ${msg}`); } else { failed++; console.log(`  FAIL ${msg}`); } }

// ---- Seed data ------------------------------------------------------------------------
const iso = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const task = (o) => ({ organisation_id: 'org-1', source_type: 'compliance_item', applies_to: 'vehicle', vehicle_id: null, driver_id: null, policy_id: null, depot_id: null, lead_days: [30, 14, 7], is_statutory: false, snoozed_until: null, state_reason: null, ...o });
function seed(role) {
  const db = {
    organisations: [{ id: 'org-1', name: 'Alchemy Drinks', slug: 'alchemy', status: 'active', brand: { colours: { primary: '#7A1F3D' } } }],
    memberships: role ? [{ id: 'm1', organisation_id: 'org-1', user_id: 'user-1', role, status: 'active' }] : [],
    depots: [],
    vehicles: [
      { id: 'v1', organisation_id: 'org-1', registration: 'AB12CDE', make: 'Ford', model: 'Transit', category: 'van', status: 'active', nickname: 'Big Blue', primary_driver_id: 'd1', latest_mileage: 48210, latest_reading_date: '2026-09-01', depot_id: null, archived_at: null, running_costs_total: 0 },
      { id: 'v2', organisation_id: 'org-1', registration: 'JK56LMN', make: 'DAF', model: 'LF', category: 'hgv', status: 'active', nickname: null, primary_driver_id: null, latest_mileage: null, depot_id: null, archived_at: null, running_costs_total: 0 },
    ],
    drivers: [
      { id: 'd1', organisation_id: 'org-1', first_name: 'Dave', last_name: 'Driver', email: 'dave@alchemy.test', mobile: '07700900001', employment_status: 'active', job_title: 'Driver', archived_at: null },
      { id: 'd2', organisation_id: 'org-1', first_name: '<img src=x onerror=alert(1)>', last_name: 'Evil', email: null, employment_status: 'active', archived_at: null },
    ],
    compliance_tasks: [
      task({ source_id: 'ci-1', type_name: 'MOT test', type_code: 'MOT', vehicle_id: 'v1', target_label: 'AB12CDE - Big Blue', due_date: iso(-3), days_remaining: -3, status: 'overdue', is_statutory: true }),
      task({ source_id: 'ci-2', type_name: 'Vehicle excise duty (road tax)', type_code: 'ROAD_TAX', vehicle_id: 'v1', target_label: 'AB12CDE - Big Blue', due_date: iso(5), days_remaining: 5, status: 'due_soon', is_statutory: true }),
      task({ source_id: 'ci-3', type_name: 'Routine service', type_code: 'SERVICE', vehicle_id: 'v2', target_label: 'JK56LMN', due_date: null, days_remaining: null, status: 'no_date' }),
      task({ source_id: 'ci-4', type_name: 'Driving licence check', applies_to: 'driver', driver_id: 'd1', target_label: 'Dave Driver', due_date: iso(90), days_remaining: 90, status: 'upcoming' }),
      task({ source_id: 'pol-1', source_type: 'policy', type_name: 'Insurance renewal', applies_to: 'policy', policy_id: 'pol-1', target_label: 'FP-1001 - Fleet Insurer', due_date: iso(15), days_remaining: 15, status: 'due_soon' }),
      task({ source_id: 'ci-6', type_name: 'MOT test', vehicle_id: 'v2', target_label: 'JK56LMN', due_date: iso(-1), days_remaining: -1, status: 'snoozed', snoozed_until: iso(4), state_reason: 'Booked in for Thursday' }),
      task({ source_id: 'ci-7', type_name: 'Driving licence check', applies_to: 'driver', driver_id: 'd2', target_label: '<img src=x onerror=alert(1)> Evil', due_date: iso(8), days_remaining: 8, status: 'due_soon' }),
    ],
    vehicle_assignments: [{ id: 'a1', organisation_id: 'org-1', vehicle_id: 'v1', driver_id: 'd1', assignment_type: 'primary', start_date: '2026-01-01', end_date: null }],
    message_templates: [{ id: 'tpl1', organisation_id: 'org-1', code: 'driver_reminder', channel: 'email', is_active: true, subject: 'Action needed: {{item_name}} due {{due_date}}', body: 'Hi {{driver_name}},\n\n{{item_name}} for {{registration}} is due on {{due_date}}.\n\n{{org_name}}' }],
    message_log: [], task_states: [], compliance_renewals: [], odometer_readings: [], audit_log: [], licence_checks: [],
    driver_current_licence: [{ organisation_id: 'org-1', driver_id: 'd1', status: 'valid', checked_on: '2026-08-01' }],
    driver_sensitive: [{ organisation_id: 'org-1', driver_id: 'd1', date_of_birth: '1985-04-12', licence_type: 'full', entitlement_categories: ['B', 'C1'] }],
    _views: { vehicle_overview: 'vehicles' },
    _userId: 'user-1',
  };
  db._rpc = {
    record_compliance_renewal: (a) => ({ id: a.p_item_id, due_date: a.p_new_due_date || '2027-10-03' }),
    accept_invitation: ({ p_token }) => {
      if (p_token !== 'GOODCODE') throw new Error('Invitation is invalid or has expired');
      db.memberships.push({ id: 'm1', organisation_id: 'org-1', user_id: 'user-1', role: 'fleet_manager', status: 'active' });
      return 'org-1';
    },
  };
  return db;
}
const rpcCalls = (db, name) => db._log.filter((l) => l.kind === 'rpc' && l.name === name);
const writes = (db, table, op) => db._log.filter((l) => l.kind === 'from' && l.table === table && l.op === op);
const signedIn = { user: { id: 'user-1', email: 'robert@alchemy.test' } };

async function go(hash) { window.location.hash = hash; await settle(120); }

// ---- Scenarios ---------------------------------------------------------------------------
async function manager() {
  const db = seed('fleet_manager');
  const fake = makeFake(db);
  const { boot } = await import('../js/main.js');
  await boot(fake); await settle();

  console.log('Sign in');
  check(!!$('#email') && text($('h1')) === 'Sign in', 'shows the sign-in screen when signed out');
  type($('#email'), 'robert@alchemy.test'); type($('#password'), 'wrong-password'); submit($('form')); await settle();
  check(text($('.form-error')).includes('Email or password is incorrect'), 'wrong password shows a plain-language error');
  type($('#password'), 'correct-password'); submit($('form')); await settle(200);
  check(text($('.side-name')) === 'Alchemy Drinks', 'signs in and shows the organisation name');
  check(document.documentElement.style.getPropertyValue('--brand') === '#7A1F3D' && document.documentElement.style.getPropertyValue('--brand-ink') === '#FFFFFF', 'applies the organisation brand colour with readable text on it');
  check(text($('.side-role')) === 'Fleet manager', 'shows the signed-in role');

  console.log('Tasks screen');
  const main = $('#main');
  const heads = $$('.group-toggle', main).map((b) => text(b));
  check(heads.some((h) => h.startsWith('Overdue 1')) && heads.some((h) => h.startsWith('Due soon 3')) && heads.some((h) => h.startsWith('No date set 1')), `groups tasks by urgency (${heads.join(' | ')})`);
  check($('.group-upcoming .group-toggle').getAttribute('aria-expanded') === 'false' && !$('.group-upcoming .task'), 'upcoming tasks start collapsed');
  check(!$('.group-snoozed'), 'snoozed tasks are hidden by default');
  check(text($('#task-summary')).includes('1 overdue') && text($('#task-summary')).includes('3 due soon'), `summary line counts tasks (${text($('#task-summary'))})`);
  check(text($('.task .plate')) === 'AB12 CDE', 'shows the vehicle as a registration plate');
  check(text($('[data-badge="tasks"]')) === '1' && !$('[data-badge="tasks"]').hidden, 'navigation badge shows the overdue count');
  check(!$('img[src="x"]', main) && text(main).includes('<img src=x onerror=alert(1)>'), 'data with markup in it is shown as text, never run');
  type($('#task-search'), 'dave'); await settle(10);
  check($$('.task', main).length === 1, 'search narrows the list');
  type($('#task-search'), ''); await settle(10);
  click($$('.seg-btn', main).find((b) => text(b) === 'Insurance')); await settle(10);
  check($$('.task', main).length === 1 && text($('.task', main)).includes('Insurance renewal'), 'kind filter shows insurance tasks only');
  click($$('.seg-btn', main).find((b) => text(b) === 'All')); await settle(10);
  $('#show-quiet').checked = true; $('#show-quiet').dispatchEvent(new window.Event('change', { bubbles: true })); await settle(10);
  check(!!$('.group-snoozed .task'), 'snoozed tasks can be shown');
  $('#show-quiet').checked = false; $('#show-quiet').dispatchEvent(new window.Event('change', { bubbles: true })); await settle(10);

  console.log('Record a renewal');
  click($('[data-action="renew"]', main)); await settle();
  check(dialog().open && text($('#dlg-title')).startsWith('Record renewal'), 'opens the renewal form from the row button');
  type($('#f-new_due_date'), '2027-09-30'); type($('#f-reference'), 'MOT-9'); type($('#f-cost'), '54.85');
  submit($('#dialog form')); await settle(150);
  const renew = rpcCalls(db, 'record_compliance_renewal')[0]?.args;
  check(renew && renew.p_item_id === 'ci-1' && renew.p_new_due_date === '2027-09-30' && renew.p_reference === 'MOT-9' && renew.p_cost === 54.85, `sends the renewal to the database (${JSON.stringify(renew)})`);
  check(!dialog().open, 'closes the form after saving');
  check(text($('#toasts')).includes('Renewal recorded'), 'confirms with a message');

  console.log('Snooze');
  click($$('.task-title', main).find((b) => text(b).startsWith('Vehicle excise duty'))); await settle(150);
  check(dialog().open && text(dialog()).includes('Statutory'), 'opens the task panel');
  check(!!$('#panel-history', dialog()) && !text($('#panel-history')).includes('Loading'), 'history finishes loading');
  click($('[data-action="snooze"]', dialog())); await settle();
  type($('#f-reason'), 'Booked for Thursday'); submit($('#dialog form')); await settle(150);
  const snooze = writes(db, 'task_states', 'upsert')[0]?.payload;
  check(snooze && snooze.state === 'snoozed' && snooze.source_id === 'ci-2' && snooze.reason === 'Booked for Thursday' && !!snooze.snoozed_until, `saves the snooze with its reason (${JSON.stringify(snooze)})`);

  console.log('Email from a task');
  click($$('.task-title', main).find((b) => text(b).startsWith('Vehicle excise duty'))); await settle(150);
  click($('[data-action="email"]', dialog())); await settle(150);
  check($('#f-to').value === 'dave@alchemy.test', 'finds the primary driver of the vehicle and fills in their email');
  check($('#f-subject').value.includes('Vehicle excise duty') && $('#f-body').value.includes('AB12 CDE') && $('#f-body').value.includes('Hi Dave'), 'merges the template');
  check($('#mailto-link').getAttribute('href').startsWith('mailto:dave%40alchemy.test?subject='), 'builds the email-app link');
  submit($('#dialog form')); await settle(150);
  const msg = writes(db, 'message_log', 'insert')[0]?.payload;
  check(msg && msg.status === 'manual_sent' && msg.channel === 'email' && msg.driver_id === 'd1' && msg.source_id === 'ci-2' && msg.organisation_id === 'org-1', 'records the email on the task as sent manually');

  console.log('Vehicles');
  await go('#/vehicles');
  check($$('.plate', main).length === 2, 'lists vehicles as plates');
  check(text($('table.grid', main)).includes('Dave Driver') && text($('table.grid', main)).includes('48,210'), 'shows driver and mileage');
  type($('#v-search'), 'daf'); await settle(10);
  check($$('tbody tr', main).length === 1, 'search narrows the vehicle list');
  await go('#/vehicles/new');
  check(!!$('#vehicle-form'), 'opens the add-vehicle form');
  type($('#f-registration'), 'xy74 abc'); type($('#f-category'), 'hgv'); type($('#f-make'), 'Volvo'); type($('#f-gross_weight_kg'), '18000');
  submit($('#vehicle-form')); await settle(200);
  const veh = writes(db, 'vehicles', 'insert')[0]?.payload;
  check(veh && veh.registration === 'XY74 ABC' && veh.organisation_id === 'org-1' && veh.category === 'hgv' && veh.gross_weight_kg === 18000 && veh.status === 'active', `saves the vehicle (${JSON.stringify(veh)})`);
  check(/^#\/vehicles\/[^/]+\?tab=compliance$/.test(window.location.hash), 'goes to the new vehicle compliance tab');
  check(text($('h1', $('#main'))) === 'XY74 ABC' && text($('#tab-body')).includes('Nothing tracked'), 'shows the new vehicle');
  await go('#/vehicles/v1?tab=compliance');
  check(text($('#tab-body')).includes('MOT test') && text($('#tab-body')).includes('3 days overdue'), 'compliance tab lists the vehicle items');
  await go('#/vehicles/v1?tab=readings');
  click($('[data-action="add"]')); await settle();
  type($('#f-mileage'), '50000'); submit($('#dialog form')); await settle(150);
  check(writes(db, 'odometer_readings', 'insert')[0]?.payload?.mileage === 50000, 'adds an odometer reading');
  await go('#/vehicles/v1?tab=readings');
  click($('[data-action="add"]')); await settle();
  type($('#f-mileage'), '100'); submit($('#dialog form')); await settle(150);
  check(dialog().open && text($('.form-error', dialog())).includes('lower than the last reading'), 'refuses a lower mileage unless confirmed');
  click($('[data-close]', dialog())); await settle();

  console.log('Assigning a driver');
  await go('#/vehicles/v2?tab=drivers');
  click($('[data-action="assign"]')); await settle();
  type($('#f-driver_id'), 'd1');
  db._errors['vehicle_assignments:insert'] = { message: 'Driver licence status is expired: an override reason is required to assign this driver', code: 'P0001' };
  submit($('#dialog form')); await settle(150);
  check(dialog().open && text($('.form-error', dialog())).includes('override reason is required'), 'shows the licence block message inside the form');
  click($('[data-close]', dialog())); await settle();
  delete db._errors['vehicle_assignments:insert'];

  console.log('Drivers');
  await go('#/drivers');
  check(text($('table.grid')).includes('Dave Driver') && !$('img[src="x"]'), 'lists drivers, escaping names');
  check(text($('table.grid')).includes('Valid'), 'shows licence status for roles that can see it');
  await go('#/drivers/d1?tab=licence');
  check(text($('#tab-body')).includes('1985') && text($('#tab-body')).includes('B, C1'), 'licence tab shows date of birth and categories');
  click($('[data-action="check"]')); await settle();
  type($('#f-status'), 'expired'); type($('#f-entitlement_categories'), 'b, c1'); submit($('#dialog form')); await settle(150);
  const lc = writes(db, 'licence_checks', 'insert')[0]?.payload;
  check(lc && lc.status === 'expired' && lc.driver_id === 'd1' && JSON.stringify(lc.entitlement_categories) === '["B","C1"]', `logs a licence check (${JSON.stringify(lc)})`);
  await go('#/drivers/new');
  type($('#f-first_name'), 'Dina'); type($('#f-last_name'), 'Driver'); type($('#f-date_of_birth'), '1990-01-02'); type($('#f-entitlement_categories'), 'b');
  submit($('#driver-form')); await settle(200);
  const drv = writes(db, 'drivers', 'insert')[0]?.payload; const sens = writes(db, 'driver_sensitive', 'upsert')[0]?.payload;
  check(drv?.first_name === 'Dina' && sens?.date_of_birth === '1990-01-02' && JSON.stringify(sens?.entitlement_categories) === '["B"]', 'saves a driver and their restricted details separately');

  console.log('Other screens and sign out');
  await go('#/insurance');
  check(text($('#main')).includes('Not built yet'), 'unbuilt sections say so plainly');
  await go('#/tasks');
  click($('[data-action="signout"]')); await settle(150);
  check(!!$('#email') && text($('h1')) === 'Sign in', 'signing out returns to the sign-in screen');
}

async function reviewer() {
  const db = seed('reviewer');
  db.driver_current_licence = []; db.driver_sensitive = []; db.licence_checks = []; db.message_log = [];
  const fake = makeFake(db, { session: signedIn });
  const { boot } = await import('../js/main.js');
  await boot(fake); await settle(200);
  console.log('Reviewer');
  const main = $('#main');
  check(text($('.side-role')) === 'Reviewer', 'shows the reviewer role');
  check($$('.task', main).length > 0, 'can see tasks');
  check(!$('[data-action="renew"]', main) && !$('[data-action="setdate"]', main), 'has no action buttons on tasks');
  check(!$$('.side-link').some((a) => text(a) === 'Settings' || text(a) === 'Audit log'), 'does not see Settings or Audit log');
  click($$('.task-title', main)[0]); await settle(150);
  check(!$('.panel-actions', dialog()), 'task panel offers no actions');
  click($('[data-close]', dialog())); await settle();
  await go('#/vehicles');
  check(!$$('a.btn', $('#main')).some((a) => text(a) === 'Add vehicle'), 'no Add vehicle button');
  await go('#/vehicles/new');
  check(text($('#main')).includes('can view vehicles but not change'), 'add form is refused');
  await go('#/drivers');
  check(!text($('#main thead')).includes('Licence'), 'driver list hides the licence column');
  await go('#/drivers/d1');
  check(!$$('.tab').some((a) => text(a) === 'Licence'), 'driver page hides the Licence tab');
}

async function noaccess() {
  const db = seed(null);
  const fake = makeFake(db, { session: signedIn });
  const { boot } = await import('../js/main.js');
  await boot(fake); await settle(150);
  console.log('Signed in without an organisation');
  check(text($('h1')).includes('not part of an organisation'), 'explains the situation');
  type($('#code'), 'WRONG'); submit($('form')); await settle(150);
  check(text($('.form-error', $('#app'))).includes('invalid or has expired'), 'a wrong code shows the database message');
  type($('#code'), 'GOODCODE'); submit($('form')); await settle(250);
  check(rpcCalls(db, 'accept_invitation').length === 2 && text($('.side-name')) === 'Alchemy Drinks', 'a good code joins the organisation and opens the app');
}

async function invite() {
  const db = seed(null);
  const fake = makeFake(db);
  const { boot } = await import('../js/main.js');
  await boot(fake); await settle();
  console.log('Invitation link');
  check(text($('h1')) === 'Create your account' && text($('.notice')).includes('invited'), 'an invitation link opens the create-account screen');
  check(!window.location.search.includes('invite'), 'the code is removed from the address bar');
  type($('#email'), 'robert@alchemy.test'); type($('#password'), 'correct-password'); submit($('form')); await settle(100);
  const su = db._log.find((l) => l.kind === 'signUp');
  check(su?.email === 'robert@alchemy.test' && su.options.emailRedirectTo.includes('invite=GOODCODE'), 'the confirmation link carries the invitation');
  check(text($('h1')) === 'Check your email', 'tells them to confirm their email');
  click($('[data-action="signin"]')); await settle();
  type($('#email'), 'robert@alchemy.test'); type($('#password'), 'correct-password'); submit($('form')); await settle(250);
  check(rpcCalls(db, 'accept_invitation')[0]?.args?.p_token === 'GOODCODE' && text($('.side-name')) === 'Alchemy Drinks', 'signing in applies the saved invitation');
}

const run = { manager, reviewer, noaccess, invite }[scenario];
console.log(`Scenario: ${scenario}`);
try { await run(); } catch (e) { failed++; console.log(`  ERROR ${e.stack || e}`); }
console.log(`${scenario}: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
