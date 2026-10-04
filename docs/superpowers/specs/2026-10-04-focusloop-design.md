# FocusLoop: technical spec (MVP)

Date: 2026-10-04. Deadline: 2026-10-05 12:29 IST.

## Goal

A non-technical friend opens a link, types a vague study goal, gets ONE tiny first action from Gemma, runs a focus session, recovers after a distraction, and has the session recorded. He installs nothing.

Loop: Start small → Focus → Get distracted → Recover → Return.

## Spike result that shapes this design

Tested on this machine (Ryzen 5 5500U, integrated Radeon, 8 GB RAM, Chromium 152), Gemma 3 1B, same prompt and six goals.

| | In-browser (transformers.js 4.3, WebGPU, q4f16) | Ollama `gemma3:1b` (CPU) |
|---|---|---|
| Download | 763 MB | 815 MB |
| Model load | 89 s and 100 s (two runs) | 11 s |
| First answer after load | 46 s and 48 s (shader warm-up) | 5 s |
| Later answers | 5 to 8 s (one 21 s outlier) | 5 s |
| Valid JSON | 6/6 | 6/6 (schema-enforced) |

Other findings:
- Gemma 3 270M (273 MB) loads in 8 to 11 s and answers in 2 to 6 s, but gave 3/6 valid answers and invented a URL. Rejected.
- The first in-browser download from Hugging Face stalled at 167 MB of 763 MB with no error.
- Model loading blocks the page's main thread unless it runs in a Web Worker.
- A missing model fails in under 6 s with a catchable error.
- Answer quality of 1B is usable only with a strict prompt and chat-turn few-shot examples. The first prompt produced "Take a deep breath..." six times.

Conclusion: on-device Gemma works but takes about 2.5 minutes from page open to first answer on this hardware. It cannot be the only provider for a tool whose job is to get someone started in under a minute.

## Architecture

Static web app (vanilla JS ES modules, no build step) plus one small Node server (no dependencies).

```
browser
  ui/            screens: Start, Focus, Done, Progress
  core/          pure logic, unit-tested with `node --test`
    session.js     state machine: idle → ready → focusing → done
    events.js      append-only event log in localStorage
    stats.js       streak, Recovery Score, focus consistency (derived from the log)
    prompts.js     system prompt + few-shot turns for each AI task
    validate.js    parse and validate model JSON, sanitise text
    fallback.js    built-in actions used when no model answers
  ai/
    index.js       ai.nextAction / unstick / recover / reflect; picks provider, timeout, one retry, fallback
    remote.js      POST /api/ai
    ondevice.js    Web Worker running Gemma 3 1B via transformers.js + WebGPU
server
  server.js      serves static files; POST /api/ai → adapter chosen by env
  adapters/ollama.js   local development and self-hosting
  adapters/google.js   hosted Gemma through the Gemini API (key stays on the server)
```

### Provider behaviour ("private mode")

1. On page open the remote provider answers, so he is never waiting on a model load.
2. If WebGPU with `shader-f16` is present and he turns on **Private mode**, the worker downloads and warms Gemma 3 1B in the background, with a progress bar.
3. Once warm, all AI calls go on-device and the UI shows "On-device: nothing leaves this device". The choice is remembered.
4. If the download stalls (no progress for 30 s) or load fails, the app stays on remote and says so.

The UI always states which provider is answering. The remote server logs nothing about request content.

### AI contract

Every task returns JSON: `{"action": string ≤ 140 chars, "minutes": 1..5}` (reflect returns `{"note": string}`).
`ai/index.js` guarantees a result: timeout 20 s remote / 60 s on-device → one retry → `fallback.js`. A fallback result is marked `source: "fallback"` and shown as such.

Inputs: goal trimmed, capped at 300 chars; empty goal is blocked in the UI. "I'm stuck" passes the previous actions so the model does not repeat itself; after 3 presses in a row it steps down to the smallest built-in action.

### Data (all on his device, localStorage)

Event log: `{t, type, sessionId, ...}` with types `goal_set, action_given, focus_start, stuck, distracted, returned, focus_end, abandoned`.
- **Streak**: consecutive days with at least one completed session.
- **Recovery Score**: `returned / distracted` over the last 7 days, shown as "came back N of M times".
- **Focus consistency**: completed sessions / started sessions.
- Timer stores its end timestamp, so refresh or reopen resumes the session; a session whose end time passed while closed is offered as "finish or discard".

The log keeps the events a future Procrastination Fingerprint needs. No fingerprint is computed today.

## Not in this MVP

Accounts, sync, XP, leaderboards, friends, rooms, app blocking, native apps, the Procrastination Fingerprint.

## Testing

- Unit tests (`node --test`): validate, prompts, stats, session state machine, fallback path.
- Server tests with a stub adapter: unavailable, slow, malformed JSON, oversized input.
- Browser run-through after each stage: vague, empty, very long and nonsense goals; repeated "I'm stuck"; "I got distracted"; refresh mid-session; reopen after expiry; several sessions; remote down; on-device load failure.
- Results recorded in `TESTLOG.md`.

## Licensing and distribution

- Gemma weights are under the Gemma Terms of Use. The app does not redistribute them; the browser fetches the ungated `onnx-community/gemma-3-1b-it-ONNX` files from Hugging Face.
- The app and README carry the notice "Gemma is provided under and subject to the Gemma Terms of Use", with links to the terms and the prohibited use policy (terms section 3.1 and 3.2).
- App code: MIT.

## Browser requirements

- Remote provider: any current browser.
- Private mode: WebGPU with `shader-f16`. Verified here on Chromium 152 only. Documented support, not tested by us: Chrome/Edge 113+ desktop, Chrome 121+ on Android 12+, Safari 26+. Roughly 1 GB free storage and 4 GB+ RAM.

## Open decisions (need the owner)

1. Hosted provider for the friend's link: Google's hosted Gemma (needs a free API key) or Ollama on the owner's laptop behind a tunnel.
2. Host for the app and server: Render (needs an account).
3. The friend's device, which decides whether Private mode is available to him.
