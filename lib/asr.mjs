/**
 * ASR adapter (v0.4 / D1).
 *
 * The plugin never records or stores audio: the browser captures one clip, sends
 * it here, and this module forwards it to the transcription endpoint the user
 * configured. Everything is pure apart from the config file, so the multipart
 * body and the transcript normalisation are pinned by tests rather than by ear.
 *
 * Design notes:
 *   - The endpoint is OpenAI compatible (`POST <base>/audio/transcriptions`,
 *     multipart with `file` + `model`), because that is the shape every
 *     self-hosted whisper.cpp / faster-whisper / one-api gateway speaks.
 *   - No model weights ship with the plugin (ADR-0006): audio transcription is
 *     somebody else's service, and we only know how to talk to it.
 *   - The key lives in `$DSH_HOME/storages/dsh-mock-interview/asr.json` with
 *     mode 0600 and never travels back to the browser (see `publicAsrConfig`).
 *
 * @module lib/asr
 */

import { randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { LIMITS } from './contracts.js'
import { ContractError } from './errors.mjs'

/** Containers a browser can hand us; anything else is rejected before the send. */
export const ASR_MIME_TYPES = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/wav']

/** Where the endpoint lives, relative to DSH_HOME. */
const CONFIG_RELATIVE = ['storages', 'dsh-mock-interview', 'asr.json']

/**
 * @param {string} home
 * @returns {string}
 */
export function configPath(home) {
  return join(home, ...CONFIG_RELATIVE)
}

/**
 * Validate an endpoint config, or explain what is missing.
 *
 * A missing field is `E_ASR_NOT_CONFIGURED` (the user never set this up) while a
 * malformed URL is `E_BAD_REQUEST` (they did, but typed it wrong) — the panel
 * shows different next steps for the two.
 *
 * @param {{ baseUrl?: string, apiKey?: string, model?: string } | null | undefined} source
 * @returns {{ baseUrl: string, apiKey: string, model: string }}
 */
export function resolveAsrConfig(source) {
  const raw = source ?? {}
  /** @type {string[]} */
  const missing = []
  for (const field of ['baseUrl', 'apiKey', 'model']) {
    const value = raw[field]
    if (typeof value !== 'string' || value.trim() === '') missing.push(field)
  }
  if (missing.length > 0) {
    throw new ContractError(
      'E_ASR_NOT_CONFIGURED',
      `语音转写未配置：缺少 ${missing.join(' / ')}。请改用文字作答，或在设置里填写自备的 OpenAI 兼容转写端点`,
    )
  }

  const baseUrl = raw.baseUrl.trim().replace(/\/+$/, '')
  let parsed
  try {
    parsed = new URL(baseUrl)
  } catch {
    throw new ContractError('E_BAD_REQUEST', `转写端点不是合法地址：${baseUrl}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ContractError('E_BAD_REQUEST', `转写端点必须是 http(s) 地址：${baseUrl}`)
  }

  return { baseUrl, apiKey: raw.apiKey.trim(), model: raw.model.trim() }
}

/**
 * The browser-safe view: the key becomes a boolean.
 *
 * @param {{ baseUrl?: string, model?: string, apiKey?: string } | null} config
 * @returns {{ baseUrl: string, model: string, hasKey: boolean }}
 */
export function publicAsrConfig(config) {
  return {
    baseUrl: typeof config?.baseUrl === 'string' ? config.baseUrl : '',
    model: typeof config?.model === 'string' ? config.model : '',
    hasKey: typeof config?.apiKey === 'string' && config.apiKey !== '',
  }
}

/**
 * `sk-test-1234567890` → `sk-t…7890`. Long enough to recognise, short enough
 * that a screenshot of the settings panel is not a credential leak.
 *
 * @param {string | undefined} key
 * @returns {string}
 */
export function maskKey(key) {
  if (typeof key !== 'string' || key === '') return ''
  if (key.length < 12) return '••••'
  return `${key.slice(0, 4)}…${key.slice(-4)}`
}

function audioBuffer(audio) {
  if (audio === undefined || audio === null) {
    throw new ContractError('E_BAD_REQUEST', '音频为空：请重新录音，或改用文字作答')
  }
  const buffer = Buffer.isBuffer(audio) ? audio : Buffer.from(audio)
  if (buffer.length === 0) {
    throw new ContractError('E_BAD_REQUEST', '音频为空：请重新录音，或改用文字作答')
  }
  if (buffer.length > LIMITS.maxAudioBytes) {
    const mb = Math.round(LIMITS.maxAudioBytes / (1024 * 1024))
    throw new ContractError('E_BAD_REQUEST', `音频超过 ${mb} MB：请缩短回答，或改用文字作答`)
  }
  return buffer
}

function extensionOf(mime) {
  if (mime === 'audio/ogg') return 'ogg'
  if (mime === 'audio/mp4') return 'm4a'
  if (mime === 'audio/wav') return 'wav'
  return 'webm'
}

/**
 * Build the multipart request that asks the endpoint for a transcript.
 *
 * The audio bytes are written into the body unchanged (a JSON/base64 detour
 * would inflate a 4 MB clip to 5.3 MB and gain nothing), so the body is a Buffer
 * and the caller must send it as-is.
 *
 * @param {{
 *   baseUrl?: string, apiKey?: string, model?: string,
 *   audio?: Buffer | Uint8Array, mime?: string, language?: string,
 *   durationMs?: number, filename?: string,
 * }} input
 * @param {{ boundary?: string }} [extras]
 * @returns {{ url: string, method: 'POST', headers: Record<string, string>, body: Buffer }}
 */
export function buildAsrRequest(input, extras = {}) {
  const config = resolveAsrConfig(input)
  const mime = typeof input.mime === 'string' && input.mime !== '' ? input.mime : 'audio/webm'
  if (!ASR_MIME_TYPES.includes(mime)) {
    throw new ContractError(
      'E_BAD_REQUEST',
      `不支持的音频格式 ${mime}，可选 ${ASR_MIME_TYPES.join(' / ')}`,
    )
  }

  if (input.durationMs !== undefined && input.durationMs !== null) {
    if (!Number.isFinite(input.durationMs) || input.durationMs <= 0) {
      throw new ContractError('E_BAD_REQUEST', '录音时长不合法：请重新录音')
    }
    if (input.durationMs > LIMITS.maxAudioMs) {
      const seconds = Math.round(LIMITS.maxAudioMs / 1000)
      throw new ContractError(
        'E_BAD_REQUEST',
        `录音时长超过 ${seconds} 秒：请分段作答，或改用文字作答`,
      )
    }
  }

  const audio = audioBuffer(input.audio)
  const boundary = extras.boundary ?? `----dsh-mock-interview-${randomUUID()}`
  const filename = input.filename ?? `answer.${extensionOf(mime)}`

  const chunks = []
  const textPart = (name, value) => {
    chunks.push(Buffer.from(`--${boundary}\r\ncontent-disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`))
  }

  textPart('model', config.model)
  if (typeof input.language === 'string' && input.language !== '') textPart('language', input.language)
  textPart('response_format', 'json')
  chunks.push(
    Buffer.from(
      `--${boundary}\r\ncontent-disposition: form-data; name="file"; filename="${filename}"\r\ncontent-type: ${mime}\r\n\r\n`,
    ),
  )
  chunks.push(audio)
  chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`))

  return {
    url: transcriptionUrl(config.baseUrl),
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    body: Buffer.concat(chunks),
  }
}

function transcriptionUrl(baseUrl) {
  const base = baseUrl.replace(/\/+$/, '')
  return base.endsWith('/audio/transcriptions') ? base : `${base}/audio/transcriptions`
}

/**
 * The endpoint answers `{ text }`. Whitespace is collapsed so a stray newline
 * from the model cannot split a word, but filler words are deliberately kept:
 * the scorer must see what the candidate actually said (risk table, D1).
 *
 * @param {{ text?: unknown } | null | undefined} payload
 * @returns {string}
 */
export function normaliseTranscript(payload) {
  const text = typeof payload?.text === 'string' ? payload.text : ''
  const collapsed = text.replace(/\s+/g, ' ').trim()
  if (collapsed === '') {
    throw new ContractError('E_ASR_FAILED', '语音转写返回了空文本：请重说一遍，或改用文字作答')
  }
  return collapsed
}

/** @type {typeof import('node:fs/promises')} */
const defaultFs = { readFile, writeFile, mkdir, rm, chmod }

/**
 * Read the stored endpoint config, or null when the feature is not set up.
 * A corrupt file counts as "not set up": one bad byte must not break the panel.
 *
 * @param {{ home: string, fs?: Partial<typeof defaultFs> }} options
 * @returns {Promise<{ baseUrl: string, apiKey: string, model: string } | null>}
 */
export async function readAsrConfig({ home, fs = {} }) {
  const io = { ...defaultFs, ...fs }
  try {
    const raw = await io.readFile(configPath(home), 'utf8')
    const parsed = JSON.parse(raw)
    return resolveAsrConfig(parsed)
  } catch {
    return null
  }
}

/**
 * Persist (or clear) the endpoint config. Returns the browser-safe view.
 *
 * @param {{ home: string, config: object | null, fs?: Partial<typeof defaultFs> }} options
 * @returns {Promise<{ baseUrl: string, model: string, hasKey: boolean } | null>}
 */
export async function writeAsrConfig({ home, config, fs = {} }) {
  const io = { ...defaultFs, ...fs }
  const path = configPath(home)
  if (config === null || config === undefined) {
    await io.rm(path, { force: true })
    return null
  }
  const resolved = resolveAsrConfig(config)
  await io.mkdir(dirname(path), { recursive: true })
  await io.writeFile(path, `${JSON.stringify(resolved, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  // writeFile only applies `mode` when it creates the file; pin an existing one.
  try {
    await io.chmod(path, 0o600)
  } catch {
    /* Windows has no POSIX bits; the file is still inside the user's DSH_HOME. */
  }
  return publicAsrConfig(resolved)
}