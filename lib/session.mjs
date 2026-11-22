/**
 * Plan building (contract §3.3, AC-2).
 *
 * Pure and synchronous in spirit: it decides *what kinds of questions* a run
 * contains, by budget only. Wording is the director's job (slice S2), which
 * keeps this module cheap to test with a fixed random source.
 *
 * @module lib/session
 */

import { DURATIONS, MODES } from './contracts.js'
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

  const budget = DURATIONS[minutes]
  if (!MODES.includes(mode)) {
    throw new ContractError('E_BAD_REQUEST', `不支持的面试类型 ${mode}，可选 ${MODES.join(' / ')}`)
  }
  if (budget === undefined) {
    const allowed = Object.keys(DURATIONS).join(' / ')
    throw new ContractError('E_BAD_REQUEST', `不支持的时长 ${minutes}，可选 ${allowed} 分钟`)
  }

  const skills = Array.isArray(profile?.skills) ? profile.skills : []
  const projects = Array.isArray(profile?.projects) ? profile.projects : []
  if (skills.length === 0 && projects.length === 0) {
    throw new ContractError('E_PROFILE_INCOMPLETE', '画像里没有技能和项目，先去简历页确认提炼结果')
  }

  // Each question probes a different part of the candidate's own material, so
  // the same skill never shows up twice in one run.
  const targets = [
    ...skills.map((skill) => `skill:${skill}`),
    ...projects.map((project) => `project:${project.name}`),
  ]

  const items = []
  for (let index = 0; index < budget; index += 1) {
    items.push({
      id: `q-${index + 1}`,
      kind: 'knowledge',
      text: '',
      target: targets[index % targets.length],
    })
  }
  // A real interview always ends with something on the whiteboard.
  items[items.length - 1] = { ...items[items.length - 1], kind: 'code' }

  return { mode, difficulty, minutes, budget, items }
}