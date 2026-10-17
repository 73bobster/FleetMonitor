// The exit pack: everything the organisation has put into FleetRecord, as files that open without FleetRecord.
// It runs in the superuser's own browser under their own sign-in, so it can only read what they are allowed to read, and
// nothing is sent anywhere. Contents (all in one zip):
//   README.txt                  what is in the pack and how to use it
//   FleetRecord data.xlsx       one readable workbook (a sheet per subject, filters on, live "due" formulas on Compliance)
//   csv/<table>.csv             the complete, unedited rows of every table (the lossless copy)
//   documents/...               every uploaded file, sorted into folders
//   manifest.json               each file with its size and SHA-256 fingerprint
//   reconciliation.csv          rows in the database against rows exported, per table
// Driver licence, conviction and licence-check data is only included when the superuser ticks the separate box.
import * as api from './api.js';
import { state } from './state.js';
import { buildWorkbook, buildCsv } from './workbook.js';
import { buildZip } from './zipper.js';
import { CATEGORY_LABEL, COST_CATEGORY_LABEL, DOC_CATEGORY_LABEL, driverName, incidentTitle } from './domain.js';

const enc = new TextEncoder();
const RESTRICTED_DOC_CATEGORIES = ['licence_photo', 'licence_check', 'conviction_notice'];
const RESTRICTED_AUDIT_TABLES = ['driver_sensitive', 'driver_convictions', 'licence_checks'];
const AUDIT_SHEET_CAP = 50000;

// Every table that is exported, in the order it appears in the pack.
// restricted: only with the licence-data box ticked. omit: columns that are secrets and never leave the database.
export const TABLES = [
  { name: 'organisations', scope: 'self' },
  { name: 'depots' }, { name: 'vehicles' }, { name: 'vehicle_periods' }, { name: 'drivers' }, { name: 'driver_periods' },
  { name: 'vehicle_assignments' }, { name: 'vehicle_requirements' }, { name: 'vehicle_unavailability' },
  { name: 'compliance_types' }, { name: 'compliance_items' }, { name: 'compliance_renewals' }, { name: 'task_states' },
  { name: 'incidents' }, { name: 'insurance_policies' }, { name: 'policy_vehicles' }, { name: 'insurance_claims' },
  { name: 'vehicle_costs' }, { name: 'odometer_readings' }, { name: 'fuel_prices' }, { name: 'garages' }, { name: 'contacts' },
  { name: 'documents' }, { name: 'message_templates' }, { name: 'message_log' }, { name: 'external_links' }, { name: 'feedback_items' },
  { name: 'memberships' }, { name: 'invitations', omit: ['token'] }, { name: 'support_grants' },
  { name: 'integration_connections', omit: ['config', 'vault_secret_id'] },
  { name: 'audit_log' },
  { name: 'compliance_type_library', scope: 'none', key: 'code' }, { name: 'conviction_codes', scope: 'none', key: 'code' },
  { name: 'driver_sensitive', key: 'driver_id', restricted: true }, { name: 'driver_convictions', restricted: true }, { name: 'licence_checks', restricted: true },
];

const yn = (v) => (v === null || v === undefined ? '' : v ? 'Yes' : 'No');
const list = (a) => (Array.isArray(a) ? a.join('; ') : a ?? '');
const day = (d) => (d ? String(d).slice(0, 10) : '');
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const T = (key, label, width = 16) => ({ key, label, width, type: 'text' });
const D = (key, label) => ({ key, label, width: 12, type: 'date' });
const M = (key, label) => ({ key, label, width: 12, type: 'money' });
const I = (key, label, width = 10) => ({ key, label, width, type: 'int' });
const N = (key, label) => ({ key, label, width: 10, type: 'number' });
const safe = (s) => String(s ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^[. ]+|[. ]+$/g, '').slice(-100) || 'file';
const sortBy = (rows, f) => [...rows].sort((a, b) => String(f(a) ?? '').localeCompare(String(f(b) ?? '')));
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
export const sha256 = async (bytes) => hex(await globalThis.crypto.subtle.digest('SHA-256', bytes));

// Days left and status as Excel computes them, so the saved values agree with the live formulas.
function dueStatus(item, today) {
  if (item.applicable === false) return { days: null, status: 'Not applicable' };
  if (!item.due_date) return { days: null, status: 'No date' };
  const [y, m, d] = item.due_date.slice(0, 10).split('-').map(Number);
  const days = Math.round((Date.UTC(y, m - 1, d) - today) / 86400000);
  return { days, status: days < 0 ? 'Overdue' : days <= 30 ? 'Due soon' : 'OK' };
}

export async function buildExitPack({ includeRestricted = false, includeDocuments = true, passphrase = '', onProgress = () => {}, isCancelled = () => false, now = new Date() } = {}) {
  const check = () => { if (isCancelled()) throw new Error('Cancelled.'); };
  const orgName = state.org.name;
  const stamp = now.toISOString().slice(0, 10);
  const root = `fleetrecord-exit-pack-${safe(state.org.slug || orgName).toLowerCase().replace(/\s+/g, '-')}-${stamp}`;
  const todayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());

  // ---- 1. read every table ------------------------------------------------------------------
  const tables = TABLES.filter((t) => includeRestricted || !t.restricted);
  const data = {}; const recon = [];
  for (let i = 0; i < tables.length; i++) {
    check();
    const t = tables[i];
    onProgress({ stage: 'Reading your data', message: t.name.replace(/_/g, ' '), done: i, total: tables.length });
    try {
      const expected = await api.countTable(t.name, t);
      let rows = await api.exportTable(t.name, t);
      if (t.omit) rows = rows.map((r) => { const c = { ...r }; for (const k of t.omit) delete c[k]; return c; });
      if (t.name === 'audit_log' && !includeRestricted) rows = rows.map((r) => (RESTRICTED_AUDIT_TABLES.includes(r.table_name) ? { ...r, old_data: null, new_data: null } : r));
      data[t.name] = rows;
      recon.push({ table: t.name, expected, exported: rows.length, result: rows.length === expected ? 'OK' : 'DIFFERENT', note: t.omit ? `columns left out for security: ${t.omit.join(', ')}` : '' });
    } catch (e) {   // one unreadable table must not block the rest, but it must be loud
      data[t.name] = [];
      recon.push({ table: t.name, expected: '', exported: 0, result: 'FAILED', note: e.message || 'could not be read' });
    }
  }
  for (const t of TABLES.filter((x) => x.restricted && !includeRestricted)) recon.push({ table: t.name, expected: '', exported: 0, result: 'WITHHELD', note: 'licence data not requested' });
  const members = await api.listMembers();
  const get = (n) => data[n] || [];

  // ---- 2. lookups ---------------------------------------------------------------------------
  const by = (rows) => new Map(rows.map((r) => [r.id, r]));
  const veh = by(get('vehicles')); const drv = by(get('drivers')); const dep = by(get('depots')); const gar = by(get('garages'));
  const con = by(get('contacts')); const pol = by(get('insurance_policies')); const cty = by(get('compliance_types')); const itm = by(get('compliance_items'));
  const usr = new Map(members.map((m) => [m.user_id, m.email || m.display_name || m.user_id]));
  const reg = (id) => veh.get(id)?.registration || '';
  const dn = (id) => (drv.get(id) ? driverName(drv.get(id)) : '');
  const nm = (map, id) => map.get(id)?.name || '';
  const who = (id) => usr.get(id) || '';
  const latest = new Map();
  for (const r of get('odometer_readings')) { const c = latest.get(r.vehicle_id); if (!c || r.reading_date > c.reading_date || (r.reading_date === c.reading_date && r.mileage > c.mileage)) latest.set(r.vehicle_id, r); }

  // ---- 3. documents -------------------------------------------------------------------------
  const docRows = []; const docFiles = []; let docBytes = 0;
  const docs = get('documents');
  const folderOf = (d) => {
    const cat = safe(DOC_CATEGORY_LABEL[d.category] || d.category || 'Other');
    if (d.vehicle_id) return `vehicles/${safe(reg(d.vehicle_id) || d.vehicle_id.slice(0, 8))}/${cat}`;
    if (d.driver_id) return `drivers/${safe(dn(d.driver_id) || d.driver_id.slice(0, 8))}/${cat}`;
    if (d.incident_id) { const inc = get('incidents').find((x) => x.id === d.incident_id); return `incidents/${safe(`${day(inc?.incident_date)} ${incidentTitle(inc || {})} ${d.incident_id.slice(0, 8)}`)}/${cat}`; }
    if (d.policy_id || d.claim_id) { const p = pol.get(d.policy_id || get('insurance_claims').find((c) => c.id === d.claim_id)?.policy_id); return `insurance/${safe(p?.policy_number || 'policy')}/${cat}`; }
    return `other/${cat}`;
  };
  const withheld = (d) => !includeRestricted && RESTRICTED_DOC_CATEGORIES.includes(d.category);
  const toFetch = docs.filter((d) => includeDocuments && !withheld(d) && d.storage_path);
  let fetched = 0;
  const queue = [...toFetch];
  const results = new Map();
  const worker = async () => {
    while (queue.length) {
      check();
      const d = queue.shift();
      try {
        const bytes = await api.downloadDocument(d.storage_path);
        const path = `documents/${folderOf(d)}/${d.id.slice(0, 8)}-${safe(d.file_name)}`;
        results.set(d.id, { path, bytes, sha: await sha256(bytes) });
      } catch (e) { results.set(d.id, { error: e.message || 'could not be downloaded' }); }
      fetched += 1;
      onProgress({ stage: 'Downloading documents', message: `${fetched} of ${toFetch.length}`, done: fetched, total: toFetch.length });
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  let docFailed = 0;
  for (const d of docs) {
    const r = results.get(d.id);
    let included = 'No (documents not requested)';
    if (withheld(d)) included = 'No (licence data withheld)';
    else if (!d.storage_path) included = 'No (no file stored)';
    else if (r?.error) { included = `FAILED: ${r.error}`; docFailed += 1; }
    else if (r) { included = 'Yes'; docFiles.push({ name: r.path, data: r.bytes }); docBytes += r.bytes.length; }
    docRows.push({ ...d, _included: included, _path: r?.path || '', _sha: r?.sha || '' });
  }

  // ---- 4. readable workbook -----------------------------------------------------------------
  check();
  onProgress({ stage: 'Building the spreadsheet', message: '', done: 0, total: 1 });
  const sheets = [];
  const add = (name, title, subtitle, columns, rows, extra = {}) => sheets.push({ name, title, subtitle, columns, rows, ...extra });

  const readme = readmeLines({ orgName, now, includeRestricted, includeDocuments, root, passphrase: !!passphrase, docFailed });
  add('README', `${orgName}: FleetRecord exit pack`, `Created ${now.toISOString().slice(0, 16).replace('T', ' ')} UTC by ${state.user?.email || 'a superuser'}`,
    [T('topic', 'Topic', 28), T('detail', 'Detail', 110)], readme.map(([topic, detail]) => ({ topic, detail })));

  const total = (n) => get(n).length;
  add('Summary', 'Summary and checks', 'Rows in the database against rows in this pack. Anything other than OK or WITHHELD needs a look.',
    [T('table', 'Table', 28), T('expected', 'Rows in database', 16), T('exported', 'Rows in pack', 14), T('result', 'Result', 12), T('note', 'Note', 50)],
    [...recon, { table: 'documents (files)', expected: docs.length, exported: docFiles.length, result: docFailed ? 'FAILED' : 'OK', note: includeDocuments ? `${docFailed} could not be downloaded` : 'not requested' }]);

  const o = get('organisations')[0] || {};
  const settingRows = [['Name', o.name], ['Short name', o.slug], ['Status', o.status], ['Country', o.country], ['Time zone', o.timezone], ['Locale', o.locale], ['Currency', o.currency]];
  for (const [k, v] of Object.entries(o.settings || {})) settingRows.push([`Setting: ${k}`, typeof v === 'object' ? JSON.stringify(v) : v]);
  for (const [k, v] of Object.entries(o.terminology || {})) settingRows.push([`Wording: ${k}`, typeof v === 'object' ? JSON.stringify(v) : v]);
  add('Organisation', 'Organisation and settings', 'Branding images are not included; the logo file is in the documents folder if it was uploaded as a document.',
    [T('k', 'Setting', 34), T('v', 'Value', 80)], settingRows.map(([k, v]) => ({ k, v: v ?? '' })));

  add('Vehicles', 'Vehicles', 'Every vehicle, including archived and disposed ones.',
    [T('reg', 'Registration', 13), T('fleet', 'Fleet no', 10), T('nick', 'Nickname', 14), T('cat', 'Category', 14), T('make', 'Make', 12), T('model', 'Model', 14), T('body', 'Body type', 12), T('colour', 'Colour', 10), T('vin', 'VIN', 20), D('first', 'First registered'), I('year', 'Year'), T('fuel', 'Fuel', 10), I('gvw', 'Gross weight kg'), I('payload', 'Payload kg'), I('seats', 'Seats'), N('mpg', 'MPG'), T('own', 'Ownership', 12), T('supplier', 'Supplier', 18), D('acq', 'Acquired'), I('open', 'Opening mileage', 12), I('last', 'Latest mileage', 12), D('lastdate', 'Latest reading date'), M('price', 'Purchase price'), M('init', 'Initial payment'), M('monthly', 'Monthly payment'), D('ts', 'Term start'), D('te', 'Term end'), I('capped', 'Capped miles', 12), M('xs', 'Cost per excess mile'), T('status', 'Status', 10), D('disp', 'Disposed'), T('dreason', 'Disposal reason', 18), M('sale', 'Sale price'), T('sold', 'Sold to', 16), T('depot', 'Depot', 14), D('arch', 'Archived'), T('notes', 'Notes', 40)],
    sortBy(get('vehicles'), (v) => v.registration).map((v) => ({ reg: v.registration, fleet: v.fleet_number, nick: v.nickname, cat: CATEGORY_LABEL[v.category] || v.category, make: v.make, model: v.model, body: v.body_type, colour: v.colour, vin: v.vin, first: day(v.first_registered_date), year: v.year_of_manufacture, fuel: v.fuel_type, gvw: v.gross_weight_kg, payload: v.payload_kg, seats: v.seats, mpg: num(v.mpg), own: v.ownership_type, supplier: nm(con, v.supplier_id), acq: day(v.date_acquired), open: v.opening_mileage, last: latest.get(v.id)?.mileage, lastdate: day(latest.get(v.id)?.reading_date), price: num(v.purchase_price), init: num(v.initial_payment), monthly: num(v.monthly_payment), ts: day(v.term_start), te: day(v.term_end), capped: v.capped_miles, xs: num(v.cost_per_excess_mile), status: v.status, disp: day(v.disposed_date), dreason: v.disposal_reason, sale: num(v.sale_price), sold: v.sold_to, depot: nm(dep, v.depot_id), arch: day(v.archived_at), notes: [v.notes, v.disposal_notes].filter(Boolean).join(' | ') })));

  add('Vehicle periods', 'Vehicle periods', 'Each spell a vehicle was in the fleet.',
    [T('reg', 'Registration', 13), D('s', 'Start'), D('e', 'End'), T('r', 'Disposal reason', 20), M('p', 'Sale price'), T('to', 'Sold to', 18), T('n', 'Notes', 40)],
    sortBy(get('vehicle_periods'), (p) => reg(p.vehicle_id) + day(p.start_date)).map((p) => ({ reg: reg(p.vehicle_id), s: day(p.start_date), e: day(p.end_date), r: p.disposal_reason, p: num(p.sale_price), to: p.sold_to, n: p.notes })));

  add('Drivers', 'Drivers', 'Every driver, including leavers and archived. Licence details are in the separate licence sheets, only when requested.',
    [T('name', 'Name', 22), T('nick', 'Nickname', 12), T('emp', 'Employee no', 12), T('job', 'Job title', 18), T('status', 'Status', 12), T('depot', 'Depot', 14), D('s', 'Start'), D('e', 'End'), T('email', 'Email', 26), T('wm', 'Work mobile', 14), T('pm', 'Personal mobile', 14), T('cp', 'Company phone', 10), D('arch', 'Archived'), T('n', 'Notes', 40)],
    sortBy(get('drivers'), (d) => `${d.last_name} ${d.first_name}`).map((d) => ({ name: driverName(d), nick: d.nickname, emp: d.employee_number, job: d.job_title, status: d.employment_status, depot: nm(dep, d.depot_id), s: day(d.start_date), e: day(d.end_date), email: d.email, wm: d.mobile_work, pm: d.mobile_personal, cp: yn(d.company_phone), arch: day(d.archived_at), n: d.notes })));

  add('Driver periods', 'Driver periods', 'Each spell a driver was employed.',
    [T('name', 'Driver', 22), D('s', 'Start'), D('e', 'End'), T('emp', 'Employee no', 12), T('job', 'Job title', 18), T('r', 'Leaving reason', 22), T('n', 'Notes', 40)],
    sortBy(get('driver_periods'), (p) => dn(p.driver_id) + day(p.start_date)).map((p) => ({ name: dn(p.driver_id), s: day(p.start_date), e: day(p.end_date), emp: p.employee_number, job: p.job_title, r: p.leaving_reason, n: p.notes })));

  add('Assignments', 'Vehicle assignments', 'Who drove or was responsible for which vehicle, and when.',
    [T('reg', 'Registration', 13), T('name', 'Driver', 22), T('type', 'Type', 12), D('s', 'Start'), D('e', 'End'), T('o', 'Override reason', 30), T('n', 'Notes', 40)],
    sortBy(get('vehicle_assignments'), (a) => reg(a.vehicle_id) + day(a.start_date)).map((a) => ({ reg: reg(a.vehicle_id), name: dn(a.driver_id), type: a.assignment_type, s: day(a.start_date), e: day(a.end_date), o: a.override_reason, n: a.notes })));

  const comp = sortBy(get('compliance_items'), (i) => `${i.vehicle_id ? reg(i.vehicle_id) : dn(i.driver_id)} ${cty.get(i.compliance_type_id)?.name || ''}`).map((i) => {
    const s = dueStatus(i, todayUtc);
    return { kind: i.vehicle_id ? 'Vehicle' : 'Driver', subject: i.vehicle_id ? reg(i.vehicle_id) : dn(i.driver_id), req: cty.get(i.compliance_type_id)?.name || '', app: i.applicable === false ? 'No' : 'Yes', last: day(i.last_completed_date), due: day(i.due_date), ref: i.reference, days: s.days, status: s.status, n: i.notes };
  });
  add('Compliance', 'Compliance: what is due', 'LIVE: Days left and Status are Excel formulas using today\'s date, so this sheet stays up to date. "Due soon" means 30 days or fewer; change the 30 inside column I if you want a different window. Filters are on.',
    [T('kind', 'Applies to', 10), T('subject', 'Vehicle or driver', 22), T('req', 'Requirement', 30), T('app', 'Applicable', 10), D('last', 'Last completed'), D('due', 'Due date'), T('ref', 'Reference', 18),
      { key: 'days', label: 'Days left', type: 'int', width: 10, formula: (r) => `IF(OR(F${r}="",D${r}="No"),"",F${r}-TODAY())` },
      { key: 'status', label: 'Status', type: 'text', width: 16, formula: (r) => `IF(D${r}="No","Not applicable",IF(F${r}="","No date",IF(F${r}<TODAY(),"Overdue",IF(F${r}-TODAY()<=30,"Due soon","OK"))))` },
      T('n', 'Notes', 40)],
    comp, { cf: [{ col: 'status', rules: [['Overdue', 0], ['Due soon', 1], ['OK', 2]] }] });

  add('Renewals', 'Compliance renewals', 'Every recorded renewal (MOT, tax, service, licence checks and so on).',
    [D('done', 'Completed'), T('subject', 'Vehicle or driver', 22), T('req', 'Requirement', 28), D('prev', 'Previous due'), D('next', 'New due'), T('ref', 'Reference', 18), M('cost', 'Cost'), T('doc', 'Document', 30), T('n', 'Notes', 40)],
    sortBy(get('compliance_renewals'), (r) => r.completed_on).reverse().map((r) => { const it = itm.get(r.compliance_item_id); return { done: day(r.completed_on), subject: it ? (it.vehicle_id ? reg(it.vehicle_id) : dn(it.driver_id)) : '', req: cty.get(it?.compliance_type_id)?.name || '', prev: day(r.previous_due_date), next: day(r.new_due_date), ref: r.reference, cost: num(r.cost), doc: docs.find((d) => d.id === r.document_id)?.file_name || '', n: r.notes }; }));

  add('Compliance types', 'Compliance types', 'What the organisation tracks, and how often.',
    [T('code', 'Code', 16), T('name', 'Name', 30), T('applies', 'Applies to', 10), T('every', 'Repeats every', 14), T('lead', 'Reminder lead days', 18), I('esc', 'Escalate after days'), T('stat', 'Statutory', 10), T('active', 'Active', 8), T('d', 'Description', 50)],
    sortBy(get('compliance_types'), (t) => String(t.sort_order ?? 0).padStart(5, '0')).map((t) => ({ code: t.code, name: t.name, applies: t.applies_to, every: t.interval_value ? `${t.interval_value} ${t.interval_unit}` : '', lead: list(t.lead_days), esc: t.escalate_after_days, stat: yn(t.is_statutory), active: yn(t.is_active), d: t.description })));

  add('Incidents', 'Incidents and fines', 'Accidents, damage, fines and penalty notices.',
    [D('date', 'Date'), T('kind', 'Kind', 12), T('title', 'Title', 22), T('reg', 'Vehicle', 12), T('driver', 'Driver', 20), T('loc', 'Location', 22), T('desc', 'Description', 40), T('ref', 'Reference', 14), T('status', 'Status', 12), T('fault', 'At fault', 8), T('inj', 'Injuries', 8), T('police', 'Police ref', 14), T('tp', 'Third party', 24), M('repair', 'Repair cost'), M('excess', 'Excess paid'), M('insurer', 'Insurer paid'), M('tpcost', 'Third party cost'), D('repaired', 'Repaired on'), M('fine', 'Fine amount'), D('notice', 'Notice date'), D('nominate', 'Nominate by'), D('nominated', 'Nominated on'), D('payby', 'Pay by'), D('paid', 'Paid on'), T('paidby', 'Paid by', 12), T('recharge', 'Recharge to driver', 10), D('recharged', 'Recharged on'), T('appeal', 'Appeal', 12), D('ndue', 'Insurer notice due'), D('nton', 'Insurer notified on'), T('nref', 'Insurer ref', 14), T('n', 'Notes', 40)],
    sortBy(get('incidents'), (i) => i.incident_date).reverse().map((i) => ({ date: day(i.incident_date), kind: i.kind, title: incidentTitle(i), reg: reg(i.vehicle_id), driver: dn(i.driver_id), loc: i.location, desc: i.description, ref: i.reference, status: i.status, fault: yn(i.at_fault), inj: yn(i.injuries), police: i.police_reference, tp: i.third_party_details, repair: num(i.repair_cost), excess: num(i.excess_paid), insurer: num(i.insurer_paid), tpcost: num(i.third_party_cost), repaired: day(i.repaired_on), fine: num(i.fine_amount), notice: day(i.notice_date), nominate: day(i.nominate_by), nominated: day(i.nominated_on), payby: day(i.pay_by), paid: day(i.paid_on), paidby: i.paid_by, recharge: yn(i.recharge_to_driver), recharged: day(i.recharged_on), appeal: i.appeal_status, ndue: day(i.insurer_notice_due), nton: day(i.insurer_notified_on), nref: i.insurer_notified_ref, n: i.notes })));

  add('Claims', 'Insurance claims', '',
    [T('ref', 'Claim reference', 16), T('pol', 'Policy', 16), T('reg', 'Vehicle', 12), T('driver', 'Driver', 20), D('inc', 'Incident date'), D('rep', 'Reported'), T('status', 'Status', 12), T('fault', 'At fault', 8), M('claimed', 'Amount claimed'), M('paid', 'Amount paid'), M('excess', 'Excess paid'), D('closed', 'Closed'), T('desc', 'Description', 40), T('tp', 'Third party', 24), T('n', 'Notes', 40)],
    sortBy(get('insurance_claims'), (c) => c.incident_date).reverse().map((c) => ({ ref: c.claim_reference, pol: pol.get(c.policy_id)?.policy_number || '', reg: reg(c.vehicle_id), driver: dn(c.driver_id), inc: day(c.incident_date), rep: day(c.reported_date), status: c.status, fault: yn(c.at_fault), claimed: num(c.amount_claimed), paid: num(c.amount_paid), excess: num(c.excess_paid), closed: day(c.closed_date), desc: c.description, tp: c.third_party_details, n: c.notes })));

  add('Policies', 'Insurance policies', '',
    [T('no', 'Policy number', 18), T('ins', 'Insurer', 20), T('brk', 'Broker', 20), T('cover', 'Cover', 14), T('d', 'Description', 30), D('s', 'Start'), D('e', 'End'), M('prem', 'Annual premium'), M('xs', 'Excess'), T('freq', 'Payment', 12), T('alloc', 'Premium allocation', 16), T('cp', 'Claims phone', 14), T('gp', 'General phone', 14), T('status', 'Status', 10), T('n', 'Notes', 40)],
    sortBy(get('insurance_policies'), (p) => p.start_date).reverse().map((p) => ({ no: p.policy_number, ins: nm(con, p.insurer_id), brk: nm(con, p.broker_id), cover: p.cover_type, d: p.description, s: day(p.start_date), e: day(p.end_date), prem: num(p.annual_premium), xs: num(p.excess), freq: p.payment_frequency, alloc: p.premium_allocation, cp: p.claims_phone, gp: p.general_phone, status: p.status, n: p.notes })));

  add('Policy vehicles', 'Vehicles on each policy', '',
    [T('pol', 'Policy', 18), T('reg', 'Vehicle', 12), D('s', 'Start'), D('e', 'End'), M('alloc', 'Allocated premium'), T('n', 'Notes', 40)],
    sortBy(get('policy_vehicles'), (p) => (pol.get(p.policy_id)?.policy_number || '') + reg(p.vehicle_id)).map((p) => ({ pol: pol.get(p.policy_id)?.policy_number || '', reg: reg(p.vehicle_id), s: day(p.start_date), e: day(p.end_date), alloc: num(p.allocated_premium), n: p.notes })));

  add('Costs', 'Vehicle costs', 'Every recorded cost (fuel, repairs, tyres, tax, and so on).',
    [D('date', 'Date'), T('reg', 'Vehicle', 12), T('cat', 'Category', 18), M('amt', 'Amount'), M('vat', 'VAT'), T('sup', 'Supplier', 20), T('gar', 'Garage', 20), T('inv', 'Invoice ref', 16), T('note', 'Note', 40), T('src', 'Source', 12)],
    sortBy(get('vehicle_costs'), (c) => c.cost_date).reverse().map((c) => ({ date: day(c.cost_date), reg: reg(c.vehicle_id), cat: COST_CATEGORY_LABEL[c.category] || c.category, amt: num(c.amount), vat: num(c.vat_amount), sup: nm(con, c.supplier_id), gar: nm(gar, c.garage_id), inv: c.invoice_ref, note: c.note, src: c.source })));

  add('Odometer', 'Odometer readings', '',
    [T('reg', 'Vehicle', 12), D('date', 'Date'), I('mi', 'Mileage', 12), T('src', 'Source', 12), T('note', 'Note', 40)],
    sortBy(get('odometer_readings'), (r) => reg(r.vehicle_id) + day(r.reading_date)).map((r) => ({ reg: reg(r.vehicle_id), date: day(r.reading_date), mi: r.mileage, src: r.source, note: r.note })));

  add('Unavailability', 'Vehicle unavailability', 'Time a vehicle was off the road.',
    [T('reg', 'Vehicle', 12), T('why', 'Reason', 16), T('gar', 'Garage', 20), T('loc', 'Location', 20), D('from', 'From'), D('exp', 'Expected return'), D('ret', 'Returned on'), D('sorn', 'SORN declared'), D('can', 'Cancelled'), T('n', 'Notes', 40)],
    sortBy(get('vehicle_unavailability'), (u) => u.from_date).reverse().map((u) => ({ reg: reg(u.vehicle_id), why: u.reason, gar: nm(gar, u.garage_id), loc: u.location_note, from: day(u.from_date), exp: day(u.expected_return), ret: day(u.returned_on), sorn: day(u.sorn_declared_on), can: day(u.cancelled_at), n: u.notes })));

  add('Garages', 'Garages', '', [T('name', 'Name', 24), T('contact', 'Contact', 20), T('email', 'Email', 24), T('phone', 'Phone', 14), T('addr', 'Address', 30), T('pc', 'Postcode', 10), T('svc', 'Services', 24), D('arch', 'Archived'), T('n', 'Notes', 40)],
    sortBy(get('garages').filter((g) => !g.is_unknown), (g) => g.name).map((g) => ({ name: g.name, contact: g.contact_name, email: g.email, phone: g.phone, addr: g.address, pc: g.postcode, svc: list(g.services), arch: day(g.archived_at), n: g.notes })));

  add('Contacts', 'Contacts (insurers, brokers, suppliers)', '', [T('kind', 'Kind', 12), T('name', 'Name', 26), T('phone', 'Phone', 14), T('email', 'Email', 26), T('web', 'Website', 24), T('addr', 'Address', 30), D('arch', 'Archived'), T('n', 'Notes', 40)],
    sortBy(get('contacts'), (c) => `${c.kind} ${c.name}`).map((c) => ({ kind: c.kind, name: c.name, phone: c.phone, email: c.email, web: c.website, addr: c.address, arch: day(c.archived_at), n: c.notes })));

  add('Depots', 'Depots', '', [T('name', 'Name', 24), T('addr', 'Address', 34), T('pc', 'Postcode', 10), T('phone', 'Phone', 14), D('arch', 'Archived')],
    sortBy(get('depots'), (d) => d.name).map((d) => ({ name: d.name, addr: d.address, pc: d.postcode, phone: d.phone, arch: day(d.archived_at) })));

  add('Fuel prices', 'Fuel prices', 'Monthly prices used for fuel economy.', [D('m', 'Month'), T('t', 'Fuel', 12), { key: 'p', label: 'Price', type: 'number', width: 10 }, T('s', 'Source', 16)],
    sortBy(get('fuel_prices'), (f) => f.month).reverse().map((f) => ({ m: day(f.month), t: f.fuel_type, p: num(f.price), s: f.source })));

  add('Vehicle requirements', 'Vehicles needed each weekday', '', [T('cat', 'Category', 18), I('mon', 'Mon'), I('tue', 'Tue'), I('wed', 'Wed'), I('thu', 'Thu'), I('fri', 'Fri'), I('sat', 'Sat'), I('sun', 'Sun')],
    get('vehicle_requirements').map((r) => ({ cat: CATEGORY_LABEL[r.category] || r.category, mon: r.mon, tue: r.tue, wed: r.wed, thu: r.thu, fri: r.fri, sat: r.sat, sun: r.sun })));

  add('Documents', 'Documents', 'Index of every uploaded file and where it is in the pack. Fingerprints (SHA-256) let you prove a file is unchanged.',
    [T('cat', 'Category', 18), T('file', 'File name', 34), T('on', 'Attached to', 26), I('size', 'Size (bytes)', 12), D('added', 'Added'), T('inc', 'In this pack', 24), T('path', 'Path in pack', 60), T('sha', 'SHA-256', 64), D('arch', 'Archived'), T('n', 'Notes', 30)],
    sortBy(docRows, (d) => `${d.category} ${d.file_name}`).map((d) => ({ cat: DOC_CATEGORY_LABEL[d.category] || d.category, file: d.file_name, on: d.vehicle_id ? reg(d.vehicle_id) : d.driver_id ? dn(d.driver_id) : d.policy_id ? pol.get(d.policy_id)?.policy_number || 'Policy' : d.claim_id ? 'Claim' : d.incident_id ? 'Incident' : '', size: d.size_bytes, added: day(d.created_at), inc: d._included, path: d._path ? `${root}/${d._path}` : '', sha: d._sha, arch: day(d.archived_at), n: d.notes })));

  add('Messages', 'Messages sent', 'Reminders and notices recorded by FleetRecord.',
    [T('at', 'Sent', 18), T('ch', 'Channel', 10), T('kind', 'To', 12), T('driver', 'Driver', 20), T('addr', 'Address', 26), T('subj', 'Subject', 30), T('status', 'Status', 10), T('body', 'Message', 60), T('err', 'Error', 20)],
    sortBy(get('message_log'), (m) => m.sent_at || m.created_at).reverse().map((m) => ({ at: String(m.sent_at || m.created_at || '').slice(0, 16).replace('T', ' '), ch: m.channel, kind: m.recipient_kind, driver: dn(m.driver_id), addr: m.recipient_address, subj: m.subject, status: m.status, body: m.body, err: m.error })));

  add('Tasks', 'Task decisions', 'Reminders that were snoozed or dismissed.',
    [T('type', 'Type', 18), T('subject', 'Vehicle or driver', 22), D('due', 'Due date'), T('state', 'State', 12), D('snz', 'Snoozed until'), T('why', 'Reason', 40)],
    sortBy(get('task_states'), (t) => t.due_date).reverse().map((t) => { const it = itm.get(t.source_id); return { type: t.type_code || t.source_type, subject: it ? (it.vehicle_id ? reg(it.vehicle_id) : dn(it.driver_id)) : '', due: day(t.due_date), state: t.state, snz: day(t.snoozed_until), why: t.reason }; }));

  add('Users', 'Users and access', 'Who had access when the pack was made.', [T('email', 'Email', 30), T('name', 'Name', 22), T('role', 'User type', 14), T('status', 'Status', 10), D('since', 'Added')],
    sortBy(members, (m) => m.email).map((m) => ({ email: m.email, name: m.display_name, role: m.role, status: m.status, since: day(m.created_at) })));

  const audit = sortBy(get('audit_log'), (a) => a.occurred_at).reverse();
  add('Audit log', 'Audit log', audit.length > AUDIT_SHEET_CAP ? `Showing the latest ${AUDIT_SHEET_CAP.toLocaleString('en-GB')} of ${audit.length.toLocaleString('en-GB')} entries. The complete log, with before and after values, is csv/audit_log.csv.` : 'Every change recorded. Before and after values are in csv/audit_log.csv.',
    [T('at', 'When', 18), T('who', 'Who', 26), T('table', 'Table', 20), T('act', 'Action', 8), T('fields', 'Fields changed', 40), T('veh', 'Vehicle', 12), T('drv', 'Driver', 20)],
    audit.slice(0, AUDIT_SHEET_CAP).map((a) => ({ at: String(a.occurred_at || '').slice(0, 16).replace('T', ' '), who: a.actor_label || who(a.actor_id), table: a.table_name, act: a.action, fields: list(a.changed_fields), veh: reg(a.vehicle_id), drv: dn(a.driver_id) })));

  add('Feedback', 'Feedback and changes', 'The feedback log kept inside FleetRecord.',
    [I('ref', 'Ref', 8), D('at', 'Raised'), T('by', 'Raised by', 18), T('cat', 'Category', 12), T('pri', 'Priority', 10), T('status', 'Status', 12), T('screen', 'Screen', 14), T('d', 'Description', 50), T('t', 'Target outcome', 30), D('td', 'Target date'), T('resp', 'Response', 40)],
    sortBy(get('feedback_items'), (f) => String(f.ref).padStart(8, '0')).map((f) => ({ ref: f.ref, at: day(f.created_at), by: f.raised_by, cat: f.category, pri: f.priority, status: f.status, screen: f.screen, d: f.description, t: f.target_outcome, td: day(f.target_date), resp: f.response })));

  if (includeRestricted) {
    add('Licences', 'Driver licences (restricted)', 'Personal data. Keep this file secure and delete it when no longer needed.',
      [T('name', 'Driver', 22), D('dob', 'Date of birth'), T('no', 'Licence number', 20), T('type', 'Type', 12), D('start', 'Licence start'), D('exp', 'Licence expiry'), T('cats', 'Entitlements', 20), T('res', 'Restrictions', 24), T('n', 'Notes', 40)],
      sortBy(get('driver_sensitive'), (s) => dn(s.driver_id)).map((s) => ({ name: dn(s.driver_id), dob: day(s.date_of_birth), no: s.licence_number, type: s.licence_type, start: day(s.licence_start_date), exp: day(s.licence_expiry_date), cats: list(s.entitlement_categories), res: s.restrictions, n: s.notes })));
    add('Licence checks', 'Licence checks (restricted)', '',
      [T('name', 'Driver', 22), D('on', 'Checked'), T('by', 'Checked by', 24), T('m', 'Method', 12), T('st', 'Status', 12), I('pts', 'Points'), T('cats', 'Entitlements', 20), T('end', 'Endorsements', 30), D('next', 'Next check due'), T('n', 'Notes', 40)],
      sortBy(get('licence_checks'), (c) => c.checked_on).reverse().map((c) => ({ name: dn(c.driver_id), on: day(c.checked_on), by: who(c.checked_by), m: c.method, st: c.status, pts: c.points, cats: list(c.entitlement_categories), end: c.endorsements, next: day(c.next_check_due), n: c.notes })));
    add('Convictions', 'Convictions and endorsements (restricted)', 'Personal data. Keep this file secure and delete it when no longer needed.',
      [T('name', 'Driver', 22), T('reg', 'Vehicle', 12), T('code', 'Code', 8), T('d', 'Description', 34), D('off', 'Offence date'), D('conv', 'Conviction date'), I('pts', 'Points'), M('fine', 'Fine'), I('dq', 'Disqualified (months)'), T('court', 'Court', 20), T('src', 'Source', 12), T('st', 'Status', 10), D('rem', 'Removed'), T('why', 'Removal reason', 20), D('disc', 'Disclose until'), D('totting', 'Totting until'), D('ndue', 'Insurer notice due'), D('nton', 'Insurer notified'), T('n', 'Notes', 40)],
      sortBy(get('driver_convictions'), (c) => c.offence_date).reverse().map((c) => ({ name: dn(c.driver_id), reg: reg(c.vehicle_id), code: c.offence_code, d: c.description, off: day(c.offence_date), conv: day(c.conviction_date), pts: c.points, fine: num(c.fine_amount), dq: c.disqualified_months, court: c.court, src: c.source, st: c.status, rem: day(c.removed_on), why: c.removal_reason, disc: day(c.disclose_until), totting: day(c.totting_until), ndue: day(c.insurer_notice_due), nton: day(c.insurer_notified_on), n: c.notes })));
  }

  const xlsx = buildWorkbook(sheets);

  // ---- 5. csv, manifest, zip ----------------------------------------------------------------
  const files = [];
  const put = (name, bytes) => files.push({ name: `${root}/${name}`, data: bytes });
  put('README.txt', enc.encode(readme.map(([a, b]) => (b ? `${a}\r\n    ${b}` : a)).join('\r\n\r\n') + '\r\n'));
  put('FleetRecord data.xlsx', xlsx);
  for (const t of tables) put(`csv/${t.name}.csv`, buildCsv(data[t.name]));
  put('csv/users.csv', buildCsv(members.map((m) => ({ user_id: m.user_id, email: m.email, display_name: m.display_name, role: m.role, status: m.status }))));
  put('reconciliation.csv', buildCsv(recon, ['table', 'expected', 'exported', 'result', 'note']));
  for (const f of docFiles) files.push({ name: `${root}/${f.name}`, data: f.data });
  onProgress({ stage: 'Fingerprinting files', message: '', done: 0, total: files.length });
  const manifest = [];
  for (const f of files) manifest.push({ path: f.name.slice(root.length + 1), bytes: f.data.length, sha256: await sha256(f.data) });
  const summary = {
    created_at: now.toISOString(), organisation: orgName, created_by: state.user?.email || null, includes_restricted_licence_data: includeRestricted, includes_documents: includeDocuments,
    encrypted: !!passphrase, tables: recon, documents: { in_database: docs.length, in_pack: docFiles.length, failed: docFailed, bytes: docBytes },
    files: manifest.length, note: 'manifest.json lists every other file. It cannot list itself.',
  };
  put('manifest.json', enc.encode(JSON.stringify({ ...summary, manifest }, null, 2)));
  const problems = recon.filter((r) => r.result === 'DIFFERENT' || r.result === 'FAILED').length + docFailed;

  const zipped = await buildZip(files, { password: passphrase, onProgress: (d, t) => onProgress({ stage: passphrase ? 'Encrypting and zipping' : 'Zipping', message: '', done: d, total: t }) });
  return { bytes: zipped, filename: `${root}.zip`, summary: { ...summary, problems, sheets: sheets.length, size: zipped.length } };
}

function readmeLines({ orgName, now, includeRestricted, includeDocuments, root, passphrase, docFailed }) {
  return [
    [`${orgName}: FleetRecord exit pack`, `Created ${now.toISOString().slice(0, 16).replace('T', ' ')} UTC. A complete copy of what ${orgName} holds in FleetRecord, in files that open without FleetRecord.`],
    ['What is in this pack', 'FleetRecord data.xlsx is the readable copy: one sheet per subject with filters switched on. csv/ holds every table in full, one file each, exactly as stored (the lossless copy; use these to move into another system). documents/ holds every uploaded file in folders by vehicle, driver, insurance and incident. manifest.json lists every file with its size and SHA-256 fingerprint. reconciliation.csv compares rows in the database with rows exported.'],
    ['Using the workbook', 'The Compliance sheet is live: Days left and Status are Excel formulas based on today\'s date, so it keeps showing what is overdue or due soon. Add rows at the bottom (copy the formulas down) to keep using it as a simple tracker. All other sheets are a snapshot at the time of the download.'],
    ['Dates and numbers', 'Dates are real Excel dates shown in your organisation\'s date format. Money is in the organisation currency. In the CSV files dates are year-month-day, true/false are as stored, and lists are stored as JSON.'],
    ['Text that starts with = + - or @', 'In the CSV files a leading apostrophe is added to such text so a spreadsheet can never run it as a formula. Remove the apostrophe if you load the data into another system.'],
    ['Left out on purpose', 'Passwords and sign-in details are never stored by FleetRecord, so there are none to export. Invitation links and connection credentials are left out for security. Branding images are not included.'],
    ['Licence and conviction data', includeRestricted ? 'INCLUDED: driver licence numbers, dates of birth, licence checks and convictions are in the Licences, Licence checks and Convictions sheets and in csv/driver_sensitive.csv, driver_convictions.csv and licence_checks.csv, and licence documents are in the documents folder. This is personal data: store it securely and delete it when no longer needed.' : 'NOT INCLUDED. This is deliberate: it is personal data. Licence documents and the audit details for those records are withheld too. Run the exit pack again with the licence box ticked if you need them.'],
    ['Documents', includeDocuments ? (docFailed ? `${docFailed} document(s) could not be downloaded. They are marked FAILED on the Documents sheet. Run the pack again, or download those files from FleetRecord.` : 'All uploaded documents are included.') : 'NOT INCLUDED: documents were not requested. The Documents sheet still lists them.'],
    ['Opening this zip', passphrase ? 'This zip is encrypted with a passphrase (AES-256). Open it with 7-Zip (free, Windows), Keka or The Unarchiver (Mac), or WinZip. Windows Explorer cannot open it. FleetRecord does not keep the passphrase: if it is lost the pack cannot be opened.' : 'This zip is not encrypted. Store it somewhere private, because it contains your whole fleet record.'],
    ['Checking it is complete', 'Open the Summary sheet (or reconciliation.csv). OK means every row in the database is in the pack. To prove a file is unchanged later, compare its SHA-256 with manifest.json.'],
    ['Where this was recorded', 'The download is recorded in the audit log (who and when) once the log_export database function is installed.'],
  ];
}
