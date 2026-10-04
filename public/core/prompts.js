// Prompt design for a small model (Gemma 3 1B):
// - one job per task, stated as hard rules
// - few-shot examples as real user/assistant turns (examples inside the system
//   prompt made the model echo them)
// - JSON only, so application code can validate and fall back
import { cleanGoal } from './validate.js';

export const TASKS = ['nextAction', 'unstick', 'recover', 'reflect'];

const ACTION_JSON = 'Reply with JSON only: {"action": "<one sentence, max 20 words>", "minutes": <integer 1-5>}';
const RULES = "The action must start with a verb like Open, Write, Read, Solve or Find, must use the student's own subject, and must take under 5 minutes. Keep it tiny: one paragraph, one problem or one line, never a whole chapter. If the goal is not about studying, give a step for opening their study material anyway. Exactly one action. Never give lists, advice about breathing or feelings, or motivation.";

// The first step must be small enough to start and still be real studying.
// "Open your textbook index" passes the first test and fails the second.
const FIRST_STEP = [
  "You turn a student's study goal into ONE tiny first study action they can do right now with their normal notes or book.",
  'The action must be real studying on one specific basic concept of their subject: read one definition and restate it, solve one problem, recall something from memory and check it, trace one worked example, or write one sentence of explanation. Name the concept.',
  'Match the action to the subject. For problem subjects such as maths or programming, or when the student says practice, have them solve one small problem or write a few lines of code. For concept subjects, assume they have not studied it yet: have them read the concept in their notes before explaining or writing about it.',
  'It takes 1 to 5 minutes and leaves the student in the middle of the material.',
  'Never give a setup-only step such as opening a book, finding notes, or reading an index, table of contents or heading, unless the student says getting set up is their problem.',
  'One sentence, at most 25 words. Never give lists, plans, advice about breathing or feelings, or motivation.',
  'If the goal names no subject or is not about studying, give a study action on whatever topic they are currently on.',
  'Reply with JSON only: {"action": "<one sentence, max 25 words>", "minutes": <integer 1-5>}',
].join(' ');

const SYSTEM = {
  nextAction: FIRST_STEP,
  unstick: `A student is stuck on a study step. Give a smaller, easier step on the same subject that is different from the steps already tried. ${RULES} ${ACTION_JSON}`,
  recover: `A student got distracted by their phone during a study session and has just come back. Do not judge or mention the distraction. Give one tiny step that gets them back into the same subject. ${RULES} ${ACTION_JSON}`,
  reflect: 'A student finished a study session. Write one short, plain sentence about what went well, using the facts given. No praise words like "amazing", no advice, no questions. Reply with JSON only: {"note": "<one sentence, max 20 words>"}',
};

const SHOTS = {
  nextAction: [
    // One example per kind of real first step: restate, recall, solve, and the no-subject case.
    ['Goal: I need to study biology', '{"action": "Read the definition of osmosis in your biology notes, then write one everyday example of it.", "minutes": 3}'],
    ['Goal: economics exam tomorrow, havent started', '{"action": "Write the law of demand from memory in one sentence, then check it against your economics notes.", "minutes": 2}'],
    ['Goal: statistics homework', '{"action": "Solve the first mean and median problem in your statistics exercise without looking at the solution.", "minutes": 4}'],
    ['Goal: i dont feel like doing anything', '{"action": "Read one definition from the topic you are on and say it out loud in your own words.", "minutes": 2}'],
  ],
  unstick: [
    ['Goal: I need to study DBMS\nAlready tried: Open your DBMS notes and read the first heading and its first paragraph.', '{"action": "Write the title of the first DBMS topic at the top of a blank page.", "minutes": 1}'],
    ['Goal: maths integration\nAlready tried: Solve the first integration problem in the exercise. | Read the solved example before the exercise.', '{"action": "Copy the first solved integration example into your notebook, line by line.", "minutes": 4}'],
  ],
  recover: [
    ['Goal: I need to study DBMS\nWas doing: Read the section on normalization.', '{"action": "Read the last DBMS line you remember and write it in your own words.", "minutes": 2}'],
    ['Goal: organic chemistry reactions\nWas doing: Write the first reaction mechanism from the chapter.', '{"action": "Find the organic chemistry reaction you stopped at and redraw only its first arrow.", "minutes": 2}'],
  ],
  reflect: [
    ['Goal: I need to study DBMS\nFocused minutes: 15\nTimes distracted: 2\nTimes returned: 2', '{"note": "You studied DBMS for 15 minutes and came back both times you drifted."}'],
    ['Goal: maths integration\nFocused minutes: 25\nTimes distracted: 0\nTimes returned: 0', '{"note": "You stayed with integration for a full 25 minutes without drifting."}'],
  ],
};

function line(s) { return cleanGoal(s).slice(0, 160); }

function userTurn(task, input) {
  const goal = `Goal: ${cleanGoal(input.goal)}`;
  if (task === 'unstick') {
    const tried = (input.tried || []).slice(-4).map(line).filter(Boolean).join(' | ');
    return `${goal}\nAlready tried: ${tried || 'nothing yet'}`;
  }
  if (task === 'recover') return `${goal}\nWas doing: ${line(input.action) || 'studying'}`;
  if (task === 'reflect') {
    const goal = `Goal: ${cleanGoal(input.goal).slice(0, 80)}`;
    const n = (v) => Math.max(0, Math.min(999, Math.round(Number(v) || 0)));
    return `${goal}\nFocused minutes: ${n(input.minutes)}\nTimes distracted: ${n(input.distracted)}\nTimes returned: ${n(input.returned)}`;
  }
  return goal;
}

export function buildMessages(task, input = {}) {
  if (!TASKS.includes(task)) throw new Error(`unknown task: ${task}`);
  if (!cleanGoal(input.goal)) throw new Error('goal is required');
  return [
    { role: 'system', content: SYSTEM[task] },
    ...SHOTS[task].flatMap(([u, a]) => [{ role: 'user', content: u }, { role: 'assistant', content: a }]),
    { role: 'user', content: userTurn(task, input) },
  ];
}

// JSON schema for runtimes that can constrain output (Ollama).
export function schemaFor(task) {
  return task === 'reflect'
    ? { type: 'object', properties: { note: { type: 'string' } }, required: ['note'] }
    : { type: 'object', properties: { action: { type: 'string' }, minutes: { type: 'integer' } }, required: ['action', 'minutes'] };
}

// Varied answers matter when the student asks again; the first step should be stable.
export function temperatureFor(task, attempt = 0) {
  if (task === 'unstick') return 0.8;
  return attempt === 0 ? 0.2 : 0.7;
}
