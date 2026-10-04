// Settings (superuser only). Vehicles needed, depots, users and invitations, and the date format. Compliance types, templates and branding come later.
import * as api from './api.js';
import { state, can, ROLE_LABEL, ROLE_HINT, ROLE_ORDER, ACCESS_SUMMARY, MEMBER_STATUS_LABEL } from './state.js';
import { html, mount, on, openModal, fieldsHtml, readForm, toast, loadingHtml, emptyHtml, fmtDateShort, formatDate, DATE_FORMATS, getDateFormat, setDateFormat } from './ui.js';
import { CATEGORY_LABEL, WEEKDAYS } from './domain.js';
import { DEFAULT_TYPICAL_MPG, DEFAULT_MILES_PER_KWH } from './tco.js';

export async function settingsView(main) {
  if (!can.configure) { mount(main, html`<header class="page-head"><h1>Settings</h1></header>${emptyHtml("You don't have access to settings", 'Only the superuser can change settings.')}`); return; }
  mount(main, html`<header class="page-head"><h1>Settings</h1></header>${loadingHtml()}`);
  const load = () => Promise.all([api.listAllDepots(), api.listVehicles(), api.listDrivers(), api.listVehicleRequirements(), api.listMembers(), api.listInvitations()]);
  let [depots, vehicles, drivers, needs, members, invites] = await load();
  let showRemoved = false;
  const typicalMpg = () => state.org.settings?.typical_mpg || {};   // only the figures this organisation has changed
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
      <section class="settings-block spaced-top">
        <div class="section-head"><h2>Users and access</h2><button class="btn btn-primary" data-action="invite">Invite user</button></div>
        <p class="muted">Who can sign in to ${state.org.name} and what they are allowed to do. Nobody is ever deleted: a suspended user can be reinstated, and a removed user is kept so the audit log stays complete and must be invited again to come back.</p>
        ${members.some((m) => m.status === 'removed') ? html`<p><label class="check small"><input type="checkbox" id="show-removed" ${showRemoved ? 'checked' : ''}> <span>Show removed users (${members.filter((m) => m.status === 'removed').length})</span></label></p>` : ''}
        <table class="grid"><thead><tr><th>Email</th><th>User type</th><th>Status</th><th></th></tr></thead><tbody>
          ${members.filter((m) => showRemoved || m.status !== 'removed').map((m) => { const me = m.user_id === state.user?.id; return html`<tr class="${m.status === 'active' ? '' : 'row-off'}">
            <td data-label="Email"><strong>${m.email || 'Unknown'}</strong>${me ? html` <span class="tag">You</span>` : ''}</td>
            <td data-label="User type">${ROLE_LABEL[m.role] || m.role}</td>
            <td data-label="Status">${m.status === 'active' ? 'Active' : html`<span class="${m.status === 'disabled' ? 'c-soon' : 'muted'}">${MEMBER_STATUS_LABEL[m.status] || m.status} ${fmtDateShort(m.updated_at)}</span>`}</td>
            <td class="act">${me ? html`<span class="muted">You cannot change your own access</span>`
              : m.status === 'active' ? html`<button class="btn btn-sm" data-action="member-type" data-id="${m.id}">Change type</button> <button class="btn btn-sm" data-action="member-suspend" data-id="${m.id}">Suspend</button> <button class="btn btn-sm" data-action="member-remove" data-id="${m.id}">Remove</button>`
                : m.status === 'disabled' ? html`<button class="btn btn-sm" data-action="member-reinstate" data-id="${m.id}">Reinstate</button> <button class="btn btn-sm" data-action="member-remove" data-id="${m.id}">Remove</button>`
                  : invites.some((i) => i.email === m.email.toLowerCase()) ? html`<span class="muted">Invited again</span>` : html`<button class="btn btn-sm" data-action="member-invite" data-id="${m.id}">Invite again</button>`}</td></tr>`; })}
          ${invites.map((i) => { const expired = new Date(i.expires_at) < new Date(); return html`<tr>
            <td data-label="Email">${i.email}</td>
            <td data-label="User type">${ROLE_LABEL[i.role] || i.role}</td>
            <td data-label="Status">${expired ? html`<span class="c-overdue">Invitation expired ${fmtDateShort(i.expires_at)}</span>` : html`Invited, link works until ${fmtDateShort(i.expires_at)}`}</td>
            <td class="act">${expired ? html`<button class="btn btn-sm" data-action="reinvite" data-id="${i.id}">Invite again</button>` : html`<button class="btn btn-sm" data-action="link" data-id="${i.id}">Show link</button>`}
              <button class="btn btn-sm" data-action="revoke" data-id="${i.id}">Revoke</button></td></tr>`; })}
        </tbody></table>
        <details class="access-summary"><summary>Who can do what</summary>
          <p class="muted">What each user type can do. These rules are fixed and are enforced by the database, not just by the screens.</p>
          <div class="scroll"><table class="grid keep compact access-table"><thead><tr><th>Area</th>${ROLE_ORDER.map((r) => html`<th>${ROLE_LABEL[r]}</th>`)}</tr></thead><tbody>
            ${ACCESS_SUMMARY.map(([area, levels]) => html`<tr><td>${area}</td>${levels.map((l) => html`<td><span class="lvl lvl-${l.toLowerCase()}">${l}</span></td>`)}</tr>`)}
          </tbody></table></div>
          <p class="hint">Full: see, add and change. View: see only. None: not shown at all.</p>
        </details>
      </section>
      <section class="settings-block">
        <div class="section-head"><h2>Date format</h2></div>
        <p class="muted">How dates are shown on every screen and in downloaded reports, for everyone in ${state.org.name}. Boxes where you pick a date follow each person's own browser settings.</p>
        <form id="date-form" class="inline-form">
          <div class="field"><label for="date-format">Format</label><select id="date-format" name="date_format">${DATE_FORMATS.map(([k]) => html`<option value="${k}" ${k === getDateFormat() ? 'selected' : ''}>${formatDate(new Date(), k)} (${k})</option>`)}</select></div>
          <button class="btn btn-primary" type="submit">Save date format</button>
        </form>
      </section>
      <section class="settings-block">
        <div class="section-head"><h2>Typical fuel economy</h2><a class="btn btn-sm" href="#/costs?tab=fuel">Open fuel prices</a></div>
        <p class="muted">Used to work out fuel cost for any vehicle that has no fuel economy figure on its own record. These are typical figures for each type, not measurements, and costs that rest on them are marked as such. Leave a box empty to go back to the standard figure.</p>
        <form id="mpg-form" class="needs" novalidate>
          <fieldset class="needs-row"><legend><strong>Miles per gallon</strong></legend>
            <div class="needs-days">${Object.keys(DEFAULT_TYPICAL_MPG).map((c) => html`<label class="needs-day"><span>${CATEGORY_LABEL[c]}</span><input type="number" name="mpg.${c}" min="1" max="200" step="0.1" inputmode="decimal" value="${typicalMpg()[c] ?? ''}" placeholder="${DEFAULT_TYPICAL_MPG[c]}" aria-label="Typical miles per gallon for ${CATEGORY_LABEL[c]}"></label>`)}</div></fieldset>
          <fieldset class="needs-row"><legend><strong>Electric vehicles</strong></legend>
            <div class="needs-days"><label class="needs-day"><span>Miles per kWh</span><input type="number" name="kwh" min="0.1" max="20" step="0.1" inputmode="decimal" value="${state.org.settings?.typical_miles_per_kwh ?? ''}" placeholder="${DEFAULT_MILES_PER_KWH}" aria-label="Typical miles per kWh"></label></div></fieldset>
          <p class="form-error" role="alert" hidden></p>
          <p><button class="btn btn-primary" type="submit">Save fuel economy</button></p>
        </form>
      </section>
      <section class="later"><h2>Coming later</h2><p class="muted">Task types and reminder timings, message templates, and branding will be managed here.</p></section>`);
    wireNeeds();
    main.querySelector('#mpg-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target; const err = form.querySelector('.form-error'); err.hidden = true;
      const typical = {};
      for (const c of Object.keys(DEFAULT_TYPICAL_MPG)) {
        const raw = String(form.elements[`mpg.${c}`].value).trim(); if (raw === '') continue;
        if (!(Number(raw) >= 1 && Number(raw) <= 200)) { err.textContent = `${CATEGORY_LABEL[c]}: enter miles per gallon between 1 and 200, or leave it empty.`; err.hidden = false; return; }
        typical[c] = Number(raw);
      }
      const kwhRaw = String(form.elements.kwh.value).trim();
      if (kwhRaw !== '' && !(Number(kwhRaw) >= 0.1 && Number(kwhRaw) <= 20)) { err.textContent = 'Electric: enter miles per kWh between 0.1 and 20, or leave it empty.'; err.hidden = false; return; }
      const btn = form.querySelector('button[type="submit"]'); btn.disabled = true;
      try { await api.saveOrgSettings({ typical_mpg: typical, typical_miles_per_kwh: kwhRaw === '' ? null : Number(kwhRaw) }); toast('Fuel economy saved.'); draw(); }
      catch (ex) { err.textContent = ex.message || 'Could not save.'; err.hidden = false; btn.disabled = false; }
    });
    main.querySelector('#show-removed')?.addEventListener('change', (e) => { showRemoved = e.target.checked; draw(); });
    main.querySelector('#date-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button'); btn.disabled = true;
      try { const f = e.target.elements.date_format.value; await api.saveOrgSettings({ date_format: f }); setDateFormat(f); toast('Date format saved.'); draw(); }
      catch (ex) { toast(ex.message || 'Could not save.', 'error'); btn.disabled = false; }
    });
  }

  // ---- Users and invitations ----
  const ROLES = ROLE_ORDER;
  const roleHints = () => html`<dl class="role-hints">${ROLES.map((r) => html`<div><dt>${ROLE_LABEL[r]}</dt><dd>${ROLE_HINT[r]}</dd></div>`)}</dl>`;
  const memberBy = (el) => members.find((m) => m.id === el.dataset.id);
  // Change a person's user type. Their own access is never changed from here, so a superuser cannot lock themselves out.
  function memberTypeModal(m) {
    const fields = [{ name: 'role', label: 'User type', type: 'select', required: true, span: 2, options: ROLES.map((r) => [r, ROLE_LABEL[r]]) }];
    openModal({
      title: `Change user type: ${m.email}`, submitLabel: 'Save user type', body: html`${fieldsHtml(fields, { role: m.role })}${roleHints()}`,
      onSubmit: async (f) => {
        const v = readForm(f, fields);
        if (!ROLES.includes(v.role)) throw new Error('Choose a user type.');
        if (v.role !== m.role) { await api.updateMember(m.id, { role: v.role }); toast(`${m.email} is now ${ROLE_LABEL[v.role]}.`); }
        await reload();
      },
    });
  }
  // Suspend, reinstate or remove. Each asks first and says exactly what will happen.
  function memberStatusModal(m, status) {
    const text = {
      disabled: { title: `Suspend ${m.email}?`, button: 'Suspend user', done: 'suspended', body: 'They will not be able to open this organisation until you reinstate them. Their user type and everything they have done are kept.' },
      active: { title: `Reinstate ${m.email}?`, button: 'Reinstate user', done: 'reinstated', body: html`They will be able to sign in again as <strong>${ROLE_LABEL[m.role]}</strong>.` },
      removed: { title: `Remove ${m.email}?`, button: 'Remove user', done: 'removed', body: 'Use this when someone has left. They lose access straight away. Their record and everything they did stay in the audit log. If they come back, invite them again with the same email address.' },
    }[status];
    openModal({
      title: text.title, submitLabel: text.button, danger: status !== 'active', body: html`<p>${text.body}</p>`,
      onSubmit: async () => { await api.updateMember(m.id, { status }); toast(`${m.email} ${text.done}.`); await reload(); },
    });
  }
  const inviteLink = (i) => `${location.origin}${location.pathname}?invite=${i.token}`;
  // The app does not send email itself: the superuser copies the link, or opens their own mail app with it written out.
  function showInvite(i) {
    const link = inviteLink(i);
    const subject = `Your invitation to the ${state.org.name} fleet system`;
    const body = `Hello,\n\nYou have been invited to the ${state.org.name} fleet system as ${ROLE_LABEL[i.role]}.\n\nOpen this link and create your account with this email address (${i.email}):\n${link}\n\nThe link works until ${fmtDateShort(i.expires_at)}.`;
    const dlg = openModal({
      title: 'Invitation ready', hideFooter: true,
      body: html`<p>Send this link to <strong>${i.email}</strong>. They create an account with that email address and join as <strong>${ROLE_LABEL[i.role]}</strong>. The link works until ${fmtDateShort(i.expires_at)}.</p>
        <div class="field"><label for="invite-link">Invitation link</label><input type="text" id="invite-link" readonly value="${link}"></div>
        <p class="invite-actions"><button type="button" class="btn btn-primary" data-copy>Copy link</button>
          <a class="btn" href="mailto:${i.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}">Email it</a></p>
        <p class="hint">FleetMonitor does not send the email itself. "Email it" opens your own mail app with the message written for you.</p>`,
    });
    const box = dlg.querySelector('#invite-link');
    box.addEventListener('focus', () => box.select());
    dlg.querySelector('[data-copy]').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(link); } catch { box.select(); document.execCommand?.('copy'); }
      toast('Link copied.');
    });
  }
  function inviteModal(preset = {}) {
    const fields = [
      { name: 'email', label: 'Email address', type: 'email', required: true, span: 2, autocomplete: 'off', hint: 'They must create their account with this exact address.' },
      { name: 'role', label: 'User type', type: 'select', required: true, span: 2, options: ROLES.map((r) => [r, ROLE_LABEL[r]]) },
    ];
    const dlg = openModal({
      title: 'Invite user', submitLabel: 'Create invitation',
      body: html`${fieldsHtml(fields, preset)}${roleHints()}`,
      onSubmit: async (f) => {
        const v = readForm(f, fields);
        const email = String(v.email || '').toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a full email address.');
        if (!ROLES.includes(v.role)) throw new Error('Choose a user type.');
        const existing = members.find((m) => m.email.toLowerCase() === email);
        if (existing?.status === 'active') throw new Error('That person is already a user here.');
        if (existing?.status === 'disabled') throw new Error('That person is suspended. Reinstate them from the list instead.');
        const inv = await api.createInvitation({ email, role: v.role });
        dlg.addEventListener('close', () => showInvite(inv), { once: true });   // show the link once this dialog has closed
        await reload();
      },
    });
  }
  const reload = async () => { [depots, vehicles, drivers, needs, members, invites] = await load(); draw(); };
  const open = (d) => openModal({
    title: d ? 'Edit depot' : 'Add depot', submitLabel: 'Save', body: fieldsHtml(specs, d || {}),
    onSubmit: async (f) => { const v = readForm(f, specs); await api.saveDepot(v, d?.id); toast('Depot saved.'); await reload(); },
  });
  draw();
  on(main, {
    invite: () => inviteModal(),
    'member-type': (el) => memberTypeModal(memberBy(el)),
    'member-suspend': (el) => memberStatusModal(memberBy(el), 'disabled'),
    'member-reinstate': (el) => memberStatusModal(memberBy(el), 'active'),
    'member-remove': (el) => memberStatusModal(memberBy(el), 'removed'),
    'member-invite': (el) => { const m = memberBy(el); inviteModal({ email: m.email, role: m.role }); },
    reinvite: (el) => { const i = invites.find((x) => x.id === el.dataset.id); inviteModal({ email: i.email, role: i.role }); },
    link: (el) => showInvite(invites.find((x) => x.id === el.dataset.id)),
    revoke: (el) => {
      const i = invites.find((x) => x.id === el.dataset.id);
      openModal({
        title: 'Revoke this invitation?', submitLabel: 'Revoke invitation', danger: true,
        body: html`<p>The link sent to <strong>${i.email}</strong> will stop working. You can invite them again later.</p>`,
        onSubmit: async () => { await api.revokeInvitation(i.id); toast('Invitation revoked.'); await reload(); },
      });
    },
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
