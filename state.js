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
  ['Settings: users, screens, dashboard display, vehicles needed, depots, typical fuel economy, date format', ['Full', 'None', 'None', 'None']],
];
// Screens the superuser can switch off for everyone (Settings, Screens). The rest are always on: the app cannot be used
// without them. Switching a screen off only hides it: nothing is deleted and every change is still audited.
// organisations.settings.hidden_screens holds the ids that are off.
export const OPTIONAL_SCREENS = [
  ['planner', 'Planner', 'Vehicles available against vehicles needed, day by day.'],
  ['incidents', 'Incidents', 'Accidents, damage and fines.'],
  ['service', 'Service / Repair', 'Vehicles out for service or repair now, and recording a new one.'],
  ['garages', 'Garages', 'The list of garages, with the work each one does.'],
  ['insurance', 'Insurance', 'Policies, the vehicles they cover, and claims.'],
  ['costs', 'Costs', 'Total cost of ownership and monthly fuel prices.'],
  ['reports', 'Reports', 'Damage, accidents, mileage and vehicle status reports.'],
  ['audit', 'Audit log', 'The screen only: every change is still recorded while it is hidden.'],
];
// Every screen in the menu, with the standard order number of each (0 to 99, lowest first). The superuser can change the
// numbers (Settings, Screens). Dashboard, Tasks, Vehicles, Drivers and Settings cannot be switched off but can be moved.
// organisations.settings.screen_order holds { id: number }.
const ALWAYS_ON = {
  dashboard: ['Dashboard', 'The opening screen.'], tasks: ['Tasks', 'What is due, due soon or overdue.'], vehicles: ['Vehicles', 'The vehicle records.'],
  drivers: ['Drivers', 'The driver records.'], settings: ['Settings', 'Superuser only.'],
};
export const MENU_STANDARD = [['dashboard', 5], ['tasks', 10], ['incidents', 15], ['service', 20], ['planner', 25], ['vehicles', 30], ['drivers', 35], ['garages', 40],
  ['insurance', 45], ['costs', 50], ['reports', 55], ['audit', 60], ['settings', 65]];
// Every menu screen in the order it is shown, each with { id, label, hint, std, seq, optional }. Anything missing or not valid falls back to the standard.
export function menuLayout(settings = state.org?.settings) {
  const saved = settings?.screen_order && typeof settings.screen_order === 'object' ? settings.screen_order : {};
  return MENU_STANDARD.map(([id, std], i) => {
    const opt = OPTIONAL_SCREENS.find(([k]) => k === id);
    const [label, hint] = opt ? [opt[1], opt[2]] : ALWAYS_ON[id];
    const seq = Number.isInteger(saved[id]) && saved[id] >= 0 && saved[id] <= 99 ? saved[id] : std;
    return { id, label, hint, std, seq, optional: !!opt, i };
  }).sort((a, b) => a.seq - b.seq || a.i - b.i);
}
export const hiddenScreens = () => { const h = state.org?.settings?.hidden_screens; return Array.isArray(h) ? h.filter((id) => OPTIONAL_SCREENS.some(([k]) => k === id)) : []; };
export const screenOn = (id) => !hiddenScreens().includes(id);
// The screen a link like "#/costs/123?tab=x" belongs to.
export const screenOfHref = (href) => (/^#\/([a-z]+)/.exec(href || '') || [])[1] || '';

// The sections of the dashboard, with the standard order number of each. The superuser can hide a section or change
// its number (Settings, Dashboard display): sections are shown lowest number first. The date range at the top is not a
// section and is always shown. organisations.settings.dashboard holds { id: { seq, show } }.
export const DASH_SECTIONS = [
  ['rag', 'Red, amber, green status', 'The four coloured tiles: overall, vehicle pool, driver pool and admin.', 10],
  ['stats', 'Key figures', 'Overdue tasks, due soon, available vehicles, accidents and damage, cost and miles.', 20],
  ['fleet', 'Fleet status', 'How many vehicles are available, at a garage or off the road today, and which.', 30],
  ['attention', 'Needs attention', 'The most pressing overdue and due-soon tasks.', 40],
  ['availability', 'Vehicle availability', 'The chart of vehicles available and in Service / Repair over the period.', 50],
  ['incidents', 'Accidents, damage and fines', 'Counts and costs for the period, and the most recent.', 60],
  ['downtime', 'Downtime and garages', 'Garage visits and vehicle-days in Service / Repair in the period.', 70],
  ['drivers', 'Drivers: worst offenders', 'Drivers with points, accidents or damage.', 80],
];
// Every section in the order it is shown, each with { id, label, hint, seq, show }. Anything missing or not valid in the
// saved setting falls back to the standard, and if every section were hidden the first one is shown: the dashboard is never empty.
export function dashLayout(settings = state.org?.settings) {
  const saved = settings?.dashboard && typeof settings.dashboard === 'object' ? settings.dashboard : {};
  const rows = DASH_SECTIONS.map(([id, label, hint, std], i) => {
    const one = saved[id] && typeof saved[id] === 'object' ? saved[id] : {};
    const seq = Number.isInteger(one.seq) && one.seq >= 0 && one.seq <= 99 ? one.seq : std;
    return { id, label, hint, std, i, seq, show: one.show !== false };
  }).sort((a, b) => a.seq - b.seq || a.i - b.i);
  if (!rows.some((r) => r.show)) rows[0].show = true;
  return rows;
}

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
