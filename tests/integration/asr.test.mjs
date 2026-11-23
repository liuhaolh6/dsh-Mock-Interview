import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { dispatch, RPC_PATH } from '../../index.js'
import { LIMITS } from '../../lib/contracts.js'

// D1 integration: the two new actions talk to a *user-provided* endpoint, so the
// tests inject `fetch` and never touch the network. What matters here is the
// contract: what is refused before the send, what a failed endpoint looks like,
// and that a clip is never written to disk.

const URL_BASE = 'http://localhost' + RPC_PATH
const CONFIG = {
  baseUrl: 'https://asr.example.com/v1',
  apiKey: 'sk-test-abcdefghijkl',
  model: 'whisper-1',
}

async function call(body, deps) {
  const response = await dispatch(
    new Request(URL_BASE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    deps,
  )
  assert.equal(response.status, 200)
  return response.json()
}

async function home() {
  const cwd = await mkdtemp(join(tmpdir(), 'dsh-mock-interview-asr-'))
  return { cwd, deps: { home: join(cwd, 'home'), cwd } }
}

const CLIP = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x02, 0x03]).toString('base64')

function scriptedFetch(reply) {
  const calls = []
  const fn = async (url, init) => {
    calls.push({ url, init })
    if (reply instanceof Error) throw reply
    return reply
  }
  fn.calls = calls
  return fn
}

test('TC-ASR-010 without a configured endpoint nothing is sent', async () => {
  const { cwd, deps } = await home()
  const fetchImpl = scriptedFetch({ ok: true, status: 200, json: async () => ({ text: '你好' }) })

  const payload = await call(
    { op: 'asr/transcribe', audioBase64: CLIP, mime: 'audio/webm', durationMs: 3_000 },
    { ...deps, fetch: fetchImpl },
  )

  assert.equal(payload.ok, false)
  assert.equal(payload.error.code, 'E_ASR_NOT_CONFIGURED')
  assert.match(payload.error.hint.title, /语音/)
  assert.match(payload.error.message, /文字/)
  assert.equal(fetchImpl.calls.length, 0, 'a missing config must not call the network')
  await rm(cwd, { recursive: true, force: true })
})

test('TC-ASR-011 a configured endpoint is called once and its text returned', async () => {
  const { cwd, deps } = await home()
  await call({ op: 'asr/config', config: CONFIG }, deps)
  const fetchImpl = scriptedFetch({
    ok: true,
    status: 200,
    json: async () => ({ text: ' 我用的是延迟双删\n加 binlog 兜底。 ' }),
  })

  const payload = await call(
    { op: 'asr/transcribe', audioBase64: CLIP, mime: 'audio/webm', durationMs: 4_000, language: 'zh' },
    { ...deps, fetch: fetchImpl },
  )

  assert.equal(payload.ok, true, JSON.stringify(payload))
  assert.equal(payload.value.text, '我用的是延迟双删 加 binlog 兜底。')
  assert.equal(payload.value.model, CONFIG.model)
  assert.equal(payload.value.provider, 'asr')

  assert.equal(fetchImpl.calls.length, 1)
  const [call0] = fetchImpl.calls
  assert.equal(call0.url, 'https://asr.example.com/v1/audio/transcriptions')
  assert.equal(call0.init.method, 'POST')
  assert.equal(call0.init.headers.authorization, `Bearer ${CONFIG.apiKey}`)
  assert.ok(Buffer.isBuffer(call0.init.body))
  const body = call0.init.body.toString('utf8')
  assert.match(body, /name="model"\r\n\r\nwhisper-1/)
  assert.match(body, /name="language"\r\n\r\nzh/)
  await rm(cwd, { recursive: true, force: true })
})

test('TC-ASR-012 endpoint failures are E_ASR_FAILED and stay retriable', async () => {
  const { cwd, deps } = await home()
  await call({ op: 'asr/config', config: CONFIG }, deps)

  const cases = [
    { reply: { ok: false, status: 502, json: async () => ({}) }, expect: /502/ },
    { reply: { ok: true, status: 200, json: async () => ({ text: '   ' }) }, expect: /空文本/ },
    { reply: { ok: true, status: 200, json: async () => JSON.parse('null') }, expect: /空文本/ },
    { reply: new Error('connect ECONNREFUSED'), expect: /ECONNREFUSED/ },
    {
      reply: {
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token < in JSON')
        },
      },
      expect: /不是 JSON/,
    },
  ]

  for (const { reply, expect } of cases) {
    const payload = await call(
      { op: 'asr/transcribe', audioBase64: CLIP, mime: 'audio/webm' },
      { ...deps, fetch: scriptedFetch(reply) },
    )
    assert.equal(payload.ok, false, JSON.stringify({ reply, payload }))
    assert.equal(payload.error.code, 'E_ASR_FAILED')
    assert.match(payload.error.message, expect)
    assert.equal(payload.error.hint.retryable, true, 'the panel should offer a retry')
  }
  await rm(cwd, { recursive: true, force: true })
})

test('TC-ASR-013 bad audio is refused before the network, and the clip is never stored', async () => {
  const { cwd, deps } = await home()
  await call({ op: 'asr/config', config: CONFIG }, deps)
  const fetchImpl = scriptedFetch({ ok: true, status: 200, json: async () => ({ text: 'x' }) })

  const tooBig = Buffer.alloc(LIMITS.maxAudioBytes + 1024).toString('base64')
  const rejects = [
    { body: { mime: 'audio/webm' }, message: /audioBase64/ },
    { body: { audioBase64: '', mime: 'audio/webm' }, message: /audioBase64/ },
    { body: { audioBase64: 'not base64 !!', mime: 'audio/webm' }, message: /base64/ },
    { body: { audioBase64: CLIP, mime: 'video/mp4' }, message: /音频格式/ },
    { body: { audioBase64: CLIP, mime: 'audio/webm', durationMs: LIMITS.maxAudioMs + 10_000 }, message: /时长/ },
    { body: { audioBase64: tooBig, mime: 'audio/webm' }, message: /8 MB/ },
  ]

  for (const { body, message } of rejects) {
    const payload = await call({ op: 'asr/transcribe', ...body }, { ...deps, fetch: fetchImpl })
    assert.equal(payload.ok, false, JSON.stringify({ body: Object.keys(body), payload }))
    assert.equal(payload.error.code, 'E_BAD_REQUEST')
    assert.match(payload.error.message, message)
  }
  assert.equal(fetchImpl.calls.length, 0, 'nothing may reach the endpoint')

  // The only file the feature is allowed to create is the endpoint config.
  const storage = await readdir(join(deps.home, 'storages', 'dsh-mock-interview'))
  assert.deepEqual(storage, ['asr.json'])
  await rm(cwd, { recursive: true, force: true })
})

test('TC-ASR-014 asr/config echoes a masked key and can be cleared', async () => {
  const { cwd, deps } = await home()

  const empty = await call({ op: 'asr/config' }, deps)
  assert.equal(empty.ok, true)
  assert.deepEqual(empty.value.config, { baseUrl: '', model: '', hasKey: false })
  assert.equal(empty.value.keyMask, '')

  const saved = await call({ op: 'asr/config', config: CONFIG }, deps)
  assert.equal(saved.ok, true, JSON.stringify(saved))
  assert.deepEqual(saved.value.config, {
    baseUrl: CONFIG.baseUrl,
    model: CONFIG.model,
    hasKey: true,
  })
  assert.equal(saved.value.keyMask, 'sk-t…ijkl')
  assert.equal(JSON.stringify(saved.value).includes(CONFIG.apiKey), false)

  const read = await call({ op: 'asr/config' }, deps)
  assert.deepEqual(read.value.config, saved.value.config)
  assert.equal(read.value.path, join(deps.home, 'storages', 'dsh-mock-interview', 'asr.json'))

  const cleared = await call({ op: 'asr/config', clear: true }, deps)
  assert.deepEqual(cleared.value.config, { baseUrl: '', model: '', hasKey: false })
  const after = await call(
    { op: 'asr/transcribe', audioBase64: CLIP, mime: 'audio/webm' },
    { ...deps, fetch: scriptedFetch({ ok: true, json: async () => ({ text: 'x' }) }) },
  )
  assert.equal(after.error.code, 'E_ASR_NOT_CONFIGURED')

  // A malformed endpoint is a bad request, not a silent fallback to "unset".
  const bad = await call({ op: 'asr/config', config: { ...CONFIG, baseUrl: 'ftp://asr' } }, deps)
  assert.equal(bad.error.code, 'E_BAD_REQUEST')
  await rm(cwd, { recursive: true, force: true })
})

test('TC-ASR-015 a partial update keeps the stored key', async () => {
  const { cwd, deps } = await home()
  await call({ op: 'asr/config', config: CONFIG }, deps)

  // Changing the model must not require retyping a key the panel cannot see.
  const changed = await call(
    { op: 'asr/config', config: { baseUrl: 'https://asr2.example.com/v1', model: 'whisper-large-v3' } },
    deps,
  )
  assert.equal(changed.ok, true, JSON.stringify(changed))
  assert.equal(changed.value.config.baseUrl, 'https://asr2.example.com/v1')
  assert.equal(changed.value.config.model, 'whisper-large-v3')
  assert.equal(changed.value.config.hasKey, true)

  // And the merged config is what actually gets used.
  const fetchImpl = scriptedFetch({ ok: true, status: 200, json: async () => ({ text: '好' }) })
  const payload = await call(
    { op: 'asr/transcribe', audioBase64: CLIP, mime: 'audio/webm' },
    { ...deps, fetch: fetchImpl },
  )
  assert.equal(payload.ok, true, JSON.stringify(payload))
  assert.equal(fetchImpl.calls[0].url, 'https://asr2.example.com/v1/audio/transcriptions')
  assert.equal(fetchImpl.calls[0].init.headers.authorization, `Bearer ${CONFIG.apiKey}`)
  await rm(cwd, { recursive: true, force: true })
})
