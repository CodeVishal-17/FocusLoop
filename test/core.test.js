import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanGoal, parseAction, parseNote, MAX_ACTION } from '../public/core/validate.js';
import { buildMessages, schemaFor, TASKS } from '../public/core/prompts.js';
import { fallbackFor } from '../public/core/fallback.js';
import { createLog } from '../public/core/events.js';
import { streak, recovery, consistency, summary } from '../public/core/stats.js';
import * as S from '../public/core/session.js';

function memoryStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
const DAY = 86400000;
const NOON = new Date(2026, 9, 4, 12).getTime();

test('cleanGoal trims, collapses whitespace and caps length', () => {
  assert.equal(cleanGoal('  study \n\n DBMS  '), 'study DBMS');
  assert.equal(cleanGoal(null), '');
  assert.equal(cleanGoal('x'.repeat(5000)).length, 300);
});

test('parseAction accepts clean JSON and clamps minutes', () => {
  assert.deepEqual(parseAction('{"action": "Open your DBMS notes now.", "minutes": 3}'), { action: 'Open your DBMS notes now.', minutes: 3 });
  assert.equal(parseAction('{"action": "Open your DBMS notes now.", "minutes": 90}').minutes, 5);
  assert.equal(parseAction('{"action": "Open your DBMS notes now.", "minutes": 0}').minutes, 1);
  assert.equal(parseAction('{"action": "Open your DBMS notes now."}').minutes, 3);
  assert.equal(parseAction('{"action": "Open your DBMS notes now.", "minutes": "2"}').minutes, 2);
});

test('parseAction extracts JSON wrapped in prose or code fences', () => {
  const r = parseAction('Sure!\n```json\n{"action": "Read the first {curly} heading.", "minutes": 2}\n```\nGood luck');
  assert.deepEqual(r, { action: 'Read the first {curly} heading.', minutes: 2 });
});

test('parseAction rejects malformed, empty and unsafe output', () => {
  for (const bad of ['', 'no json here', '{"action": ', '{"action": 5, "minutes": 2}', '{"action": "ok", "minutes": 2}', '[1,2]', '{"note": "wrong shape here"}',
    '{"action": "Go to https://www.help.example.com/study for a guide.", "minutes": 2}', null, undefined]) {
    assert.equal(parseAction(bad), null, String(bad));
  }
});

test('parseAction rejects steps that are too big to be a first step', () => {
  const act = (a) => parseAction(JSON.stringify({ action: a, minutes: 3 }));
  for (const big of ['Open the textbook and read the first chapter.', 'Open your physics textbook and quickly skim through the first chapter.', 'Revise the whole syllabus tonight.', 'Finish the unit on normalization.']) assert.equal(act(big), null, big);
  for (const ok of ['Read the first paragraph of chapter 2.', 'Open the book you need to any page.', 'Open your textbook and read the first page.', 'Write the names of the exam chapters on one sheet of paper.']) assert.ok(act(ok), ok);
});

test('parseAction strips markdown and truncates long actions at a word', () => {
  const long = parseAction(JSON.stringify({ action: '**Open** ' + 'word '.repeat(80), minutes: 2 }));
  assert.ok(long.action.length <= MAX_ACTION + 1);
  assert.ok(!long.action.includes('*'));
  assert.ok(long.action.endsWith('…'));
});

test('parseNote', () => {
  assert.deepEqual(parseNote('{"note": "You studied DBMS for 15 minutes."}'), { note: 'You studied DBMS for 15 minutes.' });
  assert.equal(parseNote('{"action": "Open your notes now.", "minutes": 1}'), null);
});

test('buildMessages: system first, alternating few-shot turns, user last', () => {
  for (const task of TASKS) {
    const m = buildMessages(task, { goal: 'study DBMS', tried: ['a step'], action: 'a step', minutes: 15 });
    assert.equal(m[0].role, 'system');
    assert.equal(m.at(-1).role, 'user');
    assert.ok(m.at(-1).content.startsWith('Goal: study DBMS'));
    for (let i = 1; i < m.length; i++) assert.equal(m[i].role, i % 2 ? 'user' : 'assistant');
    assert.ok(schemaFor(task).required.length >= 1);
  }
});

test('buildMessages rejects empty goals and unknown tasks, caps long input', () => {
  assert.throws(() => buildMessages('nextAction', { goal: '   ' }));
  assert.throws(() => buildMessages('chat', { goal: 'x' }));
  const m = buildMessages('unstick', { goal: 'g'.repeat(9000), tried: Array(50).fill('t'.repeat(9000)) });
  assert.ok(m.at(-1).content.length < 300 + 4 * 165 + 40);
});

test('fallbackFor always returns a usable result and rotates', () => {
  assert.notEqual(fallbackFor('unstick', {}, 0).action, fallbackFor('unstick', {}, 1).action);
  assert.ok(parseAction(JSON.stringify(fallbackFor('recover', {}, 7))));
  assert.match(fallbackFor('reflect', { minutes: 15, returned: 2 }).note, /15 minutes.*2 times/);
  assert.equal(fallbackFor('reflect', { minutes: 5, returned: 0 }).note, 'You focused for 5 minutes.');
});

test('event log appends, survives corrupt storage, rejects unknown types', () => {
  const log = createLog(memoryStorage());
  log.append('goal_set', { sessionId: 'a' }, 1);
  log.append('focus_start', { sessionId: 'a' }, 2);
  assert.equal(log.all().length, 2);
  assert.throws(() => log.append('nope'));
  assert.deepEqual(createLog(memoryStorage({ 'focusloop.events.v1': '{not json' })).all(), []);
  const full = createLog({ getItem: () => '[]', setItem: () => { throw new Error('QuotaExceeded'); }, removeItem() {} });
  assert.doesNotThrow(() => full.append('goal_set'));
});

test('streak counts consecutive days and tolerates today not done yet', () => {
  const end = (daysAgo) => ({ t: NOON - daysAgo * DAY, type: 'focus_end', minutes: 15 });
  assert.equal(streak([], NOON), 0);
  assert.equal(streak([end(0)], NOON), 1);
  assert.equal(streak([end(0), end(0), end(1), end(2)], NOON), 3);
  assert.equal(streak([end(1), end(2)], NOON), 2);
  assert.equal(streak([end(2), end(3)], NOON), 0);
  assert.equal(streak([end(0), end(2)], NOON), 1);
});

test('recovery score rewards coming back and ignores old events', () => {
  const ev = (type, daysAgo = 0) => ({ t: NOON - daysAgo * DAY - 1, type });
  assert.equal(recovery([], NOON).score, null);
  assert.deepEqual(recovery([ev('distracted'), ev('returned'), ev('distracted')], NOON), { distracted: 2, returned: 1, score: 50 });
  assert.equal(recovery([ev('distracted', 9), ev('distracted'), ev('returned')], NOON).score, 100);
  assert.equal(recovery([ev('returned'), ev('returned'), ev('distracted')], NOON).returned, 1);
});

test('consistency and summary', () => {
  const events = [{ t: NOON, type: 'focus_start' }, { t: NOON, type: 'focus_end', minutes: 15 }, { t: NOON, type: 'focus_start' }, { t: NOON, type: 'abandoned' }];
  assert.deepEqual(consistency(events), { started: 2, completed: 1, score: 50 });
  const s = summary(events, NOON);
  assert.equal(s.sessions, 1); assert.equal(s.minutes, 15); assert.equal(s.today, 1); assert.equal(s.streak, 1);
});

test('session: start, expiry, refresh persistence', () => {
  const store = S.createSessionStore(memoryStorage());
  assert.equal(store.load(), null);
  let s = S.withAction(S.newSession('study DBMS', 1000), { action: 'Open notes', minutes: 2, source: 'fast' });
  s = S.start(s, 15, 1000);
  store.save(s);
  const reloaded = store.load();
  assert.equal(reloaded.endsAt, 1000 + 15 * 60000);
  assert.equal(S.remainingMs(reloaded, 1000 + 60000), 14 * 60000);
  assert.equal(S.isExpired(reloaded, 1000 + 15 * 60000 - 1), false);
  assert.equal(S.isExpired(reloaded, 1000 + 15 * 60000), true);
  assert.equal(S.start(S.newSession('x'), 999, 0).durationMin, 15);
  store.clear();
  assert.equal(store.load(), null);
});

test('session store ignores corrupt or wrong-shaped data', () => {
  assert.equal(S.createSessionStore(memoryStorage({ 'focusloop.session.v1': '{oops' })).load(), null);
  assert.equal(S.createSessionStore(memoryStorage({ 'focusloop.session.v1': '{"goal": 5}' })).load(), null);
});

test('session: stuck, distracted and returned counters', () => {
  let s = S.newSession('x');
  s = S.markStuck(S.markStuck(s));
  assert.equal(s.stuckRun, 2);
  s = S.markDistracted(s);
  assert.deepEqual([s.distracted, s.awaitingReturn, s.stuckRun], [1, true, 0]);
  s = S.markReturned(S.markReturned(s));
  assert.equal(s.returned, 1, 'a second "I am back" does not double count');
  assert.equal(S.finish(s).phase, 'done');
  assert.equal(S.formatClock(15 * 60000), '15:00');
  assert.equal(S.formatClock(59001), '01:00');
  assert.equal(S.formatClock(0), '00:00');
});
