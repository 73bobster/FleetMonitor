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
export const OWNERSHIP_LABEL = { owned: 'Owned', leased: 'Leased', financed: 'Financed', hired: 'Rented' };
export const VEHICLE_STATUS_LABEL = { active: 'Active', off_road: 'Off the road', disposed: 'Disposed' };
export const DISPOSAL_REASON_LABEL = { sold: 'Sold', lease_ended: 'Lease ended', rental_ended: 'Rental ended', written_off: 'Written off', scrapped: 'Scrapped', stolen: 'Stolen', transferred: 'Transferred', other: 'Other' };
export const EMPLOYMENT_LABEL = { active: 'Active', inactive: 'Inactive', left: 'Left' };
export const LEAVING_REASON_LABEL = { resigned: 'Resigned', dismissed: 'Dismissed', retired: 'Retired', end_of_contract: 'End of contract', redundancy: 'Redundancy', deceased: 'Deceased', other: 'Other' };
export const LICENCE_STATUS_LABEL = { valid: 'Valid', expired: 'Expired', suspended: 'Suspended', revoked: 'Revoked', disqualified: 'Disqualified', not_found: 'Not found' };
export const LICENCE_METHOD_LABEL = { dvla_share_code: 'DVLA share code', dvla_mandate: 'DVLA mandate', manual: 'Checked manually', other: 'Other' };
export const BLOCKING_LICENCE = ['expired', 'suspended', 'revoked', 'disqualified'];
export const LICENCE_CATEGORIES = ['AM', 'A1', 'A2', 'A', 'B', 'BE', 'C1', 'C1E', 'C', 'CE', 'D1', 'D1E', 'D', 'DE'];

export const INCIDENT_KIND_LABEL = { accident: 'Accident', damage: 'Damage', fine: 'Fine' };
export const FINE_TYPE_LABEL = { parking: 'Parking', speeding: 'Speeding', red_light: 'Red light', bus_lane: 'Bus lane', congestion_charge: 'Congestion or low emission zone', toll: 'Toll or road charge', other: 'Other' };
export const INCIDENT_STATUS_LABEL = { open: 'Open', claim_in_progress: 'Claim in progress', resolved: 'Resolved', closed: 'Closed' };
export const APPEAL_LABEL = { none: 'No appeal', appealing: 'Appealing', upheld: 'Appeal upheld', rejected: 'Appeal rejected' };
export const CONVICTION_SOURCE_LABEL = { notice: 'Notice received', driver_declared: 'Driver told us', dvla_check: 'DVLA check', court: 'Court', other: 'Other' };
export const CLAIM_STATUS_LABEL = { open: 'Open', in_progress: 'In progress', settled: 'Settled', closed: 'Closed', rejected: 'Rejected', withdrawn: 'Withdrawn' };
export const POLICY_TYPE_LABEL = { fleet: 'Fleet', single_vehicle: 'Single vehicle', other: 'Other' };
export const POLICY_STATUS_LABEL = { pending: 'Pending', active: 'Active', expired: 'Expired', cancelled: 'Cancelled' };
export const PAYMENT_FREQ_LABEL = { annual: 'Annual', quarterly: 'Quarterly', monthly: 'Monthly', other: 'Other' };
export const COST_CATEGORY_LABEL = { tyres: 'Tyres', servicing: 'Servicing', repairs: 'Repairs', insurance: 'Insurance', tax: 'Tax', lease: 'Lease or rental', fuel: 'Fuel', accident: 'Accident', other: 'Other' };
export const DOC_CATEGORY_LABEL = {
  v5c: 'V5C logbook', sorn: 'SORN', vehicle_photo: 'Vehicle photo', lease_agreement: 'Lease agreement', rental_agreement: 'Rental agreement',
  mot_certificate: 'MOT certificate', service_invoice: 'Service invoice', insurance_certificate: 'Insurance certificate', policy_document: 'Policy document',
  claim_document: 'Claim document', licence_photo: 'Licence photo', licence_check: 'Licence check', fine_notice: 'Fine or penalty notice',
  conviction_notice: 'Conviction notice', damage_photo: 'Damage photo', accident_report: 'Accident report', compliance_certificate: 'Compliance certificate', other: 'Other',
};
export const VEHICLE_DOC_CATEGORIES = ['v5c', 'sorn', 'mot_certificate', 'insurance_certificate', 'lease_agreement', 'rental_agreement', 'service_invoice', 'compliance_certificate', 'vehicle_photo', 'damage_photo', 'other'];
export const DRIVER_DOC_CATEGORIES = ['licence_photo', 'licence_check', 'fine_notice', 'conviction_notice', 'other'];
export const INCIDENT_DOC_CATEGORIES = ['damage_photo', 'accident_report', 'fine_notice', 'claim_document', 'other'];
export const POLICY_DOC_CATEGORIES = ['policy_document', 'insurance_certificate', 'claim_document', 'other'];

export const driverName = (d) => (d ? `${d.first_name} ${d.last_name}` : '');
export const vehicleTitle = (v) => [v.make, v.model].filter(Boolean).join(' ') || CATEGORY_LABEL[v.category] || 'Vehicle';
export const incidentTitle = (i) => (i.kind === 'fine' ? `${FINE_TYPE_LABEL[i.fine_type] || 'Fine'} fine` : INCIDENT_KIND_LABEL[i.kind] || 'Incident');
export const incidentCost = (i) => Number(i.repair_cost || 0) + Number(i.third_party_cost || 0) + Number(i.fine_amount || 0);

// The most urgent status among a set of tasks (ignores snoozed and dismissed).
export function worstStatus(tasks) {
  const live = tasks.filter((t) => t.status !== 'snoozed' && t.status !== 'dismissed');
  for (const s of ['overdue', 'due_soon', 'no_date']) if (live.some((t) => t.status === s)) return s;
  return live.length ? 'upcoming' : null;
}

export const taskKey = (t) => `${t.source_type}:${t.source_id}:${t.state_key || ''}:${t.due_date ?? 'none'}`;

// Licence numbers are compared without spaces and in capitals.
export const normLicence = (s) => String(s || '').toUpperCase().replace(/\s+/g, '');
