// One version per screen, in the form v1.YYMMDDHHMM: the date and time (UK) that the screen's own files were last
// changed. It is shown at the bottom of each screen. This file is written when an update is put together, so do not
// edit it by hand. Screens that an update does not touch keep their earlier version.
export const SCREENS = [
  ['dashboard', 'Dashboard', '1.2610051017'],
  ['tasks', 'Tasks', '1.2610041110'],
  ['planner', 'Planner', '1.2610041214'],
  ['vehicles', 'Vehicles', '1.2610041301'],
  ['drivers', 'Drivers', '1.2610041214'],
  ['incidents', 'Incidents', '1.2610041110'],
  ['garages', 'Garages', '1.2610041110'],
  ['insurance', 'Insurance', '1.2610041110'],
  ['costs', 'Costs', '1.2610041301'],
  ['reports', 'Reports', '1.2610041110'],
  ['audit', 'Audit log', '1.2610051017'],
  ['settings', 'Settings', '1.2610051300'],
  ['help', 'Help', '1.2610051300'],
  ['signin', 'Sign in', '1.2610051017'],
];
const BY_ID = new Map(SCREENS.map(([id, label, version]) => [id, { label, version }]));
export const screenLabel = (id) => BY_ID.get(id)?.label || '';
export const versionOf = (id) => (BY_ID.get(id) ? `v${BY_ID.get(id).version}` : '');
