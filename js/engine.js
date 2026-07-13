// Simulation engine: the phase machine + fixed-timestep tick, shared verbatim
// by the rendered game (main.js) and headless matches (simulateMatch). Human
// input is applied by the caller BEFORE step(); the engine never reads input.

import { CONFIG } from './config.js';
import { createMatchState, setupKickoff, applyHalftime } from './entities.js';
import { stepPhysics } from './physics.js';
import { computeKeeperProtect } from './actions.js';
import { updateAI } from './ai.js';

// Bump on ANY change that alters sim outcomes (physics, AI, actions, config
// tunables) — matches record it so replays from an older engine show a notice
// instead of silently re-running wrong. Distinct from team.js CONFIG_VERSION,
// which only tracks the team config schema.
export const ENGINE_VERSION = 1;

// AI-vs-AI match: no controlled players, tactics come from the team configs
// (fields default per ai.js DEFAULT_TEAM_CONFIG).
export function createMatch(configA, configB, seed) {
  const state = createMatchState({ mode: 'sim', difficulty: 'hard', seed });
  state.teamConfig = [configA || {}, configB || {}];
  state.keeperBoxOn = true;
  return state;
}

// Advance the match by one fixed timestep. Mutates state.
export function step(state, dt) {
  if (state.phase !== 'playing') state.keeperProtect = null;

  switch (state.phase) {
    case 'kickoff': {
      updateAI(state, dt); // drift-to-position only outside 'playing'
      stepPhysics(state, dt);
      // Ball stays dead on the spot until the freeze ends; incidental contact
      // while it's pinned must not count as a touch.
      state.ball.x = CONFIG.PITCH_W / 2;
      state.ball.y = CONFIG.PITCH_H / 2;
      state.ball.vx = 0;
      state.ball.vy = 0;
      state.lastTouchTeam = null;
      state.phaseTimer -= dt;
      if (state.phaseTimer <= 0) {
        state.phase = 'playing';
        state.phaseTimer = 0;
      }
      break;
    }

    case 'goal': {
      updateAI(state, dt);
      stepPhysics(state, dt);
      state.phaseTimer -= dt;
      if (state.phaseTimer <= 0) {
        setupKickoff(state, state.pendingKickoffTeam);
      }
      break;
    }

    case 'halftime': {
      updateAI(state, dt);
      stepPhysics(state, dt);
      state.phaseTimer -= dt;
      if (state.phaseTimer <= 0) {
        applyHalftime(state); // flips attackDir, kickoff for team 1
      }
      break;
    }

    case 'playing': {
      updateAI(state, dt);
      const events = stepPhysics(state, dt);
      state.keeperProtect = state.keeperBoxOn ? computeKeeperProtect(state) : null;

      for (const ev of events) {
        if (ev.type === 'goal') {
          state.score[ev.scoringTeam] += 1;
          state.charge[0] = 0;
          state.charge[1] = 0;
          state.pendingKickoffTeam = 1 - ev.scoringTeam;
          state.phase = 'goal';
          state.phaseTimer = CONFIG.GOAL_PAUSE_S;
        }
      }

      if (state.phase === 'playing') {
        state.clockS += dt;
        if (state.half === 1 && state.clockS >= CONFIG.HALF_LENGTH_S) {
          state.phase = 'halftime';
          state.phaseTimer = CONFIG.GOAL_PAUSE_S;
        } else if (
          state.half === 2 &&
          state.clockS >= 2 * CONFIG.HALF_LENGTH_S
        ) {
          state.phase = 'fulltime';
          state.phaseTimer = 0;
        }
      }
      break;
    }
  }
}

// Run a full match headless at the same fixed 60 Hz timestep the rendered
// loop uses. Returns { score, state }.
export function simulateMatch(configA, configB, seed) {
  const state = createMatch(configA, configB, seed);
  // Hard cap well past any possible match length, in case of a phase bug.
  let ticks = Math.ceil((4 * CONFIG.HALF_LENGTH_S) / CONFIG.TICK_DT) * 4;
  while (state.phase !== 'fulltime' && ticks-- > 0) {
    step(state, CONFIG.TICK_DT);
  }
  return { score: [state.score[0], state.score[1]], state };
}
