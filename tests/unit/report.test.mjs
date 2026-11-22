import assert from 'node:assert/strict'
import test from 'node:test'

import { DIMENSIONS } from '../../lib/contracts.js'
import { buildReport, renderMarkdown } from '../../lib/report.mjs'

// S5 unit half: the shape and the judgement calls of a finished report.

function card(overrides = {}) {
  const dims = Object.fromEntries(DIMENSIONS.map((name) => [name, 3]))
  return {
    dims: { ...dims, ...overrides },
    overall: 3,
    verdict: 'ok',
    missing: [],
  }
}

function sessionWith(turns, extra = {}) {
  return {
    schemaVersion: 1,
    id: 's1',
    createdAt: 1000,
    updatedAt: 2000,
    status: 'finished',
    mode: 'tech-1',
    difficulty: 'mid',
    minutes: 30,
    profile: { skills: ['Java'], projects: [{ name: '订单中心' }] },
    plan: {
      items: [
        { id: 'q1', kind: 'basics', target: 'skill:Java', topic: '并发' },
        { id: 'q2', kind: 'project', target: 'project:订单中心', topic: '库存' },
        { id: 'q3', kind: 'code', target: 'bank:手撕', topic: '两数之和' },
      ],
    },
    turns,
    ...extra,
  }
}

const turn = (questionId, dims, extra = {}) => ({
  questionId,
  answer: '一段回答',
  score: card(dims),
  at: 1500,
  ...extra,
})

test('TC-REP-001 a report carries per-question scores, six dimensions and the static-review flag', () => {
  const report = buildReport(
    sessionWith([turn('q1', { correctness: 4 }), turn('q2', { project: 5, depth: 2 })]),
  )

  assert.equal(report.sessionId, 's1')
  assert.equal(report.answered, 2)
  assert.equal(report.planned, 3)
  assert.equal(report.items.length, 2)
  assert.deepEqual(
    report.items.map((item) => item.questionId),
    ['q1', 'q2'],
  )
  assert.equal(report.items[1].kind, 'project')
  assert.deepEqual(Object.keys(report.dims).sort(), [...DIMENSIONS].sort())
  // Two turns average: correctness (4+3)/2, project (3+5)/2.
  assert.equal(report.dims.correctness, 3.5)
  assert.equal(report.dims.project, 4)
  // The rubric can never execute code, and the report must say so (ADR-0004).
  assert.equal(report.codeVerified, false)
})

test('TC-REP-002 the three weakest dimensions come first, each with its own action', () => {
  const dims = { correctness: 4, depth: 2, structure: 3, project: 5, code: 1, communication: 4 }
  const report = buildReport(sessionWith([turn('q1', dims)]))

  assert.deepEqual(report.weakTop3, ['code', 'depth', 'structure'])
  assert.equal(report.actions.length, report.weakTop3.length)
  for (const action of report.actions) {
    assert.equal(typeof action, 'string')
    assert.ok(action.length > 4, 'every weakness needs a real action')
  }
  assert.equal(new Set(report.actions).size, report.actions.length, 'actions must not repeat')
})

test('TC-REP-003 a report with no answers says the sample is too small but still renders', () => {
  const report = buildReport(sessionWith([]))

  assert.equal(report.answered, 0)
  assert.equal(report.sampleAdequate, false)
  assert.equal(report.overall, null)
  for (const name of DIMENSIONS) assert.equal(report.radar.dims[name], null)
  assert.deepEqual(report.weakTop3, [])
  assert.deepEqual(report.actions, [])

  const markdown = renderMarkdown(report)
  assert.match(markdown, /样本不足/)
  assert.match(markdown, /s1/)
  assert.match(markdown, /未真实执行/)
})