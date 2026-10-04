// "Small enough to start, meaningful enough to count as studying."
// These tests cover what plain code controls: the prompt, its examples, the
// built-in fallbacks and the checker. What a real model returns for the same
// goals is checked by scripts/eval-first-step.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMessages } from '../public/core/prompts.js';
import { parseAction } from '../public/core/validate.js';
import { fallbackFor } from '../public/core/fallback.js';
import { VAGUE_GOALS, assessFirstStep, isSetupOnly } from '../scripts/first-step-quality.js';

test('checker: setup-only steps are recognised', () => {
  for (const bad of [
    'Open your Operating Systems textbook index.',
    'Open your DBMS notes.',
    'Open your physics book.',
    'Open your DBMS textbook to the table of contents.',
    'Find your notes and sit at your desk.',
    'Get your notebook.',
    'Open the notes or book for this subject and read only the first heading.',
    'Open the DBMS course syllabus and scan the headings.',
  ]) assert.equal(isSetupOnly(bad), true, bad);
});

test('checker: real study steps pass, in more than one wording', () => {
  for (const good of [
    'Read the definition of a process in your Operating Systems notes, then write what a process is in one sentence.',
    'Read the definition of a primary key and write one example of a table that uses one.',
    "Write the equation for Newton's second law from memory, then check it against your notes.",
    'Solve the first derivative problem in your current calculus exercise without looking at the solution.',
    'Write a Python function that returns the larger of two numbers, then test it with 3 and 7.',
    'Recall three terms from the chapter without looking, then check them.',
    'Trace one worked example of the power rule line by line.',
    'Open your notes and read the definition of normalization, then explain it out loud.',
  ]) assert.equal(isSetupOnly(good), false, good);
});

test('checker: flags lists, mini-plans, over-long and off-subject steps', () => {
  const os = VAGUE_GOALS[0].subject;
  assert.deepEqual(assessFirstStep('Read the definition of a process, then write it in one sentence.', os), []);
  assert.ok(assessFirstStep('1. Read the definition of a process\n2. Write it down', os).includes('more than one action'));
  assert.ok(assessFirstStep('Read the definition of a process, then write it, then solve a problem, then rest.', os).includes('more than one action'));
  assert.ok(assessFirstStep('Read one paragraph and write the main idea.', os).includes('does not mention the subject'));
  assert.ok(assessFirstStep(`Read the definition of a process ${'and think about it carefully '.repeat(8)}`, os).includes('too long'));
});

test('nextAction prompt asks for real studying and rules out setup-only steps', () => {
  for (const { goal } of VAGUE_GOALS) {
    const messages = buildMessages('nextAction', { goal });
    const system = messages[0].content;
    assert.match(system, /real studying/);
    assert.match(system, /setup-only/);
    assert.match(system, /1 to 5 minutes/);
    assert.match(system, /One sentence/);
    assert.equal(messages.at(-1).content, `Goal: ${goal}`);
  }
});

test('nextAction examples practise what the prompt asks for', () => {
  const messages = buildMessages('nextAction', { goal: 'anything' });
  const examples = messages.filter((m) => m.role === 'assistant').map((m) => parseAction(m.content));
  assert.ok(examples.length >= 3);
  for (const ex of examples) {
    assert.ok(ex, 'every example passes the product validation');
    assert.deepEqual(assessFirstStep(ex.action).filter((p) => p !== 'does not mention the subject'), [], ex.action);
  }
  // The examples must not all be the same kind of step.
  const openers = new Set(examples.map((e) => e.action.split(' ')[0].toLowerCase()));
  assert.ok(openers.size >= 3, [...openers].join(', '));
  // And none of them uses the subjects under test, so a model cannot pass by copying.
  const all = examples.map((e) => e.action).join(' ');
  assert.doesNotMatch(all, /operating system|DBMS|physics|calculus|python/i);
});

test('built-in first steps are study actions for every vague goal', () => {
  for (const { goal } of VAGUE_GOALS) {
    for (let n = 0; n < 3; n++) {
      const step = fallbackFor('nextAction', { goal }, n);
      assert.ok(parseAction(JSON.stringify(step)), `passes product validation: ${step.action}`);
      // Fallbacks are generic by design, so the subject is not required here.
      assert.deepEqual(assessFirstStep(step.action), [], step.action);
      assert.doesNotMatch(step.action, /open (your|the) (textbook|notes|book)|find your (book|notes)|first heading|index/i);
      assert.ok(step.minutes >= 1 && step.minutes <= 5);
    }
  }
  assert.equal(new Set([0, 1, 2].map((n) => fallbackFor('nextAction', {}, n).action)).size, 3);
});

// --- no subject in the goal: the model must not invent one ---
import { namesSubject } from '../public/core/prompts.js';
import { NO_SUBJECT_GOALS, inventedSubject } from '../scripts/first-step-quality.js';

const REPORTED = ["I don't feel like studying", "I don't know what to study", "I need to study but I can't start"];

test('goals without a subject are recognised by rule, not by a list of sentences', () => {
  for (const goal of [...REPORTED, ...NO_SUBJECT_GOALS, 'I have an exam tomorrow', "i'm so behind, it's all due", 'need to start my homework', 'help me begin', 'ugh', 'I feel sad and unmotivated', 'I keep scrolling instagram']) {
    assert.equal(namesSubject(goal), false, goal);
  }
  // Known limit: any word the rule does not know counts as a possible subject.
  for (const goal of ['asdfgh qwerty', 'write me a poem']) assert.equal(namesSubject(goal), true, goal);
  for (const goal of [...VAGUE_GOALS.map((g) => g.goal), 'maths', 'study C', 'R programming', 'organic chemistry reactions', 'padhai karni hai physics ki', "I don't feel like studying thermodynamics"]) {
    assert.equal(namesSubject(goal), true, goal);
  }
});

test('contamination checker catches the reported leaks and passes neutral steps', () => {
  for (const leaked of [
    'Trace one worked example of a simple market analysis, focusing on a single economic indicator.',
    'Write the basic concept of a binary search algorithm in your notes, then check it against your understanding.',
    'Trace one worked example of a simple supply and demand graph.',
    'Read the definition of photosynthesis in your biology notes, then write one example of how it works.',
    'Recall the formula for slope and find the value in your math notes.',
    'Write a Python function that adds two numbers.',
    'Read the definition of a process in your Operating Systems notes.',
    'Read the definition of a primary key in your DBMS notes.',
    'Solve the first calculus problem in your exercise.',
    "Write Newton's second law from memory for your physics exam.",
  ]) assert.ok(inventedSubject(leaked), leaked);
  for (const neutral of [
    'Write down the name of one topic you need to study, then read its first definition.',
    'Choose one topic you need to study and write the first question you want to answer about it.',
    'Pick one topic and write its first definition in your own words.',
    'Read the first definition of one topic and restate it in your own words.',
  ]) assert.equal(inventedSubject(neutral), null, neutral);
});

test('a no-subject goal is shown nothing a model could copy a subject from', () => {
  for (const goal of [...REPORTED, ...NO_SUBJECT_GOALS]) {
    const messages = buildMessages('nextAction', { goal });
    const shown = messages.slice(0, -1).map((m) => m.content).join('\n');
    assert.equal(inventedSubject(shown), null, `prompt for "${goal}" contains: ${inventedSubject(shown)}`);
    assert.match(messages[0].content, /Never name or guess a subject/);
    assert.match(messages[0].content, /setup-only/);
    assert.equal(messages.at(-1).content, `Goal: ${goal}`);
    const examples = messages.filter((m) => m.role === 'assistant').map((m) => parseAction(m.content));
    assert.ok(examples.length >= 2);
    for (const ex of examples) assert.deepEqual(assessFirstStep(ex.action), [], ex.action);
  }
});

test('a goal with a subject still gets the subject examples and the no-borrowing rule', () => {
  const messages = buildMessages('nextAction', { goal: 'I need to study DBMS' });
  assert.match(messages[0].content, /Never borrow a subject or concept from the examples/);
  assert.ok(messages.some((m) => m.role === 'assistant' && /osmosis/.test(m.content)));
});

test('the other tasks are unaffected by subject detection', () => {
  for (const task of ['unstick', 'recover', 'reflect']) {
    const withSubject = buildMessages(task, { goal: 'study DBMS', tried: ['x'], action: 'x', minutes: 5 });
    const without = buildMessages(task, { goal: "I don't feel like studying", tried: ['x'], action: 'x', minutes: 5 });
    assert.equal(withSubject[0].content, without[0].content);
    assert.equal(withSubject.length, without.length);
  }
});

test('built-in first steps invent no subject either', () => {
  for (const goal of REPORTED) for (let n = 0; n < 3; n++) assert.equal(inventedSubject(fallbackFor('nextAction', { goal }, n).action), null);
});
