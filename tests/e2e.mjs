// End-to-end check in Chromium: capture → clarify → Now view → review, plus two-device
// Dropbox sync against an in-memory mock. Run: npm run e2e (needs the `playwright` package).
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../app');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const SHOTS = process.env.SHOTS;

// Apply the same headers Cloudflare Pages will (app/_headers), so the CSP is tested too.
const HEADERS = [];
for (const line of fs.readFileSync(path.join(ROOT, '_headers'), 'utf8').split('\n')) {
  if (!line.trim() || line.trim().startsWith('#')) continue;
  if (!/^\s/.test(line)) HEADERS.push({ pattern: line.trim(), headers: {} });
  else { const [k, ...v] = line.trim().split(':'); HEADERS.at(-1).headers[k] = v.join(':').trim(); }
}
const headersFor = (p) => Object.assign({}, ...HEADERS
  .filter(({ pattern }) => (pattern.endsWith('*') ? p.startsWith(pattern.slice(0, -1)) : p === pattern))
  .map((h) => h.headers));

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let p = urlPath;
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', ...headersFor(urlPath) });
  fs.createReadStream(file).pipe(res);
}).listen(0);
const BASE = `http://localhost:${server.address().port}/`;

// ---- mock Dropbox: an app folder of files with revisions ----
function makeDropbox() {
  const db = { files: new Map(), deleted: [], downloads: [], revs: 0 };
  Object.defineProperty(db, 'content', { get: () => db.files.get('/clearhead.json')?.body.toString() });
  return db;
}
const dropbox = makeDropbox();
async function mockDropbox(context, db = dropbox) {
  await context.route('https://www.dropbox.com/oauth2/authorize**', (route) => {
    const u = new URL(route.request().url());
    route.fulfill({ status: 302, headers: { location: `${u.searchParams.get('redirect_uri')}?code=CODE&state=${u.searchParams.get('state')}` } });
  });
  await context.route('https://api.dropboxapi.com/oauth2/token', (route) => route.fulfill({
    json: { access_token: 'AT', expires_in: 14400, refresh_token: 'RT' },
  }));
  await context.route('https://content.dropboxapi.com/2/files/download', (route) => {
    const { path: p } = JSON.parse(route.request().headers()['dropbox-api-arg']);
    db.downloads.push(p);
    const f = db.files.get(p.toLowerCase());
    if (!f) return route.fulfill({ status: 409, json: { error_summary: 'path/not_found/..' } });
    return route.fulfill({
      body: f.body,
      headers: { 'Content-Type': 'application/octet-stream', 'Dropbox-API-Result': JSON.stringify({ rev: f.rev }), 'Access-Control-Expose-Headers': 'Dropbox-API-Result' },
    });
  });
  await context.route('https://content.dropboxapi.com/2/files/upload', (route) => {
    const arg = JSON.parse(route.request().headers()['dropbox-api-arg']);
    let p = arg.path;
    const existing = db.files.get(p.toLowerCase());
    if (arg.mode['.tag'] === 'add' && existing) {
      if (!arg.autorename) return route.fulfill({ status: 409, json: { error_summary: 'path/conflict/..' } });
      p = p.replace(/(\.[^./]*)?$/, ' (1)$1');
    }
    if (arg.mode['.tag'] === 'update' && (!existing || existing.rev !== arg.mode.update)) return route.fulfill({ status: 409, json: { error_summary: 'path/conflict/..' } });
    const body = route.request().postDataBuffer() || Buffer.alloc(0);
    const rev = String(++db.revs);
    db.files.set(p.toLowerCase(), { path: p, body, rev });
    return route.fulfill({ json: { path_display: p, rev, size: body.length } });
  });
  await context.route('https://api.dropboxapi.com/2/files/delete_v2', (route) => {
    const { path: p } = JSON.parse(route.request().postData());
    db.deleted.push(p);
    if (!db.files.delete(p.toLowerCase())) return route.fulfill({ status: 409, json: { error_summary: 'path_lookup/not_found/' } });
    return route.fulfill({ json: { metadata: { path_display: p } } });
  });
}

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const errors = [];
async function device(name, viewport) {
  const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
  await mockDropbox(context);
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  // 409s are expected: Dropbox "file not found yet" and write conflicts that sync retries.
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 409/.test(m.text())) errors.push(`${name}: ${m.text()}`); });
  page.on('dialog', (d) => d.accept());
  await page.goto(BASE);
  return page;
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true }); };
const capture = async (page, text) => { await page.fill('#capture-input', text); await page.press('#capture-input', 'Enter'); };

// ---------- Device A: Windows desktop ----------
const pc = await device('pc', { width: 1280, height: 860 });

// First launch: welcome offers the brain dump; gather card, trigger card, finish, quick sort.
assert.match(await pc.textContent('#main'), /Welcome to Clearhead/);
await pc.click('[data-action="dump-start"]');
assert.match(await pc.textContent('#main .walk-stage'), /Gather/);
await pc.fill('#walk-text', 'Council tax letter\nOld phone to sell');
await pc.click('[data-action="walk-next"]');
await pc.click('[data-action="nav"][data-view="now"]'); // pause
assert.match(await pc.textContent('#main'), /Brain dump in progress: 2 things/);
await pc.click('[data-action="dump-start"]'); // resume on card 2
assert.match(await pc.textContent('#main .sweep-meta'), /Question 2 of/);
while ((await pc.textContent('#main .walk-stage')).includes('Gather')) await pc.click('[data-action="walk-next"]');
assert.match(await pc.textContent('#main .label'), /Work/);
await pc.fill('#walk-text', 'Quarterly report draft\nCancel unused gym membership\nRenovate bathroom\nLearn Italian');
await pc.click('[data-action="walk-finish"]');
assert.match(await pc.textContent('#main'), /6 things captured/);
await shot(pc, '00a-dump-done');
await pc.click('[data-view="triage"].btn');
assert.match(await pc.textContent('#main .label'), /Physical stuff/, 'triage shows where an item came from');
assert.match(await pc.textContent('#main .triage-title'), /Council tax letter/);
await shot(pc, '00b-quick-sort');
await pc.keyboard.press('a');                                        // Council tax letter -> keep
await pc.click('[data-action="triage"][data-to="trash"]');           // Old phone to sell -> trash
await pc.click('#toast [data-action="undo"]');                       // ...undo
assert.match(await pc.textContent('#main .triage-title'), /Old phone to sell/);
await pc.keyboard.press('s');                                        // Old phone -> someday
await pc.keyboard.press('a');                                        // Quarterly report -> keep
await pc.keyboard.press('d');                                        // Cancel gym -> done
await pc.keyboard.press('p');                                        // Renovate bathroom -> project
await pc.keyboard.press('t');                                        // Learn Italian -> trash
assert.match(await pc.textContent('#main'), /2 actions left to clarify/);
assert.match(await pc.textContent('#main'), /1 project still need/);
const sorted = await pc.evaluate(() => {
  const d = JSON.parse(localStorage.getItem('clearhead.doc.v1'));
  const items = Object.values(d.items).filter((i) => !i.deleted);
  return { inbox: items.filter((i) => i.list === 'inbox' && !i.done).map((i) => i.title).sort(), someday: items.filter((i) => i.list === 'someday').map((i) => i.title),
    done: items.filter((i) => i.done).map((i) => i.title), projects: Object.values(d.projects).filter((p) => !p.deleted).map((p) => p.title), all: items.length };
});
assert.deepEqual(sorted.inbox, ['Council tax letter', 'Quarterly report draft']);
assert.deepEqual(sorted.someday, ['Old phone to sell']);
assert.deepEqual(sorted.done, ['Cancel unused gym membership']);
assert.deepEqual(sorted.projects, ['Renovate bathroom']);
// Reset to an empty system so the rest of the flow starts from scratch.
await pc.evaluate(() => { localStorage.removeItem('clearhead.doc.v1'); localStorage.setItem('clearhead.pref.view', '"now"'); });
await pc.reload();
assert.doesNotMatch(await pc.textContent('#main'), /Welcome to Clearhead/, 'not offered again once started');
await capture(pc, 'Sort out car');
await capture(pc, 'Buy printer ink @errands ~15m');
await capture(pc, 'Learn Spanish');
await pc.click('[data-view="inbox"]');
assert.equal(await pc.locator('#main .task').count(), 3);
await shot(pc, '01-inbox-desktop');

// Clarify "Sort out car" as a project.
await pc.click('[data-action="process-start"]');
await pc.click('[data-to="multi"]');
await pc.click('[data-to="project"]');
await pc.fill('[data-draft="outcome"]', 'Car serviced and MOT passed');
await pc.fill('[data-draft="title"]', 'sort garage');
assert.match(await pc.textContent('.vague-hint'), /sort/);
await pc.fill('[data-draft="title"]', 'Call garage to book service');
assert.equal((await pc.textContent('.vague-hint')).trim(), '');
await shot(pc, '02-clarify-project');
await pc.click('[data-action="p-project"]');
await pc.click('[data-to="who"]');
await pc.click('[data-to="details"]');
await pc.click('[data-action="p-ctx"][data-ctx="phone"]');
await pc.click('[data-action="p-time"][data-min="5"]');
await pc.click('[data-action="p-energy"][data-energy="low"]');
await shot(pc, '03-clarify-details');
await pc.click('[data-action="p-finish"][data-list="next"]');

// "Buy printer ink": single action, keep, me, save.
await pc.click('[data-to="multi"]');
await pc.click('[data-to="action"]');
await pc.click('[data-to="two"]');
await pc.click('[data-to="who"]');
await pc.click('[data-to="details"]');
await pc.click('[data-action="p-finish"][data-list="next"]');

// "Learn Spanish": not actionable → someday.
await pc.click('[data-to="not"]');
await pc.click('[data-action="p-finish"][data-list="someday"]');
assert.match(await pc.textContent('#main'), /Inbox zero/);

// Now view with filters.
await pc.click('#sidenav [data-view="now"]');
assert.match(await pc.textContent('#main'), /Weekly review is due/);
assert.equal(await pc.locator('#main .task').count(), 2);
await pc.click('[data-action="now-ctx"][data-ctx="phone"]');
await pc.click('[data-action="now-time"][data-min="5"]');
const nowTitles = await pc.locator('#main .task .task-title').allTextContents();
assert.deepEqual(nowTitles, ['Call garage to book service']);
await shot(pc, '04-now-desktop');

// Keyboard: N focuses capture, 4 goes to projects.
await pc.locator('body').press('Escape');
await pc.keyboard.press('4');
assert.match(await pc.textContent('#main h1'), /Projects/);
assert.match(await pc.textContent('#main'), /Car serviced and MOT passed/);
await pc.keyboard.press('n');
assert.equal(await pc.evaluate(() => document.activeElement.id), 'capture-input');
await shot(pc, '05-projects');

// Edit dialog.
await pc.keyboard.press('Escape');
await pc.keyboard.press('3');
await pc.click('#main .task-body >> text=Buy printer ink');
await pc.fill('#editor-form [name="due"]', '2026-12-01');
await pc.click('#editor-form .btn.primary');
assert.match(await pc.textContent('#main'), /Due/);

// Google Calendar: a time block from the editor opens a pre-filled event, then tracks changes.
await pc.context().route('https://calendar.google.com/**', (r) => r.fulfill({ body: 'gcal' }));
await pc.click('#main .task-body >> text=Buy printer ink');
await pc.fill('#editor-form [name="schedDate"]', '2026-12-01');
await pc.fill('#editor-form [name="schedTime"]', '14:30');
const [gcal] = await Promise.all([pc.context().waitForEvent('page'), pc.click('[data-action="editor-cal"][data-kind="block"]')]);
const gu = new URL(gcal.url());
assert.equal(gu.searchParams.get('action'), 'TEMPLATE');
assert.equal(gu.searchParams.get('text'), 'Buy printer ink');
assert.equal(gu.searchParams.get('dates'), '20261201T143000/20261201T144500', '15m block from ~15m');
assert.ok(gu.searchParams.get('ctz'));
await gcal.close();
assert.match(await pc.textContent('#main'), /In calendar/);
await pc.click('#main .task-body >> text=Buy printer ink');
await pc.fill('#editor-form [name="schedTime"]', '16:00');
await pc.click('#editor-form .btn.primary');
assert.match(await pc.textContent('#main'), /Calendar out of date/);
assert.match(await pc.textContent('#toast'), /Date changed/);
const [gcal2] = await Promise.all([pc.context().waitForEvent('page'), pc.click('#toast [data-action="undo"]')]);
assert.match(new URL(gcal2.url()).searchParams.get('dates'), /T160000/);
await gcal2.close();
assert.doesNotMatch(await pc.textContent('#main'), /out of date/);
await pc.keyboard.press('7');
assert.match(await pc.textContent('#main'), /Add deadline to Google Calendar/);
await shot(pc, '05b-upcoming-calendar');

// Weekly review.
await pc.keyboard.press('8');
await shot(pc, '06-review');

// Mind sweep: general card, then the project card files lines under the project.
await pc.click('[data-action="sweep-start"]');
assert.match(await pc.textContent('#main'), /What has been on your mind/);
await pc.fill('#walk-text', '- Renew passport\n\n* Ring dentist @phone');
await pc.press('#walk-text', 'Control+Enter');
assert.match(await pc.textContent('#main'), /2 things captured/);
while (!/Car serviced and MOT passed: what's unfinished/.test(await pc.textContent('#main .q'))) {
  await pc.click('[data-action="walk-next"]');
}
assert.match(await pc.textContent('#main .sweep-hints'), /Call garage to book service/, 'shows current next action');
await pc.fill('#walk-text', 'Find V5 logbook');
await shot(pc, '06b-sweep-project');
await pc.click('[data-action="walk-next"]');
await pc.click('[data-action="walk-back"]');
assert.match(await pc.textContent('#main .q'), /Car serviced/, 'back returns to the project card');
await pc.click('[data-action="walk-finish"]');
assert.match(await pc.textContent('#main'), /3 things out of your head/);
const swept = await pc.evaluate(() => Object.values(JSON.parse(localStorage.getItem('clearhead.doc.v1')).items)
  .filter((i) => i.list === 'inbox' && !i.deleted).map((i) => ({ t: i.title, p: i.projectId, c: i.contexts })));
assert.deepEqual(swept.map((x) => x.t).sort(), ['Find V5 logbook', 'Renew passport', 'Ring dentist']);
assert.ok(swept.find((x) => x.t === 'Find V5 logbook').p, 'project line linked to project');
assert.deepEqual(swept.find((x) => x.t === 'Ring dentist').c, ['phone']);
await pc.click('[data-view="review"].btn');
assert.ok(await pc.isChecked('[data-step="loose"]'), 'sweep ticks review step 1');
assert.match(await pc.textContent('#main'), /Sweep again/);
await pc.click('[data-action="review-finish"]');
assert.doesNotMatch(await pc.textContent('#main'), /Weekly review is due/);

// Connect Dropbox (mock) → first upload.
await pc.keyboard.press('0');
await pc.fill('[name="appKey"]', 'testkey');
await pc.click('#sync-settings .btn.primary');
await pc.waitForURL(BASE);
await pc.waitForFunction(() => document.querySelector('#sync-dot')?.dataset.state === 'ok');
assert.ok(dropbox.content, 'uploaded to dropbox');
assert.equal(Object.values(JSON.parse(dropbox.content).items).filter((i) => !i.deleted).length, 6);

// ---------- Device B: Android phone ----------
const phone = await device('phone', { width: 390, height: 844 });
await phone.click('.tabbar [data-view="more"]');
await phone.click('#main [data-view="settings"]');
await phone.fill('[name="appKey"]', 'testkey');
await phone.click('#sync-settings .btn.primary');
await phone.waitForURL(BASE);
await phone.waitForFunction(() => document.querySelector('#sync-dot')?.dataset.state === 'ok');
await phone.click('.tabbar [data-view="next"]');
assert.equal(await phone.locator('#main .task').count(), 2, 'phone received PC actions');

// Phone captures + completes; PC edits concurrently; both converge.
await capture(phone, 'Text Jo about Saturday @phone');
await phone.click('#main .task:has-text("Buy printer ink") .check');
await pc.keyboard.press('3');
await pc.click('#main .task:has-text("Call garage") .star');
await phone.waitForFunction(() => document.querySelector('#sync-dot')?.dataset.state === 'ok' && !document.title.includes('syncing'));
await phone.waitForTimeout(3500);
await pc.waitForTimeout(3500);
await pc.evaluate(() => window.dispatchEvent(new Event('online')));
await pc.waitForTimeout(800);
await phone.evaluate(() => window.dispatchEvent(new Event('online')));
await phone.waitForTimeout(800);

const remote = JSON.parse(dropbox.content);
const byTitle = (t) => Object.values(remote.items).find((i) => i.title === t);
assert.equal(byTitle('Buy printer ink').done, true, 'phone completion synced');
assert.equal(byTitle('Call garage to book service').focus, true, 'pc star synced');
assert.ok(byTitle('Text Jo about Saturday'), 'phone capture synced');
await pc.keyboard.press('2');
assert.match(await pc.textContent('#main'), /Text Jo about Saturday/, 'pc sees phone capture');

await phone.click('.tabbar [data-view="now"]');
await shot(phone, '07-now-phone');
await phone.click('.tabbar [data-view="inbox"]');
await phone.click('[data-action="process-start"]');
await shot(phone, '08-clarify-phone');

// Share target + shortcut URLs.
await phone.goto(`${BASE}?share=1&title=Article&url=https%3A%2F%2Fexample.com`);
await phone.waitForTimeout(300);
await phone.click('.tabbar [data-view="inbox"]');
assert.match(await phone.textContent('#main'), /Article/);

// ---------- Project prompts, task relations and Reference (fresh device + Dropbox) ----------
{
  const box = makeDropbox();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await mockDropbox(ctx, box);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`features: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 409/.test(m.text())) errors.push(`features: ${m.text()}`); });
  page.on('dialog', (d) => d.accept());
  await page.goto(BASE);
  await page.click('[data-action="dump-dismiss"]');
  await page.click('#sidenav [data-view="settings"]');
  await page.fill('[name="appKey"]', 'testkey');
  await page.click('#sync-settings .btn.primary');
  await page.waitForURL(BASE);
  await page.waitForFunction(() => document.querySelector('#sync-dot')?.dataset.state === 'ok');
  const docNow = () => page.evaluate(() => JSON.parse(localStorage.getItem('clearhead.doc.v1')));
  const today = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
  const plusDays = (n) => { const [y, m, d] = today.split('-').map(Number); const t = new Date(y, m - 1, d + n); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };

  // Project with one action; an unrelated inbox item to queue across projects.
  await capture(page, 'Buy paint samples');
  await page.click('#sidenav [data-view="projects"]');
  await page.fill('[data-form="new-project"] input', 'Kitchen refit');
  await page.press('[data-form="new-project"] input', 'Enter');
  await page.fill('[data-form="project-action"] input', 'Get plumber quote @phone');
  await page.press('[data-form="project-action"] input', 'Enter');

  // Editor: queue "then do" (+2d), "then wait for" (+7d check-back), and an existing item; attach a link.
  await page.click('#main .task-body >> text=Get plumber quote');
  await page.fill('#editor-form [name="relTitle"]', 'Email quote to Sam');
  await page.fill('#editor-form [name="relOffset"]', '2');
  await page.click('[data-action="rel-add"]');
  await page.selectOption('#editor-form [name="relKind"]', 'waiting');
  assert.equal(await page.inputValue('#editor-form [name="relOffset"]'), '7', 'waiting defaults to a 7-day check-back');
  await page.fill('#editor-form [name="relWho"]', 'Sam');
  await page.fill('#editor-form [name="relTitle"]', 'Sam\'s go-ahead');
  await page.press('#editor-form [name="relTitle"]', 'Enter');
  const paintId = (Object.values((await docNow()).items).find((i) => i.title === 'Buy paint samples')).id;
  await page.selectOption('#editor-form [name="relExisting"]', paintId);
  await page.click('[data-action="rel-link"]');
  assert.equal(await page.locator('#rel-section .rel-list li').count(), 3);
  assert.match(await page.textContent('#rel-section'), /Then: Email quote to Sam · \+2d/);
  assert.match(await page.textContent('#rel-section'), /Wait for: Sam's go-ahead \(Sam\) · \+7d/);
  assert.match(await page.textContent('#rel-section'), /Then: Buy paint samples(?! ·)/, 'cross-project (no project) shown without project label mismatch');
  await page.click('#ref-attach [data-action="ref-new"][data-kind="link"]');
  await page.fill('#ref-form [name="url"]', 'example.com/plumbers');
  await page.click('#ref-form .btn.primary');
  assert.match(await page.textContent('#ref-attach'), /example\.com/);
  await shot(page, '13-editor-relations');
  await page.click('#editor-form .btn.primary');

  // Queued items are hidden from lists until the trigger is done.
  assert.match(await page.textContent('#main'), /Queued: start when their trigger is done/);
  assert.match(await page.textContent('#main'), /then 3 more/);
  await page.keyboard.press('2');
  assert.doesNotMatch(await page.textContent('#main'), /Buy paint samples/, 'queued inbox item hidden');
  await page.click('#sidenav [data-view="projects"]');
  await page.click('#main .project-main >> text=Kitchen refit');

  // Completing the action releases the follow-ups and asks what's next.
  await page.click('#main .task:has-text("Get plumber quote") .check');
  assert.ok(await page.isVisible('#next-dialog'));
  const released = await page.textContent('#next-form .np-released');
  for (const t of ['Email quote to Sam', 'Sam\'s go-ahead', 'Buy paint samples']) assert.ok(released.includes(t), `released ${t}`);
  await shot(page, '14-whats-next');
  await page.fill('#next-form [name="next"]', 'Choose tiles @errands');
  await page.fill('#next-form [name="wWho"]', 'Builder');
  await page.click('#next-form .btn.primary');
  let d = await docNow();
  const byTitle = (t) => Object.values(d.items).find((i) => i.title === t && !i.deleted);
  assert.equal(byTitle('Email quote to Sam').start, plusDays(2));
  assert.equal(byTitle('Sam\'s go-ahead').due, plusDays(7));
  assert.equal(byTitle('Sam\'s go-ahead').list, 'waiting');
  assert.equal(byTitle('Buy paint samples').after, null);
  assert.equal(byTitle('Choose tiles').list, 'next');
  assert.deepEqual(byTitle('Choose tiles').contexts, ['errands']);
  assert.equal(byTitle('Reply from Builder').waitingOn, 'Builder');
  // Every project completion prompts; "Project complete" closes the project.
  await page.click('#main .task:has-text("Choose tiles") .check');
  await page.click('[data-action="np-complete"]');
  d = await docNow();
  assert.equal(Object.values(d.projects).find((p) => p.title === 'Kitchen refit').status, 'done');

  // Reference: note with tag, file upload (cached → opens offline), search, delete.
  await page.click('#sidenav [data-view="reference"]');
  await page.click('#main [data-action="ref-new"][data-kind="note"]');
  await page.fill('#ref-form [name="title"]', 'Wifi password');
  await page.fill('#ref-form [name="note"]', 'hunter2');
  await page.fill('#ref-form [name="tags"]', 'Home');
  await page.click('#ref-form .btn.primary');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await page.setInputFiles('#main .ref-add input[data-action="ref-file"]:not([capture])', { name: 'boiler photo.png', mimeType: 'image/png', buffer: png });
  assert.match(await page.textContent('#ref-form .ref-filename'), /boiler photo\.png/);
  await page.fill('#ref-form [name="tags"]', 'Home, Manuals');
  await page.click('#ref-form .btn.primary');
  await page.waitForFunction(() => document.querySelectorAll('#ref-list .ref').length === 3);
  const uploaded = [...box.files.values()].find((f) => /\/files\/.+boiler photo\.png$/.test(f.path));
  assert.ok(uploaded, 'file uploaded to Dropbox /files');
  assert.equal(Buffer.compare(uploaded.body, png), 0);
  await page.fill('#ref-search', 'wifi');
  assert.equal(await page.locator('#ref-list .ref').count(), 1);
  await page.fill('#ref-search', '');
  await page.click('[data-action="ref-tag"][data-tag="Manuals"]');
  assert.equal(await page.locator('#ref-list .ref').count(), 1);
  await page.click('#ref-list .ref-open');
  await page.waitForFunction(() => document.querySelector('#viewer img')?.naturalWidth === 1);
  assert.equal(box.downloads.filter((p) => p.includes('boiler')).length, 0, 'opened from the offline copy');
  await page.click('[data-action="viewer-close"]');
  await page.evaluate(() => caches.delete('clearhead-files'));
  await page.click('#ref-list .ref-open');
  await page.waitForFunction(() => document.querySelector('#viewer img')?.naturalWidth === 1);
  assert.equal(box.downloads.filter((p) => p.includes('boiler')).length, 1, 'downloaded when not cached');
  await shot(page, '15-reference-viewer');
  await page.click('[data-action="viewer-close"]');
  await page.click('#ref-list [data-action="ref-edit"]');
  await page.click('[data-action="ref-delete"]');
  assert.deepEqual(box.deleted, [uploaded.path]);
  await page.click('[data-action="ref-tag"][data-tag=""]');
  assert.equal(await page.locator('#ref-list .ref').count(), 2);
  await shot(page, '16-reference');

  // Android share target: a shared file goes to Reference; a shared link can go to the Inbox.
  await page.evaluate(() => navigator.serviceWorker.ready);
  if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) await page.reload();
  const shareUrl = await page.evaluate(async () => {
    const fd = new FormData();
    fd.append('title', 'Receipt');
    fd.append('files', new File(['total: 42'], 'receipt.txt', { type: 'text/plain' }));
    return (await fetch('share-target', { method: 'POST', body: fd })).url;
  });
  assert.match(shareUrl, /\?shared=/);
  await page.goto(shareUrl);
  await page.waitForSelector('#ref-dialog[open]');
  assert.match(await page.textContent('#ref-form .ref-filename'), /receipt\.txt/);
  await page.click('#ref-form .btn.primary');
  await page.waitForFunction(() => /receipt/.test(document.querySelector('#ref-list')?.textContent));
  const linkUrl = await page.evaluate(async () => {
    const fd = new FormData();
    fd.append('text', 'Great article https://example.org/read');
    return (await fetch('share-target', { method: 'POST', body: fd })).url;
  });
  await page.goto(linkUrl);
  await page.waitForSelector('#ref-dialog[open]');
  assert.equal(await page.inputValue('#ref-form [name="url"]'), 'https://example.org/read');
  await page.click('[data-action="ref-to-inbox"]');
  await page.keyboard.press('2');
  assert.match(await page.textContent('#main'), /Great article/);
  await ctx.close();
}

// ---------- Miracle Morning: guided SAVERS with a fake clock ----------
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await ctx.clock.install({ time: new Date(2026, 9, 6, 6, 0) });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`savers: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`savers: ${m.text()}`); });
  await page.goto(BASE);
  await page.click('[data-action="dump-dismiss"]');
  assert.match(await page.textContent('.banner.savers'), /Miracle Morning: 30 min of SAVERS/);

  // Routine: Silence 1, Affirmations 1, Visualization 0 (skipped), Exercise 1, Reading 0, Scribing 1.
  await page.click('.tabbar [data-view="more"]');
  await page.click('#main [data-view="settings"]');
  await page.selectOption('#savers-settings [name="preset"]', 'custom');
  for (const [id, m] of Object.entries({ silence: 1, affirmations: 1, visualization: 0, exercise: 1, reading: 0, scribing: 1 })) {
    await page.fill(`#savers-settings [name="min-${id}"]`, String(m));
  }
  await page.fill('#savers-settings [name="affirmations"]', 'I am calm, focused and disciplined.');
  await page.click('#savers-settings .btn.primary');

  await page.click('.tabbar [data-view="now"]');
  await page.click('.banner.savers [data-view="savers"]');
  assert.match(await page.textContent('#main'), /How long today\?/);
  await page.click('[data-action="savers-start"][data-preset="custom"]');
  assert.match(await page.textContent('#main .q'), /Silence/);
  assert.equal(await page.textContent('#sv-time'), '01:00');
  await page.clock.runFor(5000);
  assert.equal(await page.textContent('#sv-time'), '00:55');
  assert.match(await page.textContent('#sv-breath'), /^Hold · 3$/);
  await page.click('[data-action="savers-toggle"]'); // pause
  await page.clock.runFor(10000);
  assert.equal(await page.textContent('#sv-time'), '00:55', 'paused');
  assert.equal(await page.textContent('#sv-breath'), 'Paused');
  await page.click('[data-action="savers-toggle"]'); // resume
  await shot(page, '10-savers-silence');
  await page.clock.runFor(56000);
  assert.match(await page.textContent('[data-action="savers-next"]'), /Next: Affirmations/);
  await page.click('[data-action="savers-next"]');
  assert.match(await page.textContent('.savers-text'), /I am calm, focused and disciplined\./);
  await page.fill('.sv-insight input', 'Call the bank about the mortgage');
  await page.press('.sv-insight input', 'Enter');
  await page.click('[data-action="savers-done"]');
  assert.match(await page.textContent('#main .q'), /Exercise/, 'Visualization (0 min) skipped');
  assert.equal(await page.locator('#sv-exercises li').count(), 6);
  assert.equal(await page.locator('#sv-exercises li.current').textContent(), 'Jumping jacks');
  await page.clock.runFor(31000);
  assert.equal(await page.locator('#sv-exercises li.current').textContent(), 'Lunges', '31s of 60s with 6 moves = 4th');
  await shot(page, '11-savers-exercise');
  await page.click('[data-action="savers-skip"]');
  assert.match(await page.textContent('#main .q'), /Scribing/, 'Reading (0 min) skipped');
  await page.click('[data-action="savers-done"]');
  assert.match(await page.textContent('#main'), /3 of 6 SAVERS done/);
  assert.match(await page.textContent('#main'), /Inbox \(1 new\)/);
  await shot(page, '12-savers-done');
  const rec = await page.evaluate(() => JSON.parse(localStorage.getItem('clearhead.doc.v1')).practice['2026-10-06']);
  assert.equal(rec.finished, true);
  assert.deepEqual(Object.keys(rec.done).sort(), ['affirmations', 'scribing', 'silence']);
  await page.click('[data-action="savers-close"][data-to="now"]');
  assert.equal(await page.locator('.banner.savers').count(), 0, 'prompt gone once done today');
  await ctx.close();
}

// ---------- Push notifications: real service worker, mocked push server ----------
{
  const { generateKeyPairSync } = await import('node:crypto');
  const vapidPub = generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey.export({ format: 'jwk' });
  const vapidRaw = Buffer.concat([Buffer.from([4]), Buffer.from(vapidPub.x, 'base64url'), Buffer.from(vapidPub.y, 'base64url')]).toString('base64url');
  // The lightweight headless shell always denies notifications; full Chromium (new headless) allows them.
  const fullBrowser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : { channel: 'chromium' });
  const ctx = await fullBrowser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.grantPermissions(['notifications'], { origin: BASE.replace(/\/$/, '') });
  // Headless Chromium has no push service, so stand in for the browser's subscription.
  await ctx.addInitScript(() => {
    const fake = { endpoint: 'https://fcm.googleapis.com/fcm/send/e2e', options: {}, toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'BPUB', auth: 'AUTH' } }; }, unsubscribe: async () => true };
    PushManager.prototype.subscribe = async function (opts) { window.__subscribeOpts = opts; return fake; };
    PushManager.prototype.getSubscription = async () => null;
  });
  const reqs = [];
  await ctx.route('https://test-push.workers.dev/**', async (route) => {
    const r = route.request();
    reqs.push({ method: r.method(), path: new URL(r.url()).pathname, auth: r.headers().authorization, body: r.postData() && JSON.parse(r.postData()) });
    if (r.method() === 'GET') return route.fulfill({ json: { publicKey: vapidRaw }, headers: { 'Access-Control-Allow-Origin': '*' } });
    return route.fulfill({ json: { ok: true, status: 201 }, headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`push: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`push: ${m.text()}`); });
  await page.goto(BASE);
  await page.evaluate(() => navigator.serviceWorker.ready);
  assert.match(await page.textContent('.daily-quote figcaption'), /\w/, 'quote of the day on Now');

  // Some data for the morning plan.
  await capture(page, 'Draft report at:07:00 ~30m');
  await capture(page, 'Pay invoice due:today');

  await page.click('.tabbar [data-view="more"]');
  await page.click('#main [data-view="settings"]');
  await page.fill('#push-settings [name="server"]', 'https://test-push.workers.dev/');
  await page.fill('#push-settings [name="key"]', 'my-secret');
  await page.fill('#push-settings [name="name"]', 'Pixel');
  await page.fill('#push-settings [name="morningTime"]', '07:15');
  await page.check('#push-settings [name="saversOn"]');
  await page.fill('#push-settings [name="saversTime"]', '06:10');
  await page.uncheck('#push-settings [name="eveningOn"]');
  await page.fill('#push-settings [name="quoteTimes"]', '9:00, 15:30, nonsense');
  await page.click('#push-settings .btn.primary');
  await page.waitForFunction(() => /On for this device/.test(document.querySelector('.push-status')?.textContent));
  assert.match(await page.textContent('.push-status'), /Miracle Morning 06:10 · Morning plan 07:15 · Quote 09:00 · Quote 15:30/);
  const put = reqs.find((r) => r.method === 'PUT');
  assert.match(put.path, /^\/api\/devices\/dev-/);
  assert.equal(put.auth, 'Bearer my-secret');
  assert.equal(put.body.name, 'Pixel');
  assert.ok(put.body.tz);
  assert.deepEqual(put.body.schedule, [{ kind: 'savers', time: '06:10' }, { kind: 'morning', time: '07:15' }, { kind: 'quote', time: '09:00' }, { kind: 'quote', time: '15:30' }]);
  assert.equal(put.body.subscription.endpoint, 'https://fcm.googleapis.com/fcm/send/e2e');
  assert.equal(await page.evaluate(() => window.__subscribeOpts.applicationServerKey.byteLength), 65);
  await page.click('[data-action="push-test"][data-kind="quote"]');
  await page.waitForFunction(() => /Test sent/.test(document.querySelector('.push-status')?.textContent));
  assert.deepEqual(reqs.at(-1).body, { kind: 'quote' });
  await shot(page, '09-notifications-settings');

  // Deliver real push events to the service worker and read the notifications it shows.
  await page.waitForTimeout(1300); // snapshot debounce
  const cdp = await ctx.newCDPSession(page);
  const regId = new Promise((resolve) => cdp.on('ServiceWorker.workerRegistrationUpdated', ({ registrations }) => {
    const r = registrations.find((x) => !x.isDeleted); if (r) resolve(r.registrationId);
  }));
  await cdp.send('ServiceWorker.enable');
  const registrationId = await regId;
  const origin = new URL(BASE).origin;
  const shown = async (tag) => page.evaluate(async (t) => {
    for (let i = 0; i < 50; i++) {
      const ns = await (await navigator.serviceWorker.ready).getNotifications({ tag: t });
      if (ns.length) return ns.map((n) => ({ title: n.title, body: n.body, url: n.data?.url }));
      await new Promise((r) => setTimeout(r, 100));
    }
    return [];
  }, tag);
  await cdp.send('ServiceWorker.deliverPushMessage', { origin, registrationId, data: JSON.stringify({ kind: 'morning' }) });
  const [morning] = await shown('clearhead-morning');
  assert.equal(morning.title, "Good morning. Here's your day");
  assert.match(morning.body, /Blocks: 07:00 Draft report/);
  assert.match(morning.body, /Due: Pay invoice/);
  await cdp.send('ServiceWorker.deliverPushMessage', { origin, registrationId, data: JSON.stringify({ kind: 'quote' }) });
  const [quote] = await shown('clearhead-quote');
  assert.match(quote.body, /^“.+” \(.+\)$/);
  await cdp.send('ServiceWorker.deliverPushMessage', { origin, registrationId, data: JSON.stringify({ kind: 'evening' }) });
  const [evening] = await shown('clearhead-evening');
  assert.equal(evening.title, 'Shutdown time');
  assert.equal(new URL(evening.url, BASE).search, '?capture=1');

  await cdp.send('ServiceWorker.deliverPushMessage', { origin, registrationId, data: JSON.stringify({ kind: 'savers' }) });
  const [mm] = await shown('clearhead-savers');
  assert.equal(mm.title, 'Your Miracle Morning');
  assert.equal(new URL(mm.url, BASE).search, '?savers=1');
  await page.click('[data-action="push-disable"]');
  await page.waitForFunction(() => /Off for this device/.test(document.querySelector('.push-status')?.textContent));
  assert.equal(reqs.at(-1).method, 'DELETE');
  await fullBrowser.close();
}

assert.deepEqual(errors, []);
console.log('E2E OK');
await browser.close();
server.close();
