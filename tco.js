// Total cost of ownership: what each vehicle cost over a chosen period, month by month.
// This file is only the sums (no screen, no database), so they can be tested on their own. See costs.js for the screens.
//
// Two kinds of cost:
//   Captured    entered against the vehicle as a cost: tyres, servicing, repairs, tax and other.
//   Calculated  worked out from other records:
//     Fuel         miles in the month (read between mileage readings) / miles per gallon x litres per gallon x that month's price.
//                  Electric vehicles use miles per kWh and a price per kWh instead.
//     Insurance    the vehicle's share of each policy's yearly premium, for the days it was covered.
//     Finance      lease, rental or finance payments from the vehicle record, for the days it was in the fleet and in term.
//     Accidents    repair and third-party costs from the incident register, less what the insurer paid.
//     Fines        from the incident register, unless recharged to the driver or the appeal was upheld.
//     Loss in value  for owned vehicles, purchase price less sale price, counted when the vehicle is disposed of.
// Nothing is counted twice: where a cost of the same kind has been entered by hand for a month (fuel, insurance,
// lease or accident), the entered figure is used for that month and the calculated one is left out.
import { parseISO, toISO, addDaysISO } from './ui.js';

export const LITRES_PER_GALLON = 4.54609;
// Used only when a vehicle has no figure of its own. Changeable in Settings (organisations.settings.typical_mpg).
export const DEFAULT_TYPICAL_MPG = { car: 45, van: 32, light_goods: 30, hgv: 12, bus: 10, other: 30 };
export const DEFAULT_MILES_PER_KWH = 2.5;
export const CAPTURED = ['tyres', 'servicing', 'repairs', 'tax', 'other'];          // always taken as entered
export const COMPONENTS = ['fuel', 'insurance', 'finance', 'accident', 'fines', 'loss'];
const FUEL_PRICE_TYPE = { petrol: 'petrol', hybrid: 'petrol', plug_in_hybrid: 'petrol', diesel: 'diesel', electric: 'electric' };

const dayNum = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d) / 86400000; };   // whole days, free of clock changes
const daysBetween = (a, b) => dayNum(b) - dayNum(a) + 1;                       // inclusive
const maxD = (a, b) => (a > b ? a : b); const minD = (a, b) => (a < b ? a : b);
// days that [a1, a2] and [b1, b2] share; a null end is open
const overlapDays = (a1, a2, b1, b2) => { const s = b1 && b1 > a1 ? b1 : a1; const e = b2 && b2 < a2 ? b2 : a2; return s <= e ? daysBetween(s, e) : 0; };
const monthStart = (iso) => `${iso.slice(0, 7)}-01`;
const monthEnd = (iso) => { const d = parseISO(monthStart(iso)); d.setMonth(d.getMonth() + 1); d.setDate(0); return toISO(d); };
const nextMonth = (iso) => { const d = parseISO(monthStart(iso)); d.setMonth(d.getMonth() + 1); return toISO(d); };
const num = (x) => Number(x || 0);

// The odometer at the end of any day, read off a straight line between the readings either side of it.
// Before the first reading it is the first reading; after the last it is the last (no guessing forward).
export function mileageCurve(points) {
  const pts = points.filter((p) => p.date && p.mileage != null).map((p) => ({ n: dayNum(p.date), m: Number(p.mileage), date: p.date })).sort((a, b) => a.n - b.n || a.m - b.m);
  const at = (iso) => {
    if (!pts.length) return 0;
    const n = dayNum(iso);
    if (n <= pts[0].n) return pts[0].m;
    if (n >= pts[pts.length - 1].n) return pts[pts.length - 1].m;
    let i = 1; while (pts[i].n < n) i++;
    const a = pts[i - 1]; const b = pts[i];
    return b.n === a.n ? b.m : a.m + ((b.m - a.m) * (n - a.n)) / (b.n - a.n);
  };
  return { at, first: pts[0]?.date || null, last: pts[pts.length - 1]?.date || null, count: pts.length, miles: (from, to) => Math.max(0, at(to) - at(addDaysISO(from, -1))) };
}

// The price for a month: that month's own figure, or failing that the latest earlier one (carried forward).
function priceFor(prices, type, month) {
  const list = prices[type] || [];
  let hit = null;
  for (const p of list) { if (p.month <= month) hit = p; else break; }
  return hit ? { price: Number(hit.price), carried: hit.month !== month, from: hit.month } : null;
}

export function buildTco({ vehicles, periods = [], costs = [], readings = [], fuelPrices = [], policies = [], policyVehicles = [], incidents = [], settings = {}, from, to, today = toISO(new Date()) }) {
  const typicalMpg = { ...DEFAULT_TYPICAL_MPG, ...(settings.typical_mpg || {}) };
  const typicalKwh = Number(settings.typical_miles_per_kwh) > 0 ? Number(settings.typical_miles_per_kwh) : DEFAULT_MILES_PER_KWH;
  const prices = {};
  for (const p of [...fuelPrices].sort((a, b) => a.month.localeCompare(b.month))) (prices[p.fuel_type] ||= []).push(p);
  const group = (list, key) => { const m = new Map(); for (const x of list) { if (!m.has(x[key])) m.set(x[key], []); m.get(x[key]).push(x); } return m; };
  const periodsBy = group(periods, 'vehicle_id'); const costsBy = group(costs, 'vehicle_id'); const readingsBy = group(readings, 'vehicle_id');
  const pvBy = group(policyVehicles, 'vehicle_id'); const pvByPolicy = group(policyVehicles, 'policy_id');
  const incBy = group(incidents.filter((i) => i.vehicle_id && !i.archived_at), 'vehicle_id');
  const policyById = new Map(policies.filter((p) => p.status !== 'cancelled' && !p.archived_at).map((p) => [p.id, p]));
  const months = []; for (let m = monthStart(from); m <= to; m = nextMonth(m)) months.push(m);

  const rows = vehicles.map((v) => {
    const ps = periodsBy.get(v.id) || [{ start_date: v.date_acquired || null, end_date: v.status === 'disposed' ? v.disposed_date : null }];
    const inFleetDays = (a, b) => ps.reduce((s, p) => s + overlapDays(a, b, p.start_date, p.end_date), 0);
    const firstStart = ps.map((p) => p.start_date).filter(Boolean).sort()[0] || v.date_acquired || null;
    const curve = mileageCurve([
      ...(firstStart && v.opening_mileage != null ? [{ date: firstStart, mileage: v.opening_mileage }] : []),
      ...(readingsBy.get(v.id) || []).map((r) => ({ date: r.reading_date, mileage: r.mileage })),
    ]);
    const notes = new Set();
    const priceType = FUEL_PRICE_TYPE[v.fuel_type] || null;
    const electric = priceType === 'electric';
    const own = Number(v.mpg) > 0 ? Number(v.mpg) : null;
    const economy = own || (electric ? typicalKwh : typicalMpg[v.category]) || null;
    const unit = electric ? 'miles per kWh' : 'mpg';
    const vCosts = costsBy.get(v.id) || []; const vInc = incBy.get(v.id) || []; const vPv = pvBy.get(v.id) || [];
    const financed = ['leased', 'hired', 'financed'].includes(v.ownership_type) && num(v.monthly_payment) > 0;
    const termStart = v.term_start || firstStart;

    const monthRows = months.map((m) => {
      const a = maxD(m, from); const b = minD(monthEnd(m), to);
      const r = { month: m, miles: 0, tyres: 0, servicing: 0, repairs: 0, tax: 0, other: 0, fuel: 0, insurance: 0, finance: 0, accident: 0, fines: 0, loss: 0, basis: {} };
      const entered = { fuel: 0, insurance: 0, lease: 0, accident: 0 };
      for (const c of vCosts) {
        if (c.cost_date < a || c.cost_date > b) continue;
        if (CAPTURED.includes(c.category)) r[c.category] += num(c.amount); else if (c.category in entered) entered[c.category] += num(c.amount);
      }
      const days = inFleetDays(a, b);
      r.miles = days && curve.count > 1 ? ps.reduce((s, p) => { const s1 = p.start_date && p.start_date > a ? p.start_date : a; const e1 = p.end_date && p.end_date < b ? p.end_date : b; return s1 <= e1 ? s + curve.miles(s1, e1) : s; }, 0) : 0;

      // fuel
      if (entered.fuel > 0) { r.fuel = entered.fuel; r.basis.fuel = 'entered'; } else if (r.miles > 0) {
        const price = priceType ? priceFor(prices, priceType, m) : null;
        if (!priceType) notes.add(`Fuel is not calculated for ${v.fuel_type ? `${v.fuel_type.replace(/_/g, ' ')} vehicles` : 'vehicles with no fuel type'}`);
        else if (!economy) notes.add(`No ${unit} figure for this vehicle or its type, so fuel is not calculated`);
        else if (!price) notes.add(`No ${priceType} price entered${electric ? ' (pence per kWh)' : ''}, so fuel is not calculated`);
        else {
          r.fuel = electric ? (r.miles / economy) * (price.price / 100) : (r.miles / economy) * LITRES_PER_GALLON * (price.price / 100);
          r.basis.fuel = 'calculated';
          if (!own) notes.add(`Fuel uses the typical ${economy} ${unit} for this type of vehicle, not a figure for this vehicle`);
          if (price.carried) notes.add('Fuel for some months uses the latest earlier price, because no price was entered for that month');
        }
      }
      // insurance
      if (entered.insurance > 0) { r.insurance = entered.insurance; r.basis.insurance = 'entered'; } else {
        for (const pv of vPv) {
          const pol = policyById.get(pv.policy_id); if (!pol) continue;
          const cs = pv.start_date && pv.start_date > pol.start_date ? pv.start_date : pol.start_date; const ce = pv.end_date && pv.end_date < pol.end_date ? pv.end_date : pol.end_date;
          const d = overlapDays(a, b, cs, ce); if (!d) continue;
          let yearly;
          if (pol.premium_allocation === 'manual') yearly = num(pv.allocated_premium);
          else {
            const sharing = (pvByPolicy.get(pol.id) || []).filter((x) => overlapDays(a, b, x.start_date && x.start_date > pol.start_date ? x.start_date : pol.start_date, x.end_date && x.end_date < pol.end_date ? x.end_date : pol.end_date) > 0).length || 1;
            yearly = num(pol.annual_premium) / sharing;
          }
          r.insurance += (yearly * d) / 365; r.basis.insurance = 'calculated';
        }
      }
      // lease, rental or finance payments
      if (entered.lease > 0) { r.finance = entered.lease; r.basis.finance = 'entered'; } else if (financed) {
        const inTerm = ps.reduce((s, p) => { const s1 = maxD(a, maxD(p.start_date || a, termStart || a)); const e1 = minD(b, minD(p.end_date || b, v.term_end || b)); return s1 <= e1 ? s + daysBetween(s1, e1) : s; }, 0);
        if (inTerm) { r.finance = (num(v.monthly_payment) * inTerm) / daysBetween(m, monthEnd(m)); r.basis.finance = 'calculated'; }
        if (num(v.initial_payment) > 0 && termStart && termStart >= a && termStart <= b) { r.finance += num(v.initial_payment); r.basis.finance = 'calculated'; }
      }
      // accidents, damage and fines from the incident register
      const here = vInc.filter((i) => i.incident_date >= a && i.incident_date <= b);
      if (entered.accident > 0) { r.accident = entered.accident; r.basis.accident = 'entered'; } else {
        for (const i of here) if (i.kind === 'accident' || i.kind === 'damage') r.accident += Math.max(0, num(i.repair_cost) + num(i.third_party_cost) - num(i.insurer_paid));
        if (r.accident) r.basis.accident = 'calculated';
      }
      for (const i of here) if (i.kind === 'fine' && !i.recharge_to_driver && i.appeal_status !== 'upheld') r.fines += num(i.fine_amount);
      // loss in value: owned vehicles, in the month they left the fleet
      if (v.ownership_type === 'owned' && num(v.purchase_price) > 0) {
        for (const p of ps) if (p.end_date && p.end_date >= a && p.end_date <= b) {
          r.loss += Math.max(0, num(v.purchase_price) - num(p.sale_price));
          if (p.sale_price == null) notes.add('No sale price was recorded, so the whole purchase price is counted as loss in value');
        }
      }
      r.captured = CAPTURED.reduce((s, k) => s + r[k], 0);
      r.total = r.captured + r.fuel + r.insurance + r.finance + r.accident + r.fines + r.loss;
      return r;
    });

    const sum = (k) => monthRows.reduce((s, r) => s + r[k], 0);
    const out = { v, months: monthRows, notes: [...notes], miles: sum('miles'), captured: sum('captured'), total: sum('total'), daysInFleet: inFleetDays(from, to) };
    for (const k of [...CAPTURED, ...COMPONENTS]) out[k] = sum(k);
    const stillOwned = v.ownership_type === 'owned' && num(v.purchase_price) > 0 && ps.some((p) => !p.end_date);
    out.lossKnown = !stillOwned;
    if (stillOwned) out.notes.push('Still owned, so its loss in value is not known yet and is not in the total');
    if (curve.count < 2) out.notes.push('Fewer than two mileage readings, so miles and fuel cannot be worked out');
    // still in the fleet, and more than a month has gone by without a reading
    else if (ps.some((p) => !p.end_date) && curve.last < addDaysISO(minD(to, today), -31)) { out.lastReading = curve.last; out.notes.push('No mileage reading since {lastReading}: miles and fuel after that date are not counted'); }
    out.perMile = out.miles > 0 ? out.total / out.miles : null;
    out.basis = Object.fromEntries(['fuel', 'insurance', 'finance', 'accident'].map((k) => { const kinds = new Set(monthRows.map((r) => r.basis[k]).filter(Boolean)); return [k, kinds.size > 1 ? 'mixed' : [...kinds][0] || null]; }));
    out.active = out.daysInFleet > 0 || out.total > 0;
    return out;
  });

  const totals = { miles: 0, captured: 0, total: 0 };
  for (const k of [...CAPTURED, ...COMPONENTS]) totals[k] = 0;
  for (const r of rows) { totals.miles += r.miles; totals.captured += r.captured; totals.total += r.total; for (const k of [...CAPTURED, ...COMPONENTS]) totals[k] += r[k]; }
  totals.perMile = totals.miles > 0 ? totals.total / totals.miles : null;
  return { from, to, months, rows, totals };
}
