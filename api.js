// Data layer: every call to Supabase goes through here.
// Every query is scoped to the current organisation. Row-level security is the real guard;
// the filter is there so a person who belongs to several organisations only sees the one they chose.
import { state } from './state.js';

let sb = null;
export const init = (client) => { sb = client; };
export const client = () => sb;
const org = () => state.org.id;

// ---- Errors -------------------------------------------------------------
export function friendly(err) {
  const msg = err?.message || String(err);
  if (/row-level security|permission denied/i.test(msg)) return "You don't have permission to do that.";
  if (err?.code === '23505') {
    if (/registration/i.test(msg)) return 'A vehicle with that registration already exists.';
    if (/employee_number/i.test(msg)) return 'A driver with that employee number already exists.';
    return 'That already exists.';
  }
  if (err?.code === '23503') return 'That is linked to a record that no longer exists. Refresh and try again.';
  if (err?.code === '23514') return 'One of the values is not allowed. Check the dates and numbers.';
  if (/Failed to fetch|NetworkError|network/i.test(msg)) return 'Could not reach the server. Check your connection and try again.';
  return msg;
}
const fail = (error) => { const e = new Error(friendly(error)); e.code = error.code; e.raw = error; throw e; };
const ok = ({ data, error }) => { if (error) fail(error); return data; };

// ---- Authentication -----------------------------------------------------
function authFail(error) {
  const msg = error?.message || '';
  let text = msg;
  if (/invalid login credentials/i.test(msg)) text = 'Email or password is incorrect.';
  else if (/email not confirmed/i.test(msg)) text = 'Confirm your email first. Check your inbox for the link we sent.';
  else if (/already registered|already been registered/i.test(msg)) text = 'An account with that email already exists. Sign in instead.';
  else if (/password should be at least|weak password/i.test(msg)) text = 'Choose a longer password (at least 8 characters).';
  else if (/rate limit|too many/i.test(msg)) text = 'Too many attempts. Wait a few minutes and try again.';
  const e = new Error(text); e.raw = error; throw e;
}
export const auth = {
  async getSession() { const { data, error } = await sb.auth.getSession(); if (error) authFail(error); return data.session; },
  async signIn(email, password) { const { data, error } = await sb.auth.signInWithPassword({ email, password }); if (error) authFail(error); return data; },
  async signUp(email, password, redirectTo) {
    const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo } });
    if (error) authFail(error);
    return data;
  },
  async signOut() { const { error } = await sb.auth.signOut(); if (error) authFail(error); },
  async resetPassword(email, redirectTo) { const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo }); if (error) authFail(error); },
  async updatePassword(password) { const { error } = await sb.auth.updateUser({ password }); if (error) authFail(error); },
};

// ---- Organisation context -----------------------------------------------
export async function loadMemberships(userId) {
  const mem = ok(await sb.from('memberships').select('*').eq('user_id', userId).eq('status', 'active'));
  if (!mem.length) return [];
  const orgs = ok(await sb.from('organisations').select('*').in('id', mem.map((m) => m.organisation_id)));
  const byId = new Map(orgs.map((o) => [o.id, o]));
  return mem.map((m) => ({ ...m, organisation: byId.get(m.organisation_id) })).filter((m) => m.organisation);
}
export const acceptInvitation = async (token) => ok(await sb.rpc('accept_invitation', { p_token: token }));
// brand.logo_url is a full address; brand.logo_path is a file in the org-branding storage bucket.
export function logoUrl(brand) {
  if (!brand) return null;
  if (brand.logo_url) return brand.logo_url;
  if (brand.logo_path) return sb.storage.from('org-branding').getPublicUrl(brand.logo_path).data.publicUrl;
  return null;
}

// ---- Tasks and compliance ------------------------------------------------
export const listTasks = async () =>
  ok(await sb.from('compliance_tasks').select('*').eq('organisation_id', org()).order('due_date', { ascending: true, nullsFirst: false }));

export async function recordRenewal({ itemId, completedOn, newDueDate, reference, cost, notes }) {
  return ok(await sb.rpc('record_compliance_renewal', {
    p_item_id: itemId, p_completed_on: completedOn, p_new_due_date: newDueDate ?? null,
    p_reference: reference ?? null, p_cost: cost ?? null, p_document_id: null, p_notes: notes ?? null,
  }));
}
export const updateItem = async (id, patch) =>
  ok(await sb.from('compliance_items').update(patch).eq('id', id).eq('organisation_id', org()).select().single());
export const listRenewals = async (itemId) =>
  ok(await sb.from('compliance_renewals').select('*').eq('organisation_id', org()).eq('compliance_item_id', itemId).order('completed_on', { ascending: false }).limit(5));

export const setTaskState = async ({ source_type, source_id, due_date, state: st, snoozed_until, reason }) =>
  ok(await sb.from('task_states').upsert(
    { organisation_id: org(), source_type, source_id, due_date, state: st, snoozed_until: snoozed_until ?? null, reason },
    { onConflict: 'organisation_id,source_type,source_id,due_date' }));
export const clearTaskState = async (t) =>
  ok(await sb.from('task_states').delete().eq('organisation_id', org()).eq('source_type', t.source_type).eq('source_id', t.source_id).eq('due_date', t.due_date));

// ---- Messages -------------------------------------------------------------
export const listTemplates = async () => ok(await sb.from('message_templates').select('*').eq('organisation_id', org()).eq('is_active', true));
export const listMessages = async (sourceType, sourceId) =>
  ok(await sb.from('message_log').select('*').eq('organisation_id', org()).eq('source_type', sourceType).eq('source_id', sourceId).order('created_at', { ascending: false }).limit(5));
export const logMessage = async (row) =>
  ok(await sb.from('message_log').insert({ ...row, organisation_id: org() }).select().single());

// ---- Depots ---------------------------------------------------------------
export const listDepots = async () =>
  ok(await sb.from('depots').select('*').eq('organisation_id', org()).is('archived_at', null).order('name'));

// ---- Vehicles ---------------------------------------------------------------
export const listVehicles = async () =>
  ok(await sb.from('vehicle_overview').select('*').eq('organisation_id', org()).order('registration'));
export const getVehicle = async (id) =>
  ok(await sb.from('vehicle_overview').select('*').eq('organisation_id', org()).eq('id', id).maybeSingle());
export async function saveVehicle(values, id) {
  if (id) return ok(await sb.from('vehicles').update(values).eq('id', id).eq('organisation_id', org()).select().single());
  return ok(await sb.from('vehicles').insert({ ...values, organisation_id: org() }).select().single());
}
export const archiveVehicle = async (id) =>
  ok(await sb.from('vehicles').update({ archived_at: new Date().toISOString() }).eq('id', id).eq('organisation_id', org()).select().single());

// ---- Drivers ----------------------------------------------------------------
export const listDrivers = async () =>
  ok(await sb.from('drivers').select('*').eq('organisation_id', org()).is('archived_at', null).order('last_name').order('first_name'));
export const getDriver = async (id) =>
  ok(await sb.from('drivers').select('*').eq('organisation_id', org()).eq('id', id).maybeSingle());
export const getDriverSensitive = async (id) =>
  ok(await sb.from('driver_sensitive').select('*').eq('organisation_id', org()).eq('driver_id', id).maybeSingle());
export async function saveDriver(values, sensitive, id, forceSensitive = false) {
  let driver;
  if (id) driver = ok(await sb.from('drivers').update(values).eq('id', id).eq('organisation_id', org()).select().single());
  else driver = ok(await sb.from('drivers').insert({ ...values, organisation_id: org() }).select().single());
  if (sensitive && (forceSensitive || Object.values(sensitive).some((v) => v !== null && v !== undefined && !(Array.isArray(v) && !v.length)))) {
    ok(await sb.from('driver_sensitive').upsert({ ...sensitive, driver_id: driver.id, organisation_id: org() }, { onConflict: 'driver_id' }));
  }
  return driver;
}
export const archiveDriver = async (id) =>
  ok(await sb.from('drivers').update({ archived_at: new Date().toISOString(), employment_status: 'left' }).eq('id', id).eq('organisation_id', org()).select().single());
export const currentLicences = async () =>
  ok(await sb.from('driver_current_licence').select('*').eq('organisation_id', org()));
export const listLicenceChecks = async (driverId) =>
  ok(await sb.from('licence_checks').select('*').eq('organisation_id', org()).eq('driver_id', driverId).order('checked_on', { ascending: false }).order('created_at', { ascending: false }));
export const addLicenceCheck = async (values) =>
  ok(await sb.from('licence_checks').insert({ ...values, organisation_id: org() }).select().single());

// ---- Assignments and readings --------------------------------------------------
export async function listAssignments({ vehicleId, driverId }) {
  let q = sb.from('vehicle_assignments').select('*').eq('organisation_id', org());
  if (vehicleId) q = q.eq('vehicle_id', vehicleId);
  if (driverId) q = q.eq('driver_id', driverId);
  return ok(await q.order('start_date', { ascending: false }));
}
export const addAssignment = async (values) =>
  ok(await sb.from('vehicle_assignments').insert({ ...values, organisation_id: org() }).select().single());
export const endAssignment = async (id, endDate) =>
  ok(await sb.from('vehicle_assignments').update({ end_date: endDate }).eq('id', id).eq('organisation_id', org()).select().single());
export async function primaryDriver(vehicleId) {
  const a = ok(await sb.from('vehicle_assignments').select('driver_id').eq('organisation_id', org()).eq('vehicle_id', vehicleId).eq('assignment_type', 'primary').is('end_date', null).maybeSingle());
  return a ? getDriver(a.driver_id) : null;
}
export const listReadings = async (vehicleId) =>
  ok(await sb.from('odometer_readings').select('*').eq('organisation_id', org()).eq('vehicle_id', vehicleId).order('reading_date', { ascending: false }).order('mileage', { ascending: false }).limit(50));
export const addReading = async (values) =>
  ok(await sb.from('odometer_readings').insert({ ...values, organisation_id: org() }).select().single());

// ---- Audit ------------------------------------------------------------------------
export const listAudit = async (table, recordId) =>
  ok(await sb.from('audit_log').select('*').eq('organisation_id', org()).eq('table_name', table).eq('record_id', recordId).order('occurred_at', { ascending: false }).limit(50));
