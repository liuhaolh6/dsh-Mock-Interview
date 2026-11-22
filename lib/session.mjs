/**
 * Profile + mode/difficulty/minutes → Plan (contract §3.3, AC-2).
 *
 * Pure: no LLM, no filesystem. Question wording lives in `lib/director.mjs`
 * (S2); this module only decides how many questions a run gets and which
 * slice of the profile they must cover.
 *
 * @module lib/session
 */

/**
 * @param {{ profile: object, mode: string, difficulty: string, minutes: number }} input
 * @param {{ random?: () => number }} [deps]
 * @returns {Promise<object>} Plan (see docs/contracts.md §2)
 */
export async function buildPlan(input, deps = {}) {
  void input
  void deps
  throw new Error('not implemented yet: buildPlan (G4)')
}