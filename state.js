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
  ['Leaving and returning: dispose of or bring back a vehicle, record a leaver or rehire a driver', ['Full', 'Full', 'Full', 'None']],
  ['Total cost of ownership', ['View', 'View', 'View', 'View']],
  ['Monthly fuel prices', ['Full', 'Full', 'Full', 'View']],
  ['Acting on tasks and sending task emails', ['Full', 'Full', 'Full', 'None']],
  ['Driver licence details, licence checks, points and convictions', ['Full', 'Full', 'Full', 'None']],
  ['Documents (open and upload)', ['Full', 'Full', 'Full', 'None']],
  ['Override a block on a driver whose licence is not valid', ['Full', 'Full', 'None', 'None']],
  ['Audit log', ['View', 'View', 'None', 'None']],
  ['Help, and sending feedback (each person sees what they sent and the reply)', ['Full', 'Full', 'Full', 'Full']],
  ['Feedback log: see everything sent in, set priority, target date and status', ['Full', 'None', 'None', 'None']],
  ['Settings: vehicles needed, depots, users, screens, date format, typical fuel economy', ['Full', 'None', 'None', 'None']],
];
// Screens the superuser can switch off for everyone (Settings, Screens). The rest are always on: the app cannot be used
// without them. Switching a screen off only hides it: nothing is deleted and every change is still audited.
// organisations.settings.hidden_screens holds the ids that are off.
export const OPTIONAL_SCREENS = [
  ['planner', 'Planner', 'Vehicles available against vehicles needed, day by day.'],
  ['incidents', 'Incidents', 'Accidents, damage and fines.'],
  ['garages', 'Garages', 'The list of garages. Garage visits are still booked from a vehicle.'],
  ['insurance', 'Insurance', 'Policies, the vehicles they cover, and claims.'],
  ['costs', 'Costs', 'Total cost of ownership and monthly fuel prices.'],
  ['reports', 'Reports', 'Damage, accidents, mileage and vehicle status reports.'],
  ['audit', 'Audit log', 'The screen only: every change is still recorded while it is hidden.'],
];
export const hiddenScreens = () => { const h = state.org?.settings?.hidden_screens; return Array.isArray(h) ? h.filter((id) => OPTIONAL_SCREENS.some(([k]) => k === id)) : []; };
export const screenOn = (id) => !hiddenScreens().includes(id);
// The screen a link like "#/costs/123?tab=x" belongs to.
export const screenOfHref = (href) => (/^#\/([a-z]+)/.exec(href || '') || [])[1] || '';

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
