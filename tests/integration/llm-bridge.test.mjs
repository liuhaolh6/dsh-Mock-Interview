import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { apply, RPC_PATH } from '../../index.js'
import { CODE_REVIEW_OK } from '../fixtures/code.mjs'
import { PROFILE_CONFIRMED } from '../fixtures/resume.mjs'

// S6b: the host adapter has to name a provider and a model, and adapter
// failures arrive as terminal `finish` chunks instead of thrown errors.

const START = { op: 'session/create', profile: PROFILE_CONFIRMED, mode: 'tech-1', difficulty: 'mid', minutes: 15 }

async function tempHome() {
  return mkdtemp(join(tmpdir(), 'dsh-mock-interview-bridge-'))
}

/**
 * Wire the real plugin against a fake host and return a request helper.
 *
 * @param {{ selection?: object, llm: object }} host fake services
 */
function harness(host) {
  const captured = {}
  const server = {
    register(route) {
      captured.route = route
    },
  }
  const scope = {
    get(name) {
      if (name === 'webServer') return server
      if (name === 'llm') return host.llm
      if (name === 'agentDefaultModel') {
        return host.selection === undefined ? undefined : { currentSelection: () => host.selection }
      }
      return undefined
    },
    effect(run) {
      run()
    },
  }
  apply({
    inject(_services, run) {
      run(scope)
    },
  })
  assert.equal(captured.route.path, RPC_PATH)

  const ask = async (body) => {
    const req = {
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(JSON.stringify(body), 'utf8')
      },
    }
    let status = 0
    let text = ''
    const res = {
      writeHead(code) {
        status = code
      },
      end(payload) {
        text = payload
      },
    }
    await captured.route.handler(req, res)
    assert.equal(status, 200)
    return JSON.parse(text)
  }
  return ask
}

test('TC-WIR-009 an adapter error finish becomes E_LLM_UNAVAILABLE', async () => {
  const home = await tempHome()
  const saved = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    const ask = harness({
      selection: { provider: 'deepseek', model: 'deepseek-chat' },
      llm: {
        stream: async function* () {
          yield { type: 'finish', reason: { kind: 'error', failure: { message: 'provider said 500', code: 'SERVER_ERROR' } } }
        },
      },
    })
    const created = await ask(START)
    const answered = await ask({
      op: 'turn/answer',
      sessionId: created.value.sessionId,
      questionId: created.value.plan.items[0].id,
      answer: '索引用的是 B+ 树，最左前缀匹配。',
    })
    assert.equal(answered.ok, false)
    assert.equal(answered.error.code, 'E_LLM_UNAVAILABLE')
    assert.match(answered.error.message, /provider said 500/)
  } finally {
    if (saved === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = saved
    await rm(home, { recursive: true, force: true })
  }
})

test('TC-WIR-010 an aborted finish becomes E_LLM_TIMEOUT', async () => {
  const home = await tempHome()
  const saved = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    const ask = harness({
      selection: { provider: 'deepseek', model: 'deepseek-chat' },
      llm: {
        stream: async function* () {
          yield { type: 'finish', reason: { kind: 'aborted', failure: { message: 'deadline', code: 'TIMEOUT' } } }
        },
      },
    })
    const created = await ask(START)
    const answered = await ask({
      op: 'turn/answer',
      sessionId: created.value.sessionId,
      questionId: created.value.plan.items[0].id,
      answer: '索引用的是 B+ 树。',
    })
    assert.equal(answered.ok, false)
    assert.equal(answered.error.code, 'E_LLM_TIMEOUT')
  } finally {
    if (saved === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = saved
    await rm(home, { recursive: true, force: true })
  }
})

test('TC-WIR-011 the default selection names the provider and model, and text deltas join', async () => {
  const home = await tempHome()
  const saved = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    const seen = []
    const ask = harness({
      selection: { provider: 'deepseek', model: 'deepseek-reasoner', reasoningEffort: 'medium' },
      llm: {
        stream: async function* (options) {
          seen.push(options)
          yield { type: 'text-delta', index: 0, text: CODE_REVIEW_OK.slice(0, 12) }
          yield { type: 'text-delta', index: 0, text: CODE_REVIEW_OK.slice(12) }
          yield { type: 'finish', reason: { kind: 'stop' } }
        },
      },
    })
    const created = await ask(START)
    const answered = await ask({
      op: 'turn/answer',
      sessionId: created.value.sessionId,
      questionId: created.value.plan.items[0].id,
      answer: '索引用的是 B+ 树，回表代价高。',
    })
    assert.equal(answered.ok, true, JSON.stringify(answered))
    assert.equal(answered.value.score.overall > 0, true)
    assert.equal(seen.length, 1)
    assert.equal(seen[0].provider, 'deepseek')
    assert.equal(seen[0].model, 'deepseek-reasoner')
    assert.equal(seen[0].purpose, 'dsh-mock-interview')
  } finally {
    if (saved === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = saved
    await rm(home, { recursive: true, force: true })
  }
})

test('TC-WIR-012 without a default route the turn fails as E_LLM_UNAVAILABLE', async () => {
  const home = await tempHome()
  const saved = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    const ask = harness({ llm: { stream: async function* () {} } })
    const created = await ask(START)
    const answered = await ask({
      op: 'turn/answer',
      sessionId: created.value.sessionId,
      questionId: created.value.plan.items[0].id,
      answer: '索引用的是 B+ 树。',
    })
    assert.equal(answered.ok, false)
    assert.equal(answered.error.code, 'E_LLM_UNAVAILABLE')
    assert.match(answered.error.message, /默认模型/)
  } finally {
    if (saved === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = saved
    await rm(home, { recursive: true, force: true })
  }
})
test('TC-WIR-013 string contents become text blocks and assistant turns become user context', async () => {
  const home = await tempHome()
  const saved = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    const seen = []
    const ask = harness({
      selection: { provider: 'deepseek', model: 'deepseek-chat' },
      llm: {
        stream: async function* (options) {
          seen.push(structuredClone(options.messages))
          // First reply is unparseable so the engine retries with the
          // assistant-role correction message in the second call.
          yield { type: 'text-delta', index: 0, text: '抱歉，我先说结论。' }
          yield { type: 'finish', reason: { kind: 'stop' } }
        },
      },
    })
    const created = await ask(START)
    const answered = await ask({
      op: 'turn/answer',
      sessionId: created.value.sessionId,
      questionId: created.value.plan.items[0].id,
      answer: '索引用的是 B+ 树。',
    })
    assert.equal(answered.ok, false)
    assert.equal(answered.error.code, 'E_SCORE_INVALID')
    assert.ok(seen.length >= 2)
    for (const messages of seen) {
      for (const message of messages) {
        assert.equal(Array.isArray(message.content), true, JSON.stringify(message))
        for (const block of message.content) {
          assert.equal(block.type, 'text')
          assert.equal(typeof block.text, 'string')
        }
        assert.notEqual(message.role, 'assistant', 'the adapter requires provider metadata for assistant turns')
      }
    }
  } finally {
    if (saved === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = saved
    await rm(home, { recursive: true, force: true })
  }
})

test('TC-WIR-014 reasoning deltas never enter the answer and a token budget is requested', async () => {
  const home = await tempHome()
  const saved = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    const seen = []
    const ask = harness({
      selection: { provider: 'deepseek', model: 'deepseek-chat' },
      llm: {
        stream: async function* (options) {
          seen.push(options)
          yield { type: 'reasoning-delta', index: 0, text: '{"dims":{"correctness":5}} 这段思考不该被当成答案。' }
          yield { type: 'text-delta', index: 1, text: CODE_REVIEW_OK.slice(0, 20) }
          yield { type: 'text-delta', index: 1, text: CODE_REVIEW_OK.slice(20) }
          yield { type: 'finish', reason: { kind: 'stop' } }
        },
      },
    })
    const created = await ask(START)
    const answered = await ask({
      op: 'turn/answer',
      sessionId: created.value.sessionId,
      questionId: created.value.plan.items[0].id,
      answer: '索引用的是 B+ 树。',
    })
    assert.equal(answered.ok, true, JSON.stringify(answered))
    assert.equal(typeof seen[0].maxTokens, 'number')
    assert.equal(seen[0].maxTokens >= 2048, true)
  } finally {
    if (saved === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = saved
    await rm(home, { recursive: true, force: true })
  }
})

test('TC-WIR-015 a max-tokens finish is reported as truncation, not as bad JSON', async () => {
  const home = await tempHome()
  const saved = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    const ask = harness({
      selection: { provider: 'deepseek', model: 'deepseek-chat' },
      llm: {
        stream: async function* () {
          yield { type: 'reasoning-delta', index: 0, text: '思考很久' }
          yield { type: 'finish', reason: { kind: 'max-tokens' } }
        },
      },
    })
    const created = await ask(START)
    const answered = await ask({
      op: 'turn/answer',
      sessionId: created.value.sessionId,
      questionId: created.value.plan.items[0].id,
      answer: '索引用的是 B+ 树。',
    })
    assert.equal(answered.ok, false)
    assert.equal(answered.error.code, 'E_LLM_UNAVAILABLE')
    assert.match(answered.error.message, /截断|max-tokens/)
  } finally {
    if (saved === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = saved
    await rm(home, { recursive: true, force: true })
  }
})

test('TC-WIR-016 the system instruction also travels inside the messages', async () => {
  const home = await tempHome()
  const saved = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    const seen = []
    const ask = harness({
      selection: { provider: 'deepseek', model: 'deepseek-chat' },
      llm: {
        stream: async function* (options) {
          seen.push(structuredClone(options))
          yield { type: 'text-delta', index: 0, text: CODE_REVIEW_OK }
          yield { type: 'finish', reason: { kind: 'stop' } }
        },
      },
    })
    const created = await ask(START)
    const answered = await ask({
      op: 'turn/answer',
      sessionId: created.value.sessionId,
      questionId: created.value.plan.items[0].id,
      answer: '索引用的是 B+ 树。',
    })
    assert.equal(answered.ok, true, JSON.stringify(answered))
    const first = seen[0].messages[0]
    const text = first.content.map((block) => block.text).join('\n')
    assert.match(text, /只输出 JSON|评分官/)
  } finally {
    if (saved === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = saved
    await rm(home, { recursive: true, force: true })
  }
})
