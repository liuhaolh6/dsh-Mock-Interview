import assert from 'node:assert/strict'
import test from 'node:test'

import { ACTIONS, DIMENSIONS, DIFFICULTIES, DURATIONS, ERROR_CODES, LIMITS, MODES, PLANNED_ERROR_CODES, RPC_PATH, SCHEMA_VERSION } from '../../lib/contracts.js'

test('TC-CON-001 schema version is a positive integer', () => {
  assert.equal(Number.isInteger(SCHEMA_VERSION), true)
  assert.ok(SCHEMA_VERSION >= 1)
})

test('TC-CON-002 actions are unique, non-empty and sorted', () => {
  assert.ok(Array.isArray(ACTIONS))
  assert.ok(ACTIONS.length > 0)
  for (const action of ACTIONS) {
    assert.equal(typeof action, 'string')
    // Namespaced ops (`session/create`) are part of the frozen contract §3, so
    // the shape allows one or more `/`-separated lowercase segments.
    assert.match(action, /^[a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)*$/)
  }
  assert.equal(new Set(ACTIONS).size, ACTIONS.length)
  assert.deepEqual(ACTIONS, [...ACTIONS].sort())
})

test('TC-CON-003 error codes use the E_ prefix with a human message', () => {
  const codes = Object.keys(ERROR_CODES)
  assert.ok(codes.length > 0)
  for (const code of codes) {
    assert.match(code, /^E_[A-Z_]+$/)
    assert.equal(typeof ERROR_CODES[code], 'string')
    assert.ok(ERROR_CODES[code].length > 0)
  }
})

test('TC-CON-004 the RPC path lives under the plugin prefix', () => {
  assert.equal(RPC_PATH, '/api/dsh-mock-interview/rpc')
})

test('TC-CON-005 the four interview modes and three difficulties are the wire values', () => {
  assert.deepEqual(MODES, ['tech-1', 'project', 'algo', 'behavior'])
  assert.deepEqual(DIFFICULTIES, ['junior', 'mid', 'senior'])
})

test('TC-CON-006 durations map to the 5 / 9 / 13 question budgets', () => {
  assert.deepEqual(DURATIONS, { 15: 5, 30: 9, 45: 13 })
})

test('TC-CON-007 the rubric has six distinct dimensions in display order', () => {
  assert.equal(DIMENSIONS.length, 6)
  assert.deepEqual(DIMENSIONS, ['correctness', 'depth', 'structure', 'project', 'code', 'communication'])
})

test('TC-CON-008 limits are positive integers and answer fits request', () => {
  for (const [key, value] of Object.entries(LIMITS)) {
    assert.equal(Number.isInteger(value), true, `${key} must be an integer`)
    assert.ok(value > 0, `${key} must be positive`)
  }
  assert.ok(LIMITS.maxAnswerChars < LIMITS.maxRequestBytes, 'an answer must fit in one request')
  assert.ok(LIMITS.maxResumeChars > LIMITS.maxAnswerChars, 'a resume is longer than one answer')
})

test('TC-CON-009 planned error codes are E_-shaped and not yet implemented', () => {
  assert.ok(PLANNED_ERROR_CODES.length > 0)
  assert.equal(new Set(PLANNED_ERROR_CODES).size, PLANNED_ERROR_CODES.length)
  for (const code of PLANNED_ERROR_CODES) {
    assert.match(code, /^E_[A-Z_]+$/)
    assert.equal(Object.hasOwn(ERROR_CODES, code), false, `${code} must move out of PLANNED once implemented`)
  }
})