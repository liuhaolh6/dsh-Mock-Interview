import test from 'node:test'
import assert from 'node:assert/strict'

import { ERROR_CODES, PLANNED_ERROR_CODES } from '../../lib/contracts.js'
import { explainError, ALL_ERROR_CODES } from '../../lib/messages.mjs'

const CODES = [...new Set([...Object.keys(ERROR_CODES), ...PLANNED_ERROR_CODES])]

test('TC-MSG-001: every contract error code has a human explanation', () => {
  for (const code of CODES) {
    const text = explainError(code)
    assert.equal(typeof text.title, 'string', `${code} title`)
    assert.equal(typeof text.detail, 'string', `${code} detail`)
    assert.equal(typeof text.action, 'string', `${code} action`)
    assert.ok(text.title.length >= 4, `${code} title is too short`)
    assert.ok(text.action.length >= 4, `${code} action is too short`)
  }
  assert.deepEqual([...ALL_ERROR_CODES].sort(), [...CODES].sort())
})

test('TC-MSG-002: explanations avoid raw technical jargon in the title', () => {
  for (const code of CODES) {
    const { title } = explainError(code)
    assert.ok(!title.includes('E_'), `${code} title leaks the code`)
    assert.ok(!/undefined|null|\[object/.test(title), `${code} title leaks internals`)
  }
})

test('TC-MSG-003: unknown codes fall back to a generic, honest message', () => {
  const text = explainError('E_SOMETHING_NEW')
  assert.match(text.title, /出错|问题/)
  assert.match(text.action, /重试|报告|日志|刷新/)
  assert.equal(text.code, 'E_SOMETHING_NEW')
})

test('TC-MSG-004: retryable codes tell the user to retry, terminal ones do not', () => {
  for (const code of ['E_LLM_TIMEOUT', 'E_LLM_UNAVAILABLE', 'E_SCORE_INVALID', 'E_EXPORT_FAILED']) {
    assert.equal(explainError(code).retryable, true, `${code} should be retryable`)
  }
  for (const code of ['E_BAD_REQUEST', 'E_SESSION_NOT_FOUND', 'E_UNKNOWN_ACTION', 'E_SESSION_FINISHED']) {
    assert.equal(explainError(code).retryable, false, `${code} should not promise a retry`)
  }
})

test('TC-MSG-005: detail keeps the server message so the user can report it', () => {
  const text = explainError('E_LLM_UNAVAILABLE', 'model qwen not reachable')
  assert.match(text.detail, /model qwen not reachable/)
  assert.equal(text.code, 'E_LLM_UNAVAILABLE')
})
