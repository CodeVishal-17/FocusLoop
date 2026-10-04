// Everything here is derived from the event log by plain code. No model involved.
const DAY = 86400000;

export function dayKey(t) {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function streak(events, now = Date.now()) {
  const days = new Set(events.filter((e) => e.type === 'focus_end').map((e) => dayKey(e.t)));
  // Today not done yet does not break the streak.
  let cursor = new Date(now);
  cursor.setHours(12, 0, 0, 0);
  if (!days.has(dayKey(cursor))) cursor = new Date(cursor.getTime() - DAY);
  let n = 0;
  while (days.has(dayKey(cursor))) { n++; cursor = new Date(cursor.getTime() - DAY); }
  return n;
}

// Getting distracted is not the failure; not coming back is.
export function recovery(events, now = Date.now(), windowDays = 7) {
  const recent = events.filter((e) => e.t > now - windowDays * DAY);
  const distracted = recent.filter((e) => e.type === 'distracted').length;
  const returned = Math.min(distracted, recent.filter((e) => e.type === 'returned').length);
  return { distracted, returned, score: distracted ? Math.round((returned / distracted) * 100) : null };
}

export function consistency(events) {
  const started = events.filter((e) => e.type === 'focus_start').length;
  const completed = Math.min(started, events.filter((e) => e.type === 'focus_end').length);
  return { started, completed, score: started ? Math.round((completed / started) * 100) : null };
}

export function summary(events, now = Date.now()) {
  const ends = events.filter((e) => e.type === 'focus_end');
  return {
    streak: streak(events, now),
    recovery: recovery(events, now),
    consistency: consistency(events),
    sessions: ends.length,
    minutes: ends.reduce((a, e) => a + (Number(e.minutes) || 0), 0),
    today: ends.filter((e) => dayKey(e.t) === dayKey(now)).length,
  };
}
