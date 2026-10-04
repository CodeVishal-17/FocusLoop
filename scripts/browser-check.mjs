// Drives the real app in Chrome with real clicks, checks each core flow, and
// saves screenshots. Usage: node run.mjs <baseUrl> <outDir>
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const [base, outDir] = process.argv.slice(2);
const VIEWPORTS = { mobile: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, desktop: { width: 1280, height: 800, deviceScaleFactor: 1 } };
const results = [];
const check = (vp, name, ok, detail = '') => { results.push({ vp, name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} [${vp}] ${name}${detail ? ' — ' + detail : ''}`); };

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--enable-unsafe-webgpu'] });

for (const [vp, viewport] of Object.entries(VIEWPORTS)) {
  const dir = path.join(outDir, vp); fs.mkdirSync(dir, { recursive: true });
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport(viewport);
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  const shot = async (name) => { await new Promise((r) => setTimeout(r, 450)); await page.screenshot({ path: path.join(dir, `${name}.png`) }); };
  const text = (id) => page.$eval(`#${id}`, (e) => e.textContent.trim());
  const visible = (id) => page.$eval(`#${id}`, (e) => !!(e.offsetParent || e.getClientRects().length));
  const screen = () => page.evaluate(() => document.body.dataset.screen);
  const idle = () => page.waitForFunction(() => document.getElementById('busy').hidden && ![...document.querySelectorAll('main button')].some((b) => b.disabled), { timeout: 45000 });
  const overflow = async (name) => { const o = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1); check(vp, `no horizontal overflow: ${name}`, !o); };
  const sess = () => page.evaluate(() => JSON.parse(localStorage['focusloop.session.v1'] || 'null'));
  const patchSession = (fn) => page.evaluate((src) => { const s = JSON.parse(localStorage['focusloop.session.v1']); new Function('s', src)(s); localStorage['focusloop.session.v1'] = JSON.stringify(s); }, fn);

  await page.goto(base, { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.fonts.ready);
  check(vp, 'fonts are local', await page.evaluate(() => document.fonts.check('16px Fraunces') && document.fonts.check('16px Inter')));
  check(vp, 'home shows the question', (await page.$eval('.hero', (e) => e.textContent.trim())) === 'What do you want to focus on?');
  check(vp, 'home shows the supporting line', (await text('goal-hint')) === "Start small. We'll take it from there.");
  await overflow('home'); await shot('01-home');

  await page.click('#goal-submit');
  check(vp, 'empty goal is blocked with a message', (await visible('goal-error')) && (await screen()) === 'start');

  await page.type('#goal', 'I need to study DBMS');
  await shot('02-home-typed');
  await page.click('#goal-submit'); await idle();
  check(vp, 'goal gives a first step', (await screen()) === 'ready' && (await text('ready-action')).length > 8, await text('ready-action'));
  check(vp, 'step shows time and quiet provider label', /^~\d min$/.test(await text('ready-minutes')) && (await text('ready-source')) === 'Hosted Gemma', `${await text('ready-minutes')} · ${await text('ready-source')}`);
  await overflow('first step'); await shot('03-first-step');

  const first = await text('ready-action');
  await page.click('#ready-smaller'); await idle();
  check(vp, '"Make it smaller" gives a different step', (await text('ready-action')) !== first, await text('ready-action'));

  await page.click('#start-focus');
  await page.waitForFunction(() => document.body.dataset.screen === 'focus');
  check(vp, 'focus mode hides the header', !(await page.$eval('.top', (e) => e.offsetParent)));
  check(vp, 'focus mode shows timer, task and both controls', /^\d\d:\d\d$/.test(await text('clock')) && (await visible('stuck')) && (await visible('distracted')));
  await overflow('focus'); await shot('04-focus-start');

  const before = await text('focus-action');
  await page.click('#stuck'); await idle();
  check(vp, '"I\'m stuck" gives a different step', (await text('focus-action')) !== before, await text('focus-action'));

  // Move the session 6 minutes in, then reload: tests refresh mid-timer and gives the ring something to show.
  await patchSession('s.startedAt -= 360000; s.endsAt -= 360000;');
  await page.reload({ waitUntil: 'networkidle0' });
  const clock = await text('clock');
  check(vp, 'refresh keeps the timer', (await screen()) === 'focus' && /^0[89]:\d\d$/.test(clock), clock);
  await shot('05-focus-ring');

  await page.click('#distracted');
  await page.waitForFunction(() => !document.getElementById('back').hidden, { timeout: 45000 });
  await idle();
  check(vp, 'recovery says "You\'re back." with one step', (await visible('recovery')) && (await page.$eval('#recovery .big', (e) => e.textContent)) === "You're back." && (await text('recovery-action')).length > 8, await text('recovery-action'));
  check(vp, 'recovery keeps the session timer in view', /^\d\d:\d\d$/.test(await text('recovery-clock')));
  check(vp, 'recovery has no failure wording', !/fail|lost|wasted|again\?|oops/i.test(await page.$eval('#recovery', (e) => e.textContent)));
  await overflow('recovery'); await shot('06-recovery');

  await page.reload({ waitUntil: 'networkidle0' });
  check(vp, 'refresh during recovery keeps the recovery step', (await visible('recovery')) && (await visible('back')));
  await page.click('#back');
  const s1 = await sess();
  check(vp, '"I\'m back" counts one return and marks the ring', s1.returned === 1 && s1.distracted === 1 && s1.drifts.length === 1 && s1.drifts[0].returned && (await page.$$eval('#ring-drifts circle', (c) => c.length)) === 2);
  await shot('07-focus-after-return');

  await patchSession('s.endsAt = Date.now() + 2500;');
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.body.dataset.screen === 'done', { timeout: 15000 });
  await page.waitForFunction(() => document.getElementById('done-note').textContent.length > 8, { timeout: 45000 });
  check(vp, 'timer end shows completion with a reflection', (await text('done-title')) === '15 minutes, done.' && (await text('done-returns')) === '1 of 1', await text('done-note'));
  await overflow('done'); await shot('08-done');

  await page.click('#done-progress');
  check(vp, 'progress shows streak, consistency and recovered', (await screen()) === 'progress' && (await text('progress-streak')) === '1 day' && (await text('progress-consistency')) === '100%' && (await text('progress-recovered')) === '1/1', await text('progress-message'));
  await overflow('progress'); await shot('09-progress');
  await page.click('#progress-back');
  check(vp, 'back from progress returns to completion', (await screen()) === 'done');

  await page.click('#again');
  check(vp, '"Focus again" returns home with the last goal filled in', (await screen()) === 'start' && (await page.$eval('#goal', (e) => e.value)) === 'I need to study DBMS');
  check(vp, 'home shows the streak', /1 day streak/.test(await text('home-streak')));
  await page.click('#mode-chip');
  check(vp, 'mode panel explains both modes', (await visible('mode-panel')) && /not private/.test(await text('fast-note')) && /runs locally/.test(await page.$eval('#mode-panel', (e) => e.textContent)));
  await overflow('mode panel'); await shot('10-mode-panel');
  await page.click('#mode-chip');

  // Second session: reopen after the timer ended while closed, then end one early.
  await page.click('#goal-submit'); await idle();
  await page.click('#start-focus');
  await patchSession('s.endsAt = Date.now() - 60000;');
  await page.reload({ waitUntil: 'networkidle0' });
  check(vp, 'reopening after the timer ended asks instead of deciding', (await visible('expired')) && (await screen()) === 'focus');
  await shot('11-timer-finished-while-closed');
  await page.click('#expired-discard');
  check(vp, 'discarding returns home', (await screen()) === 'start');

  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  await page.reload({ waitUntil: 'networkidle0' });
  await shot('12-home-dark');
  await page.type('#goal', 'organic chemistry reactions');
  await page.click('#goal-submit'); await idle();
  await shot('13-first-step-dark');
  await page.click('#start-focus');
  await patchSession('s.startedAt -= 240000; s.endsAt -= 240000;');
  await page.reload({ waitUntil: 'networkidle0' });
  await shot('14-focus-dark');
  await page.click('#end-early');
  check(vp, 'ending a session needs a second tap', (await screen()) === 'focus' && /Tap again/.test(await text('end-early')));
  await page.click('#end-early');
  check(vp, 'second tap ends the session', (await screen()) === 'start');
  await page.click('#open-progress');
  check(vp, 'progress counts unfinished sessions honestly', (await text('progress-consistency')) === '33%', await text('progress-consistency'));
  await shot('15-progress-dark');

  check(vp, 'no console or page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} of ${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
