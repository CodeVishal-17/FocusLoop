// Hosted Gemma through Google's Gemini API (generateContent).
// Request shape follows https://ai.google.dev/gemma/docs/core/gemma_on_gemini_api
// (page last updated 2026-07-02): systemInstruction is supported and thinking
// is turned down with thinkingConfig.thinkingLevel = "minimal".
// The model id is configuration, not an assumption: set GOOGLE_MODEL to a Gemma
// id listed on that page.
export function createGoogleAdapter({ apiKey, model, base = 'https://generativelanguage.googleapis.com/v1beta' } = {}) {
  if (!apiKey) throw new Error('GOOGLE_API_KEY is required for AI_PROVIDER=google');
  if (!model || !/^gemma-/.test(model)) throw new Error('GOOGLE_MODEL must be a Gemma model id (starts with "gemma-")');
  return {
    name: 'google',
    model,
    dataNote: "Your text is sent to the FocusLoop server and on to Google's hosted Gemma. Google may use it to improve its products, so don't type anything private.",
    async generate({ messages, temperature, signal }) {
      const [system, ...turns] = messages;
      const res = await fetch(`${base}/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system.content }] },
          contents: turns.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
          generationConfig: { temperature, maxOutputTokens: 256, thinkingConfig: { thinkingLevel: 'minimal' } },
        }),
        signal,
      });
      if (!res.ok) {
        // Google's error message says what is wrong (bad model id, quota) and does not contain the user's text.
        const detail = await res.json().then((d) => d?.error?.message, () => null);
        throw new Error(`google ${res.status}${detail ? `: ${String(detail).slice(0, 200)}` : ''}`);
      }
      const data = await res.json();
      return (data?.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('');
    },
  };
}
