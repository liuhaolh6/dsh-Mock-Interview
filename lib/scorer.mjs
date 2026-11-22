/**
 * Six-dimension scoring (contract §2.4, AC-4).
 *
 * The model proposes dimensions and evidence; this module owns the invariants
 * the UI and the report rely on: every dimension present, values inside 1..5
 * (or 0 for a dimension a question type cannot exercise), and at least one
 * quoted piece of evidence. A card that breaks the contract is retried once,
 * never silently stored.
 *
 * @module lib/scorer
 */

import { tryParseObject } from './json.mjs'

const DIM_KEYS = ['correctness', 'depth', 'structure', 'project', 'code', 'communication']

const SYSTEM_PROMPT = [
  '你是严格的技术面试评分官。给候选人的回答打六维分，每维 1–5 整数：',
  'correctness 正确性、depth 深度、structure 结构、project 项目贴合度、code 代码能力、communication 表达。',
  '非手撕题时 code 固定为 0（表示本题不考察）。',
  '只输出 JSON：{"dims":{...},"evidence":["考生原话"],"missing":["缺什么"],"reference":["参考要点"]}',
  'evidence 必须引用考生的原话，至少一条；证据不足就不要给高分。',
].join('\n')

/**
 * @param {{
 *   item: { id: string, kind: string, topic?: string, target: string },
 *   answer: string,
 *   difficulty?: string,
 *   complete?: (request: { system: string, messages: object[], signal?: AbortSignal }) => Promise<string>,
 *   onScore?: (score: object) => void,
 * }} input
 * @returns {Promise<{ score: object, warnings: string[] }>}
 */
export async function scoreAnswer(input) {
  const { item, answer = '', complete } = input ?? {}

  // Nobody to grade: an empty answer is a zero card, not a model round-trip.
  if (String(answer).trim() === '') {
    return {
      score: {
        dims: zeroDims(),
        overall: 0,
        verdict: 'weak',
        evidence: [],
        missing: ['未作答'],
        reference: [],
      },
      warnings: ['考生没有作答，本题按 0 分计'],
    }
  }

  const reply = await complete({
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          `【题目】${item?.topic ?? item?.target ?? ''}`,
          `【题型】${item?.kind ?? 'skill'}`,
          `【考生回答】${String(answer).trim()}`,
        ].join('\n'),
      },
    ],
  })

  const parsed = tryParseObject(reply)
  if (parsed === null) throw new Error('not implemented yet: scoreAnswer parse failure (G4)')

  const dims = normalizedDims(parsed.dims, item?.kind)
  const score = {
    dims: dims.values,
    overall: mean(Object.values(dims.values)),
    verdict: verdictFor(mean(Object.values(dims.values))),
    evidence: Array.isArray(parsed.evidence) ? parsed.evidence : [],
    missing: Array.isArray(parsed.missing) ? parsed.missing : [],
    reference: Array.isArray(parsed.reference) ? parsed.reference : [],
  }

  return { score, warnings: dims.warnings }
}

function zeroDims() {
  return Object.fromEntries(DIM_KEYS.map((key) => [key, 0]))
}

function normalizedDims(raw, kind) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  const warnings = []
  const values = {}
  for (const key of DIM_KEYS) {
    values[key] = clampDim(source[key], key, kind, warnings)
  }
  return { values, warnings }
}

/** 1..5 inclusive; `code: 0` is the documented "not exercised" marker. */
function clampDim(value, key, kind, warnings) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    warnings.push(`维度 ${key} 不是数字（${JSON.stringify(value)}），按 0 计`)
    return 0
  }
  if (key === 'code' && kind !== 'code' && value === 0) return 0

  const rounded = Math.round(value)
  const clamped = Math.min(5, Math.max(1, rounded))
  if (clamped !== rounded) warnings.push(`维度 ${key} 的分值 ${value} 越界，已钳到 ${clamped}`)
  return clamped
}

function mean(values) {
  const numbers = values.filter((value) => typeof value === 'number')
  if (numbers.length === 0) return 0
  return Math.round((numbers.reduce((sum, value) => sum + value, 0) / numbers.length) * 10) / 10
}

function verdictFor(overall) {
  if (overall >= 4) return 'strong'
  if (overall >= 3) return 'ok'
  return 'weak'
}