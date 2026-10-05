// UI wiring. All decisions about time, counts and scores are plain code in
// core/; Gemma is only asked for the words of the next step.
import { cleanGoal } from './core/validate.js';
import { createLog } from './core/events.js';
import { summary, returnMessage, sessionRings } from './core/stats.js';
import { ringPoint, elapsedFraction } from './core/ring.js';
import { checkinDue, checkinLine } from './core/checkin.js';
import { fallbackFor, SMALLEST_STEP } from './core/fallback.js';
import * as S from './core/session.js';
import { createAI } from './ai/index.js';
import { createFastProvider } from './ai/remote.js';
import { createOnDevice, checkSupport } from './ai/ondevice.js';

const $ = (id) => document.getElementById(id);
const PREF_PRIVATE = 'focusloop.private';
const PREF_DURATION = 'focusloop.duration';
const LAST_GOAL = 'focusloop.lastGoal';
const FEEDBACK = 'focusloop.feedback';
const HIDDEN_SINCE = 'focusloop.hiddenSince';   // when this tab last went to the background

const storage = safeStorage();
const log = createLog(storage);
const store = S.createSessionStore(storage);

let session = store.load();
let busy = null;            // text shown while a model call is running
let awayExpired = false;    // the timer ran out while the tab was closed
let view = null;            // 'progress' while the Progress screen is open
let duration = S.DURATIONS.includes(Number(storage.getItem(PREF_DURATION))) ? Number(storage.getItem(PREF_DURATION)) : 15;
let wantsPrivate = storage.getItem(PREF_PRIVATE) === '1';
let support = { ok: false, reason: 'Checking this device…' };
let config = { dataNote: null, modelHost: null };
let storageNote = '';      // set when this browser cannot keep the model between visits

let onDevice = null;
let ai = createAI({ fast: createFastProvider(), onDevice: null, wantsPrivate: () => false });

function safeStorage() {
  try { localStorage.setItem('focusloop.t', '1'); localStorage.removeItem('focusloop.t'); return localStorage; } catch {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
  }
}

function save() { session ? store.save(session) : store.clear(); }

// Quiet provider names for the step itself; the full explanation lives behind
// the mode control in the header. A built-in step is never presented as Gemma's.
const SOURCE_LABEL = { fast: 'Hosted Gemma', private: 'Gemma on this device', fallback: 'Built-in step', smallest: 'Built-in step' };
const SVG = 'http://www.w3.org/2000/svg';
const RING_R = 98, RING_C = 2 * Math.PI * RING_R;

function svg(name, attrs) {
  const el = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

// One drift on a ring: a small loop that leaves the ring and comes back to it,
// with a dot once the person has returned. Never a gap, never a warning colour.
function driftMarks(fraction, returned, radius, cx, cy, loopR, dotR) {
  const on = ringPoint(fraction, radius, cx, cy);
  const marks = [svg('circle', { class: 'drift-loop', cx: on.x, cy: on.y, r: loopR })];
  if (returned) {
    const inner = ringPoint(fraction, radius - loopR + 1, cx, cy);
    marks.push(svg('circle', { class: 'drift-dot', cx: inner.x, cy: inner.y, r: dotR }));
  }
  return marks;
}

const days = (n) => `${n} day${n === 1 ? '' : 's'}`;
const shortGoal = (g) => (g.length > 60 ? `${g.slice(0, 57).trimEnd()}…` : g);

// ---------- rendering ----------
function render() {
  const phase = session?.phase || 'start';
  const screen = view === 'progress' && phase !== 'focusing' ? 'progress' : phase === 'focusing' ? 'focus' : phase;
  for (const name of ['start', 'ready', 'focus', 'done', 'progress']) $(`screen-${name}`).hidden = name !== screen;
  document.body.dataset.screen = screen;
  const recovering = screen === 'focus' && session.awaitingReturn && !awayExpired;
  document.body.classList.toggle('recovering', recovering);

  const s = summary(log.all());

  if (screen === 'start') $('home-streak').textContent = s.streak ? `${days(s.streak)} streak ·` : '';

  if (screen === 'ready') {
    const a = S.currentAction(session);
    $('ready-goal').textContent = session.goal;
    $('ready-action').textContent = a.action;
    $('ready-minutes').textContent = `~${a.minutes} min`;
    $('ready-source').textContent = SOURCE_LABEL[a.source];
    $('duration-options').replaceChildren(...S.DURATIONS.map((m) => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = `${m} min`; b.setAttribute('aria-pressed', String(m === duration));
      b.onclick = () => { duration = m; storage.setItem(PREF_DURATION, String(m)); render(); };
      return b;
    }));
  }

  if (screen === 'focus') {
    const a = S.currentAction(session);
    $('focus-action').textContent = a.action;
    $('focus-source').textContent = SOURCE_LABEL[a.source];
    const checking = !!session.checkin && !awayExpired && !session.awaitingReturn;
    $('focus-main').hidden = awayExpired || session.awaitingReturn || checking;
    $('checkin').hidden = !checking;
    if (checking) $('checkin-line').textContent = checkinLine(session.checkin);
    $('expired-sub').textContent = session.checkin ? "You hadn't answered the last check-in. Did you stay with it?" : 'FocusLoop was closed at the time. Did you stay with it?';
    $('recovery').hidden = !recovering;
    $('expired').hidden = !awayExpired;
    $('end-row').hidden = awayExpired;
    if (recovering) {
      const r = session.pendingRecovery;
      $('recovery-action').textContent = r ? r.action : 'Finding a small step back in…';
      $('recovery-minutes').textContent = r ? `~${r.minutes} min` : '';
      $('recovery-source').textContent = r ? SOURCE_LABEL[r.source] : '';
      $('back').hidden = !r;
    }
    $('ring-drifts').replaceChildren(...(session.drifts || []).flatMap((d) => driftMarks(d.f, d.returned, RING_R, 108, 108, 9, 4)));
    renderClock();
  }

  if (screen === 'done') {
    $('done-title').textContent = `${session.durationMin} minutes, done.`;
    $('done-goal').textContent = shortGoal(session.goal);
    $('done-note').textContent = session.note?.note || '';
    $('done-source').textContent = !session.note ? '' : session.note.source === 'fallback' ? 'Written by FocusLoop' : SOURCE_LABEL[session.note.source];
    $('done-streak').textContent = days(s.streak);
    $('done-returns').textContent = session.distracted ? `${session.returned} of ${session.distracted}` : 'none';
    $('done-returns-label').textContent = session.distracted ? 'returns' : 'distractions';
    $('done-consistency').textContent = s.consistency.score === null ? '—' : `${s.consistency.score}%`;
    $('done-ring').replaceChildren(
      svg('circle', { class: 'ring-arc', cx: 46, cy: 46, r: 38 }),
      ...(session.drifts || []).filter((d) => d.returned).map((d) => { const p = ringPoint(d.f, 38, 46, 46); return svg('circle', { class: 'drift-dot', cx: p.x, cy: p.y, r: 4 }); }),
      svg('path', { class: 'tick', d: 'M33 47l9 9 18-20' }),
    );
  }

  if (screen === 'progress') {
    const events = log.all();
    $('progress-message').textContent = returnMessage(events);
    const rings = sessionRings(events, 6);
    $('progress-rings').setAttribute('aria-label', rings.length ? `Your last ${rings.length} session${rings.length === 1 ? '' : 's'}: ${rings.filter((r) => r.completed).length} finished, ${rings.reduce((n, r) => n + r.returns.length, 0)} returns` : 'No sessions yet');
    $('progress-rings').replaceChildren(...rings.map((r) => {
      const el = svg('svg', { viewBox: '0 0 40 40' });
      el.append(svg('circle', { class: r.completed ? 'done' : 'open', cx: 20, cy: 20, r: 15 }), ...r.returns.map((f) => { const p = ringPoint(f, 15, 20, 20); return svg('circle', { class: 'drift-dot', cx: p.x, cy: p.y, r: 3.2 }); }));
      return el;
    }));
    $('progress-streak').textContent = s.streak ? `${s.streak} day` : '—';
    $('progress-consistency').textContent = s.consistency.score === null ? '—' : `${s.consistency.score}%`;
    $('progress-recovered').textContent = s.recovery.distracted ? `${s.recovery.returned}/${s.recovery.distracted}` : '—';
  }

  // The recovery card carries its own "finding a step" line.
  $('busy').hidden = !busy || recovering;
  $('busy').textContent = busy || '';
  for (const b of document.querySelectorAll('main button')) b.disabled = !!busy;
  $('goal').disabled = !!busy;

  if (screen !== 'focus') document.title = 'FocusLoop';
  renderMode();
}

function renderClock() {
  if (session?.phase !== 'focusing') { document.title = 'FocusLoop'; return; }
  const text = S.formatClock(S.remainingMs(session));
  $('clock').textContent = text;
  $('recovery-clock').textContent = text;
  $('checkin-clock').textContent = text;
  const arc = $('ring-arc');
  arc.style.strokeDasharray = RING_C;
  arc.style.strokeDashoffset = RING_C * (1 - elapsedFraction(session.startedAt, session.endsAt));
  // The tab title is the only thing visible from another tab, so the question goes there too.
  document.title = session.checkin && !session.awaitingReturn ? 'Still studying? · FocusLoop' : `${text} · FocusLoop`;
}

function renderMode() {
  const active = ai.activeProvider();
  const st = onDevice?.status() || { state: 'off' };
  const chip = $('mode-chip');
  chip.classList.toggle('private', active === 'private');
  const loading = wantsPrivate && (st.state === 'downloading' || st.state === 'warming');
  chip.textContent = active === 'private' ? 'Private Mode' : loading ? 'Fast Mode · Private getting ready…' : 'Fast Mode';

  if (config.dataNote) $('fast-note').textContent = `${config.dataNote} Fast Mode is not private and needs an internet connection.`;

  const toggle = $('private-toggle'), status = $('private-status'), bar = $('private-progress');
  bar.hidden = true; toggle.disabled = false;
  if (!support.ok) {
    status.textContent = support.reason; toggle.textContent = 'Private Mode is not available here'; toggle.disabled = true;
    return;
  }
  toggle.textContent = wantsPrivate ? 'Turn off Private Mode' : 'Turn on Private Mode';
  if (!wantsPrivate) status.textContent = 'Off. Fast Mode is answering.';
  else if (st.state === 'downloading') {
    const mb = (n) => Math.round(n / 1e6);
    status.textContent = st.total ? `Downloading the model: ${mb(st.loaded)} of ${mb(st.total)} MB. Fast Mode is answering until it is ready.` : 'Starting the model download… Fast Mode is answering until it is ready.';
    bar.hidden = false; $('private-bar').style.width = st.total ? `${Math.min(100, (st.loaded / st.total) * 100)}%` : '2%';
  } else if (st.state === 'warming') status.textContent = 'Download finished. Preparing the model on this device, which can take a couple of minutes. Fast Mode is answering until it is ready.';
  else if (st.state === 'ready') status.textContent = `On. Gemma is running on this device. What you type is not sent to any server.${storageNote}`;
  else if (st.state === 'error') { status.textContent = `${st.error} Fast Mode is answering.`; toggle.textContent = 'Try Private Mode again'; }
  else status.textContent = 'Starting…';
}

// ---------- model calls ----------
// Runs one model call with the buttons locked. The result is dropped if the
// session moved on while waiting (timer ended, session discarded).
async function ask(label, call, apply) {
  if (busy) return;
  const id = session?.id, phase = session?.phase;
  busy = label; render();
  let result;
  try { result = await call(); } finally { busy = null; }
  if (session?.id === id && session?.phase === phase) apply(result);
  save(); render();
}

const thinking = () => (ai.activeProvider() === 'private' ? 'Gemma is thinking on this device…' : 'Finding a small step…');

// ---------- actions ----------
$('goal-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (busy) return;
  const goal = cleanGoal($('goal').value);
  const err = $('goal-error');
  if (!goal) { err.textContent = 'Type what you need to study first. A few words is enough.'; err.hidden = false; $('goal').focus(); return; }
  err.hidden = true;
  storage.setItem(LAST_GOAL, goal);
  busy = thinking(); render();
  let a;
  try { a = await ai.nextAction(goal); } finally { busy = null; }
  session = S.withAction(S.newSession(goal), a);
  log.append('goal_set', { sessionId: session.id });
  log.append('action_given', { sessionId: session.id, task: 'nextAction', source: a.source });
  save(); render();
  $('start-focus').focus();
});

async function stuck() {
  if (!session || busy) return;
  // Already at the smallest step there is: pressing again changes nothing.
  if (S.currentAction(session).source === 'smallest') return;
  session = S.markStuck(session);
  log.append('stuck', { sessionId: session.id, phase: session.phase });
  save();
  if (session.stuckRun > S.STUCK_LIMIT) {
    session = S.withAction(session, { ...SMALLEST_STEP, source: 'smallest' });
    save(); render(); return;
  }
  const tried = session.actions.map((a) => a.action);
  await ask(thinking(), () => ai.unstick(session.goal, tried, session.stuck), (a) => {
    session = S.withAction(session, a);
    log.append('action_given', { sessionId: session.id, task: 'unstick', source: a.source });
  });
}
$('ready-smaller').onclick = stuck;
$('stuck').onclick = stuck;

$('start-focus').onclick = () => {
  if (!session || busy) return;
  session = { ...S.start(session, duration), lastSeenAt: Date.now() };
  log.append('focus_start', { sessionId: session.id, minutes: session.durationMin });
  save(); render();
};

$('change-goal').onclick = () => { if (busy) return; $('goal').value = session?.goal || ''; session = null; save(); render(); $('goal').focus(); };

$('distracted').onclick = async () => {
  if (!session || busy || session.awaitingReturn) return;
  const drift = { f: elapsedFraction(session.startedAt, session.endsAt), returned: false };
  session = { ...S.markDistracted(session), pendingRecovery: null, drifts: [...(session.drifts || []), drift].slice(-24) };
  log.append('distracted', { sessionId: session.id });
  save();
  const doing = S.currentAction(session).action;
  await ask(thinking(), () => ai.recover(session.goal, doing, session.distracted), (a) => {
    session = { ...session, pendingRecovery: a };
    log.append('action_given', { sessionId: session.id, task: 'recover', source: a.source });
  });
  if (!$('back').hidden) $('back').focus();
};

$('back').onclick = () => {
  if (!session?.awaitingReturn || !session.pendingRecovery) return;
  const a = session.pendingRecovery;
  const drifts = (session.drifts || []).map((d, i, all) => (i === all.length - 1 ? { ...d, returned: true } : d));
  session = { ...S.withAction(S.markReturned(session), a), pendingRecovery: null, drifts, lastSeenAt: Date.now() };
  log.append('returned', { sessionId: session.id });
  save(); render();
};

async function complete() {
  if (session?.phase !== 'focusing') return;
  awayExpired = false;
  session = { ...S.finish(session), checkin: null };
  log.append('focus_end', { sessionId: session.id, minutes: session.durationMin, stuck: session.stuck, distracted: session.distracted, returned: session.returned });
  save(); render();
  const facts = { minutes: session.durationMin, distracted: session.distracted, returned: session.returned };
  const id = session.id;
  // The reflection is optional decoration: it never blocks the Done screen.
  const note = await ai.reflect(session.goal, facts).catch(() => ({ ...fallbackFor('reflect', facts), source: 'fallback' }));
  if (session?.id === id && session.phase === 'done') { session = { ...session, note }; save(); render(); }
}

function abandon() {
  if (!session) return;
  if (session.phase === 'focusing') log.append('abandoned', { sessionId: session.id, elapsedMin: Math.round((Date.now() - session.startedAt) / 60000) });
  awayExpired = false;
  session = null; save(); render();
}

$('expired-count').onclick = complete;
$('expired-discard').onclick = abandon;

confirmTwice($('end-early'), 'End session', 'Tap again to end this session', abandon);
confirmTwice($('wipe'), 'Delete my history', 'Tap again to delete everything', () => {
  log.clear(); store.clear(); storage.removeItem(LAST_GOAL); storage.removeItem(FEEDBACK);
  session = null; view = null; $('goal').value = ''; render();
});

function confirmTwice(button, label, confirmLabel, action) {
  let armed = null;
  const reset = () => { clearTimeout(armed); armed = null; button.textContent = label; };
  button.onclick = () => {
    if (armed) { reset(); action(); return; }
    button.textContent = confirmLabel;
    armed = setTimeout(reset, 4000);
  };
}

$('again').onclick = () => { session = null; save(); $('goal').value = storage.getItem(LAST_GOAL) || ''; render(); $('goal').focus(); };

$('open-progress').onclick = $('done-progress').onclick = () => { view = 'progress'; render(); };
$('progress-back').onclick = () => { view = null; render(); };

// ---------- accountability check-in ----------
// FocusLoop only knows two things: when it was last touched, and whether this
// tab was in the background. core/checkin.js decides when that is worth a question.
function openCheckin(due) {
  if (!due || busy || awayExpired) return;
  session = { ...session, checkin: { ...due, at: Date.now() } };
  save(); render();
}

function answerCheckin(answer) {
  if (!session?.checkin) return;
  log.append('checkin', { sessionId: session.id, reason: session.checkin.reason, answer });
  session = { ...session, checkin: null, lastSeenAt: Date.now() };
  save(); render();
}

$('checkin-back').onclick = () => answerCheckin('back');
// "I got distracted" hands over to the existing recovery flow, which asks Gemma for one small step.
$('checkin-distracted').onclick = () => { answerCheckin('distracted'); $('distracted').onclick(); };

function takeHiddenSince() {
  const t = Number(storage.getItem(HIDDEN_SINCE)) || null;
  storage.removeItem(HIDDEN_SINCE);
  return t;
}

// Any touch of FocusLoop counts as being here.
function seen() {
  if (session?.phase !== 'focusing' || session.checkin) return;
  session = { ...session, lastSeenAt: Date.now() };
  save();
}
document.addEventListener('pointerdown', seen);
document.addEventListener('keydown', seen);

document.addEventListener('visibilitychange', () => {
  if (session?.phase !== 'focusing') return;
  // Kept outside the session so that hiding the tab never rewrites the session itself.
  if (document.hidden) { storage.setItem(HIDDEN_SINCE, String(Date.now())); return; }
  openCheckin(checkinDue({ now: Date.now(), session, hiddenSince: takeHiddenSince() }));
});

// ---------- timer ----------
setInterval(() => {
  if (session?.phase !== 'focusing') return;
  if (S.isExpired(session) && !awayExpired) {
    // A session that ends with a check-in unanswered is not counted automatically:
    // the student is asked, the same way as when the timer ended with FocusLoop closed.
    if (session.checkin && !session.awaitingReturn) {
      log.append('checkin', { sessionId: session.id, reason: session.checkin.reason, answer: 'none' });
      awayExpired = true; render();
    } else complete();
    return;
  }
  if (!awayExpired) openCheckin(checkinDue({ now: Date.now(), session }));
  renderClock();
}, 250);

// ---------- Private Mode ----------
$('mode-chip').onclick = () => {
  const p = $('mode-panel'); p.hidden = !p.hidden;
  $('mode-chip').setAttribute('aria-expanded', String(!p.hidden));
};

$('private-toggle').onclick = () => {
  if (!support.ok || !onDevice) return;
  const st = onDevice.status().state;
  if (wantsPrivate && st !== 'error') { wantsPrivate = false; onDevice.stop(); }
  else { wantsPrivate = true; if (st === 'error') onDevice.stop(); onDevice.start(); }
  storage.setItem(PREF_PRIVATE, wantsPrivate ? '1' : '0');
  render();
};

// The model is about 760 MB. Some browsers fail to store a file that size
// (seen with a 1.2 GB site quota), and then it downloads again on the next visit.
async function checkStorageRoom() {
  try {
    await navigator.storage.persist?.();
    const kept = await caches.open('transformers-cache').then((c) => c.keys()).then((keys) => keys.some((k) => k.url.endsWith('.onnx_data')));
    storageNote = kept ? '' : ' This browser did not keep the model, so it will download again next time you open FocusLoop.';
  } catch { storageNote = ''; }
  renderMode();
}

// ---------- feedback ----------
$('feedback-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const s = summary(log.all());
  const text = [
    'FocusLoop first-use feedback',
    `Date: ${new Date().toLocaleString()}`,
    `Helped me start: ${$('fb-helped').value || '(not answered)'}`,
    `First step small enough: ${$('fb-step').value || '(not answered)'}`,
    `Confusing or annoying: ${$('fb-confusing').value.trim() || '(nothing written)'}`,
    `Would open it tomorrow: ${$('fb-again').value || '(not answered)'}`,
    `Sessions finished: ${s.sessions}, started: ${s.consistency.started}, drifted: ${s.recovery.distracted}, came back: ${s.recovery.returned}`,
    `Answering mode at the end: ${ai.activeProvider() === 'private' ? 'Private (on-device Gemma)' : 'Fast (hosted Gemma)'}`,
  ].join('\n');
  storage.setItem(FEEDBACK, text);
  const out = $('fb-output'); out.value = text;
  try { await navigator.clipboard.writeText(text); $('fb-status').textContent = 'Copied. Paste it in a message to whoever shared FocusLoop with you.'; out.hidden = true; }
  catch { out.hidden = false; out.select(); $('fb-status').textContent = 'Select the text below, copy it, and send it to whoever shared FocusLoop with you.'; }
});

// ---------- boot ----------
async function boot() {
  // A session whose timer ran out while the tab was closed is offered as
  // "count it or discard it" (the #expired panel) instead of being decided for the user.
  if (session?.phase === 'focusing' && S.isExpired(session)) awayExpired = true;
  // Reopening a tab that was closed or in the background counts as coming back to it.
  const hiddenSince = takeHiddenSince();
  if (session?.phase === 'focusing' && !awayExpired) {
    const due = checkinDue({ now: Date.now(), session, hiddenSince });
    if (due) { session = { ...session, checkin: { ...due, at: Date.now() } }; save(); }
  }
  // A refresh in the middle of a recovery request loses the answer; give a built-in one.
  if (session?.phase === 'focusing' && session.awaitingReturn && !session.pendingRecovery) {
    session = { ...session, pendingRecovery: { ...fallbackFor('recover', {}, session.distracted), source: 'fallback' } };
    save();
  }
  if (!session) $('goal').value = '';
  render();

  try { const r = await fetch('/api/config'); if (r.ok) config = await r.json(); } catch { /* Fast Mode will report itself unavailable per request */ }
  support = await checkSupport();
  const modelHost = storage.getItem('focusloop.modelHost') || config.modelHost || null;
  onDevice = createOnDevice({ modelHost: modelHost ? new URL(modelHost, location.href).href : null, onStatus: (st) => { renderMode(); if (st.state === 'ready') checkStorageRoom(); } });
  ai = createAI({ fast: createFastProvider(), onDevice, wantsPrivate: () => wantsPrivate });
  if (wantsPrivate && support.ok) onDevice.start();
  render();
}
boot();
