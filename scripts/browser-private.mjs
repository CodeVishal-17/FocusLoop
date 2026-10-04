// Private Mode evidence: turn it on, wait until the on-device model is ready,
// ask for a step, and record that no /api/ai request was made.
// Usage: node private.mjs <baseUrl> <outDir> [headful]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const [base, outDir, mode] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: mode === 'headful' ? false : 'new',
  protocolTimeout: 900000,
  args: ['--enable-unsafe-webgpu', '--enable-features=WebGPU', '--ignore-gpu-blocklist', '--window-size=420,900'],
});
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
const aiRequests = [];
page.on('request', (r) => { if (r.url().includes('/api/ai')) aiRequests.push(r.url()); });
const shot = async (name) => { await new Promise((r) => setTimeout(r, 500)); await page.screenshot({ path: path.join(outDir, `${name}.png`) }); };
const text = (id) => page.$eval(`#${id}`, (e) => e.textContent.trim());

await page.goto(base, { waitUntil: 'networkidle0' });
const gpu = await page.evaluate(async () => { if (!navigator.gpu) return 'no navigator.gpu'; const a = await navigator.gpu.requestAdapter(); return a ? `adapter ok, shader-f16=${a.features.has('shader-f16')}` : 'no adapter'; });
console.log('webgpu:', gpu);
await page.click('#mode-chip');
console.log('toggle:', await text('private-toggle'), '| status:', await text('private-status'));
if (await page.$eval('#private-toggle', (b) => b.disabled)) { console.log('Private Mode unavailable in this browser'); await browser.close(); process.exit(2); }
await page.click('#private-toggle');
const t0 = Date.now();
await page.waitForFunction(() => /Downloading the model: \d+/.test(document.getElementById('private-status').textContent), { timeout: 60000 });
await shot('private-01-downloading');
console.log('downloading:', await text('private-status'));
await page.waitForFunction(() => document.getElementById('mode-chip').textContent === 'Private Mode', { timeout: 600000, polling: 1000 });
console.log(`ready after ${Math.round((Date.now() - t0) / 1000)} s:`, await text('private-status'));
await shot('private-02-active');
await page.click('#mode-chip');

await page.type('#goal', 'I need to study DBMS');
const t1 = Date.now();
await page.click('#goal-submit');
await page.waitForFunction(() => document.body.dataset.screen === 'ready', { timeout: 120000 });
console.log(`answer after ${Date.now() - t1} ms:`, await text('ready-action'), '|', await text('ready-minutes'), '|', await text('ready-source'));
await shot('private-03-gemma-on-this-device');
console.log('requests to /api/ai while in Private Mode:', aiRequests.length);
await browser.close();
