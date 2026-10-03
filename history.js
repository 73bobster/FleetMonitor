// Renders audit-log entries as a readable change history (admins only; the database hides it from others).
import { html, fmtDateTime } from '../ui.js';

const label = (f) => String(f).replace(/_/g, ' ');
const show = (v) => (v === null || v === undefined || v === '' ? 'empty' : String(Array.isArray(v) ? v.join(', ') : v).slice(0, 70));

function describe(e) {
  if (e.action === 'INSERT') return html`created this record`;
  if (e.action === 'DELETE') return html`deleted this record`;
  return html`changed ${(e.changed_fields || []).map((f) => html`<span class="chg">${label(f)}: ${show(e.old_data?.[f])} to ${show(e.new_data?.[f])}</span>`)}`;
}

export function historyList(entries) {
  if (!entries.length) return html`<p class="muted">No changes recorded yet.</p>`;
  return html`<ul class="history">${entries.map((e) => html`<li><span class="muted">${fmtDateTime(e.occurred_at)}</span> <strong>${e.actor_label || 'System'}</strong> ${describe(e)}</li>`)}</ul>`;
}
