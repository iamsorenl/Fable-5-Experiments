// Determinism check: same (configs, seed) must produce the identical match.
// Run with: node test/determinism.test.mjs

import assert from 'node:assert/strict';
import { simulateMatch } from '../js/engine.js';

// Order-stable hash of everything gameplay-relevant in the final state.
function hashState(state) {
  const s = JSON.stringify({
    score: state.score,
    clockS: state.clockS,
    ball: [state.ball.x, state.ball.y, state.ball.vx, state.ball.vy],
    players: state.players.map((p) => [p.x, p.y, p.vx, p.vy]),
  });
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  }
  return h;
}

const cfgA = { pressDist: 110, possessionPush: 0.16 };
const cfgB = {}; // all defaults

const run1 = simulateMatch(cfgA, cfgB, 12345);
const run2 = simulateMatch(cfgA, cfgB, 12345);

assert.equal(run1.state.phase, 'fulltime', 'match must reach fulltime');
assert.deepEqual(run1.score, run2.score, 'same seed must give the same score');
assert.equal(hashState(run1.state), hashState(run2.state), 'same seed must give the same final state');

const run3 = simulateMatch(cfgA, cfgB, 54321);
assert.notEqual(hashState(run1.state), hashState(run3.state), 'different seed should diverge');

console.log(`ok — seed 12345 => ${run1.score.join('-')} (twice), seed 54321 => ${run3.score.join('-')}`);
