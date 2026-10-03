// Labels and small pure helpers shared across screens.

export const STATUS_LABEL = {
  overdue: 'Overdue',
  due_soon: 'Due soon',
  upcoming: 'Upcoming',
  no_date: 'No date set',
  snoozed: 'Snoozed',
  dismissed: 'Dismissed',
};
export const STATUS_ORDER = ['overdue', 'due_soon', 'no_date', 'upcoming', 'snoozed', 'dismissed'];

export const CATEGORY_LABEL = { car: 'Car', van: 'Van', light_goods: 'Light goods', hgv: 'HGV', bus: 'Bus', trailer: 'Trailer', plant: 'Plant', other: 'Other' };
export const FUEL_LABEL = { petrol: 'Petrol', diesel: 'Diesel', electric: 'Electric', hybrid: 'Hybrid', plug_in_hybrid: 'Plug-in hybrid', gas: 'Gas', hydrogen: 'Hydrogen', other: 'Other' };
export const OWNERSHIP_LABEL = { owned: 'Owned', leased: 'Leased', financed: 'Financed', hired: 'Hired' };
export const VEHICLE_STATUS_LABEL = { active: 'Active', off_road: 'Off the road', disposed: 'Disposed' };
export const EMPLOYMENT_LABEL = { active: 'Active', inactive: 'Inactive', left: 'Left' };
export const LICENCE_STATUS_LABEL = { valid: 'Valid', expired: 'Expired', suspended: 'Suspended', revoked: 'Revoked', disqualified: 'Disqualified', not_found: 'Not found' };
export const LICENCE_METHOD_LABEL = { dvla_share_code: 'DVLA share code', dvla_mandate: 'DVLA mandate', manual: 'Checked manually', other: 'Other' };
export const BLOCKING_LICENCE = ['expired', 'suspended', 'revoked', 'disqualified'];
export const LICENCE_CATEGORIES = ['AM', 'A1', 'A2', 'A', 'B', 'BE', 'C1', 'C1E', 'C', 'CE', 'D1', 'D1E', 'D', 'DE'];

export const driverName = (d) => (d ? `${d.first_name} ${d.last_name}` : '');
export const vehicleTitle = (v) => [v.make, v.model].filter(Boolean).join(' ') || CATEGORY_LABEL[v.category] || 'Vehicle';

// The most urgent status among a set of tasks (ignores snoozed and dismissed).
export function worstStatus(tasks) {
  const live = tasks.filter((t) => t.status !== 'snoozed' && t.status !== 'dismissed');
  for (const s of ['overdue', 'due_soon', 'no_date']) if (live.some((t) => t.status === s)) return s;
  return live.length ? 'upcoming' : null;
}

export const taskKey = (t) => `${t.source_type}:${t.source_id}:${t.due_date ?? 'none'}`;
