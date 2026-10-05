// Help: how to use FleetMonitor. The basics, a guide to each screen, common questions, and the feedback a person has
// sent. It only describes the screens this person can see: ones their user type allows and that are switched on.
import * as api from './api.js';
import { state, can, ROLE_LABEL, ROLE_HINT, screenOn } from './state.js';
import { html, mount, on, loadingHtml } from './ui.js';
import { versionOf } from './versions.js';
import { feedbackModal, myFeedbackHtml } from './feedback.js';

// Each guide: [screen id, title, what it is for, [steps and tips]]. A function is used where the words depend on the user type.
const GUIDES = () => [
  ['dashboard', 'Dashboard', 'The state of the fleet on one screen: what needs attention today, and what happened in the period you choose.', [
    'The four coloured tiles at the top are the red, amber and green status for the whole operation, the vehicle pool, the driver pool and the admin work. Click a tile to see what is behind it.',
    'The period buttons (Last 7 days, Last 30 days and so on) change the accidents, costs, mileage, downtime and chart. Fleet status and tasks always show today.',
    'Needs attention lists the most pressing tasks. Click one to open the task list already filtered to it.',
    'The availability chart shows vehicles available (green) and out of service (red and pink). Tap or click a bar for the numbers.',
    `Drivers: worst offenders lists drivers with ${can.sensitive ? 'points, ' : ''}accidents or damage. If nobody is listed, every active driver is clear.`,
  ]],
  ['tasks', 'Tasks', 'Everything that has a date: MOT, road tax, services, inspections, licence checks, insurance renewals, fines to pay. Grouped by how urgent it is.', [
    'Overdue is at the top, then Due soon, then items with no date, then Upcoming. The red number on the Tasks menu item is the count of overdue tasks.',
    'Use the search box and the filters to narrow the list by vehicle, driver, depot, type of task or status.',
    can.write ? 'Click a task to open it. From there you can record that it was done (which sets the next due date), book the garage, set or correct the date, email the driver, snooze it or dismiss it.' : 'Click a task to see its detail. Your user type can look but cannot act on tasks.',
    can.write ? 'Snooze hides a task until a date you pick. Dismiss closes it with a reason. Both are recorded, and you can see them again by ticking "Show snoozed and dismissed".' : '',
  ]],
  ['planner', 'Planner', 'Looks ahead: how many vehicles of each type will be available each day, against the number you need.', [
    'Each row is a type of vehicle and each column is a day. Green means you have enough, amber means at risk, red means short.',
    'Shortfalls lists the days you will be short. At risk lists days that would be short if a vehicle with work due were taken out.',
    'To book lists work that is due but has no garage visit booked. Click the number plate to book it.',
    'The number needed each day is set by the superuser in Settings, under Vehicles needed.',
  ]],
  ['vehicles', 'Vehicles', 'The list of vehicles, and everything recorded about each one.', [
    'The coloured dot beside a number plate is that vehicle\'s status. Tick "Red and amber only" to see just the ones that need attention.',
    'Search by registration, make or driver, or filter by depot, availability and type. Tick "Include disposed" to see vehicles that have left the fleet.',
    'Click a vehicle to open it. The tabs across the top hold its compliance dates, drivers, insurance, availability, incidents, costs, documents and mileage readings.',
    can.write ? 'To send a vehicle to a garage or take it off the road, open it and choose "Out of service or book a visit" on the Availability tab. Choose "Back in service" when it returns.' : '',
    can.write ? 'Add mileage on the Readings tab and costs on the Costs tab. Regular readings make the mileage and fuel figures accurate.' : '',
    can.write ? 'When a vehicle leaves the fleet choose Dispose. If it comes back, open it and choose "Bring back into the fleet". Its history is kept.' : '',
  ]],
  ['drivers', 'Drivers', 'The list of drivers, and everything recorded about each one.', [
    'The coloured dot beside a name is that driver\'s status. Tick "Red and amber only" to see just the ones that need attention.',
    can.sensitive ? 'Open a driver to see their licence, licence checks, points and convictions, employment, incidents and documents.' : 'Open a driver to see their contact details, vehicles and incidents. Licence details, points, convictions and documents are not shown to your user type.',
    can.sensitive ? 'Use "Log a licence check" on the Licence tab each time you check a licence. The result sets the next check date and the driver\'s status.' : '',
    can.write ? 'When someone leaves, choose "Record leaver". If they come back, choose Rehire. Their history is kept.' : '',
    can.write ? 'Drivers are assigned to vehicles from the vehicle\'s Drivers tab.' : '',
  ]],
  ['incidents', 'Incidents', 'Accidents, damage and fines.', [
    can.write ? 'Choose "Report an incident" and say what happened, when, and which vehicle and driver. Add photos and documents once it is saved.' : 'Each incident shows what happened, the vehicle and driver, and the costs.',
    'A fine creates tasks for naming the driver and paying on time. An accident can create a task to tell the insurer.',
    can.write ? 'Record the repair cost, the excess and what the insurer paid as you learn them. They feed the dashboard, the reports and the cost of ownership.' : '',
  ]],
  ['garages', 'Garages', 'The garages you use, with their contact details.', [
    can.write ? 'Add a garage here once, then pick it whenever you book a visit. Archive a garage you no longer use: it stays on past visits.' : 'Garage visits themselves are shown on each vehicle\'s Availability tab.',
  ]],
  ['insurance', 'Insurance', 'Insurance policies, the vehicles each one covers, and claims.', [
    'Open a policy to see the vehicles it covers, its claims and its documents.',
    can.write ? 'Add vehicles to a policy from the policy, or from the vehicle\'s Insurance tab. A vehicle with no cover turns red.' : 'A vehicle with no cover turns red.',
    'The renewal date creates a task so it is not missed.',
  ]],
  ['costs', 'Costs', 'The total cost of owning and running each vehicle, and the monthly fuel prices used to work it out.', [
    'Choose a period. Each vehicle shows the costs you entered (servicing, tyres, repairs and so on) and the costs worked out for you: fuel, its share of insurance, lease or finance payments, accidents, fines and loss in value.',
    'Fuel is worked out from miles driven, the vehicle\'s fuel economy and the price of fuel that month. Where a vehicle has no fuel economy figure, a typical figure for its type is used and the cost is marked.',
    'Click a vehicle for its month by month breakdown. Download the table to Excel or PDF.',
    can.write ? 'The Fuel prices tab holds the price for each month. It starts with UK average prices. Add or change a month to use what you actually paid.' : 'The Fuel prices tab shows the price used for each month.',
  ]],
  ['reports', 'Reports', 'Four reports for any period: vehicle damage, accidents, vehicle mileage and vehicle status.', [
    'Pick the report and the period, then read it on screen or download it to Excel or PDF.',
    'Dates in downloads follow the same date format as the screens.',
  ]],
  ['audit', 'Audit log', 'A record of every change: who made it, when, and what it was. It cannot be edited or switched off.', [
    'Filter by period, vehicle or driver. Click a number plate, a driver or an "Open" link to go to the record.',
    'Each vehicle and driver also has its own History tab.',
  ], () => can.audit],
  ['settings', 'Settings', 'Set up by the superuser.', [
    'Users and access: invite people, change their user type, suspend or remove them. Nobody is deleted. The "Who can do what" table is at the bottom of that section.',
    'Screens: switch off screens you are not using yet. They are hidden for everyone, and nothing is deleted.',
    'Feedback and changes: everything people have sent in, with priority, target date and status.',
    'Vehicles needed: the fewest vehicles of each type you need each day of the week. The Planner uses these.',
    'Depots: the list that vehicles and drivers choose from.',
    'Typical fuel economy for vehicles that have no figure of their own, and the date format.',
  ], () => can.configure],
];

const FAQS = () => [
  ['What do the red, amber and green dots mean?', html`Red means something needs dealing with now: a legal item is overdue, a vehicle has no insurance, or a driver's licence is not valid${can.sensitive ? ' or has 12 or more points' : ''}. Amber means it needs attention soon. Green means nothing needs attention. An empty grey ring means not rated, for example a vehicle off the road with a SORN. Hover over a dot, or open the vehicle or driver, to see the reasons.`],
  ['Why is a vehicle amber when nothing is overdue?', 'Usually because something is due soon and needs a garage, but no garage visit is booked. It also turns amber if it is late back from a garage, or is off the road with no SORN recorded.'],
  ['Why will it not let me save a reading, garage visit or incident on a certain date?', 'Records must fall inside the time the vehicle was in the fleet and the driver was employed. If the date is right, correct the vehicle\'s date acquired or the driver\'s start date first. Costs are the one exception: they can be dated at any time.'],
  ['A vehicle or driver has come back. Do I add them again?', can.write ? 'No. Find them (tick "Include disposed" for vehicles), open the record and choose "Bring back into the fleet" or Rehire. Their history stays in one place.' : 'No. An admin or fleet manager brings the existing record back, so the history stays in one place.'],
  ['Why does a fuel cost say it uses a typical figure?', 'The vehicle has no fuel economy figure on its own record, so a typical figure for its type is used. Put the real miles per gallon on the vehicle to make it exact.'],
  ['Why is a fuel cost empty?', 'Either there are not enough mileage readings to know the miles driven in that month, or there is no fuel price for that month and fuel type. Electric vehicles need electricity prices adding on the Fuel prices tab.'],
  ['Can I delete something I entered by mistake?', 'Most things are corrected, ended or archived, not deleted, so the history stays complete. Every change is kept in the audit log with your name and the time.'],
  ['Why can I not see a screen or a button that a colleague has?', html`Your user type decides what you can see and do. You are signed in as <strong>${ROLE_LABEL[state.role]}</strong>: ${ROLE_HINT[state.role]} The superuser can also switch whole screens off for everyone.`],
  ['How do I change how dates are shown?', can.configure ? 'In Settings, under Date format. It changes every screen and download for everyone. Boxes where you pick a date follow your own browser.' : 'The superuser sets one date format for everyone in Settings. Boxes where you pick a date follow your own browser.'],
  ['How does someone new get access?', can.configure ? 'In Settings, under Users and access, choose "Invite user". You get a link to send them. They create their account with the same email address. Someone who left and has come back is invited again in the same way.' : 'The superuser invites them from Settings and sends them a link. They must create their account with the email address the invitation was sent to.'],
  ['I have forgotten my password.', 'Sign out, then choose "Forgot your password?" on the sign-in screen. You are sent a link to choose a new one.'],
  ['Can I use it on my phone?', 'Yes. Open the same address in your phone\'s browser. The main screens are along the bottom and the rest are under More. You can take photos of documents and damage straight from the phone.'],
  ['What is the number at the bottom of each screen?', html`The version of that screen, for example ${versionOf('dashboard')}. The digits are the date and time it was last changed: year, month, day, hour, minute. Each screen has its own, and it is saved with any feedback you send so we know which version you were looking at.`],
  ['How do I report a problem or ask for a change?', 'Choose "Send feedback" at the bottom of any screen. Say which screen and box it is about and what you would like to happen. You can follow what you sent, and read the reply, at the bottom of this Help screen.'],
];

export async function helpView(main) {
  mount(main, html`<header class="page-head"><h1>Help</h1></header>${loadingHtml()}`);
  let mine = [];
  const loadMine = async () => { try { mine = (await api.listFeedback()).filter((i) => i.created_by === state.user?.id); } catch { mine = []; } };
  await loadMine();
  const guides = GUIDES().filter(([id, , , , when]) => screenOn(id) && (!when || when()));
  const faqs = FAQS();
  const topic = (cls, summary, body) => html`<details class="help-topic ${cls}"><summary>${summary}</summary><div class="help-body">${body}</div></details>`;

  mount(main, html`
    <header class="page-head"><h1>Help</h1></header>
    <div class="filters help-search"><input type="search" id="help-q" placeholder="Search help, for example: SORN, fuel, invite" aria-label="Search help"></div>
    <p class="muted" id="help-none" hidden>Nothing in Help matches that. Try another word, or send feedback to ask.</p>

    <section class="help-section" data-help>
      <h2>The basics</h2>
      <div class="help-basics">
        <p>FleetMonitor keeps ${state.org.name}'s vehicles and drivers legal, available and affordable. It holds every date that matters, tells you what is due, shows which vehicles you can use, and adds up what the fleet costs.</p>
        <ol class="help-steps">
          <li><strong>Start on the Dashboard.</strong> The coloured tiles tell you at a glance whether anything needs attention.</li>
          <li><strong>Work the Tasks list from the top.</strong> ${can.write ? 'Deal with what is overdue first, then what is due soon. Recording a task as done sets its next date.' : 'It shows what is overdue and what is due soon.'}</li>
          ${screenOn('planner') ? html`<li><strong>Look ahead on the Planner.</strong> It warns you about days when too few vehicles will be available.</li>` : ''}
          <li><strong>Keep the records up to date.</strong> ${can.write ? 'Mileage readings, garage visits, incidents and costs are what make everything else accurate.' : 'Mileage readings, garage visits, incidents and costs are entered by admins and fleet managers.'}</li>
        </ol>
        <p>You are signed in as <strong>${ROLE_LABEL[state.role]}</strong>. ${ROLE_HINT[state.role]}</p>
        <p class="muted">Everything anyone changes is recorded with their name and the time. Nothing is silently lost.</p>
      </div>
    </section>

    <section class="help-section" data-help>
      <h2>Screen by screen</h2>
      ${guides.map(([id, title, what, steps]) => topic('', html`<span class="help-title">${title}</span><span class="muted help-what">${what}</span>`,
        html`<ul>${steps.filter(Boolean).map((s) => html`<li>${s}</li>`)}</ul><p><a class="btn btn-sm" href="#/${id}">Open ${title}</a> <span class="muted help-ver">${versionOf(id)}</span></p>`))}
    </section>

    <section class="help-section" data-help>
      <h2>Common questions</h2>
      ${faqs.map(([q, a]) => topic('help-faq', q, html`<p>${a}</p>`))}
    </section>

    <section class="help-section" id="help-feedback">
      <div class="section-head"><h2>Your feedback</h2><button class="btn btn-primary" data-action="send">Send feedback</button></div>
      <p class="muted">What you have sent, where it has got to, and the reply.</p>
      <div id="my-feedback">${myFeedbackHtml(mine)}</div>
    </section>`);

  // Search: show only the topics that contain every word typed, and open them.
  const q = main.querySelector('#help-q'); const none = main.querySelector('#help-none');
  q.addEventListener('input', () => {
    const words = q.value.toLowerCase().split(/\s+/).filter(Boolean);
    let shown = 0;
    main.querySelectorAll('.help-topic').forEach((t) => {
      const hit = !words.length || words.every((w) => t.textContent.toLowerCase().includes(w));
      t.hidden = !hit; t.open = hit && words.length > 0;
      if (hit) shown += 1;
    });
    main.querySelector('.help-basics').hidden = words.length > 0;
    main.querySelectorAll('[data-help]').forEach((s) => { s.hidden = words.length > 0 && !s.querySelector('.help-topic:not([hidden])'); });
    none.hidden = shown > 0;
  });
  on(main, {
    send: () => feedbackModal({ section: 'help', onSaved: async () => { await loadMine(); mount(main.querySelector('#my-feedback'), myFeedbackHtml(mine)); } }),
  });
}
