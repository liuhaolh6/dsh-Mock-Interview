import { mkdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { ContractError } from './errors.mjs'
import { DIFFICULTIES, LIMITS, MODES } from './contracts.js'

// v0.2 / B1: interview records are the unit of CRUD. This module owns the
// patch validation and the list-side filtering/sorting/pagination so that the
// RPC layer stays a thin adapter.

const SORTS = ['recent', 'oldest', 'score']
const STATUSES = ['active', 'finished']
const ARCHIVE_FILTERS = ['exclude', 'include', 'only']

/**
 * D2: 归档不是新字段，而是记录上的一个系统标签——`schemaVersion` 不动、
 * 旧文件不用迁移，用户还能在标签里直接看见它。
 */
export const ARCHIVED_TAG = '已归档'

export function isArchived(row) {
  const tags = Array.isArray(row?.tags) ? row.tags : []
  return tags.includes(ARCHIVED_TAG)
}

/** 归档/取消归档只动这一个标签，用户自己的标签顺序不动、不重复。 */
export function withArchivedFlag(tags, archived) {
  const current = Array.isArray(tags) ? tags.filter((tag) => tag !== ARCHIVED_TAG) : []
  return archived === true ? [...current, ARCHIVED_TAG] : current
}

function bad(message) {
  return new ContractError('E_BAD_REQUEST', message)
}

function trimmedString(value) {
  return typeof value === 'string' ? value.trim() : null
}

/**
 * Validate a partial update. Returns only the fields the caller actually sent,
 * so a rename never wipes tags or notes by omission.
 */
export function pickPatch(body) {
  const patch = {}

  if (body.title !== undefined) {
    const title = trimmedString(body.title)
    if (title === null || title.length === 0) throw bad('title 必须是非空字符串')
    if (title.length > LIMITS.maxTitleChars) throw bad(`title 不能超过 ${LIMITS.maxTitleChars} 个字符`)
    patch.title = title
  }

  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags)) throw bad('tags 必须是字符串数组')
    if (body.tags.length > LIMITS.maxTags) throw bad(`tags 最多 ${LIMITS.maxTags} 个`)
    const seen = new Set()
    const tags = []
    for (const entry of body.tags) {
      const tag = trimmedString(entry)
      if (tag === null || tag.length === 0) throw bad('tags 里的每一项都必须是非空字符串')
      if (tag.length > LIMITS.maxTagChars) throw bad(`单个标签不能超过 ${LIMITS.maxTagChars} 个字符`)
      // De-duplicate but keep the first-seen casing and order: 'Redis' then 'redis'
      // are different-looking tags for the user even if they feel the same.
      if (seen.has(tag)) continue
      seen.add(tag)
      tags.push(tag)
    }
    patch.tags = tags
  }

  if (body.note !== undefined) {
    if (typeof body.note !== 'string') throw bad('note 必须是字符串')
    const note = body.note.trim()
    if (note.length > LIMITS.maxNoteChars) throw bad(`note 不能超过 ${LIMITS.maxNoteChars} 个字符`)
    patch.note = note
  }

  if (body.archived !== undefined) {
    if (typeof body.archived !== 'boolean') throw bad('archived 必须是布尔值')
    patch.archived = body.archived
  }

  if (Object.keys(patch).length === 0) {
    throw bad('session/update 至少要给出 title、tags、note、archived 之一')
  }
  return patch
}

/** The list-facing view of a record: enough to pick one, never the whole thing. */
export function sessionMeta(row) {
  return {
    id: row.id,
    title: typeof row.title === 'string' && row.title.length > 0 ? row.title : defaultTitle(row),
    tags: Array.isArray(row.tags) ? row.tags : [],
    createdAt: row.createdAt ?? 0,
    status: row.status ?? 'active',
    mode: row.mode ?? '',
    difficulty: row.difficulty ?? '',
    turns: row.turns ?? 0,
    overall: typeof row.overall === 'number' ? row.overall : null,
  }
}

export function defaultTitle(row) {
  const job = row?.profile?.jd?.title
  const label = typeof job === 'string' && job.trim().length > 0 ? job.trim() : '模拟面试'
  return `${label} · ${stamp(row.createdAt)}`
}

function stamp(millis) {
  const date = new Date(typeof millis === 'number' && millis > 0 ? millis : Date.now())
  const pad = (value) => String(value).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function matchesQuery(row, needle) {
  const haystack = [
    row.title,
    ...(Array.isArray(row.tags) ? row.tags : []),
    row.note,
    row.mode,
    row.difficulty,
  ]
    .filter((value) => typeof value === 'string')
    .join('\n')
    .toLowerCase()
  return haystack.includes(needle)
}

function assertEnum(name, value, allowed) {
  if (value === undefined || value === null || value === '') return
  if (!allowed.includes(value)) throw bad(`${name} 只能是 ${allowed.join(' / ')}`)
}

/**
 * Filter -> paginate -> project. `total` is the count *after* filtering, so the
 * UI can render "3 条中的第 1–2 条" without a second request.
 */
export function listSessions(rows, options = {}) {
  const limit = options.limit === undefined ? 20 : options.limit
  const offset = options.offset === undefined ? 0 : options.offset
  const sort = options.sort === undefined ? 'recent' : options.sort

  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw bad('limit 必须是 1–100 的整数')
  if (!Number.isInteger(offset) || offset < 0) throw bad('offset 必须是非负整数')
  assertEnum('sort', sort, SORTS)
  assertEnum('status', options.status, STATUSES)
  assertEnum('mode', options.mode, MODES)
  assertEnum('difficulty', options.difficulty, DIFFICULTIES)

  const archived = options.archived === undefined || options.archived === null ? 'exclude' : options.archived
  if (!ARCHIVE_FILTERS.includes(archived)) {
    throw bad(`archived 只能是 ${ARCHIVE_FILTERS.join(' / ')}`)
  }

  const query = typeof options.query === 'string' ? options.query.trim().toLowerCase() : ''
  const tag = typeof options.tag === 'string' ? options.tag.trim().toLowerCase() : ''

  const filtered = rows.filter((row) => {
    if (archived === 'exclude' && isArchived(row)) return false
    if (archived === 'only' && !isArchived(row)) return false
    if (options.status && (row.status ?? 'active') !== options.status) return false
    if (options.mode && row.mode !== options.mode) return false
    if (options.difficulty && row.difficulty !== options.difficulty) return false
    if (tag) {
      const tags = Array.isArray(row.tags) ? row.tags.map((item) => String(item).toLowerCase()) : []
      if (!tags.includes(tag)) return false
    }
    if (query && !matchesQuery(row, query)) return false
    return true
  })

  const scoreOf = (row) => (typeof row.overall === 'number' ? row.overall : null)
  const byRecent = (a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)
  const sorted = [...filtered].sort((a, b) => {
    if (sort === 'score') {
      const left = scoreOf(a)
      const right = scoreOf(b)
      // 「没考」不是「考了 0 分」：无分的记录永远排在后面，彼此按时间倒序。
      if (left === null && right === null) return byRecent(a, b)
      if (left === null) return 1
      if (right === null) return -1
      if (right !== left) return right - left
      return byRecent(a, b)
    }
    if (sort === 'oldest') return (a.updatedAt ?? 0) - (b.updatedAt ?? 0)
    return byRecent(a, b)
  })

  const total = sorted.length
  const page = sorted.slice(offset, offset + limit)
  return {
    sessions: page.map(sessionMeta),
    total,
    hasMore: offset + page.length < total,
  }
}

/**
 * D2 整包导出：一个能再导入的文件，因此带完整 `plan` 与 `turns`，
 * 也带导出时刻，方便日后核对「我当时导的是哪一版」。
 */
export function historyBundle(sessions, { at = Date.now() } = {}) {
  const list = Array.isArray(sessions) ? sessions : []
  return {
    schemaVersion: 'history-1',
    exportedAt: at,
    count: list.length,
    sessions: list,
  }
}

/**
 * 把整包历史写成 `history-<YYYYMMDD-HHmmss>.json`；同名就加 `-2`、`-3`，
 * 与报告导出一样**从不覆盖**已有文件。
 */
export async function exportHistory({ bundle, dir, fs: injected } = {}) {
  if (bundle === undefined || bundle === null) throw bad('缺少导出内容')
  if (typeof dir !== 'string' || dir === '') throw bad('缺少导出目录')
  const io = injected ?? { mkdir, stat, writeFile }
  const stamp = new Date(bundle.exportedAt ?? Date.now())
  const pad = (value) => String(value).padStart(2, '0')
  const base =
    `history-${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}` +
    `-${pad(stamp.getHours())}${pad(stamp.getMinutes())}${pad(stamp.getSeconds())}`
  const text = `${JSON.stringify(bundle, null, 2)}\n`

  try {
    await io.mkdir(dir, { recursive: true })
  } catch (problem) {
    throw new ContractError('E_EXPORT_FAILED', `无法创建导出目录：${problem?.code ?? 'unknown'}`)
  }

  let path = join(dir, `${base}.json`)
  for (let attempt = 2; attempt < 100; attempt += 1) {
    try {
      await io.stat(path)
      path = join(dir, `${base}-${attempt}.json`)
    } catch {
      break
    }
  }

  try {
    await io.writeFile(path, text, 'utf8')
  } catch (problem) {
    throw new ContractError('E_EXPORT_FAILED', `历史写入失败：${problem?.code ?? 'unknown'}`)
  }
  return { path, bytes: Buffer.byteLength(text, 'utf8'), count: bundle.count }
}
