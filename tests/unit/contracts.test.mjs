import assert from 'node:assert/strict'
import test from 'node:test'

import { ACTIONS, ERROR_CODES, RPC_PATH, SCHEMA_VERSION } from '../../lib/contracts.js'

test('TC-CON-001 schema version is a positive integer', () => {
  assert.equal(Number.isInteger(SCHEMA_VERSION), true)
  assert.ok(SCHEMA_VERSION >= 1)
})

test('TC-CON-002 actions are unique, non-empty and sorted', () => {
  assert.ok(Array.isArray(ACTIONS))
  assert.ok(ACTIONS.length > 0)
  for (const action of ACTIONS) {
    assert.equal(typeof action, 'string')
    assert.match(action, /^[a-z][a-z0-9-]*$/)
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