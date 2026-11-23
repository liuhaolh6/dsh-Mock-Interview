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
import { loadBank, rankByStack, resolveBank, stackOf } from './bank.mjs'

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
  const active = await resolveBank({
    ...(deps.bank === undefined ? {} : { path: deps.bank }),
    ...(deps.home === undefined ? {} : { home: deps.home }),
    ...(deps.fs === undefined ? {} : { fs: deps.fs }),
    ...(deps.reload === undefined ? {} : { reload: deps.reload }),
  })
  const topics = active.topics
  const ranked = rankByStack(topics, stackOf(profile))
  const targets = orderTargets(ownTargets(skills, projects), bankTargets(ranked), input?.avoid)
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
  // A real interview ends on the whiteboard — but only with a target that *is* a
  // coding question. Relabelling whatever happened to land in the last slot (a
  // MySQL theory topic, say) gave the panel a code editor for a theory question.
  await closeWithCode(items, { ranked, active, bankKinds, avoid: input?.avoid, deps })

  return {
    mode,
    difficulty,
    minutes,
    budget,
    items,
    // Which bank fed this plan: 'custom' means the candidate's own questions.
    bankSource: active.source,
    ...(active.warning === undefined ? {} : { bankWarning: active.warning }),
  }
}

function ownTargets(skills, projects) {
  return [
    ...skills.map((skill) => `skill:${skill}`),
    ...projects.map((project) => `project:${project.name}`),
  ]
}

function bankTargets(rankedTopics) {
  return rankedTopics.map((entry) => `bank:${entry.topic}`)
}

/**
 * D2 再面一次：题单必须换掉一半以上，否则只是背上一场的答案。
 *
 * 做法是把「没考过的」提前，再以「题库 / 简历」交替的顺序取——既换了题，
 * 又仍然考自己的技能和项目，不会整场都在问通用八股。没有 `avoid` 时保持
 * v0.1 的顺序（先简历后题库），老行为不变。
 */
function orderTargets(own, bank, avoid) {
  const skip = avoid instanceof Set ? avoid : new Set(Array.isArray(avoid) ? avoid : [])
  if (skip.size === 0) {
    // Alternate instead of "all own material, then the whole bank": with a rich
    // resume the budget was spent before a single bank question — and a custom
    // bank (D4) would never be asked at all. Own material still opens the run.
    const ordered = []
    const longest = Math.max(own.length, bank.length)
    for (let index = 0; index < longest; index += 1) {
      if (own[index] !== undefined) ordered.push(own[index])
      if (bank[index] !== undefined) ordered.push(bank[index])
    }
    return ordered
  }

  const freshOwn = own.filter((target) => !skip.has(target))
  const staleOwn = own.filter((target) => skip.has(target))
  const freshBank = bank.filter((target) => !skip.has(target))
  const staleBank = bank.filter((target) => skip.has(target))
  const ownPool = [...freshOwn, ...staleOwn]
  const bankPool = [...freshBank, ...staleBank]

  const ordered = []
  const longest = Math.max(bankPool.length, ownPool.length)
  for (let index = 0; index < longest; index += 1) {
    if (bankPool[index] !== undefined) ordered.push(bankPool[index])
    if (ownPool[index] !== undefined) ordered.push(ownPool[index])
  }
  return ordered
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

/**
 * 让题单以一道**真手撕**收尾。
 *
 * - 已经有一道 code 题：把它挪到最后一格（只交换位置，不复制，靶子不重复）。
 * - 一道都没有：从题库里挑一条 `kind: 'code'` 而且本场没考过的题补到最后一格；
 *   自定义题库没有手撕题时，退回打包题库里的手撕题——绝不把理论题改成手撕题。
 * - 连一条手撕题都找不到（打包题库被删干净了）：保持原样，本场就没有手撕题。
 */
async function closeWithCode(items, { ranked, active, bankKinds, avoid, deps }) {
  const last = items.length - 1
  const owned = items.findIndex((item) => item.kind === 'code')
  if (owned !== -1) {
    if (owned !== last) {
      // 挪到最后一格并让后面的往前补位：交换位置会把「倒数第二题」复制到前面，
      // 补位不会多出重复靶子。
      const [item] = items.splice(owned, 1)
      items.push(item)
    }
    return
  }

  const used = new Set(items.map((item) => item.target))
  const own = bankTargets(ranked.filter((entry) => entry.kind === 'code'))
  // 当前题库一条手撕题都没有（自定义题库只带理论题、或部署指了一份纯理论题库）
  // 时，退回打包题库里的手撕题；只要有一条真 code 靶子就不去碰打包题库。
  const pool = own.length === 0 ? await packagedCodeTargets() : own
  const skip = new Set(Array.isArray(avoid) ? avoid : [])
  const fresh = pool.filter((target) => !used.has(target))
  const pick = fresh.find((target) => !skip.has(target)) ?? fresh[0]
    ?? pool.find((target) => !skip.has(target)) ?? pool[0]
  if (pick === undefined) return
  items[last] = { ...items[last], kind: 'code', topic: topicFor(pick), target: pick }
}

/** 打包题库里的手撕题靶子；读不到就返回空数组（面试不该因为备份题库而崩）。 */
async function packagedCodeTargets() {
  try {
    // 始终读打包题库：调用方传进来的 `bank` 就是那份「没有手撕题」的自定义题库，
    // 拿它当兜底等于没兜底。
    const topics = await loadBank({})
    return bankTargets(topics.filter((entry) => entry.kind === 'code'))
  } catch {
    return []
  }
}
