import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import test from 'node:test'

import { dispatch, RPC_PATH } from '../../index.js'
import { fakeLlm } from '../helpers/fake-llm.mjs'
import { CODE_REVIEW_OK } from '../fixtures/code.mjs'
import { PROFILE_CONFIRMED } from '../fixtures/resume.mjs'

// S5 integration half: finish idempotency and the export sandbox.

const URL_BASE = 'http://localhost' + RPC_PATH
const START = { op: 'session/create', profile: PROFILE_CONFIRMED, mode: 'tech-1', difficulty: 'mid', minutes: 15 }

async function tempCwd() {
  return mkdtemp(join(tmpdir(), 'dsh-mock-interview-rep-'))
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

test('TC-REP-004 export stays inside the working directory and never overwrites', async () => {
  const cwd = await tempCwd()
  const deps = { home: join(cwd, 'home'), cwd }
  const created = await call(START, deps)
  const { sessionId, plan } = created.value
  await call(
    { op: 'turn/answer', sessionId, questionId: plan.items[0].id, answer: '机制、取舍、边界都讲清楚的一段回答。' },
    { ...deps, complete: fakeLlm({ replies: [CODE_REVIEW_OK] }).complete },
  )

  // Outside the working directory is refused before any file is written.
  const escaped = await call({ op: 'report/export', sessionId, dir: '../..' }, deps)
  assert.equal(escaped.error.code, 'E_BAD_REQUEST')
  const absolute = await call({ op: 'report/export', sessionId, dir: 'C:/Windows/Temp' }, deps)
  assert.equal(absolute.error.code, 'E_BAD_REQUEST')

  const first = await call({ op: 'report/export', sessionId, dir: './interview-reports' }, deps)
  assert.equal(first.ok, true, JSON.stringify(first))
  assert.ok(first.value.bytes > 100)
  assert.ok(relative(cwd, first.value.path).startsWith('interview-reports'))

  // Same name twice: the second file gets a suffix instead of clobbering.
  const second = await call({ op: 'report/export', sessionId, dir: './interview-reports' }, deps)
  assert.equal(second.ok, true)
  assert.notEqual(second.value.path, first.value.path)
  assert.match(second.value.path, /-2\.md$/)

  const files = await readdir(join(cwd, 'interview-reports'))
  assert.equal(files.length, 2)
  await rm(cwd, { recursive: true, force: true })
})

test('TC-REP-005 finishing twice replays the same report', async () => {
  const cwd = await tempCwd()
  const deps = { home: join(cwd, 'home'), cwd }
  const created = await call(START, deps)
  const { sessionId, plan } = created.value
  await call(
    { op: 'turn/answer', sessionId, questionId: plan.items[0].id, answer: '机制、取舍、边界都讲清楚的一段回答。' },
    { ...deps, complete: fakeLlm({ replies: [CODE_REVIEW_OK] }).complete },
  )

  const first = await call({ op: 'session/finish', sessionId }, deps)
  assert.equal(first.ok, true, JSON.stringify(first))
  assert.equal(first.value.report.answered, 1)
  assert.equal(first.value.report.codeVerified, false)

  const again = await call({ op: 'session/finish', sessionId }, deps)
  assert.deepEqual(again.value.report, first.value.report, 'finish is idempotent')

  // After finishing, further answers are refused.
  const late = await call(
    { op: 'turn/answer', sessionId, questionId: plan.items[1].id, answer: '再答一题' },
    { ...deps, complete: fakeLlm({ replies: [CODE_REVIEW_OK] }).complete },
  )
  assert.equal(late.error.code, 'E_SESSION_FINISHED')
  await rm(cwd, { recursive: true, force: true })
})

test('TC-REP-006 finishing a session that does not exist is a clean 404', async () => {
  const cwd = await tempCwd()
  const payload = await call({ op: 'session/finish', sessionId: 'ghost' }, { home: join(cwd, 'home'), cwd })
  assert.equal(payload.error.code, 'E_SESSION_NOT_FOUND')
  await rm(cwd, { recursive: true, force: true })
})