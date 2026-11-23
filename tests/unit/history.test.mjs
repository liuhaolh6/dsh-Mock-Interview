import assert from 'node:assert/strict'
import test from 'node:test'

import { listSessions, pickPatch, sessionMeta } from '../../lib/history.mjs'

// S-B1: pure helpers for managing interview records (create/read/update/delete).

const row = (over) => ({
  id: 'id-1',
  title: 'Java 后端 · 11-23 14:05',
  tags: [],
  note: '',
  status: 'active',
  mode: 'tech-1',
  difficulty: 'mid',
  createdAt: 1_000,
  updatedAt: 2_000,
  turns: 3,
  overall: 3.1,
  ...over,
})

test('TC-HIS-001 an empty patch is refused instead of silently touching the record', () => {
  assert.throws(() => pickPatch({}), (problem) => problem.code === 'E_BAD_REQUEST')
  assert.throws(() => pickPatch({ sessionId: 'x' }), (problem) => problem.code === 'E_BAD_REQUEST')
  assert.deepEqual(pickPatch({ title: '订单中心专场' }), { title: '订单中心专场' })
})

test('TC-HIS-002 title is trimmed, non-empty and capped at 80 characters', () => {
  assert.deepEqual(pickPatch({ title: '  订单中心  ' }), { title: '订单中心' })
  for (const bad of ['', '   ', 'x'.repeat(81), 42, null]) {
    assert.throws(
      () => pickPatch({ title: bad }),
      (problem) => problem.code === 'E_BAD_REQUEST',
      `title ${JSON.stringify(bad)}`,
    )
  }
  assert.equal(pickPatch({ title: 'x'.repeat(80) }).title.length, 80)
})

test('TC-HIS-003 tags are trimmed, de-duplicated in first-seen order and bounded', () => {
  assert.deepEqual(pickPatch({ tags: [' Redis ', 'redis', 'MySQL'] }).tags, ['Redis', 'redis', 'MySQL'])
  assert.deepEqual(pickPatch({ tags: [] }).tags, [])
  const many = Array.from({ length: 11 }, (_, index) => `t${index}`)
  for (const bad of [many, ['ok', ''], ['x'.repeat(25)], 'Redis', [1]]) {
    assert.throws(
      () => pickPatch({ tags: bad }),
      (problem) => problem.code === 'E_BAD_REQUEST',
      `tags ${JSON.stringify(bad)}`,
    )
  }
})

test('TC-HIS-004 note is trimmed at the edges, keeps inner newlines and caps at 2000', () => {
  assert.deepEqual(pickPatch({ note: '  第一行\n第二行  ' }), { note: '第一行\n第二行' })
  assert.throws(() => pickPatch({ note: 'y'.repeat(2_001) }), (problem) => problem.code === 'E_BAD_REQUEST')
  assert.throws(() => pickPatch({ note: 7 }), (problem) => problem.code === 'E_BAD_REQUEST')
})

test('TC-HIS-005 query and filters combine with AND, query is case-insensitive', () => {
  const rows = [
    row({ id: 'a', title: 'Redis 缓存专场', tags: ['缓存'], status: 'finished', difficulty: 'senior', overall: 4 }),
    row({ id: 'b', title: '订单中心', tags: ['Redis'], status: 'active', difficulty: 'mid', overall: 2.5 }),
    row({ id: 'c', title: '基础八股', note: 'redis 的持久化没答好', status: 'finished', difficulty: 'junior', overall: null }),
  ]

  const hit = listSessions(rows, { query: 'REDIS' })
  assert.deepEqual(hit.sessions.map((item) => item.id).sort(), ['a', 'b', 'c'])
  assert.equal(hit.total, 3)

  assert.deepEqual(listSessions(rows, { query: 'redis', status: 'active' }).sessions.map((s) => s.id), ['b'])
  assert.deepEqual(listSessions(rows, { tag: 'redis' }).sessions.map((s) => s.id), ['b'])
  assert.deepEqual(listSessions(rows, { mode: 'tech-1', difficulty: 'junior' }).sessions.map((s) => s.id), ['c'])
  assert.deepEqual(listSessions(rows, { query: '不存在的词' }).sessions, [])
})

test('TC-HIS-006 sort is recent/oldest/score (null last) and pagination reports totals', () => {
  const rows = [
    row({ id: 'a', updatedAt: 100, overall: 2 }),
    row({ id: 'b', updatedAt: 300, overall: null }),
    row({ id: 'c', updatedAt: 200, overall: 4 }),
  ]

  assert.deepEqual(listSessions(rows, {}).sessions.map((s) => s.id), ['b', 'c', 'a'])
  assert.deepEqual(listSessions(rows, { sort: 'oldest' }).sessions.map((s) => s.id), ['a', 'c', 'b'])
  assert.deepEqual(listSessions(rows, { sort: 'score' }).sessions.map((s) => s.id), ['c', 'a', 'b'])

  const page = listSessions(rows, { sort: 'recent', limit: 2, offset: 0 })
  assert.deepEqual(page.sessions.map((s) => s.id), ['b', 'c'])
  assert.equal(page.hasMore, true)
  assert.equal(page.total, 3)

  const tail = listSessions(rows, { sort: 'recent', limit: 2, offset: 2 })
  assert.deepEqual(tail.sessions.map((s) => s.id), ['a'])
  assert.equal(tail.hasMore, false)

  for (const bad of [{ limit: 0 }, { limit: 101 }, { limit: 1.5 }, { offset: -1 }, { sort: 'best' }, { status: 'done' }]) {
    assert.throws(
      () => listSessions(rows, bad),
      (problem) => problem.code === 'E_BAD_REQUEST',
      JSON.stringify(bad),
    )
  }
})

test('TC-HIS-007 the list summary never leaks the full note or the sort key', () => {
  const meta = sessionMeta(row({ note: '很长的复盘', updatedAt: 2_000 }))
  assert.equal(meta.title, 'Java 后端 · 11-23 14:05')
  assert.deepEqual(meta.tags, [])
  assert.equal(meta.turns, 3)
  assert.equal(meta.overall, 3.1)
  assert.ok(!('note' in meta), 'list rows must not carry the note')
  assert.ok(!('updatedAt' in meta), 'updatedAt is a sort key, not payload')
})