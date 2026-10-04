import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, adapterFromEnv } from '../server/server.js';
import { createStubAdapter } from '../server/adapters/stub.js';
import { createGoogleAdapter } from '../server/adapters/google.js';
import { createFastProvider } from '../public/ai/remote.js';
import { createAI } from '../public/ai/index.js';

async function withServer(opts, fn) {
  const server = createServer(opts);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base); } finally { server.closeAllConnections(); await new Promise((r) => server.close(r)); }
}
const post = (base, body) => fetch(`${base}/api/ai`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });

test('serves the app and config', async () => {
  await withServer({ adapter: createStubAdapter() }, async (base) => {
    const home = await fetch(base + '/');
    assert.equal(home.status, 200); assert.match(home.headers.get('content-type'), /text\/html/);
    assert.equal((await fetch(base + '/core/stats.js')).status, 200);
    assert.equal((await fetch(base + '/nope.js')).status, 404);
    const cfg = await (await fetch(base + '/api/config')).json();
    assert.equal(cfg.provider, 'stub'); assert.ok(cfg.dataNote);
  });
});

test('blocks path traversal', async () => {
  await withServer({ adapter: createStubAdapter() }, async (base) => {
    for (const p of ['/..%2f..%2fpackage.json', '/%2e%2e/server/server.js', '/core/..%5c..%5cpackage.json']) {
      const r = await fetch(base + p);
      assert.ok([403, 404].includes(r.status), `${p} -> ${r.status}`);
    }
  });
});

test('valid request returns model text', async () => {
  await withServer({ adapter: createStubAdapter() }, async (base) => {
    const r = await post(base, { task: 'nextAction', input: { goal: 'study DBMS' } });
    assert.equal(r.status, 200);
    assert.match((await r.json()).text, /"action"/);
  });
});

test('rejects empty goal, unknown task, bad JSON, oversized body, wrong method', async () => {
  await withServer({ adapter: createStubAdapter() }, async (base) => {
    assert.equal((await post(base, { task: 'nextAction', input: { goal: '   ' } })).status, 400);
    assert.equal((await post(base, { task: 'chat', input: { goal: 'x' } })).status, 400);
    assert.equal((await post(base, '{nope')).status, 400);
    assert.equal((await post(base, 'null')).status, 400);
    assert.equal((await post(base, { task: 'nextAction', input: { goal: 'x'.repeat(10000) } })).status, 413);
    assert.equal((await fetch(base + '/api/ai')).status, 405);
  });
});

test('model down -> 502, slow model -> 504', async () => {
  await withServer({ adapter: createStubAdapter({ mode: 'down' }) }, async (base) => {
    assert.equal((await post(base, { task: 'nextAction', input: { goal: 'x goal' } })).status, 502);
  });
  await withServer({ adapter: createStubAdapter({ mode: 'slow', delayMs: 5000 }), timeoutMs: 80 }, async (base) => {
    assert.equal((await post(base, { task: 'nextAction', input: { goal: 'x goal' } })).status, 504);
  });
});

test('rate limit', async () => {
  await withServer({ adapter: createStubAdapter(), ratePerMin: 3 }, async (base) => {
    const codes = [];
    for (let i = 0; i < 5; i++) codes.push((await post(base, { task: 'nextAction', input: { goal: 'x goal' } })).status);
    assert.deepEqual(codes, [200, 200, 200, 429, 429]);
  });
});

test('end to end through the browser-side AI layer: ok, junk, flaky, down, slow', async () => {
  const run = async (mode, extra = {}) => {
    let out;
    await withServer({ adapter: createStubAdapter({ mode, delayMs: 5000 }), ...extra }, async (base) => {
      const ai = createAI({ fast: createFastProvider({ endpoint: base + '/api/ai' }), wantsPrivate: () => false, timeouts: { fast: 400 } });
      out = await ai.nextAction('I need to study DBMS');
    });
    return out;
  };
  assert.equal((await run('ok')).source, 'fast');
  assert.deepEqual([(await run('junk')).source, (await run('junk')).reason], ['fallback', 'invalid']);
  assert.equal((await run('flaky')).source, 'fast');
  assert.equal((await run('down')).reason, 'unavailable');
  assert.equal((await run('slow')).reason, 'timeout');
  assert.equal((await run('slow', { timeoutMs: 80 })).reason, 'timeout');
});

test('adapter config is validated', () => {
  assert.throws(() => adapterFromEnv({ AI_PROVIDER: 'nope' }));
  assert.throws(() => createGoogleAdapter({ model: 'gemma-x' }), /GOOGLE_API_KEY/);
  assert.throws(() => createGoogleAdapter({ apiKey: 'k', model: 'gemini-pro' }), /Gemma/);
  assert.equal(adapterFromEnv({}).name, 'ollama');
});

test('google adapter builds a Gemma request and reads the reply', async () => {
  const realFetch = globalThis.fetch; let seen;
  globalThis.fetch = async (url, init) => { seen = { url, init, body: JSON.parse(init.body) }; return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"action": "x"}' }] } }] })); };
  try {
    const a = createGoogleAdapter({ apiKey: 'test-key', model: 'gemma-test-it' });
    const text = await a.generate({ messages: [{ role: 'system', content: 'SYS' }, { role: 'user', content: 'u1' }, { role: 'assistant', content: 'a1' }, { role: 'user', content: 'u2' }], temperature: 0.2 });
    assert.equal(text, '{"action": "x"}');
    assert.match(seen.url, /models\/gemma-test-it:generateContent$/);
    assert.ok(!seen.url.includes('test-key'), 'key goes in a header, not the URL');
    assert.deepEqual(seen.body.contents.map((c) => c.role), ['user', 'model', 'user']);
    assert.equal(seen.body.systemInstruction.parts[0].text, 'SYS');
    assert.equal(seen.body.contents[0].parts[0].text, 'u1');
    assert.equal(seen.body.generationConfig.thinkingConfig.thinkingLevel, 'minimal');
    assert.equal(seen.init.headers['x-goog-api-key'], 'test-key');
    const msgs = [{ role: 'system', content: 'S' }, { role: 'user', content: 'u' }];
    globalThis.fetch = async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'thinking...', thought: true }, { text: '{"action": "y"}' }] } }] }));
    assert.equal(await a.generate({ messages: msgs }), '{"action": "y"}', 'thought parts are dropped');
    globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: 'model is not found' } }), { status: 404 });
    await assert.rejects(a.generate({ messages: msgs }), /google 404: model is not found/);
  } finally { globalThis.fetch = realFetch; }
});

test('rate limit uses the forwarded client address only when told to trust the proxy', async () => {
  const hit = (base, ip) => fetch(`${base}/api/ai`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip }, body: JSON.stringify({ task: 'nextAction', input: { goal: 'x goal' } }) }).then((r) => r.status);
  await withServer({ adapter: createStubAdapter(), ratePerMin: 1, trustProxy: true }, async (base) => {
    assert.deepEqual([await hit(base, '1.1.1.1'), await hit(base, '1.1.1.1'), await hit(base, '2.2.2.2')], [200, 429, 200]);
  });
  await withServer({ adapter: createStubAdapter(), ratePerMin: 1 }, async (base) => {
    assert.deepEqual([await hit(base, '1.1.1.1'), await hit(base, '2.2.2.2')], [200, 429]);
  });
});
