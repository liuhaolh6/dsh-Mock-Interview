import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { dispatch, RPC_PATH } from '../../index.js'
import { ARCHIVED_TAG } from '../../lib/history.mjs'
import { PROFILE_CONFIRMED } from '../fixtures/resume.mjs'

// D2: 再面一次（换题防背题）、归档（只进标签，不入统计）、整包导出。

const URL_BASE = 'http://localhost' + RPC_PATH
const START = { op: 'session/create', profile: PROFILE_CONFIRMED, mode: 'tech-1', difficulty: 'mid', minutes: 30 }

async function tempHome() {
  return mkdtemp(join(tmpdir(), 'dsh-mock-interview-d2-'))
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

function targetsOf(plan) {
  return plan.items.map((item) => item.target)
}

test('TC-HIS-210 再面一次 inherits the profile and the settings but starts from zero turns', async () => {
  const home = await tempHome()
  const first = await call(START, { home })
  const again = await call({ op: 'session/create', fromSessionId: first.value.sessionId }, { home })
  assert.equal(again.ok, true, JSON.stringify(again))

  const { session } = (await call({ op: 'session/get', sessionId: again.value.sessionId }, { home })).value
  assert.notEqual(session.id, first.value.sessionId, '必须是新记录，不能原地重置旧记录')
  assert.deepEqual(session.profile, PROFILE_CONFIRMED)
  assert.equal(session.mode, 'tech-1')
  assert.equal(session.difficulty, 'mid')
  assert.equal(session.minutes, 30)
  assert.deepEqual(session.turns, [])
  assert.equal(session.status, 'active')
  assert.deepEqual(session.tags, [], '新记录不带旧标签')
  await rm(home, { recursive: true, force: true })
})

test('TC-HIS-211 再面一次 regenerates the plan so at least half the targets change', async () => {
  const home = await tempHome()
  const first = await call(START, { home })
  const again = await call({ op: 'session/create', fromSessionId: first.value.sessionId }, { home })

  const before = targetsOf(first.value.plan)
  const after = targetsOf(again.value.plan)
  assert.equal(after.length, before.length, '时长相同则题量相同')

  const kept = after.filter((target) => before.includes(target)).length
  assert.ok(
    kept <= Math.floor(before.length / 2),
    `重复题不得超过一半，实际保留 ${kept}/${before.length}：${after.join(', ')}`,
  )
  assert.equal(again.value.plan.items.at(-1).kind, 'code', '最后一题仍是手撕')
  await rm(home, { recursive: true, force: true })
})

test('TC-HIS-212 再面一次 overrides what was sent and refuses an unknown source', async () => {
  const home = await tempHome()
  const first = await call(START, { home })
  const shorter = await call(
    { op: 'session/create', fromSessionId: first.value.sessionId, minutes: 15, difficulty: 'senior' },
    { home },
  )
  assert.equal(shorter.value.plan.items.length, 5, '显式时长优先于继承值')

  const { session } = (await call({ op: 'session/get', sessionId: shorter.value.sessionId }, { home })).value
  assert.equal(session.difficulty, 'senior')
  assert.equal(session.profile.skills.length, PROFILE_CONFIRMED.skills.length)

  const missing = await call({ op: 'session/create', fromSessionId: 'no-such-id' }, { home })
  assert.equal(missing.ok, false)
  assert.equal(missing.error.code, 'E_SESSION_NOT_FOUND')

  const blank = await call({ op: 'session/create', fromSessionId: '' }, { home })
  assert.equal(blank.ok, false)
  assert.equal(blank.error.code, 'E_BAD_REQUEST')
  await rm(home, { recursive: true, force: true })
})

test('TC-HIS-220 history/export writes one readable bundle of every record', async () => {
  const home = await tempHome()
  const dir = await mkdtemp(join(tmpdir(), 'dsh-mock-interview-d2-export-'))
  const a = await call(START, { home })
  await call({ ...START, mode: 'algo' }, { home })

  const exported = await call({ op: 'history/export', dir }, { home, cwd: dir })
  assert.equal(exported.ok, true, JSON.stringify(exported))
  assert.ok(exported.value.bytes > 0)
  assert.ok(exported.value.path.endsWith('.json'))

  const bundle = JSON.parse(await readFile(exported.value.path, 'utf8'))
  assert.equal(bundle.count, 2)
  assert.equal(bundle.sessions.length, 2)
  assert.ok(bundle.sessions.some((session) => session.id === a.value.sessionId))
  assert.ok(Array.isArray(bundle.sessions[0].plan.items), '整包要能再导入，必须带 plan')
  assert.equal(typeof bundle.exportedAt, 'number')
  await rm(home, { recursive: true, force: true })
  await rm(dir, { recursive: true, force: true })
})

test('TC-HIS-221 history/export leaves archived records out unless asked', async () => {
  const home = await tempHome()
  const dir = await mkdtemp(join(tmpdir(), 'dsh-mock-interview-d2-export-'))
  const keep = await call(START, { home })
  const archived = await call({ ...START, mode: 'algo' }, { home })
  await call({ op: 'session/update', sessionId: archived.value.sessionId, archived: true }, { home })

  const normal = await call({ op: 'history/export', dir }, { home, cwd: dir })
  const normalBundle = JSON.parse(await readFile(normal.value.path, 'utf8'))
  assert.equal(normalBundle.count, 1)
  assert.equal(normalBundle.sessions[0].id, keep.value.sessionId)

  const full = await call({ op: 'history/export', dir, archived: true }, { home, cwd: dir })
  const fullBundle = JSON.parse(await readFile(full.value.path, 'utf8'))
  assert.equal(fullBundle.count, 2, '显式要归档时才带着它')
  await rm(home, { recursive: true, force: true })
  await rm(dir, { recursive: true, force: true })
})

test('TC-HIS-222 archiving a record removes it from the list and from the stats but keeps the file', async () => {
  const home = await tempHome()
  const first = await call(START, { home })
  const second = await call({ ...START, mode: 'algo' }, { home })

  const archived = await call({ op: 'session/update', sessionId: second.value.sessionId, archived: true }, { home })
  assert.equal(archived.ok, true, JSON.stringify(archived))

  const normal = await call({ op: 'session/list' }, { home })
  assert.deepEqual(normal.value.sessions.map((row) => row.id), [first.value.sessionId])
  assert.equal(normal.value.stats.total, 1, '统计默认不含归档')
  assert.equal(normal.value.sessions[0].tags.includes(ARCHIVED_TAG), false)

  const only = await call({ op: 'session/list', archived: 'only' }, { home })
  assert.deepEqual(only.value.sessions.map((row) => row.id), [second.value.sessionId])
  assert.ok(only.value.sessions[0].tags.includes(ARCHIVED_TAG), '面板靠标签显示「已归档」')
  assert.equal(only.value.stats.total, 1, '只看归档时统计也只算归档')

  const restored = await call({ op: 'session/update', sessionId: second.value.sessionId, archived: false }, { home })
  assert.equal(restored.ok, true)
  assert.deepEqual(restored.value.session.tags, [])

  const back = await call({ op: 'session/list' }, { home })
  assert.equal(back.value.stats.total, 2)
  await rm(home, { recursive: true, force: true })
})