/**
 * The interviewer's voice (contract §3.6 `next.type`, AC-3).
 *
 * Two jobs: turn a plan item into a spoken prompt in the right register, and
 * decide whether the last answer was thin enough to warrant one probe. Both are
 * deterministic on purpose — the probe decision must be reproducible in tests
 * and must never depend on a model round-trip.
 *
 * @module lib/director
 */

/** How each difficulty level is asked, not what is asked. */
export const DIFFICULTY_TAGS = {
  junior: '先讲清楚概念和用法',
  mid: '讲清机制、取舍和边界',
  senior: '讲清架构权衡、故障场景和演进',
}

/**
 * @param {{ item: { id: string, kind: string, topic?: string, target: string }, difficulty: string }} input
 * @returns {string}
 */
export function composePrompt(input) {
  void input
  throw new Error('not implemented yet: composePrompt (G4)')
}

/**
 * @param {{ answer: string, alreadyProbed?: boolean }} input
 * @returns {{ asked: boolean, reason: string }}
 */
export function decideProbe(input) {
  void input
  throw new Error('not implemented yet: decideProbe (G4)')
}