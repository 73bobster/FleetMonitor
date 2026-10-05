// Management dashboard: fleet status and what needs attention now, and what happened in the chosen period.
// Which sections are shown, and in what order, is set by the superuser in Settings (Dashboard display).
import * as api from './api.js';
import { can, screenOn, dashLayout } from './state.js';
import { html, mount, plate, pill, loadingHtml, fmtDateShort, fmtMoney, fmtInt, dueText, todayStr, addDaysISO, plural } from './ui.js';
import { UNAVAIL_REASON_LABEL, availability, taskCategory, incidentTitle, incidentCost, driverName } from './domain.js';
import { loadPeriod, periodControlsHtml, wirePeriod, periodLabel, inPeriod, milesFromRows, eventDaysInPeriod, eventTouchesPeriod } from './insight.js';
import { buildAvailabilitySeries, chartSvg, chartLegendHtml, numbersTableHtml, detailText } from './availability-chart.js';
import { buildRag, ragDot, ragTile } from './rag.js';

const sum = (list, f) => list.reduce((s, x) => s + Number(f(x) || 0), 0);
const link = (href, content, cls = '') => html`<a class="${cls}" href="${href}">${content}</a>`;
const DRIVERS_SHOWN = 5;   // the drivers panel lists only the worst offenders, unless asked for them all
// A row of links, leaving out any that lead to a screen that has been switched off.
const linkRow = (pairs) => { const on = pairs.filter(([href]) => screenOn(href.slice(2).split(/[/?]/)[0])); return on.length ? html`<p>${on.map(([href, text], i) => html`${i ? ' · ' : ''}<a href="${href}">${text}</a>`)}</p>` : ''; };

export async function dashboardView(main) {
  mount(main, html`<header class="page-head"><h1>Dashboard</h1></header>${loadingHtml('Loading the dashboard')}`);
  const p = loadPeriod();
  // everything in one round trip: the period's costs and mileage are fetched alongside the rest
  const fetchPeriod = (per) => Promise.all([api.listCostsBetween(per), api.milesInPeriod(per)]);
  const [tasks, vehicles, drivers, incidents, events, garages, convictions, first, needs, ragInputs, periods] = await Promise.all([
    api.listTasks(), api.listVehicles(), api.listDrivers(), api.listIncidents(), api.listUnavailability(), api.listGarages(),
    can.sensitive ? api.listConvictions() : [], fetchPeriod(p), api.listVehicleRequirements(), api.ragInputs(), api.listVehiclePeriods(),
  ]);
  let [costs, mileRowsRaw] = first;
  let allOffenders = false;   // the drivers panel: show every driver with something against them, not just the worst
  const today = todayStr();
  const vById = new Map(vehicles.map((v) => [v.id, v]));
  const gById = new Map(garages.map((g) => [g.id, g]));
  const dById = new Map(drivers.map((d) => [d.id, d]));
  const live = vehicles.filter((v) => v.status !== 'disposed' && !v.archived_at);
  const liveEvents = events.filter((e) => !e.cancelled_at);
  // Red, amber, green: as of today, so worked out once and not again when the reporting period changes.
  const R = buildRag({ vehicles, drivers, tasks, events: liveEvents, incidents, needs, ragInputs, today });
  const vdot = (id) => ragDot(R.vehicles.get(id)); const ddot = (id) => ragDot(R.drivers.get(id));
  let changing = 0;
  let observer = null; let drawnWidth = 0; let selectedBar = null;

  // The stacked bars are drawn to fit their container, and redrawn if it changes size (a phone turned sideways, say).
  function drawChart(series) {
    const box = main.querySelector('#avail-chart'); const detail = main.querySelector('#avail-detail');
    if (!box) return;
    const paint = () => {
      drawnWidth = Math.round(box.clientWidth) || 640;
      box.innerHTML = chartSvg(series, drawnWidth);
      if (selectedBar !== null) box.querySelector(`.bar[data-i="${selectedBar}"]`)?.classList.add('selected');
    };
    const show = (g) => {
      if (!g) return;
      box.querySelectorAll('.bar.selected').forEach((x) => x.classList.remove('selected'));
      g.classList.add('selected'); selectedBar = Number(g.dataset.i);
      detail.textContent = detailText(series, selectedBar);
    };
    selectedBar = null; paint();
    box.onclick = (e) => show(e.target.closest('.bar'));
    box.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); show(e.target.closest('.bar')); } };
    observer?.disconnect();
    if (typeof ResizeObserver === 'function') {
      observer = new ResizeObserver(() => { const w = Math.round(box.clientWidth); if (w && Math.abs(w - drawnWidth) > 16) paint(); });
      observer.observe(box);
    }
  }

  function render() {
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
    const attention = [...overdue.sort((a, b) => a.days_remaining - b.days_remaining), ...dueSoon.sort((a, b) => a.days_remaining - b.days_remaining)].slice(0, 6);

    // ---- the period ----
    const inc = incidents.filter((i) => inPeriod(i.incident_date, p));
    const accidents = inc.filter((i) => i.kind === 'accident');
    const damage = inc.filter((i) => i.kind === 'damage');
    const fines = inc.filter((i) => i.kind === 'fine');
    const repair = sum(inc, (i) => i.repair_cost); const third = sum(inc, (i) => i.third_party_cost); const excess = sum(inc, (i) => i.excess_paid);
    const insurerPaid = sum(inc, (i) => i.insurer_paid); const fineTotal = sum(fines, (i) => i.fine_amount);
    const incidentSpend = repair + third + fineTotal;
    const running = sum(costs, (c) => c.amount);
    const miles = milesFromRows(mileRowsRaw);
    const mileRows = [...miles.entries()].filter(([id]) => vById.get(id) && !vById.get(id).archived_at).map(([id, m]) => ({ id, ...m })).filter((m) => m.miles > 0);
    const totalMiles = sum(mileRows, (m) => m.miles);
    const touched = liveEvents.filter((e) => eventTouchesPeriod(e, p, today));
    const lostDays = sum(touched, (e) => eventDaysInPeriod(e, p, today));
    const garageVisits = touched.filter((e) => e.reason !== 'off_road');

    // ---- drivers: the worst offenders only, by points, then accidents and damage together ----
    const rows = drivers.filter((d) => d.employment_status === 'active').map((d) => {
      const cs = convictions.filter((c) => c.driver_id === d.id && c.status === 'live' && c.points > 0);
      const a = accidents.filter((i) => i.driver_id === d.id).length; const dm = damage.filter((i) => i.driver_id === d.id).length;
      return { d, points: sum(cs.filter((c) => c.licence_until >= today), (c) => c.points), totting: sum(cs.filter((c) => c.totting_until >= today), (c) => c.points), accidents: a, damage: dm, combined: a + dm };
    }).sort((x, y) => (can.sensitive ? y.points - x.points : 0) || y.combined - x.combined || driverName(x.d).localeCompare(driverName(y.d)));
    const offenders = rows.filter((r) => (can.sensitive && (r.points || r.totting)) || r.combined);
    const shown = allOffenders ? offenders : offenders.slice(0, DRIVERS_SHOWN);
    // What the list is counting, in words. Points are as the licence stands today; accidents and damage are for the period.
    const marks = can.sensitive ? 'points, accidents or damage' : 'accidents or damage';
    const driversLine = !rows.length ? 'There are no active drivers.'
      : !offenders.length ? `No active drivers have ${can.sensitive ? 'points on their licence, or ' : ''}accidents or damage in this period.`
        : offenders.length > DRIVERS_SHOWN ? `Showing ${allOffenders ? `all ${offenders.length}` : `the ${DRIVERS_SHOWN} worst of ${offenders.length}`} drivers with ${marks}.`
          : offenders.length === rows.length ? `${rows.length === 1 ? 'The only active driver has' : `All ${rows.length} active drivers have`} ${marks}.`
            : `${offenders.length} of ${rows.length} active drivers ${offenders.length === 1 ? 'has' : 'have'} ${marks}. The rest are clear.`;
    const series = buildAvailabilitySeries(vehicles, liveEvents, p, today, periods);
    const t = series.totals;

    const fig = (label, value, sub, href, tone = '') => html`<a class="figure ${tone}" href="${href}"><span class="figure-value">${value}</span><span class="figure-label">${label}</span>${sub ? html`<span class="figure-sub">${sub}</span>` : ''}</a>`;
    // A panel heading, with a quiet note of whether it shows today or the chosen period.
    const head = (title, when) => html`<h2>${title}${when ? html` <span class="when">${when}</span>` : ''}</h2>`;
    // A short list: the first few, then a link to the rest, so no panel grows long.
    const capped = (list, max, row, moreHref) => html`<ul class="plain">${list.slice(0, max).map(row)}</ul>${list.length > max ? html`<p class="more"><a href="${moreHref}">And ${list.length - max} more</a></p>` : ''}`;
    const outNow = [...atGarage, ...offRoad];

    // ---- every section of the dashboard. half: true means it sits beside another on a wide screen ----
    const sections = {
      rag: { html: html`<div class="rag-tiles">
        ${ragTile('Overall', R.overall, '#/tasks')}
        ${ragTile('Vehicle pool', R.vehiclePool, screenOn('planner') ? '#/planner' : '#/vehicles?rag=1')}
        ${ragTile('Driver pool', R.driverPool, '#/drivers?rag=1')}
        ${ragTile('Admin', R.admin, '#/tasks?status=overdue')}
      </div>` },

      stats: { html: html`<div class="figures">
        ${fig('Overdue tasks', overdue.length, overdue.length ? plural(overdue.filter((t) => t.is_statutory).length, 'statutory task') : 'Nothing overdue', '#/tasks?status=overdue', overdue.length ? 'tone-bad' : '')}
        ${fig('Due soon', dueSoon.length, 'Inside the warning window', '#/tasks?status=due_soon', dueSoon.length ? 'tone-warn' : '')}
        ${fig('Available vehicles', `${available} of ${live.length}`, unavailableNow ? `${unavailableNow} out of service` : 'None out of service', '#/vehicles')}
        ${fig('Accidents and damage', accidents.length + damage.length, `${plural(accidents.length, 'accident')}, ${damage.length} damage`, '#/reports?report=damage')}
        ${fig('Cost in the period', fmtMoney(running + incidentSpend), `${fmtMoney(running)} running, ${fmtMoney(incidentSpend)} incidents`, '#/reports?report=damage')}
        ${fig('Miles in the period', fmtInt(totalMiles), mileRows.length ? `${fmtInt(Math.round(totalMiles / mileRows.length))} per vehicle` : 'No readings', '#/reports?report=mileage')}
      </div>` },

      fleet: { half: true, html: html`<section class="dash-panel">${head('Fleet status', 'today')}
          <table class="mini"><tbody>
            <tr><th>Available</th><td class="num">${available}</td></tr>
            <tr><th>At a garage</th><td class="num">${atGarage.length}</td></tr>
            <tr><th>Off the road (SORN)</th><td class="num">${count('sorn')}</td></tr>
            ${count('off_road_no_sorn') ? html`<tr class="bad"><th>Off the road, no SORN recorded</th><td class="num">${count('off_road_no_sorn')}</td></tr>` : ''}
            <tr><th>Booked in, next 14 days</th><td class="num">${booked.length}</td></tr>
            ${noCover.length ? html`<tr class="bad"><th>No insurance cover</th><td class="num">${noCover.length}</td></tr>` : ''}
          </tbody></table>
          ${outNow.length ? html`<h3>Out of service now</h3>${capped(outNow, 5, ({ v }) => {
            const late = v.unavailable_expected_return && v.unavailable_expected_return < today;
            return html`<li>${vdot(v.id)}${link(`#/vehicles/${v.id}?tab=availability`, plate(v.registration, v.category), 'plate-link')} <span class="muted">${UNAVAIL_REASON_LABEL[v.unavailable_reason]}${v.unavailable_reason === 'off_road' ? '' : ` at ${gById.get(v.unavailable_garage_id)?.name || 'a garage'}`}, since ${fmtDateShort(v.unavailable_since)}</span>
              ${v.unavailable_expected_return ? html`<span class="${late ? 'c-overdue' : 'muted'}"> ${late ? html`<strong>Back was due</strong>` : 'Back'} ${fmtDateShort(v.unavailable_expected_return)}</span>` : ''}</li>`;
          }, '#/vehicles')}` : ''}
          ${booked.length ? html`<h3>Booked in</h3>${capped(booked, 5, (v) => html`<li>${vdot(v.id)}${link(`#/vehicles/${v.id}?tab=availability`, plate(v.registration, v.category), 'plate-link')} <span class="muted">${fmtDateShort(v.next_booking_date)}</span></li>`, '#/vehicles')}` : ''}
        </section>` },

      attention: { half: true, html: html`<section class="dash-panel">${head('Needs attention', 'today')}
          ${attention.length ? html`<ul class="attn">${attention.map((t) => html`<li><a href="#/tasks?category=${taskCategory(t)}&status=${t.status}">
            <span class="attn-what">${t.vehicle_id && t.applies_to === 'vehicle' ? vdot(t.vehicle_id) : ''}${t.vehicle_id && t.applies_to === 'vehicle' ? plate(vById.get(t.vehicle_id)?.registration || t.target_label.split(' - ')[0], vById.get(t.vehicle_id)?.category) : html`<strong>${t.target_label}</strong>`}</span>
            <span class="attn-due">${pill(t.status)}</span><span class="attn-name">${t.type_name}</span><span class="attn-when muted">${dueText(t.days_remaining)}</span></a></li>`)}</ul>
            <p><a href="#/tasks">See all ${open.length} open tasks</a></p>` : html`<p class="muted">Nothing is overdue or due soon.</p>`}
        </section>` },

      availability: { html: html`<section class="dash-panel wide avail-panel">${head('Vehicle availability', series.unit === 'day' ? 'by day' : `by ${series.unit}, daily averages`)}
        ${chartLegendHtml()}
        <div class="avail-chart" id="avail-chart"></div>
        <p class="chart-detail" id="avail-detail" aria-live="polite">Tap or click a bar for the numbers.</p>
        ${t.vehicleDays ? html`<p class="chart-summary"><strong>${t.pct}%</strong> of vehicle-days were available${t.pctVan != null && t.pctHgv != null ? html` (vans ${t.pctVan}%, HGVs ${t.pctHgv}%)` : ''}. <strong>${fmtInt(Math.round(t.unavailableDays))}</strong> vehicle-days out of service.</p>` : html`<p class="muted">There are no vehicles to show for this period.</p>`}
        <details class="chart-numbers"><summary>Show the numbers</summary>
          <p class="muted">Out of service (red and pink) is at the bottom of each bar and available (green) is above it. HGVs are the darker, striped shade.</p>${numbersTableHtml(series)}</details>
      </section>` },

      incidents: { half: true, html: html`<section class="dash-panel">${head('Accidents, damage and fines', 'in the period')}
          <table class="mini"><tbody>
            <tr><th>Accidents</th><td class="num">${accidents.length}</td></tr><tr><th>Other damage</th><td class="num">${damage.length}</td></tr><tr><th>Fines</th><td class="num">${fines.length}</td></tr>
            <tr class="total"><th>Cost to the company, before insurers</th><td class="num">${fmtMoney(incidentSpend)}</td></tr>
          </tbody></table>
          ${inc.length ? html`<details class="dash-more"><summary>How the cost is made up</summary><table class="mini"><tbody>
            <tr><th>Repair costs</th><td class="num">${fmtMoney(repair)}</td></tr><tr><th>Cost to other parties</th><td class="num">${fmtMoney(third)}</td></tr><tr><th>Fines</th><td class="num">${fmtMoney(fineTotal)}</td></tr>
            <tr><th>Excess paid</th><td class="num">${fmtMoney(excess)}</td></tr><tr><th>Paid by insurers</th><td class="num">${fmtMoney(insurerPaid)}</td></tr>
          </tbody></table></details>
          <h3>Most recent</h3>${capped(inc, 3, (i) => html`<li>${link(`#/incidents/${i.id}`, `${fmtDateShort(i.incident_date)} ${incidentTitle(i)}`)} ${i.vehicle_id && vById.get(i.vehicle_id) ? html`${vdot(i.vehicle_id)}${plate(vById.get(i.vehicle_id).registration, vById.get(i.vehicle_id).category)}` : ''}
            ${dById.get(i.driver_id) ? ddot(i.driver_id) : ''}${dById.get(i.driver_id) ? link(`#/drivers/${i.driver_id}`, driverName(dById.get(i.driver_id))) : html`<span class="muted">${i.driver_id ? 'Archived driver' : 'No driver recorded'}</span>`} <span class="muted">${incidentCost(i) ? fmtMoney(incidentCost(i)) : ''}</span></li>`, '#/incidents')}` : html`<p class="muted">Nothing recorded in this period.</p>`}
          ${linkRow([['#/reports?report=damage', 'Vehicle damage report'], ['#/reports?report=accidents', 'Accidents report']])}
        </section>` },

      downtime: { half: true, html: html`<section class="dash-panel">${head('Downtime and garages', 'in the period')}
          <table class="mini"><tbody><tr><th>Garage visits</th><td class="num">${garageVisits.length}</td></tr><tr><th>Vehicle-days out of service</th><td class="num">${lostDays}</td></tr>
            <tr><th>Vehicles affected</th><td class="num">${new Set(touched.map((e) => e.vehicle_id)).size}</td></tr></tbody></table>
          ${garageVisits.length ? html`<h3>Visits</h3>${capped(garageVisits, 3, (e) => html`<li>${vById.get(e.vehicle_id) ? html`${vdot(e.vehicle_id)}${plate(vById.get(e.vehicle_id).registration, vById.get(e.vehicle_id).category)}` : ''} <span class="muted">${UNAVAIL_REASON_LABEL[e.reason]} at ${gById.get(e.garage_id)?.name || 'a garage'}, ${fmtDateShort(e.from_date)}</span></li>`, '#/reports?report=status')}` : ''}
          ${linkRow([['#/reports?report=status', 'Vehicle status report'], ['#/garages', 'Garages']])}
        </section>` },

      drivers: { html: html`<section class="dash-panel wide">${head('Drivers: worst offenders')}
        <p class="drivers-count">${driversLine}${offenders.length > DRIVERS_SHOWN ? html` <button type="button" class="link" id="drivers-all">${allOffenders ? `Show the ${DRIVERS_SHOWN} worst` : `Show all ${offenders.length}`}</button>` : ''}</p>
        ${shown.length ? html`<table class="grid keep compact drivers-summary"><thead><tr><th>Driver</th>${can.sensitive ? html`<th class="num">Points</th>` : ''}<th class="num">Accidents</th><th class="num">Damage</th><th class="num">Total</th></tr></thead><tbody>
          ${shown.map((r) => html`<tr>
            <td data-label="Driver"><span class="with-rag">${ddot(r.d.id)}${link(`#/drivers/${r.d.id}`, driverName(r.d))}</span></td>
            ${can.sensitive ? html`<td data-label="Points" class="num ${r.totting >= 12 ? 'n-overdue' : r.totting >= 9 ? 'n-due_soon' : ''}">${r.points ? html`<strong>${r.points}</strong>` : html`<span class="muted">0</span>`}${r.totting >= 6 ? html`<div class="sub">${r.totting} totting up</div>` : ''}</td>` : ''}
            <td data-label="Accidents" class="num">${r.accidents || html`<span class="muted">0</span>`}</td>
            <td data-label="Damage" class="num">${r.damage || html`<span class="muted">0</span>`}</td>
            <td data-label="Total" class="num">${r.combined ? html`<strong>${r.combined}</strong>` : html`<span class="muted">0</span>`}</td></tr>`)}
        </tbody></table>
        <p class="muted drivers-note">${can.sensitive ? 'Points are on the licence now. ' : ''}Accidents and damage are for the period.</p>` : ''}
        <p><a href="#/drivers">All drivers</a></p>
      </section>` },
    };

    // The sections the superuser has left on, in the order set in Settings. Half-width panels that follow one another
    // are laid out side by side; one on its own takes the full width.
    const parts = []; let row = [];
    const flush = () => { if (row.length) parts.push(html`<div class="dash-grid">${row}</div>`); row = []; };
    for (const { id } of dashLayout().filter((x) => x.show)) {
      const sec = sections[id]; if (!sec) continue;
      if (sec.half) row.push(sec.html); else { flush(); parts.push(sec.html); }
    }
    flush();

    mount(main, html`
      <header class="page-head"><h1>Dashboard</h1></header>
      ${periodControlsHtml(p)}
      <p class="muted period-note">Showing <strong>${periodLabel(p)}</strong></p>
      <div class="dash">${parts}</div>`);
    wirePeriod(main, p, onPeriod);
    main.querySelector('#drivers-all')?.addEventListener('click', () => { allOffenders = !allOffenders; const y = window.scrollY; render(); window.scrollTo?.(0, y); });
    drawChart(series);
  }

  // costs and mileage depend on the period, so they are fetched again when it changes
  async function onPeriod() {
    const mine = ++changing;
    const next = await fetchPeriod(p);
    if (mine !== changing) return; // the period was changed again meanwhile
    [costs, mileRowsRaw] = next;
    render();
  }
  render();
}
