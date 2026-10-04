// The one place the app talks to a model. Providers are interchangeable:
// each is { name, generate(task, input, attempt, signal) -> Promise<string> }.
// The caller always gets a usable result: provider -> one retry -> built-in fallback.
import { parseFor } from '../core/validate.js';
import { fallbackFor } from '../core/fallback.js';

export const TIMEOUTS = { fast: 20000, private: 60000 };

function withTimeout(run, ms) {
  const ctl = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => { ctl.abort(); reject(new Error('timeout')); }, ms); });
  return Promise.race([run(ctl.signal), timeout]).finally(() => clearTimeout(timer));
}

const same = (a, b) => a.trim().toLowerCase().replace(/[.!…]+$/, '') === b.trim().toLowerCase().replace(/[.!…]+$/, '');

export function createAI({ fast, onDevice, wantsPrivate, timeouts = TIMEOUTS }) {
  // Private Mode answers only once the on-device model is ready. Until then
  // Fast Mode answers. Once it is ready, text never falls back to the server.
  function activeProvider() {
    return wantsPrivate() && onDevice?.isReady() ? onDevice : fast;
  }

  async function run(task, input, n = 0) {
    const provider = activeProvider();
    let reason = 'unavailable';
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const text = await withTimeout((signal) => provider.generate(task, input, attempt, signal), timeouts[provider.name] ?? 20000);
        const parsed = parseFor(task, text);
        if (!parsed) { reason = 'invalid'; continue; }
        if (task === 'unstick' && (input.tried || []).some((t) => same(t, parsed.action))) { reason = 'repeat'; continue; }
        return { ...parsed, source: provider.name };
      } catch (e) {
        reason = e.message === 'timeout' ? 'timeout' : 'unavailable';
        // A dead or slow model will not get better in the next few seconds.
        break;
      }
    }
    return { ...fallbackFor(task, input, n), source: 'fallback', reason };
  }

  return {
    activeProvider: () => activeProvider().name,
    nextAction: (goal) => run('nextAction', { goal }),
    unstick: (goal, tried, n) => run('unstick', { goal, tried }, n),
    recover: (goal, action, n) => run('recover', { goal, action }, n),
    reflect: (goal, facts) => run('reflect', { goal, ...facts }),
  };
}
