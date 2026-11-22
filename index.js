/**
 * dsh-mock-interview — Host half.
 *
 * G1 scope: the transport plumbing only. One JSON-over-POST endpoint at
 * /api/dsh-mock-interview/rpc, one `ping` action, one error envelope. The
 * interview engine (profile extraction, question director, rubric scoring,
 * report rendering) is added in G4 one test case at a time — see
 * docs/test-plan.md.
 *
 * Failure policy: registering the route never fails the composition. Without a
 * web server the plugin has no browser surface and stays inert; the browser
 * half reports the missing transport itself.
 *
 * @module index.js
 */

import { ACTIONS, ERROR_CODES, RPC_PATH, SCHEMA_VERSION } from './lib/contracts.js'

export const name = 'dsh-mock-interview'
export const inject = []

export const VERSION = '0.1.0'

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
}

/** Success envelope. */
function ok(value) {
  return Response.json({ ok: true, value }, { headers: JSON_HEADERS })
}

/** Business failure envelope; `code` must exist in ERROR_CODES (lint-enforced). */
function fail(code, message) {
  return Response.json(
    { ok: false, error: { code, message: message === undefined ? ERROR_CODES[code] ?? '' : message } },
    { status: 200, headers: JSON_HEADERS },
  )
}

/**
 * Pure request/response core, independent of the Node http objects.
 *
 * @param {Request} request
 * @param {{ now?: () => number }} [deps]
 * @returns {Promise<Response>}
 */
export async function dispatch(request, deps = {}) {
  const now = typeof deps.now === 'function' ? deps.now : Date.now

  let body
  try {
    body = await request.json()
  } catch {
    return fail('E_BAD_REQUEST', 'body is not JSON')
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return fail('E_BAD_REQUEST', 'body must be a JSON object')
  }

  const op = typeof body.op === 'string' ? body.op : ''
  if (!ACTIONS.includes(op)) return fail('E_UNKNOWN_ACTION', `unknown op "${op}"`)

  switch (op) {
    case 'ping':
      return ok({ pong: true, version: VERSION, schemaVersion: SCHEMA_VERSION, at: now() })
    default:
      // Unreachable while ACTIONS and this switch agree; contract-lint proves it.
      return fail('E_UNKNOWN_ACTION', `unhandled op "${op}"`)
  }
}

/** Drain a Node request stream into a buffer. */
async function readBody(req) {
  if (typeof req?.[Symbol.asyncIterator] !== 'function') return null
  const chunks = []
  for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  if (chunks.length === 0) return null
  return Buffer.concat(chunks)
}

/** Node http adapter: turn (req, res) into one dispatch call. */
async function handle(req, res) {
  const write = (status, text) => {
    res.writeHead(status, JSON_HEADERS)
    res.end(text)
  }
  try {
    const raw = await readBody(req)
    const request = new Request('http://localhost' + RPC_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: raw === null ? '{}' : raw.toString('utf8'),
    })
    const response = await dispatch(request)
    write(response.status, await response.text())
  } catch (problem) {
    const message = problem instanceof Error ? problem.message : String(problem)
    write(500, JSON.stringify({ ok: false, error: { code: 'E_INTERNAL', message } }))
  }
}

/**
 * Mount the endpoint on the host web server.
 *
 * @param {object} ctx Cordis context
 */
export function apply(ctx) {
  ctx.inject(['webServer'], (scope) => {
    const server = scope.get('webServer')
    if (server === undefined || typeof server.register !== 'function') return
    scope.effect(
      // The promise is returned so a test (and the server) can await the reply;
      // `handle` swallows its own errors, so it never rejects.
      () => server.register({ kind: 'exact', path: RPC_PATH, handler: (req, res) => handle(req, res) }),
      'dsh-mock-interview: interview api',
    )
  })
}

export { RPC_PATH, SCHEMA_VERSION }