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
import { ContractError } from './errors.mjs'

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

  const skills = Array.isArray(profile?.skills) ? profile.skills : []
  const projects = Array.isArray(profile?.projects) ? profile.projects : []
  if (skills.length === 0 && projects.length === 0) {
    throw new ContractError('E_PROFILE_INCOMPLETE', '画像里没有技能和项目，先去简历页确认提炼结果')
  }

  const budget = DURATIONS[minutes]
  if (budget === undefined) {
    const allowed = Object.keys(DURATIONS).join(' / ')
    throw new ContractError('E_BAD_REQUEST', `不支持的时长 ${minutes}，可选 ${allowed} 分钟`)
  }
  const items = []
  for (let index = 0; index < budget; index += 1) {
    items.push({ id: `q-${index + 1}`, kind: 'knowledge', text: '', target: '' })
  }

  return { mode, difficulty, minutes, budget, items }
}