// The Exit pack section sits last on the superuser's Settings page and is listed in the "Go to" links.
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { makeFake } from '../fake-supabase.js';
const dom = new JSDOM(readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/<script[\s\S]*?<\/script>/g, ''), { url: 'https://app.test/', pretendToBeVisual: true });
const { window } = dom;
Object.assign(globalThis, { window, document: window.document, location: window.location, history: window.history, localStorage: window.localStorage });
const api = await import('../api.js'); const { state } = await import('../state.js'); const { settingsView } = await import('../settings.js');
const ORG = 'o1';
api.init(makeFake({ memberships: [{ id: 'm1', organisation_id: ORG, user_id: 'u1', role: 'superuser', status: 'active' }], profiles: [{ id: 'u1', email: 'a@b.c' }], organisations: [{ id: ORG, name: 'T' }] }));
Object.assign(state, { org: { id: ORG, name: 'T', settings: {} }, role: 'superuser', user: { id: 'u1' } });
const main = document.body.appendChild(document.createElement('main'));
await settingsView(main);
const secs = [...main.querySelectorAll('section')].map((s) => s.id);
let bad = 0; const ok = (c, m) => { if (!c) { console.error('FAIL:', m); bad++; } };
ok(secs.at(-1) === 'set-exit', `exit pack is the last section (got ${secs.at(-1)})`);
ok(main.querySelector('#set-exit #exit-form'), 'form is drawn');
ok([...main.querySelectorAll('[data-to]')].some((b) => b.dataset.to === 'set-exit'), 'jump link present');
console.log(bad ? `${bad} failed` : 'settings exit section: all passed'); process.exit(bad ? 1 : 0);
