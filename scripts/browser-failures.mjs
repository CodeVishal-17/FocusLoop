// Failure cases in the redesigned UI: model down, junk output, slow model.
// Needs three stub servers: down on 8788, slow on 8789, junk on 8790.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const outDir = process.argv[2];
fs.mkdirSync(outDir, { recursive: true });
const results = [];
const check = (c, name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} [${c}] ${name}${detail ? ' — ' + detail : ''}`); };
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new' });

async function open(port) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle0' });
  const text = (id) => page.$eval(`#${id}`, (e) => e.textContent.trim());
  const idle = (timeout = 45000) => page.waitForFunction(() => document.getElementById('busy').hidden && ![...document.querySelectorAll('main button')].some((b) => b.disabled), { timeout });
  const screen = () => page.evaluate(() => document.body.dataset.screen);
  const shot = async (name) => { await new Promise((r) => setTimeout(r, 400)); await page.screenshot({ path: path.join(outDir, `${name}.png`) }); };
  return { ctx, page, text, idle, screen, shot, errors };
}

for (const [c, port] of [['model down', 8788], ['junk output', 8790]]) {
  const { ctx, page, text, idle, screen, shot, errors } = await open(port);
  await page.type('#goal', 'I need to study DBMS');
  const t0 = Date.now();
  await page.click('#goal-submit'); await idle();
  check(c, 'first step falls back to a built-in step, labelled as built-in', (await screen()) === 'ready' && (await text('ready-source')) === 'Built-in step' && (await text('ready-action')).length > 8, `${await text('ready-action')} (${Date.now() - t0} ms)`);
  check(c, 'the step is not attributed to Gemma', !/Gemma/.test(await page.$eval('#screen-ready', (e) => e.textContent)));
  await shot(`fallback-${c.replace(' ', '-')}-first-step`);
  const first = await text('ready-action');
  await page.click('#start-focus');
  await page.click('#stuck'); await idle();
  check(c, '"I\'m stuck" still gives a different built-in step', (await text('focus-action')) !== first && (await text('focus-source')) === 'Built-in step', await text('focus-action'));
  await page.click('#distracted');
  await page.waitForFunction(() => !document.getElementById('back').hidden, { timeout: 45000 });
  check(c, 'recovery still shows "You\'re back." with a built-in step', (await page.$eval('#recovery .big', (e) => e.textContent)) === "You're back." && (await text('recovery-source')) === 'Built-in step', await text('recovery-action'));
  await shot(`fallback-${c.replace(' ', '-')}-recovery`);
  await page.click('#back');
  await page.evaluate(() => { const s = JSON.parse(localStorage['focusloop.session.v1']); s.endsAt = Date.now() + 1500; localStorage['focusloop.session.v1'] = JSON.stringify(s); });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.body.dataset.screen === 'done' && document.getElementById('done-note').textContent.length > 8, { timeout: 20000 });
  check(c, 'completion shows a factual line marked as written by FocusLoop', (await text('done-source')) === 'Written by FocusLoop' && /15 minutes/.test(await text('done-note')), await text('done-note'));
  await shot(`fallback-${c.replace(' ', '-')}-done`);
  check(c, 'no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

{
  const c = 'slow model';
  const { ctx, page, text, idle, screen, shot, errors } = await open(8789);
  await page.type('#goal', 'I need to study DBMS');
  const t0 = Date.now();
  await page.click('#goal-submit');
  await new Promise((r) => setTimeout(r, 3000));
  const busyShown = await page.$eval('#busy', (e) => !e.hidden && e.textContent);
  const locked = await page.evaluate(() => document.getElementById('goal-submit').disabled && document.getElementById('goal').disabled);
  check(c, 'shows a waiting line and locks the form while waiting', busyShown === 'Finding a small step…' && locked, String(busyShown));
  await shot('slow-waiting');
  await page.evaluate(() => document.getElementById('goal-form').requestSubmit());
  await idle(40000);
  const ms = Date.now() - t0;
  check(c, 'gives up after about 20 s and shows a built-in step', (await screen()) === 'ready' && (await text('ready-source')) === 'Built-in step' && ms > 19000 && ms < 26000, `${ms} ms`);
  check(c, 'a second submit while waiting did not start a second session', (await page.evaluate(() => JSON.parse(localStorage['focusloop.events.v1']).filter((e) => e.type === 'goal_set').length)) === 1);
  await shot('slow-after-timeout');
  check(c, 'no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

await browser.close();
console.log(`\n${results.filter(Boolean).length} of ${results.length} checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
