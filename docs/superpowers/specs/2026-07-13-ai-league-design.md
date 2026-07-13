# AI League: users, leaderboard, tunable AI teams

**Date:** 2026-07-13
**Status:** Approved

## Goal

Turn the single-machine arcade soccer game into a competitive platform, inspired by
pacai's capture tournaments: users tune their own AI team (weights + strategy picks,
not code), publish it, and compete on an Elo leaderboard via server-simulated
AI-vs-AI matches. Humans can also play against any published team, unranked, for
fun and scouting.

## Decisions made

- **Match model:** Both — AI-vs-AI simulation is the ranked ladder; human-vs-AI play
  is unranked scouting/fun.
- **AI tuning:** Weights + strategy picks with a point budget. No user code. Config
  schema deliberately leaves room for later customization (e.g. fitting weights from
  logged human-play telemetry).
- **Backend:** Supabase (auth, Postgres, Edge Functions). Game stays on GitHub Pages.
- **Ladder:** Elo + challenges. No scheduled tournaments this phase.

## Architecture

The core insight (from pacai staff teams): an AI team is a **config document** run by
the shared engine — different weight profiles, same code. Matches are deterministic
given `(configA, configB, seed)`, so:

- Ranked matches run server-side in a Supabase Edge Function (plain JS — the same
  engine file runs verbatim). Cheat-proof.
- A match result is stored as just seed + configs + score. Replays are free: the
  browser re-runs the sim from the seed with rendering on.

```
GitHub Pages (static)                    Supabase
┌─────────────────────────┐             ┌──────────────────────────┐
│ game (play)             │   auth      │ Auth                     │
│ team builder            │◄───────────►│ Postgres:                │
│ leaderboard / replays   │   reads     │  profiles, teams, matches│
└───────────┬─────────────┘             │ Edge Fn: play-match      │
            │        js/engine.js       │   (imports engine.js)    │
            └────────── shared ─────────┴──────────────────────────┘
```

## Components

### 1. Headless engine (`js/engine.js`)

- Extract the update loop from `main.js` into a pure module:
  `createMatch(configA, configB, seed)` and `step(state, dt)`.
- Seeded PRNG (mulberry32) threaded through all gameplay randomness; no
  `Math.random` in `physics.js` / `ai.js` / `actions.js` / `entities.js`.
- Fixed timestep (60 Hz accumulator) so headless and rendered runs are identical.
- `simulateMatch(configA, configB, seed)` runs a full match headless and returns the
  score (a ~3-sim-minute match completes in well under a second).
- The existing game (`main.js`, `render.js`, `input.js`) becomes a consumer of the
  engine. Rendering and input never mutate sim state outside `step`.
- The hardcoded tunables in `ai.js` (SHOT_RANGE, PRESS_DIST, THROUGH_PASS_GAIN,
  POSSESSION_PUSH, steal aggression, keeper style, formation SLOTS) become inputs
  read from the team config, with current values as defaults.

### 2. Team config (JSON)

- `name`, `formation` (slot x/y fractions per outfield player), tactical weights
  (the extracted `ai.js` tunables), and per-player attribute splits (pace, stamina,
  power, control) under a shared **point budget** enforced in the builder UI and
  re-validated server-side.
- Versioned: every edit bumps `version`; match rows record the version that played.

### 3. Team builder + local testing (no account required)

- Builder screen: sliders and pickers over the config schema, budget meter,
  localStorage persistence.
- **Watch mode:** your team vs a preset profile, AI-vs-AI, rendered locally.
  Ship 3–4 preset opponents (pacai staff-team style): Aggressive, Wall, Balanced,
  and the current default AI.
- **Play mode:** human plays against their own or any published team. Unranked.
- Signing in unlocks Publish.

### 4. Supabase data

- `profiles`: id (auth uid), username (unique).
- `teams`: id, owner, name, config JSONB, version, elo (default 1000), W/D/L.
- `matches`: team_a, team_b, version_a, version_b, seed, score_a, score_b,
  elo_delta_a, elo_delta_b, created_at.
- RLS: public read on all three; only owners insert/update their team; only the
  Edge Function (service role) writes matches and elo.

### 5. Ranked matches: `play-match` Edge Function

- Authenticates caller, validates the team config against the schema and budget,
  generates the seed server-side, runs `simulateMatch`, writes the match row, and
  applies standard Elo (K=32).
- Triggers:
  - Publish/update a team → auto-queue ~5 placement matches vs nearby-rated teams.
  - Challenge button on any leaderboard row → one match on demand.
- Rate limit: per-team challenge cap per hour (enforced in the function).

### 6. Leaderboard + replays

- Leaderboard page reads Supabase directly: rank, team, owner, Elo, W/D/L, recent
  form; each row links to team detail (config summary, match history) and Challenge.
- Replay viewer: re-run the sim client-side from stored seed + configs with
  rendering on. Match history doubles as scouting.

## Error handling

- Engine determinism is the load-bearing invariant: a version marker in the config
  ties matches to the engine version that produced them, so old replays don't break
  silently when the engine changes (replays of matches from an older engine version
  show a "played on older engine" notice rather than a wrong replay).
- Edge Function failures (timeout, invalid config) write nothing — no partial Elo
  updates; the two writes (match row + elo) happen in one transaction via a Postgres
  function.
- Client handles signed-out state gracefully: everything except Publish/Challenge
  works without auth.

## Testing

- Determinism check: same (configs, seed) → identical final score and state hash,
  run twice in Node. This is the one test that must never break.
- Budget validation: over-budget config rejected client- and server-side.
- Elo math: one small unit check (expected-score symmetry, K application).
- Manual: full flow — build team, watch vs preset, publish, placement matches run,
  leaderboard updates, replay plays back the same score.

## Out of scope this phase

- Human-vs-human netcode; ranked human matches.
- Scheduled/round-robin tournaments (clean later add on top of Elo).
- User-submitted agent code.
- Telemetry-fitted weights from human play (schema leaves the door open).

## Build order (each stage shippable)

1. Engine extraction: headless, seeded, deterministic; existing game unchanged in feel.
2. Team config schema + builder UI + local watch/play modes with preset opponents.
3. Supabase auth, tables, RLS, publish flow, read-only leaderboard.
4. `play-match` Edge Function, placement matches, challenges, Elo, replay viewer.
