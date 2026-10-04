// Parses and validates what the model returned. Returns null when unusable.

export const MAX_GOAL = 300;
export const MAX_ACTION = 140;
const MAX_NOTE = 160;

export function cleanGoal(raw) {
  return String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_GOAL);
}

function firstJsonObject(text) {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0, inString = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; }
    }
  }
  return null;
}

function cleanSentence(raw, max) {
  if (typeof raw !== 'string') return null;
  let s = raw.replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim();
  if (s.length < 8) return null;
  // A 1B model sometimes invents links; an action never needs one.
  if (/https?:\/\/|www\./i.test(s)) return null;
  if (s.length > max) {
    const cut = s.slice(0, max);
    s = cut.slice(0, Math.max(cut.lastIndexOf(' '), 40)).replace(/[,;:\s]+$/, '') + '…';
  }
  return s;
}

// "Read the first chapter" is a plan, not a first step. The prompt asks for
// tiny steps; this is the code-side check for when the model ignores it.
const TOO_BIG = /\b(read|skim|study|finish|complete|review|revise)\s+(through\s+)?((the|your|a|an)\s+)?((whole|entire|first|next|full)\s+)?(chapter|unit|syllabus|textbook|book)\b/i;

export function parseAction(text) {
  const o = firstJsonObject(String(text ?? ''));
  if (!o || Array.isArray(o)) return null;
  const action = cleanSentence(o.action, MAX_ACTION);
  if (!action || TOO_BIG.test(action)) return null;
  const n = Math.round(Number(o.minutes));
  const minutes = Number.isFinite(n) ? Math.min(5, Math.max(1, n)) : 3;
  return { action, minutes };
}

export function parseNote(text) {
  const o = firstJsonObject(String(text ?? ''));
  if (!o || Array.isArray(o)) return null;
  const note = cleanSentence(o.note, MAX_NOTE);
  return note ? { note } : null;
}

export function parseFor(task, text) {
  return task === 'reflect' ? parseNote(text) : parseAction(text);
}
