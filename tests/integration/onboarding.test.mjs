import assert from 'node:assert/strict'
import { mkdtemp, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { dispatch, RPC_PATH } from '../../index.js'
import { PROFILE_CONFIRMED } from '../fixtures/resume.mjs'

// S-C3: the first screens must explain themselves — why a list is empty and
// whether the profile is complete enough to start.

const URL_BASE = 'http://localhost' + RPC_PATH
const START = { op: 'session/create', profile: PROFILE_CONFIRMED, mode: 'tech-1', difficulty: 'mid', minutes: 15 }

async function freshHome() {
  const home = await mkdtemp(join(tmpdir(), 'dsh-mock-interview-c3-'))
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

test('TC-ONB-010 an empty store says why the list is empty', async () => {
  const home = await freshHome()
  const empty = await call({ op: 'session/list' }, { home })
  assert.equal(empty.value.emptyReason, 'none')
  assert.deepEqual(empty.value.sessions, [])

  await call(START, { home })
  const all = await call({ op: 'session/list' }, { home })
  assert.equal(all.value.emptyReason, null)
  assert.equal(all.value.sessions.length, 1)

  const noMatch = await call({ op: 'session/list', query: '不存在的词' }, { home })
  assert.equal(noMatch.value.emptyReason, 'filtered')
  assert.equal(noMatch.value.sessions.length, 0)
  assert.equal(noMatch.value.stats.total, 1, 'stats describe every record, not the empty page')
})

test('TC-ONB-011 profile/extract tells the confirm screen whether it can start', async () => {
  const shape = JSON.stringify({
    skills: ['Java'],
    years: 3,
    projects: [],
    jd: { title: 'Java 后端', company: '某公司', level: 'mid' },
    warnings: [],
    edited: false,
  })

  const ready = await call(
    { op: 'profile/extract', resumeText: '简历正文', jdText: '岗位描述' },
    { complete: async () => shape },
  )
  assert.equal(ready.value.readiness.ready, true)
  assert.deepEqual(ready.value.readiness.blockers, ['projects'])

  const bare = await call(
    { op: 'profile/extract', resumeText: '只有技术栈没有项目', jdText: '' },
    { complete: async () => JSON.stringify({ skills: [], projects: [], jd: {}, warnings: [], edited: false }) },
  )
  assert.equal(bare.value.readiness.ready, false)
  assert.deepEqual(bare.value.readiness.blockers, ['skills', 'projects'])
})
