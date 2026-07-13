// Elo math checks: expected-score symmetry and K application.
// Run with: node test/elo.test.mjs

import assert from 'node:assert/strict';
import { ELO_K, expectedScore, eloDelta, resultFromScore } from '../js/elo.js';

// Expected scores are symmetric and probabilities.
for (const [a, b] of [[1000, 1000], [1200, 1000], [800, 1600], [1000, 1001]]) {
  const ea = expectedScore(a, b);
  const eb = expectedScore(b, a);
  assert.ok(ea > 0 && ea < 1, `expected score in (0,1) for ${a} vs ${b}`);
  assert.ok(Math.abs(ea + eb - 1) < 1e-12, `symmetry for ${a} vs ${b}`);
}
assert.equal(expectedScore(1000, 1000), 0.5, 'equal ratings => 0.5');

// K application: equal ratings, a win moves exactly K/2.
assert.equal(eloDelta(1000, 1000, 1), ELO_K / 2, 'equal-rating win = +K/2');
assert.equal(eloDelta(1000, 1000, 0), -ELO_K / 2, 'equal-rating loss = -K/2');
assert.equal(eloDelta(1000, 1000, 0.5), 0, 'equal-rating draw = 0');

// Upsets move more than expected wins; favorites gain little.
assert.ok(eloDelta(800, 1200, 1) > eloDelta(1200, 800, 1), 'upset > expected win');
assert.equal(eloDelta(1000, 1000, 1, 64), 32, 'custom K applies');

// Score-to-result mapping.
assert.equal(resultFromScore(3, 1), 1);
assert.equal(resultFromScore(1, 3), 0);
assert.equal(resultFromScore(2, 2), 0.5);

console.log('ok — expected-score symmetry and K application hold');
