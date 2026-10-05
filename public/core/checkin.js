// Accountability check-in. A timer can measure time; it can't make you study.
// FocusLoop cannot see what the student is doing, so it only reasons about
// what it does know: how long since they last touched FocusLoop, and whether
// this tab was left. Plain code decides when to ask; no model is involved.

export const AWAY_MS = 60 * 1000;          // tab left for at least this long -> ask on return
export const LAST_STRETCH_MS = 90 * 1000;  // don't interrupt the final stretch of a session

// About three times a session, never more often than every 4 minutes:
// 5 min -> 4, 15 min -> 5, 25 min -> 8.
export function checkinEveryMs(durationMin) {
  return Math.max(4, Math.round((Number(durationMin) || 15) / 3)) * 60000;
}

// Returns { reason: 'away' | 'quiet', minutes } when a check-in should be shown, else null.
// `hiddenSince` is when this tab was last hidden, if it has just become visible again.
export function checkinDue({ now, session, hiddenSince = null }) {
  if (!session || session.phase !== 'focusing' || session.awaitingReturn || session.checkin) return null;
  if (now >= session.endsAt) return null;
  if (hiddenSince != null && now - hiddenSince >= AWAY_MS) {
    return { reason: 'away', minutes: Math.max(1, Math.round((now - hiddenSince) / 60000)) };
  }
  if (session.endsAt - now <= LAST_STRETCH_MS) return null;
  const seen = session.lastSeenAt ?? session.startedAt;
  if (now - seen >= checkinEveryMs(session.durationMin)) {
    return { reason: 'quiet', minutes: Math.round((now - seen) / 60000) };
  }
  return null;
}

// Says only what FocusLoop actually knows.
export function checkinLine(checkin) {
  const n = checkin?.minutes || 1;
  const mins = `${n} minute${n === 1 ? '' : 's'}`;
  return checkin?.reason === 'away'
    ? `This tab was in the background for ${mins}. FocusLoop can't see what you were doing, so it's asking.`
    : `You haven't touched FocusLoop for ${mins}. That's fine if you're in your book. It can't see, so it's asking.`;
}
