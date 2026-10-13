// Service / Repair: sending a vehicle to a garage or taking it off the road with a SORN, bringing it back, and the follow-up actions.
import * as api from './api.js';
import { html, openModal, fieldsHtml, readForm, toast, fmtDate, fmtDateShort, todayStr, addDaysISO, formatReg, esc, raw } from './ui.js';
import { UNAVAIL_REASON_LABEL, COST_CATEGORY_FOR_REASON, garageSuits, incidentTitle } from './domain.js';

const opts = (o) => Object.entries(o);
const BOARD = ['servicing', 'mot', 'tyres', 'repair', 'accident_repair', 'breakdown', 'tacho', 'tail_lift', 'other_garage', 'off_road'];

// Garages grouped so the right ones come first: suited to the work, other garages, then Unknown.
function garageOptions(garages, reason, selected, category) {
  const live = garages.filter((g) => !g.archived_at);
  const suited = live.filter((g) => garageSuits(g, reason, category));
  const others = live.filter((g) => !g.is_unknown && !garageSuits(g, reason, category));
  const unknown = live.filter((g) => g.is_unknown);
  const o = (g) => `<option value="${esc(g.id)}"${g.id === selected ? ' selected' : ''}>${esc(g.name)}</option>`;
  const group = (label, list) => (list.length ? `<optgroup label="${esc(label)}">${list.map(o).join('')}</optgroup>` : '');
  return raw(`<option value="">Choose a garage</option>${group('Does this kind of work', suited)}${group('Other garages', others)}${group('Not known', unknown)}`);
}

// opts: { reason, from, expectedReturn, incidentId, title, onDone }
// Without a vehicleId the form starts with a choice of vehicle (the Service / Repair screen); with one, the vehicle is fixed.
export async function outOfServiceModal(vehicleId, o = {}) {
  const [fixed, garages, incidents, fleet] = await Promise.all([vehicleId ? api.getVehicle(vehicleId) : null, api.listGarages(), api.listIncidents(), vehicleId ? null : api.listVehicles()]);
  const pickable = (fleet || []).filter((x) => !x.archived_at && x.status !== 'disposed' && !x.unavailable_event_id);
  const damage = incidents.filter((i) => i.kind !== 'fine' && !i.repaired_on);
  const reason0 = o.reason || 'servicing';
  const specs = [
    ...(vehicleId ? [] : [{ name: 'vehicle_id', label: 'Vehicle', type: 'select', required: true, blank: 'Choose a vehicle', span: 2,
      options: pickable.map((x) => [x.id, [formatReg(x.registration), [x.make, x.model].filter(Boolean).join(' ')].filter(Boolean).join(' - ')]) }]),
    { name: 'reason', label: 'Reason', type: 'select', required: true, options: BOARD.map((r) => [r, UNAVAIL_REASON_LABEL[r]]), span: 2 },
    { name: 'from_date', label: 'From', type: 'date', required: true, hint: 'A future date books the garage in.' },
    { name: 'expected_return', label: 'Expected back', type: 'date', hint: 'A task reminds you if it is not back by then.' },
    { name: 'garage_id', label: 'Garage', type: 'select', required: true, options: [] },
    { name: 'incident_id', label: 'Linked accident or damage', type: 'select', blank: 'Not linked', options: [] },
    { name: 'location_note', label: 'Where is it?', hint: 'For example: stored at the depot.', span: 2 },
    { name: 'sorn_declared_on', label: 'SORN declared on', type: 'date', hint: 'A vehicle that is off the road must be taxed or have a SORN. Leave blank and a task will remind you to declare it.', span: 2 },
    { name: 'notes', label: 'Notes', type: 'textarea', span: 2 },
  ];
  const chosen = (f) => fixed || fleet.find((x) => x.id === f.elements.vehicle_id?.value) || null;
  const dlg = openModal({
    title: o.title || (fixed ? `Service / Repair: ${formatReg(fixed.registration)}` : 'Record a service / repair'), submitLabel: 'Save', wide: true,
    body: html`${fieldsHtml(specs, { reason: reason0, from_date: o.from || todayStr(), expected_return: o.expectedReturn || '' })}<p class="warn" id="garage-warn" role="status" hidden></p>`,
    onSubmit: async (f) => {
      const x = readForm(f, specs);
      const v = chosen(f);
      if (!v) throw new Error('Choose the vehicle.');
      if (x.reason !== 'off_road' && !x.garage_id) throw new Error('Choose the garage. Use Unknown garage if you do not know.');
      if (x.reason === 'off_road' && x.from_date > todayStr()) throw new Error('A vehicle goes off the road from today or earlier. Choose a garage reason to book a future visit.');
      if (x.expected_return && x.expected_return < x.from_date) throw new Error('It cannot be back before it goes.');
      await api.outOfService({
        vehicleId: v.id, reason: x.reason, garageId: x.reason === 'off_road' ? null : x.garage_id, from: x.from_date, expectedReturn: x.reason === 'off_road' ? null : x.expected_return,
        incidentId: ['repair', 'accident_repair'].includes(x.reason) ? x.incident_id : null, locationNote: x.reason === 'off_road' ? x.location_note : null, notes: x.notes,
        sornDeclaredOn: x.reason === 'off_road' ? x.sorn_declared_on : null,
      });
      const g = garages.find((y) => y.id === x.garage_id);
      toast(x.reason === 'off_road' ? (x.sorn_declared_on ? 'Vehicle taken off the road with a SORN.' : 'Vehicle taken off the road. A task reminds you to declare the SORN.')
        : x.from_date > todayStr() ? `Booked in at ${g?.name} on ${fmtDateShort(x.from_date)}.` : `Marked as at ${g?.name}.`);
      await o.onDone?.();
    },
  });
  const f = dlg.querySelector('form');
  const field = (n) => f.elements[n].closest('.field');
  const refresh = () => {
    const r = f.elements.reason.value;
    const v = chosen(f);
    const g = f.elements.garage_id;
    g.innerHTML = garageOptions(garages, r, g.value, v?.category).s;
    // Only damage on the chosen vehicle can be linked to a repair.
    const inc = f.elements.incident_id;
    const keep = inc.value || o.incidentId || '';
    const mine = damage.filter((i) => v && i.vehicle_id === v.id);
    inc.innerHTML = raw(`<option value="">Not linked</option>${mine.map((i) => `<option value="${esc(i.id)}"${i.id === keep ? ' selected' : ''}>${esc(`${incidentTitle(i)}, ${fmtDateShort(i.incident_date)}`)}</option>`).join('')}`).s;
    const off = r === 'off_road';
    field('garage_id').hidden = off; field('expected_return').hidden = off; field('location_note').hidden = !off; field('sorn_declared_on').hidden = !off;
    field('incident_id').hidden = !['repair', 'accident_repair'].includes(r);
    g.required = !off;
    warn();
  };
  const warn = () => {
    const box = dlg.querySelector('#garage-warn');
    const g = garages.find((x) => x.id === f.elements.garage_id.value);
    const r = f.elements.reason.value;
    const v = chosen(f);
    box.hidden = !(g && !g.is_unknown && r !== 'off_road' && !garageSuits(g, r, v?.category));
    if (!box.hidden) box.textContent = v?.category === 'forklift' ? `${g.name} is not listed as doing forklift work. You can still choose it. If that is wrong, update its types of work under Garages.`
      : `${g.name} is not listed as doing this kind of work. You can still choose it. If that is wrong, update its types of work under Garages.`;
  };
  f.elements.reason.addEventListener('change', refresh);
  f.elements.vehicle_id?.addEventListener('change', refresh);
  f.elements.garage_id.addEventListener('change', warn);
  refresh();
}

// A servicing visit booked from the "book the garage" task: starts on the service due date.
export async function bookGarageModal(vehicleId, dueDate, onDone) {
  const tomorrow = addDaysISO(todayStr(), 1);
  const from = dueDate && dueDate > tomorrow ? dueDate : tomorrow;
  return outOfServiceModal(vehicleId, { reason: 'servicing', from, expectedReturn: from, title: 'Book the garage for the service', onDone });
}

export async function backInServiceModal(eventId, o = {}) {
  const events = await api.listUnavailability();
  const e = events.find((x) => x.id === eventId);
  const [v, garages] = await Promise.all([api.getVehicle(e.vehicle_id), api.listGarages()]);
  const g = garages.find((x) => x.id === e.garage_id);
  const record = e.reason === 'servicing' || e.reason === 'mot';
  const specs = [
    { name: 'returned_on', label: 'Back in service on', type: 'date', required: true, min: e.from_date, max: todayStr() },
    ...(e.reason === 'off_road' ? [] : [{ name: 'cost', label: 'Cost of the work (£)', type: 'number', step: '0.01', min: '0', hint: 'Optional. Added to the vehicle costs with this garage.' }]),
    ...(record ? [
      { name: 'record_done', label: e.reason === 'servicing' ? 'Record the service as done' : 'Record the test as done', type: 'checkbox', span: 2 },
      { name: 'reference', label: e.reason === 'servicing' ? 'Invoice or job number' : 'Certificate number' },
      { name: 'new_due_date', label: 'Next due', type: 'date', hint: 'Leave blank to use the standard interval.' },
    ] : []),
    { name: 'notes', label: 'Notes', type: 'textarea', span: 2 },
  ];
  openModal({
    title: `Back in service: ${formatReg(v.registration)}`, submitLabel: 'Back in service', wide: true,
    body: html`<p class="muted">${e.reason === 'off_road' ? `Off the road since ${fmtDate(e.from_date)}.` : `${UNAVAIL_REASON_LABEL[e.reason]} at ${g?.name || 'a garage'} since ${fmtDate(e.from_date)}.`}</p>
      ${e.reason === 'off_road' ? html`<p class="warn">Before it goes back on the road check that it is taxed, has a valid MOT and is covered by insurance. Its SORN ends when you save.</p>` : ''}
      ${fieldsHtml(specs, { returned_on: todayStr(), record_done: record })}`,
    onSubmit: async (f) => {
      const x = readForm(f, specs);
      await api.backInService({ eventId, returnedOn: x.returned_on, notes: x.notes });
      if (x.cost && e.incident_id) await api.updateIncident(e.incident_id, { repair_cost: x.cost });   // an accident's repair cost lives on the incident, so it is never counted twice
      else if (x.cost) await api.addCost({ vehicle_id: v.id, category: COST_CATEGORY_FOR_REASON[e.reason] || 'repairs', cost_date: x.returned_on, amount: x.cost, garage_id: e.garage_id, invoice_ref: x.reference || null, note: UNAVAIL_REASON_LABEL[e.reason] });
      let renewed = false;
      if (x.record_done) {
        const code = e.reason === 'servicing' ? 'SERVICE' : (['hgv', 'bus', 'trailer'].includes(v.category) ? 'ANNUAL_TEST' : 'MOT');
        const item = await api.getVehicleItem(v.id, code);
        if (item) { await api.recordRenewal({ itemId: item.id, completedOn: x.returned_on, newDueDate: x.new_due_date, reference: x.reference, cost: x.cost, notes: x.notes }); renewed = true; }
      }
      toast(`Back in service.${renewed ? ' The next due date has been set.' : ''}`);
      await o.onDone?.();
    },
  });
}

export async function convertToOffRoadModal(eventId, o = {}) {
  const specs = [{ name: 'sorn_declared_on', label: 'SORN declared on', type: 'date', required: true, max: todayStr(), hint: 'Declare the SORN with the DVLA, then enter the date here.' }];
  openModal({
    title: 'Record as off the road with a SORN', submitLabel: 'Save', body: html`<p class="muted">The vehicle has been away for a long time. If it is not going back on the road soon it must have a SORN, and road tax and insurance reminders stop while it is in force.</p>${fieldsHtml(specs, { sorn_declared_on: todayStr() })}`,
    onSubmit: async (f) => { const x = readForm(f, specs); await api.convertToOffRoad({ eventId, sornDeclaredOn: x.sorn_declared_on }); toast('Recorded as off the road with a SORN.'); await o.onDone?.(); },
  });
}

export function sornDeclaredModal(eventId, o = {}) {
  const specs = [{ name: 'sorn_declared_on', label: 'SORN declared on', type: 'date', required: true, max: todayStr() }];
  openModal({
    title: 'Record the SORN', submitLabel: 'Save', body: fieldsHtml(specs, { sorn_declared_on: todayStr() }),
    onSubmit: async (f) => { const x = readForm(f, specs); await api.updateUnavailability(eventId, { sorn_declared_on: x.sorn_declared_on }); toast('SORN recorded.'); await o.onDone?.(); },
  });
}

export async function extendReturnModal(eventId, o = {}) {
  const e = (await api.listUnavailability()).find((x) => x.id === eventId);
  const specs = [{ name: 'expected_return', label: 'Now expected back', type: 'date', required: true, min: todayStr() }];
  openModal({
    title: 'Change the expected return', submitLabel: 'Save', body: fieldsHtml(specs, { expected_return: e?.expected_return && e.expected_return > todayStr() ? e.expected_return : addDaysISO(todayStr(), 3) }),
    onSubmit: async (f) => { const x = readForm(f, specs); await api.updateUnavailability(eventId, { expected_return: x.expected_return }); toast('Expected return updated.'); await o.onDone?.(); },
  });
}

export function cancelBookingModal(eventId, o = {}) {
  const specs = [{ name: 'notes', label: 'Why is it being cancelled?', type: 'textarea', span: 2 }];
  openModal({
    title: 'Cancel this booking?', submitLabel: 'Cancel booking', danger: true,
    body: html`<p class="muted">The booking stays on record as cancelled. The diary is freed up, and a task to book the garage returns if this was for a service.</p>${fieldsHtml(specs)}`,
    onSubmit: async (f) => { const x = readForm(f, specs); await api.cancelBooking({ eventId, notes: x.notes }); toast('Booking cancelled.'); await o.onDone?.(); },
  });
}

export async function rescheduleModal(eventId, o = {}) {
  const e = (await api.listUnavailability()).find((x) => x.id === eventId);
  const specs = [
    { name: 'from_date', label: 'Going in on', type: 'date', required: true, min: addDaysISO(todayStr(), 1) },
    { name: 'expected_return', label: 'Expected back', type: 'date' },
  ];
  openModal({
    title: 'Change the booking', submitLabel: 'Save', body: fieldsHtml(specs, { from_date: e.from_date, expected_return: e.expected_return || '' }),
    onSubmit: async (f) => {
      const x = readForm(f, specs);
      if (x.expected_return && x.expected_return < x.from_date) throw new Error('It cannot be back before it goes in.');
      await api.updateUnavailability(eventId, { from_date: x.from_date, expected_return: x.expected_return });
      toast('Booking changed.'); await o.onDone?.();
    },
  });
}
