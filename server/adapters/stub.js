// Test adapter. STUB_MODE: ok | junk | slow | down | flaky (junk first, then ok)
export function createStubAdapter({ mode = 'ok', delayMs = 60000 } = {}) {
  let calls = 0;
  const ok = (schema) => (schema?.properties?.note
    ? '{"note": "You studied for the full session."}'
    : `{"action": "Open your notes and read the first heading (stub ${calls}).", "minutes": 2}`);
  return {
    name: 'stub',
    model: `stub-${mode}`,
    dataNote: 'Test adapter. No model is running.',
    get calls() { return calls; },
    async generate({ schema, signal }) {
      calls++;
      if (mode === 'down') throw new Error('connect ECONNREFUSED');
      if (mode === 'junk' || (mode === 'flaky' && calls === 1)) return 'Sure! Here are 5 tips to study better:\n1. Take a deep breath';
      if (mode === 'slow') {
        await new Promise((resolve, reject) => {
          const t = setTimeout(resolve, delayMs);
          signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted')); });
        });
      }
      return ok(schema);
    },
  };
}
