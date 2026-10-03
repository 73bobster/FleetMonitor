// Drivers: list, add or edit, and the detail page with tabs.
// Date of birth and licence details come from the restricted driver_sensitive table and licence_checks,
// which the database only returns to fleet managers, fleet admins and superusers.
import * as api from './api.js';
import { can } from './state.js';
import {
  html, mount, on, plate, pill, fieldsHtml, readForm, openModal, toast, loadingHtml, emptyHtml, errorHtml,
  fmtDate, fmtDateShort, todayStr,
} from './ui.js';
import {
  EMPLOYMENT_LABEL, LICENCE_STATUS_LABEL, LICENCE_METHOD_LABEL, BLOCKING_LICENCE, driverName, worstStatus, taskKey, vehicleTitle,
} from './domain.js';
import { openTaskPanel } from './actions.js';
import { navigate } from './router.js';
import { historyList } from './history.js';
import { dueText } from './ui.js';

const opts = (o) => Object.entries(o);
const licenceClass = (s) => (s === 'valid' ? 'upcoming' : BLOCKING_LICENCE.includes(s) ? 'overdue' : 'due_soon');
const licencePill = (s) => html`<span class="pill pill-${licenceClass(s)}">${LICENCE_STATUS_LABEL[s] || s}</span>`;
const parseCats = (s) => { const a = String(s || '').split(/[\s,]+/).filter(Boolean).map((x) => x.toUpperCase()); return a.length ? a : null; };

// ---- List ------------------------------------------------------------------
export async function driversList(main) {
  mount(main, html`<header class="page-head"><h1>Drivers</h1></header>${loadingHtml('Loading drivers')}`);
  const [drivers, tasks, depots, vehicles, assigns, licences] = await Promise.all([
    api.listDrivers(), api.listTasks(), api.listDepots(), api.listVehicles(), api.listAssignments({}), api.currentLicences(),
  ]);
  const depotById = new Map(depots.map((d) => [d.id, d]));
  const vehicleById = new Map(vehicles.map((v) => [v.id, v]));
  const licBy = new Map(licences.map((l) => [l.driver_id, l]));
  const ui = { q: '', depot: '', all: false };
  mount(main, html`
    <header class="page-head"><h1>Drivers</h1>${can.write ? html`<a class="btn btn-primary" href="#/drivers/new">Add driver</a>` : ''}</header>
    <div class="filters">
      <input type="search" id="d-search" placeholder="Search name or employee number" aria-label="Search drivers">
      ${depots.length > 1 ? html`<label class="inline"><span class="sr-only">Depot</span><select id="d-depot"><option value="">All depots</option>${depots.map((d) => html`<option value="${d.id}">${d.name}</option>`)}</select></label>` : ''}
      <label class="check small"><input type="checkbox" id="d-all"> <span>Include inactive</span></label>
    </div>
    <div id="d-table"></div>`);
  const box = main.querySelector('#d-table');
  function draw() {
    const rows = drivers.filter((d) =>
      (ui.all || d.employment_status === 'active') && (!ui.depot || d.depot_id === ui.depot) &&
      (!ui.q || [driverName(d), d.employee_number].join(' ').toLowerCase().includes(ui.q)));
    if (!drivers.length) { mount(box, emptyHtml('No drivers yet', 'Add your drivers to track licence checks and assign them to vehicles.', can.write ? html`<p><a class="btn btn-primary" href="#/drivers/new">Add a driver</a></p>` : '')); return; }
    if (!rows.length) { mount(box, emptyHtml('No drivers match', 'Try a different filter or search.')); return; }
    mount(box, html`<table class="grid"><thead><tr><th>Driver</th><th>Depot</th><th>Vehicle</th>${can.sensitive ? html`<th>Licence</th>` : ''}<th>Compliance</th></tr></thead><tbody>${rows.map((d) => {
      const dt = tasks.filter((t) => t.driver_id === d.id);
      const worst = worstStatus(dt);
      const lic = licBy.get(d.id);
      const mine = assigns.filter((a) => a.driver_id === d.id && !a.end_date).map((a) => vehicleById.get(a.vehicle_id)).filter(Boolean);
      return html`<tr>
        <td data-label="Driver"><a href="#/drivers/${d.id}"><strong>${driverName(d)}</strong></a><div class="sub">${d.job_title || ''}${d.employment_status !== 'active' ? html` <span class="tag">${EMPLOYMENT_LABEL[d.employment_status]}</span>` : ''}</div></td>
        <td data-label="Depot">${depotById.get(d.depot_id)?.name || ''}</td>
        <td data-label="Vehicle">${mine.length ? mine.map((v) => html`<a class="plate-link" href="#/vehicles/${v.id}">${plate(v.registration)}</a> `) : html`<span class="muted">None</span>`}</td>
        ${can.sensitive ? html`<td data-label="Licence">${lic ? html`${licencePill(lic.status)}<div class="sub">Checked ${fmtDateShort(lic.checked_on)}</div>` : html`<span class="muted">Not checked</span>`}</td>` : ''}
        <td data-label="Compliance">${worst ? pill(worst) : html`<span class="muted">None tracked</span>`}</td></tr>`;
    })}</tbody></table>`);
  }
  main.querySelector('#d-search').addEventListener('input', (e) => { ui.q = e.target.value.trim().toLowerCase(); draw(); });
  main.querySelector('#d-depot')?.addEventListener('change', (e) => { ui.depot = e.target.value; draw(); });
  main.querySelector('#d-all').addEventListener('change', (e) => { ui.all = e.target.checked; draw(); });
  draw();
}

// ---- Form ------------------------------------------------------------------
export async function driverForm(main, { id }) {
  const editing = id && id !== 'new';
  mount(main, loadingHtml());
  if (!can.write) { mount(main, emptyHtml('You can view drivers but not change them', '', html`<p><a class="btn" href="#/drivers">Back to drivers</a></p>`)); return; }
  const [depots, existing, sens] = await Promise.all([api.listDepots(), editing ? api.getDriver(id) : null, editing && can.sensitive ? api.getDriverSensitive(id) : null]);
  if (editing && !existing) { mount(main, emptyHtml('Driver not found', 'They may have been archived.', html`<p><a class="btn" href="#/drivers">Back to drivers</a></p>`)); return; }
  const base = [
    { name: 'first_name', label: 'First name', required: true, autocomplete: 'off' },
    { name: 'last_name', label: 'Last name', required: true, autocomplete: 'off' },
    { name: 'email', label: 'Email', type: 'email', hint: 'Used when you email them from a task.' },
    { name: 'mobile', label: 'Mobile', type: 'tel' },
    { name: 'employee_number', label: 'Employee number' },
    { name: 'job_title', label: 'Job title' },
    ...(depots.length ? [{ name: 'depot_id', label: 'Depot', type: 'select', options: depots.map((d) => [d.id, d.name]) }] : []),
    { name: 'employment_status', label: 'Employment', type: 'select', required: true, options: opts(EMPLOYMENT_LABEL) },
    { name: 'start_date', label: 'Start date', type: 'date' },
    { name: 'notes', label: 'Notes', type: 'textarea', span: 2 },
  ];
  const sensitive = [
    { name: 'date_of_birth', label: 'Date of birth', type: 'date', hint: 'Needed for insurance. Only fleet managers, fleet admins and superusers can see this.' },
    { name: 'licence_start_date', label: 'Licence held since', type: 'date' },
    { name: 'licence_type', label: 'Licence type', type: 'select', options: [['full', 'Full'], ['provisional', 'Provisional'], ['international', 'International'], ['other', 'Other']] },
    { name: 'licence_expiry_date', label: 'Photocard expiry', type: 'date' },
    { name: 'entitlement_categories', label: 'Entitlement categories', hint: 'Separate with commas, for example B, C1, C.' },
  ];
  const values = existing || { employment_status: 'active' };
  const sensValues = { ...(sens || {}), entitlement_categories: (sens?.entitlement_categories || []).join(', ') };
  const back = editing ? `#/drivers/${id}` : '#/drivers';
  mount(main, html`
    <header class="page-head"><h1>${editing ? `Edit ${driverName(existing)}` : 'Add driver'}</h1></header>
    <form class="page-form" id="driver-form">
      <fieldset><legend>Driver</legend>${fieldsHtml(base, values)}</fieldset>
      ${can.sensitive ? html`<fieldset><legend>Licence details</legend>${fieldsHtml(sensitive, sensValues)}</fieldset>` : ''}
      <p class="form-error" role="alert" hidden></p>
      <div class="form-actions"><button class="btn btn-primary" type="submit">${editing ? 'Save changes' : 'Add driver'}</button><a class="btn" href="${back}">Cancel</a></div>
    </form>`);
  const form = main.querySelector('#driver-form');
  const err = form.querySelector('.form-error');
  form.onsubmit = async (e) => {
    e.preventDefault();
    err.hidden = true;
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      const v = readForm(form, base);
      let s = null;
      if (can.sensitive) { s = readForm(form, sensitive); s.entitlement_categories = parseCats(s.entitlement_categories); }
      const row = await api.saveDriver(v, s, editing ? id : null, !!sens);
      toast(editing ? 'Driver saved.' : 'Driver added. Log their first licence check next.');
      navigate(`#/drivers/${row.id}${editing ? '' : '?tab=licence'}`);
    } catch (ex) { err.textContent = ex.message; err.hidden = false; btn.disabled = false; }
  };
}

// ---- Detail ----------------------------------------------------------------
const TABS = [
  { id: 'overview', label: 'Overview' }, { id: 'licence', label: 'Licence', when: () => can.sensitive },
  { id: 'compliance', label: 'Compliance' }, { id: 'history', label: 'History', when: () => can.audit },
];
const facts = (pairs) => html`<dl class="facts">${pairs.filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>`;

export async function driverDetail(main, { id }, query) {
  mount(main, loadingHtml());
  const d = await api.getDriver(id);
  if (!d) { mount(main, emptyHtml('Driver not found', 'They may have been archived.', html`<p><a class="btn" href="#/drivers">Back to drivers</a></p>`)); return; }
  const tab = TABS.find((t) => t.id === query.tab && (!t.when || t.when())) ? query.tab : 'overview';
  mount(main, html`
    <header class="page-head">
      <div><p class="crumb"><a href="#/drivers">Drivers</a></p><h1>${driverName(d)}</h1><p class="sub">${d.job_title || ''}${d.employment_status !== 'active' ? html` <span class="tag">${EMPLOYMENT_LABEL[d.employment_status]}</span>` : ''}</p></div>
      ${can.write ? html`<div class="head-actions"><a class="btn" href="#/drivers/${d.id}/edit">Edit</a><button class="btn" data-action="archive">Archive</button></div>` : ''}
    </header>
    <nav class="tabs" aria-label="Driver sections">${TABS.filter((t) => !t.when || t.when()).map((t) => html`<a class="tab" href="#/drivers/${d.id}?tab=${t.id}" ${t.id === tab ? html`aria-current="page"` : ''}>${t.label}</a>`)}</nav>
    <div id="tab-body">${loadingHtml()}</div>`);
  on(main, {
    archive: () => openModal({
      title: `Archive ${driverName(d)}?`, submitLabel: 'Archive driver', danger: true,
      body: html`<p>They will disappear from lists and tasks and be marked as having left. Their records and history are kept.</p>`,
      onSubmit: async () => { await api.archiveDriver(d.id); toast('Driver archived.'); navigate('#/drivers'); },
    }),
  });
  const body = main.querySelector('#tab-body');
  try { await TAB_RENDER[tab](body, d); } catch (err) { console.error(err); mount(body, errorHtml(err.message)); }
}

const TAB_RENDER = {
  async overview(body, d) {
    const [assigns, vehicles, depots] = await Promise.all([api.listAssignments({ driverId: d.id }), api.listVehicles(), api.listDepots()]);
    const vById = new Map(vehicles.map((v) => [v.id, v]));
    const depot = depots.find((x) => x.id === d.depot_id);
    mount(body, html`<div class="cols">
      <section><h2>Contact and employment</h2>${facts([
        ['Email', d.email ? html`<a href="mailto:${d.email}">${d.email}</a>` : ''], ['Mobile', d.mobile], ['Employee number', d.employee_number],
        ['Depot', depot?.name], ['Employment', EMPLOYMENT_LABEL[d.employment_status]], ['Started', fmtDateShort(d.start_date)]])}</section>
      <section><h2>Vehicles</h2>${assigns.length ? html`<ul class="plain">${assigns.map((a) => {
        const v = vById.get(a.vehicle_id);
        return html`<li>${v ? html`<a class="plate-link" href="#/vehicles/${v.id}">${plate(v.registration)}</a> <span class="muted">${vehicleTitle(v)}</span>` : 'Former vehicle'}
          <div class="sub">${a.assignment_type === 'primary' ? 'Primary driver' : 'Named driver'}, ${fmtDateShort(a.start_date)} to ${a.end_date ? fmtDateShort(a.end_date) : 'now'}</div></li>`;
      })}</ul>` : html`<p class="muted">Not assigned to a vehicle. Assign them from a vehicle's Drivers tab.</p>`}</section>
      ${d.notes ? html`<section class="span-all"><h2>Notes</h2><p class="prewrap">${d.notes}</p></section>` : ''}
    </div>`);
  },

  async licence(body, d) {
    let [sens, checks] = await Promise.all([api.getDriverSensitive(d.id), api.listLicenceChecks(d.id)]);
    const draw = () => {
      const last = checks[0];
      mount(body, html`<div class="cols">
        <section><h2>Licence details</h2>${sens ? facts([
          ['Date of birth', fmtDate(sens.date_of_birth)], ['Licence held since', fmtDateShort(sens.licence_start_date)], ['Type', sens.licence_type],
          ['Photocard expiry', fmtDateShort(sens.licence_expiry_date)], ['Categories', (sens.entitlement_categories || []).join(', ')]]) : html`<p class="muted">No licence details recorded.${can.write ? html` <a href="#/drivers/${d.id}/edit">Add them</a>.` : ''}</p>`}</section>
        <section><h2>Latest check</h2>${last ? html`<p>${licencePill(last.status)} <span class="muted">${fmtDate(last.checked_on)}</span></p>${facts([
          ['Points', last.points], ['Next check due', last.next_check_due ? fmtDate(last.next_check_due) : ''], ['Endorsements', last.endorsements]])}`
          : html`<p class="muted">No licence check recorded yet.</p>`}</section>
      </div>
      <h2>Check history</h2>
      ${can.write ? html`<p><button class="btn btn-primary" data-action="check">Log a licence check</button></p>` : ''}
      ${checks.length ? html`<table class="grid"><thead><tr><th>Checked</th><th>Result</th><th class="num">Points</th><th>Method</th><th>Notes</th></tr></thead><tbody>${checks.map((c) => html`<tr>
        <td data-label="Checked">${fmtDate(c.checked_on)}</td><td data-label="Result">${licencePill(c.status)}</td><td data-label="Points" class="num">${c.points ?? ''}</td>
        <td data-label="Method">${LICENCE_METHOD_LABEL[c.method]}</td><td data-label="Notes">${[c.endorsements, c.notes].filter(Boolean).join('. ')}</td></tr>`)}</tbody></table>`
        : emptyHtml('No checks yet', 'Log a check each time you verify the licence, for example with a DVLA share code.')}`);
    };
    const reload = async () => { [sens, checks] = await Promise.all([api.getDriverSensitive(d.id), api.listLicenceChecks(d.id)]); draw(); };
    draw();
    on(body, {
      check: () => {
        const specs = [
          { name: 'checked_on', label: 'Checked on', type: 'date', required: true, max: todayStr() },
          { name: 'method', label: 'How was it checked?', type: 'select', required: true, options: opts(LICENCE_METHOD_LABEL) },
          { name: 'status', label: 'Result', type: 'select', required: true, options: opts(LICENCE_STATUS_LABEL) },
          { name: 'points', label: 'Penalty points', type: 'number', min: '0', step: '1' },
          { name: 'entitlement_categories', label: 'Entitlement categories', hint: 'Separate with commas, for example B, C1.' },
          { name: 'next_check_due', label: 'Next check due', type: 'date', hint: 'Leave blank to use the standard interval.' },
          { name: 'endorsements', label: 'Endorsements', type: 'textarea', span: 2 },
          { name: 'notes', label: 'Notes', type: 'textarea', span: 2 },
        ];
        openModal({
          title: `Licence check: ${driverName(d)}`, submitLabel: 'Save check',
          body: fieldsHtml(specs, { checked_on: todayStr(), method: 'dvla_share_code', status: 'valid' }),
          onSubmit: async (form) => {
            const v = readForm(form, specs);
            v.entitlement_categories = parseCats(v.entitlement_categories);
            await api.addLicenceCheck({ ...v, driver_id: d.id });
            toast(BLOCKING_LICENCE.includes(v.status) ? 'Check saved. This driver can no longer be assigned without an override.' : 'Licence check saved.');
            await reload();
          },
        });
      },
    });
  },

  async compliance(body, d) {
    const ctx = { vehicles: new Map(), drivers: new Map([[d.id, d]]) };
    const load = async () => (await api.listTasks()).filter((t) => t.driver_id === d.id);
    let tasks = await load();
    const byKey = (k) => tasks.find((t) => taskKey(t) === k);
    const draw = () => {
      if (!tasks.length) { mount(body, emptyHtml('Nothing tracked for this driver', 'Compliance items are created from the types switched on for your organisation.')); return; }
      mount(body, html`<table class="grid"><thead><tr><th>Item</th><th>Due</th><th>Status</th><th></th></tr></thead><tbody>${tasks.map((t) => html`<tr>
        <td data-label="Item"><button class="task-title" data-action="open" data-key="${taskKey(t)}">${t.type_name}</button>${t.is_statutory ? html` <span class="tag">Statutory</span>` : ''}</td>
        <td data-label="Due">${t.due_date ? html`${fmtDate(t.due_date)}<div class="sub">${dueText(t.days_remaining)}</div>` : html`<span class="muted">Not set</span>`}</td>
        <td data-label="Status">${pill(t.status)}</td>
        <td class="act">${can.write ? html`<button class="btn btn-sm" data-action="open" data-key="${taskKey(t)}">${t.due_date ? 'Manage' : 'Set date'}</button>` : ''}</td></tr>`)}</tbody></table>`);
    };
    const refresh = async () => { tasks = await load(); draw(); };
    draw();
    on(body, { open: (el) => { const t = byKey(el.dataset.key); if (t) openTaskPanel(t, ctx, refresh); } });
  },

  async history(body, d) {
    const [main, sens] = await Promise.all([api.listAudit('drivers', d.id), api.listAudit('driver_sensitive', d.id)]);
    const merged = [...main, ...sens].sort((a, b) => String(b.occurred_at).localeCompare(String(a.occurred_at)));
    mount(body, html`<h2>Change history</h2>${historyList(merged)}`);
  },
};
