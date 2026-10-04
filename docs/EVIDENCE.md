# Evidence for the submission

## Saved

- `TESTLOG.md`: what was run, what broke, what was fixed.
- `docs/evidence/screens/mobile/` and `docs/evidence/screens/desktop/`: 15 screenshots each of the real app (390 × 844 and 1280 × 800), taken by `scripts/browser-check.mjs` while it ran the flows against hosted Gemma. 01 to 11 are light mode, 12 to 15 dark.
- `docs/evidence/eval-gemma4-26b-hosted.txt`: every prompt over 17 fixed cases against hosted Gemma 4, with timings.
- `docs/evidence/eval-gemma3-1b.txt`: the same 17 cases against local Gemma 3 1B.
- `docs/design/proposal.html`: the design proposal the UI was built from.
- `docs/superpowers/specs/2026-10-04-focusloop-design.md`: architecture and the spike numbers behind it.
- `spike/index.html`: the throwaway page used to measure in-browser Gemma.

## Still to capture by hand

The automated run only uses Fast Mode. These need a real browser window:

1. `private-downloading.png`: mode panel while the model downloads (progress bar, "Fast Mode is answering until it is ready").
2. `private-on.png`: a step whose label reads "Gemma on this device", with the header showing "Private Mode".
3. `private-network.png`: browser DevTools Network tab showing no `/api/ai` request while Private Mode answers.
4. `fallback.png`: with the server's model unreachable, a step labelled "Built-in step".
5. `tests.png`: terminal output of `npm test`.
6. A photo or screen recording of the friend's first use, if he agrees.

## Before/after worth showing in the post

- Prompt v1 (examples inside the system prompt) → Gemma 3 1B answered "Take a deep breath…" for all six goals. Prompt v2 (examples as chat turns, banned advice) → subject-specific steps. Both are in `TESTLOG.md`.
- In-browser model on the main thread: 89 to 100 s load plus 46 s first answer, page frozen. In a Web Worker with warm-up: 21 to 58 s to ready, page usable throughout.
- The same goal on Gemma 3 1B (on-device) and Gemma 4 26B (hosted): compare the two eval files.
