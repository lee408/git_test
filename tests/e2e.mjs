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

// ---- mock Dropbox: one file with revisions ----
const dropbox = { content: null, rev: 0 };
async function mockDropbox(context) {
  await context.route('https://www.dropbox.com/oauth2/authorize**', (route) => {
    const u = new URL(route.request().url());
    route.fulfill({ status: 302, headers: { location: `${u.searchParams.get('redirect_uri')}?code=CODE&state=${u.searchParams.get('state')}` } });
  });
  await context.route('https://api.dropboxapi.com/oauth2/token', (route) => route.fulfill({
    json: { access_token: 'AT', expires_in: 14400, refresh_token: 'RT' },
  }));
  await context.route('https://content.dropboxapi.com/2/files/download', (route) => {
    if (!dropbox.content) return route.fulfill({ status: 409, json: { error_summary: 'path/not_found/..' } });
    return route.fulfill({
      body: dropbox.content,
      headers: { 'Content-Type': 'application/octet-stream', 'Dropbox-API-Result': JSON.stringify({ rev: String(dropbox.rev) }), 'Access-Control-Expose-Headers': 'Dropbox-API-Result' },
    });
  });
  await context.route('https://content.dropboxapi.com/2/files/upload', (route) => {
    const arg = JSON.parse(route.request().headers()['dropbox-api-arg']);
    const ok = arg.mode['.tag'] === 'add' ? !dropbox.content : arg.mode.update === String(dropbox.rev);
    if (!ok) return route.fulfill({ status: 409, json: { error_summary: 'path/conflict/..' } });
    dropbox.content = route.request().postData();
    dropbox.rev++;
    return route.fulfill({ json: { rev: String(dropbox.rev) } });
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

// Weekly review.
await pc.keyboard.press('8');
await shot(pc, '06-review');

// Mind sweep: general card, then the project card files lines under the project.
await pc.click('[data-action="sweep-start"]');
assert.match(await pc.textContent('#main'), /What has been on your mind/);
await pc.fill('#sweep-text', '- Renew passport\n\n* Ring dentist @phone');
await pc.press('#sweep-text', 'Control+Enter');
assert.match(await pc.textContent('#main'), /2 things captured/);
while (!/Car serviced and MOT passed: what's unfinished/.test(await pc.textContent('#main .q'))) {
  await pc.click('[data-action="sweep-next"]');
}
assert.match(await pc.textContent('#main .sweep-hints'), /Call garage to book service/, 'shows current next action');
await pc.fill('#sweep-text', 'Find V5 logbook');
await shot(pc, '06b-sweep-project');
await pc.click('[data-action="sweep-next"]');
await pc.click('[data-action="sweep-back"]');
assert.match(await pc.textContent('#main .q'), /Car serviced/, 'back returns to the project card');
await pc.click('[data-action="sweep-finish"]');
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

assert.deepEqual(errors, []);
console.log('E2E OK');
await browser.close();
server.close();
