// Append-only event log. Everything FocusLoop knows about the user lives here,
// on their device.
const KEY = 'focusloop.events.v1';
const MAX_EVENTS = 3000;

export const EVENT_TYPES = ['goal_set', 'action_given', 'focus_start', 'stuck', 'distracted', 'returned', 'focus_end', 'abandoned'];

export function createLog(storage) {
  function all() {
    try {
      const v = JSON.parse(storage.getItem(KEY) || '[]');
      return Array.isArray(v) ? v : [];
    } catch { return []; }
  }
  function append(type, data = {}, now = Date.now()) {
    if (!EVENT_TYPES.includes(type)) throw new Error(`unknown event: ${type}`);
    const events = all();
    events.push({ t: now, type, ...data });
    try { storage.setItem(KEY, JSON.stringify(events.slice(-MAX_EVENTS))); } catch { /* storage full or blocked: keep running */ }
  }
  function clear() { try { storage.removeItem(KEY); } catch {} }
  return { all, append, clear };
}
