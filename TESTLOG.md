# FocusLoop test log

Short record of what was actually run, what broke, and what was fixed.

## 2026-10-04: browser Gemma feasibility spike (throwaway code in `spike/`)

Machine: Ryzen 5 5500U, integrated Radeon, 8 GB RAM, Windows 11, Chromium 152. Library: transformers.js 4.3.0.

| Test | Result |
|---|---|
| WebGPU available | Yes. AMD adapter, `shader-f16` supported, max buffer 2 GB |
| Gemma 3 1B (q4f16, 763 MB) loads in browser | Yes. 89 s and 100 s on two runs |
| First inference after load | 46 s and 48 s |
| Later inferences (64 tokens max) | 5 to 8 s, one 21 s outlier while another download was running |
| JSON validity, 1B, 6 goals | 6/6 on both prompt versions |
| Gemma 3 270M (q4f16, 273 MB) | Loads in 8 to 11 s, answers in 2 to 6 s, 3/6 valid JSON, invented a URL |
| Ollama `gemma3:1b` on CPU, same prompt | 11 s load, about 5 s per answer, 27 tokens/s, 6/6 valid with schema |
| Model path does not exist | Catchable error within 6 s |

Problems found:
- First in-browser download from Hugging Face stalled at 167 MB of 763 MB, no error raised. Worked around by downloading the files with curl and serving them locally.
- Model load blocks the main thread (page scripts timed out during load). Needs a Web Worker.
- First prompt (few-shot inside the system prompt) made 270M echo the examples and made 1B answer "Take a deep breath..." for all six goals. Fixed by moving the examples into user/assistant turns and banning breathing/feelings advice in the system prompt.
- Model files were first saved inside the OneDrive folder, which would have synced about 1 GB. Moved to a temp folder.

Not tested: any phone, Safari, Firefox, a machine without WebGPU, the WASM (CPU) path in the browser.

## 2026-10-04: MVP

Fast Mode in these tests is Ollama `gemma3:1b` on this laptop standing in for the hosted provider. No hosted Gemma has been tested yet. Private Mode model files were served from this machine, not from Hugging Face.

### Automated (`npm test`): 38 tests, 38 pass

Covers: goal cleaning and length cap; JSON extraction from prose and code fences; rejection of malformed, empty, link-containing and too-big steps; prompt structure for all four tasks; fallback steps; event log with corrupt or full storage; streak, Recovery Score, consistency; session timer and refresh persistence; AI layer retry, timeout, abort, fallback, no-repeat for "I'm stuck", provider switching; on-device provider with a fake worker (progress, warm-up, stalled download, load error, worker crash); server validation, path traversal, 413, 502, 504, rate limit; the Google adapter's request shape with a mocked fetch.

### Prompt check (`node scripts/eval-prompts.js`), local Gemma 3 1B

17 of 17 cases valid JSON, median 3.8 s, max 9.0 s. Output saved in `docs/evidence/eval-gemma3-1b.txt`.

### In the browser (Chromium 152, this laptop)

| Flow | Result |
|---|---|
| First-time user | Start screen, stats empty, nothing in localStorage |
| Empty goal (spaces only) | Blocked with an inline message, no request sent |
| Vague goal "I need to study DBMS" | "Open your DBMS notes and write down the first concept you need to learn." in 7.7 s, labelled Fast Mode |
| Very long goal (5,000 characters) | Capped to 300, answered in 4.4 s, no layout overflow |
| Nonsense goal with emoji and a script tag | Got a generic study step; tag shown as text, not executed |
| Buttons while Gemma is thinking | Disabled; a second submit did not create a second session |
| "Too big, make it smaller" | New, different step in 3.6 s |
| "I'm stuck" pressed repeatedly | Gemma steps, then the built-in smallest step; further presses change nothing |
| "I got distracted" (double-clicked) | Counted once; recovery step shown; stuck/distracted buttons hidden until "I'm back" |
| Refresh during the timer | Timer continued from the right time |
| Refresh while a recovery step is showing | Recovery step still showing |
| "I'm back" (double-clicked) | Counted once; Recovery shows 1 of 1 |
| Timer reaches zero | Done screen at once; Gemma's reflection arrived a few seconds later |
| Reopen at the Done screen | Still on Done |
| Reopen after the timer ended while closed | Asked "count it or discard it"; both paths work |
| End session early | Needs two taps; logged as abandoned; consistency 2 of 3 |
| Several sessions | 3 finished, 5 started; streak 1 day; stats correct |
| Model unavailable (stub: down) | Built-in step in 0.2 s, labelled as built-in, for first step, stuck, recovery and reflection |
| Invalid model output (stub: junk) | Built-in step, labelled |
| Slow model (stub: 60 s) | "Gemma is thinking…" for 20 s, then built-in step |
| Private Mode: download failure (model path 404) | Clear error within 8 s, chip stays on Fast Mode, Fast Mode kept answering |
| Private Mode: load | Ready in 34 s, 58 s and 21 s on three runs; page stayed usable; Fast Mode answered a goal meanwhile |
| Private Mode: answers | First step 14.6 s, later 7 to 11 s, labelled Private Mode; no `/api/ai` request made from the page |
| Switching providers | Private → Fast → Private mid-session; label on each step matched the provider |
| Reload with Private Mode on | Starts loading again by itself |
| Feedback form | Text produced and saved; clipboard was blocked in the test pane, so the text box fallback showed |
| Delete my history | Two taps; events, session and feedback removed |
| 375 px wide viewport | No horizontal overflow |

### Bugs found and fixed

- Oversized request body closed the socket instead of answering 413.
- A render at the exact moment the timer ended could show the "ended while closed" panel instead of completing. Now a flag set only at page load.
- Pressing "I'm stuck" at the smallest step kept adding duplicate steps and inflating the stuck count.
- The "smallest step" kicked in after 2 Gemma answers; now after 3.
- Reflection said "with 8 stuck times". Stuck count removed from the reflection prompt.
- Tab title kept showing the clock after the session ended.
- A 300-character goal filled the Done and Focus screens. Now shortened for display and for the reflection prompt.
- Gemma 3 1B sometimes answered "read the first chapter". Added a prompt rule and a code check that rejects steps that size.
- Fallback reflection was labelled "Built-in step". Now has its own wording.
- Feedback date was in UTC. Now local time.

### Known problems, not fixed

- **Model is not kept between visits in the test browser.** The 763 MB weights file was not stored: this browser gave the site a 1.1 GB quota and the cache write failed. The app now says so when it detects it. Whether a normal Chrome profile keeps the file has not been tested.
- Gemma 3 1B's steps are sometimes generic ("Open your textbook and read the first page") and it followed "write me a poem" when told to ignore instructions. Harmless here, but the model is small.
- With Private Mode loading on the same laptop that runs Ollama, a Fast Mode answer took 12 s.
- Private Mode does not work offline yet: the page itself still needs the server to load.

### Not tested

A hosted Gemma provider; the live Google API; model download from Hugging Face inside the app; any phone; Safari; Firefox; a device without WebGPU (unit-tested with a fake only); the real friend.

## 2026-10-04: hosted provider preparation

Checked against Google's documentation (Gemma on Gemini API page, last updated 2026-07-02; pricing page; API terms), read through page summaries:
- Gemma model ids listed: `gemma-4-31b-it`, `gemma-4-26b-a4b-it`.
- `systemInstruction` is supported; thinking is controlled with `generationConfig.thinkingConfig.thinkingLevel` (`minimal` or `high`).
- Gemma 4 is free of charge with no paid tier, and free-tier prompts are used to improve Google's products.
- Users must be 18 or older.

The Google adapter was changed to match (system instruction, minimal thinking, thought parts dropped, Google's error message surfaced in server logs). `npm test`: 39 tests, 39 pass, including the request shape with a mocked fetch.

Still not run against the live API: no key yet.
