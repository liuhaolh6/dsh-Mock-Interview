/**
 * The question bank (v0.2 / B3, custom banks v0.4 / D4).
 *
 * The bank used to live as a constant inside `lib/session.mjs`, which meant
 * editing questions needed a code change and a reviewer had no data to diff.
 * It is data now: topics keep their order, and each carries `keywords` used to
 * match a job description instead of asking Java questions to a Go candidate.
 *
 * Three sources, in priority order: an explicit path (tests, deployments), the
 * candidate's own file under `$DSH_HOME`, then the packaged `data/bank.json`.
 *
 * Two failure modes are deliberately different:
 *   - a user-supplied bank that fails validation → `E_BAD_REQUEST`, naming the
 *     entry, and nothing is written;
 *   - a packaged/deployment file that is missing or corrupt → `E_INTERNAL` with
 *     the path; the failure is diagnosable instead of silently falling back.
 * A hand-broken custom file sits between the two: the run still starts on the
 * built-in bank, but `resolveBank()` reports `warning` so the UI can say so.
 *
 * @module lib/bank
 */

import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { LIMITS } from './contracts.js'
import { ContractError } from './errors.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
export const DEFAULT_BANK_PATH = join(HERE, '..', 'data', 'bank.json')

/** Kinds a bank entry may declare; anything else is a typo, not a new type. */
export const BANK_KINDS = ['skill', 'project', 'behavior', 'code']

const CUSTOM_BANK_RELATIVE = ['storages', 'dsh-mock-interview', 'bank.json']

const defaultFs = { readFile, writeFile, mkdir, rename, rm, stat }

let cached = null
let cachedKey = ''

/** Where a candidate's own bank lives (`$DSH_HOME/storages/dsh-mock-interview/bank.json`). */
export function customBankPath(home) {
  return join(String(home), ...CUSTOM_BANK_RELATIVE)
}

function deployFault(path) {
  return (message) => {
    throw new ContractError('E_INTERNAL', `题库文件不可用（${path}）：${message}`)
  }
}

function userFault(message) {
  throw new ContractError('E_BAD_REQUEST', message)
}

/**
 * Validate and normalise a bank document. Shared by the deploy path, the user
 * path and the on-disk custom file, so all three accept exactly the same shape.
 *
 * @param {unknown} raw parsed JSON
 * @param {(message: string) => never} fault throws the right error for this caller
 * @returns {{ topics: Array<object>, warnings: string[] }}
 */
export function normalizeBank(raw, fault) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    fault('题库必须是一个 JSON 对象，形如 { "topics": [ { "topic": "…" } ] }')
  }
  const topics = raw.topics
  if (!Array.isArray(topics)) fault('题库里没有 topics 数组')
  if (topics.length === 0) fault('题库里没有 topics：一条题都没有')
  if (topics.length > LIMITS.maxBankTopics) {
    fault(`题库最多 ${LIMITS.maxBankTopics} 条，当前 ${topics.length} 条`)
  }

  const warnings = []
  const seen = new Set()
  const normalized = topics.map((entry, index) => {
    const where = `第 ${index + 1} 条`
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) fault(`${where}不是对象`)

    const topic = typeof entry.topic === 'string' ? entry.topic.trim() : ''
    if (topic === '') fault(`${where}缺少 topic`)
    if (topic.length > LIMITS.maxBankTopicChars) {
      fault(`${where}的 topic 超过 ${LIMITS.maxBankTopicChars} 字`)
    }

    const kind = entry.kind === undefined ? 'skill' : entry.kind
    if (!BANK_KINDS.includes(kind)) {
      fault(`${where} kind 只能是 ${BANK_KINDS.join(' / ')}，收到「${String(kind)}」`)
    }

    let keywords = []
    if (entry.keywords !== undefined) {
      if (!Array.isArray(entry.keywords)) fault(`${where} keywords 必须是字符串数组`)
      const usable = entry.keywords
        .filter((word) => typeof word === 'string')
        .map((word) => word.trim())
        .filter((word) => word !== '')
      const tooLong = usable.filter((word) => word.length > LIMITS.maxBankKeywordChars)
      keywords = usable.filter((word) => word.length <= LIMITS.maxBankKeywordChars)
      if (usable.length !== entry.keywords.length) {
        warnings.push(`${where}的关键字里有 ${entry.keywords.length - usable.length} 个不是有效字符串，已忽略`)
      }
      if (tooLong.length > 0) {
        warnings.push(`${where}有 ${tooLong.length} 个关键字超过 ${LIMITS.maxBankKeywordChars} 字，已忽略`)
      }
      if (keywords.length > LIMITS.maxBankKeywords) {
        fault(`${where}的关键字最多 ${LIMITS.maxBankKeywords} 个`)
      }
    }

    const fallbackId = `bank-${index + 1}`
    let id = typeof entry.id === 'string' && entry.id.trim() !== '' ? entry.id.trim() : fallbackId
    if (seen.has(id)) {
      let suffix = 2
      while (seen.has(`${id}-${suffix}`)) suffix += 1
      warnings.push(`${where}的 id「${id}」与前面的重复，已改为「${id}-${suffix}」`)
      id = `${id}-${suffix}`
    }
    seen.add(id)

    return { id, topic, kind, keywords }
  })

  return { topics: normalized, warnings }
}

/** User-facing entry point: `bank/validate` and `bank/save` both go through it. */
export function validateBank(raw) {
  return normalizeBank(raw, userFault)
}

async function readJson(path, io) {
  try {
    return JSON.parse(await io.readFile(path, 'utf8'))
  } catch (problem) {
    throw new ContractError(
      'E_INTERNAL',
      `题库文件不可用（${path}）：${problem?.code ?? problem?.message ?? 'unknown'}`,
    )
  }
}

/**
 * The packaged bank (or an explicit path). A broken file here is a deployment
 * fault and must not be papered over.
 *
 * @param {{ path?: string, fs?: { readFile: Function }, reload?: boolean }} [options]
 * @returns {Promise<Array<{ id: string, topic: string, kind: string, keywords: string[] }>>}
 */
export async function loadBank(options = {}) {
  const path = options.path ?? DEFAULT_BANK_PATH
  const io = options.fs ?? { readFile }
  const key = `${path}:${options.reload === true ? Math.random() : 'stable'}`
  if (cached !== null && cachedKey === key) return cached

  const parsed = await readJson(path, io)
  const { topics } = normalizeBank(parsed, deployFault(path))
  cached = topics
  cachedKey = key
  return topics
}

/**
 * The bank a run should actually use: custom file if it is there and sound,
 * packaged bank otherwise.
 *
 * @param {{ home?: string, path?: string, fs?: object, reload?: boolean }} [options]
 * @returns {Promise<{ topics: Array<object>, source: 'path'|'custom'|'default', warning?: string }>}
 */
export async function resolveBank(options = {}) {
  const io = options.fs ?? defaultFs
  if (typeof options.path === 'string' && options.path !== '') {
    return { topics: await loadBank({ path: options.path, fs: io, reload: options.reload }), source: 'path' }
  }

  if (typeof options.home === 'string' && options.home !== '') {
    const custom = await readCustomBank({ home: options.home, fs: io })
    if (custom === null && (await exists(customBankPath(options.home), io))) {
      // The file is there but unreadable or not JSON at all: same story as an
      // invalid document — keep the run alive, never hide the fact.
      return {
        topics: await loadBank({ fs: io, reload: options.reload }),
        source: 'default',
        warning: `自定义题库无法解析（${customBankPath(options.home)}）；已回退内置题库`,
      }
    }
    if (custom !== null) {
      try {
        const { topics } = normalizeBank(custom, (message) => {
          throw new ContractError('E_BAD_REQUEST', message)
        })
        return { topics, source: 'custom' }
      } catch (problem) {
        // Hand-edited file: keep the interview runnable, but never silently.
        const path = customBankPath(options.home)
        return {
          topics: await loadBank({ fs: io, reload: options.reload }),
          source: 'default',
          warning: `自定义题库不可用（${path}）：${problem?.message ?? '解析失败'}；已回退内置题库`,
        }
      }
    }
  }

  return { topics: await loadBank({ fs: io, reload: options.reload }), source: 'default' }
}

async function exists(path, io) {
  try {
    await io.stat(path)
    return true
  } catch {
    return false
  }
}

/** Read the custom bank document, or null when there is none (or it is unreadable). */
export async function readCustomBank(options = {}) {
  const { home } = options
  if (typeof home !== 'string' || home === '') return null
  const io = options.fs ?? defaultFs
  try {
    return JSON.parse(await io.readFile(customBankPath(home), 'utf8'))
  } catch {
    return null
  }
}

/** Metadata for `bank/get`: exists / count / updatedAt, never the whole document. */
export async function customBankInfo(options = {}) {
  const { home } = options
  if (typeof home !== 'string' || home === '') return { exists: false }
  const io = options.fs ?? defaultFs
  const path = customBankPath(home)
  let info
  try {
    info = await io.stat(path)
  } catch {
    return { exists: false }
  }
  const bank = await readCustomBank({ home, fs: io })
  const topics = Array.isArray(bank?.topics) ? bank.topics : []
  return { exists: true, path, count: topics.length, updatedAt: info.mtimeMs ?? null }
}

/**
 * Validate, then write atomically. A bad bank never reaches disk in any form —
 * not even a temporary file left behind.
 */
export async function writeCustomBank(options = {}) {
  const { home, bank } = options
  if (typeof home !== 'string' || home === '') {
    throw new ContractError('E_INTERNAL', '不知道要写到哪个目录（缺少 DSH_HOME）')
  }
  const io = options.fs ?? defaultFs
  const { topics, warnings } = validateBank(bank)
  const path = customBankPath(home)
  const payload = `${JSON.stringify({ version: 1, topics }, null, 2)}\n`
  const temporary = `${path}.tmp-${process.pid}`
  await io.mkdir(dirname(path), { recursive: true })
  await io.writeFile(temporary, payload, 'utf8')
  await io.rename(temporary, path)
  return { path, count: topics.length, warnings }
}

/** Delete the custom bank. `false` means there was nothing to delete. */
export async function removeCustomBank(options = {}) {
  const { home } = options
  if (typeof home !== 'string' || home === '') return false
  const io = options.fs ?? defaultFs
  const path = customBankPath(home)
  try {
    await io.rm(path)
    return true
  } catch {
    return false
  }
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