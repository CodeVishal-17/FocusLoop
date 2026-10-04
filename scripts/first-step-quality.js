// Checks for "small enough to start, meaningful enough to count as studying".
// Used by the unit tests and by scripts/eval-first-step.js on real model output.
// A first step has to be studying, not getting ready to study. "Open your
// textbook index" lowers the barrier but teaches nothing; the student's next
// thought is "then what?".
const STUDY_VERB = /\b(read|solve|write|recall|explain|trace|answer|define|describe|summari[sz]e|calculate|derive|draw|state|say|recite|list|name|work|copy|test|run|compare|label|sketch|translate|prove|simplify|differentiate|integrate|convert|identify|underline)\b/i;
const STUDY_OBJECT = /\b(definitions?|problems?|examples?|paragraph|sentences?|equations?|formulas?|questions?|concepts?|terms?|functions?|rule|law|theorem|subsection|section on|steps?|points?|idea|program|code|reaction|diagram|proof|derivation)\b/i;
const NAVIGATION = /\b(index|table of contents|contents page|headings?|titles?|cover|page numbers?|chapter (names?|titles?|list))\b/i;

export function isSetupOnly(action) {
  const s = String(action ?? '');
  if (!STUDY_VERB.test(s)) return true;
  // Reading the index or a heading is still navigation.
  return NAVIGATION.test(s) && !STUDY_OBJECT.test(s);
}

// Vague goals that exposed setup-only first steps, with loose subject matchers:
// the subject's name or any of its basic concepts counts.
export const VAGUE_GOALS = [
  { goal: 'I want to study Operating Systems', subject: /operating systems?|\bOS\b|process|thread|schedul|kernel|deadlock|memory|paging|semaphore|system call/i },
  { goal: 'I need to study DBMS', subject: /DBMS|database|table|key|SQL|relation|normali[sz]|schema|tuple|query|entity/i },
  { goal: 'I have a physics exam', subject: /physics|newton|law|force|motion|energy|veloc|accelerat|formula|equation|momentum|kinematic/i },
  { goal: 'I need to study calculus', subject: /calculus|derivative|differentiat|integra|limit|function|chain rule|power rule/i },
  { goal: 'I want to practice Python', subject: /python|function|loop|list|print|variable|string|program|script|code/i },
];

const words = (s) => s.trim().split(/\s+/).length;

export function assessFirstStep(action, subject) {
  const a = String(action ?? '');
  const problems = [];
  if (isSetupOnly(a)) problems.push('setup-only');
  if (subject && !subject.test(a)) problems.push('does not mention the subject');
  if (a.length > 140 || words(a) > 28) problems.push('too long');
  const sentences = a.split(/[.!?](?:\s|$)/).filter((s) => s.trim()).length;
  if (/\n|^\s*(\d+[.)]|[-*•])\s/m.test(a) || sentences > 2 || (a.match(/\bthen\b/gi) || []).length > 1) problems.push('more than one action');
  return problems;
}
