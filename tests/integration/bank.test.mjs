import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { dispatch, RPC_PATH } from '../../index.js'
import { fakeLlm } from '../helpers/fake-llm.mjs'
import { PROFILE_CONFIRMED } from '../fixtures/resume.mjs'
import { SCORE_VALID } from '../fixtures/score.mjs'

// S-B3: the bank is external data and the run must not monologue at a stuck candidate.

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

test('TC-BNK-101 two empty answers in a row move on instead of probing again', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-mock-interview-b3-'))
  const created = await call(START, { home })
  const sessionId = created.value.sessionId
  const first = created.value.plan.items[0]

  const complete = fakeLlm({ replies: [SCORE_VALID, SCORE_VALID, SCORE_VALID] }).complete
  const deps = { home, complete }

  const one = await call({ op: 'turn/answer', sessionId, questionId: first.id, answer: '' }, deps)
  assert.equal(one.value.next.type, 'probe', 'the first blank still earns one probe')

  const two = await call({ op: 'turn/answer', sessionId, questionId: first.id, answer: '   ' }, deps)
  assert.equal(two.value.next.type, 'question', 'the second blank must move on, not probe')
  assert.notEqual(two.value.next.question.id, first.id)

  const got = await call({ op: 'session/get', sessionId }, { home })
  assert.equal(got.value.session.turns.length, 1, 'the same question keeps exactly one turn')
  assert.equal(got.value.session.turns[0].probe.asked, false)
  assert.equal(got.value.session.emptyStreak, 2)

  await rm(home, { recursive: true, force: true })
})

test('TC-BNK-102 a real answer resets the empty streak', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-mock-interview-b3-'))
  const created = await call(START, { home })
  const sessionId = created.value.sessionId
  const [first, second] = created.value.plan.items

  const complete = fakeLlm({ replies: [SCORE_VALID, SCORE_VALID, SCORE_VALID] }).complete
  const deps = { home, complete }

  await call({ op: 'turn/answer', sessionId, questionId: first.id, answer: '' }, deps)
  await call(
    { op: 'turn/answer', sessionId, questionId: second.id, answer: '我在订单中心用 Redis 做了库存预扣，失败走补偿任务回滚' },
    deps,
  )

  const got = await call({ op: 'session/get', sessionId }, { home })
  assert.equal(got.value.session.emptyStreak, 0)

  await rm(home, { recursive: true, force: true })
})