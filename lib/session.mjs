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

  // Each question probes a different part of the candidate's own material first,
  // then falls back to the classic bank — a run never asks the same target twice.
  const targets = buildTargets(skills, projects)

  const items = []
  for (let index = 0; index < budget; index += 1) {
    const target = targets[index]
    items.push({
      id: `q-${index + 1}`,
      kind: kindFor(target),
      topic: topicFor(target),
      target,
      weight: 1,
    })
  }
  // A real interview always ends with something on the whiteboard.
  items[items.length - 1] = { ...items[items.length - 1], kind: 'code' }

  return { mode, difficulty, minutes, budget, items }
}

/**
 * The classic bank, in the order a real interviewer would walk it: fundamentals
 * first, then the things that separate "read a blog" from "shipped it".
 */
const TOPIC_BANK = [
  'JVM 内存模型',
  'GC 分代与调优',
  '集合源码',
  '并发包',
  'MySQL 索引与执行计划',
  '事务隔离级别',
  'Redis 数据结构与持久化',
  '缓存穿透雪崩',
  '分布式锁',
  '消息队列幂等',
  '微服务拆分边界',
  '接口幂等设计',
  '线上故障排查',
  '限流降级',
  '代码可测试性',
  '系统设计：秒杀',
  '系统设计：短链',
  '算法：链表',
  '算法：二叉树',
  '算法：动态规划',
]

function buildTargets(skills, projects) {
  const own = [
    ...skills.map((skill) => `skill:${skill}`),
    ...projects.map((project) => `project:${project.name}`),
  ]
  const seen = new Set(own)
  const bank = []
  for (const topic of TOPIC_BANK) {
    const target = `bank:${topic}`
    if (seen.has(target)) continue
    seen.add(target)
    bank.push(target)
  }
  return [...own, ...bank]
}

function kindFor(target) {
  const [kind] = target.split(':')
  if (kind === 'project') return 'project'
  if (kind === 'behavior') return 'behavior'
  if (target.startsWith('bank:算法')) return 'code'
  return 'skill'
}

function topicFor(target) {
  const [kind, name = ''] = target.split(':')
  return kind === 'bank' || kind === 'project' ? name : name
}