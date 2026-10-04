// Private Mode worker: Gemma 3 1B running on this device through WebGPU.
// Runs in a worker because loading the model blocks its thread for over a minute.
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0';

const MODEL = 'onnx-community/gemma-3-1b-it-ONNX';
let generator = null;

async function load(modelHost) {
  env.allowLocalModels = false;
  if (modelHost) { env.remoteHost = modelHost; env.remotePathTemplate = '{model}/'; }
  const files = new Map();
  generator = await pipeline('text-generation', MODEL, {
    dtype: 'q4f16',
    device: 'webgpu',
    progress_callback: (p) => {
      if (p.status !== 'progress' || !p.total) return;
      files.set(p.file, [p.loaded, p.total]);
      let loaded = 0, total = 0;
      for (const [l, t] of files.values()) { loaded += l; total += t; }
      self.postMessage({ type: 'progress', loaded, total });
    },
  });
  // The first generation compiles the GPU shaders and takes far longer than
  // the rest, so pay for it here instead of on the user's first request.
  self.postMessage({ type: 'warming' });
  await generator([{ role: 'user', content: 'Reply with OK.' }], { max_new_tokens: 4, do_sample: false });
  self.postMessage({ type: 'ready' });
}

self.onmessage = async ({ data }) => {
  if (data.type === 'load') {
    try { await load(data.modelHost); } catch (e) { self.postMessage({ type: 'error', message: String(e?.message || e) }); }
  } else if (data.type === 'generate') {
    try {
      const sample = data.temperature > 0.3;
      const out = await generator(data.messages, { max_new_tokens: 72, do_sample: sample, ...(sample ? { temperature: data.temperature, top_p: 0.9 } : {}) });
      self.postMessage({ type: 'result', id: data.id, text: out[0].generated_text.at(-1).content });
    } catch (e) {
      self.postMessage({ type: 'result', id: data.id, error: String(e?.message || e) });
    }
  }
};
