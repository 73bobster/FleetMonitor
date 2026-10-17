// Settings, "Exit pack": the superuser's button for downloading a complete copy of the organisation's data.
// Kept separate from settings.js. mountExit(container) draws and runs the section; it owns its own state so the
// rest of the Settings page can redraw without interrupting a download in progress.
import * as api from './api.js';
import { html, mount, openModal, toast } from './ui.js';
import { save } from './exports.js';
import { buildExitPack } from './exitpack.js';

const MIN_PASSPHRASE = 12;
const fmtSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function mountExit(box, { build = buildExitPack, saveFile = save } = {}) {
  const s = { running: false, cancel: false, progress: null, result: null, error: '' };

  const draw = () => {
    const p = s.progress;
    mount(box, html`
      <p class="muted">A complete copy of everything the organisation has put into FleetRecord, so you are never locked in. One zip containing a spreadsheet you can read, every table in full as CSV files, every uploaded document, and a checklist proving nothing was missed. It is built in your browser and goes nowhere except your own computer. Each download is recorded in the audit log.</p>
      <form id="exit-form" autocomplete="off" novalidate>
        <label class="check"><input type="checkbox" name="docs" checked ${s.running ? 'disabled' : ''}> <span><strong>Include uploaded documents</strong> <span class="muted">V5Cs, MOT and insurance certificates, photos and so on. Untick for a much smaller, faster pack.</span></span></label>
        <label class="check"><input type="checkbox" name="licence" ${s.running ? 'disabled' : ''}> <span><strong>Include driver licence and conviction details</strong> <span class="muted">Licence numbers, dates of birth, licence checks, convictions and their documents. Personal data, so it is left out unless you tick this.</span></span></label>
        <div class="field"><label for="exit-pass">Passphrase to lock the zip <span class="muted">(strongly recommended)</span></label><input type="password" id="exit-pass" name="pass" autocomplete="new-password" ${s.running ? 'disabled' : ''}></div>
        <div class="field"><label for="exit-pass2">Type the passphrase again</label><input type="password" id="exit-pass2" name="pass2" autocomplete="new-password" ${s.running ? 'disabled' : ''}></div>
        <p class="hint">At least ${MIN_PASSPHRASE} characters; a few random words is best. FleetRecord does not keep it, so if it is lost the pack cannot be opened. Open the zip with 7-Zip (Windows) or Keka (Mac); Windows Explorer cannot open locked zips.</p>
        <p class="form-error" role="alert" ${s.error ? '' : 'hidden'}>${s.error}</p>
        <p><button type="submit" class="btn btn-primary" ${s.running ? 'disabled' : ''}>${s.running ? 'Working…' : 'Create exit pack'}</button> ${s.running ? html`<button type="button" class="btn" data-cancel>Cancel</button>` : ''}</p>
      </form>
      <p role="status" aria-live="polite" class="muted" id="exit-status">${p ? html`<strong>${p.stage}</strong> ${p.message}${p.total > 1 ? ` (${Math.min(100, Math.round((p.done / p.total) * 100))}%)` : ''}` : ''}</p>
      ${s.result ? resultHtml(s.result) : ''}`);
    box.querySelector('#exit-form').addEventListener('submit', onSubmit);
    box.querySelector('[data-cancel]')?.addEventListener('click', () => { s.cancel = true; });
  };

  const resultHtml = (r) => html`<div class="notice" role="status">
    <p><strong>${r.summary.problems ? 'Downloaded, but please check the Summary sheet.' : 'Downloaded. Every row in the database is in the pack.'}</strong></p>
    <p class="muted">${r.filename} · ${fmtSize(r.summary.size)} · ${r.summary.sheets} sheets · ${r.summary.tables.length} tables · ${r.summary.documents.in_pack} of ${r.summary.documents.in_database} documents${r.summary.problems ? ` · ${r.summary.problems} item(s) need a look` : ''}${r.summary.encrypted ? ' · locked with your passphrase' : ' · not locked'}</p>
    ${r.recorded ? html`<p class="muted">Recorded in the audit log.</p>` : html`<p class="muted">Not recorded in the audit log yet: the one-off database update that enables this has not been applied.</p>`}
    <p><button type="button" class="btn" data-again>Download it again</button></p>
  </div>`;

  async function run(opts) {
    s.running = true; s.cancel = false; s.error = ''; s.result = null; s.progress = { stage: 'Starting', message: '', done: 0, total: 1 };
    draw();
    let last = 0;
    try {
      const r = await build({
        ...opts,
        isCancelled: () => s.cancel,
        onProgress: (p) => { s.progress = p; const t = Date.now(); if (t - last > 150) { last = t; draw(); } },
      });
      saveFile(r.bytes, r.filename, 'application/zip');
      const log = await api.logExport({
        file: r.filename, bytes: r.summary.size, documents: r.summary.documents.in_pack, documents_in_database: r.summary.documents.in_database,
        licence_data_included: opts.includeRestricted, documents_included: opts.includeDocuments, encrypted: !!opts.passphrase, tables: r.summary.tables.length, problems: r.summary.problems,
      }).catch(() => ({ recorded: false }));
      s.result = { ...r, recorded: log.recorded, bytes: null };
      toast('Exit pack downloaded.');
    } catch (e) {
      s.error = e.message === 'Cancelled.' ? 'Cancelled. Nothing was downloaded.' : `The exit pack could not be created: ${e.message || e}`;
    } finally {
      s.running = false; s.progress = null; draw();
      box.querySelector('[data-again]')?.addEventListener('click', () => { s.result = null; draw(); });
    }
  }

  function onSubmit(e) {
    e.preventDefault();
    if (s.running) return;
    const f = e.target.elements;
    const pass = f.pass.value;
    const opts = { includeDocuments: f.docs.checked, includeRestricted: f.licence.checked, passphrase: pass };
    s.error = '';
    if (pass && pass.length < MIN_PASSPHRASE) { s.error = `The passphrase needs at least ${MIN_PASSPHRASE} characters.`; draw(); return; }
    if (pass !== f.pass2.value) { s.error = 'The two passphrases do not match.'; draw(); return; }
    if (!pass) {
      openModal({
        title: 'Download without a passphrase?', submitLabel: 'Download unlocked', danger: true,
        body: html`<p>Anyone who gets this file can read everything in it${opts.includeRestricted ? ', including driver licence numbers, dates of birth and convictions' : ''}. A passphrase locks it.</p>`,
        onSubmit: async () => { setTimeout(() => run(opts), 0); },
      });
      return;
    }
    run(opts);
  }
  draw();
  return { state: s };
}
