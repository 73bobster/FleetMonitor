// Who is signed in, which organisation they are working in, and what their role allows.
// The database enforces all of this; these helpers only decide what to show.

export const state = { user: null, memberships: [], membership: null, org: null, role: null };

// 'reviewer' is the read-only role, shown to people as Management.
export const ROLE_LABEL = { superuser: 'Superuser', fleet_admin: 'Admin', fleet_manager: 'Fleet manager', reviewer: 'Management' };
export const ROLE_HINT = {
  superuser: 'Everything, including settings and inviting users.',
  fleet_admin: 'Add and change everything, see the audit log and override licence blocks. No settings.',
  fleet_manager: 'Add and change vehicles, drivers, incidents, insurance and garage visits.',
  reviewer: 'Read only. Sees the dashboard, reports and records, but not drivers\' licence details, points, convictions or documents.',
};

// What each user type can do, for the "Who can do what" table in Settings. This describes the fixed rules that the
// database enforces (the `can` helpers below mirror them); it does not grant anything itself. Keep the two in step.
// Order of the values: superuser, fleet_admin, fleet_manager, reviewer.
export const ROLE_ORDER = ['superuser', 'fleet_admin', 'fleet_manager', 'reviewer'];
export const ACCESS_SUMMARY = [
  ['Dashboard, planner, tasks and reports', ['View', 'View', 'View', 'View']],
  ['Vehicles, drivers, incidents, insurance and garages', ['Full', 'Full', 'Full', 'View']],
  ['Garage visits, mileage, costs and compliance dates', ['Full', 'Full', 'Full', 'View']],
  ['Acting on tasks and sending task emails', ['Full', 'Full', 'Full', 'None']],
  ['Driver licence details, licence checks, points and convictions', ['Full', 'Full', 'Full', 'None']],
  ['Documents (open and upload)', ['Full', 'Full', 'Full', 'None']],
  ['Override a block on a driver whose licence is not valid', ['Full', 'Full', 'None', 'None']],
  ['Audit log', ['View', 'View', 'None', 'None']],
  ['Settings: vehicles needed, depots, users, date format', ['Full', 'None', 'None', 'None']],
];
export const MEMBER_STATUS_LABEL = { active: 'Active', disabled: 'Suspended', removed: 'Removed' };

const WRITERS = ['superuser', 'fleet_admin', 'fleet_manager'];
export const can = {
  get write() { return WRITERS.includes(state.role); },
  get sensitive() { return WRITERS.includes(state.role); },
  get audit() { return ['superuser', 'fleet_admin'].includes(state.role); },
  get override() { return ['superuser', 'fleet_admin'].includes(state.role); },
  get configure() { return state.role === 'superuser'; },
};

export function setMembership(m) {
  state.membership = m;
  state.org = m.organisation;
  state.role = m.role;
  try { localStorage.setItem('fm:org', m.organisation_id); } catch { /* storage unavailable */ }
}

export function clearState() {
  state.user = null; state.memberships = []; state.membership = null; state.org = null; state.role = null;
}
