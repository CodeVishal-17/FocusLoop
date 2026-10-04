// Private Mode provider: owns the worker, reports download and warm-up
// progress, and gives up cleanly when the download stalls or the load fails.
import { buildMessages, temperatureFor } from '../core/prompts.js';

const STALL_MS = 30000;
const WARMUP_LIMIT_MS = 6 * 60000;

export async function checkSupport(nav = globalThis.navigator) {
  if (!nav?.gpu) return { ok: false, reason: 'This browser does not support WebGPU, which Private Mode needs.' };
  try {
    const adapter = await nav.gpu.requestAdapter();
    if (!adapter) return { ok: false, reason: 'No graphics adapter is available for WebGPU on this device.' };
    if (!adapter.features.has('shader-f16')) return { ok: false, reason: "This device's graphics do not support the 16-bit maths the model needs." };
    return { ok: true };
  } catch { return { ok: false, reason: 'WebGPU could not be started on this device.' }; }
}

export function createOnDevice({ modelHost = null, onStatus = () => {}, createWorker = () => new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }), stallMs = STALL_MS } = {}) {
  let worker = null, watchdog = null, nextId = 1;
  const pending = new Map();
  let status = { state: 'off', loaded: 0, total: 0, error: null };

  function set(patch) { status = { ...status, ...patch }; onStatus(status); }
  function arm(ms, message) { clearTimeout(watchdog); watchdog = setTimeout(() => fail(message), ms); }

  function fail(message) {
    clearTimeout(watchdog);
    worker?.terminate(); worker = null;
    for (const { reject } of pending.values()) reject(new Error('unavailable'));
    pending.clear();
    set({ state: 'error', error: message });
  }

  function start() {
    if (worker || status.state === 'ready') return;
    set({ state: 'downloading', loaded: 0, total: 0, error: null });
    try { worker = createWorker(); } catch { return fail('The on-device model could not be started in this browser.'); }
    worker.onerror = () => fail('The on-device model could not be loaded.');
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') {
        set({ loaded: data.loaded, total: data.total });
        if (data.loaded < data.total) arm(stallMs, 'The model download stopped making progress. Check your connection and try again.');
        else arm(WARMUP_LIMIT_MS, 'The model took too long to start on this device.');
      } else if (data.type === 'warming') { arm(WARMUP_LIMIT_MS, 'The model took too long to start on this device.'); set({ state: 'warming' }); }
      else if (data.type === 'ready') { clearTimeout(watchdog); set({ state: 'ready' }); }
      else if (data.type === 'error') fail('The on-device model could not be loaded.');
      else if (data.type === 'result') {
        const p = pending.get(data.id); pending.delete(data.id);
        if (p) data.error ? p.reject(new Error(data.error)) : p.resolve(data.text);
      }
    };
    arm(stallMs, 'The model download did not start. Check your connection and try again.');
    worker.postMessage({ type: 'load', modelHost });
  }

  function stop() {
    clearTimeout(watchdog);
    worker?.terminate(); worker = null;
    for (const { reject } of pending.values()) reject(new Error('unavailable'));
    pending.clear();
    set({ state: 'off', loaded: 0, total: 0, error: null });
  }

  return {
    name: 'private',
    start, stop,
    status: () => status,
    isReady: () => status.state === 'ready',
    generate(task, input, attempt) {
      if (status.state !== 'ready') return Promise.reject(new Error('unavailable'));
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker.postMessage({ type: 'generate', id, messages: buildMessages(task, input), temperature: temperatureFor(task, attempt) });
      });
    },
  };
}
