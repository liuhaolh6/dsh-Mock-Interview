import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { dispatch, RPC_PATH } from '../../index.js'
import { fakeLlm } from '../helpers/fake-llm.mjs'
import { CODE_REVIEW_OK } from '../fixtures/code.mjs'
import { PROFILE_CONFIRMED } from '../fixtures/resume.mjs'

// S6: the voice path degrades to text instead of pretending to work.
// v1 never uploads audio, so a voice turn is only as good as the transcript the
// browser already produced with the user's own ASR endpoint.

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

async function started() {
  const cwd = await mkdtemp(join(tmpdir(), 'dsh-mock-interview-voi-'))
  const deps = { home: join(cwd, 'home'), cwd }
  const created = await call(START, deps)
  assert.equal(created.ok, true, JSON.stringify(created))
  return { deps, cwd, sessionId: created.value.sessionId, plan: created.value.plan }
}

test('TC-VOI-001 a voice turn without a transcript says ASR is not configured', async () => {
  const { deps, cwd, sessionId, plan } = await started()
  const complete = fakeLlm({ replies: [CODE_REVIEW_OK] })

  const payload = await call(
    { op: 'turn/answer', sessionId, questionId: plan.items[0].id, inputMode: 'voice' },
    { ...deps, complete: complete.complete },
  )

  assert.equal(payload.ok, false)
  assert.equal(payload.error.code, 'E_ASR_NOT_CONFIGURED')
  assert.match(payload.error.message, /文字/)
  assert.match(payload.error.message, /转写|ASR/)
  assert.equal(complete.calls.length, 0, 'no answer means no scoring call')

  // Nothing was persisted: a failed voice turn must not create a half turn.
  const session = await call({ op: 'session/get', sessionId }, deps)
  assert.equal(session.value.session.turns.length, 0)
  await rm(cwd, { recursive: true, force: true })
})

test('TC-VOI-003 an empty transcript is a retriable bad request, and audio is never kept', async () => {
  const { deps, cwd, sessionId, plan } = await started()
  const complete = fakeLlm({ replies: [CODE_REVIEW_OK] })

  for (const transcript of ['', '   ', '\n\t']) {
    const payload = await call(
      { op: 'turn/answer', sessionId, questionId: plan.items[0].id, inputMode: 'voice', answer: transcript },
      { ...deps, complete: complete.complete },
    )
    assert.equal(payload.ok, false, JSON.stringify({ transcript, payload }))
    assert.equal(payload.error.code, 'E_BAD_REQUEST')
    assert.match(payload.error.message, /转写结果为空/)
  }
  assert.equal(complete.calls.length, 0)

  // The session document has no field that could carry audio.
  const session = await call({ op: 'session/get', sessionId }, deps)
  const text = JSON.stringify(session.value.session)
  assert.equal(/audio|base64|blob/i.test(text), false)
  assert.equal(session.value.session.turns.length, 0)
  await rm(cwd, { recursive: true, force: true })
})

test('TC-VOI-004 a voice turn with a transcript is scored like text, and flagged as voice', async () => {
  const { deps, cwd, sessionId, plan } = await started()
  const complete = fakeLlm({ replies: [CODE_REVIEW_OK] })

  const payload = await call(
    {
      op: 'turn/answer',
      sessionId,
      questionId: plan.items[0].id,
      inputMode: 'voice',
      answer: '我用的是延迟双删加 binlog 兜底，先更库再删缓存，失败进队列重试三次。',
    },
    { ...deps, complete: complete.complete },
  )

  assert.equal(payload.ok, true, JSON.stringify(payload))
  const session = await call({ op: 'session/get', sessionId }, deps)
  assert.equal(session.value.session.turns[0].inputMode, 'voice')
  assert.equal(typeof session.value.session.turns[0].score.overall, 'number')
  await rm(cwd, { recursive: true, force: true })
})