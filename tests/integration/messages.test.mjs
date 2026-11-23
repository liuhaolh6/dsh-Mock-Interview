import assert from 'node:assert/strict'
import test from 'node:test'

import { dispatch, handle, RPC_PATH } from '../../index.js'
import { explainError } from '../../lib/messages.mjs'
import { ContractError } from '../../lib/errors.mjs'

const URL_BASE = 'http://localhost' + RPC_PATH

function post(body) {
  return new Request(URL_BASE, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

async function call(body, deps) {
  const response = await dispatch(post(body), deps)
  assert.equal(response.status, 200)
  return response.json()
}

function fakeResponse() {
  const captured = { status: 0, body: '', headers: {} }
  const res = {
    writeHead(status, headers) {
      captured.status = status
      captured.headers = headers ?? {}
      return res
    },
    end(chunk) {
      if (chunk !== undefined) captured.body += String(chunk)
      return res
    },
    setHeader() {},
  }
  return { res, captured }
}

test('TC-MSG-010: every failure envelope carries a human hint', async () => {
  const payload = await call({ op: 'nope' })
  assert.equal(payload.ok, false)
  assert.equal(payload.error.code, 'E_UNKNOWN_ACTION')
  assert.deepEqual(payload.error.hint, explainError('E_UNKNOWN_ACTION', payload.error.message))
  assert.ok(payload.error.hint.title.length > 0)
  assert.ok(payload.error.hint.action.length > 0)
  assert.equal(payload.error.hint.retryable, false)
})

test('TC-MSG-011: a malformed request still explains itself', async () => {
  const payload = await call('{not json')
  assert.equal(payload.ok, false)
  assert.equal(payload.error.code, 'E_BAD_REQUEST')
  assert.equal(payload.error.hint.code, 'E_BAD_REQUEST')
  assert.match(payload.error.hint.title, /提交|内容/)
})

test('TC-MSG-012: a storage failure keeps its own code and is retryable', async () => {
  const failingStore = {
    get() {
      throw new ContractError('E_EXPORT_FAILED', 'EACCES: permission denied')
    },
    put() {},
    list() {
      return []
    },
    remove() {},
    update() {},
  }
  const payload = await call({ op: 'session/get', sessionId: 'abc' }, { store: failingStore })
  assert.equal(payload.ok, false)
  assert.equal(payload.error.code, 'E_EXPORT_FAILED')
  assert.equal(payload.error.hint.retryable, true)
})

test('TC-MSG-013: an unexpected crash still reaches the user as words', async () => {
  const broken = {
    async *[Symbol.asyncIterator]() {
      yield Buffer.from('{"op":')
      throw new Error('socket hang up')
    },
  }
  const { res, captured } = fakeResponse()
  await handle(broken, res, {})
  assert.equal(captured.status, 500)
  const payload = JSON.parse(captured.body)
  assert.equal(payload.error.code, 'E_INTERNAL')
  assert.equal(payload.error.hint.code, 'E_INTERNAL')
  assert.equal(payload.error.hint.retryable, true)
  assert.match(payload.error.message, /socket hang up/)
})
