import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { dispatch, RPC_PATH } from '../../index.js'
import { createStore, sessionsDir } from '../../lib/store.mjs'
import { fakeLlm } from '../helpers/fake-llm.mjs'
import { CODE_REVIEW_OK } from '../fixtures/code.mjs'
import { PROFILE_CONFIRMED } from '../fixtures/resume.mjs'

const URL_BASE = 'http://localhost' + RPC_PATH

async function tempHome() {
  return mkdtemp(join(tmpdir(), 'dsh-mock-interview-'))
}

async function call(body, deps) {
  const response = await dispatch(
    new Request(URL_BASE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    deps,
  )
  assert.equal(response.status, 200)
  return response.json()
}

function startBody(extra = {}) {
  return { op: 'session/create', profile: PROFILE_CONFIRMED, mode: 'tech-1', difficulty: 'mid', minutes: 30, ...extra }
}

test('TC-SES-007 session/create then session/get returns the same plan', async () => {
  const home = await tempHome()
  const created = await call(startBody(), { home })
  assert.equal(created.ok, true)
  const { sessionId } = created.value

  const fetched = await call({ op: 'session/get', sessionId }, { home })
  assert.equal(fetched.ok, true)
  assert.equal(fetched.value.session.id, sessionId)
  assert.deepEqual(fetched.value.session.plan, created.value.plan)
  await rm(home, { recursive: true, force: true })
})

test('TC-STO-001 three answered turns survive a reopen', async () => {
  const home = await tempHome()
  const created = await call(startBody(), { home })
  const { sessionId, plan } = created.value

  for (const item of plan.items.slice(0, 3)) {
    const answered = await call(
      { op: 'turn/answer', sessionId, questionId: item.id, answer: '单例模式用一个实例保证全局唯一。' },
      { home, complete: fakeLlm({ replies: [CODE_REVIEW_OK] }).complete },
    )
    assert.equal(answered.ok, true)
  }

  const reopened = await call({ op: 'session/get', sessionId }, { home })
  assert.equal(reopened.value.session.turns.length, 3)
  assert.deepEqual(
    reopened.value.session.turns.map((turn) => turn.questionId),
    plan.items.slice(0, 3).map((item) => item.id),
  )
  for (const turn of reopened.value.session.turns) {
    assert.ok(turn.score && typeof turn.score.overall === 'number')
  }
  await rm(home, { recursive: true, force: true })
})

test('TC-STO-002 a future schemaVersion is refused and the file is kept', async () => {
  const home = await tempHome()
  const dir = sessionsDir(home)
  await mkdir(dir, { recursive: true })
  const file = join(dir, 'future.json')
  const payload = { schemaVersion: 99, id: 'future', updatedAt: 1 }
  await writeFile(file, JSON.stringify(payload), 'utf8')

  const store = createStore({ home })
  await assert.rejects(() => store.get('future'), { code: 'E_SCHEMA_VERSION' })
  assert.equal(existsSync(file), true)
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), payload)
  await rm(home, { recursive: true, force: true })
})

test('TC-STO-003 a blocked directory becomes E_EXPORT_FAILED instead of a silent no-op', async () => {
  const home = await tempHome()
  // A regular file where the storage directory should be: mkdir now fails ENOTDIR.
  await writeFile(join(home, 'storages'), 'not a directory', 'utf8')

  const store = createStore({ home })
  await assert.rejects(
    () => store.put({ schemaVersion: 1, id: 'blocked', updatedAt: 1 }),
    { code: 'E_EXPORT_FAILED' },
  )
  await rm(home, { recursive: true, force: true })
})

test('TC-STO-004 an oversized session is refused and the previous version survives', async () => {
  const home = await tempHome()
  const store = createStore({ home })
  const session = { schemaVersion: 1, id: 'big', updatedAt: 1, turns: [] }
  await store.put(session)

  const before = await readFile(join(sessionsDir(home), 'big.json'), 'utf8')
  const oversized = { ...session, updatedAt: 2, turns: [{ answer: 'x'.repeat(2 * 1024 * 1024) }] }
  await assert.rejects(() => store.put(oversized), { code: 'E_SESSION_TOO_LARGE' })
  assert.equal(await readFile(join(sessionsDir(home), 'big.json'), 'utf8'), before)
  await rm(home, { recursive: true, force: true })
})

test('TC-STO-005 list is newest-first and deleted sessions are gone', async () => {
  const home = await tempHome()
  let clock = 1000
  const deps = { home, now: () => (clock += 1000) }

  const first = await call(startBody(), deps)
  const second = await call(startBody(), deps)
  const listed = await call({ op: 'session/list' }, deps)
  assert.equal(listed.ok, true)
  assert.deepEqual(
    listed.value.sessions.map((entry) => entry.id),
    [second.value.sessionId, first.value.sessionId],
  )

  const removed = await call({ op: 'session/delete', sessionId: first.value.sessionId }, deps)
  assert.equal(removed.ok, true)
  const gone = await call({ op: 'session/get', sessionId: first.value.sessionId }, deps)
  assert.equal(gone.ok, false)
  assert.equal(gone.error.code, 'E_SESSION_NOT_FOUND')
  // §3.10: deleting twice is still success, not an error.
  const again = await call({ op: 'session/delete', sessionId: first.value.sessionId }, deps)
  assert.deepEqual(again.value, { deleted: true })
  await rm(home, { recursive: true, force: true })
})

test('TC-SCR-006 turn/answer scores all six dimensions end to end', async () => {
  const home = await tempHome()
  const created = await call(startBody(), { home })
  const { sessionId, plan } = created.value
  const answered = await call(
    { op: 'turn/answer', sessionId, questionId: plan.items[0].id, answer: '用 Redis 做缓存，先查缓存再回源。' },
    { home, complete: fakeLlm({ replies: [CODE_REVIEW_OK] }).complete },
  )
  assert.equal(answered.ok, true)
  assert.deepEqual(Object.keys(answered.value.score.dims).sort(), [
    'code',
    'communication',
    'correctness',
    'depth',
    'project',
    'structure',
  ])
  await rm(home, { recursive: true, force: true })
})