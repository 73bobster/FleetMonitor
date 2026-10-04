// Red / amber / green status: for each vehicle and driver, for the vehicle pool, the driver pool and the admin
// function, and overall. Every status carries its reasons, and a higher level takes the worst of what is beneath it.
//
// Everything here is worked out from data the screens already load, except the part of a driver's status that
// depends on the licence check result and penalty points. That part comes from the database (api.ragInputs), which
// hands back only the colour and a reason fit for the role that is asking.
//
// The rules, in one place:
//   Vehicle  red    a legal item overdue (MOT, annual test, tax, PMI, tacho and so on), or no insurance cover
//            amber  a due-soon item that needs a garage with no visit booked; any other item overdue (service,
//                   lease end date passed); late back from a garage; off the road with no SORN recorded yet
//            off    off the road with a SORN, disposed of or archived: not in service, so not rated
//   Driver   red    licence not valid at the last check, 12 or more points, or a driver item overdue (licence check, licence expiry)
//            amber  9 to 11 points, licence not found at the last check, a driver item due soon, or 2 or more accidents or damage in 12 months
//   Vehicle pool  red: short of the vehicles needed in the next 7 days. amber: short in days 8 to 28, at risk of
//                 being short in the next 7 days, or any vehicle red
//   Driver pool   red: a driver assigned to a vehicle is red. amber: any other driver red, or any driver amber
//   Admin    red    a legal task overdue, or any task more than 7 days overdue
//            amber  any task overdue, a due-soon item with no garage visit booked, or a vehicle with no mileage reading for 30 days
//   Overall  the worst of the vehicle pool, the driver pool and admin
import { html, fmtDateShort, fmtDayMonth, todayStr, addDaysISO, plural } from './ui.js';
import { BOOKABLE, CATEGORY_NOUN, availability, driverName } from './domain.js';
import { buildPlan } from './planner.js';

export const RAG_LABEL = { red: 'Red', amber: 'Amber', green: 'Green', off: 'Not rated' };
const ORDER = { red: 3, amber: 2, green: 1, off: 0 };
export const worstOf = (levels) => levels.reduce((w, l) => (ORDER[l] > ORDER[w] ? l : w), 'green');
const rag = (red, amber, green = 'Nothing needs attention') => (red.length ? { level: 'red', reasons: [...red, ...amber] } : amber.length ? { level: 'amber', reasons: amber } : { level: 'green', reasons: [green] });

const live = (t) => t.status !== 'dismissed';
const overdue = (t) => live(t) && t.due_date && t.days_remaining < 0;
const dueSoon = (t) => t.status === 'due_soon';
// an open garage visit of the right kind means the due date is being dealt with
const booked = (t, events) => events.some((e) => e.vehicle_id === t.vehicle_id && !e.cancelled_at && !e.returned_on && (BOOKABLE[t.type_code] || []).includes(e.reason));
const vehicleTasks = (v, tasks) => tasks.filter((t) => t.vehicle_id === v.id && t.applies_to === 'vehicle' && t.type_code !== 'SERVICE_BOOKING');

export function vehicleRag(v, tasks, events, today = todayStr()) {
  if (v.status === 'disposed') return { level: 'off', reasons: ['Disposed of'] };
  if (v.archived_at) return { level: 'off', reasons: ['Archived'] };
  const a = availability(v);
  if (a.key === 'sorn') return { level: 'off', reasons: ['Off the road (SORN)'] };
  const ts = vehicleTasks(v, tasks);
  const red = []; const amber = [];
  for (const t of ts) {
    if (t.type_code === 'VEHICLE_UNINSURED') { if (live(t)) red.push('No insurance cover'); continue; }
    if (t.type_code === 'VEHICLE_RETURN_OVERDUE') continue;   // late back is read from the vehicle itself, just below
    if (overdue(t)) (t.is_statutory ? red : amber).push(`${t.type_name} overdue since ${fmtDateShort(t.due_date)}`);
    else if (dueSoon(t) && BOOKABLE[t.type_code] && !booked(t, events)) amber.push(`${t.type_name} due ${fmtDateShort(t.due_date)}, nothing booked`);
  }
  if (a.key === 'garage' && v.unavailable_expected_return && v.unavailable_expected_return < today) amber.push(`Late back from the garage: was due ${fmtDateShort(v.unavailable_expected_return)}`);
  if (a.key === 'off_road_no_sorn' && !red.some((r) => /SORN/.test(r))) amber.push('Off the road with no SORN recorded');
  return rag(red, amber, 'Nothing overdue, and nothing due without a booking');
}

const driverTasks = (d, tasks) => tasks.filter((t) => t.driver_id === d.id && t.applies_to === 'driver' && t.source_type === 'compliance_item');

// fromDb is this driver's entry from api.ragInputs().drivers, if they have one: { level, reasons }.
export function driverRag(d, tasks, incidents, fromDb, today = todayStr()) {
  if (d.archived_at || d.employment_status !== 'active') return { level: 'off', reasons: ['Not a current driver'] };
  const red = []; const amber = [];
  if (fromDb?.level === 'red') red.push(...fromDb.reasons);
  if (fromDb?.level === 'amber') amber.push(...fromDb.reasons);
  for (const t of driverTasks(d, tasks)) {
    if (overdue(t)) red.push(`${t.type_name} overdue since ${fmtDateShort(t.due_date)}`);
    else if (dueSoon(t)) amber.push(`${t.type_name} due ${fmtDateShort(t.due_date)}`);
  }
  const yearAgo = addDaysISO(today, -365);
  const bumps = incidents.filter((i) => i.driver_id === d.id && ['accident', 'damage'].includes(i.kind) && i.incident_date >= yearAgo).length;
  if (bumps >= 2) amber.push(`${bumps} accidents or damage in the last 12 months`);
  return rag(red, amber);
}

const noun = (n, cat) => `${n} ${(CATEGORY_NOUN[cat] || CATEGORY_NOUN.other)[n === 1 ? 0 : 1]}`;

// Everything at once. ragInputs is the result of api.ragInputs(); needs is the Vehicles needed table.
export function buildRag({ vehicles, drivers, tasks, events, incidents, needs = [], ragInputs = {}, today = todayStr() }) {
  const liveEvents = events.filter((e) => !e.cancelled_at);
  const dbBy = new Map((ragInputs?.drivers || []).map((x) => [x.driver_id, x]));
  const vehicleMap = new Map(vehicles.map((v) => [v.id, vehicleRag(v, tasks, liveEvents, today)]));
  const driverMap = new Map(drivers.map((d) => [d.id, driverRag(d, tasks, incidents, dbBy.get(d.id), today)]));
  const count = (map, level) => [...map.values()].filter((r) => r.level === level).length;

  // ---- vehicle pool: are there enough vehicles, and are the ones we have in order ----
  const plan = buildPlan({ vehicles, events: liveEvents, tasks, needs, from: today, days: 28, today });
  const week = addDaysISO(today, 6);
  const shortRun = (r) => `${noun(r.worst, r.category)} short ${r.from === r.to ? `on ${fmtDayMonth(r.from, true)}` : `from ${fmtDayMonth(r.from, true)}`}`;
  const vpRed = plan.shortfalls.filter((r) => r.from <= week).map(shortRun);
  const vpAmber = [
    ...plan.shortfalls.filter((r) => r.from > week).map(shortRun),
    ...plan.risks.filter((r) => r.from <= week).map((r) => `May be ${noun(r.worst, r.category)} short ${r.from === r.to ? `on ${fmtDayMonth(r.from, true)}` : `from ${fmtDayMonth(r.from, true)}`} if at-risk vehicles are out`),
  ];
  if (count(vehicleMap, 'red')) vpAmber.push(`${plural(count(vehicleMap, 'red'), 'vehicle')} red`);
  const vehiclePool = rag(vpRed, vpAmber, plan.hasNeeds ? 'Enough vehicles for the next 4 weeks, and none red' : 'No vehicle is red. Set the vehicles needed in Settings to check for shortfalls');

  // ---- driver pool ----
  const assigned = new Set(vehicles.filter((v) => v.status !== 'disposed' && !v.archived_at).map((v) => v.primary_driver_id).filter(Boolean));
  const redDrivers = drivers.filter((d) => driverMap.get(d.id).level === 'red');
  const redAssigned = redDrivers.filter((d) => assigned.has(d.id)); const redOther = redDrivers.filter((d) => !assigned.has(d.id));
  const dpRed = redAssigned.length ? [`${plural(redAssigned.length, 'driver')} assigned to a vehicle ${redAssigned.length === 1 ? 'is' : 'are'} red: ${redAssigned.map(driverName).join(', ')}`] : [];
  const dpAmber = [];
  if (redOther.length) dpAmber.push(`${plural(redOther.length, 'driver')} red: ${redOther.map(driverName).join(', ')}`);
  if (count(driverMap, 'amber')) dpAmber.push(`${plural(count(driverMap, 'amber'), 'driver')} amber`);
  const driverPool = rag(dpRed, dpAmber, 'No driver is red or amber');

  // ---- admin: is everything being kept on top of ----
  const open = tasks.filter((t) => t.status !== 'dismissed' && t.status !== 'snoozed');
  const hidden = ragInputs?.hidden_tasks || { overdue: 0, overdue_legal: 0, overdue_over_7: 0, due_soon: 0 };
  const late = open.filter(overdue);
  const legalLate = late.filter((t) => t.is_statutory).length + hidden.overdue_legal;
  const veryLate = late.filter((t) => t.days_remaining < -7).length + hidden.overdue_over_7;
  const anyLate = late.length + hidden.overdue;
  const unbooked = open.filter((t) => dueSoon(t) && t.applies_to === 'vehicle' && BOOKABLE[t.type_code] && vehicleMap.get(t.vehicle_id)?.level !== 'off' && !booked(t, liveEvents)).length;
  const monthAgo = addDaysISO(today, -30);
  const noMiles = vehicles.filter((v) => vehicleMap.get(v.id).level !== 'off' && (!v.latest_reading_date || v.latest_reading_date < monthAgo)).length;
  const adRed = []; const adAmber = [];
  if (legalLate) adRed.push(`${plural(legalLate, 'legal task')} overdue`);
  if (veryLate) adRed.push(`${plural(veryLate, 'task')} more than 7 days overdue`);
  if (anyLate && !adRed.length) adAmber.push(`${plural(anyLate, 'task')} overdue`);
  if (unbooked) adAmber.push(`${plural(unbooked, 'item')} due soon with no garage visit booked`);
  if (noMiles) adAmber.push(`${plural(noMiles, 'vehicle')} with no mileage reading in 30 days`);
  const admin = rag(adRed, adAmber, 'Nothing overdue, and everything due soon is booked');

  const parts = [['Vehicle pool', vehiclePool], ['Driver pool', driverPool], ['Admin', admin]];
  const level = worstOf(parts.map(([, r]) => r.level));
  const overall = { level, reasons: [level === 'green' ? 'Vehicles, drivers and admin are all green' : parts.filter(([, r]) => r.level !== 'green').map(([n, r]) => `${n} ${RAG_LABEL[r.level].toLowerCase()}`).join(', ')] };
  return { vehicles: vehicleMap, drivers: driverMap, vehiclePool, driverPool, admin, overall, counts: { vehicles: { red: count(vehicleMap, 'red'), amber: count(vehicleMap, 'amber') }, drivers: { red: count(driverMap, 'red'), amber: count(driverMap, 'amber') } } };
}

// ---- Drawing ---------------------------------------------------------------------------------
const tip = (r) => `${RAG_LABEL[r.level]}: ${r.reasons.join('. ')}`;
// The small coloured dot beside a plate or a name. The reason is in its tooltip and is read out by screen readers.
export const ragDot = (r) => (r ? html`<span class="rag rag-${r.level}" role="img" aria-label="${tip(r)}" title="${tip(r)}"></span>` : '');
// The colour, its name and its reasons written out, for the top of a vehicle or driver screen.
export const ragLine = (r) => (r ? html`<span class="rag rag-${r.level}" aria-hidden="true"></span> <strong class="rag-word rag-word-${r.level}">${RAG_LABEL[r.level]}</strong><span class="rag-why">: ${r.reasons.slice(0, 3).join('. ')}${r.reasons.length > 3 ? ` (and ${r.reasons.length - 3} more)` : ''}</span>` : '');
// One of the four tiles at the top of the dashboard.
export const ragTile = (label, r, href) => html`<a class="rag-tile rag-tile-${r.level}" href="${href}"><span class="rag-tile-label">${label}</span><span class="rag-tile-level"><span class="rag rag-${r.level}" aria-hidden="true"></span>${RAG_LABEL[r.level]}</span><span class="rag-tile-why">${r.reasons[0]}${r.reasons.length > 1 ? html` <span class="muted">and ${r.reasons.length - 1} more</span>` : ''}</span></a>`;
