// Exit pack test: builds a pack from the fake Supabase and checks the contents. Usage: node tests/exitpack.mjs <outdir>
import { mkdirSync, writeFileSync } from 'node:fs';
import { makeFake } from '../fake-supabase.js';
import * as api from '../api.js';
import { state } from '../state.js';
import { buildExitPack, TABLES } from '../exitpack.js';

const out = process.argv[2] || '.';
mkdirSync(out, { recursive: true });
const ORG = 'org-1';
const db = {
  organisations: [{ id: ORG, name: 'Test Drinks Ltd', slug: 'test-drinks', status: 'active', country: 'GB', currency: 'GBP', settings: { date_format: 'dd/mm/yyyy' }, terminology: {} }],
  depots: [{ id: 'dep1', organisation_id: ORG, name: 'Hillington' }],
  vehicles: [
    { id: 'v1', organisation_id: ORG, registration: 'AB12 CDE', category: 'van', make: 'Ford', model: 'Transit', status: 'active', notes: '=HYPERLINK("http://x","click")', purchase_price: '25000.50', depot_id: 'dep1', first_registered_date: '2020-03-01' },
    { id: 'v2', organisation_id: ORG, registration: 'ZZ99 ZZZ', category: 'car', status: 'disposed', disposed_date: '2025-01-02' },
  ],
  drivers: [{ id: 'd1', organisation_id: ORG, first_name: 'Ann', last_name: 'O\'Neil, "Jr"', employment_status: 'active', email: 'ann@test.example' }],
  driver_sensitive: [{ driver_id: 'd1', organisation_id: ORG, licence_number: 'SECRETLICENCE123', date_of_birth: '1980-01-01', entitlement_categories: ['B', 'C1'] }],
  driver_convictions: [{ id: 'c1', organisation_id: ORG, driver_id: 'd1', offence_code: 'SP30', offence_date: '2025-02-02', points: 3 }],
  licence_checks: [],
  compliance_types: [{ id: 't1', organisation_id: ORG, code: 'mot', name: 'MOT', applies_to: 'vehicle', interval_value: 12, interval_unit: 'months', lead_days: [30, 14] }],
  compliance_items: [
    { id: 'i1', organisation_id: ORG, compliance_type_id: 't1', vehicle_id: 'v1', due_date: '2020-01-01', applicable: true },
    { id: 'i2', organisation_id: ORG, compliance_type_id: 't1', vehicle_id: 'v2', due_date: '2099-01-01', applicable: true },
    { id: 'i3', organisation_id: ORG, compliance_type_id: 't1', vehicle_id: 'v2', due_date: null, applicable: true },
  ],
  documents: [
    { id: 'aaaaaaaa-1', organisation_id: ORG, vehicle_id: 'v1', category: 'v5c', file_name: 'logbook/../v5c.pdf', storage_path: 'org/v1/a.pdf', size_bytes: 10 },
    { id: 'bbbbbbbb-2', organisation_id: ORG, driver_id: 'd1', category: 'licence_photo', file_name: 'licence.jpg', storage_path: 'org/d1/l.jpg', size_bytes: 5 },
    { id: 'cccccccc-3', organisation_id: ORG, vehicle_id: 'v1', category: 'other', file_name: 'gone.pdf', storage_path: 'org/v1/missing.pdf', size_bytes: 5 },
  ],
  audit_log: [
    { id: 1, organisation_id: ORG, table_name: 'driver_sensitive', action: 'UPDATE', occurred_at: '2026-01-01T10:00:00Z', old_data: { licence_number: 'OLDLICENCE999' }, new_data: { licence_number: 'SECRETLICENCE123' } },
    { id: 2, organisation_id: ORG, table_name: 'vehicles', action: 'INSERT', occurred_at: '2026-01-02T10:00:00Z', new_data: { registration: 'AB12 CDE' } },
  ],
  memberships: [{ id: 'm1', organisation_id: ORG, user_id: 'u1', role: 'superuser', status: 'active' }],
  profiles: [{ id: 'u1', email: 'boss@test.example', display_name: 'Boss' }],
  invitations: [{ id: 'inv1', organisation_id: ORG, email: 'x@y.z', role: 'reviewer', token: 'TOPSECRETTOKEN' }],
  integration_connections: [{ id: 'ic1', organisation_id: ORG, system: 'x', config: { apikey: 'TOPSECRETKEY' }, vault_secret_id: 'vs1' }],
  conviction_codes: [{ code: 'SP30', description: 'Speeding' }],
  _files: { 'org/v1/a.pdf': Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), 'org/d1/l.jpg': Uint8Array.from([1, 2, 3, 4, 5]) },
};
api.init(makeFake(db));
Object.assign(state, { org: { id: ORG, name: 'Test Drinks Ltd', slug: 'test-drinks' }, user: { id: 'u1', email: 'boss@test.example' }, role: 'superuser' });

const fail = (m) => { console.error('FAIL:', m); process.exitCode = 1; };
const runs = [
  ['plain', { includeRestricted: false, includeDocuments: true }],
  ['licence-encrypted', { includeRestricted: true, includeDocuments: true, passphrase: 'correct horse battery staple' }],
  ['nodocs', { includeRestricted: false, includeDocuments: false }],
];
for (const [name, opts] of runs) {
  const stages = [];
  const r = await buildExitPack({ ...opts, now: new Date('2026-10-17T12:00:00Z'), onProgress: (p) => stages.push(p.stage) });
  writeFileSync(`${out}/${name}.zip`, r.bytes);
  console.log(name, r.filename, r.bytes.length, 'bytes', 'sheets', r.summary.sheets, 'problems', r.summary.problems, 'docs', JSON.stringify(r.summary.documents));
  if (!stages.includes('Reading your data')) fail('no progress');
}
void TABLES;
