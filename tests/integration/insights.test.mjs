import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { dispatch, RPC_PATH } from '../../index.js'
import { PROFILE_CONFIRMED } from '../fixtures/resume.mjs'
import { fakeLlm } from '../helpers/fake-llm.mjs'

const URL_BASE = 'http://localhost' + RPC_PATH
const SCORE = JSON.stringify({
  dims: { correctness: 4, depth: 4, structure: 4, project: null, code: null, communication: 4 },
  cases: [],
  evidence: ['并发靠锁与队列削峰，先讲结论再展开机制与取舍'],
  missing: [],
  reference: ['先给结论：锁粒度与队列削峰；再讲取舍与失败模式。'],
})

function post(body) {
  return new Request(URL_BASE, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function call(body, deps) {
  const response = await dispatch(post(body), deps)
  return response.json()
}

function home() {
  return mkdtempSync(join(tmpdir(), 'dsh-mi-ins-'))
}

test('TC-INS-010: session/get reports the progress view', async () => {
  const dir = home()
  const deps = { home: dir, now: () => 10_000 }
  const created = await call(
    { op: 'session/create', profile: PROFILE_CONFIRMED, mode: 'tech-1', difficulty: 'mid', minutes: 15 },
    deps,
  )
  assert.equal(created.ok, true, JSON.stringify(created))
  const sessionId = created.value.sessionId
  const got = await call({ op: 'session/get', sessionId }, { home: dir, now: () => 70_000 })
  assert.equal(got.ok, true)
  assert.equal(got.value.progress.total, 5)
  assert.equal(got.value.progress.index, 1)
  assert.equal(got.value.progress.answered, 0)
  assert.equal(got.value.progress.remaining, 5)
  assert.equal(got.value.progress.elapsedMs, 60_000)
  assert.equal(got.value.progress.avgScore, null)
  assert.equal(got.value.progress.finished, false)
})

test('TC-INS-011: session/list carries stats and trend derived from its own rows', async () => {
  const dir = home()
  const complete = fakeLlm({ replies: [SCORE] }).complete
  const deps = { home: dir, complete }
  const created = await call(
    { op: 'session/create', profile: PROFILE_CONFIRMED, mode: 'tech-1', difficulty: 'mid', minutes: 15 },
    deps,
  )
  const sessionId = created.value.sessionId
  const session = (await call({ op: 'session/get', sessionId }, deps)).value.session
  const answered = await call({ op: 'turn/answer', sessionId, questionId: session.plan.items[0].id, answer: '并发靠锁与队列削峰，先讲结论再展开机制与取舍。' }, deps)
  assert.equal(answered.ok, true, JSON.stringify(answered))

  const listed = await call({ op: 'session/list' }, deps)
  assert.equal(listed.ok, true)
  const { sessions, total, stats, trend } = listed.value
  assert.equal(total, 1)
  assert.equal(stats.total, sessions.length)
  assert.equal(stats.active, 1)
  assert.equal(stats.finished, 0)
  assert.equal(stats.answeredTurns, 1)
  assert.equal(trend.length, 1)
  assert.equal(trend[0].id, sessionId)
  assert.equal(stats.avgScore, trend[0].overall)
})
