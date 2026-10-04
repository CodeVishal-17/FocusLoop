// The current session: plain data plus pure transitions. The timer is stored
// as an end timestamp, so a refresh or a closed tab cannot lose it.
const KEY = 'focusloop.session.v1';
export const DURATIONS = [5, 15, 25];
export const STUCK_LIMIT = 3;

export function createSessionStore(storage) {
  return {
    load() {
      try {
        const s = JSON.parse(storage.getItem(KEY) || 'null');
        return s && typeof s === 'object' && typeof s.goal === 'string' && Array.isArray(s.actions) ? s : null;
      } catch { return null; }
    },
    save(s) { try { storage.setItem(KEY, JSON.stringify(s)); } catch {} },
    clear() { try { storage.removeItem(KEY); } catch {} },
  };
}

export function newSession(goal, now = Date.now()) {
  return { id: `s${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`, goal, phase: 'ready', actions: [], durationMin: null, startedAt: null, endsAt: null, stuck: 0, stuckRun: 0, distracted: 0, returned: 0, awaitingReturn: false, note: null };
}

export function currentAction(s) { return s.actions[s.actions.length - 1] || null; }

export function withAction(s, action) { return { ...s, actions: [...s.actions, action].slice(-12) }; }

export function start(s, minutes, now = Date.now()) {
  const durationMin = DURATIONS.includes(minutes) ? minutes : 15;
  return { ...s, phase: 'focusing', durationMin, startedAt: now, endsAt: now + durationMin * 60000 };
}

export function remainingMs(s, now = Date.now()) { return s.phase === 'focusing' ? Math.max(0, s.endsAt - now) : 0; }

export function isExpired(s, now = Date.now()) { return s.phase === 'focusing' && now >= s.endsAt; }

export function markStuck(s) { return { ...s, stuck: s.stuck + 1, stuckRun: s.stuckRun + 1 }; }

export function markDistracted(s) { return { ...s, distracted: s.distracted + 1, awaitingReturn: true, stuckRun: 0 }; }

export function markReturned(s) { return s.awaitingReturn ? { ...s, returned: s.returned + 1, awaitingReturn: false } : s; }

export function finish(s) { return { ...s, phase: 'done', awaitingReturn: false }; }

export function formatClock(ms) {
  const total = Math.ceil(ms / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
