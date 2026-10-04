// Planner: looks ahead. Vehicles down the side, days across, with garage visits, SORN, lease ends and due dates,
// and for each vehicle type the number available against the number needed that day (Settings, Vehicles needed).
// The sums are in buildPlan, a pure function, so they can be tested on their own.
import * as api from './api.js';
import { can } from './state.js';
import { html, mount, plate, formatReg, loadingHtml, fmtDate, fmtDateShort, fmtDayMonth, fmtMonth, todayStr, addDaysISO, parseISO } from './ui.js';
import { CATEGORY_LABEL, UNAVAIL_REASON_LABEL, WEEKDAYS, CATEGORY_PLURAL, CATEGORY_NOUN } from './domain.js';

// Short labels for the blocks in the grid.
const REASON_CODE = { servicing: 'Svc', mot: 'MOT', tyres: 'Tyr', repair: 'Rep', accident_repair: 'Body', breakdown: 'Bkdn', tacho: 'Tach', tail_lift: 'Lift', other_garage: 'Gar', off_road: 'SORN' };
// Due dates that need the vehicle at a garage, and the kind of visit that deals with each.
const BOOKABLE = { SERVICE: ['servicing'], MOT: ['mot'], ANNUAL_TEST: ['mot'], PMI: ['servicing', 'other_garage'], TACHO_CALIBRATION: ['tacho'], TAIL_LIFT_LOLER: ['tail_lift'] };
// Of those, the ones a vehicle should not be used without. Once the date passes with nothing booked the vehicle is "at risk".
const RISK_CODES = ['MOT', 'ANNUAL_TEST', 'PMI', 'TACHO_CALIBRATION'];
const TERM_WORD = { leased: 'Lease', hired: 'Rental', financed: 'Finance' };

const dowOf = (day) => (parseISO(day).getDay() + 6) % 7;   // Monday is 0
const noun = (n, cat) => `${n} ${(CATEGORY_NOUN[cat] || CATEGORY_NOUN.other)[n === 1 ? 0 : 1]}`;

// What one out-of-service record means for one day: 'out', 'risk' (it may still be out) or null.
// A finished visit counts up to the day before the vehicle came back. A booking with no return date counts for its
// first day only. A vehicle at a garage now with no return date, or one that is late back, is at risk from tomorrow.
export function eventStateOn(e, day, today) {
  if (e.cancelled_at || day < e.from_date) return null;
  if (e.returned_on) return day <= (e.returned_on > e.from_date ? addDaysISO(e.returned_on, -1) : e.from_date) ? 'out' : null;
  if (e.reason === 'off_road') return day <= today || !e.expected_return || day <= e.expected_return ? 'out' : null;
  if (e.from_date > today) return day <= (e.expected_return || e.from_date) ? 'out' : null;
  if (day <= today) return 'out';
  if (e.expected_return && e.expected_return >= today) return day <= e.expected_return ? 'out' : null;
  return 'risk';
}

export function buildPlan({ vehicles, events, tasks, needs, from, days, today = todayStr() }) {
  const dayList = Array.from({ length: days }, (_, i) => { const date = addDaysISO(from, i); const dow = dowOf(date); return { date, dow, key: WEEKDAYS[dow][0], isToday: date === today }; });
  const last = dayList[dayList.length - 1].date;
  const fleet = vehicles.filter((v) => !v.archived_at && v.status !== 'disposed' && !(v.disposed_date && v.disposed_date <= from) && !(v.date_acquired && v.date_acquired > last));
  const evBy = new Map(); const taskBy = new Map();
  for (const e of events) { if (e.cancelled_at) continue; if (!evBy.has(e.vehicle_id)) evBy.set(e.vehicle_id, []); evBy.get(e.vehicle_id).push(e); }
  for (const t of tasks) {
    if (!t.vehicle_id || !t.due_date || t.status === 'dismissed') continue;
    if (!((t.source_type === 'compliance_item' && t.type_code !== 'SERVICE_BOOKING') || t.type_code === 'LEASE_END')) continue;
    if (!taskBy.has(t.vehicle_id)) taskBy.set(t.vehicle_id, []); taskBy.get(t.vehicle_id).push(t);
  }
  const needBy = new Map(needs.map((n) => [n.category, n]));
  // an open visit of the right kind that starts on or before this day means the due date is being dealt with
  const booked = (evs, code, day) => evs.some((e) => !e.returned_on && (BOOKABLE[code] || []).includes(e.reason) && e.from_date <= day);

  function cellFor(v, evs, ts, day) {
    if ((v.date_acquired && v.date_acquired > day) || (v.disposed_date && v.disposed_date <= day)) return { state: 'none' };
    const marks = ts.filter((t) => t.due_date === day);
    let risk = null;
    for (const e of evs) {
      const s = eventStateOn(e, day, today);
      if (s === 'out') return { state: 'out', kind: e.reason === 'off_road' ? 'off_road' : 'garage', e, marks };
      if (s === 'risk' && !risk) risk = { state: 'risk', kind: 'return', e, marks };
    }
    if (v.status === 'off_road' && !v.unavailable_event_id) return { state: 'out', kind: 'no_record', marks };
    if (v.ownership_type && v.ownership_type !== 'owned' && v.term_end && day > v.term_end) {
      if (v.term_end >= today) return { state: 'out', kind: 'term', marks };
      if (!risk) risk = { state: 'risk', kind: 'term', marks };
    }
    if (!risk) {
      const t = ts.find((x) => RISK_CODES.includes(x.type_code) && day > x.due_date && !booked(evs, x.type_code, day));
      if (t) risk = { state: 'risk', kind: 'due', t, marks };
    }
    return risk || { state: 'ok', marks };
  }

  const cats = Object.keys(CATEGORY_LABEL).filter((c) => fleet.some((v) => v.category === c) || WEEKDAYS.some(([k]) => needBy.get(c)?.[k] > 0));
  const groups = cats.map((category) => {
    const need = needBy.get(category);
    const rows = fleet.filter((v) => v.category === category).sort((a, b) => String(a.registration).localeCompare(String(b.registration)))
      .map((v) => { const evs = evBy.get(v.id) || []; const ts = taskBy.get(v.id) || []; return { v, cells: dayList.map((d) => cellFor(v, evs, ts, d.date)) }; });
    const counts = dayList.map((d, i) => {
      const cells = rows.map((r) => r.cells[i]);
      const inFleet = cells.filter((c) => c.state !== 'none').length;
      const available = cells.filter((c) => c.state === 'ok' || c.state === 'risk').length;
      const atRisk = cells.filter((c) => c.state === 'risk').length;
      const needed = Number(need?.[d.key] || 0);
      const level = !needed ? 'none' : available < needed ? 'short' : available - atRisk < needed ? 'risk' : 'ok';
      return { inFleet, available, atRisk, needed, level, short: Math.max(0, needed - available), riskShort: Math.max(0, needed - (available - atRisk)) };
    });
    return { category, rows, counts, hasNeed: WEEKDAYS.some(([k]) => need?.[k] > 0) };
  });

  // runs of consecutive days at the same level, so a week-long shortage is one line and not seven
  const runs = (level, field) => groups.flatMap((g) => {
    const out = []; let cur = null;
    g.counts.forEach((c, i) => {
      if (c.level === level) { if (!cur) { cur = { category: g.category, from: dayList[i].date, to: dayList[i].date, days: 0, worst: 0 }; out.push(cur); } cur.to = dayList[i].date; cur.days += 1; cur.worst = Math.max(cur.worst, c[field]); } else cur = null;
    });
    return out;
  }).sort((a, b) => a.from.localeCompare(b.from) || a.category.localeCompare(b.category));
  const shortfalls = runs('short', 'short'); const risks = runs('risk', 'riskShort');
  const dayCount = (level) => dayList.filter((_, i) => groups.some((g) => g.counts[i].level === level)).length;

  // vehicles that are off the road are left out of the list of visits to book: they are not in service
  const offRoad = (v) => v.status === 'off_road' || (evBy.get(v.id) || []).some((e) => e.reason === 'off_road' && !e.returned_on && e.from_date <= today);
  const vById = new Map(fleet.filter((v) => !offRoad(v)).map((v) => [v.id, v]));
  const toBook = [...taskBy.entries()].flatMap(([vid, ts]) => (vById.has(vid) ? ts.filter((t) => BOOKABLE[t.type_code] && t.due_date <= last && !booked(evBy.get(vid) || [], t.type_code, last)).map((t) => ({ t, v: vById.get(vid) })) : []))
    .sort((a, b) => a.t.due_date.localeCompare(b.t.due_date) || String(a.v.registration).localeCompare(String(b.v.registration)));

  return { days: dayList, from, to: last, groups, shortfalls, risks, shortDays: dayCount('short'), riskDays: dayCount('risk'), toBook, hasNeeds: groups.some((g) => g.hasNeed) };
}

// ---- Screen ---------------------------------------------------------------------------------
const KEY = 'fm:planner';
const WEEK_CHOICES = [2, 4, 6, 8];
const loadView = () => { try { const s = JSON.parse(sessionStorage.getItem(KEY)); if (WEEK_CHOICES.includes(s?.weeks) && s.offset >= 0) return s; } catch { /* use the default */ } return { weeks: 4, offset: 0 }; };
const saveView = (s) => { try { sessionStorage.setItem(KEY, JSON.stringify(s)); } catch { /* not remembered */ } };
const rangeText = (a, b) => (a === b ? fmtDayMonth(a, true) : `${fmtDayMonth(a, true)} to ${fmtDayMonth(b, true)}`);

export async function plannerView(main) {
  mount(main, html`<header class="page-head"><h1>Planner</h1></header>${loadingHtml('Loading the planner')}`);
  const [vehicles, events, tasks, garages, needs] = await Promise.all([api.listVehicles(), api.listUnavailability(), api.listTasks(), api.listGarages(), api.listVehicleRequirements()]);
  const gById = new Map(garages.map((g) => [g.id, g]));
  const today = todayStr();
  const view = loadView();
  let plan = null;

  const garageName = (e) => gById.get(e.garage_id)?.name || 'a garage';
  // one sentence for a cell: what is happening to this vehicle on this day
  function describe(v, c, day) {
    const due = (c.marks || []).map((t) => `${t.type_name} is due`).join('. ');
    let s;
    if (c.state === 'none') s = 'Not in the fleet on this day';
    else if (c.kind === 'garage') s = `${c.e.from_date > today ? 'Booked in' : 'At the garage'}: ${UNAVAIL_REASON_LABEL[c.e.reason]} at ${garageName(c.e)}, from ${fmtDateShort(c.e.from_date)}${c.e.returned_on ? ` to ${fmtDateShort(c.e.returned_on)}` : c.e.expected_return ? `, due back ${fmtDateShort(c.e.expected_return)}` : ', no return date'}`;
    else if (c.kind === 'off_road') s = `Off the road since ${fmtDateShort(c.e.from_date)}${c.e.sorn_declared_on ? ' (SORN)' : ', no SORN recorded'}`;
    else if (c.kind === 'no_record') s = 'Off the road, with no record of why';
    else if (c.kind === 'term' && c.state === 'out') s = `${TERM_WORD[v.ownership_type] || 'Lease'} ends ${fmtDateShort(v.term_end)}, so the vehicle is gone from the next day`;
    else if (c.kind === 'term') s = `At risk: the ${(TERM_WORD[v.ownership_type] || 'Lease').toLowerCase()} end date (${fmtDateShort(v.term_end)}) has passed. Update it if the vehicle is staying`;
    else if (c.kind === 'return') s = c.e.expected_return ? `At risk: was due back from ${garageName(c.e)} on ${fmtDateShort(c.e.expected_return)} and is not marked as returned` : `At risk: at ${garageName(c.e)} with no return date, so it may still be out`;
    else if (c.kind === 'due') s = `At risk: ${c.t.type_name} was due ${fmtDateShort(c.t.due_date)} and nothing is booked`;
    else s = 'Available';
    return `${formatReg(v.registration)}, ${fmtDate(day)}. ${s}.${due ? ` ${due}.` : ''}`;
  }

  function cellHtml(r, c, i) {
    const d = plan.days[i]; const prev = i ? r.cells[i - 1] : null;
    // a block is labelled once, on its first day. A run of at-risk days is one block whatever the reasons.
    const same = prev && prev.state === c.state && (c.state === 'risk' || (prev.kind === c.kind && prev.e === c.e));
    const code = same || c.state === 'ok' || c.state === 'none' ? '' : c.kind === 'garage' || c.kind === 'off_road' ? REASON_CODE[c.e.reason] : c.kind === 'term' ? 'End' : c.kind === 'no_record' ? 'Off' : '?';
    const mark = (c.marks || []).length ? html`<i class="pl-mark ${c.marks.some((t) => t.is_statutory) ? 'stat' : ''}"></i>` : '';
    const busy = c.state === 'out' || c.state === 'risk' || mark;
    return html`<td class="pl-c s-${c.state} ${c.kind ? `k-${c.kind}` : ''} ${d.isToday ? 'is-today' : ''} ${d.dow === 0 ? 'wk' : ''}" data-v="${r.v.id}" data-i="${i}" ${busy ? html`tabindex="0" title="${describe(r.v, c, d.date)}"` : ''}>${code ? html`<span class="pl-code">${code}</span>` : ''}${mark}</td>`;
  }

  function render() {
    const from = addDaysISO(today, view.offset * 7);
    plan = buildPlan({ vehicles, events, tasks, needs, from, days: view.weeks * 7, today });
    const months = []; for (const d of plan.days) { const k = d.date.slice(0, 7); const m = months[months.length - 1]; if (m && m.k === k) m.n += 1; else months.push({ k, n: 1, label: fmtMonth(d.date, true) }); }
    const next = plan.shortfalls[0];
    const fig = (label, value, sub, tone = '') => html`<div class="figure ${tone}"><span class="figure-value">${value}</span><span class="figure-label">${label}</span>${sub ? html`<span class="figure-sub">${sub}</span>` : ''}</div>`;
    const runLi = (r, word) => html`<li><strong>${rangeText(r.from, r.to)}</strong>: ${r.days > 1 ? 'up to ' : ''}${noun(r.worst, r.category)} ${word}${r.days > 1 ? html` <span class="muted">(${r.days} days)</span>` : ''}</li>`;
    const many = (list, f, max = 8) => html`<ul class="plain">${list.slice(0, max).map(f)}</ul>${list.length > max ? html`<p class="muted">And ${list.length - max} more in this period.</p>` : ''}`;

    mount(main, html`
      <header class="page-head"><h1>Planner</h1></header>
      <div class="planner-controls" role="group" aria-label="Planner period">
        <div class="seg" aria-label="Weeks shown">${WEEK_CHOICES.map((w) => html`<button type="button" class="seg-btn" data-weeks="${w}" aria-pressed="${String(view.weeks === w)}">${w} weeks</button>`)}</div>
        <div class="seg"><button type="button" class="seg-btn" data-shift="-1" ${view.offset ? '' : 'disabled'}>Earlier</button><button type="button" class="seg-btn" data-shift="0" ${view.offset ? '' : 'disabled'}>Today</button><button type="button" class="seg-btn" data-shift="1">Later</button></div>
      </div>
      <p class="muted period-note">Showing <strong>${fmtDateShort(plan.from)} to ${fmtDateShort(plan.to)}</strong>. Vehicles available each day against the number needed.</p>
      ${plan.hasNeeds ? '' : html`<p class="banner-info">No minimum number of vehicles is set, so the planner cannot flag days when you are short. ${can.configure ? html`<a href="#/settings">Set the vehicles needed in Settings</a>.` : 'Ask the superuser to set the vehicles needed in Settings.'}</p>`}

      <div class="figures">
        ${fig('Next shortfall', next ? fmtDayMonth(next.from, true) : 'None', next ? `${noun(next.worst, next.category)} short` : plan.hasNeeds ? 'Enough vehicles every day' : 'No minimum set', next ? 'tone-bad' : plan.hasNeeds ? 'tone-good' : '')}
        ${fig('Days short', plan.shortDays, plan.shortDays ? 'Fewer vehicles than needed' : '', plan.shortDays ? 'tone-bad' : '')}
        ${fig('Days at risk', plan.riskDays, plan.riskDays ? 'Short if at-risk vehicles are out' : '', plan.riskDays ? 'tone-warn' : '')}
        ${fig('To book', plan.toBook.length, plan.toBook.length ? 'Due in this period, no visit booked' : '', plan.toBook.length ? 'tone-warn' : '')}
      </div>

      <div class="chart-legend planner-legend"><span><i class="swatch sw-pl-garage"></i>At a garage or booked in</span><span><i class="swatch sw-pl-off"></i>Off the road</span><span><i class="swatch sw-pl-term"></i>Lease or rental ended</span><span><i class="swatch sw-pl-risk"></i>At risk</span><span><i class="pl-mark stat"></i>Legal due date</span><span><i class="pl-mark"></i>Other due date</span></div>
      ${plan.groups.length ? html`<div class="planner-scroll" id="planner-grid" tabindex="0" role="region" aria-label="Planner grid, scrolls sideways"><table class="planner">
        <thead>
          <tr><th class="pl-veh" rowspan="2" scope="col">Vehicle</th>${months.map((m) => html`<th class="pl-month" colspan="${m.n}" scope="colgroup">${m.n > 2 ? m.label : ''}</th>`)}</tr>
          <tr>${plan.days.map((d) => html`<th class="pl-day ${d.isToday ? 'is-today' : ''} ${d.dow === 0 ? 'wk' : ''}" scope="col" title="${fmtDate(d.date)}"><span>${WEEKDAYS[d.dow][1].slice(0, 2)}</span><b>${parseISO(d.date).getDate()}</b></th>`)}</tr>
        </thead>
        ${plan.groups.map((g) => html`<tbody>
          <tr class="pl-group"><th class="pl-veh" scope="rowgroup">${CATEGORY_PLURAL[g.category]}</th><td colspan="${plan.days.length}"></td></tr>
          ${g.rows.map((r) => html`<tr><th class="pl-veh" scope="row"><a class="plate-link" href="#/vehicles/${r.v.id}?tab=availability">${plate(r.v.registration, r.v.category)}</a></th>${r.cells.map((c, i) => cellHtml(r, c, i))}</tr>`)}
          <tr class="pl-count"><th class="pl-veh" scope="row">Available</th>${g.counts.map((c, i) => html`<td class="lvl-${c.level} ${plan.days[i].isToday ? 'is-today' : ''} ${plan.days[i].dow === 0 ? 'wk' : ''}" title="${`${fmtDate(plan.days[i].date)}: ${c.available} available${c.atRisk ? ` (${c.atRisk} at risk)` : ''}, ${c.needed ? `${c.needed} needed` : 'no minimum'}`}">${c.available}</td>`)}</tr>
          <tr class="pl-need"><th class="pl-veh" scope="row">Needed</th>${g.counts.map((c, i) => html`<td class="${plan.days[i].isToday ? 'is-today' : ''} ${plan.days[i].dow === 0 ? 'wk' : ''}">${c.needed || html`<span class="muted">-</span>`}</td>`)}</tr>
        </tbody>`)}
      </table></div>
      <p class="chart-detail" id="planner-detail" aria-live="polite">Tap or click a block for the detail.</p>` : html`<p class="muted">There are no vehicles to plan for.</p>`}

      <div class="dash-grid planner-lists">
        <section class="dash-panel"><h2>Shortfalls</h2>
          ${plan.shortfalls.length ? many(plan.shortfalls, (r) => runLi(r, 'short')) : html`<p class="muted">${plan.hasNeeds ? 'No day in this period has fewer vehicles than you need.' : 'Set the vehicles needed to see shortfalls.'}</p>`}
          ${plan.risks.length ? html`<h3>At risk</h3>${many(plan.risks, (r) => runLi(r, 'short if the at-risk vehicles are out'), 5)}` : ''}
        </section>
        <section class="dash-panel"><h2>To book</h2>
          ${plan.toBook.length ? many(plan.toBook, ({ t, v }) => html`<li><a class="plate-link" href="#/vehicles/${v.id}?tab=availability">${plate(v.registration, v.category)}</a> ${t.type_name} <span class="${t.due_date < today ? 'c-overdue' : 'muted'}">${t.due_date < today ? html`<strong>was due ${fmtDateShort(t.due_date)}</strong>` : `due ${fmtDateShort(t.due_date)}`}</span></li>`) : html`<p class="muted">Nothing due in this period is waiting for a garage visit.</p>`}
        </section>
      </div>`);

    const grid = main.querySelector('#planner-grid'); const detail = main.querySelector('#planner-detail');
    const show = (td) => {
      if (!td) return;
      const row = plan.groups.flatMap((g) => g.rows).find((r) => r.v.id === td.dataset.v); if (!row) return;
      const i = Number(td.dataset.i);
      grid.querySelectorAll('.pl-c.selected').forEach((x) => x.classList.remove('selected')); td.classList.add('selected');
      mount(detail, html`${describe(row.v, row.cells[i], plan.days[i].date)} <a href="#/vehicles/${row.v.id}?tab=availability">Open the vehicle</a>`);
    };
    if (grid) {
      grid.onclick = (e) => show(e.target.closest('.pl-c'));
      grid.onkeydown = (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.pl-c')) { e.preventDefault(); show(e.target); } };
    }
    main.querySelectorAll('[data-weeks]').forEach((b) => { b.onclick = () => { view.weeks = Number(b.dataset.weeks); saveView(view); render(); }; });
    main.querySelectorAll('[data-shift]').forEach((b) => { b.onclick = () => { const s = Number(b.dataset.shift); view.offset = s ? Math.max(0, view.offset + s) : 0; saveView(view); render(); }; });
  }
  render();
}
