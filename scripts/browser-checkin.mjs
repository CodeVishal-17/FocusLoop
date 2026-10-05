// Check-in flow in a real browser. Needs puppeteer-core and a FocusLoop server.
// Usage: node browser-checkin.mjs <baseUrl> <outDir>
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const [base, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

const text = (id) => page.$eval(`#${id}`, (e) => e.textContent.trim());
const visible = (id) => page.$eval(`#${id}`, (e) => !!(e.offsetParent || e.getClientRects().length));
const idle = () => page.waitForFunction(() => document.getElementById('busy').hidden && ![...document.querySelectorAll('main button')].some((b) => b.disabled), { timeout: 45000 });
const sess = () => page.evaluate(() => JSON.parse(localStorage['focusloop.session.v1'] || 'null'));
const events = () => page.evaluate(() => JSON.parse(localStorage['focusloop.events.v1'] || '[]'));
const patch = (src) => page.evaluate((code) => { const s = JSON.parse(localStorage['focusloop.session.v1']); new Function('s', code)(s); localStorage['focusloop.session.v1'] = JSON.stringify(s); }, src);
const shot = async (name) => { await new Promise((r) => setTimeout(r, 450)); await page.screenshot({ path: path.join(outDir, `${name}.png`) }); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await page.goto(base, { waitUntil: 'networkidle0' });
await page.type('#goal', 'I need to study DBMS');
await page.click('#goal-submit'); await idle();
await page.click('#start-focus');
await wait(1500);
check('no check-in right after starting', !(await visible('checkin')) && (await visible('stuck')));

// Five and a half quiet minutes pass (the page's clock is moved forward; nothing is touched).
const skip = (ms) => page.evaluate((d) => { window.__skew = (window.__skew || 0) + d; if (!window.__realNow) { window.__realNow = Date.now.bind(Date); Date.now = () => window.__realNow() + window.__skew; } }, ms);
await skip(330000);
await page.waitForFunction(() => !document.getElementById('checkin').hidden, { timeout: 5000 });
check('after a quiet stretch it asks "Are you still studying?"', (await page.$eval('#checkin .big', (e) => e.textContent)) === 'Are you still studying?', await text('checkin-line'));
check('the question says only what FocusLoop knows', /haven't touched FocusLoop for \d+ minutes/.test(await text('checkin-line')) && /can't see/.test(await text('checkin-line')));
check('two choices: "I\'m back" and "I got distracted"', (await text('checkin-back')) === "I'm back" && (await text('checkin-distracted')) === 'I got distracted');
check('the timer keeps running and stays visible', /^\d\d:\d\d$/.test(await text('checkin-clock')));
check('the tab title carries the question', (await page.title()) === 'Still studying? · FocusLoop', await page.title());
await shot('checkin-01-quiet');

await page.click('#checkin-back');
await wait(1200);
const e1 = await events();
check('"I\'m back" resumes the session and is logged', (await visible('stuck')) && !(await visible('checkin')) && e1.at(-1).type === 'checkin' && e1.at(-1).answer === 'back');
check('it does not ask again straight away', !(await visible('checkin')));
check('"I\'m back" is not counted as a distraction', (await sess()).distracted === 0);

// Leave the tab for two minutes (visibility and clock are simulated; the handler is the real one).
await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
check('leaving the tab is noted without rewriting the session', Number(await page.evaluate(() => localStorage['focusloop.hiddenSince'])) > 0);
await skip(120000);
await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
await wait(600);
check('coming back to the tab asks, with the time away', (await visible('checkin')) && /in the background for 2 minutes/.test(await text('checkin-line')), await text('checkin-line'));
await shot('checkin-02-away');

await page.click('#checkin-distracted');
await page.waitForFunction(() => !document.getElementById('back').hidden, { timeout: 45000 });
check('"I got distracted" goes to the existing recovery step', (await page.$eval('#recovery .big', (e) => e.textContent)) === "You're back." && (await text('recovery-action')).length > 8, await text('recovery-action'));
await shot('checkin-03-recovery');
await page.click('#back');
const s2 = await sess();
check('recovery from a check-in counts as one distraction and one return', s2.distracted === 1 && s2.returned === 1 && s2.drifts.length === 1 && s2.drifts[0].returned);

// A check-in still unanswered when the timer ends: the session is not counted automatically.
await skip(330000);
await page.waitForFunction(() => !document.getElementById('checkin').hidden, { timeout: 5000 });
await page.reload({ waitUntil: 'networkidle0' });
check('a pending check-in survives a refresh', await visible('checkin'));
await patch('s.endsAt = Date.now() + 2500;');
await page.reload({ waitUntil: 'networkidle0' });
await page.waitForFunction(() => !document.getElementById('expired').hidden, { timeout: 8000 });
check('timer ending on an unanswered check-in asks instead of counting', (await page.evaluate(() => document.body.dataset.screen)) === 'focus' && /hadn't answered the last check-in/.test(await text('expired-sub')), await text('expired-sub'));
await shot('checkin-04-unanswered-at-end');
await page.click('#expired-count');
await page.waitForFunction(() => document.body.dataset.screen === 'done', { timeout: 8000 });
check('"Yes, count it" completes the session', (await text('done-title')) === '15 minutes, done.');
const all = await events();
check('event log: three check-ins (back, distracted, none)', JSON.stringify(all.filter((e) => e.type === 'checkin').map((e) => e.answer)) === '["back","distracted","none"]', all.map((e) => e.type).join(','));
check('no page errors', errors.length === 0, errors.join(' | '));

await browser.close();
console.log(`\n${results.filter(Boolean).length} of ${results.length} checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
