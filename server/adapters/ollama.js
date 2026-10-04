// Gemma through a local or self-hosted Ollama. Used for development and for
// anyone who wants to run the whole stack themselves.
export function createOllamaAdapter({ url = 'http://127.0.0.1:11434', model = 'gemma3:1b' } = {}) {
  return {
    name: 'ollama',
    model,
    dataNote: 'Your text is sent to the FocusLoop server, which runs Gemma itself. It is not stored.',
    async generate({ messages, schema, temperature, signal }) {
      const res = await fetch(`${url}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, stream: false, format: schema, keep_alive: '30m', options: { temperature, num_predict: 96 } }),
        signal,
      });
      if (!res.ok) throw new Error(`ollama ${res.status}`);
      const data = await res.json();
      return data?.message?.content ?? '';
    },
  };
}
