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

// The Progress headline. It only claims improvement when the numbers show it:
// at least two distractions this week, and a return rate no worse than last
// week's (or at least half, when there is no last week to compare with).
export function returnMessage(events, now = Date.now()) {
  const rate = (from, to) => {
    const slice = events.filter((e) => e.t > now - from * DAY && e.t <= now - to * DAY);
    const distracted = slice.filter((e) => e.type === 'distracted').length;
    const returned = Math.min(distracted, slice.filter((e) => e.type === 'returned').length);
    return { distracted, rate: distracted ? returned / distracted : null };
  };
  const thisWeek = rate(7, 0), lastWeek = rate(14, 7);
  const better = thisWeek.distracted >= 2 && thisWeek.rate >= (lastWeek.rate ?? 0.5);
  return better ? "You're getting better at returning." : 'Every return counts.';
}

// The last few sessions as rings: finished or not, and where in the session
// each return happened (0..1), for the loop visual on Progress.
export function sessionRings(events, count = 6) {
  const sessions = new Map();
  for (const e of events) {
    if (!e.sessionId) continue;
    if (e.type === 'focus_start') sessions.set(e.sessionId, { start: e.t, length: (Number(e.minutes) || 15) * 60000, completed: false, returns: [] });
    const s = sessions.get(e.sessionId);
    if (!s) continue;
    if (e.type === 'focus_end') s.completed = true;
    if (e.type === 'returned') s.returns.push(Math.min(1, Math.max(0, (e.t - s.start) / s.length)));
  }
  return [...sessions.values()].slice(-count).map(({ completed, returns }) => ({ completed, returns }));
}
