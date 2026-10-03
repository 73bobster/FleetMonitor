// Vehicles: list, add or edit, and the detail page with tabs.
import * as api from './api.js';
import { can } from './state.js';
import {
  html, mount, on, plate, pill, fieldsHtml, readForm, openModal, toast, loadingHtml, emptyHtml, errorHtml,
  fmtDate, fmtDateShort, fmtInt, fmtMoney, dueText, todayStr, formatReg,
} from './ui.js';
import {
  CATEGORY_LABEL, FUEL_LABEL, OWNERSHIP_LABEL, VEHICLE_STATUS_LABEL, LICENCE_STATUS_LABEL, BLOCKING_LICENCE,
  STATUS_LABEL, driverName, vehicleTitle, worstStatus, taskKey,
} from './domain.js';
import { openTaskPanel, taskWho } from './actions.js';
import { navigate } from './router.js';
import { historyList } from './history.js';

const opts = (o) => Object.entries(o);

// ---- List ------------------------------------------------------------------
export async function vehiclesList(main) {
  mount(main, html`<header class="page-head"><h1>Vehicles</h1></header>${loadingHtml('Loading vehicles')}`);
  const [vehicles, tasks, drivers, depots] = await Promise.all([api.listVehicles(), api.listTasks(), api.listDrivers(), api.listDepots()]);
  const driverById = new Map(drivers.map((d) => [d.id, d]));
  const depotById = new Map(depots.map((d) => [d.id, d]));
  const ui = { q: '', depot: '', category: '', all: false };

  mount(main, html`
    <header class="page-head"><h1>Vehicles</h1>${can.write ? html`<a class="btn btn-primary" href="#/vehicles/new">Add vehicle</a>` : ''}</header>
    <div class="filters">
      <input type="search" id="v-search" placeholder="Search registration, make or driver" aria-label="Search vehicles">
      ${depots.length > 1 ? html`<label class="inline"><span class="sr-only">Depot</span><select id="v-depot"><option value="">All depots</option>${depots.map((d) => html`<option value="${d.id}">${d.name}</option>`)}</select></label>` : ''}
      <label class="inline"><span class="sr-only">Type</span><select id="v-cat"><option value="">All types</option>${opts(CATEGORY_LABEL).map(([k, l]) => html`<option value="${k}">${l}</option>`)}</select></label>
      <label class="check small"><input type="checkbox" id="v-all"> <span>Include disposed</span></label>
    </div>
    <div id="v-table"></div>`);
  const box = main.querySelector('#v-table');

  function draw() {
    const rows = vehicles.filter((v) =>
      (ui.all || v.status !== 'disposed') &&
      (!ui.depot || v.depot_id === ui.depot) &&
      (!ui.category || v.category === ui.category) &&
      (!ui.q || [v.registration, v.make, v.model, v.nickname, driverName(driverById.get(v.primary_driver_id))].join(' ').toLowerCase().includes(ui.q)));
    if (!vehicles.length) {
      mount(box, emptyHtml('No vehicles yet', 'Add your first vehicle and its compliance dates will start appearing under Tasks.',
        can.write ? html`<p><a class="btn btn-primary" href="#/vehicles/new">Add a vehicle</a></p>` : ''));
      return;
    }
    if (!rows.length) { mount(box, emptyHtml('No vehicles match', 'Try a different filter or search.')); return; }
    mount(box, html`<table class="grid"><thead><tr><th>Vehicle</th><th>Depot</th><th>Driver</th><th class="num">Mileage</th><th>Compliance</th></tr></thead><tbody>
      ${rows.map((v) => {
        const vt = tasks.filter((t) => t.vehicle_id === v.id);
        const worst = worstStatus(vt);
        const overdue = vt.filter((t) => t.status === 'overdue').length;
        return html`<tr>
          <td data-label="Vehicle"><a class="plate-link" href="#/vehicles/${v.id}">${plate(v.registration)}</a>
            <div class="sub">${vehicleTitle(v)}${v.nickname ? ` (${v.nickname})` : ''}${v.status !== 'active' ? html` <span class="tag">${VEHICLE_STATUS_LABEL[v.status]}</span>` : ''}</div></td>
          <td data-label="Depot">${depotById.get(v.depot_id)?.name || ''}</td>
          <td data-label="Driver">${v.primary_driver_id ? html`<a href="#/drivers/${v.primary_driver_id}">${driverName(driverById.get(v.primary_driver_id))}</a>` : html`<span class="muted">Unassigned</span>`}</td>
          <td data-label="Mileage" class="num">${v.latest_mileage != null ? fmtInt(v.latest_mileage) : html`<span class="muted">None logged</span>`}</td>
          <td data-label="Compliance">${worst ? html`${pill(worst)}${overdue ? html` <span class="sub c-overdue">${overdue} overdue</span>` : ''}` : html`<span class="muted">None tracked</span>`}</td>
        </tr>`;
      })}</tbody></table>`);
  }
  main.querySelector('#v-search').addEventListener('input', (e) => { ui.q = e.target.value.trim().toLowerCase(); draw(); });
  main.querySelector('#v-depot')?.addEventListener('change', (e) => { ui.depot = e.target.value; draw(); });
  main.querySelector('#v-cat').addEventListener('change', (e) => { ui.category = e.target.value; draw(); });
  main.querySelector('#v-all').addEventListener('change', (e) => { ui.all = e.target.checked; draw(); });
  draw();
}

// ---- Form ------------------------------------------------------------------
const sections = (depots) => [
  { title: 'Identity', specs: [
    { name: 'registration', label: 'Registration', required: true, autocomplete: 'off' },
    { name: 'fleet_number', label: 'Fleet number' },
    { name: 'nickname', label: 'Nickname' },
    { name: 'category', label: 'Type', type: 'select', required: true, options: opts(CATEGORY_LABEL) },
    ...(depots.length ? [{ name: 'depot_id', label: 'Depot', type: 'select', options: depots.map((d) => [d.id, d.name]) }] : []),
    { name: 'status', label: 'Status', type: 'select', required: true, options: opts(VEHICLE_STATUS_LABEL) },
  ] },
  { title: 'Details', specs: [
    { name: 'make', label: 'Make' }, { name: 'model', label: 'Model' },
    { name: 'body_type', label: 'Body type' }, { name: 'colour', label: 'Colour' },
    { name: 'vin', label: 'VIN', autocomplete: 'off' }, { name: 'first_registered_date', label: 'First registered', type: 'date' },
    { name: 'year_of_manufacture', label: 'Year of manufacture', type: 'number', min: '1900', max: '2100', step: '1' },
    { name: 'fuel_type', label: 'Fuel', type: 'select', options: opts(FUEL_LABEL) },
    { name: 'gross_weight_kg', label: 'Gross weight (kg)', type: 'number', min: '1', step: '1', hint: 'Over 3,500 kg usually means tachograph and operator licence rules apply.' },
    { name: 'seats', label: 'Seats', type: 'number', min: '0', step: '1' },
    { name: 'mpg', label: 'Fuel economy (mpg)', type: 'number', min: '0', step: '0.1' },
  ] },
  { title: 'Ownership', specs: [
    { name: 'ownership_type', label: 'Ownership', type: 'select', required: true, options: opts(OWNERSHIP_LABEL) },
    { name: 'date_acquired', label: 'Date acquired', type: 'date' },
    { name: 'opening_mileage', label: 'Mileage when acquired', type: 'number', min: '0', step: '1' },
    { name: 'purchase_price', label: 'Purchase price (£)', type: 'number', min: '0', step: '0.01' },
    { name: 'monthly_payment', label: 'Monthly payment (£)', type: 'number', min: '0', step: '0.01', hint: 'Leased or financed vehicles.' },
    { name: 'term_start', label: 'Term start', type: 'date' }, { name: 'term_end', label: 'Term end', type: 'date' },
    { name: 'capped_miles', label: 'Mileage cap over the term', type: 'number', min: '1', step: '1' },
    { name: 'cost_per_excess_mile', label: 'Cost per excess mile (£)', type: 'number', min: '0', step: '0.001' },
  ] },
  { title: 'Notes', specs: [{ name: 'notes', label: 'Notes', type: 'textarea', span: 2, rows: 4 }] },
];

export async function vehicleForm(main, { id }) {
  const editing = id && id !== 'new';
  mount(main, loadingHtml());
  const [depots, existing] = await Promise.all([api.listDepots(), editing ? api.getVehicle(id) : null]);
  if (editing && !existing) { mount(main, emptyHtml('Vehicle not found', 'It may have been archived.', html`<p><a class="btn" href="#/vehicles">Back to vehicles</a></p>`)); return; }
  if (!can.write) { mount(main, emptyHtml('You can view vehicles but not change them', '', html`<p><a class="btn" href="#/vehicles">Back to vehicles</a></p>`)); return; }
  const secs = sections(depots);
  const specs = secs.flatMap((s) => s.specs);
  const values = existing || { category: 'van', status: 'active', ownership_type: 'owned' };
  const back = editing ? `#/vehicles/${id}` : '#/vehicles';
  mount(main, html`
    <header class="page-head"><h1>${editing ? `Edit ${formatReg(existing.registration)}` : 'Add vehicle'}</h1></header>
    <form class="page-form" id="vehicle-form">
      ${secs.map((s) => html`<fieldset><legend>${s.title}</legend>${fieldsHtml(s.specs, values)}</fieldset>`)}
      <p class="form-error" role="alert" hidden></p>
      <div class="form-actions"><button class="btn btn-primary" type="submit">${editing ? 'Save changes' : 'Add vehicle'}</button><a class="btn" href="${back}">Cancel</a></div>
    </form>`);
  const form = main.querySelector('#vehicle-form');
  const err = form.querySelector('.form-error');
  form.onsubmit = async (e) => {
    e.preventDefault();
    err.hidden = true;
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      const v = readForm(form, specs);
      v.registration = v.registration.toUpperCase().replace(/\s+/g, ' ').trim();
      const row = await api.saveVehicle(v, editing ? id : null);
      toast(editing ? 'Vehicle saved.' : 'Vehicle added. Set its compliance dates next.');
      navigate(`#/vehicles/${row.id}${editing ? '' : '?tab=compliance'}`);
    } catch (ex) { err.textContent = ex.message; err.hidden = false; btn.disabled = false; }
  };
}

// ---- Detail ----------------------------------------------------------------
const TABS = [
  { id: 'overview', label: 'Overview' }, { id: 'compliance', label: 'Compliance' }, { id: 'drivers', label: 'Drivers' },
  { id: 'readings', label: 'Readings' }, { id: 'history', label: 'History', when: () => can.audit },
];

const facts = (pairs) => html`<dl class="facts">${pairs.filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>`;

export async function vehicleDetail(main, { id }, query) {
  mount(main, loadingHtml());
  const v = await api.getVehicle(id);
  if (!v) { mount(main, emptyHtml('Vehicle not found', 'It may have been archived.', html`<p><a class="btn" href="#/vehicles">Back to vehicles</a></p>`)); return; }
  const tab = TABS.find((t) => t.id === query.tab && (!t.when || t.when())) ? query.tab : 'overview';
  mount(main, html`
    <header class="page-head head-vehicle">
      <div><p class="crumb"><a href="#/vehicles">Vehicles</a></p><h1>${plate(v.registration)}</h1><p class="sub">${vehicleTitle(v)}${v.nickname ? ` (${v.nickname})` : ''}${v.status !== 'active' ? html` <span class="tag">${VEHICLE_STATUS_LABEL[v.status]}</span>` : ''}</p></div>
      ${can.write ? html`<div class="head-actions"><a class="btn" href="#/vehicles/${v.id}/edit">Edit</a><button class="btn" data-action="archive">Archive</button></div>` : ''}
    </header>
    <nav class="tabs" aria-label="Vehicle sections">${TABS.filter((t) => !t.when || t.when()).map((t) => html`<a class="tab" href="#/vehicles/${v.id}?tab=${t.id}" ${t.id === tab ? html`aria-current="page"` : ''}>${t.label}</a>`)}</nav>
    <div id="tab-body">${loadingHtml()}</div>`);
  on(main, {
    archive: () => openModal({
      title: `Archive ${formatReg(v.registration)}?`, submitLabel: 'Archive vehicle', danger: true,
      body: html`<p>It will disappear from lists and tasks. Its records and history are kept.</p>`,
      onSubmit: async () => { await api.archiveVehicle(v.id); toast('Vehicle archived.'); navigate('#/vehicles'); },
    }),
  });
  const body = main.querySelector('#tab-body');
  try { await TAB_RENDER[tab](body, v); } catch (err) { console.error(err); mount(body, errorHtml(err.message)); }
}

const TAB_RENDER = {
  async overview(body, v) {
    const drivers = await api.listDrivers();
    const driver = drivers.find((d) => d.id === v.primary_driver_id);
    mount(body, html`<div class="cols">
      <section><h2>Vehicle</h2>${facts([
        ['Type', CATEGORY_LABEL[v.category]], ['Make and model', [v.make, v.model].filter(Boolean).join(' ')], ['Body', v.body_type], ['Colour', v.colour],
        ['VIN', v.vin], ['First registered', fmtDateShort(v.first_registered_date)], ['Year', v.year_of_manufacture], ['Fuel', FUEL_LABEL[v.fuel_type]],
        ['Gross weight', v.gross_weight_kg ? `${fmtInt(v.gross_weight_kg)} kg` : ''], ['Seats', v.seats], ['Fuel economy', v.mpg ? `${v.mpg} mpg` : ''], ['Fleet number', v.fleet_number]])}</section>
      <section><h2>Use and cost</h2>${facts([
        ['Primary driver', driver ? html`<a href="#/drivers/${driver.id}">${driverName(driver)}</a>` : 'Unassigned'],
        ['Latest mileage', v.latest_mileage != null ? `${fmtInt(v.latest_mileage)} miles on ${fmtDateShort(v.latest_reading_date)}` : 'None logged'],
        ['Running costs logged', Number(v.running_costs_total) ? fmtMoney(v.running_costs_total) : ''],
        ['Ownership', OWNERSHIP_LABEL[v.ownership_type]], ['Acquired', fmtDateShort(v.date_acquired)], ['Purchase price', fmtMoney(v.purchase_price)],
        ['Monthly payment', fmtMoney(v.monthly_payment)], ['Term', v.term_start || v.term_end ? `${fmtDateShort(v.term_start) || '?'} to ${fmtDateShort(v.term_end) || '?'}` : ''],
        ['Mileage cap', v.capped_miles ? `${fmtInt(v.capped_miles)} miles` : ''], ['Excess mileage', v.cost_per_excess_mile != null ? `${fmtMoney(v.cost_per_excess_mile)} per mile` : '']])}</section>
      ${v.notes ? html`<section class="span-all"><h2>Notes</h2><p class="prewrap">${v.notes}</p></section>` : ''}
    </div>`);
  },

  async compliance(body, v) {
    const ctx = { vehicles: new Map([[v.id, v]]), drivers: new Map() };
    const load = async () => (await api.listTasks()).filter((t) => t.vehicle_id === v.id);
    let tasks = await load();
    const byKey = (k) => tasks.find((t) => taskKey(t) === k);
    const draw = () => {
      if (!tasks.length) { mount(body, emptyHtml('Nothing tracked for this vehicle', 'Compliance items are created from the types switched on for your organisation.')); return; }
      mount(body, html`<table class="grid"><thead><tr><th>Item</th><th>Due</th><th>Status</th><th></th></tr></thead><tbody>${tasks.map((t) => html`<tr>
        <td data-label="Item"><button class="task-title" data-action="open" data-key="${taskKey(t)}">${t.type_name}</button>${t.is_statutory ? html` <span class="tag">Statutory</span>` : ''}</td>
        <td data-label="Due">${t.due_date ? html`${fmtDate(t.due_date)}<div class="sub">${dueText(t.days_remaining)}</div>` : html`<span class="muted">Not set</span>`}</td>
        <td data-label="Status">${pill(t.status)}</td>
        <td class="act">${can.write ? html`<button class="btn btn-sm" data-action="open" data-key="${taskKey(t)}">${t.due_date ? 'Manage' : 'Set date'}</button>` : ''}</td>
      </tr>`)}</tbody></table>`);
    };
    const refresh = async () => { tasks = await load(); draw(); };
    draw();
    on(body, { open: (el) => { const t = byKey(el.dataset.key); if (t) openTaskPanel(t, ctx, refresh); } });
  },

  async drivers(body, v) {
    const [assigns, drivers, licences] = await Promise.all([api.listAssignments({ vehicleId: v.id }), api.listDrivers(), api.currentLicences()]);
    const dById = new Map(drivers.map((d) => [d.id, d]));
    const licBy = new Map(licences.map((l) => [l.driver_id, l]));
    const draw = (rows) => mount(body, html`
      ${can.write ? html`<p><button class="btn btn-primary" data-action="assign">Assign driver</button></p>` : ''}
      ${rows.length ? html`<table class="grid"><thead><tr><th>Driver</th><th>Role</th><th>From</th><th>To</th><th></th></tr></thead><tbody>${rows.map((a) => html`<tr>
        <td data-label="Driver"><a href="#/drivers/${a.driver_id}">${driverName(dById.get(a.driver_id)) || 'Former driver'}</a>${a.override_reason ? html`<div class="sub">Licence override: ${a.override_reason}</div>` : ''}</td>
        <td data-label="Role">${a.assignment_type === 'primary' ? 'Primary' : 'Named'}</td>
        <td data-label="From">${fmtDateShort(a.start_date)}</td>
        <td data-label="To">${a.end_date ? fmtDateShort(a.end_date) : html`<strong>Current</strong>`}</td>
        <td class="act">${can.write && !a.end_date ? html`<button class="btn btn-sm" data-action="end" data-id="${a.id}">End</button>` : ''}</td></tr>`)}</tbody></table>`
        : emptyHtml('No drivers assigned', 'Assign a primary driver to see who is responsible for this vehicle.')}`);
    let rows = assigns;
    const reload = async () => { rows = await api.listAssignments({ vehicleId: v.id }); draw(rows); };
    draw(rows);
    on(body, {
      end: (el) => openModal({
        title: 'End assignment', submitLabel: 'End assignment',
        body: html`<p>Mark this driver as no longer assigned from today.</p>`,
        onSubmit: async () => { await api.endAssignment(el.dataset.id, todayStr()); toast('Assignment ended.'); await reload(); },
      }),
      assign: () => {
        const specs = [
          { name: 'driver_id', label: 'Driver', type: 'select', required: true, span: 2, options: drivers.filter((d) => d.employment_status === 'active').map((d) => [d.id, driverName(d)]) },
          { name: 'assignment_type', label: 'Role', type: 'select', required: true, options: [['primary', 'Primary driver'], ['named', 'Named driver']] },
          { name: 'start_date', label: 'From', type: 'date', required: true },
          { name: 'override_reason', label: 'Override reason', type: 'textarea', span: 2, hint: can.override ? 'Only needed if the driver\'s licence is expired, suspended, revoked or disqualified.' : 'A fleet admin or superuser must approve assigning a driver whose licence is not valid.' },
        ];
        const dlg = openModal({
          title: 'Assign driver', submitLabel: 'Assign driver',
          body: html`${fieldsHtml(specs, { assignment_type: 'primary', start_date: todayStr() })}<p class="warn" id="licence-warn" role="status" hidden></p>`,
          onSubmit: async (form) => {
            const val = readForm(form, specs);
            try { await api.addAssignment({ ...val, vehicle_id: v.id }); } catch (e) {
              if (e.code === '23505') throw new Error('This vehicle already has a primary driver, or that driver is already assigned. End the current assignment first.');
              throw e;
            }
            toast('Driver assigned.');
            await reload();
          },
        });
        dlg.querySelector('#f-driver_id').addEventListener('change', (e) => {
          const lic = licBy.get(e.target.value);
          const warn = dlg.querySelector('#licence-warn');
          const bad = lic && BLOCKING_LICENCE.includes(lic.status);
          warn.hidden = !bad;
          if (bad) warn.textContent = `Latest licence check: ${LICENCE_STATUS_LABEL[lic.status]}. Assigning this driver needs an override reason from a fleet admin or superuser.`;
        });
      },
    });
  },

  async readings(body, v) {
    let rows = await api.listReadings(v.id);
    const draw = () => mount(body, html`
      ${can.write ? html`<p><button class="btn btn-primary" data-action="add">Add reading</button></p>` : ''}
      ${rows.length ? html`<table class="grid"><thead><tr><th>Date</th><th class="num">Mileage</th><th>Source</th><th>Note</th></tr></thead><tbody>${rows.map((r) => html`<tr>
        <td data-label="Date">${fmtDate(r.reading_date)}</td><td data-label="Mileage" class="num">${fmtInt(r.mileage)}</td>
        <td data-label="Source">${r.source === 'manual' ? 'Entered by hand' : r.source}</td><td data-label="Note">${r.note || ''}</td></tr>`)}</tbody></table>`
        : emptyHtml('No readings yet', 'Log the odometer to track mileage over time.')}`);
    const reload = async () => { rows = await api.listReadings(v.id); draw(); };
    draw();
    on(body, {
      add: () => {
        const last = rows[0];
        const specs = [
          { name: 'reading_date', label: 'Date', type: 'date', required: true, max: todayStr() },
          { name: 'mileage', label: 'Odometer (miles)', type: 'number', required: true, min: '0', step: '1', inputmode: 'numeric' },
          { name: 'note', label: 'Note', type: 'text', span: 2 },
          { name: 'confirm_lower', label: 'This is correct even though it is lower than the last reading', type: 'checkbox', span: 2, hint: last ? `Last reading: ${fmtInt(last.mileage)} miles on ${fmtDateShort(last.reading_date)}. Tick for an odometer replacement or a correction.` : '' },
        ];
        openModal({
          title: 'Add odometer reading', submitLabel: 'Add reading',
          body: fieldsHtml(specs, { reading_date: todayStr() }),
          onSubmit: async (form) => {
            const val = readForm(form, specs);
            if (last && val.mileage < last.mileage && !val.confirm_lower) throw new Error(`That is lower than the last reading (${fmtInt(last.mileage)}). Check the figure, or tick the box to confirm it.`);
            await api.addReading({ vehicle_id: v.id, reading_date: val.reading_date, mileage: val.mileage, note: val.note });
            toast('Reading added.');
            await reload();
          },
        });
      },
    });
  },

  async history(body, v) {
    mount(body, html`<h2>Change history</h2>${historyList(await api.listAudit('vehicles', v.id))}`);
  },
};
