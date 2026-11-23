import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { ContractError } from './errors.mjs'
import { LIMITS, SCHEMA_VERSION } from './contracts.js'
import { defaultTitle } from './history.mjs'

/**
 * Session storage on the file system: one JSON document per interview under
 * `$DSH_HOME/storages/dsh-mock-interview/sessions/<id>.json` (ADR-0003).
 *
 * Writes are atomic (temp file + rename) and refused before they start when the
 * document would exceed the 2 MB ceiling, so the previous version always
 * survives a failed write.
 *
 * @module lib/store
 */

/** @param {string} home @returns {string} */
export function sessionsDir(home) {
  return join(home, 'storages', 'dsh-mock-interview', 'sessions')
}

function wrapWriteError(problem, id) {
  if (problem instanceof ContractError) return problem
  const reason = problem?.code ?? problem?.message ?? 'unknown'
  return new ContractError('E_EXPORT_FAILED', `会话 ${id} 写入失败（${reason}）`)
}

/**
 * v0.2 / B1: records written before the CRUD batch have no title/tags/note.
 * Fill them in on read so listing never has to special-case older files; the
 * defaults are persisted the next time the record is written.
 */
function withRecordDefaults(session) {
  return {
    ...session,
    title: typeof session.title === 'string' && session.title.length > 0 ? session.title : defaultTitle(session),
    tags: Array.isArray(session.tags) ? session.tags : [],
    note: typeof session.note === 'string' ? session.note : '',
  }
}

/**
 * @param {{ home?: string }} [input]
 * @returns {{
 *   dir: string,
 *   put: (session: object) => Promise<object>,
 *   get: (id: string) => Promise<object>,
 *   list: () => Promise<object[]>,
 *   remove: (id: string) => Promise<{ deleted: true }>,
 * }}
 */
export function createStore({ home, fs: injectedFs } = {}) {
  if (typeof home !== 'string' || home === '') {
    throw new ContractError('E_BAD_REQUEST', '缺少 DSH_HOME，无法定位会话目录')
  }
  const dir = sessionsDir(home)
  const io = injectedFs ?? { mkdir, readFile, readdir, rename, rm, writeFile }
  const fileOf = (id) => join(dir, `${id}.json`)

  return {
    dir,

    async put(session) {
      const id = session?.id
      if (typeof id !== 'string' || id === '') {
        throw new ContractError('E_BAD_REQUEST', '会话缺少 id')
      }
      const payload = {
        ...session,
        schemaVersion: SCHEMA_VERSION,
        updatedAt: Number.isFinite(session.updatedAt) ? session.updatedAt : Date.now(),
      }
      const text = JSON.stringify(payload, null, 2)
      if (Buffer.byteLength(text, 'utf8') > LIMITS.maxSessionBytes) {
        throw new ContractError('E_SESSION_TOO_LARGE', `会话超过 ${LIMITS.maxSessionBytes} 字节上限`)
      }

      try {
        await io.mkdir(dir, { recursive: true })
      } catch (problem) {
        throw wrapWriteError(problem, id)
      }

      // Write beside the target then rename: a crash leaves the old file intact.
      const temp = join(dir, `${id}.json.${process.pid}.tmp`)
      try {
        await io.writeFile(temp, text, 'utf8')
        await io.rename(temp, fileOf(id))
      } catch (problem) {
        await io.rm(temp, { force: true }).catch(() => {})
        throw wrapWriteError(problem, id)
      }
      return payload
    },

    async get(id) {
      if (typeof id !== 'string' || id === '') {
        throw new ContractError('E_BAD_REQUEST', '缺少 sessionId')
      }
      let text
      try {
        text = await io.readFile(fileOf(id), 'utf8')
      } catch (problem) {
        if (['ENOENT', 'ENOTDIR', 'EISDIR', 'ERR_FS_EISDIR'].includes(problem?.code)) {
          throw new ContractError('E_SESSION_NOT_FOUND', `找不到会话 ${id}`)
        }
        throw problem
      }

      let parsed
      try {
        parsed = JSON.parse(text)
      } catch {
        throw new ContractError('E_SESSION_NOT_FOUND', `会话 ${id} 的文件已损坏`)
      }
      if (parsed?.schemaVersion !== SCHEMA_VERSION) {
        throw new ContractError(
          'E_SCHEMA_VERSION',
          `会话 ${id} 的 schemaVersion=${String(parsed?.schemaVersion)}，当前只支持 ${SCHEMA_VERSION}`,
        )
      }
      return withRecordDefaults(parsed)
    },

    async list() {
      let names
      try {
        names = await io.readdir(dir)
      } catch (problem) {
        if (problem?.code === 'ENOENT' || problem?.code === 'ENOTDIR') return []
        throw problem
      }
      const sessions = []
      for (const entry of names) {
        if (!entry.endsWith('.json')) continue
        try {
          const session = await this.get(entry.slice(0, -'.json'.length))
          const turns = Array.isArray(session.turns) ? session.turns : []
          const scored = turns.map((turn) => turn?.score?.overall).filter((value) => typeof value === 'number')
          sessions.push({
            updatedAt: session.updatedAt ?? 0,
            id: session.id,
            title: session.title,
            tags: session.tags,
            note: session.note,
            difficulty: session.difficulty ?? '',
            createdAt: session.createdAt ?? 0,
            status: session.status ?? 'active',
            mode: session.mode ?? '',
            turns: turns.length,
            overall: scored.length === 0 ? null : Math.round((scored.reduce((a, b) => a + b, 0) / scored.length) * 10) / 10,
          })
        } catch {
          // A single unreadable file must not hide the rest of the history.
        }
      }
      return sessions.sort((a, b) => b.updatedAt - a.updatedAt).map(({ updatedAt, ...rest }) => rest)
    },

    async remove(id) {
      try {
        await io.rm(fileOf(id), { force: true })
      } catch (problem) {
        // force:true already tolerates "missing", so §3.10 idempotency holds;
        // anything that still fails is a real fault and must surface.
        throw problem
      }
      return { deleted: true }
    },

    /**
     * v0.2 / B1 partial update: read, merge the whitelisted fields, write back.
     * `createdAt` and everything else the caller did not send stay untouched.
     */
    async update(id, patch) {
      const session = await this.get(id)
      const merged = {
        ...session,
        ...patch,
        updatedAt: Date.now(),
      }
      await this.put(merged)
      return merged
    },

    /**
     * v0.2 / B1 batch delete. Returns how many records actually existed, so the
     * UI can say 「已删除 2 条」 instead of guessing; missing ids are not errors.
     */
    async removeMany(ids) {
      const removed = await this.existingIds(ids)
      for (const id of removed) {
        await this.remove(id)
      }
      return { deleted: removed.length }
    },

    /** Which of these ids exist right now (one directory scan, not N stats). */
    async existingIds(ids) {
      let names
      try {
        names = await io.readdir(dir)
      } catch (problem) {
        if (problem?.code === 'ENOENT' || problem?.code === 'ENOTDIR') return []
        throw problem
      }
      const present = new Set(names.filter((entry) => entry.endsWith('.json')).map((entry) => entry.slice(0, -'.json'.length)))
      return ids.filter((id) => present.has(id))
    },
  }
}