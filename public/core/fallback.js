// Built-in steps used when no model answers in time. They are shown to the
// user as fallbacks, never as Gemma's answer.
const STEPS = {
  nextAction: [
    // Generic across subjects, but each one is studying, not getting ready to.
    'Read one definition from your current topic and write what it means in your own words.',
    'Write three key terms from this subject from memory, then check them against your notes.',
    'Trace one worked example from your current topic line by line, writing each step yourself.',
  ],
  unstick: [
    'Write down the exact line where you got stuck, word for word.',
    'Read the last paragraph you understood once more, then stop.',
    'Copy one worked example from your material onto paper, line by line.',
    'Write one question about this topic that you cannot answer yet.',
  ],
  recover: [
    'Put your phone face down out of reach, then read the last line you remember.',
    'Write one sentence about what you were doing before you drifted.',
    'Open the page you were on and read only the next two lines.',
  ],
};

// The smallest possible step, used when "I'm stuck" is pressed several times in a row.
export const SMALLEST_STEP = { action: 'Read one sentence from your material out loud. Only one.', minutes: 1 };

export function fallbackFor(task, input = {}, n = 0) {
  if (task === 'reflect') {
    const m = Math.round(Number(input.minutes) || 0);
    const back = Number(input.returned) || 0;
    return { note: back > 0 ? `You focused for ${m} minutes and came back ${back} time${back === 1 ? '' : 's'} after drifting.` : `You focused for ${m} minutes.` };
  }
  const list = STEPS[task] || STEPS.nextAction;
  return { ...{ action: list[Math.abs(n) % list.length], minutes: 2 } };
}
