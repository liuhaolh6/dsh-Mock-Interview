import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { dispatch, RPC_PATH } from '../../index.js'
import { fakeLlm } from '../helpers/fake-llm.mjs'
import { CODE_REVIEW_OK } from '../fixtures/code.mjs'
import { JD_JAVA_BACKEND, PROFILE_CONFIRMED, RESUME_JAVA } from '../fixtures/resume.mjs'

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

const PROFILE_JSON = JSON.stringify(PROFILE_CONFIRMED)

test('TC-RPC-006 profile/extract turns pasted text into an editable profile', async () => {
  const llm = fakeLlm({ replies: [PROFILE_JSON] })
  const extracted = await call(
    { op: 'profile/extract', resumeText: RESUME_JAVA, jdText: JD_JAVA_BACKEND },
    { complete: llm.complete },
  )
  assert.equal(extracted.ok, true, JSON.stringify(extracted))
  assert.deepEqual(extracted.value.profile.skills, PROFILE_CONFIRMED.skills)
  assert.equal(Array.isArray(extracted.value.warnings), true)
  assert.equal(llm.calls.length, 1)

  const empty = await call({ op: 'profile/extract', resumeText: '   ' }, { complete: llm.complete })
  assert.equal(empty.ok, false)
  assert.equal(empty.error.code, 'E_BAD_REQUEST')
  assert.equal(llm.calls.length, 1, 'an empty form must not reach the model')
})

test('TC-RPC-007 code/review reviews without executing and never carries a verdict of its own', async () => {
  const home = await tempHome()
  try {
    const created = await call(
      { op: 'session/create', profile: PROFILE_CONFIRMED, mode: 'tech-1', difficulty: 'mid', minutes: 15 },
      { home },
    )
    const codeItem = created.value.plan.items.find((item) => item.kind === 'code')

    const llm = fakeLlm({ replies: [CODE_REVIEW_OK] })
    const reviewed = await call(
      {
        op: 'code/review',
        sessionId: created.value.sessionId,
        questionId: codeItem.id,
        language: 'java',
        code: 'class Solution { int[] twoSum(int[] nums, int t) { return new int[] {0, 1}; } }',
      },
      { home, complete: llm.complete, now: () => 1_700_000_000_000 },
    )
    assert.equal(reviewed.ok, true, JSON.stringify(reviewed))
    assert.equal(reviewed.value.executed, false)
    assert.equal(reviewed.value.cases.length, 5)
    assert.equal(typeof reviewed.value.verdict, 'string')
    assert.equal(typeof reviewed.value.score.overall, 'number')

    const emptyCode = await call(
      { op: 'code/review', sessionId: created.value.sessionId, questionId: codeItem.id, language: 'java', code: '' },
      { home, complete: llm.complete },
    )
    assert.equal(emptyCode.ok, true)
    assert.equal(emptyCode.value.verdict, 'unverifiable')
    assert.equal(emptyCode.value.executed, false)

    const tooLong = await call(
      {
        op: 'code/review',
        sessionId: created.value.sessionId,
        questionId: codeItem.id,
        language: 'java',
        code: 'x'.repeat(20_001),
      },
      { home, complete: llm.complete },
    )
    assert.equal(tooLong.ok, false)
    assert.equal(tooLong.error.code, 'E_BAD_REQUEST')

    const ghost = await call(
      { op: 'code/review', sessionId: 'nope', questionId: codeItem.id, language: 'java', code: 'return 1;' },
      { home, complete: llm.complete },
    )
    assert.equal(ghost.ok, false)
    assert.equal(ghost.error.code, 'E_SESSION_NOT_FOUND')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})