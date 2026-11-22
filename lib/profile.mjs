/**
 * Resume + JD → editable Profile (contract §3.2, AC-1).
 *
 * Deliberately free of Cordis: the caller passes a `complete` function that
 * turns a prompt into text, which keeps the module unit-testable with a fake
 * and leaves `index.js` to adapt `ctx.llm.stream` once.
 *
 * @module lib/profile
 */

import { ContractError } from './errors.mjs'

const SYSTEM_PROMPT = [
  '你是资深技术面试官。从候选人的简历与目标岗位描述中抽取结构化画像。',
  '只输出一个 JSON 对象，不要任何解释或代码围栏。字段：',
  '{"skills":string[],"years":number,"level":"junior"|"mid"|"senior",',
  '"projects":[{"name":string,"role":string,"highlights":string[]}],',
  '"jd":{"title":string,"company"?:string,"level"?:string}}',
  '不确定的字段用空字符串或空数组，不要编造。',
].join('\n')

/**
 * @param {{ resumeText?: string, jdText?: string, jd?: { title?: string, company?: string, level?: string } }} input
 * @param {{ complete?: (request: { system: string, messages: object[], signal?: AbortSignal }) => Promise<string> }} [deps]
 * @returns {Promise<{ profile: object, warnings: string[] }>}
 */
export async function extractProfile(input, deps = {}) {
  const { resumeText = '', jdText = '', jd = {} } = input ?? {}
  const { complete } = deps

  const resume = String(resumeText).trim()
  const jdBody = String(jdText).trim()
  if (resume === '' && jdBody === '' && Object.keys(jd).length === 0) {
    throw new ContractError('E_BAD_REQUEST', '简历与岗位描述不能同时为空')
  }

  const userParts = []
  if (resume !== '') userParts.push(`【简历】\n${resume}`)
  if (jdBody !== '') userParts.push(`【岗位描述】\n${jdBody}`)
  if (Object.keys(jd).length > 0) userParts.push(`【岗位结构化信息】\n${JSON.stringify(jd)}`)

  const prompt = userParts.join('\n\n')
  const messages = [{ role: 'user', content: prompt }]

  const first = await callComplete(complete, { system: SYSTEM_PROMPT, messages })
  const parsed = tryParse(first)
  if (parsed) return { profile: parsed, warnings: [] }

  // One corrective retry: show the model its own broken output and ask again.
  const second = await callComplete(complete, {
    system: SYSTEM_PROMPT,
    messages: [
      ...messages,
      { role: 'assistant', content: String(first) },
      { role: 'user', content: '上面的输出不是可解析的 JSON。只输出 JSON 对象本身，不要解释、不要代码围栏。' },
    ],
  })
  const retried = tryParse(second)
  if (retried) return { profile: retried, warnings: [] }

  throw new ContractError('E_PROFILE_INVALID', '模型两次都没有返回可解析的画像 JSON')
}

/** @returns {object | null} */
function tryParse(text) {
  try {
    const value = JSON.parse(stripFence(text))
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null
  } catch {
    return null
  }
}

/**
 * The transport layer enforces the 45 s deadline with an AbortSignal; here we
 * only translate the abort into the contract's error code.
 */
async function callComplete(complete, request) {
  try {
    return await complete(request)
  } catch (problem) {
    if (problem?.name === 'AbortError' || problem?.code === 'ABORT_ERR') {
      throw new ContractError('E_LLM_TIMEOUT', '模型调用超时（45 s）')
    }
    throw problem
  }
}

/** Models sometimes wrap JSON in ```json fences even when told not to. */
function stripFence(text) {
  const trimmed = String(text).trim()
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed)
  return fenced ? fenced[1] : trimmed
}