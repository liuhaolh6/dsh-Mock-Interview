import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { dispatch, RPC_PATH } from '../../index.js'
import { fakeLlm } from '../helpers/fake-llm.mjs'
import { PROFILE_CONFIRMED } from '../fixtures/resume.mjs'
import { SCORE_VALID } from '../fixtures/score.mjs'

// S-B4: a report must be studyable (answer + reference) and exportable as JSON,
// and exporting an old record must not disturb it.

const URL_BASE = 'http://localhost' + RPC_PATH
const START = { op: 'session/create', profile: PROFILE_CONFIRMED, mode: 'tech-1', difficulty: 'mid', minutes: 15 }

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

async function seededSession(home) {
  const created = await call(START, { home })
  const sessionId = created.value.sessionId
  const first = created.value.plan.items[0]
  const complete = fakeLlm({ replies: [SCORE_VALID] }).complete
  await call(
    {
      op: 'turn/answer',
      sessionId,
      questionId: first.id,
      answer: '我用 Redis 做库存预扣，先扣减再落库，失败走补偿任务回滚，避免超卖',
    },
    { home, complete },
  )
  return { sessionId, first }
}

test('TC-REP-007 report/export format=json writes parseable JSON with answers and references', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-mock-interview-b4-'))
  const workdir = await mkdtemp(join(tmpdir(), 'dsh-mock-b4-out-'))
  const { sessionId } = await seededSession(home)

  const exported = await call(
    { op: 'report/export', sessionId, format: 'json', dir: workdir },
    { home, cwd: workdir },
  )

  assert.equal(exported.ok, true, JSON.stringify(exported))
  assert.match(exported.value.path, /\.json$/)
  assert.ok(exported.value.bytes > 0)

  const raw = await readFile(exported.value.path, 'utf8')
  const parsed = JSON.parse(raw)
  assert.equal(parsed.sessionId, sessionId)
  assert.ok(Array.isArray(parsed.items) && parsed.items.length === 1)
  assert.equal(parsed.items[0].inputMode, 'text')
  assert.ok(parsed.items[0].answer.includes('Redis'))
  assert.ok(Array.isArray(parsed.items[0].reference), 'reference list must survive to the file')
  assert.equal(parsed.codeVerified, false)

  await rm(home, { recursive: true, force: true })
  await rm(workdir, { recursive: true, force: true })
})

test('TC-REP-009 unsupported format is rejected instead of silently falling back', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-mock-interview-b4-'))
  const workdir = await mkdtemp(join(tmpdir(), 'dsh-mock-b4-out-'))
  const { sessionId } = await seededSession(home)

  const exported = await call(
    { op: 'report/export', sessionId, format: 'pdf', dir: workdir },
    { home, cwd: workdir },
  )
  assert.equal(exported.ok, false)
  assert.equal(exported.error.code, 'E_BAD_REQUEST')
  assert.match(exported.error.message, /md \/ json/)

  await rm(home, { recursive: true, force: true })
  await rm(workdir, { recursive: true, force: true })
})

test('TC-REP-010 markdown carries the answer, the evidence and the reference solution', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-mock-interview-b4-'))
  const workdir = await mkdtemp(join(tmpdir(), 'dsh-mock-b4-out-'))
  const { sessionId } = await seededSession(home)

  const exported = await call({ op: 'report/export', sessionId, dir: workdir }, { home, cwd: workdir })
  assert.equal(exported.ok, true, JSON.stringify(exported))
  const markdown = await readFile(exported.value.path, 'utf8')

  assert.match(markdown, /## 逐题原文与参考解/)
  assert.match(markdown, /\*\*你的回答\*\*/)
  assert.match(markdown, /Redis 做库存预扣/)
  assert.match(markdown, /\*\*参考解\*\*/)
  assert.match(markdown, /\*\*扣分依据\*\*/)
  assert.match(markdown, /未真实执行/)

  await rm(home, { recursive: true, force: true })
  await rm(workdir, { recursive: true, force: true })
})

test('TC-REP-011 exporting a historical record does not touch the stored session', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-mock-interview-b4-'))
  const workdir = await mkdtemp(join(tmpdir(), 'dsh-mock-b4-out-'))
  const { sessionId } = await seededSession(home)

  const before = await readFile(join(home, 'storages', 'dsh-mock-interview', 'sessions', `${sessionId}.json`), 'utf8')
  const exported = await call(
    { op: 'report/export', sessionId, format: 'json', dir: workdir },
    { home, cwd: workdir },
  )
  assert.equal(exported.ok, true, JSON.stringify(exported))
  const after = await readFile(join(home, 'storages', 'dsh-mock-interview', 'sessions', `${sessionId}.json`), 'utf8')

  assert.equal(after, before, 'export is a read-only operation on the record')
  const listed = await call({ op: 'session/list' }, { home })
  assert.equal(listed.value.sessions[0].status, 'active')

  await rm(home, { recursive: true, force: true })
  await rm(workdir, { recursive: true, force: true })
})