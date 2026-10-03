// Management dashboard: what needs attention now, and what happened in the chosen period.
import * as api from './api.js';
import { can } from './state.js';
import { html, mount, plate, pill, loadingHtml, fmtDateShort, fmtMoney, fmtInt, dueText, todayStr, addDaysISO, plural } from './ui.js';
import {
  TASK_CATEGORIES, STATUS_LABEL, UNAVAIL_REASON_LABEL, INCIDENT_KIND_LABEL, COST_CATEGORY_LABEL, availability, taskCategory, incidentTitle, incidentCost, driverName, vehicleTitle,
} from './domain.js';
import { loadPeriod, periodControlsHtml, wirePeriod, periodLabel, inPeriod, milesFromRows, eventDaysInPeriod, eventTouchesPeriod } from './insight.js';

const sum = (list, f) => list.reduce((s, x) => s + Number(f(x) || 0), 0);
const link = (href, content, cls = '') => html`<a class="${cls}" href="${href}">${content}</a>`;

export async function dashboardView(main) {
  mount(main, html`<header class="page-head"><h1>Dashboard</h1></header>${loadingHtml('Loading the dashboard')}`);
  const [tasks, vehicles, drivers, incidents, events, garages, policies, convictions] = await Promise.all([
    api.listTasks(), api.listVehicles(), api.listDrivers(), api.listIncidents(), api.listUnavailability(), api.listGarages(), api.listPolicies(),
    can.sensitive ? api.listConvictions() : [],
  ]);
  const p = loadPeriod();
  const today = todayStr();
  const vById = new Map(vehicles.map((v) => [v.id, v]));
  const gById = new Map(garages.map((g) => [g.id, g]));
  const dById = new Map(drivers.map((d) => [d.id, d]));
  const live = vehicles.filter((v) => v.status !== 'disposed' && !v.archived_at);
  const events_ = events.filter((e) => !e.cancelled_at);

  let drawing = 0;
  async function draw() {
    // costs and mileage depend on the period, so they are fetched for it
    const mine = ++drawing;
    const [costs, mileRowsRaw] = await Promise.all([api.listCostsBetween(p), api.milesInPeriod(p)]);
    if (mine !== drawing) return; // the period was changed again meanwhile
    // ---- as of today ----
    const open = tasks.filter((t) => t.status !== 'snoozed' && t.status !== 'dismissed');
    const overdue = open.filter((t) => t.status === 'overdue');
    const dueSoon = open.filter((t) => t.status === 'due_soon');
    const states = live.map((v) => ({ v, a: availability(v) }));
    const count = (k) => states.filter((s) => s.a.key === k).length;
    const atGarage = states.filter((s) => s.a.key === 'garage');
    const offRoad = states.filter((s) => s.a.key === 'sorn' || s.a.key === 'off_road_no_sorn');
    const available = states.filter((s) => s.a.key === 'available' || s.a.key === 'booked').length;
    const booked = live.filter((v) => v.next_booking_date && v.next_booking_date <= addDaysISO(today, 14));
    const unavailableNow = atGarage.length + offRoad.length;
    const noCover = live.filter((v) => v.status === 'active' && !v.insured_until && availability(v).key !== 'sorn');

    // ---- the period ----
    const inc = incidents.filter((i) => inPeriod(i.incident_date, p));
    const accidents = inc.filter((i) => i.kind === 'accident');
    const damage = inc.filter((i) => i.kind === 'damage');
    const fines = inc.filter((i) => i.kind === 'fine');
    const repair = sum(inc, (i) => i.repair_cost); const third = sum(inc, (i) => i.third_party_cost); const excess = sum(inc, (i) => i.excess_paid);
    const insurerPaid = sum(inc, (i) => i.insurer_paid); const fineTotal = sum(fines, (i) => i.fine_amount);
    const incidentSpend = repair + third + fineTotal;
    const periodCosts = costs;
    const running = sum(periodCosts, (c) => c.amount);
    const byCat = Object.entries(periodCosts.reduce((m, c) => ({ ...m, [c.category]: (m[c.category] || 0) + Number(c.amount) }), {})).sort((a, b) => b[1] - a[1]);
    const miles = milesFromRows(mileRowsRaw);
    const mileRows = [...miles.entries()].filter(([id]) => vById.get(id) && !vById.get(id).archived_at).map(([id, m]) => ({ v: vById.get(id), ...m })).filter((m) => m.miles > 0).sort((a, b) => b.miles - a.miles);
    const totalMiles = sum(mileRows, (m) => m.miles);
    const touched = events_.filter((e) => eventTouchesPeriod(e, p, today));
    const lostDays = sum(touched, (e) => eventDaysInPeriod(e, p, today));
    const garageVisits = touched.filter((e) => e.reason !== 'off_road');

    // ---- by task type ----
    const catRows = TASK_CATEGORIES.map(([k, label]) => {
      const t = tasks.filter((x) => taskCategory(x) === k);
      const c = (s) => t.filter((x) => x.status === s).length;
      return { k, label, overdue: c('overdue'), due_soon: c('due_soon'), no_date: c('no_date'), upcoming: c('upcoming'), snoozed: c('snoozed') + c('dismissed'), total: t.length };
    });
    const attention = [...overdue.sort((a, b) => a.days_remaining - b.days_remaining), ...dueSoon.sort((a, b) => a.days_remaining - b.days_remaining)].slice(0, 8);

    // ---- looking ahead ----
    const renewals = policies.filter((x) => x.status === 'active' && x.end_date >= today && x.end_date <= addDaysISO(today, 60));
    const leases = tasks.filter((t) => t.type_code === 'LEASE_END' && t.days_remaining != null && t.days_remaining <= 90 && t.days_remaining >= 0);
    const watch = can.sensitive ? drivers.filter((d) => d.employment_status === 'active').map((d) => {
      const cs = convictions.filter((c) => c.driver_id === d.id && c.status === 'live' && c.points > 0);
      return { d, onLicence: sum(cs.filter((c) => c.licence_until >= today), (c) => c.points), totting: sum(cs.filter((c) => c.totting_until >= today), (c) => c.points) };
    }).filter((x) => x.totting >= 6).sort((a, b) => b.totting - a.totting) : [];

    const fig = (label, value, sub, href, tone = '') => html`<a class="figure ${tone}" href="${href}"><span class="figure-value">${value}</span><span class="figure-label">${label}</span>${sub ? html`<span class="figure-sub">${sub}</span>` : ''}</a>`;
    const statusCell = (n, k, s) => (n ? link(`#/tasks?category=${k}&status=${s}`, n, `n-${s}`) : html`<span class="muted">0</span>`);

    mount(main, html`
      <header class="page-head"><h1>Dashboard</h1></header>
      ${periodControlsHtml(p)}
      <p class="muted period-note">Showing <strong>${periodLabel(p)}</strong>. Tasks and fleet status are as of today. Accidents, costs, mileage and downtime cover the period.</p>

      <div class="figures">
        ${fig('Overdue tasks', overdue.length, overdue.length ? `${plural(open.filter((t) => t.status === 'overdue' && t.is_statutory).length, 'statutory task')}` : 'Nothing overdue', '#/tasks?status=overdue', overdue.length ? 'tone-bad' : 'tone-good')}
        ${fig('Due soon', dueSoon.length, 'Inside the warning window', '#/tasks?status=due_soon', dueSoon.length ? 'tone-warn' : '')}
        ${fig('Available vehicles', `${available} of ${live.length}`, unavailableNow ? `${unavailableNow} out of service` : 'None out of service', '#/vehicles', unavailableNow ? 'tone-warn' : 'tone-good')}
        ${fig('Accidents and damage', accidents.length + damage.length, `${plural(accidents.length, 'accident')}, ${damage.length} damage`, '#/reports?report=damage')}
        ${fig('Cost in the period', fmtMoney(running + incidentSpend), `${fmtMoney(running)} running, ${fmtMoney(incidentSpend)} incidents`, '#/reports?report=damage')}
        ${fig('Miles in the period', fmtInt(totalMiles), mileRows.length ? `${fmtInt(Math.round(totalMiles / mileRows.length))} per vehicle` : 'No readings', '#/reports?report=mileage')}
      </div>

      <div class="dash-grid">
        <section class="dash-panel"><h2>Needs attention</h2>
          ${attention.length ? html`<ul class="attn">${attention.map((t) => html`<li><a href="#/tasks?category=${taskCategory(t)}&status=${t.status}">
            <span class="attn-what">${t.vehicle_id && t.applies_to === 'vehicle' ? plate(vById.get(t.vehicle_id)?.registration || t.target_label.split(' - ')[0]) : html`<strong>${t.target_label}</strong>`}</span>
            <span class="attn-name">${t.type_name}</span><span class="attn-due">${pill(t.status)} <span class="muted">${dueText(t.days_remaining)}</span></span></a></li>`)}</ul>
            <p><a href="#/tasks">See all ${open.length} open tasks</a></p>` : html`<p class="muted">Nothing is overdue or due soon.</p>`}
        </section>
        <section class="dash-panel"><h2>Fleet status</h2>
          <table class="mini"><tbody>
            <tr><th>Available</th><td class="num">${available}</td></tr>
            <tr><th>At a garage</th><td class="num">${atGarage.length}</td></tr>
            <tr><th>Off the road (SORN)</th><td class="num">${count('sorn')}</td></tr>
            ${count('off_road_no_sorn') ? html`<tr class="bad"><th>Off the road, no SORN recorded</th><td class="num">${count('off_road_no_sorn')}</td></tr>` : ''}
            <tr><th>Booked in, next 14 days</th><td class="num">${booked.length}</td></tr>
            ${noCover.length ? html`<tr class="bad"><th>No insurance cover</th><td class="num">${noCover.length}</td></tr>` : ''}
          </tbody></table>
          ${atGarage.length + offRoad.length ? html`<h3>Out of service now</h3><ul class="plain">${[...atGarage, ...offRoad].map(({ v }) => {
            const late = v.unavailable_expected_return && v.unavailable_expected_return < today;
            return html`<li>${link(`#/vehicles/${v.id}?tab=availability`, plate(v.registration), 'plate-link')} <span class="muted">${UNAVAIL_REASON_LABEL[v.unavailable_reason]}${v.unavailable_reason === 'off_road' ? '' : ` at ${gById.get(v.unavailable_garage_id)?.name || 'a garage'}`}, since ${fmtDateShort(v.unavailable_since)}</span>
              ${v.unavailable_expected_return ? html`<span class="${late ? 'c-overdue' : 'muted'}"> ${late ? html`<strong>Back was due</strong>` : 'Back'} ${fmtDateShort(v.unavailable_expected_return)}</span>` : ''}</li>`;
          })}</ul>` : ''}
          ${booked.length ? html`<h3>Booked in</h3><ul class="plain">${booked.map((v) => html`<li>${link(`#/vehicles/${v.id}?tab=availability`, plate(v.registration), 'plate-link')} <span class="muted">${fmtDateShort(v.next_booking_date)}</span></li>`)}</ul>` : ''}
        </section>
      </div>

      <section class="dash-panel wide"><h2>Tasks by type</h2>
        <table class="grid compact"><thead><tr><th>Type</th><th class="num">Overdue</th><th class="num">Due soon</th><th class="num">No date</th><th class="num">Upcoming</th><th class="num">Snoozed</th><th class="num">Total</th></tr></thead><tbody>
          ${catRows.map((r) => html`<tr><td data-label="Type">${link(`#/tasks?category=${r.k}`, r.label)}</td>
            <td data-label="Overdue" class="num">${statusCell(r.overdue, r.k, 'overdue')}</td><td data-label="Due soon" class="num">${statusCell(r.due_soon, r.k, 'due_soon')}</td>
            <td data-label="No date" class="num">${statusCell(r.no_date, r.k, 'no_date')}</td><td data-label="Upcoming" class="num">${r.upcoming}</td><td data-label="Snoozed" class="num">${r.snoozed}</td><td data-label="Total" class="num"><strong>${r.total}</strong></td></tr>`)}
        </tbody><tfoot><tr><td class="totals-label">All tasks</td>${['overdue', 'due_soon', 'no_date', 'upcoming', 'snoozed', 'total'].map((k) => html`<td class="num totals">${sum(catRows, (r) => r[k])}</td>`)}</tr></tfoot></table>
      </section>

      <div class="dash-grid">
        <section class="dash-panel"><h2>Accidents, damage and fines</h2>
          <table class="mini"><tbody>
            <tr><th>Accidents</th><td class="num">${accidents.length}</td></tr><tr><th>Other damage</th><td class="num">${damage.length}</td></tr><tr><th>Fines</th><td class="num">${fines.length}</td></tr>
            <tr><th>Repair costs</th><td class="num">${fmtMoney(repair)}</td></tr><tr><th>Excess paid</th><td class="num">${fmtMoney(excess)}</td></tr>
            <tr><th>Paid by insurers</th><td class="num">${fmtMoney(insurerPaid)}</td></tr><tr><th>Cost to other parties</th><td class="num">${fmtMoney(third)}</td></tr>
            <tr><th>Fines</th><td class="num">${fmtMoney(fineTotal)}</td></tr>
            <tr class="total"><th>Cost to the company, before insurers</th><td class="num">${fmtMoney(incidentSpend)}</td></tr>
          </tbody></table>
          ${inc.length ? html`<h3>Most recent</h3><ul class="plain">${inc.slice(0, 5).map((i) => html`<li>${link(`#/incidents/${i.id}`, `${fmtDateShort(i.incident_date)} ${incidentTitle(i)}`)} ${i.vehicle_id && vById.get(i.vehicle_id) ? plate(vById.get(i.vehicle_id).registration) : ''} <span class="muted">${incidentCost(i) ? fmtMoney(incidentCost(i)) : ''}</span></li>`)}</ul>` : html`<p class="muted">Nothing recorded in this period.</p>`}
          <p><a href="#/reports?report=damage">Vehicle damage report</a> · <a href="#/reports?report=accidents">Accidents report</a></p>
        </section>
        <section class="dash-panel"><h2>Running costs</h2>
          ${byCat.length ? html`<table class="mini"><tbody>${byCat.map(([c, a]) => html`<tr><th>${COST_CATEGORY_LABEL[c] || c}</th><td class="num">${fmtMoney(a)}</td></tr>`)}<tr class="total"><th>Running costs</th><td class="num">${fmtMoney(running)}</td></tr></tbody></table>` : html`<p class="muted">No running costs logged in this period.</p>`}
          <table class="mini spaced"><tbody><tr><th>Running costs</th><td class="num">${fmtMoney(running)}</td></tr><tr><th>Accidents, damage and fines</th><td class="num">${fmtMoney(incidentSpend)}</td></tr><tr class="total"><th>Total in the period</th><td class="num">${fmtMoney(running + incidentSpend)}</td></tr></tbody></table>
        </section>
      </div>

      <div class="dash-grid">
        <section class="dash-panel"><h2>Mileage</h2>
          ${mileRows.length ? html`<table class="mini"><tbody><tr class="total"><th>Fleet miles in the period</th><td class="num">${fmtInt(totalMiles)}</td></tr>
            <tr><th>Average per vehicle</th><td class="num">${fmtInt(Math.round(totalMiles / mileRows.length))}</td></tr></tbody></table>
            <h3>Highest mileage</h3><ul class="plain">${mileRows.slice(0, 5).map((m) => html`<li>${link(`#/vehicles/${m.v.id}?tab=readings`, plate(m.v.registration), 'plate-link')} <strong>${fmtInt(m.miles)}</strong> <span class="muted">miles${m.perDay ? `, ${Math.round(m.perDay)} a day` : ''}</span></li>`)}</ul>`
            : html`<p class="muted">No mileage readings fall in this period. Log odometer readings on each vehicle to see mileage here.</p>`}
          <p><a href="#/reports?report=mileage">Vehicle mileage report</a></p>
        </section>
        <section class="dash-panel"><h2>Downtime and garages</h2>
          <table class="mini"><tbody><tr><th>Garage visits</th><td class="num">${garageVisits.length}</td></tr><tr><th>Vehicle-days out of service</th><td class="num">${lostDays}</td></tr>
            <tr><th>Vehicles affected</th><td class="num">${new Set(touched.map((e) => e.vehicle_id)).size}</td></tr></tbody></table>
          ${garageVisits.length ? html`<h3>Visits</h3><ul class="plain">${garageVisits.slice(0, 5).map((e) => html`<li>${vById.get(e.vehicle_id) ? plate(vById.get(e.vehicle_id).registration) : ''} <span class="muted">${UNAVAIL_REASON_LABEL[e.reason]} at ${gById.get(e.garage_id)?.name || 'a garage'}, ${fmtDateShort(e.from_date)}</span></li>`)}</ul>` : ''}
          <p><a href="#/reports?report=status">Vehicle status report</a> · <a href="#/garages">Garages</a></p>
        </section>
      </div>

      <div class="dash-grid">
        <section class="dash-panel"><h2>Coming up</h2>
          ${renewals.length || leases.length ? html`<ul class="plain">
            ${renewals.map((x) => html`<li>${link(`#/insurance/${x.id}`, `Insurance ${x.policy_number}`)} <span class="muted">renews ${fmtDateShort(x.end_date)}</span></li>`)}
            ${leases.map((t) => html`<li>${link(`#/vehicles/${t.source_id}`, t.target_label)} <span class="muted">${dueText(t.days_remaining)}</span></li>`)}</ul>`
            : html`<p class="muted">No insurance renewals in the next 60 days and no leases ending in the next 90.</p>`}
        </section>
        ${can.sensitive ? html`<section class="dash-panel"><h2>Drivers to watch</h2>
          ${watch.length ? html`<ul class="plain">${watch.map((w) => html`<li>${link(`#/drivers/${w.d.id}?tab=convictions`, driverName(w.d))} <span class="${w.totting >= 12 ? 'c-overdue' : 'c-soon'}"><strong>${w.totting} points</strong></span> <span class="muted">counting towards totting up</span></li>`)}</ul>`
            : html`<p class="muted">No driver has 6 or more points counting towards totting up.</p>`}
        </section>` : ''}
      </div>`);
    wirePeriod(main, p, () => draw());
  }
  await draw();
}
