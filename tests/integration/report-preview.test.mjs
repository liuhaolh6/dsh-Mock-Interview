import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { dispatch, RPC_PATH } from '../../index.js'
import { PROFILE_CONFIRMED } from '../fixtures/resume.mjs'

// S-C7: the report screen needs the same Markdown the exporter writes, so users
// can copy it without creating a file.

const URL_BASE = 'http://localhost' + RPC_PATH
const START = { op: 'session/create', profile: PROFILE_CONFIRMED, mode: 'tech-1', difficulty: 'mid', minutes: 15 }

async function freshHome() {
  const home = await mkdtemp(join(tmpdir(), 'dsh-mock-interview-c7-'))
  await mkdir(join(home, 'storages', 'dsh-mock-interview', 'sessions'), { recursive: true })
  return home
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

test('TC-REP-012 report/preview returns the Markdown without writing a file', async () => {
  const home = await freshHome()
  const created = await call(START, { home })
  const sessionId = created.value.sessionId

  const preview = await call({ op: 'report/preview', sessionId }, { home })
  assert.equal(preview.ok, true)
  assert.equal(typeof preview.value.markdown, 'string')
  assert.match(preview.value.markdown, /模拟面试成绩单/, 'expected the report title')
  assert.match(preview.value.markdown, /## 六维评分/, 'expected the radar table')

  const dir = join(home, 'storages', 'dsh-mock-interview', 'sessions')
  const files = await readdir(dir)
  assert.deepEqual(files.filter((name) => name.endsWith('.md')), [], 'preview must not write a Markdown file')

  const session = await call({ op: 'session/get', sessionId }, { home })
  assert.equal(session.value.session.status, 'active', 'preview must not finish the session')
})

test('TC-REP-013 report/preview on an unknown session is a clean 404', async () => {
  const home = await freshHome()
  const payload = await call({ op: 'report/preview', sessionId: 'ghost' }, { home })
  assert.equal(payload.ok, false)
  assert.equal(payload.error.code, 'E_SESSION_NOT_FOUND')
})
