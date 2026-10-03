// Tasks: everything coming due, grouped by urgency, with the actions to deal with it.
import * as api from '../api.js';
import { can } from '../state.js';
import { html, mount, on, pill, fmtDate, dueText, loadingHtml, emptyHtml, plural } from '../ui.js';
import { STATUS_LABEL, STATUS_ORDER, driverName, taskKey } from '../domain.js';
import { openTaskPanel, taskWho, renewModal, setDateModal, restoreTask } from '../actions.js';
import { setBadge } from '../shell.js';

const KINDS = [['all', 'All'], ['vehicle', 'Vehicles'], ['driver', 'Drivers'], ['policy', 'Insurance']];

export async function tasksView(main) {
  mount(main, html`<header class="page-head"><h1>Tasks</h1></header>${loadingHtml('Loading tasks')}`);
  const [initialTasks, depots, vehicles, drivers] = await Promise.all([api.listTasks(), api.listDepots(), api.listVehicles(), api.listDrivers()]);
  let tasks = initialTasks;
  const ctx = { vehicles: new Map(vehicles.map((v) => [v.id, v])), drivers: new Map(drivers.map((d) => [d.id, d])) };
  const ui = { kind: 'all', depot: '', q: '', quiet: false, open: new Set(['overdue', 'due_soon', 'no_date']) };

  const searchText = (t) => {
    const v = t.vehicle_id ? ctx.vehicles.get(t.vehicle_id) : null;
    const d = t.driver_id ? ctx.drivers.get(t.driver_id) : null;
    return [t.type_name, t.target_label, v?.make, v?.model, v?.nickname, d ? driverName(d) : ''].join(' ').toLowerCase();
  };
  const filtered = () => tasks.filter((t) =>
    (ui.kind === 'all' || t.applies_to === ui.kind) &&
    (!ui.depot || t.depot_id === ui.depot) &&
    (!ui.q || searchText(t).includes(ui.q)));
  const byKey = (k) => tasks.find((t) => taskKey(t) === k);

  mount(main, html`
    <header class="page-head"><h1>Tasks</h1></header>
    <div class="filters">
      <div class="seg" role="group" aria-label="Show">${KINDS.map(([k, l]) => html`<button type="button" class="seg-btn" data-action="kind" data-kind="${k}" aria-pressed="${String(k === ui.kind)}">${l}</button>`)}</div>
      ${depots.length > 1 ? html`<label class="inline"><span class="sr-only">Depot</span><select id="depot-filter"><option value="">All depots</option>${depots.map((d) => html`<option value="${d.id}">${d.name}</option>`)}</select></label>` : ''}
      <input type="search" id="task-search" placeholder="Search registration, driver or item" aria-label="Search tasks">
      <label class="check small"><input type="checkbox" id="show-quiet"> <span>Show snoozed and dismissed</span></label>
    </div>
    <p id="task-summary" class="summary" aria-live="polite"></p>
    <div id="task-list"></div>`);

  const list = main.querySelector('#task-list');
  const summary = main.querySelector('#task-summary');

  const row = (t) => {
    const k = taskKey(t);
    let quick = '';
    if (can.write) {
      if (t.status === 'snoozed' || t.status === 'dismissed') quick = html`<button class="btn btn-sm" data-action="restore" data-key="${k}">Restore</button>`;
      else if (t.source_type === 'compliance_item') quick = t.status === 'no_date'
        ? html`<button class="btn btn-sm btn-primary" data-action="setdate" data-key="${k}">Set date</button>`
        : html`<button class="btn btn-sm btn-primary" data-action="renew" data-key="${k}">Record renewal</button>`;
    }
    return html`<li class="task task-${t.status}" data-action="open" data-key="${k}">
      <div class="task-main">
        <button type="button" class="task-title" data-action="open" data-key="${k}">${t.type_name}</button>
        ${t.is_statutory ? html`<span class="tag">Statutory</span>` : ''}
        <div class="task-who">${taskWho(t, ctx)}</div>
      </div>
      <div class="task-when">
        <div class="task-date">${t.due_date ? fmtDate(t.due_date) : 'Not set'}</div>
        <div class="task-rel">${dueText(t.days_remaining)}</div>
      </div>
      <div class="task-act">${quick}</div>
    </li>`;
  };

  function drawList() {
    const rows = filtered();
    const visible = rows.filter((t) => ui.quiet || (t.status !== 'snoozed' && t.status !== 'dismissed'));
    const n = (s) => rows.filter((t) => t.status === s).length;
    const parts = [];
    if (n('overdue')) parts.push(html`<strong class="c-overdue">${n('overdue')}</strong> overdue`);
    if (n('due_soon')) parts.push(html`<strong class="c-soon">${n('due_soon')}</strong> due soon`);
    if (n('no_date')) parts.push(html`<strong>${n('no_date')}</strong> without a date`);
    mount(summary, parts.length ? html`${parts.map((p, i) => html`${i ? ', ' : ''}${p}`)}` : html`Nothing is overdue or due soon.`);
    setBadge('tasks', tasks.filter((t) => t.status === 'overdue').length);

    if (!tasks.length) {
      mount(list, emptyHtml('Nothing to track yet', 'Add your vehicles and drivers. Their MOT, tax, service and licence dates will appear here as tasks.',
        can.write ? html`<p><a class="btn btn-primary" href="#/vehicles/new">Add a vehicle</a> <a class="btn" href="#/drivers/new">Add a driver</a></p>` : ''));
      return;
    }
    if (!visible.length) { mount(list, emptyHtml('No tasks match', 'Try a different filter or search.')); return; }
    mount(list, html`${STATUS_ORDER.map((s) => {
      const g = visible.filter((t) => t.status === s);
      if (!g.length) return '';
      const open = !!ui.q || ui.open.has(s);
      return html`<section class="group group-${s}">
        <h2 class="group-head"><button type="button" class="group-toggle" data-action="toggle" data-group="${s}" aria-expanded="${String(open)}">${STATUS_LABEL[s]} <span class="count">${g.length}</span></button></h2>
        ${open ? html`<ul class="tasks">${g.map(row)}</ul>` : ''}
      </section>`;
    })}`);
  }

  async function refresh() {
    tasks = await api.listTasks();
    drawList();
  }
  const withTask = (el, fn) => { const t = byKey(el.dataset.key); if (t) fn(t); };

  on(main, {
    kind: (el) => {
      ui.kind = el.dataset.kind;
      main.querySelectorAll('.seg-btn').forEach((b) => b.setAttribute('aria-pressed', String(b === el)));
      drawList();
    },
    toggle: (el) => { const g = el.dataset.group; if (ui.open.has(g)) ui.open.delete(g); else ui.open.add(g); drawList(); },
    open: (el) => withTask(el, (t) => openTaskPanel(t, ctx, refresh)),
    renew: (el) => withTask(el, (t) => renewModal(t, ctx, refresh)),
    setdate: (el) => withTask(el, (t) => setDateModal(t, ctx, refresh)),
    restore: (el) => withTask(el, async (t) => { await restoreTask(t); await refresh(); }),
  });
  main.querySelector('#task-search').addEventListener('input', (e) => { ui.q = e.target.value.trim().toLowerCase(); drawList(); });
  main.querySelector('#depot-filter')?.addEventListener('change', (e) => { ui.depot = e.target.value; drawList(); });
  main.querySelector('#show-quiet').addEventListener('change', (e) => {
    ui.quiet = e.target.checked;
    if (ui.quiet) { ui.open.add('snoozed'); ui.open.add('dismissed'); }
    drawList();
  });
  drawList();
}
