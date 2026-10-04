import test from 'node:test';
import assert from 'node:assert/strict';
import { createAI } from '../public/ai/index.js';
import { createOnDevice, checkSupport } from '../public/ai/ondevice.js';

const GOOD = '{"action": "Open your DBMS notes and read the first heading.", "minutes": 2}';
const provider = (name, fn) => { const p = { name, calls: 0, isReady: () => true, generate: (...a) => { p.calls++; return fn(...a); } }; return p; };
const fastTimeouts = { fast: 50, private: 50 };

test('returns the model answer tagged with the provider', async () => {
  const ai = createAI({ fast: provider('fast', async () => GOOD), wantsPrivate: () => false });
  assert.deepEqual(await ai.nextAction('study DBMS'), { action: 'Open your DBMS notes and read the first heading.', minutes: 2, source: 'fast' });
});

test('invalid JSON: retries once, then succeeds', async () => {
  let n = 0;
  const fast = provider('fast', async () => (n++ === 0 ? 'Here are five tips' : GOOD));
  const r = await createAI({ fast, wantsPrivate: () => false }).nextAction('study DBMS');
  assert.equal(r.source, 'fast'); assert.equal(fast.calls, 2);
});

test('invalid JSON twice: labelled fallback', async () => {
  const fast = provider('fast', async () => 'nope');
  const r = await createAI({ fast, wantsPrivate: () => false }).nextAction('study DBMS');
  assert.equal(r.source, 'fallback'); assert.equal(r.reason, 'invalid'); assert.ok(r.action.length > 8); assert.equal(fast.calls, 2);
});

test('model unavailable: fallback without a pointless retry', async () => {
  const fast = provider('fast', async () => { throw new Error('http 502'); });
  const r = await createAI({ fast, wantsPrivate: () => false }).recover('study DBMS', 'Read page 1', 0);
  assert.equal(r.source, 'fallback'); assert.equal(r.reason, 'unavailable'); assert.equal(fast.calls, 1);
});

test('slow model: times out, aborts the request, falls back', async () => {
  let aborted = false;
  const fast = provider('fast', (t, i, a, signal) => new Promise(() => { signal.addEventListener('abort', () => { aborted = true; }); }));
  const r = await createAI({ fast, wantsPrivate: () => false, timeouts: fastTimeouts }).nextAction('study DBMS');
  assert.equal(r.reason, 'timeout'); assert.equal(aborted, true);
});

test('unstick never repeats a step that was already tried', async () => {
  const tried = ['Open your DBMS notes and read the first heading.'];
  let n = 0;
  const fast = provider('fast', async () => (n++ === 0 ? GOOD : '{"action": "Write the first DBMS topic name on paper.", "minutes": 1}'));
  const r = await createAI({ fast, wantsPrivate: () => false }).unstick('study DBMS', tried, 0);
  assert.equal(r.action, 'Write the first DBMS topic name on paper.');
  const stubborn = provider('fast', async () => GOOD);
  const f = await createAI({ fast: stubborn, wantsPrivate: () => false }).unstick('study DBMS', tried, 0);
  assert.equal(f.source, 'fallback'); assert.equal(f.reason, 'repeat');
});

test('reflect returns a note or a factual fallback', async () => {
  const ok = createAI({ fast: provider('fast', async () => '{"note": "You studied DBMS for 15 minutes."}'), wantsPrivate: () => false });
  assert.equal((await ok.reflect('DBMS', { minutes: 15 })).note, 'You studied DBMS for 15 minutes.');
  const down = createAI({ fast: provider('fast', async () => { throw new Error('x'); }), wantsPrivate: () => false });
  assert.equal((await down.reflect('DBMS', { minutes: 15, returned: 1 })).source, 'fallback');
});

test('provider switching: Private answers only when ready, and never leaks to the server after that', async () => {
  let ready = false, wants = true;
  const fast = provider('fast', async () => GOOD);
  const onDevice = provider('private', async () => { throw new Error('gpu lost'); });
  onDevice.isReady = () => ready;
  const ai = createAI({ fast, onDevice, wantsPrivate: () => wants });
  assert.equal(ai.activeProvider(), 'fast', 'model not ready yet: Fast Mode answers');
  assert.equal((await ai.nextAction('x goal')).source, 'fast');
  ready = true;
  assert.equal(ai.activeProvider(), 'private');
  const r = await ai.nextAction('x goal');
  assert.equal(r.source, 'fallback', 'on-device failure must not send text to the server');
  assert.equal(fast.calls, 1);
  wants = false;
  assert.equal(ai.activeProvider(), 'fast');
});

// --- on-device provider, with a fake worker ---
function fakeWorker() {
  const w = { posted: [], terminated: false, postMessage(m) { w.posted.push(m); }, terminate() { w.terminated = true; }, emit(data) { w.onmessage({ data }); } };
  return w;
}

test('checkSupport explains why Private Mode is unavailable', async () => {
  assert.equal((await checkSupport({})).ok, false);
  assert.equal((await checkSupport({ gpu: { requestAdapter: async () => null } })).ok, false);
  assert.equal((await checkSupport({ gpu: { requestAdapter: async () => ({ features: new Set() }) } })).ok, false);
  assert.equal((await checkSupport({ gpu: { requestAdapter: async () => ({ features: new Set(['shader-f16']) }) } })).ok, true);
  assert.equal((await checkSupport({ gpu: { requestAdapter: async () => { throw new Error('x'); } } })).ok, false);
});

test('on-device: download progress, warm-up, ready, generate', async () => {
  const w = fakeWorker(); const seen = [];
  const od = createOnDevice({ createWorker: () => w, onStatus: (s) => seen.push(s.state), modelHost: '/models/' });
  od.start();
  assert.deepEqual(w.posted[0], { type: 'load', modelHost: '/models/' });
  w.emit({ type: 'progress', loaded: 50, total: 100 });
  assert.equal(od.status().loaded, 50); assert.equal(od.isReady(), false);
  await assert.rejects(od.generate('nextAction', { goal: 'x' }, 0), /unavailable/);
  w.emit({ type: 'progress', loaded: 100, total: 100 });
  w.emit({ type: 'warming' }); w.emit({ type: 'ready' });
  assert.equal(od.isReady(), true);
  const p = od.generate('nextAction', { goal: 'study DBMS' }, 0);
  const req = w.posted.at(-1);
  assert.equal(req.type, 'generate'); assert.equal(req.messages[0].role, 'system');
  w.emit({ type: 'result', id: req.id, text: GOOD });
  assert.equal(await p, GOOD);
  assert.ok(seen.includes('downloading') && seen.includes('warming') && seen.at(-1) === 'ready');
  od.stop();
  assert.equal(w.terminated, true); assert.equal(od.status().state, 'off');
});

test('on-device: stalled download ends in a clear error and frees the worker', async () => {
  const w = fakeWorker();
  const od = createOnDevice({ createWorker: () => w, stallMs: 30 });
  od.start();
  w.emit({ type: 'progress', loaded: 10, total: 100 });
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(od.status().state, 'error');
  assert.match(od.status().error, /stopped making progress/);
  assert.equal(w.terminated, true);
});

test('on-device: load error and worker crash are reported, pending requests rejected', async () => {
  const w = fakeWorker();
  const od = createOnDevice({ createWorker: () => w });
  od.start(); w.emit({ type: 'error', message: 'Failed to fetch' });
  assert.equal(od.status().state, 'error');

  const w2 = fakeWorker();
  const od2 = createOnDevice({ createWorker: () => w2 });
  od2.start(); w2.emit({ type: 'ready' });
  const p = od2.generate('nextAction', { goal: 'x' }, 0);
  w2.onerror(new Error('crash'));
  await assert.rejects(p, /unavailable/);
  assert.equal(od2.isReady(), false);

  const od3 = createOnDevice({ createWorker: () => { throw new Error('no workers'); } });
  od3.start();
  assert.equal(od3.status().state, 'error');
});
