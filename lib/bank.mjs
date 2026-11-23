/**
 * The question bank, loaded from `data/bank.json` (v0.2 / B3).
 *
 * The bank used to live as a constant inside `lib/session.mjs`, which meant
 * editing questions needed a code change and a reviewer had no data to diff.
 * It is data now: topics keep their order, and each carries `keywords` used to
 * match a job description instead of asking Java questions to a Go candidate.
 *
 * A missing or corrupt file is a deployment fault, not a user error: it raises
 * `E_INTERNAL` with the path, so the failure is diagnosable instead of silently
 * falling back to a stale copy.
 *
 * @module lib/bank
 */

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ContractError } from './errors.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
export const DEFAULT_BANK_PATH = join(HERE, '..', 'data', 'bank.json')

let cached = null
let cachedKey = ''

/**
 * @param {{ path?: string, fs?: { readFile: Function }, reload?: boolean }} [options]
 * @returns {Promise<Array<{ id: string, topic: string, kind: string, keywords: string[] }>>}
 */
export async function loadBank(options = {}) {
  const path = options.path ?? DEFAULT_BANK_PATH
  const io = options.fs ?? { readFile }
  const key = `${path}:${options.reload === true ? Math.random() : 'stable'}`
  if (cached !== null && cachedKey === key) return cached

  let parsed
  try {
    const text = await io.readFile(path, 'utf8')
    parsed = JSON.parse(text)
  } catch (problem) {
    throw new ContractError(
      'E_INTERNAL',
      `题库文件不可用（${path}）：${problem?.code ?? problem?.message ?? 'unknown'}`,
    )
  }

  const topics = Array.isArray(parsed?.topics) ? parsed.topics : []
  if (topics.length === 0) {
    throw new ContractError('E_INTERNAL', `题库文件里没有 topics（${path}）`)
  }

  const normalized = topics.map((entry, index) => {
    const topic = typeof entry?.topic === 'string' ? entry.topic.trim() : ''
    if (topic === '') {
      throw new ContractError('E_INTERNAL', `题库第 ${index + 1} 条缺少 topic（${path}）`)
    }
    return {
      id: typeof entry.id === 'string' && entry.id !== '' ? entry.id : `bank-${index + 1}`,
      topic,
      kind: entry?.kind === 'code' ? 'code' : 'skill',
      keywords: Array.isArray(entry?.keywords) ? entry.keywords.filter((word) => typeof word === 'string') : [],
    }
  })

  cached = normalized
  cachedKey = key
  return normalized
}

/** Test hook: forget the cached bank. */
export function resetBankCache() {
  cached = null
  cachedKey = ''
}

/**
 * Order topics by how well they match the candidate's stack. Matching keeps the
 * bank's own order inside each group, so two candidates with the same stack get
 * the same plan — plan determinism is what makes the cases reproducible.
 *
 * @param {Array<{ topic: string, keywords: string[] }>} topics
 * @param {string[]} stack lower-cased keywords from skills / projects / JD
 */
export function rankByStack(topics, stack) {
  const words = stack.map((word) => String(word).trim().toLowerCase()).filter((word) => word !== '')

  // Count distinct keyword hits instead of a boolean: "后端" alone matches half
  // the bank, so a boolean would rank JVM ahead of Redis for a Redis candidate.
  const scored = topics.map((entry, index) => {
    let score = 0
    for (const keyword of entry.keywords ?? []) {
      const needle = String(keyword).toLowerCase()
      if (words.some((word) => word.includes(needle) || needle.includes(word))) score += 1
    }
    return { entry, index, score }
  })

  const matched = scored.filter((row) => row.score > 0).sort((a, b) => b.score - a.score || a.index - b.index)
  const rest = scored.filter((row) => row.score === 0).sort((a, b) => a.index - b.index)
  return [...matched, ...rest].map((row) => row.entry)
}

/** Everything we know about the candidate's stack, lower-cased for matching. */
export function stackOf(profile) {
  const skills = Array.isArray(profile?.skills) ? profile.skills : []
  const jd = profile?.jd ?? {}
  const projects = Array.isArray(profile?.projects) ? profile.projects : []
  const highlights = projects.flatMap((project) =>
    Array.isArray(project?.highlights) ? project.highlights : [],
  )
  return [...skills, jd.title, jd.company, ...highlights]
    .filter((value) => typeof value === 'string')
    .map((value) => value.trim())
    .filter((value) => value !== '')
}