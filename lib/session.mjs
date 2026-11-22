/**
 * Plan building (contract §3.3, AC-2).
 *
 * Pure and synchronous in spirit: it decides *what kinds of questions* a run
 * contains, by budget only. Wording is the director's job (slice S2), which
 * keeps this module cheap to test with a fixed random source.
 *
 * @module lib/session
 */

import { DURATIONS } from './contracts.js'

/**
 * @param {{
 *   profile: object,
 *   mode?: 'tech-1'|'project'|'algo'|'behavior',
 *   difficulty?: 'junior'|'mid'|'senior',
 *   minutes?: 15|30|45,
 * }} input
 * @param {{ random?: () => number }} [deps]
 * @returns {Promise<{ mode: string, difficulty: string, minutes: number, budget: number, items: object[] }>}
 */
export async function buildPlan(input, deps = {}) {
  void deps
  const { profile, mode = 'tech-1', difficulty = 'mid', minutes = 30 } = input ?? {}
  void profile

  const budget = DURATIONS[minutes]
  const items = []
  for (let index = 0; index < budget; index += 1) {
    items.push({ id: `q-${index + 1}`, kind: 'knowledge', text: '', target: '' })
  }

  return { mode, difficulty, minutes, budget, items }
}