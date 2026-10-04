// Costs: total cost of ownership for every vehicle (in the fleet or gone), a month-by-month breakdown for one
// vehicle, and the monthly fuel prices the fuel sums depend on. The sums themselves are in tco.js.
import * as api from './api.js';
import { state, can } from './state.js';
import { html, mount, on, plate, loadingHtml, emptyHtml, openModal, fieldsHtml, readForm, toast, fmtMoney, fmtInt, fmtDateShort, fmtMonth, todayStr, formatReg, parseISO, toISO } from './ui.js';
import { COST_CATEGORY_LABEL, vehicleTitle } from './domain.js';
import { buildTco, CAPTURED, DEFAULT_TYPICAL_MPG, DEFAULT_MILES_PER_KWH } from './tco.js';
import { downloadExcel, downloadPdf } from './exports.js';

// ---- The period -------------------------------------------------------------------------------
const KEY = 'fm:costs';
const PRESETS = [['last12', 'Last 12 months'], ['thisYear', 'This year'], ['lastYear', 'Last year'], ['life', 'Whole life']];
function presetRange(key, earliest, today = todayStr()) {
  const y = Number(today.slice(0, 4));
  if (key === 'thisYear') return { from: `${y}-01-01`, to: today };
  if (key === 'lastYear') return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
  if (key === 'life') return { from: earliest || `${y}-01-01`, to: today };
  const d = parseISO(`${today.slice(0, 7)}-01`); d.setMonth(d.getMonth() - 11);
  return { from: toISO(d), to: today };
}
function loadPeriod(earliest) {
  try { const p = JSON.parse(sessionStorage.getItem(KEY)); if (p?.preset === 'custom' && p.from && p.to) return p; if (PRESETS.some(([k]) => k === p?.preset)) return { preset: p.preset, ...presetRange(p.preset, earliest) }; } catch { /* use the default */ }
  return { preset: 'last12', ...presetRange('last12', earliest) };
}
const savePeriod = (p) => { try { sessionStorage.setItem(KEY, JSON.stringify(p)); } catch { /* not remembered */ } };
const periodHtml = (p) => html`<div class="period" role="group" aria-label="Period">
  <div class="field inline-field"><label for="c-preset">Period</label><select id="c-preset">${PRESETS.map(([k, l]) => html`<option value="${k}" ${p.preset === k ? 'selected' : ''}>${l}</option>`)}<option value="custom" ${p.preset === 'custom' ? 'selected' : ''}>Custom dates</option></select></div>
  <div class="field inline-field"><label for="c-from">From</label><input type="date" id="c-from" value="${p.from}" max="${p.to}"></div>
  <div class="field inline-field"><label for="c-to">To</label><input type="date" id="c-to" value="${p.to}" min="${p.from}"></div>
</div>`;
function wirePeriod(root, p, earliest, onChange) {
  const apply = (next) => { Object.assign(p, next); savePeriod(p); onChange(); };
  root.querySelector('#c-preset').addEventListener('change', (e) => { if (e.target.value !== 'custom') apply({ preset: e.target.value, ...presetRange(e.target.value, earliest) }); else apply({ preset: 'custom' }); });
  root.querySelector('#c-from').addEventListener('change', (e) => { if (e.target.value && e.target.value <= p.to) apply({ preset: 'custom', from: e.target.value }); });
  root.querySelector('#c-to').addEventListener('change', (e) => { if (e.target.value && e.target.value >= p.from) apply({ preset: 'custom', to: e.target.value }); });
}

// Everything the sums need, read once for the screen.
async function loadAll() {
  const [vehicles, periods, costs, readings, fuelPrices, policies, policyVehicles, incidents] = await Promise.all([
    api.listVehicles(), api.listVehiclePeriods(), api.listAllCosts(), api.listAllReadings(), api.listFuelPrices(), api.listPolicies(), api.listAllPolicyVehicles(), api.listIncidents(),
  ]);
  const earliest = [...periods.map((x) => x.start_date), ...vehicles.map((v) => v.date_acquired)].filter(Boolean).sort()[0] || null;
  return { vehicles: vehicles.filter((v) => !v.archived_at), periods, costs, readings, fuelPrices, policies, policyVehicles, incidents, earliest };
}
const tcoFor = (d, p, vehicles = d.vehicles) => buildTco({ ...d, vehicles, settings: state.org.settings || {}, from: p.from, to: p.to });
const note = (r, n) => n.replace('{lastReading}', fmtDateShort(r.lastReading));
const statusText = (v) => (v.status === 'disposed' ? `Left ${fmtDateShort(v.disposed_date)}` : 'In the fleet');
const BASIS = { entered: 'Entered as costs', calculated: 'Calculated', mixed: 'Entered for some months, calculated for the rest' };
const COLUMNS = [
  { key: 'vehicle', label: 'Vehicle', type: 'text', width: 10 }, { key: 'model', label: 'Make and model', type: 'text', width: 16 }, { key: 'status', label: 'Status', type: 'text', width: 13 },
  { key: 'miles', label: 'Miles', type: 'int', width: 8 }, { key: 'captured', label: 'Captured costs', type: 'money', width: 11 }, { key: 'fuel', label: 'Fuel', type: 'money', width: 10 },
  { key: 'insurance', label: 'Insurance', type: 'money', width: 10 }, { key: 'finance', label: 'Lease or finance', type: 'money', width: 11 }, { key: 'accident', label: 'Accidents and damage', type: 'money', width: 10 },
  { key: 'fines', label: 'Fines', type: 'money', width: 8 }, { key: 'loss', label: 'Loss in value', type: 'money', width: 11 }, { key: 'total', label: 'Total', type: 'money', width: 12 }, { key: 'per_mile', label: 'Per mile', type: 'money', width: 8 },
];
const SCREEN_COLUMNS = COLUMNS.filter((c) => c.key !== 'model' && c.key !== 'status');
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const tabsHtml = (tab) => html`<nav class="tabs" aria-label="Costs"><a class="tab" href="#/costs" ${tab === 'vehicles' ? html`aria-current="page"` : ''}>Total cost of ownership</a><a class="tab" href="#/costs?tab=fuel" ${tab === 'fuel' ? html`aria-current="page"` : ''}>Fuel prices</a></nav>`;

// ---- All vehicles -----------------------------------------------------------------------------
export async function costsView(main, query = {}) {
  if (query.tab === 'fuel') return fuelPricesView(main);
  mount(main, html`<header class="page-head"><h1>Costs</h1></header>${loadingHtml('Working out the costs')}`);
  const d = await loadAll();
  const p = loadPeriod(d.earliest);
  const ui = { gone: true, sort: 'total' };

  function draw() {
    const t = tcoFor(d, p);
    const rows = t.rows.filter((r) => r.active && (ui.gone || r.v.status !== 'disposed'))
      .sort((a, b) => (ui.sort === 'total' ? b.total - a.total : 0) || String(a.v.registration).localeCompare(String(b.v.registration)));
    const tot = (k) => rows.reduce((s, r) => s + r[k], 0);
    const miles = tot('miles');
    const model = {
      title: 'Total cost of ownership', subtitle: `${fmtDateShort(p.from)} to ${fmtDateShort(p.to)}. Captured costs are tyres, servicing, repairs, tax and other costs entered. Fuel, insurance, finance, accidents, fines and loss in value are worked out from other records.`,
      columns: COLUMNS,
      rows: rows.map((r) => ({ vehicle_id: r.v.id, vehicle: r.v.registration, model: vehicleTitle(r.v), status: statusText(r.v), miles: Math.round(r.miles), captured: r.captured, fuel: r.fuel, insurance: r.insurance, finance: r.finance, accident: r.accident, fines: r.fines, loss: r.lossKnown ? r.loss : null, total: r.total, per_mile: r.perMile })),
      totals: { vehicle: `Total (${rows.length})`, miles: Math.round(miles), captured: tot('captured'), fuel: tot('fuel'), insurance: tot('insurance'), finance: tot('finance'), accident: tot('accident'), fines: tot('fines'), loss: tot('loss'), total: tot('total'), per_mile: miles > 0 ? tot('total') / miles : null },
    };
    const cell = (c, r, raw) => {
      if (c.key === 'vehicle') return html`<a class="plate-link" href="#/costs/${r.v.id}">${plate(r.v.registration, r.v.category)}</a>`;
      if (c.key === 'loss' && !r.lossKnown) return html`<span class="muted">Not yet known</span>`;
      if (c.key === 'miles') return raw ? fmtInt(raw) : html`<span class="muted">0</span>`;
      if (c.type === 'money') return raw === null || raw === undefined ? '' : raw ? fmtMoney(raw) : html`<span class="muted">${fmtMoney(0)}</span>`;
      return raw;
    };
    const flagged = rows.filter((r) => r.notes.length).length;
    mount(main, html`
      <header class="page-head"><h1>Costs</h1></header>
      ${tabsHtml('vehicles')}
      ${periodHtml(p)}
      <p class="muted period-note">What each vehicle cost between <strong>${fmtDateShort(p.from)}</strong> and <strong>${fmtDateShort(p.to)}</strong>: the costs entered against it, plus fuel, insurance, finance, accidents, fines and loss in value worked out from its other records.</p>
      <div class="filters">
        <label class="check small"><input type="checkbox" id="c-gone" ${ui.gone ? 'checked' : ''}> <span>Include vehicles no longer in the fleet</span></label>
        <label class="inline"><span class="sr-only">Order</span><select id="c-sort"><option value="total" ${ui.sort === 'total' ? 'selected' : ''}>Highest total first</option><option value="reg" ${ui.sort === 'reg' ? 'selected' : ''}>By registration</option></select></label>
      </div>
      <div class="figures small">
        <div class="figure"><span class="figure-value">${fmtMoney(tot('total'))}</span><span class="figure-label">Total cost</span><span class="figure-sub">${rows.length} vehicles</span></div>
        <div class="figure"><span class="figure-value">${fmtMoney(tot('captured'))}</span><span class="figure-label">Captured</span><span class="figure-sub">Tyres, servicing, repairs, tax, other</span></div>
        <div class="figure"><span class="figure-value">${fmtMoney(tot('total') - tot('captured'))}</span><span class="figure-label">Calculated</span><span class="figure-sub">Fuel, insurance, finance and the rest</span></div>
        <div class="figure"><span class="figure-value">${miles > 0 ? fmtMoney(tot('total') / miles) : 'No miles'}</span><span class="figure-label">Per mile</span><span class="figure-sub">${fmtInt(Math.round(miles))} miles</span></div>
      </div>
      <div class="report-actions"><button class="btn btn-primary" data-action="excel">Download Excel</button><button class="btn" data-action="pdf">Download PDF</button></div>
      ${rows.length ? html`<div class="scroll"><table class="grid keep report tco"><thead><tr>${SCREEN_COLUMNS.map((c) => html`<th class="${c.type === 'text' ? '' : 'num'}">${c.label}</th>`)}</tr></thead><tbody>
        ${rows.map((r, i) => html`<tr>${SCREEN_COLUMNS.map((c) => html`<td class="${c.type === 'text' ? '' : 'num'} ${c.key === 'total' ? 'strong' : ''}">${cell(c, r, model.rows[i][c.key])}${c.key === 'vehicle' ? html`<div class="sub">${vehicleTitle(r.v)}${r.v.status === 'disposed' ? html` <span class="tag">${statusText(r.v)}</span>` : ''}</div>` : ''}${c.key === 'total' && r.notes.length ? html`<span class="tco-flag" title="${r.notes.map((n) => note(r, n)).join('. ')}">*</span>` : ''}</td>`)}</tr>`)}
      </tbody><tfoot><tr>${SCREEN_COLUMNS.map((c) => html`<td class="${c.type === 'text' ? '' : 'num'} totals">${c.key === 'vehicle' ? model.totals.vehicle : c.key === 'miles' ? fmtInt(model.totals.miles) : model.totals[c.key] === null ? '' : fmtMoney(model.totals[c.key])}</td>`)}</tr></tfoot></table></div>
      ${flagged ? html`<p class="hint">* ${flagged === 1 ? 'One vehicle has' : `${flagged} vehicles have`} a figure that rests on an assumption or is incomplete. Open the vehicle to see what and why.</p>` : ''}`
        : emptyHtml('Nothing to show', 'No vehicle was in the fleet or had costs in this period. Try a longer period.')}`);
    wirePeriod(main, p, d.earliest, draw);
    main.querySelector('#c-gone').addEventListener('change', (e) => { ui.gone = e.target.checked; draw(); });
    main.querySelector('#c-sort').addEventListener('change', (e) => { ui.sort = e.target.value; draw(); });
    on(main, {
      excel: () => { downloadExcel(model, `total-cost-of-ownership-${p.from}-to-${p.to}`); toast('Excel file downloaded.'); },
      pdf: () => { downloadPdf(model, `total-cost-of-ownership-${p.from}-to-${p.to}`); toast('PDF downloaded.'); },
    });
  }
  draw();
}

// ---- One vehicle, month by month --------------------------------------------------------------
const MONTH_COLUMNS = [
  { key: 'month', label: 'Month', type: 'text', width: 9 }, { key: 'miles', label: 'Miles', type: 'int', width: 8 }, { key: 'captured', label: 'Captured costs', type: 'money', width: 11 }, { key: 'fuel', label: 'Fuel', type: 'money', width: 10 },
  { key: 'insurance', label: 'Insurance', type: 'money', width: 10 }, { key: 'finance', label: 'Lease or finance', type: 'money', width: 11 }, { key: 'accident', label: 'Accidents and damage', type: 'money', width: 10 },
  { key: 'fines', label: 'Fines', type: 'money', width: 8 }, { key: 'loss', label: 'Loss in value', type: 'money', width: 11 }, { key: 'total', label: 'Total', type: 'money', width: 12 },
];
export async function costDetailView(main, { id }) {
  mount(main, html`<header class="page-head"><h1>Costs</h1></header>${loadingHtml('Working out the costs')}`);
  const d = await loadAll();
  const v = d.vehicles.find((x) => x.id === id);
  if (!v) { mount(main, emptyHtml('Vehicle not found', '', html`<p><a class="btn" href="#/costs">Back to costs</a></p>`)); return; }
  const mine = d.periods.filter((x) => x.vehicle_id === v.id).map((x) => x.start_date).filter(Boolean).sort()[0] || v.date_acquired || d.earliest;
  const p = loadPeriod(mine);
  if (p.preset === 'life') Object.assign(p, presetRange('life', mine));

  function draw() {
    const r = tcoFor(d, p, [v]).rows[0];
    const months = r.months.filter((m) => m.total || m.miles);
    const lines = [
      ...CAPTURED.map((k) => [COST_CATEGORY_LABEL[k] || k, r[k], 'Entered as costs']),
      ['Fuel', r.fuel, BASIS[r.basis.fuel] || 'Nothing to count'], ['Insurance', r.insurance, BASIS[r.basis.insurance] || 'Not on a policy in this period'],
      ['Lease, rental or finance', r.finance, BASIS[r.basis.finance] || (v.ownership_type === 'owned' ? 'Owned outright' : 'No payments in this period')],
      ['Accidents and damage', r.accident, BASIS[r.basis.accident] || 'None in this period'], ['Fines', r.fines, r.fines ? 'From the incident register' : 'None in this period'],
      ['Loss in value', r.lossKnown ? r.loss : null, v.ownership_type !== 'owned' ? 'Not owned outright, so its payments are counted instead' : r.lossKnown ? (r.loss ? 'Purchase price less sale price' : 'Did not leave the fleet in this period') : 'Not known until it is sold'],
    ];
    const model = {
      title: `Total cost of ownership: ${formatReg(v.registration)}`, subtitle: `${vehicleTitle(v)}. ${fmtDateShort(p.from)} to ${fmtDateShort(p.to)}. Total ${fmtMoney(r.total)}${r.perMile ? `, ${fmtMoney(r.perMile)} a mile over ${fmtInt(Math.round(r.miles))} miles` : ''}.`,
      columns: MONTH_COLUMNS,
      rows: months.map((m) => ({ month: fmtMonth(m.month), miles: Math.round(m.miles), captured: m.captured, fuel: m.fuel, insurance: m.insurance, finance: m.finance, accident: m.accident, fines: m.fines, loss: m.loss, total: m.total })),
      totals: { month: 'Total', miles: Math.round(r.miles), captured: r.captured, fuel: r.fuel, insurance: r.insurance, finance: r.finance, accident: r.accident, fines: r.fines, loss: r.loss, total: r.total },
    };
    const money = (x) => (x ? fmtMoney(x) : html`<span class="muted">${fmtMoney(0)}</span>`);
    mount(main, html`
      <header class="page-head head-vehicle">
        <div><p class="crumb"><a href="#/costs">Costs</a></p><h1>${plate(v.registration, v.category)}</h1><p class="sub">${vehicleTitle(v)} <span class="tag">${statusText(v)}</span> <a href="#/vehicles/${v.id}?tab=costs">Open the vehicle</a></p></div>
      </header>
      ${periodHtml(p)}
      <div class="figures small">
        <div class="figure"><span class="figure-value">${fmtMoney(r.total)}</span><span class="figure-label">Total cost</span><span class="figure-sub">${fmtDateShort(p.from)} to ${fmtDateShort(p.to)}</span></div>
        <div class="figure"><span class="figure-value">${r.perMile ? fmtMoney(r.perMile) : 'No miles'}</span><span class="figure-label">Per mile</span><span class="figure-sub">${fmtInt(Math.round(r.miles))} miles</span></div>
        <div class="figure"><span class="figure-value">${fmtMoney(r.daysInFleet ? (r.total / r.daysInFleet) * 30.44 : 0)}</span><span class="figure-label">Per month in the fleet</span><span class="figure-sub">${fmtInt(r.daysInFleet)} days in the fleet</span></div>
        <div class="figure"><span class="figure-value">${fmtMoney(r.captured)}</span><span class="figure-label">Captured</span><span class="figure-sub">${fmtMoney(r.total - r.captured)} calculated</span></div>
      </div>
      ${r.notes.length ? html`<div class="banner-info"><strong>How to read these figures</strong><ul class="tco-notes">${r.notes.map((n) => html`<li>${note(r, n)}.</li>`)}</ul></div>` : ''}
      <div class="dash-grid">
        <section class="dash-panel"><h2>Where the money went</h2>
          <table class="mini tco-lines"><tbody>
            ${lines.map(([label, amount, how]) => html`<tr><th>${label}<div class="sub">${how}</div></th><td class="num">${amount === null ? html`<span class="muted">Not yet known</span>` : money(amount)}</td><td class="num pct">${amount && r.total ? `${Math.round((amount / r.total) * 100)}%` : ''}</td></tr>`)}
            <tr class="total"><th>Total</th><td class="num">${fmtMoney(r.total)}</td><td></td></tr>
          </tbody></table>
        </section>
        <section class="dash-panel"><h2>How fuel is worked out</h2>
          <p>Miles each month are read off the mileage readings, spreading the miles evenly between one reading and the next. Fuel is then miles, divided by ${v.fuel_type === 'electric' ? 'miles per kWh' : 'miles per gallon'}, times that month's price.</p>
          <p>Where fuel has been entered as a cost for a month, that figure is used instead. The same goes for insurance, lease payments and accident costs, so nothing is counted twice.</p>
          <p><a href="#/costs?tab=fuel">Fuel prices</a> · <a href="#/vehicles/${v.id}?tab=readings">Mileage readings</a></p>
        </section>
      </div>
      <div class="section-head"><h2>Month by month</h2><div class="report-actions"><button class="btn btn-primary" data-action="excel">Download Excel</button><button class="btn" data-action="pdf">Download PDF</button></div></div>
      ${months.length ? html`<div class="scroll"><table class="grid keep report tco"><thead><tr>${MONTH_COLUMNS.map((c) => html`<th class="${c.type === 'text' ? '' : 'num'}">${c.label}</th>`)}</tr></thead><tbody>
        ${model.rows.map((m) => html`<tr>${MONTH_COLUMNS.map((c) => html`<td class="${c.type === 'text' ? '' : 'num'} ${c.key === 'total' ? 'strong' : ''}">${c.key === 'month' ? m.month : c.key === 'miles' ? fmtInt(m.miles) : money(m[c.key])}</td>`)}</tr>`)}
      </tbody><tfoot><tr>${MONTH_COLUMNS.map((c) => html`<td class="${c.type === 'text' ? '' : 'num'} totals">${c.key === 'month' ? 'Total' : c.key === 'miles' ? fmtInt(model.totals.miles) : fmtMoney(model.totals[c.key])}</td>`)}</tr></tfoot></table></div>`
        : emptyHtml('Nothing in this period', 'This vehicle had no costs and no miles in this period. Try a longer period.')}`);
    wirePeriod(main, p, mine, draw);
    on(main, {
      excel: () => { downloadExcel(model, `${slug(v.registration)}-cost-of-ownership-${p.from}-to-${p.to}`); toast('Excel file downloaded.'); },
      pdf: () => { downloadPdf(model, `${slug(v.registration)}-cost-of-ownership-${p.from}-to-${p.to}`); toast('PDF downloaded.'); },
    });
  }
  draw();
}

// ---- Fuel prices ------------------------------------------------------------------------------
const FUELS = [['petrol', 'Petrol', 'pence per litre'], ['diesel', 'Diesel', 'pence per litre'], ['electric', 'Electric', 'pence per kWh']];
async function fuelPricesView(main) {
  mount(main, html`<header class="page-head"><h1>Costs</h1></header>${tabsHtml('fuel')}${loadingHtml('Loading fuel prices')}`);
  let prices = await api.listFuelPrices();
  let showAll = false;
  const today = todayStr();
  const thisMonth = `${today.slice(0, 7)}-01`;
  const lastMonth = (() => { const x = parseISO(thisMonth); x.setMonth(x.getMonth() - 1); return toISO(x); })();
  const settings = state.org.settings || {};
  const mpg = { ...DEFAULT_TYPICAL_MPG, ...(settings.typical_mpg || {}) };

  function draw() {
    const byMonth = new Map();
    for (const x of prices) { if (!byMonth.has(x.month)) byMonth.set(x.month, {}); byMonth.get(x.month)[x.fuel_type] = x; }
    const months = [...byMonth.keys()].sort().reverse();
    const shown = showAll ? months : months.slice(0, 24);
    const missing = ['petrol', 'diesel'].filter((f) => !byMonth.get(lastMonth)?.[f]);
    const cellFor = (m, f) => { const x = byMonth.get(m)?.[f]; return x ? html`${Number(x.price).toFixed(1)}p${x.source === 'uk_average' ? html` <span class="tag">UK average</span>` : ''}` : html`<span class="muted">Not entered</span>`; };
    mount(main, html`
      <header class="page-head"><h1>Costs</h1></header>
      ${tabsHtml('fuel')}
      <div class="section-head"><h2>Fuel prices by month</h2>${can.write ? html`<button class="btn btn-primary" data-action="add">Add or change a month</button>` : ''}</div>
      <p class="muted">The price used to work out each vehicle's fuel cost: pence per litre for petrol and diesel, pence per kWh for electric. Enter what you actually paid on average each month. Months marked "UK average" hold the national average pump price as a starting point: replace them with your own figure when you have it.</p>
      ${missing.length ? html`<p class="banner-warn">No ${missing.join(' or ')} price has been entered for ${fmtMonth(lastMonth, true)} yet. Until it is, the latest earlier price is used for that month.</p>` : ''}
      ${months.length ? html`<table class="grid keep compact fuel-table"><thead><tr><th>Month</th>${FUELS.map(([, l, u]) => html`<th class="num">${l}<div class="sub">${u}</div></th>`)}${can.write ? html`<th></th>` : ''}</tr></thead><tbody>
        ${shown.map((m) => html`<tr><td>${fmtMonth(m, true)}</td>${FUELS.map(([f]) => html`<td class="num">${cellFor(m, f)}</td>`)}${can.write ? html`<td class="act"><button class="btn btn-sm" data-action="edit" data-month="${m}">Change</button></td>` : ''}</tr>`)}
      </tbody></table>
      ${months.length > 24 ? html`<p><button class="btn" data-action="toggle">${showAll ? 'Show the last 24 months only' : `Show all ${months.length} months`}</button></p>` : ''}` : emptyHtml('No fuel prices yet', 'Add a month to start working out fuel costs.')}
      <section class="dash-panel fuel-assumptions"><h2>Fuel economy used when a vehicle has no figure of its own</h2>
        <p>${Object.entries(mpg).filter(([, x]) => x).map(([k, x]) => `${k === 'light_goods' ? 'Light goods' : k === 'hgv' ? 'HGV' : k[0].toUpperCase() + k.slice(1)} ${x} mpg`).join(', ')}. Electric ${Number(settings.typical_miles_per_kwh) > 0 ? settings.typical_miles_per_kwh : DEFAULT_MILES_PER_KWH} miles per kWh.</p>
        <p class="muted">These are typical figures, not measurements. A vehicle's own figure, entered on its record, is always used first. ${can.configure ? html`<a href="#/settings">Change the typical figures in Settings</a>.` : 'The superuser can change the typical figures in Settings.'}</p>
      </section>`);
  }
  const open = (month) => {
    const cur = {}; for (const x of prices) if (x.month === month) cur[x.fuel_type] = x;
    const specs = [
      { name: 'month', label: 'Month', type: 'month', required: true, span: 2, value: (month || lastMonth).slice(0, 7), max: thisMonth.slice(0, 7) },
      ...FUELS.map(([f, l, u]) => ({ name: f, label: `${l} (${u})`, type: 'number', min: '0', step: '0.1', inputmode: 'decimal', value: cur[f] ? Number(cur[f].price) : '' })),
    ];
    openModal({
      title: month ? `Fuel prices for ${fmtMonth(month, true)}` : 'Add or change a month', submitLabel: 'Save prices',
      body: html`${fieldsHtml(specs)}<p class="hint">Leave a box empty to keep it as it is. Prices are in pence, for example 152.9.</p>`,
      onSubmit: async (f) => {
        const x = readForm(f, specs);
        if (!/^\d{4}-\d{2}$/.test(x.month || '')) throw new Error('Choose the month.');
        if (x.month > thisMonth.slice(0, 7)) throw new Error('That month has not happened yet.');
        const entered = FUELS.map(([k]) => [k, x[k]]).filter(([, val]) => val !== null && val !== undefined && val !== '');
        if (!entered.length) throw new Error('Enter at least one price.');
        for (const [k, val] of entered) if (!(Number(val) > 0 && Number(val) < 1000)) throw new Error(`The ${k} price should be in pence, between 0 and 1,000.`);
        for (const [k, val] of entered) await api.saveFuelPrice({ month: `${x.month}-01`, fuel_type: k, price: Number(val) });
        toast('Fuel prices saved.'); prices = await api.listFuelPrices(); draw();
      },
    });
  };
  draw();
  on(main, { add: () => open(null), edit: (el) => open(el.dataset.month), toggle: () => { showAll = !showAll; draw(); } });
}
