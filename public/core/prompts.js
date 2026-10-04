// Prompt design for a small model (Gemma 3 1B):
// - one job per task, stated as hard rules
// - few-shot examples as real user/assistant turns (examples inside the system
//   prompt made the model echo them)
// - JSON only, so application code can validate and fall back
import { cleanGoal } from './validate.js';

export const TASKS = ['nextAction', 'unstick', 'recover', 'reflect'];

const ACTION_JSON = 'Reply with JSON only: {"action": "<one sentence, max 20 words>", "minutes": <integer 1-5>}';
const RULES = "The action must start with a verb like Open, Write, Read, Solve or Find, must use the student's own subject, and must take under 5 minutes. Keep it tiny: one paragraph, one problem or one line, never a whole chapter. If the goal is not about studying, give a step for opening their study material anyway. Exactly one action. Never give lists, advice about breathing or feelings, or motivation.";

const SYSTEM = {
  nextAction: `You turn a student's study goal into the first physical action with their study material. ${RULES} ${ACTION_JSON}`,
  unstick: `A student is stuck on a study step. Give a smaller, easier step on the same subject that is different from the steps already tried. ${RULES} ${ACTION_JSON}`,
  recover: `A student got distracted by their phone during a study session and has just come back. Do not judge or mention the distraction. Give one tiny step that gets them back into the same subject. ${RULES} ${ACTION_JSON}`,
  reflect: 'A student finished a study session. Write one short, plain sentence about what went well, using the facts given. No praise words like "amazing", no advice, no questions. Reply with JSON only: {"note": "<one sentence, max 20 words>"}',
};

const SHOTS = {
  nextAction: [
    ['Goal: I need to study DBMS', '{"action": "Open your DBMS notes and read only the first heading and its first paragraph.", "minutes": 3}'],
    ['Goal: physics exam tomorrow, havent started', '{"action": "Write the names of the physics exam chapters on one sheet of paper.", "minutes": 2}'],
    ['Goal: i dont feel like doing anything', '{"action": "Put your phone in another room, then open the book you need to any page.", "minutes": 2}'],
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
