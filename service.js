// Service / Repair: the vehicles that are out of service now (at a garage or off the road), and a button to record a new one.
import * as api from './api.js';
import { can } from './state.js';
import { html, mount, on, loadingHtml, emptyHtml, plate, fmtDateShort, todayStr } from './ui.js';
import { UNAVAIL_REASON_LABEL, vehicleTitle } from './domain.js';
import { outOfServiceModal, backInServiceModal, extendReturnModal } from './availability.js';

export async function serviceView(main) {
  mount(main, html`<header class="page-head"><h1>Service / Repair</h1></header>${loadingHtml()}`);
  let [vehicles, garages] = await Promise.all([api.listVehicles(), api.listGarages()]);

  function draw() {
    const gById = new Map(garages.map((g) => [g.id, g]));
    const today = todayStr();
    const out = vehicles
      .filter((v) => v.unavailable_event_id && !v.archived_at && v.status !== 'disposed')
      .sort((a, b) => String(a.unavailable_expected_return || '9999').localeCompare(String(b.unavailable_expected_return || '9999')) || String(a.registration).localeCompare(String(b.registration)));
    mount(main, html`
      <header class="page-head"><h1>Service / Repair</h1>${can.write ? html`<button class="btn btn-primary" data-action="record">Record a service / repair</button>` : ''}</header>
      <p class="muted">Vehicles that are at a garage or off the road now. Use the button to send a vehicle for a service, MOT, tyres, repair or accident repair, or to book it in for a later date.</p>
      ${out.length ? html`
        <p class="summary"><strong>${out.length}</strong> ${out.length === 1 ? 'vehicle is' : 'vehicles are'} out now.</p>
        <table class="grid"><thead><tr><th>Vehicle</th><th>Reason</th><th>Garage</th><th>Since</th><th>Expected back</th><th></th></tr></thead><tbody>
          ${out.map((v) => {
            const off = v.unavailable_reason === 'off_road';
            const late = v.unavailable_expected_return && v.unavailable_expected_return < today;
            return html`<tr>
              <td data-label="Vehicle"><a class="plate-link" href="#/vehicles/${v.id}?tab=availability">${plate(v.registration, v.category)}</a><div class="sub">${vehicleTitle(v)}</div></td>
              <td data-label="Reason">${UNAVAIL_REASON_LABEL[v.unavailable_reason] || v.unavailable_reason}</td>
              <td data-label="Garage">${off ? html`<span class="muted">Not at a garage</span>` : gById.get(v.unavailable_garage_id)?.name || html`<span class="muted">Not known</span>`}</td>
              <td data-label="Since">${fmtDateShort(v.unavailable_since)}</td>
              <td data-label="Expected back">${v.unavailable_expected_return ? html`<span class="${late ? 'c-overdue' : ''}">${late ? html`<strong>Was due</strong> ` : ''}${fmtDateShort(v.unavailable_expected_return)}</span>` : html`<span class="muted">${off ? 'Not set' : 'No date'}</span>`}</td>
              <td class="act">${can.write ? html`<button class="btn btn-sm btn-primary" data-action="back" data-id="${v.unavailable_event_id}">Back in service</button>${off ? '' : html` <button class="btn btn-sm" data-action="extend" data-id="${v.unavailable_event_id}">Change date</button>`}` : ''}</td>
            </tr>`;
          })}
        </tbody></table>`
        : emptyHtml('Nothing is out for service or repair', 'Every vehicle is available. Use "Record a service / repair" when one goes in.')}`);
  }

  const reload = async () => { [vehicles, garages] = await Promise.all([api.listVehicles(), api.listGarages()]); draw(); };
  draw();
  on(main, {
    record: () => outOfServiceModal(null, { onDone: reload }),
    back: (el) => backInServiceModal(el.dataset.id, { onDone: reload }),
    extend: (el) => extendReturnModal(el.dataset.id, { onDone: reload }),
  });
}
