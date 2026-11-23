import test from 'node:test'
import assert from 'node:assert/strict'

import { emptyReasonFor, readinessOf } from '../../lib/onboarding.mjs'

test('TC-ONB-001: no records at all reads as "none"', () => {
  assert.equal(emptyReasonFor({ allCount: 0, pageCount: 0, filtered: false }), 'none')
  assert.equal(emptyReasonFor({ allCount: 0, pageCount: 0, filtered: true }), 'none')
})

test('TC-ONB-002: filters that match nothing read as "filtered"', () => {
  assert.equal(emptyReasonFor({ allCount: 3, pageCount: 0, filtered: true }), 'filtered')
  assert.equal(emptyReasonFor({ allCount: 3, pageCount: 0, filtered: false }), 'filtered')
})

test('TC-ONB-003: a page with rows reports no empty reason', () => {
  assert.equal(emptyReasonFor({ allCount: 3, pageCount: 2, filtered: true }), null)
})

test('TC-ONB-004: a profile without skills or projects cannot start', () => {
  const view = readinessOf({ skills: [], projects: [] })
  assert.equal(view.ready, false)
  assert.deepEqual(view.blockers, ['skills', 'projects'])
})

test('TC-ONB-005: one skill is enough to start, and blockers name what is missing', () => {
  const view = readinessOf({ skills: ['Java'], projects: [] })
  assert.equal(view.ready, true)
  assert.deepEqual(view.blockers, ['projects'])
  assert.equal(readinessOf({ skills: ['Java'], projects: [{ name: '订单中心' }] }).blockers.length, 0)
})

test('TC-ONB-006: malformed profiles degrade to "not ready" instead of throwing', () => {
  assert.equal(readinessOf(null).ready, false)
  assert.equal(readinessOf({ skills: 'Java', projects: 3 }).ready, false)
})
