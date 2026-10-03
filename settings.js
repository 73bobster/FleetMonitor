// Settings (superuser only). Vehicles needed and depots now; users, compliance types, templates and branding come later.
import * as api from './api.js';
import { can } from './state.js';
import { html, mount, on, openModal, fieldsHtml, readForm, toast, loadingHtml, emptyHtml } from './ui.js';
import { CATEGORY_LABEL, WEEKDAYS } from './domain.js';

export async function settingsView(main) {
  if (!can.configure) { mount(main, html`<header class="page-head"><h1>Settings</h1></header>${emptyHtml("You don't have access to settings", 'Only the superuser can change settings.')}`); return; }
  mount(main, html`<header class="page-head"><h1>Settings</h1></header>${loadingHtml()}`);
  let [depots, vehicles, drivers, needs] = await Promise.all([api.listAllDepots(), api.listVehicles(), api.listDrivers(), api.listVehicleRequirements()]);
  // Vehicles needed: one row per vehicle type that is in the fleet (or already has numbers), one box per day of the week.
  const inFleet = (cat) => vehicles.filter((v) => v.category === cat && !v.archived_at && v.status !== 'disposed').length;
  const needFor = (cat) => needs.find((n) => n.category === cat);
  const needCats = () => Object.keys(CATEGORY_LABEL).filter((c) => inFleet(c) || WEEKDAYS.some(([k]) => needFor(c)?.[k] > 0));
  const needsHtml = () => {
    const cats = needCats();
    if (!cats.length) return emptyHtml('No vehicles yet', 'Add vehicles first. Each type of vehicle then gets a row here.');
    return html`<form id="needs-form" class="needs" novalidate>
      ${cats.map((c) => html`<fieldset class="needs-row"><legend><strong>${CATEGORY_LABEL[c]}</strong> <span class="muted">${inFleet(c)} in the fleet</span></legend>
        <div class="needs-days">${WEEKDAYS.map(([k, short, long]) => html`<label class="needs-day"><span aria-hidden="true">${short}</span>
          <input type="number" name="${c}.${k}" min="0" max="999" step="1" inputmode="numeric" value="${needFor(c)?.[k] ?? 0}" aria-label="${CATEGORY_LABEL[c]} needed on ${long}"></label>`)}</div>
        <p class="hint needs-over" data-over="${c}" hidden></p></fieldset>`)}
      <p class="form-error" role="alert" hidden></p>
      <p><button class="btn btn-primary" type="submit">Save vehicles needed</button></p>
    </form>`;
  };
  // Reads the boxes: blank counts as 0. Returns null (and says why) if a value is not a whole number from 0 to 999.
  function readNeeds(form) {
    const rows = [];
    for (const c of needCats()) {
      const row = { category: c };
      for (const [k, , long] of WEEKDAYS) {
        const rawVal = String(form.elements[`${c}.${k}`].value).trim(); const n = rawVal === '' ? 0 : Number(rawVal);
        if (!Number.isInteger(n) || n < 0 || n > 999) return { error: `${CATEGORY_LABEL[c]}, ${long}: enter a whole number from 0 to 999.` };
        row[k] = n;
      }
      rows.push(row);
    }
    return { rows };
  }
  // Asking for more than the fleet holds is allowed (you may be about to add vehicles) but is pointed out.
  function flagOver(form) {
    for (const c of needCats()) {
      const over = WEEKDAYS.filter(([k]) => Number(form.elements[`${c}.${k}`].value) > inFleet(c)).map(([, , long]) => long);
      const p = form.querySelector(`[data-over="${c}"]`);
      p.hidden = !over.length;
      p.textContent = over.length ? `More than the ${inFleet(c)} in the fleet on ${over.join(', ')}. Every one of those days will show as short.` : '';
    }
  }
  function wireNeeds() {
    const form = main.querySelector('#needs-form'); if (!form) return;
    const err = form.querySelector('.form-error');
    flagOver(form);
    form.addEventListener('input', () => { err.hidden = true; flagOver(form); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const { rows, error } = readNeeds(form);
      if (error) { err.textContent = error; err.hidden = false; return; }
      const btn = form.querySelector('button[type="submit"]'); btn.disabled = true;
      try { await api.saveVehicleRequirements(rows); toast('Vehicles needed saved.'); await reload(); }
      catch (ex) { err.textContent = ex.message || 'Could not save.'; err.hidden = false; btn.disabled = false; }
    });
  }
  const usage = (id) => ({ v: vehicles.filter((x) => x.depot_id === id && !x.archived_at && x.status !== 'disposed').length, d: drivers.filter((x) => x.depot_id === id && x.employment_status === 'active').length });

  const specs = [
    { name: 'name', label: 'Depot name', required: true, span: 2 },
    { name: 'address', label: 'Address', type: 'textarea', rows: 2, span: 2 },
    { name: 'postcode', label: 'Postcode' },
    { name: 'phone', label: 'Phone', type: 'tel' },
  ];
  function draw() {
    mount(main, html`
      <header class="page-head"><h1>Settings</h1></header>
      <section class="settings-block">
        <div class="section-head"><h2>Vehicles needed</h2><a class="btn btn-sm" href="#/planner">Open the planner</a></div>
        <p class="muted">The fewest vehicles of each type you need on the road on each day of the week, across the whole fleet. The Planner uses these numbers to flag days when too few are available. Leave a day at 0 if there is no minimum.</p>
        ${needsHtml()}
      </section>
      <section>
        <div class="section-head"><h2>Depots</h2><button class="btn btn-primary" data-action="add">Add depot</button></div>
        <p class="muted">The master list of depots. Vehicles and drivers choose from this list.</p>
        ${depots.length ? html`<table class="grid"><thead><tr><th>Depot</th><th>Address</th><th class="num">Vehicles</th><th class="num">Drivers</th><th></th></tr></thead><tbody>
          ${depots.map((d) => { const u = usage(d.id); return html`<tr>
            <td data-label="Depot"><strong>${d.name}</strong>${d.archived_at ? html` <span class="tag">Archived</span>` : ''}</td>
            <td data-label="Address">${[d.address, d.postcode].filter(Boolean).join(', ')}${d.phone ? html`<div class="sub">${d.phone}</div>` : ''}</td>
            <td data-label="Vehicles" class="num">${u.v}</td><td data-label="Drivers" class="num">${u.d}</td>
            <td class="act"><button class="btn btn-sm" data-action="edit" data-id="${d.id}">Edit</button>
              <button class="btn btn-sm" data-action="${d.archived_at ? 'restore' : 'archive'}" data-id="${d.id}">${d.archived_at ? 'Restore' : 'Archive'}</button></td></tr>`; })}
        </tbody></table>` : emptyHtml('No depots yet', 'Add the sites your vehicles and drivers work from.')}
      </section>
      <section class="later"><h2>Coming later</h2><p class="muted">Users and roles, task types and reminder timings, message templates, and branding will be managed here.</p></section>`);
    wireNeeds();
  }
  const reload = async () => { [depots, vehicles, drivers, needs] = await Promise.all([api.listAllDepots(), api.listVehicles(), api.listDrivers(), api.listVehicleRequirements()]); draw(); };
  const open = (d) => openModal({
    title: d ? 'Edit depot' : 'Add depot', submitLabel: 'Save', body: fieldsHtml(specs, d || {}),
    onSubmit: async (f) => { const v = readForm(f, specs); await api.saveDepot(v, d?.id); toast('Depot saved.'); await reload(); },
  });
  draw();
  on(main, {
    add: () => open(null),
    edit: (el) => open(depots.find((d) => d.id === el.dataset.id)),
    archive: (el) => {
      const d = depots.find((x) => x.id === el.dataset.id); const u = usage(d.id);
      openModal({
        title: `Archive ${d.name}?`, submitLabel: 'Archive depot', danger: true,
        body: html`<p>It will no longer be offered when choosing a depot.${u.v + u.d ? ` ${u.v} vehicle(s) and ${u.d} driver(s) are still assigned to it. They keep it until you change them.` : ''}</p>`,
        onSubmit: async () => { await api.saveDepot({ archived_at: new Date().toISOString() }, d.id); toast('Depot archived.'); await reload(); },
      });
    },
    restore: async (el) => { await api.saveDepot({ archived_at: null }, el.dataset.id); toast('Depot restored.'); await reload(); },
  });
}
