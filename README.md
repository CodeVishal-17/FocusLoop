# FocusLoop

A study companion for someone who can't get started. You type what you need to study, Gemma gives you **one** tiny first step, and a focus timer keeps you with it. If you drift to your phone, one button gets you a small step back in. Coming back is counted as a win.

Loop: **Start small → Focus → Get distracted → Recover → Return.**

## Run it

Needs Node 20+ and, for local development, [Ollama](https://ollama.com).

```bash
ollama pull gemma3:1b
```

```bash
npm start
```

Open http://localhost:8787. There are no dependencies to install.

```bash
npm test
```

## Who answers

| Mode | Model | Where your text goes |
|---|---|---|
| ⚡ Fast Mode | Gemma behind the FocusLoop server (`AI_PROVIDER`) | To the server, and to whoever hosts the model. Not private. |
| 🔒 Private Mode | Gemma 3 1B in your browser (transformers.js + WebGPU) | Nowhere. The model runs on your device after a one-time download of about 760 MB. |

The app always shows which one produced each step. Fast Mode answers until Private Mode has finished loading. Once Private Mode is active, a failed on-device answer falls back to a built-in step, never to the server.

If no model gives a usable answer (down, slow, or invalid output), the app shows a built-in step and labels it as such.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8787` | Server port |
| `AI_PROVIDER` | `ollama` | `ollama`, `google` or `stub` |
| `OLLAMA_URL`, `OLLAMA_MODEL` | `http://127.0.0.1:11434`, `gemma3:1b` | Local or self-hosted Gemma |
| `GOOGLE_API_KEY`, `GOOGLE_MODEL` | none | Hosted Gemma through the Gemini API. `GOOGLE_MODEL` must be a Gemma id. **This adapter has unit tests but has not been run against the live API.** |
| `MODELS_DIR` | none | Serve Private Mode model files from this folder at `/models/` instead of Hugging Face |
| `MODEL_HOST` | none | Base URL for Private Mode model files |
| `AI_TIMEOUT_MS` | `25000` | Server-side model timeout |

## How it is built

```
public/core/   pure logic: prompts, validation, fallback steps, event log, stats, session/timer
public/ai/     provider layer: index.js (timeout, retry, fallback), remote.js (Fast), ondevice.js + worker.js (Private)
public/app.js  UI wiring
server/        static files + POST /api/ai (task name + short fields in, model text out), adapters for Ollama / Google / stub
test/          node --test: core logic, AI layer, server
scripts/       eval-prompts.js: runs every prompt over a fixed set of goals against local Gemma
```

- **Gemma writes the words of each step.** Timers, counts, streak, Recovery Score and the "is this step small enough" check are plain code.
- **The model must return JSON.** Output is parsed, cleaned and validated; a step that is empty, contains a link, or is too big ("read the first chapter") is rejected, retried once, then replaced by a built-in step.
- **History stays in the browser** (localStorage). The server stores nothing and logs no user text.

## Licences

App code: MIT, see [LICENSE](LICENSE). Gemma is provided under and subject to the Gemma Terms of Use found at https://ai.google.dev/gemma/terms. See [NOTICE](NOTICE).
