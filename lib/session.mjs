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
import { loadBank, rankByStack, stackOf } from './bank.mjs'

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

  // Each question probes a different part of the candidate's own material first,
  // then falls back to the external bank, ranked so a Redis-heavy JD gets Redis
  // questions before JVM ones — a run never asks the same target twice.
  const topics = await loadBank(deps.bank === undefined ? {} : { path: deps.bank })
  const ranked = rankByStack(topics, stackOf(profile))
  const targets = buildTargets(skills, projects, ranked)
  // The bank declares its own kind, so a custom bank can ship algorithm questions
  // that do not happen to be named "算法…".
  const bankKinds = new Map(ranked.map((entry) => [`bank:${entry.topic}`, entry.kind]))

  const items = []
  for (let index = 0; index < budget; index += 1) {
    // A small custom bank must not produce holes: cycle through the targets and
    // let the run repeat a topic rather than crash on an undefined question.
    const target = targets[index % targets.length]
    items.push({
      id: `q-${index + 1}`,
      kind: kindFor(target, bankKinds),
      topic: topicFor(target),
      target,
      weight: 1,
    })
  }
  // A real interview always ends with something on the whiteboard.
  items[items.length - 1] = { ...items[items.length - 1], kind: 'code' }

  return { mode, difficulty, minutes, budget, items }
}

function buildTargets(skills, projects, rankedTopics) {
  const own = [
    ...skills.map((skill) => `skill:${skill}`),
    ...projects.map((project) => `project:${project.name}`),
  ]
  const seen = new Set(own)
  const bank = []
  for (const entry of rankedTopics) {
    const target = `bank:${entry.topic}`
    if (seen.has(target)) continue
    seen.add(target)
    bank.push(target)
  }
  return [...own, ...bank]
}

function kindFor(target, bankKinds) {
  const [kind] = target.split(':')
  if (kind === 'project') return 'project'
  if (kind === 'behavior') return 'behavior'
  if (bankKinds.get(target) === 'code') return 'code'
  return 'skill'
}

function topicFor(target) {
  const [kind, name = ''] = target.split(':')
  return kind === 'bank' || kind === 'project' ? name : name
}