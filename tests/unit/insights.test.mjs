import test from 'node:test'
import assert from 'node:assert/strict'

import { progressOf, statsOf, trendOf } from '../../lib/insights.mjs'

function session(overrides = {}) {
  return {
    id: 's1',
    createdAt: 1_000_000,
    status: 'active',
    mode: 'tech-1',
    difficulty: 'mid',
    plan: { items: [{ id: 'q-1' }, { id: 'q-2' }, { id: 'q-3' }] },
    turns: [],
    ...overrides,
  }
}

function turn(id, overall) {
  return { questionId: id, answer: 'x', score: overall === null ? null : { overall, dims: { values: {} } } }
}

test('TC-INS-001: a fresh session starts at the first question', () => {
  const view = progressOf(session(), { now: 1_060_000 })
  assert.equal(view.index, 1)
  assert.equal(view.total, 3)
  assert.equal(view.answered, 0)
  assert.equal(view.remaining, 3)
  assert.equal(view.elapsedMs, 60_000)
  assert.equal(view.avgScore, null)
})

test('TC-INS-002: answered questions advance the index and the average', () => {
  const view = progressOf(
    session({ turns: [turn('q-1', 4), turn('q-2', 3)] }),
    { now: 1_120_000 },
  )
  assert.equal(view.index, 3)
  assert.equal(view.answered, 2)
  assert.equal(view.remaining, 1)
  assert.equal(view.avgScore, 3.5)
  assert.equal(view.elapsedMs, 120_000)
})

test('TC-INS-003: a finished session reports no remaining questions', () => {
  const view = progressOf(
    session({ status: 'finished', turns: [turn('q-1', 4), turn('q-2', 4), turn('q-3', 4)] }),
    { now: 1_200_000 },
  )
  assert.equal(view.remaining, 0)
  assert.equal(view.finished, true)
  assert.equal(view.avgScore, 4)
})

test('TC-INS-004: a re-answered question does not double count', () => {
  const view = progressOf(
    session({ turns: [turn('q-1', 2), turn('q-1', 5)] }),
    { now: 1_100_000 },
  )
  assert.equal(view.answered, 1)
  assert.equal(view.avgScore, 3.5)
})

test('TC-INS-005: stats aggregate the record list', () => {
  const rows = [
    { id: 'a', status: 'finished', turns: 5, overall: 4 },
    { id: 'b', status: 'finished', turns: 5, overall: 3 },
    { id: 'c', status: 'active', turns: 2, overall: null },
  ]
  const stats = statsOf(rows)
  assert.equal(stats.total, 3)
  assert.equal(stats.finished, 2)
  assert.equal(stats.active, 1)
  assert.equal(stats.avgScore, 3.5)
  assert.equal(stats.answeredTurns, 12)
})

test('TC-INS-006: trend keeps the newest n and ignores unscored sessions', () => {
  const rows = [
    { id: 'old', status: 'finished', updatedAt: 1, overall: 1 },
    { id: 'new', status: 'finished', updatedAt: 5, overall: 5 },
    { id: 'mid', status: 'finished', updatedAt: 3, overall: 3 },
    { id: 'draft', status: 'active', updatedAt: 9, overall: null },
  ]
  const trend = trendOf(rows, 2)
  // Newest first when picking, then reversed for display: oldest → newest.
  assert.deepEqual(
    trend.map((point) => point.overall),
    [3, 5],
  )
  assert.deepEqual(
    trend.map((point) => point.id),
    ['mid', 'new'],
  )
})

test('TC-INS-007: empty inputs degrade instead of throwing', () => {
  const empty = progressOf({ plan: { items: [] }, turns: [] }, { now: 5 })
  assert.equal(empty.total, 0)
  assert.equal(empty.index, 0)
  assert.equal(empty.remaining, 0)
  assert.deepEqual(statsOf([]), { total: 0, finished: 0, active: 0, avgScore: null, answeredTurns: 0 })
  assert.deepEqual(trendOf([], 5), [])
})
