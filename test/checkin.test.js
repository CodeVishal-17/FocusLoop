// Accountability check-in: when FocusLoop asks "Are you still studying?".
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkinDue, checkinEveryMs, checkinLine, AWAY_MS, LAST_STRETCH_MS } from '../public/core/checkin.js';
import { createLog } from '../public/core/events.js';
import { summary } from '../public/core/stats.js';
import * as S from '../public/core/session.js';

const MIN = 60000;
const T0 = 1_000_000_000_000;
const focusing = (minutes = 15, extra = {}) => ({ ...S.start(S.withAction(S.newSession('study DBMS', T0), { action: 'Read one definition.', minutes: 2, source: 'fast' }), minutes, T0), lastSeenAt: T0, ...extra });

test('interval scales with the session and never drops below four minutes', () => {
  assert.equal(checkinEveryMs(5), 4 * MIN);
  assert.equal(checkinEveryMs(15), 5 * MIN);
  assert.equal(checkinEveryMs(25), 8 * MIN);
  assert.equal(checkinEveryMs(undefined), 5 * MIN);
});

test('no check-in while the student keeps touching FocusLoop', () => {
  const s = focusing(15);
  assert.equal(checkinDue({ now: T0 + 4 * MIN + 59000, session: s }), null);
  assert.equal(checkinDue({ now: T0 + 9 * MIN, session: { ...s, lastSeenAt: T0 + 6 * MIN } }), null);
});

test('asks after a quiet stretch, and says how long it was', () => {
  const due = checkinDue({ now: T0 + 5 * MIN, session: focusing(15) });
  assert.deepEqual(due, { reason: 'quiet', minutes: 5 });
  assert.match(checkinLine(due), /haven't touched FocusLoop for 5 minutes/);
  // Sessions saved before this feature have no lastSeenAt: the start time is used.
  const old = focusing(15); delete old.lastSeenAt;
  assert.equal(checkinDue({ now: T0 + 5 * MIN, session: old }).reason, 'quiet');
});

test('it does not interrupt constantly: at most a few times per session', () => {
  for (const minutes of [5, 15, 25]) {
    let s = focusing(minutes), asked = 0;
    for (let now = T0; now < s.endsAt; now += 1000) {
      if (checkinDue({ now, session: s })) { asked++; s = { ...s, lastSeenAt: now }; } // answered at once
    }
    assert.ok(asked <= 3, `${minutes} min session asked ${asked} times`);
    assert.ok(minutes === 5 ? asked <= 1 : asked >= 2, `${minutes} min session asked ${asked} times`);
  }
});

test('never asks twice at once, during recovery, in the final stretch, or outside a session', () => {
  const now = T0 + 6 * MIN;
  assert.equal(checkinDue({ now, session: focusing(15, { checkin: { reason: 'quiet', minutes: 5 } }) }), null);
  assert.equal(checkinDue({ now, session: focusing(15, { awaitingReturn: true }) }), null);
  assert.equal(checkinDue({ now, session: { ...focusing(15), phase: 'done' } }), null);
  assert.equal(checkinDue({ now, session: null }), null);
  const s = focusing(15);
  assert.equal(checkinDue({ now: s.endsAt - LAST_STRETCH_MS, session: s }), null, 'final stretch is left alone');
  assert.equal(checkinDue({ now: s.endsAt + 1, session: s }), null, 'an ended session is handled by the timer');
});

test('coming back to a tab that was in the background asks, however recent the last touch', () => {
  const s = focusing(15, { lastSeenAt: T0 + 2 * MIN });
  const now = T0 + 4 * MIN;
  assert.equal(checkinDue({ now, session: s, hiddenSince: now - AWAY_MS + 1000 }), null, 'a glance away is ignored');
  const due = checkinDue({ now, session: s, hiddenSince: now - 2 * MIN });
  assert.deepEqual(due, { reason: 'away', minutes: 2 });
  assert.match(checkinLine(due), /in the background for 2 minutes/);
  // Even in the final stretch: leaving the tab is the case the timer could not see.
  assert.equal(checkinDue({ now: s.endsAt - 30000, session: s, hiddenSince: s.endsAt - 3 * MIN }).reason, 'away');
});

test('the wording claims only what FocusLoop knows', () => {
  for (const c of [{ reason: 'quiet', minutes: 5 }, { reason: 'away', minutes: 1 }]) {
    const line = checkinLine(c);
    assert.match(line, /can't see/);
    assert.doesNotMatch(line, /you were (on|using|watching|scrolling)|instagram|youtube|caught|detected|we saw/i);
  }
  assert.match(checkinLine({ reason: 'away', minutes: 1 }), /for 1 minute\./);
});

test('check-in answers are logged and do not inflate the Recovery Score', () => {
  const m = new Map();
  const log = createLog({ getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) });
  log.append('focus_start', { sessionId: 'a', minutes: 15 }, T0);
  log.append('checkin', { sessionId: 'a', reason: 'quiet', answer: 'back' }, T0 + 5 * MIN);
  log.append('checkin', { sessionId: 'a', reason: 'away', answer: 'back' }, T0 + 9 * MIN);
  const s = summary(log.all(), T0 + 10 * MIN);
  assert.deepEqual(s.recovery, { distracted: 0, returned: 0, score: null }, 'tapping "I\'m back" is not a recovery from a distraction');
  // "I got distracted" at a check-in goes through the normal recovery flow.
  log.append('checkin', { sessionId: 'a', reason: 'quiet', answer: 'distracted' }, T0 + 11 * MIN);
  log.append('distracted', { sessionId: 'a' }, T0 + 11 * MIN);
  log.append('returned', { sessionId: 'a' }, T0 + 12 * MIN);
  assert.deepEqual(summary(log.all(), T0 + 13 * MIN).recovery, { distracted: 1, returned: 1, score: 100 });
});
