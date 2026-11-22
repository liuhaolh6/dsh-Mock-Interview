/**
 * Resume + JD → editable Profile (contract §3.2, AC-1).
 *
 * Deliberately free of Cordis: the caller passes a `complete` function that
 * turns a prompt into text, which keeps the module unit-testable with a fake
 * and leaves `index.js` to adapt `ctx.llm.stream` once.
 *
 * @module lib/profile
 */

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

  const userParts = []
  if (resumeText !== '') userParts.push(`【简历】\n${resumeText}`)
  if (jdText !== '') userParts.push(`【岗位描述】\n${jdText}`)
  if (Object.keys(jd).length > 0) userParts.push(`【岗位结构化信息】\n${JSON.stringify(jd)}`)

  const reply = await complete({
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userParts.join('\n\n') }],
  })

  const profile = JSON.parse(stripFence(reply))

  return { profile, warnings: [] }
}

/** Models sometimes wrap JSON in ```json fences even when told not to. */
function stripFence(text) {
  const trimmed = String(text).trim()
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed)
  return fenced ? fenced[1] : trimmed
}