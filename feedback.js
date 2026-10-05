// Feedback log. Anyone can send feedback, report an error or ask for a change from the link at the bottom of every
// screen. Each person sees what they sent and the reply. The superuser sees everything in Settings and is the only one
// who sets priority, target date, status and the reply (the database enforces that, not just this screen).
// Nothing is deleted: an item that will not be done is given the status "Not going ahead".
import * as api from './api.js';
import { state, can } from './state.js';
import { html, openModal, fieldsHtml, readForm, toast, fmtDateShort, todayStr } from './ui.js';
import { SCREENS, screenLabel, versionOf } from './versions.js';

export const FB_CATEGORY = { feedback: 'Feedback', error: 'Error', change: 'Change', new_feature: 'New feature', question: 'Question' };
export const FB_PRIORITY = { urgent: 'Urgent', high: 'High', medium: 'Medium', low: 'Low' };          // most pressing first
export const FB_STATUS = { new: 'New', under_review: 'Under review', planned: 'Planned', in_progress: 'In progress', done: 'Done', declined: 'Not going ahead' };
export const FB_OPEN = ['new', 'under_review', 'planned', 'in_progress'];
const WHOLE_APP = 'Whole app';
const pairs = (o) => Object.entries(o);
const rank = (o, k) => Object.keys(o).indexOf(k);

export const fbIsOpen = (i) => FB_OPEN.includes(i.status);
export const fbIsLate = (i, today = todayStr()) => fbIsOpen(i) && !!i.target_date && i.target_date < today;
export const fbRef = (i) => `#${i.ref}`;
// Open items first, most pressing first, then the nearest target date, then the oldest.
export function fbSort(items) {
  return [...items].sort((a, b) => (fbIsOpen(b) - fbIsOpen(a)) || (rank(FB_PRIORITY, a.priority) - rank(FB_PRIORITY, b.priority))
    || ((a.target_date || '9999') < (b.target_date || '9999') ? -1 : (a.target_date || '9999') > (b.target_date || '9999') ? 1 : 0)
    || (a.created_at < b.created_at ? -1 : 1));
}
export const fbStatusHtml = (i) => html`<span class="fb-status fb-${i.status}">${FB_STATUS[i.status] || i.status}</span>`;
export const fbPriorityHtml = (i) => html`<span class="fb-pri fb-pri-${i.priority}">${FB_PRIORITY[i.priority] || i.priority}</span>`;

// The form. section is the screen the person was on when they opened it. item is given when the superuser edits one.
// Everyone gets the first four boxes; the superuser also gets who raised it, priority, target date, status and reply.
export function feedbackModal({ section = '', item = null, onSaved } = {}) {
  const manage = can.configure;
  const screens = [WHOLE_APP, ...SCREENS.map(([, label]) => label)];
  const start = item || { category: 'feedback', screen: screenLabel(section) || WHOLE_APP, raised_by: state.user?.email || '', priority: 'medium', status: 'new' };
  if (start.screen && !screens.includes(start.screen)) screens.push(start.screen);
  const fields = [
    { name: 'category', label: 'What kind of thing is it?', type: 'select', required: true, options: pairs(FB_CATEGORY) },
    { name: 'screen', label: 'Which screen?', type: 'select', required: true, options: screens.map((s) => [s, s]) },
    { name: 'description', label: 'Describe it', type: 'textarea', rows: 4, required: true, span: 2, maxlength: 4000, hint: 'Say which part of the screen or which box it is about, and what you saw or what you would like.' },
    { name: 'target_outcome', label: 'What should the result be?', type: 'textarea', rows: 2, span: 2, hint: 'What you want to be able to do, or what should happen instead.' },
    ...(manage ? [
      { name: 'raised_by', label: 'Who raised it', required: true, maxlength: 200, hint: 'Change this if you are recording it for someone else.' },
      { name: 'priority', label: 'Priority', type: 'select', required: true, options: pairs(FB_PRIORITY) },
      { name: 'target_date', label: 'Target date', type: 'date' },
      { name: 'status', label: 'Status', type: 'select', required: true, options: pairs(FB_STATUS) },
      { name: 'response', label: 'Reply or notes', type: 'textarea', rows: 2, span: 2, hint: 'The person who sent it can read this.' },
    ] : []),
  ];
  openModal({
    title: item ? `${FB_CATEGORY[item.category] || 'Item'} ${fbRef(item)}` : manage ? 'Add feedback or a change' : 'Send feedback',
    submitLabel: item ? 'Save' : manage ? 'Add to the log' : 'Send',
    wide: manage,
    body: html`${item ? html`<p class="muted">Sent ${fmtDateShort(item.created_at)} by ${item.raised_by}${item.screen_version ? html`, when that screen was ${item.screen_version}` : ''}.</p>`
      : manage ? '' : html`<p class="muted">Tell us about an error, something that could be better, or something new you need. It goes to the superuser, and you can follow it under Help.</p>`}
      ${fieldsHtml(fields, start)}`,
    onSubmit: async (f) => {
      const v = readForm(f, fields);
      if (!v.description) throw new Error('Describe it first.');
      if (v.description.length > 4000 || (v.target_outcome || '').length > 2000 || (v.response || '').length > 2000) throw new Error('That is too long. Keep the description under 4,000 characters and the other boxes under 2,000.');
      if (manage && !v.raised_by) throw new Error('Say who raised it.');
      if (item) {
        await api.saveFeedback(v, item.id);
        toast(`${fbRef(item)} saved.`);
      } else {
        const id = SCREENS.find(([, label]) => label === v.screen)?.[0];
        const row = await api.saveFeedback({ ...v, raised_by: v.raised_by || state.user?.email || 'Unknown', screen_version: id ? versionOf(id) : null });
        toast(manage ? `Added as ${fbRef(row)}.` : `Thank you. Sent as ${fbRef(row)}.`);
      }
      await onSaved?.();
    },
  });
}

// What one person has sent, with where it has got to. Used on the Help screen.
export function myFeedbackHtml(items) {
  if (!items.length) return html`<p class="muted">You have not sent anything yet.</p>`;
  return html`<table class="grid fb-table"><thead><tr><th>Ref</th><th>Sent</th><th>What</th><th>Status</th><th>Reply</th></tr></thead><tbody>
    ${items.map((i) => html`<tr class="${fbIsOpen(i) ? '' : 'row-off'}">
      <td data-label="Ref">${fbRef(i)}</td>
      <td data-label="Sent">${fmtDateShort(i.created_at)}</td>
      <td data-label="What"><div class="fb-cell"><span class="tag">${FB_CATEGORY[i.category] || i.category}</span> ${i.screen ? html`<span class="muted">${i.screen}</span>` : ''}<div class="fb-text">${i.description}</div></div></td>
      <td data-label="Status"><div>${fbStatusHtml(i)}${i.target_date && fbIsOpen(i) ? html`<div class="sub">Target ${fmtDateShort(i.target_date)}</div>` : ''}</div></td>
      <td data-label="Reply">${i.response ? html`<div class="fb-text">${i.response}</div>` : html`<span class="muted">None yet</span>`}</td></tr>`)}
  </tbody></table>`;
}
