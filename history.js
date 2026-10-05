// Turns audit-log entries into plain sentences. Used by the History tabs and the Audit log screen.
import * as api from './api.js';
import { ROLE_LABEL, MEMBER_STATUS_LABEL, OPTIONAL_SCREENS, dashLayout } from './state.js';
import { html, plate, fmtDateTime, fmtDateShort, fmtMonth, fmtMoney } from './ui.js';
import { driverName, CATEGORY_NOUN, INCIDENT_KIND_LABEL, FINE_TYPE_LABEL, LEAVING_REASON_LABEL, DISPOSAL_REASON_LABEL, LICENCE_STATUS_LABEL } from './domain.js';

export const TABLE_LABEL = {
  vehicles: 'Vehicle', drivers: 'Driver', driver_sensitive: 'Driver licence details', licence_checks: 'Licence check', vehicle_assignments: 'Driver assignment',
  compliance_items: 'Compliance item', compliance_renewals: 'Renewal', compliance_types: 'Compliance type', task_states: 'Task', insurance_policies: 'Insurance policy',
  policy_vehicles: 'Insurance cover', insurance_claims: 'Claim', incidents: 'Incident', driver_convictions: 'Conviction', driver_periods: 'Employment', documents: 'Document',
  vehicle_costs: 'Cost', vehicle_periods: 'Period in the fleet', fuel_prices: 'Fuel price', garages: 'Garage', vehicle_unavailability: 'Garage visit or time off the road', depots: 'Depot', vehicle_requirements: 'Vehicles needed', contacts: 'Contact', organisations: 'Organisation settings', memberships: 'User access', invitations: 'Invitation', feedback_items: 'Feedback item',
  support_grants: 'Support access', message_templates: 'Message template', odometer_readings: 'Mileage reading', external_links: 'External link', integration_connections: 'Integration',
};
const FIELD = { mobile_work: 'work mobile', mobile_personal: 'personal mobile', company_phone: 'company phone', gross_weight_kg: 'gross weight', payload_kg: 'payload', licence_number: 'licence number', date_of_birth: 'date of birth' };

// Names for the ids an audit entry holds. users is only wanted by the Audit log screen (to name whose access changed).
export async function auditLookups({ users = false } = {}) {
  const [vehicles, drivers, types, depots, members] = await Promise.all([api.listVehicles(), api.listDrivers(), api.listComplianceTypes(), api.listAllDepots(), users ? api.listMembers().catch(() => []) : []]);
  return { vehicles: new Map(vehicles.map((v) => [v.id, v])), drivers: new Map(drivers.map((d) => [d.id, d])), types: new Map(types.map((t) => [t.id, t])), depots: new Map(depots.map((d) => [d.id, d])), users: new Map(members.map((m) => [m.user_id, m])) };
}

// Where an audit entry leads: the record it is about, when that record has a screen of its own. Vehicles and drivers
// are linked from their plate and name instead. Building the link costs nothing: the ids are already in the entry.
const SETTINGS_TABLES = ['depots', 'vehicle_requirements', 'organisations', 'memberships', 'invitations', 'compliance_types', 'message_templates', 'feedback_items'];
export function recordLink(e) {
  const row = e.new_data || e.old_data || {};
  if (e.table_name === 'incidents') return [`#/incidents/${e.record_id}`, 'Open the incident'];
  if (e.table_name === 'insurance_policies') return [`#/insurance/${e.record_id}`, 'Open the policy'];
  if (['policy_vehicles', 'insurance_claims'].includes(e.table_name) && row.policy_id) return [`#/insurance/${row.policy_id}`, 'Open the policy'];
  if (e.table_name === 'garages') return ['#/garages', 'Open garages'];
  if (e.table_name === 'fuel_prices') return ['#/costs?tab=fuel', 'Open fuel prices'];
  if (SETTINGS_TABLES.includes(e.table_name)) return ['#/settings', 'Open settings'];
  return null;
}
const vehicleHref = (e) => `#/vehicles/${e.vehicle_id}${e.table_name === 'vehicle_unavailability' ? '?tab=availability' : ''}`;

const ISO = /^\d{4}-\d{2}-\d{2}(T|$)/;
function fmtVal(key, v, L) {
  if (v === null || v === undefined || v === '') return 'empty';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (Array.isArray(v)) return v.join(', ') || 'empty';
  if (key === 'vehicle_id') return L.vehicles.get(v)?.registration || 'a vehicle';
  if (key === 'driver_id') return driverName(L.drivers.get(v)) || 'a driver';
  if (key === 'depot_id') return L.depots.get(v)?.name || 'a depot';
  if (key === 'compliance_type_id') return L.types.get(v)?.name || 'a type';
  if (typeof v === 'string' && ISO.test(v)) return fmtDateShort(v);
  if (['amount', 'repair_cost', 'fine_amount', 'sale_price', 'excess_paid', 'insurer_paid', 'third_party_cost', 'annual_premium', 'monthly_payment', 'purchase_price'].includes(key)) return fmtMoney(v);
  return String(v).length > 70 ? `${String(v).slice(0, 70)}...` : String(v);
}
const changes = (e, L, skip = []) => (e.changed_fields || []).filter((f) => !skip.includes(f)).map((f) =>
  html`<span class="chg">${FIELD[f] || f.replace(/_/g, ' ')}: ${fmtVal(f, e.old_data?.[f], L)} to ${fmtVal(f, e.new_data?.[f], L)}</span>`);
const changed = (e, f) => (e.changed_fields || []).includes(f);

function describe(e, L) {
  const n = e.new_data || {}; const o = e.old_data || {}; const row = n.id || n.driver_id ? n : o;
  switch (e.table_name) {
    case 'vehicles':
      if (e.action === 'INSERT') return html`added vehicle ${n.registration}${n.status === 'disposed' ? ' (already disposed of)' : ''}`;
      if (changed(e, 'archived_at')) return n.archived_at ? 'archived the vehicle' : 'restored the vehicle from the archive';
      if (changed(e, 'status') && n.status === 'disposed') return html`disposed of the vehicle (${DISPOSAL_REASON_LABEL[n.disposal_reason] || n.disposal_reason})${n.sold_to ? ` to ${n.sold_to}` : ''}`;
      break;
    case 'vehicle_assignments':
      if (e.action === 'INSERT') return html`assigned ${fmtVal('driver_id', n.driver_id, L)} as ${n.assignment_type} driver`;
      if (changed(e, 'end_date') && n.end_date) return html`ended the assignment of ${fmtVal('driver_id', n.driver_id, L)}`;
      break;
    case 'compliance_items':
      if (e.action === 'INSERT') return html`started tracking ${L.types.get(n.compliance_type_id)?.name || 'an item'}`;
      if (changed(e, 'due_date')) return html`${L.types.get(n.compliance_type_id)?.name || 'Item'}: due date ${fmtVal('due_date', o.due_date, L)} to ${fmtVal('due_date', n.due_date, L)}`;
      break;
    case 'compliance_renewals':
      return html`recorded a renewal, completed ${fmtVal('d', n.completed_on, L)}, next due ${fmtVal('d', n.new_due_date, L)}${n.reference ? ` (${n.reference})` : ''}`;
    case 'licence_checks':
      return html`recorded a licence check: ${LICENCE_STATUS_LABEL[n.status] || n.status}${n.points != null ? `, ${n.points} points` : ''}`;
    case 'driver_convictions':
      if (e.action === 'INSERT') return html`recorded conviction ${n.offence_code}, ${n.points} points`;
      if (changed(e, 'insurer_notified_on') && n.insurer_notified_on) return html`recorded that the insurer was told about ${n.offence_code}`;
      if (changed(e, 'status') && n.status === 'removed') return html`marked conviction ${n.offence_code} as removed`;
      break;
    case 'incidents': {
      const what = n.kind === 'fine' ? `${FINE_TYPE_LABEL[n.fine_type] || 'a'} fine`.toLowerCase() : (INCIDENT_KIND_LABEL[n.kind] || 'incident').toLowerCase();
      if (e.action === 'INSERT') return html`recorded ${what === 'accident' || what === 'incident' ? 'an' : 'a'} ${what}`;
      if (changed(e, 'insurer_notified_on') && n.insurer_notified_on) return 'recorded that the insurer was told about an incident';
      if (changed(e, 'paid_on') && n.paid_on) return 'recorded a fine as paid';
      if (changed(e, 'nominated_on') && n.nominated_on) return 'recorded that the driver was named for a fine';
      break;
    }
    case 'documents':
      if (e.action === 'INSERT') return html`added document ${n.file_name}`;
      if (changed(e, 'archived_at') && n.archived_at) return html`removed document ${n.file_name}`;
      break;
    case 'driver_periods':
      if (e.action === 'INSERT') return html`started employment on ${fmtVal('d', n.start_date, L)}`;
      if (changed(e, 'end_date') && n.end_date) return html`ended employment on ${fmtVal('d', n.end_date, L)} (${LEAVING_REASON_LABEL[n.leaving_reason] || 'no reason given'})`;
      break;
    case 'task_states':
      if (e.action === 'DELETE') return 'restored a snoozed or dismissed task';
      return html`${n.state} a task${n.snoozed_until ? ` until ${fmtVal('d', n.snoozed_until, L)}` : ''}: ${n.reason}`;
    case 'policy_vehicles':
      if (e.action === 'INSERT') return html`added ${fmtVal('vehicle_id', n.vehicle_id, L)} to a policy`;
      if (changed(e, 'end_date') && n.end_date) return html`ended insurance cover for ${fmtVal('vehicle_id', n.vehicle_id, L)}`;
      break;
    case 'insurance_policies':
      if (e.action === 'INSERT') return html`added policy ${n.policy_number}`;
      break;
    case 'vehicle_costs':
      if (e.action === 'INSERT') return html`added a ${n.category} cost of ${fmtMoney(n.amount)}`;
      break;
    case 'odometer_readings':
      if (e.action === 'INSERT') return html`logged a mileage reading of ${n.mileage}`;
      break;
    case 'vehicle_periods':
      if (e.action === 'INSERT') return html`in the fleet from ${n.start_date ? fmtDateShort(n.start_date) : 'a date not recorded'}${n.end_date ? ` to ${fmtDateShort(n.end_date)}` : ''}${n.notes ? ` (${n.notes})` : ''}`;
      if (changed(e, 'end_date') && n.end_date) return html`left the fleet on ${fmtDateShort(n.end_date)}`;
      if (changed(e, 'start_date')) return html`start of its time in the fleet changed to ${n.start_date ? fmtDateShort(n.start_date) : 'not recorded'}`;
      break;
    case 'fuel_prices': {
      const what = `${row.fuel_type} price for ${fmtMonth(row.month, true)}`;
      if (e.action === 'DELETE') return html`removed the ${what}`;
      return html`set the ${what} to ${Number(n.price).toFixed(1)}p`;
    }
    case 'organisations':
      if (changed(e, 'settings')) {
        const was = o.settings || {}; const now = n.settings || {};
        const keys = Object.keys(now).filter((k) => JSON.stringify(now[k]) !== JSON.stringify(was[k]));
        const show = (x) => (x && typeof x === 'object' ? Object.entries(x).map(([a, b]) => `${a.replace(/_/g, ' ')} ${b}`).join(', ') : x);
        const screenName = (id) => OPTIONAL_SCREENS.find(([k]) => k === id)?.[1] || id;
        const one = (k) => {
          if (k === 'dashboard') {
            // which dashboard sections were hidden or shown, and whether the order changed
            const before = dashLayout(was); const after = dashLayout(now); const wasOn = new Set(before.filter((x) => x.show).map((x) => x.id));
            const hid = after.filter((x) => !x.show && wasOn.has(x.id)).map((x) => x.label); const shown = after.filter((x) => x.show && !wasOn.has(x.id)).map((x) => x.label);
            const moved = before.map((x) => x.id).join() !== after.map((x) => x.id).join();
            return `dashboard display: ${[hid.length ? `hid ${hid.join(', ')}` : '', shown.length ? `showed ${shown.join(', ')}` : '', moved ? `new order ${after.map((x) => x.label).join(', ')}` : ''].filter(Boolean).join('; ') || 'no visible change'}`;
          }
          if (k !== 'hidden_screens') return `${k.replace(/_/g, ' ')} to ${show(now[k])}`;
          const before = Array.isArray(was[k]) ? was[k] : []; const after = Array.isArray(now[k]) ? now[k] : [];
          const off = after.filter((id) => !before.includes(id)).map(screenName); const back = before.filter((id) => !after.includes(id)).map(screenName);
          return [off.length ? `switched off ${off.join(', ')}` : '', back.length ? `switched on ${back.join(', ')}` : ''].filter(Boolean).join(' and ') || 'screens unchanged';
        };
        return html`changed settings: ${keys.map(one).join('; ') || 'no visible change'}`;
      }
      break;
    case 'memberships': {
      const who = L.users?.get(row.user_id)?.email || 'a user';
      if (e.action === 'INSERT') return html`gave ${who} access as ${ROLE_LABEL[n.role] || n.role}`;
      if (changed(e, 'status')) return html`${n.status === 'disabled' ? 'suspended' : n.status === 'removed' ? 'removed' : o.status === 'removed' ? 'brought back' : 'reinstated'} ${who}${changed(e, 'role') ? html` as ${ROLE_LABEL[n.role] || n.role}` : ''}`;
      if (changed(e, 'role')) return html`changed ${who} from ${ROLE_LABEL[o.role] || o.role} to ${ROLE_LABEL[n.role] || n.role}`;
      break;
    }
    case 'invitations':
      if (e.action === 'INSERT') return html`invited ${n.email} as ${ROLE_LABEL[n.role] || n.role}`;
      if (changed(e, 'revoked_at') && n.revoked_at) return html`revoked the invitation for ${n.email}`;
      if (changed(e, 'accepted_at') && n.accepted_at) return html`${n.email} accepted their invitation`;
      break;
    case 'feedback_items': {
      const ref = `#${row.ref}`; const words = String(row.description || ''); const gist = words.length > 90 ? `${words.slice(0, 90)}...` : words;
      const kind = ({ feedback: 'feedback', error: 'an error', change: 'a change', new_feature: 'a new feature', question: 'a question' })[row.category] || 'an item';
      const stat = ({ new: 'new', under_review: 'under review', planned: 'planned', in_progress: 'in progress', done: 'done', declined: 'not going ahead' });
      if (e.action === 'INSERT') return html`logged ${kind} ${ref} from ${n.raised_by}: ${gist}`;
      if (changed(e, 'status')) return html`marked ${ref} as ${stat[n.status] || n.status}${changed(e, 'response') && n.response ? html`, with the reply: ${n.response}` : ''}`;
      if (e.action === 'UPDATE') return html`changed feedback item ${ref}`;
      break;
    }
    case 'vehicle_requirements':
      if (e.action !== 'DELETE') return html`${e.action === 'INSERT' ? 'set' : 'changed'} the number of ${CATEGORY_NOUN[row.category]?.[1] || 'vehicles'} needed`;
      break;
    default:
  }
  const label = (TABLE_LABEL[e.table_name] || e.table_name).toLowerCase();
  if (e.action === 'INSERT') return html`added ${label}`;
  if (e.action === 'DELETE') return html`deleted ${label}`;
  return html`changed ${label}`;
}

// Detail chips for a plain update that has no special sentence.
const needsChips = (e) => e.action === 'UPDATE' && !(['memberships', 'invitations', 'fuel_prices', 'vehicle_periods'].includes(e.table_name) || (e.table_name === 'organisations' && changed(e, 'settings')) || (e.table_name === 'compliance_items' && changed(e, 'due_date')) || (e.table_name === 'vehicles' && (changed(e, 'archived_at') || (changed(e, 'status') && e.new_data?.status === 'disposed'))) || e.table_name === 'task_states' || (e.table_name === 'incidents' && (changed(e, 'insurer_notified_on') || changed(e, 'paid_on') || changed(e, 'nominated_on'))) || (e.table_name === 'driver_convictions' && (changed(e, 'insurer_notified_on') || changed(e, 'status'))) || (e.table_name === 'driver_periods' && changed(e, 'end_date')) || (e.table_name === 'policy_vehicles' && changed(e, 'end_date')) || (e.table_name === 'vehicle_assignments' && changed(e, 'end_date')) || (e.table_name === 'documents' && changed(e, 'archived_at')));

export function historyList(entries, L, { subject = false } = {}) {
  if (!entries.length) return html`<p class="muted">No changes recorded for this selection.</p>`;
  return html`<ul class="history">${entries.map((e) => html`<li>
    <span class="muted">${fmtDateTime(e.occurred_at)}</span> <strong>${e.actor_label || 'System'}</strong>
    ${subject ? html`<span class="subject">${e.vehicle_id && L.vehicles.get(e.vehicle_id) ? html`<a class="plate-link" href="${vehicleHref(e)}">${plate(L.vehicles.get(e.vehicle_id).registration, L.vehicles.get(e.vehicle_id).category)}</a>` : ''}${e.driver_id && L.drivers.get(e.driver_id) ? html` <a class="tag tag-link" href="#/drivers/${e.driver_id}">${driverName(L.drivers.get(e.driver_id))}</a>` : ''}</span>` : ''}
    ${describe(e, L)}${recordLink(e) ? html` <a class="history-link" href="${recordLink(e)[0]}">${recordLink(e)[1]}</a>` : ''}${needsChips(e) ? html`<div class="chips">${changes(e, L, ['archived_at'])}</div>` : ''}</li>`)}</ul>`;
}
