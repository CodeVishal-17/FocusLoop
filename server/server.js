// FocusLoop server: static files plus one AI endpoint. No dependencies.
// It accepts a task name and a few short fields, never raw prompts, so it
// cannot be used as a general-purpose model proxy. It stores nothing.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMessages, schemaFor, temperatureFor, TASKS } from '../public/core/prompts.js';
import { cleanGoal } from '../public/core/validate.js';
import { createOllamaAdapter } from './adapters/ollama.js';
import { createGoogleAdapter } from './adapters/google.js';
import { createStubAdapter } from './adapters/stub.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.onnx': 'application/octet-stream', '.onnx_data': 'application/octet-stream', '.webmanifest': 'application/manifest+json' };
const MAX_BODY = 4096;

export function adapterFromEnv(env = process.env) {
  const kind = env.AI_PROVIDER || 'ollama';
  if (kind === 'ollama') return createOllamaAdapter({ url: env.OLLAMA_URL, model: env.OLLAMA_MODEL });
  if (kind === 'google') return createGoogleAdapter({ apiKey: env.GOOGLE_API_KEY, model: env.GOOGLE_MODEL });
  if (kind === 'stub') return createStubAdapter({ mode: env.STUB_MODE, delayMs: Number(env.STUB_DELAY_MS) || undefined });
  throw new Error(`unknown AI_PROVIDER: ${kind}`);
}

function send(res, status, body, headers = {}) {
  const data = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      // Answer 413 and keep draining a little so the client can read the reply;
      // cut the connection only if it keeps sending.
      if (size > MAX_BODY) { reject(Object.assign(new Error('too large'), { status: 413 })); if (size > 256 * 1024) req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function serveFile(res, baseDir, relPath, cache) {
  const file = path.normalize(path.join(baseDir, relPath));
  if (!file.startsWith(path.normalize(baseDir + path.sep))) return send(res, 403, { error: 'forbidden' });
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, { error: 'not found' });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': cache });
    fs.createReadStream(file).pipe(res);
  });
}

export function createServer({ adapter, timeoutMs = 25000, ratePerMin = 40, modelsDir = null, modelHost = null, trustProxy = false } = {}) {
  const hits = new Map();
  function limited(ip) {
    const now = Date.now();
    const list = (hits.get(ip) || []).filter((t) => t > now - 60000);
    list.push(now); hits.set(ip, list);
    if (hits.size > 5000) hits.clear();
    return list.length > ratePerMin;
  }

  async function handleAI(req, res) {
    // Behind a host's proxy every request arrives from the proxy, so the real
    // client is the first X-Forwarded-For entry.
    const ip = (trustProxy && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress;
    if (limited(ip)) return send(res, 429, { error: 'rate_limited' });
    let body;
    try { body = JSON.parse(await readBody(req)); } catch (e) { return send(res, e.status || 400, { error: 'bad_request' }); }
    const task = body?.task; const input = body?.input || {};
    if (!TASKS.includes(task) || !cleanGoal(input.goal)) return send(res, 400, { error: 'bad_request' });
    const attempt = Number(body.attempt) ? 1 : 0;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const text = await adapter.generate({ messages: buildMessages(task, input), schema: schemaFor(task), temperature: temperatureFor(task, attempt), signal: ctl.signal });
      send(res, 200, { text: String(text ?? '').slice(0, 2000), provider: adapter.name, model: adapter.model });
    } catch (e) {
      // Log the failure, never the user's text.
      console.error(`[ai] ${task} failed: ${ctl.signal.aborted ? 'timeout' : e.message}`);
      send(res, ctl.signal.aborted ? 504 : 502, { error: ctl.signal.aborted ? 'timeout' : 'model_unavailable' });
    } finally { clearTimeout(timer); }
  }

  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/api/ai') return req.method === 'POST' ? handleAI(req, res) : send(res, 405, { error: 'method_not_allowed' });
    if (url.pathname === '/api/config') return send(res, 200, { provider: adapter.name, model: adapter.model, dataNote: adapter.dataNote, modelHost: modelHost || (modelsDir ? '/models/' : null) });
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'method_not_allowed' });
    let rel;
    try { rel = decodeURIComponent(url.pathname); } catch { return send(res, 400, { error: 'bad_request' }); }
    if (modelsDir && rel.startsWith('/models/')) return serveFile(res, modelsDir, rel.slice('/models/'.length), 'public, max-age=31536000, immutable');
    serveFile(res, PUBLIC, rel === '/' ? 'index.html' : rel, 'no-cache');
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const adapter = adapterFromEnv();
  const port = Number(process.env.PORT) || 8787;
  createServer({ adapter, timeoutMs: Number(process.env.AI_TIMEOUT_MS) || 25000, modelsDir: process.env.MODELS_DIR || null, modelHost: process.env.MODEL_HOST || null, trustProxy: process.env.TRUST_PROXY === '1' })
    .listen(port, () => console.log(`FocusLoop on http://localhost:${port} (provider: ${adapter.name}, model: ${adapter.model})`));
}
