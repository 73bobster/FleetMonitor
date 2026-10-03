// Everything you can do to a task: record a renewal, set a date, snooze, dismiss, email.
// Shared by the Tasks screen and the vehicle and driver compliance tabs.
import * as api from './api.js';
import { state, can } from './state.js';
import {
  html, mount, on, openModal, closeModal, fieldsHtml, readForm, toast, pill, plate, formatReg,
  fmtDate, fmtDateShort, fmtDateTime, dueText, todayStr, addDaysISO,
} from './ui.js';

export const merge = (text, vars) => String(text).replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] ?? '');

export function taskWho(t, ctx = {}) {
  if (t.vehicle_id) {
    const v = ctx.vehicles?.get(t.vehicle_id);
    return html`${plate(v?.registration || String(t.target_label).split(' - ')[0])}${v?.nickname ? html` <span class="muted">${v.nickname}</span>` : ''}`;
  }
  return html`<span>${t.target_label}</span>`;
}

const isQuiet = (t) => t.status === 'snoozed' || t.status === 'dismissed';

// ---- Task panel -----------------------------------------------------------
export function openTaskPanel(t, ctx, onChange) {
  const quiet = isQuiet(t);
  const policy = t.source_type === 'policy';
  const dlg = openModal({
    title: t.type_name,
    hideFooter: true,
    body: html`
      <div class="panel-who">${taskWho(t, ctx)}</div>
      <dl class="facts">
        <div><dt>Status</dt><dd>${pill(t.status)}</dd></div>
        <div><dt>Due</dt><dd>${t.due_date ? html`${fmtDate(t.due_date)}<br><span class="muted">${dueText(t.days_remaining)}</span>` : 'No date set'}</dd></div>
        ${quiet ? html`<div><dt>${t.status === 'snoozed' ? `Snoozed until ${fmtDateShort(t.snoozed_until)}` : 'Dismissed'}</dt><dd>${t.state_reason}</dd></div>` : ''}
        ${t.is_statutory ? html`<div><dt>Requirement</dt><dd>Statutory</dd></div>` : ''}
      </dl>
      ${can.write ? html`<div class="panel-actions">
        ${!quiet && !policy ? (t.due_date
          ? html`<button class="btn btn-primary" data-action="renew">Record renewal</button>`
          : html`<button class="btn btn-primary" data-action="setdate">Set due date</button>`) : ''}
        ${!quiet && !policy && t.due_date ? html`<button class="btn" data-action="setdate">Correct due date</button>` : ''}
        ${!quiet && !policy ? html`<button class="btn" data-action="email">Email driver</button>` : ''}
        ${!quiet && t.due_date ? html`<button class="btn" data-action="snooze">Snooze</button><button class="btn" data-action="dismiss">Dismiss</button>` : ''}
        ${quiet ? html`<button class="btn btn-primary" data-action="restore">Restore</button>` : ''}
      </div>
      ${policy ? html`<p class="hint">Renew this policy by updating its end date under Insurance.</p>` : ''}` : ''}
      <section class="panel-history" id="panel-history"><h3>History</h3><p class="muted">Loading</p></section>`,
  });
  on(dlg, {
    renew: () => renewModal(t, ctx, onChange),
    setdate: () => setDateModal(t, ctx, onChange),
    email: () => emailModal(t, ctx, onChange),
    snooze: () => snoozeModal(t, ctx, onChange),
    dismiss: () => dismissModal(t, ctx, onChange),
    restore: async () => { await restoreTask(t); toast('Task restored.'); closeModal(); await onChange?.(); },
  });
  loadHistory(t);
}

async function loadHistory(t) {
  const box = document.getElementById('panel-history');
  if (!box) return;
  try {
    const [renewals, messages] = await Promise.all([
      t.source_type === 'compliance_item' ? api.listRenewals(t.source_id) : [],
      can.write ? api.listMessages(t.source_type, t.source_id) : [],
    ]);
    if (!box.isConnected) return;
    const rows = [
      ...renewals.map((r) => ({ at: r.created_at, text: `Renewed on ${fmtDateShort(r.completed_on)}, next due ${r.new_due_date ? fmtDateShort(r.new_due_date) : 'not set'}${r.reference ? ` (${r.reference})` : ''}` })),
      ...messages.map((m) => ({ at: m.created_at, text: `${m.channel === 'email' ? 'Email' : m.channel} to ${m.recipient_address || 'recipient'}: ${m.status === 'manual_sent' ? 'sent manually' : m.status}` })),
    ].sort((a, b) => String(b.at).localeCompare(String(a.at)));
    mount(box, html`<h3>History</h3>${rows.length
      ? html`<ul class="history">${rows.map((r) => html`<li><span class="muted">${fmtDateTime(r.at)}</span> ${r.text}</li>`)}</ul>`
      : html`<p class="muted">Nothing recorded for this task yet.</p>`}`);
  } catch {
    if (box.isConnected) mount(box, html`<h3>History</h3><p class="muted">History isn't available right now.</p>`);
  }
}

// ---- Forms ---------------------------------------------------------------------
export function renewModal(t, ctx, onChange) {
  const specs = [
    { name: 'completed_on', label: 'Completed on', type: 'date', required: true, max: todayStr() },
    { name: 'new_due_date', label: 'New due date', type: 'date', hint: 'Leave blank to use the standard interval for this item.' },
    { name: 'reference', label: 'Certificate or reference number', type: 'text', span: 2 },
    { name: 'cost', label: 'Cost (£)', type: 'number', step: '0.01', min: '0', inputmode: 'decimal' },
    { name: 'notes', label: 'Notes', type: 'textarea', span: 2 },
  ];
  openModal({
    title: `Record renewal: ${t.type_name}`,
    submitLabel: 'Record renewal',
    body: html`<div class="panel-who">${taskWho(t, ctx)}</div>${fieldsHtml(specs, { completed_on: todayStr() })}`,
    onSubmit: async (form) => {
      const v = readForm(form, specs);
      const row = await api.recordRenewal({ itemId: t.source_id, completedOn: v.completed_on, newDueDate: v.new_due_date, reference: v.reference, cost: v.cost, notes: v.notes });
      toast(`Renewal recorded. Next due ${row?.due_date ? fmtDateShort(row.due_date) : 'date not set'}.`);
      await onChange?.();
    },
  });
}

export function setDateModal(t, ctx, onChange) {
  const specs = [
    { name: 'due_date', label: 'Due date', type: 'date', required: true },
    { name: 'reference', label: 'Certificate or reference number', type: 'text', span: 2 },
  ];
  openModal({
    title: `${t.due_date ? 'Correct' : 'Set'} due date: ${t.type_name}`,
    body: html`<div class="panel-who">${taskWho(t, ctx)}</div>${fieldsHtml(specs, { due_date: t.due_date })}<p class="hint">Use Record renewal when the item has actually been done. This only changes the date.</p>`,
    onSubmit: async (form) => {
      const v = readForm(form, specs);
      await api.updateItem(t.source_id, { due_date: v.due_date, ...(v.reference ? { reference: v.reference } : {}) });
      toast('Due date saved.');
      await onChange?.();
    },
  });
}

export function snoozeModal(t, ctx, onChange) {
  const specs = [
    { name: 'snoozed_until', label: 'Snooze until', type: 'date', required: true, min: addDaysISO(todayStr(), 1) },
    { name: 'reason', label: 'Reason', type: 'textarea', required: true, span: 2, hint: 'For example: booked in for Thursday. The reason is kept in the audit log.' },
  ];
  openModal({
    title: `Snooze: ${t.type_name}`,
    submitLabel: 'Snooze',
    body: html`<div class="panel-who">${taskWho(t, ctx)}</div>${fieldsHtml(specs, { snoozed_until: addDaysISO(todayStr(), 7) })}`,
    onSubmit: async (form) => {
      const v = readForm(form, specs);
      await api.setTaskState({ source_type: t.source_type, source_id: t.source_id, due_date: t.due_date, state: 'snoozed', snoozed_until: v.snoozed_until, reason: v.reason });
      toast(`Snoozed until ${fmtDateShort(v.snoozed_until)}.`);
      await onChange?.();
    },
  });
}

export function dismissModal(t, ctx, onChange) {
  const specs = [{ name: 'reason', label: 'Reason', type: 'textarea', required: true, span: 2, hint: 'Dismissing hides this task for this due date only. The reason is kept in the audit log.' }];
  openModal({
    title: `Dismiss: ${t.type_name}`,
    submitLabel: 'Dismiss',
    body: html`<div class="panel-who">${taskWho(t, ctx)}</div>${fieldsHtml(specs)}`,
    onSubmit: async (form) => {
      const v = readForm(form, specs);
      await api.setTaskState({ source_type: t.source_type, source_id: t.source_id, due_date: t.due_date, state: 'dismissed', snoozed_until: null, reason: v.reason });
      toast('Task dismissed.');
      await onChange?.();
    },
  });
}

export const restoreTask = (t) => api.clearTaskState(t);

// ---- Email -----------------------------------------------------------------------
const DEFAULT_BODY = 'Hi {{driver_name}},\n\n{{item_name}} for {{registration}} is due on {{due_date}}. Please speak to the office to arrange it.\n\nThanks,\n{{org_name}}';

export async function emailModal(t, ctx, onChange) {
  const vehicles = ctx?.vehicles || new Map();
  const drivers = ctx?.drivers || new Map();
  let driver = null; let vehicle = null;
  if (t.driver_id) driver = drivers.get(t.driver_id) || await api.getDriver(t.driver_id);
  else if (t.vehicle_id) {
    vehicle = vehicles.get(t.vehicle_id) || await api.getVehicle(t.vehicle_id);
    driver = await api.primaryDriver(t.vehicle_id);
  }
  const tpl = (await api.listTemplates()).find((x) => x.code === 'driver_reminder' && x.channel === 'email') || null;
  const vars = {
    driver_name: driver?.first_name || 'there',
    registration: vehicle ? formatReg(vehicle.registration) : 'your driver record',
    item_name: t.type_name,
    due_date: fmtDate(t.due_date) || 'a date to be confirmed',
    org_name: state.org.name,
    target_label: t.target_label,
    days_remaining: String(t.days_remaining ?? ''),
  };
  const specs = [
    { name: 'to', label: 'To', type: 'email', required: true, span: 2, hint: driver?.email ? '' : (driver ? `${driver.first_name} has no email address on file. Enter one to continue.` : 'No driver is assigned to this vehicle. Enter an email address to continue.') },
    { name: 'subject', label: 'Subject', type: 'text', required: true, span: 2 },
    { name: 'body', label: 'Message', type: 'textarea', rows: 9, required: true, span: 2 },
  ];
  const values = { to: driver?.email || '', subject: merge(tpl?.subject || 'Action needed: {{item_name}} due {{due_date}}', vars), body: merge(tpl?.body || DEFAULT_BODY, vars) };
  const dlg = openModal({
    title: `Email about ${t.type_name}`,
    submitLabel: 'Mark as sent',
    body: html`<p class="muted">This opens your email app with the message ready to send. Once you've sent it, choose Mark as sent to record it on the task.</p>${fieldsHtml(specs, values)}<p><a class="btn" id="mailto-link" href="mailto:">Open in email app</a></p>`,
    onSubmit: async (form) => {
      const v = readForm(form, specs);
      await api.logMessage({
        source_type: t.source_type, source_id: t.source_id, due_date: t.due_date, channel: 'email',
        recipient_kind: driver ? 'driver' : 'other', driver_id: driver?.id ?? null, recipient_address: v.to,
        template_id: tpl?.id ?? null, subject: v.subject, body: v.body, status: 'manual_sent',
        sent_by: state.user.id, sent_at: new Date().toISOString(),
      });
      toast('Recorded as sent.');
      await onChange?.();
    },
  });
  const form = dlg.querySelector('form');
  const link = dlg.querySelector('#mailto-link');
  const refresh = () => {
    link.href = `mailto:${encodeURIComponent(form.elements.to.value)}?subject=${encodeURIComponent(form.elements.subject.value)}&body=${encodeURIComponent(form.elements.body.value)}`;
  };
  form.addEventListener('input', refresh);
  refresh();
}
