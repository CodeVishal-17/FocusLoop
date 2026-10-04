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
  'Use only the subject or topic that appears in the goal. Never borrow a subject or concept from the examples.',
  'If the goal turns out to name no real subject, or is not about studying, never refuse, never ask for a subject and never invent one: the action is then to pick one topic they need to study, read its first definition and restate it in their own words.',
  'Reply with JSON only: {"action": "<one sentence, max 25 words>", "minutes": <integer 1-5>}',
].join(' ');

// Used when the goal names no subject ("I don't feel like studying"). A small
// model copies nouns from whatever it is shown: with subject examples in view,
// Gemma 3 1B answered such goals with economics, biology or photosynthesis.
// Telling it not to did not help; showing it nothing to copy does. So this
// prompt and its examples contain no subject, concept or example topic at all.
const FIRST_STEP_NO_SUBJECT = [
  'The student wants to study but has not said what. Give ONE tiny first study action that works for any subject.',
  'Have them pick one topic they need to study and do something real with it: read its first definition and restate it, write the first question they want answered about it, or write what they already remember and check it.',
  'Never name or guess a subject, a concept, or an example topic of your own. Use only neutral words such as topic, definition, question, notes.',
  'It takes 1 to 5 minutes. Never give a setup-only step such as opening a book or finding notes.',
  'One sentence, at most 25 words. Never give lists, plans, advice about breathing or feelings, or motivation.',
  'Reply with JSON only: {"action": "<one sentence, max 25 words>", "minutes": <integer 1-5>}',
].join(' ');

const SYSTEM = {
  nextAction: FIRST_STEP,
  unstick: `A student is stuck on a study step. Give a smaller, easier step on the same subject that is different from the steps already tried. ${RULES} ${ACTION_JSON}`,
  recover: `A student got distracted by their phone during a study session and has just come back. Do not judge or mention the distraction. Give one tiny step that gets them back into the same subject. ${RULES} ${ACTION_JSON}`,
  reflect: 'A student finished a study session. Write one short, plain sentence about what went well, using the facts given. No praise words like "amazing", no advice, no questions. Reply with JSON only: {"note": "<one sentence, max 20 words>"}',
};

const SHOTS = {
  // Subject examples teach the kinds of real first step: restate, recall, solve.
  nextAction: [
    ['Goal: I need to study biology', '{"action": "Read the definition of osmosis in your biology notes, then write one everyday example of it.", "minutes": 3}'],
    ['Goal: economics exam tomorrow, havent started', '{"action": "Write the law of demand from memory in one sentence, then check it against your economics notes.", "minutes": 2}'],
    ['Goal: statistics homework', '{"action": "Solve the first mean and median problem in your statistics exercise without looking at the solution.", "minutes": 4}'],
  ],
  // Shown instead of the set above when the goal names no subject. Nothing here can leak.
  nextActionNoSubject: [
    ['Goal: i dont feel like doing anything', '{"action": "Write down the name of one topic you need to study, then read its first definition.", "minutes": 2}'],
    ['Goal: everything is due and i am lost', '{"action": "Choose one topic you need to study and write the first question you want to answer about it.", "minutes": 2}'],
    ['Goal: cant make myself begin', '{"action": "Pick the topic you looked at last, write two things you remember about it, then check them in your notes.", "minutes": 3}'],
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

// Words that say something about studying, feelings, time or quantity but never
// name what is being studied. A goal made only of these names no subject.
const GENERIC_WORDS = new Set(`a about again all already always am an and any anything are as at be because been before begin beginning behind big bored but
by can cannot cant could day days do doing don dont due else even every everything exam exams feel feeling feels finish first focus for from get getting go going got had hard has
have havent help here hours how i idea if im in is it its just keep know later lazy learn learning like lost lot lots make me motivated motivation much must my myself
need never next no not nothing now of on one or out overwhelmed please prepare procrastinating really revise revision should so some something start started starting still stressed
stuck studied studies study studying stuff subject subjects t than that the there thing things this time tired to today tomorrow tonight too topic topics up
ve very want was week what when where which why will with work would yet you
d ll m re s homework assignment assignments test tests class classes course college school
afraid angry anxious anymore awful bad boring concentrate depressed distracted down exhausted fine good guess happy hate hmm honestly hopeless idk instagram
kinda lol love maybe mood nervous ok okay phone pls reels sad scared scrolling sleepy sorry stress sucks terrible thanks ugh unmotivated upset worried
worse yeah youtube`.split(/\s+/));

// True when the goal contains at least one word that could be a subject or topic.
// Anything not on the generic list counts, so an unknown word is treated as a
// subject and passed to the model as the student wrote it.
export function namesSubject(goal) {
  const words = cleanGoal(goal).toLowerCase().match(/[\p{L}\p{N}+#]+/gu) || [];
  return words.some((w) => !GENERIC_WORDS.has(w));
}

export function buildMessages(task, input = {}) {
  if (!TASKS.includes(task)) throw new Error(`unknown task: ${task}`);
  if (!cleanGoal(input.goal)) throw new Error('goal is required');
  const neutral = task === 'nextAction' && !namesSubject(input.goal);
  return [
    { role: 'system', content: neutral ? FIRST_STEP_NO_SUBJECT : SYSTEM[task] },
    ...(neutral ? SHOTS.nextActionNoSubject : SHOTS[task]).flatMap(([u, a]) => [{ role: 'user', content: u }, { role: 'assistant', content: a }]),
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
