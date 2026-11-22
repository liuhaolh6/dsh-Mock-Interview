import assert from 'node:assert/strict'
import test from 'node:test'

import { apply, dispatch, RPC_PATH, VERSION } from '../../index.js'

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
  assert.equal(response.headers.get('cache-control'), 'no-store')
  return response.json()
}

test('TC-RPC-001 ping answers with a pong envelope', async () => {
  const payload = await call({ op: 'ping' }, { now: () => 1234 })
  assert.equal(payload.ok, true)
  assert.deepEqual(payload.value, { pong: true, version: VERSION, schemaVersion: 1, at: 1234 })
})

test('TC-RPC-002 unknown op is rejected with E_UNKNOWN_ACTION', async () => {
  const payload = await call({ op: 'start-interview' })
  assert.equal(payload.ok, false)
  assert.equal(payload.error.code, 'E_UNKNOWN_ACTION')
  assert.match(payload.error.message, /start-interview/)
})

test('TC-RPC-003 missing op is rejected', async () => {
  const payload = await call({})
  assert.equal(payload.ok, false)
  assert.equal(payload.error.code, 'E_UNKNOWN_ACTION')
})

test('TC-RPC-004 malformed JSON is rejected with E_BAD_REQUEST', async () => {
  const payload = await call('{not json')
  assert.equal(payload.ok, false)
  assert.equal(payload.error.code, 'E_BAD_REQUEST')
})

test('TC-RPC-005 non-object JSON bodies are rejected', async () => {
  for (const body of ['[]', 'null', '"op"', '42']) {
    const payload = await call(body)
    assert.equal(payload.ok, false, `body ${body}`)
    assert.equal(payload.error.code, 'E_BAD_REQUEST', `body ${body}`)
  }
})

/** Minimal Cordis scope stand-in: records the effect and exposes the server. */
function fakeContext(server) {
  const effects = []
  const routes = []
  const registeringServer = {
    register(route) {
      routes.push(route)
      return () => {
        routes.pop()
      }
    },
  }
  const ctx = {
    inject(deps, fn) {
      assert.deepEqual(deps, ['webServer'])
      fn({
        get: (name) => (name === 'webServer' ? (server ?? registeringServer) : undefined),
        effect: (factory, label) => {
          effects.push({ label, dispose: factory() })
        },
      })
    },
  }
  return { ctx, effects, routes }
}

/** Node-style request: an async iterable of chunks. */
function fakeRequest(chunks) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield Buffer.from(chunk)
    },
  }
}

function fakeResponse() {
  const captured = { status: 0, headers: undefined, body: '' }
  return {
    captured,
    res: {
      writeHead(status, headers) {
        captured.status = status
        captured.headers = headers
      },
      end(text) {
        captured.body = text
      },
    },
  }
}

test('TC-WIR-001 apply registers one exact route on the host server', () => {
  const { ctx, effects, routes } = fakeContext()
  apply(ctx)
  assert.equal(routes.length, 1)
  assert.equal(routes[0].kind, 'exact')
  assert.equal(routes[0].path, RPC_PATH)
  assert.equal(typeof routes[0].handler, 'function')
  assert.equal(effects.length, 1)
  assert.match(effects[0].label, /dsh-mock-interview/)
})

test('TC-WIR-002 apply tolerates a composition without a web server', () => {
  const ctx = {
    inject: (deps, fn) => fn({ get: () => undefined, effect: () => {} }),
  }
  assert.doesNotThrow(() => apply(ctx))
})

test('TC-WIR-003 the route handler answers a real request stream', async () => {
  const { ctx, routes } = fakeContext()
  apply(ctx)
  const { res, captured } = fakeResponse()
  await routes[0].handler(fakeRequest([JSON.stringify({ op: 'ping' })]), res)
  assert.equal(captured.status, 200)
  assert.equal(captured.headers['content-type'], 'application/json; charset=utf-8')
  const payload = JSON.parse(captured.body)
  assert.equal(payload.ok, true)
  assert.equal(payload.value.pong, true)
})

test('TC-WIR-004 an empty body is treated as a missing op', async () => {
  const { ctx, routes } = fakeContext()
  apply(ctx)
  const { res, captured } = fakeResponse()
  await routes[0].handler(fakeRequest([]), res)
  assert.equal(captured.status, 200)
  assert.equal(JSON.parse(captured.body).error.code, 'E_UNKNOWN_ACTION')
})

test('TC-WIR-005 a broken request stream answers 500 with E_INTERNAL', async () => {
  const { ctx, routes } = fakeContext()
  apply(ctx)
  const { res, captured } = fakeResponse()
  const broken = {
    async *[Symbol.asyncIterator]() {
      yield Buffer.from('{"op":')
      throw new Error('socket hang up')
    },
  }
  await routes[0].handler(broken, res)
  assert.equal(captured.status, 500)
  const payload = JSON.parse(captured.body)
  assert.equal(payload.error.code, 'E_INTERNAL')
  assert.match(payload.error.message, /socket hang up/)
})