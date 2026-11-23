import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { dispatch, RPC_PATH } from '../../index.js'
import { fakeLlm } from '../helpers/fake-llm.mjs'
import { SCORE_VALID } from '../fixtures/score.mjs'
import { PROFILE_CONFIRMED } from '../fixtures/resume.mjs'

// S-B1: interview records must be creatable, listable, searchable, updatable and deletable.

const URL_BASE = 'http://localhost' + RPC_PATH
const START = { op: 'session/create', profile: PROFILE_CONFIRMED, mode: 'tech-1', difficulty: 'mid', minutes: 15 }

async function tempHome() {
  return mkdtemp(join(tmpdir(), 'dsh-mock-interview-b1-'))
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

async function threeRecords(home) {
  let clock = 1_700_000_000_000
  const deps = { home, now: () => (clock += 1_000) }
  const first = await call(START, deps)
  const second = await call({ ...START, mode: 'project', difficulty: 'senior' }, deps)
  const third = await call({ ...START, mode: 'behavior', difficulty: 'junior' }, deps)
  return { deps, ids: [first.value.sessionId, second.value.sessionId, third.value.sessionId] }
}

test('TC-HIS-100 a new record gets an auto title instead of an empty heading', async () => {
  const home = await tempHome()
  const created = await call(START, { home })
  const got = await call({ op: 'session/get', sessionId: created.value.sessionId }, { home })

  const { session } = got.value
  assert.equal(typeof session.title, 'string')
  assert.ok(session.title.trim().length > 0, 'title must not be blank')
  assert.deepEqual(session.tags, [])
  assert.equal(session.note, '')

  const listed = await call({ op: 'session/list' }, { home })
  assert.equal(listed.value.sessions[0].title, session.title)
  await rm(home, { recursive: true, force: true })
})

test('TC-HIS-101 session/update renames a record without touching its plan or turns', async () => {
  const home = await tempHome()
  const { deps, ids } = await threeRecords(home)
  const before = await call({ op: 'session/get', sessionId: ids[0] }, deps)

  const updated = await call({ op: 'session/update', sessionId: ids[0], title: '  订单中心专场  ' }, deps)
  assert.equal(updated.value.session.title, '订单中心专场')

  const after = await call({ op: 'session/get', sessionId: ids[0] }, deps)
  assert.equal(after.value.session.title, '订单中心专场')
  assert.equal(after.value.session.createdAt, before.value.session.createdAt)
  assert.ok(after.value.session.updatedAt > before.value.session.updatedAt, 'updatedAt must move forward')
  assert.deepEqual(after.value.session.plan, before.value.session.plan)
  assert.deepEqual(after.value.session.turns, before.value.session.turns)

  const tagged = await call({ op: 'session/update', sessionId: ids[0], tags: ['Redis', '订单'], note: '缓存要补' }, deps)
  assert.deepEqual(tagged.value.session.tags, ['Redis', '订单'])
  assert.equal(tagged.value.session.note, '缓存要补')
  assert.equal(tagged.value.session.title, '订单中心专场', 'partial update keeps the other fields')
  await rm(home, { recursive: true, force: true })
})

test('TC-HIS-102 session/update refuses bad patches and unknown records', async () => {
  const home = await tempHome()
  const { deps, ids } = await threeRecords(home)

  const cases = [
    [{ op: 'session/update', sessionId: ids[0] }, 'E_BAD_REQUEST'],
    [{ op: 'session/update', sessionId: ids[0], title: '   ' }, 'E_BAD_REQUEST'],
    [{ op: 'session/update', sessionId: ids[0], title: 'x'.repeat(81) }, 'E_BAD_REQUEST'],
    [{ op: 'session/update', sessionId: ids[0], tags: Array.from({ length: 11 }, (_, i) => `t${i}`) }, 'E_BAD_REQUEST'],
    [{ op: 'session/update', sessionId: ids[0], note: 'n'.repeat(2_001) }, 'E_BAD_REQUEST'],
    [{ op: 'session/update', sessionId: 'ghost', title: 'x' }, 'E_SESSION_NOT_FOUND'],
  ]
  for (const [body, code] of cases) {
    const refused = await call(body, deps)
    assert.equal(refused.error?.code, code, JSON.stringify(body).slice(0, 90))
  }
  await rm(home, { recursive: true, force: true })
})

test('TC-HIS-103 session/list searches and filters records, and paginates them', async () => {
  const home = await tempHome()
  const { deps, ids } = await threeRecords(home)
  await call({ op: 'session/update', sessionId: ids[1], title: 'Redis 缓存专场', tags: ['Redis'] }, deps)

  const all = await call({ op: 'session/list' }, deps)
  assert.equal(all.value.total, 3)
  assert.equal(all.value.hasMore, false)

  const byQuery = await call({ op: 'session/list', query: 'redis' }, deps)
  assert.deepEqual(byQuery.value.sessions.map((s) => s.id), [ids[1]])

  const byTag = await call({ op: 'session/list', tag: 'Redis' }, deps)
  assert.deepEqual(byTag.value.sessions.map((s) => s.id), [ids[1]])

  const byMode = await call({ op: 'session/list', mode: 'behavior' }, deps)
  assert.deepEqual(byMode.value.sessions.map((s) => s.id), [ids[2]])

  const byDifficulty = await call({ op: 'session/list', difficulty: 'senior' }, deps)
  assert.deepEqual(byDifficulty.value.sessions.map((s) => s.id), [ids[1]])

  const page = await call({ op: 'session/list', limit: 2, offset: 1 }, deps)
  assert.equal(page.value.sessions.length, 2)
  assert.equal(page.value.total, 3)
  assert.equal(page.value.hasMore, false)

  const firstPage = await call({ op: 'session/list', limit: 2, offset: 0 }, deps)
  assert.equal(firstPage.value.hasMore, true)

  for (const bad of [{ status: 'done' }, { mode: 'hr' }, { difficulty: 'expert' }, { sort: 'best' }, { offset: -1 }]) {
    const refused = await call({ op: 'session/list', ...bad }, deps)
    assert.equal(refused.error?.code, 'E_BAD_REQUEST', JSON.stringify(bad))
  }
  await rm(home, { recursive: true, force: true })
})

test('TC-HIS-104 session/delete removes one record or a batch, idempotently', async () => {
  const home = await tempHome()
  const { deps, ids } = await threeRecords(home)

  const single = await call({ op: 'session/delete', sessionId: ids[0] }, deps)
  assert.deepEqual(single.value, { deleted: true })
  assert.deepEqual((await call({ op: 'session/delete', sessionId: ids[0] }, deps)).value, { deleted: true })

  const batch = await call({ op: 'session/delete', ids: [ids[1], ids[2]] }, deps)
  assert.deepEqual(batch.value, { deleted: 2 })

  const again = await call({ op: 'session/delete', ids: [ids[1], ids[2]] }, deps)
  assert.deepEqual(again.value, { deleted: 0 })

  const left = await call({ op: 'session/list' }, deps)
  assert.equal(left.value.total, 0)

  for (const bad of [
    { op: 'session/delete' },
    { op: 'session/delete', ids: Array.from({ length: 51 }, (_, i) => `id-${i}`) },
    { op: 'session/delete', ids: ['ok', 7] },
    { op: 'session/delete', ids: 'not-an-array' },
    { op: 'session/delete', sessionId: ids[0], ids: [ids[1]] },
  ]) {
    const refused = await call(bad, deps)
    assert.equal(refused.error?.code, 'E_BAD_REQUEST', JSON.stringify(bad).slice(0, 80))
  }
  await rm(home, { recursive: true, force: true })
})

test('TC-HIS-105 an unfinished record can be resumed, and re-answering overwrites in place', async () => {
  const home = await tempHome()
  const created = await call(START, { home })
  const { sessionId, plan } = created.value
  const questionId = plan.items[0].id
  const deps = { home, complete: fakeLlm({ replies: [SCORE_VALID, SCORE_VALID] }).complete }

  await call({ op: 'turn/answer', sessionId, questionId, answer: '先说结论：缓存穿透用布隆过滤器' }, deps)
  const firstRound = await call({ op: 'session/get', sessionId }, deps)
  assert.equal(firstRound.value.session.turns.length, 1)

  await call({ op: 'session/update', sessionId, title: '续考专场' }, deps)

  const resumed = await call({ op: 'session/get', sessionId }, deps)
  assert.equal(resumed.value.session.status, 'active')
  assert.equal(resumed.value.session.turns.length, 1, 'resuming must not add a phantom turn')

  const reanswered = await call({ op: 'turn/answer', sessionId, questionId, answer: '改成：缓存穿透用布隆过滤器 + 空值缓存' }, deps)
  assert.equal(reanswered.value.score.overall, firstRound.value.session.turns[0].score.overall)

  const final = await call({ op: 'session/get', sessionId }, deps)
  assert.equal(final.value.session.turns.length, 1, 'same question must overwrite, not duplicate')
  assert.match(final.value.session.turns[0].answer, /空值缓存/)
  assert.equal(final.value.session.title, '续考专场')
  await rm(home, { recursive: true, force: true })
})