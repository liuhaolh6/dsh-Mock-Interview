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

import { basename, dirname, join } from 'node:path'
import { homedir } from 'node:os'

import { ACTIONS, ERROR_CODES, LIMITS, RPC_PATH, SCHEMA_VERSION } from './lib/contracts.js'
import { reviewCode } from './lib/code-review.mjs'
import { decideProbe } from './lib/director.mjs'
import { ContractError, isContractError } from './lib/errors.mjs'
import { extractProfile } from './lib/profile.mjs'
import { buildReport, exportReport } from './lib/report.mjs'
import { defaultTitle, listSessions, pickPatch, sessionMeta } from './lib/history.mjs'
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
 * `session/update` answers with the record's own view (§3.11): the list summary
 * plus the note and both timestamps, so the client can refresh in place.
 */
function sessionDetailMeta(session) {
  const turns = Array.isArray(session.turns) ? session.turns : []
  const scored = turns.map((turn) => turn?.score?.overall).filter((value) => typeof value === 'number')
  return {
    ...sessionMeta({ ...session, turns: turns.length, overall: scored.length === 0 ? null : mean1(scored) }),
    note: session.note ?? '',
    createdAt: session.createdAt ?? 0,
    updatedAt: session.updatedAt ?? 0,
  }
}

function mean1(values) {
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10
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

      case 'profile/extract': {
        const { profile, warnings } = await extractProfile(
          { resumeText: body.resumeText, jdText: body.jdText, jd: body.jd },
          { complete: deps.complete },
        )
        return ok({ profile, warnings })
      }

      case 'code/review': {
        const store = resolveStore(deps)
        const session = await store.get(body.sessionId)
        if (session.status === 'finished') {
          return fail('E_SESSION_FINISHED', '这场面试已经结束了，不能再提交代码')
        }
        const items = session.plan?.items ?? []
        const item = items.find((entry) => entry.id === body.questionId)
        if (item === undefined) {
          return fail('E_BAD_REQUEST', `题目 ${String(body.questionId)} 不在本场面试的题单里`)
        }
        if (item.kind !== 'code') {
          return fail('E_BAD_REQUEST', '这道题不是手撕题，请用 turn/answer 作答')
        }
        const reviewed = await reviewCode({
          item,
          code: body.code,
          language: body.language,
          complete: deps.complete,
        })
        // Keep the report honest: the code turn carries the same card shape as
        // a spoken answer, plus the code itself and the simulated cases.
        session.turns = (session.turns ?? []).filter((turn) => turn.questionId !== item.id)
        session.turns.push({
          questionId: item.id,
          answer: typeof body.code === 'string' ? body.code : '',
          code: typeof body.code === 'string' ? body.code : '',
          cases: reviewed.cases,
          inputMode: 'code',
          score: reviewed.score,
          warnings: reviewed.warnings,
          at: now(),
        })
        session.updatedAt = now()
        await store.put(session)
        return ok({
          score: reviewed.score,
          verdict: reviewed.verdict,
          cases: reviewed.cases,
          executed: reviewed.executed,
          warnings: reviewed.warnings,
        })
      }

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
          title: defaultTitle({ profile: body.profile, createdAt: at }),
          tags: [],
          note: '',
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
        const store = resolveStore(deps)
        const rows = await store.list()
        return ok(
          listSessions(rows, {
            limit: body.limit,
            offset: body.offset,
            query: body.query,
            status: body.status,
            mode: body.mode,
            difficulty: body.difficulty,
            tag: body.tag,
            sort: body.sort,
          }),
        )
      }

      case 'session/update': {
        const patch = pickPatch(body)
        const session = await resolveStore(deps).update(body.sessionId, patch)
        return ok({ session: sessionDetailMeta(session) })
      }

      case 'session/delete': {
        const store = resolveStore(deps)
        const hasIds = body.ids !== undefined
        const hasOne = body.sessionId !== undefined

        if (hasIds && hasOne) {
          return fail('E_BAD_REQUEST', 'sessionId 与 ids 只能给一个')
        }
        if (!hasIds && !hasOne) {
          return fail('E_BAD_REQUEST', '必须给出 sessionId 或 ids')
        }
        if (hasIds) {
          if (!Array.isArray(body.ids) || body.ids.some((id) => typeof id !== 'string' || id === '')) {
            return fail('E_BAD_REQUEST', 'ids 必须是非空字符串数组')
          }
          if (body.ids.length > LIMITS.maxBatchDelete) {
            return fail('E_BAD_REQUEST', `一次最多删除 ${LIMITS.maxBatchDelete} 条`)
          }
          return ok(await store.removeMany([...new Set(body.ids)]))
        }
        return ok(await store.remove(body.sessionId))
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
          cwd: exportBase(deps),
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
        // S6 / AC-5: the host never records or uploads audio. A voice turn is
        // only a transcript the browser already produced, so the missing piece
        // is always the user-provided ASR endpoint — say so instead of guessing.
        const inputMode = body.inputMode === 'voice' ? 'voice' : 'text'
        if (inputMode === 'voice') {
          if (typeof body.answer !== 'string') {
            return fail(
              'E_ASR_NOT_CONFIGURED',
              '当前没有可用的语音转写（ASR）：请改用文字作答，或在设置里配置自备的 OpenAI 兼容转写端点后重录',
            )
          }
          if (body.answer.trim() === '') {
            return fail('E_BAD_REQUEST', '转写结果为空：请重新录音，或改用文字作答')
          }
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
            inputMode,
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
function textBlocks(content) {
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  if (Array.isArray(content)) {
    return content.filter((block) => block !== null && typeof block === 'object' && block.type === 'text')
  }
  return []
}

/**
 * Turn plain `{ role, content: string }` pairs into the `RequestMessage[]` the
 * adapter accepts: every `content` is a text-block array, and an assistant turn
 * cannot be replayed because the host requires model provenance on it — the
 * previous reply therefore travels as user context instead.
 *
 * @param {unknown} messages engine-supplied messages
 * @returns {Array<{ role: 'user', content: Array<{ type: 'text', text: string }> }>}
 */
function toRequestMessages(messages, system) {
  const out = []
  if (typeof system === 'string' && system.trim() !== '') {
    // The `system` option is honoured by the adapter, but repeating the rules as
    // the first user turn keeps scoring correct on a route that ignores it.
    out.push({ role: 'user', content: [{ type: 'text', text: '【系统指令】\n' + system.trim() }] })
  }
  for (const message of Array.isArray(messages) ? messages : []) {
    if (message === null || typeof message !== 'object') continue
    const blocks = textBlocks(message.content)
    if (message.role === 'assistant') {
      const previous = blocks.map((block) => block.text).join('\n')
      out.push({ role: 'user', content: [{ type: 'text', text: '（你上一条回复）\n' + previous }] })
      continue
    }
    out.push({ role: 'user', content: blocks })
  }
  return out
}

/**
 * Which provider and model to call. `GenerateOptions` requires both, and the
 * adapter is selected by `provider`, so a call without a route never reaches a
 * model. The default selection is the user's own choice; the provider list is
 * only a fallback for a host that has none yet.
 *
 * @param {object} scope Cordis scope with services
 * @param {object} llm the `llm` service
 * @returns {Promise<{ provider: string, model: string } | undefined>}
 */
async function defaultRoute(scope, llm) {
  try {
    const service = typeof scope?.get === 'function' ? scope.get('agentDefaultModel') : undefined
    const selection = typeof service?.currentSelection === 'function' ? service.currentSelection() : undefined
    const provider = selection?.provider ?? selection?.providerId
    const model = selection?.model ?? selection?.modelId
    if (typeof provider === 'string' && provider !== '' && typeof model === 'string' && model !== '') {
      return { provider, model }
    }
  } catch {
    // A host without a readable default still deserves the provider list.
  }
  try {
    if (typeof llm?.listProviders !== 'function' || typeof llm?.listModels !== 'function') return undefined
    const providers = llm.listProviders()
    const first = Array.isArray(providers) ? providers[0] : undefined
    const provider = first?.id ?? first?.provider
    if (typeof provider !== 'string' || provider === '') return undefined
    const models = await llm.listModels(provider)
    const model = Array.isArray(models) ? models[0]?.id : undefined
    if (typeof model !== 'string' || model === '') return undefined
    return { provider, model }
  } catch {
    return undefined
  }
}

/**
 * Adapt `ctx.llm.stream` into the plain `complete({ system, messages })` the
 * engine modules take. Adapter failures are terminal `finish` chunks rather
 * than thrown errors, so they are translated here; an empty reply is a failure
 * too, because the scorers would otherwise report it as unparseable JSON.
 *
 * @param {object} scope Cordis scope with services
 * @returns {((request: object) => Promise<string>) | undefined}
 */
function llmBridge(scope) {
  const llm = typeof scope?.get === 'function' ? scope.get('llm') : undefined
  if (llm === undefined || typeof llm.stream !== 'function') return undefined
  return async ({ system, messages, signal }) => {
    const route = await defaultRoute(scope, llm)
    if (route === undefined) {
      throw new ContractError('E_LLM_UNAVAILABLE', '宿主没有可用的默认模型，无法评分')
    }
    const parts = []
    let failure
    const stream = llm.stream({
      ...route,
      maxTokens: LIMITS.llmMaxTokens,
      system,
      messages: toRequestMessages(messages, system),
      signal,
      purpose: 'dsh-mock-interview',
    })
    for await (const chunk of stream) {
      if (chunk?.type === 'finish') {
        const kind = chunk.reason?.kind
        if (kind === 'aborted') {
          failure = new ContractError('E_LLM_TIMEOUT', '模型调用超时或被取消')
        } else if (kind === 'error') {
          failure = new ContractError('E_LLM_UNAVAILABLE', chunk.reason?.failure?.message || '模型调用失败')
        } else if (kind === 'max-tokens') {
          // A reasoning model can spend the whole budget thinking; the answer is
          // then truncated, which is not the same thing as bad JSON.
          failure = new ContractError('E_LLM_UNAVAILABLE', '模型输出被截断（max-tokens），请重试或换更小的题')
        }
        continue
      }
      // Reasoning deltas are the model's thinking, never the answer.
      if (chunk?.type !== undefined && chunk.type !== 'text-delta') continue
      const text = chunk?.text ?? chunk?.delta ?? chunk?.content
      if (typeof text === 'string') parts.push(text)
    }
    if (failure !== undefined) throw failure
    const answer = parts.join('')
    if (answer.trim() === '') {
      throw new ContractError('E_LLM_UNAVAILABLE', '模型没有返回任何文本')
    }
    return answer
  }
}

/**
 * Where sessions live. The host exposes it as the `dshHomePath` *service
 * function* (not a string), so it has to be called; the environment and the
 * profile directory are only fallbacks, because the web server does not
 * inherit the shell environment.
 *
 * @param {object} scope Cordis scope with services
 * @returns {string}
 */
export function dshHome(scope) {
  try {
    const service = scope?.get?.('dshHomePath')
    if (typeof service === 'function') {
      const resolved = service()
      if (typeof resolved === 'string' && resolved.trim() !== '') return resolved.trim()
    } else if (typeof service === 'string' && service.trim() !== '') {
      return service.trim()
    }
  } catch {
    // Service missing or throwing: fall through to the environment.
  }
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv.trim()
  const profileDir = process.env.DSH_PROFILE_DIR
  if (typeof profileDir === 'string' && profileDir.trim() !== '') {
    const trimmed = profileDir.trim()
    const parent = dirname(dirname(trimmed))
    if (parent !== '' && basename(dirname(trimmed)) === 'profiles') return parent
    return trimmed
  }
  return join(homedir(), '.dsh')
}

/**
 * Mount the endpoint on the host web server.
 *
 * @param {object} ctx Cordis context
 */
// Reports belong somewhere the user can find them. The browser half may pass
// `dir`; otherwise the host prefers the deployment's default working directory
// (a Session-shaped `process.cwd()` is the last resort, and only inside it).
function exportBase(deps) {
  const candidates = [deps.cwd, deps.defaultDir]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim() !== '') return candidate
  }
  return process.cwd()
}

function defaultDir(scope) {
  const service = scope.get('workingDirectory')
  const value = service?.defaultDirectory
  return typeof value === 'string' ? value : undefined
}

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
          handler: (req, res) =>
            handle(req, res, { complete, home: dshHome(scope), defaultDir: defaultDir(scope) }),
        }),
      'dsh-mock-interview: interview api',
    )
  })
}

export { RPC_PATH, SCHEMA_VERSION }