import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { dispatch, RPC_PATH } from '../../index.js'
import { fakeLlm } from '../helpers/fake-llm.mjs'
import { CODE_REVIEW_OK } from '../fixtures/code.mjs'
import { PROFILE_CONFIRMED } from '../fixtures/resume.mjs'

// S4c: the §3.5 / §3.6 behaviours the earlier cases did not pin down.

const URL_BASE = 'http://localhost' + RPC_PATH
const START = { op: 'session/create', profile: PROFILE_CONFIRMED, mode: 'tech-1', difficulty: 'mid', minutes: 30 }

async function tempHome() {
  return mkdtemp(join(tmpdir(), 'dsh-mock-interview-s4c-'))
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

test('TC-EDG-031 session/list honours its 1–100 limit and refuses anything else', async () => {
  const home = await tempHome()
  let clock = 0
  const deps = { home, now: () => (clock += 10) }
  await call(START, deps)
  await call(START, deps)

  const one = await call({ op: 'session/list', limit: 1 }, deps)
  assert.equal(one.value.sessions.length, 1)

  for (const limit of [0, 101, 1.5, '5']) {
    const refused = await call({ op: 'session/list', limit }, deps)
    assert.equal(refused.error.code, 'E_BAD_REQUEST', `limit ${String(limit)}`)
  }
  await rm(home, { recursive: true, force: true })
})

test('TC-EDG-032 a shallow answer earns one probe; re-answering overwrites the turn', async () => {
  const home = await tempHome()
  const created = await call(START, { home })
  const { sessionId, plan } = created.value
  const questionId = plan.items[0].id

  const first = await call(
    { op: 'turn/answer', sessionId, questionId, answer: '双指针' },
    { home, complete: fakeLlm({ replies: [CODE_REVIEW_OK] }).complete },
  )
  assert.equal(first.ok, true)
  assert.equal(first.value.next.type, 'probe', 'a conclusion-only answer must be probed')

  const second = await call(
    { op: 'turn/answer', sessionId, questionId, answer: '双指针，左右各一个，靠比较推进，O(n) 时间 O(1) 空间。' },
    { home, complete: fakeLlm({ replies: [CODE_REVIEW_OK] }).complete },
  )
  assert.equal(second.ok, true)
  assert.equal(second.value.next.type, 'question', 'a second shallow answer must not be probed twice')

  const session = await call({ op: 'session/get', sessionId }, { home })
  const turns = session.value.session.turns
  assert.equal(turns.length, 1, 'the same question keeps exactly one turn')
  assert.equal(turns[0].answer, '双指针，左右各一个，靠比较推进，O(n) 时间 O(1) 空间。')
  assert.equal(turns[0].inputMode, 'text')
  await rm(home, { recursive: true, force: true })
})

test('TC-EDG-033 an over-long answer is refused before scoring', async () => {
  const home = await tempHome()
  const created = await call(START, { home })
  const { sessionId, plan } = created.value
  let modelCalls = 0
  const complete = async () => {
    modelCalls += 1
    return CODE_REVIEW_OK
  }

  const refused = await call(
    { op: 'turn/answer', sessionId, questionId: plan.items[0].id, answer: 'x'.repeat(4001) },
    { home, complete },
  )
  assert.equal(refused.error.code, 'E_BAD_REQUEST')
  assert.equal(modelCalls, 0)

  const session = await call({ op: 'session/get', sessionId }, { home })
  assert.deepEqual(session.value.session.turns, [])
  await rm(home, { recursive: true, force: true })
})

test('TC-EDG-034 the list entry reports the running overall average', async () => {
  const home = await tempHome()
  const created = await call(START, { home })
  const { sessionId, plan } = created.value
  const answered = await call(
    { op: 'turn/answer', sessionId, questionId: plan.items[0].id, answer: '先讲机制，再讲取舍，最后讲边界条件。' },
    { home, complete: fakeLlm({ replies: [CODE_REVIEW_OK] }).complete },
  )

  const listed = await call({ op: 'session/list' }, { home })
  const entry = listed.value.sessions.find((row) => row.id === sessionId)
  assert.equal(entry.turns, 1)
  assert.equal(entry.overall, answered.value.score.overall)
  assert.equal(entry.mode, 'tech-1')
  await rm(home, { recursive: true, force: true })
})

test('TC-EDG-035 voice answers are recorded with their input mode', async () => {
  const home = await tempHome()
  const created = await call(START, { home })
  const { sessionId, plan } = created.value
  await call(
    {
      op: 'turn/answer',
      sessionId,
      questionId: plan.items[0].id,
      answer: '语音转写回来的一段完整回答，包含机制、取舍与边界。',
      inputMode: 'voice',
    },
    { home, complete: fakeLlm({ replies: [CODE_REVIEW_OK] }).complete },
  )
  const session = await call({ op: 'session/get', sessionId }, { home })
  assert.equal(session.value.session.turns[0].inputMode, 'voice')
  await rm(home, { recursive: true, force: true })
})