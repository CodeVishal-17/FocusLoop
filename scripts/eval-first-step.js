// First-step quality check on a real model: asks for the first step for each
// vague goal twice (the normal call and the more varied retry call) and prints
// exactly what came back, with any quality problems. Nothing is filtered out.
// Local Gemma:   node scripts/eval-first-step.js
// Hosted Gemma:  node --env-file=.env scripts/eval-first-step.js
import { buildMessages, schemaFor, temperatureFor } from '../public/core/prompts.js';
import { parseFor } from '../public/core/validate.js';
import { adapterFromEnv } from '../server/server.js';
import { VAGUE_GOALS, assessFirstStep } from './first-step-quality.js';

const adapter = adapterFromEnv();
let good = 0, total = 0;
for (const { goal, subject } of VAGUE_GOALS) {
  for (const attempt of [0, 1]) {
    total++;
    let text;
    try { text = await adapter.generate({ messages: buildMessages('nextAction', { goal }), schema: schemaFor('nextAction'), temperature: temperatureFor('nextAction', attempt) }); } catch (e) { text = `ERROR ${e.message}`; }
    const parsed = parseFor('nextAction', text);
    const problems = parsed ? assessFirstStep(parsed.action, subject) : ['rejected by validation'];
    if (!problems.length) good++;
    console.log(`${problems.length ? 'WEAK' : 'ok  '} ${goal.padEnd(34)} -> ${parsed ? `${parsed.action} (${parsed.minutes} min)` : String(text).slice(0, 140)}${problems.length ? `   [${problems.join(', ')}]` : ''}`);
  }
}
console.log(`\n${adapter.name} ${adapter.model}: ${good}/${total} pass every check`);
