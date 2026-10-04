# Evidence for the submission

## Already saved

- `TESTLOG.md`: what was run, what broke, what was fixed.
- `docs/evidence/eval-gemma3-1b.txt`: every prompt run over 17 fixed cases against local Gemma 3 1B, with timings.
- `docs/superpowers/specs/2026-10-04-focusloop-design.md`: architecture and the spike numbers behind it.
- `spike/index.html`: the throwaway page used to measure in-browser Gemma.

## Screenshots still to capture (by hand; automated capture was unreliable)

Run `npm start`, open http://localhost:8787, and save each into `docs/evidence/`:

1. `01-start.png`: empty start screen (first-time user).
2. `02-first-step.png`: the first step for "I need to study DBMS", showing "⚡ Fast Mode — hosted Gemma".
3. `03-focus.png`: the timer running.
4. `04-recovery.png`: after "I got distracted", the recovery step.
5. `05-done.png`: Session complete with Gemma's one-line reflection and the stats.
6. `06-private-downloading.png`: mode panel while the model downloads (progress bar, "Fast Mode is answering until it is ready").
7. `07-private-on.png`: a step labelled "🔒 Private Mode — Gemma running on this device".
8. `08-private-network.png`: browser DevTools Network tab showing no `/api/ai` request while Private Mode answers.
9. `09-fallback.png`: stop Ollama, ask for a step, show the "Built-in step" label.
10. `10-tests.png`: terminal output of `npm test`.

## Before/after worth showing in the post

- Prompt v1 (examples inside the system prompt) → Gemma 3 1B answered "Take a deep breath…" for all six goals. Prompt v2 (examples as chat turns, banned advice) → subject-specific steps. Both outputs are in `TESTLOG.md`.
- In-browser model on the main thread: 89 to 100 s load plus 46 s first answer, page frozen. In a Web Worker with warm-up: 21 to 58 s to ready, page usable throughout.
