import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  ASR_MIME_TYPES,
  buildAsrRequest,
  configPath,
  maskKey,
  normaliseTranscript,
  publicAsrConfig,
  readAsrConfig,
  resolveAsrConfig,
  writeAsrConfig,
} from '../../lib/asr.mjs'
import { LIMITS } from '../../lib/contracts.js'

// D1: the voice path now has its own host-side adapter. Everything here is pure
// — building the multipart request, normalising the transcript, resolving the
// endpoint config — so it can be pinned without a network or a browser.

const CONFIG = {
  baseUrl: 'https://asr.example.com/v1',
  apiKey: 'sk-test-1234567890',
  model: 'whisper-1',
}

function decode(body) {
  return Buffer.from(body).toString('utf8')
}

test('TC-ASR-001 builds an OpenAI-compatible multipart transcription request', () => {
  const audio = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x00, 0xff])
  const request = buildAsrRequest({ ...CONFIG, audio, mime: 'audio/webm' })

  assert.equal(request.method, 'POST')
  assert.equal(request.url, 'https://asr.example.com/v1/audio/transcriptions')
  assert.equal(request.headers.authorization, 'Bearer sk-test-1234567890')
  assert.match(request.headers['content-type'], /^multipart\/form-data; boundary=.+/)
  assert.ok(Buffer.isBuffer(request.body), 'body must be a Buffer, not a string')

  const boundary = request.headers['content-type'].split('boundary=')[1]
  const text = decode(request.body)
  assert.ok(text.includes(`--${boundary}\r\n`), 'parts must start with the boundary')
  assert.match(text, /name="model"\r\n\r\nwhisper-1/)
  assert.match(text, /name="response_format"\r\n\r\njson/)
  assert.match(text, /name="file"; filename="answer\.webm"\r\ncontent-type: audio\/webm/i)
  assert.ok(text.endsWith(`--${boundary}--\r\n`), 'the closing boundary must terminate the body')

  // The audio bytes travel verbatim inside the file part; a base64 round trip
  // here would silently corrupt anything that is not ASCII.
  const fileAt = request.body.indexOf(audio)
  assert.ok(fileAt > 0, 'raw audio bytes must appear unchanged in the body')
})

test('TC-ASR-002 a trailing slash on the base URL does not double the path', () => {
  const audio = Buffer.from('x')
  const dashed = buildAsrRequest({ ...CONFIG, baseUrl: 'https://asr.example.com/v1/', audio })
  const bare = buildAsrRequest({ ...CONFIG, baseUrl: 'https://asr.example.com/v1', audio })
  assert.equal(dashed.url, 'https://asr.example.com/v1/audio/transcriptions')
  assert.equal(bare.url, dashed.url)

  // An endpoint that already spells out the path is left alone.
  const full = buildAsrRequest({
    ...CONFIG,
    baseUrl: 'https://asr.example.com/v1/audio/transcriptions',
    audio,
  })
  assert.equal(full.url, 'https://asr.example.com/v1/audio/transcriptions')
})

test('TC-ASR-003 an incomplete endpoint config says ASR is not configured, and names what is missing', () => {
  for (const missing of ['baseUrl', 'apiKey', 'model']) {
    const config = { ...CONFIG }
    delete config[missing]
    assert.throws(
      () => resolveAsrConfig(config),
      (problem) => {
        assert.equal(problem.code, 'E_ASR_NOT_CONFIGURED')
        assert.match(problem.message, new RegExp(missing))
        return true
      },
      `missing ${missing} must be rejected`,
    )
  }

  // No config at all is the ordinary "user never set it up" case.
  assert.throws(() => resolveAsrConfig(undefined), { code: 'E_ASR_NOT_CONFIGURED' })
  assert.throws(() => resolveAsrConfig({}), /baseUrl/)

  // A non-http endpoint is a malformed value, not a missing one.
  assert.throws(() => resolveAsrConfig({ ...CONFIG, baseUrl: 'ftp://asr' }), {
    code: 'E_BAD_REQUEST',
  })
  assert.deepEqual(resolveAsrConfig(CONFIG), CONFIG)
})

test('TC-ASR-004 the transcript is whitespace-collapsed, and an empty one fails loudly', () => {
  assert.equal(normaliseTranscript({ text: '  你好 \n 世界  ' }), '你好 世界')
  assert.equal(normaliseTranscript({ text: '嗯……我说的是\n\n延迟双删。' }), '嗯……我说的是 延迟双删。')

  for (const payload of [{ text: '' }, { text: '   ' }, {}, null, undefined, { text: 42 }]) {
    assert.throws(
      () => normaliseTranscript(payload),
      (problem) => {
        assert.equal(problem.code, 'E_ASR_FAILED')
        assert.match(problem.message, /文字/)
        return true
      },
      `payload ${JSON.stringify(payload)} must be rejected`,
    )
  }
})

test('TC-ASR-005 bad audio is rejected before anything is sent', () => {
  const audio = Buffer.from('x')

  assert.throws(() => buildAsrRequest({ ...CONFIG, audio, mime: 'video/mp4' }), {
    code: 'E_BAD_REQUEST',
  })
  assert.throws(() => buildAsrRequest({ ...CONFIG, audio, mime: 'audio/midi' }), /audio\/webm/)

  assert.throws(() => buildAsrRequest({ ...CONFIG, audio: Buffer.alloc(0) }), { code: 'E_BAD_REQUEST' })
  assert.throws(() => buildAsrRequest({ ...CONFIG, audio: undefined }), { code: 'E_BAD_REQUEST' })

  const tooBig = Buffer.alloc(LIMITS.maxAudioBytes + 1)
  assert.throws(
    () => buildAsrRequest({ ...CONFIG, audio: tooBig }),
    (problem) => {
      assert.equal(problem.code, 'E_BAD_REQUEST')
      assert.match(problem.message, /8 MB/)
      return true
    },
  )

  assert.throws(
    () => buildAsrRequest({ ...CONFIG, audio, durationMs: LIMITS.maxAudioMs + 1 }),
    (problem) => {
      assert.equal(problem.code, 'E_BAD_REQUEST')
      assert.match(problem.message, /时长|分钟/)
      return true
    },
  )

  // Every allowed container is accepted, so the panel is not limited to Chrome.
  for (const mime of ASR_MIME_TYPES) {
    const request = buildAsrRequest({ ...CONFIG, audio, mime })
    assert.equal(request.headers['content-type'].includes('boundary='), true, mime)
  }
})

test('TC-ASR-006 the stored key never travels back to the browser', () => {
  assert.equal(maskKey('sk-test-1234567890'), 'sk-t…7890')
  assert.equal(maskKey('short'), '••••')
  assert.equal(maskKey(''), '')
  assert.equal(maskKey(undefined), '')

  const view = publicAsrConfig(CONFIG)
  assert.deepEqual(view, { baseUrl: CONFIG.baseUrl, model: CONFIG.model, hasKey: true })
  assert.equal(JSON.stringify(view).includes(CONFIG.apiKey), false)
  assert.deepEqual(publicAsrConfig(null), { baseUrl: '', model: '', hasKey: false })
})

test('TC-ASR-007 the endpoint config round-trips through a 0600 file', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-mock-interview-asr-'))
  try {
    assert.equal(await readAsrConfig({ home }), null)
    assert.equal(configPath(home), join(home, 'storages', 'dsh-mock-interview', 'asr.json'))

    // Windows has no POSIX mode bits, so the intent is pinned on the write call
    // itself instead of on `stat` (which always reports 0o666 there).
    const writes = []
    const spyFs = {
      writeFile: (path, data, options) => {
        writes.push(options)
        return writeFile(path, data, options)
      },
    }

    const saved = await writeAsrConfig({ home, config: CONFIG, fs: spyFs })
    assert.deepEqual(saved, { baseUrl: CONFIG.baseUrl, model: CONFIG.model, hasKey: true })
    assert.equal(writes.length, 1)
    assert.equal(writes[0].mode, 0o600, 'the key file must not be world readable')

    const loaded = await readAsrConfig({ home })
    assert.deepEqual(loaded, CONFIG)

    const raw = JSON.parse(await readFile(configPath(home), 'utf8'))
    assert.equal(raw.apiKey, CONFIG.apiKey)

    // A corrupt file is "not configured" rather than a crash on every request.
    await writeFile(configPath(home), '{ not json', 'utf8')
    assert.equal(await readAsrConfig({ home }), null)

    // Clearing removes the file, so a stale key cannot linger.
    await writeAsrConfig({ home, config: CONFIG })
    assert.equal(await writeAsrConfig({ home, config: null }), null)
    assert.equal(await readAsrConfig({ home }), null)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})