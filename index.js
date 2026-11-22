/**
 * dsh-mock-interview — Host half.
 *
 * One JSON-over-POST endpoint at /api/dsh-mock-interview/rpc and a dispatch
 * table of actions. The interview engine (profile extraction, question
 * director, rubric scoring, code review, session store, report rendering) lives
 * in `lib/` and is added one test case at a time — see docs/test-plan.md.
 *
 * Failure policy: registering the route never fails the composition. Without a
 * web server the plugin has no browser surface and stays inert; the browser
 * half reports the missing transport itself.
 *
 * @module index.js
 */

import { ACTIONS, ERROR_CODES, LIMITS, RPC_PATH, SCHEMA_VERSION } from './lib/contracts.js'
import { decideProbe } from './lib/director.mjs'
import { isContractError } from './lib/errors.mjs'
import { buildReport, exportReport } from './lib/report.mjs'
import { buildPlan } from './lib/session.mjs'
import { scoreAnswer } from './lib/scorer.mjs'
import { createStore } from './lib/store.mjs'

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

/** The store for this call: injected in tests, derived from DSH_HOME live. */
function resolveStore(deps) {
  if (deps.store !== undefined) return deps.store
  const home = deps.home ?? process.env.DSH_HOME
  return createStore({ home })
}

/**
 * Pure request/response core, independent of the Node http objects.
 *
 * @param {Request} request
 * @param {{
 *   now?: () => number,
 *   home?: string,
 *   store?: object,
 *   complete?: (request: { system: string, messages: object[], signal?: AbortSignal }) => Promise<string>,
 * }} [deps]
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

  try {
    switch (op) {
      case 'ping':
        return ok({ pong: true, version: VERSION, schemaVersion: SCHEMA_VERSION, at: now() })

      case 'session/create': {
        const plan = await buildPlan({
          profile: body.profile,
          mode: body.mode,
          difficulty: body.difficulty,
          minutes: body.minutes,
        })
        const at = now()
        const session = {
          schemaVersion: SCHEMA_VERSION,
          id: globalThis.crypto.randomUUID(),
          createdAt: at,
          updatedAt: at,
          status: 'active',
          mode: body.mode,
          difficulty: body.difficulty,
          minutes: body.minutes,
          profile: body.profile,
          plan,
          turns: [],
        }
        await resolveStore(deps).put(session)
        return ok({ sessionId: session.id, plan })
      }

      case 'session/get': {
        const session = await resolveStore(deps).get(body.sessionId)
        return ok({ session })
      }

      case 'session/list': {
        const limit = body.limit === undefined ? 20 : body.limit
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
          return fail('E_BAD_REQUEST', 'limit 必须是 1–100 的整数')
        }
        const sessions = (await resolveStore(deps).list()).slice(0, limit)
        return ok({ sessions })
      }

      case 'session/delete': {
        return ok(await resolveStore(deps).remove(body.sessionId))
      }

      case 'session/finish': {
        const store = resolveStore(deps)
        const session = await store.get(body.sessionId)
        // §3.8: finishing twice replays the report instead of re-scoring.
        if (session.status === 'finished' && session.report !== undefined) {
          return ok({ report: session.report })
        }
        const report = buildReport(session)
        session.status = 'finished'
        session.report = report
        session.updatedAt = now()
        await store.put(session)
        return ok({ report })
      }

      case 'report/export': {
        const session = await resolveStore(deps).get(body.sessionId)
        const report = session.report ?? buildReport(session)
        const exported = await exportReport({
          report,
          dir: body.dir,
          cwd: typeof deps.cwd === 'string' && deps.cwd !== '' ? deps.cwd : process.cwd(),
        })
        return ok(exported)
      }

      case 'turn/answer': {
        const store = resolveStore(deps)
        const session = await store.get(body.sessionId)
        if (session.status === 'finished') {
          return fail('E_SESSION_FINISHED', '这场面试已经结束了，不能再作答')
        }
        const items = session.plan?.items ?? []
        const item = items.find((entry) => entry?.id === body.questionId)
        if (item === undefined) {
          return fail('E_BAD_REQUEST', `plan 里没有题目 ${String(body.questionId)}`)
        }
        const answer = String(body.answer ?? '')
        if (answer.length > LIMITS.maxAnswerChars) {
          return fail('E_BAD_REQUEST', `答案超过 ${LIMITS.maxAnswerChars} 字符`)
        }
        if (typeof deps.complete !== 'function') {
          return fail('E_LLM_UNAVAILABLE', '宿主没有可用的模型服务（llm），无法评分')
        }

        const { score, warnings } = await scoreAnswer({
          item,
          answer,
          difficulty: session.difficulty,
          complete: deps.complete,
        })

        // §3.6: re-answering the same question overwrites the earlier turn, and
        // a shallow answer earns exactly one probe (the reason travels with it).
        const previous = (session.turns ?? []).find((turn) => turn?.questionId === item.id)
        const probe = decideProbe({ answer, alreadyProbed: previous?.probe?.asked === true })
        const at = now()
        session.turns = [
          ...(session.turns ?? []).filter((turn) => turn?.questionId !== item.id),
          {
            questionId: item.id,
            answer,
            inputMode: body.inputMode === 'voice' ? 'voice' : 'text',
            score,
            warnings,
            probe,
            at,
          },
        ]
        session.updatedAt = at
        await store.put(session)

        const index = items.findIndex((entry) => entry?.id === item.id)
        const nextItem = items[index + 1]
        const next = probe.asked
          ? { type: 'probe', question: item }
          : nextItem === undefined
            ? { type: 'finish' }
            : { type: 'question', question: nextItem }

        return ok({ score, next, sessionStatus: session.status })
      }

      default:
        // Unreachable while ACTIONS and this switch agree; contract-lint proves it.
        return fail('E_UNKNOWN_ACTION', `unhandled op "${op}"`)
    }
  } catch (problem) {
    if (isContractError(problem)) return fail(problem.code, problem.message)
    throw problem
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
async function handle(req, res, deps) {
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
    const response = await dispatch(request, deps)
    write(response.status, await response.text())
  } catch (problem) {
    const message = problem instanceof Error ? problem.message : String(problem)
    write(500, JSON.stringify({ ok: false, error: { code: 'E_INTERNAL', message } }))
  }
}

/**
 * Adapt the host LLM service to the `complete` shape the engine expects.
 * Returns undefined when the service is absent, so callers fail with
 * E_LLM_UNAVAILABLE instead of crashing.
 *
 * @param {object} scope Cordis scope
 */
function llmBridge(scope) {
  const llm = typeof scope?.get === 'function' ? scope.get('llm') : undefined
  if (llm === undefined || typeof llm.stream !== 'function') return undefined
  return async ({ system, messages, signal }) => {
    const parts = []
    const stream = llm.stream({ system, messages, signal, purpose: 'dsh-mock-interview' })
    for await (const chunk of stream) {
      const text = chunk?.text ?? chunk?.delta ?? chunk?.content
      if (typeof text === 'string') parts.push(text)
    }
    return parts.join('')
  }
}

/**
 * Where sessions live. The host exposes it as `dshHomePath`; a bare process
 * env is only a fallback, because the web server does not inherit it.
 *
 * @param {object} scope Cordis scope with services
 * @returns {string|undefined}
 */
export function dshHome(scope) {
  try {
    const value = scope?.get?.('dshHomePath')
    if (typeof value === 'string' && value !== '') return value
  } catch {
    // Service not present: fall through to the environment.
  }
  const env = process.env.DSH_HOME
  return typeof env === 'string' && env !== '' ? env : undefined
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
    const complete = llmBridge(scope)
    scope.effect(
      // The promise is returned so a test (and the server) can await the reply;
      // `handle` swallows its own errors, so it never rejects.
      () =>
        server.register({
          kind: 'exact',
          path: RPC_PATH,
          handler: (req, res) => handle(req, res, { complete, home: dshHome(scope) }),
        }),
      'dsh-mock-interview: interview api',
    )
  })
}

export { RPC_PATH, SCHEMA_VERSION }