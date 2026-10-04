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
