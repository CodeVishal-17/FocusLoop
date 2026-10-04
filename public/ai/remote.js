// Fast Mode: hosted Gemma behind the FocusLoop server. The server builds the
// prompt; the browser sends only the task name and the short fields it needs.
export function createFastProvider({ endpoint = '/api/ai', fetchImpl = (...a) => fetch(...a) } = {}) {
  return {
    name: 'fast',
    async generate(task, input, attempt, signal) {
      const res = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task, input, attempt }),
        signal,
      });
      if (!res.ok) throw new Error(res.status === 504 ? 'timeout' : `http ${res.status}`);
      return (await res.json()).text;
    },
  };
}
