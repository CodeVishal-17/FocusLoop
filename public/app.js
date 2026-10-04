// UI wiring. All decisions about time, counts and scores are plain code in
// core/; Gemma is only asked for the words of the next step.
import { cleanGoal } from './core/validate.js';
import { createLog } from './core/events.js';
import { summary } from './core/stats.js';
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

const storage = safeStorage();
const log = createLog(storage);
const store = S.createSessionStore(storage);

let session = store.load();
let busy = null;            // text shown while a model call is running
let awayExpired = false;    // the timer ran out while the tab was closed
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

const SOURCE_LABEL = {
  fast: '⚡ Fast Mode — hosted Gemma',
  private: '🔒 Private Mode — Gemma running on this device',
  fallback: "Built-in step — Gemma didn't give a usable answer, so this one is from FocusLoop itself",
  smallest: 'Built-in step — the smallest one there is',
};

// ---------- rendering ----------
function render() {
  const phase = session?.phase || 'start';
  $('screen-start').hidden = phase !== 'start';
  $('screen-ready').hidden = phase !== 'ready';
  $('screen-focus').hidden = phase !== 'focusing';
  $('screen-done').hidden = phase !== 'done';

  if (phase === 'ready') {
    const a = S.currentAction(session);
    $('ready-action').textContent = a.action;
    $('ready-source').textContent = SOURCE_LABEL[a.source];
    $('duration-options').replaceChildren(...S.DURATIONS.map((m) => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = `${m} min`; b.setAttribute('aria-pressed', String(m === duration));
      b.onclick = () => { duration = m; storage.setItem(PREF_DURATION, String(m)); render(); };
      return b;
    }));
  }

  if (phase === 'focusing') {
    const expired = awayExpired;
    const a = S.currentAction(session);
    $('focus-goal').textContent = session.goal;
    $('focus-action').textContent = a.action;
    $('focus-source').textContent = SOURCE_LABEL[a.source];
    $('focus-main').hidden = expired || session.awaitingReturn;
    $('recovery').hidden = expired || !session.awaitingReturn;
    $('expired').hidden = !expired;
    if (session.awaitingReturn) {
      const r = session.pendingRecovery;
      $('recovery-action').textContent = r ? r.action : 'One moment…';
      $('recovery-source').textContent = r ? SOURCE_LABEL[r.source] : '';
      $('back').hidden = !r;
    }
    renderClock();
  }

  if (phase === 'done') {
    const goal = session.goal.length > 60 ? `${session.goal.slice(0, 57).trimEnd()}…` : session.goal;
    const parts = [`${session.durationMin} minutes on “${goal}”.`];
    if (session.distracted) parts.push(`Drifted ${session.distracted} time${session.distracted === 1 ? '' : 's'}, came back ${session.returned}.`);
    $('done-facts').textContent = parts.join(' ');
    $('done-note').textContent = session.note?.note || '';
    $('done-source').textContent = !session.note ? '' : session.note.source === 'fallback' ? "Written by FocusLoop itself — Gemma didn't give a usable answer" : SOURCE_LABEL[session.note.source];
  }

  $('busy').hidden = !busy;
  $('busy').textContent = busy || '';
  for (const b of document.querySelectorAll('main button')) b.disabled = !!busy;
  $('goal').disabled = !!busy;

  if (phase !== 'focusing') document.title = 'FocusLoop';
  renderStats();
  renderMode();
}

function renderClock() {
  if (session?.phase !== 'focusing') { document.title = 'FocusLoop'; return; }
  const text = S.formatClock(S.remainingMs(session));
  $('clock').textContent = text;
  document.title = `${text} · FocusLoop`;
}

function renderStats() {
  const s = summary(log.all());
  const cells = [
    [s.streak ? `${s.streak} day${s.streak === 1 ? '' : 's'}` : '—', 'Streak'],
    [String(s.sessions), `Sessions finished${s.today ? ` (${s.today} today)` : ''}`],
    [s.recovery.distracted ? `${s.recovery.returned} of ${s.recovery.distracted}` : '—', 'Times you came back after drifting (7 days)'],
    [s.consistency.started ? `${s.consistency.completed} of ${s.consistency.started}` : '—', 'Sessions finished once started'],
  ];
  $('stats').replaceChildren(...cells.map(([value, label]) => {
    const d = document.createElement('div'); d.className = 'stat';
    const b = document.createElement('b'); b.textContent = value;
    const sp = document.createElement('span'); sp.textContent = label;
    d.append(b, sp); return d;
  }));
}

function renderMode() {
  const active = ai.activeProvider();
  const st = onDevice?.status() || { state: 'off' };
  const chip = $('mode-chip');
  chip.classList.toggle('private', active === 'private');
  const loading = wantsPrivate && (st.state === 'downloading' || st.state === 'warming');
  chip.textContent = active === 'private' ? '🔒 Private Mode' : loading ? '⚡ Fast Mode · 🔒 getting ready…' : '⚡ Fast Mode';

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

const thinking = () => (ai.activeProvider() === 'private' ? 'Gemma is thinking on this device…' : 'Gemma is thinking…');

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
  session = S.start(session, duration);
  log.append('focus_start', { sessionId: session.id, minutes: session.durationMin });
  save(); render();
};

$('change-goal').onclick = () => { if (busy) return; $('goal').value = session?.goal || ''; session = null; save(); render(); $('goal').focus(); };

$('distracted').onclick = async () => {
  if (!session || busy || session.awaitingReturn) return;
  session = { ...S.markDistracted(session), pendingRecovery: null };
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
  session = { ...S.withAction(S.markReturned(session), a), pendingRecovery: null };
  log.append('returned', { sessionId: session.id });
  save(); render();
};

async function complete() {
  if (session?.phase !== 'focusing') return;
  awayExpired = false;
  session = S.finish(session);
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

confirmTwice($('end-early'), 'End session early', 'Tap again to end this session', abandon);
confirmTwice($('wipe'), 'Delete my history', 'Tap again to delete everything', () => {
  log.clear(); store.clear(); storage.removeItem(LAST_GOAL); storage.removeItem(FEEDBACK);
  session = null; $('goal').value = ''; render();
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

// ---------- timer ----------
setInterval(() => {
  if (session?.phase !== 'focusing') return;
  if (S.isExpired(session) && !awayExpired) complete(); else renderClock();
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
