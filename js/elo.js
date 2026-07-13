// Elo rating math, shared verbatim by the play-match Edge Function and any
// client display. Standard Elo, K = 32, zero-sum integer deltas.

export const ELO_K = 32;

// Probability that a beats b. expectedScore(a,b) + expectedScore(b,a) === 1.
export function expectedScore(ratingA, ratingB) {
  return 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
}

// Rating change for team A given its actual score (1 win, 0.5 draw, 0 loss).
// Team B's delta is the negation, so ratings stay zero-sum.
export function eloDelta(ratingA, ratingB, actualA, k = ELO_K) {
  return Math.round(k * (actualA - expectedScore(ratingA, ratingB)));
}

// Map a match score to A's actual result for eloDelta.
export function resultFromScore(scoreA, scoreB) {
  return scoreA > scoreB ? 1 : scoreA < scoreB ? 0 : 0.5;
}
