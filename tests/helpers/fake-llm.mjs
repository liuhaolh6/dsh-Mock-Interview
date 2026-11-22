/**
 * Scripted stand-in for the host LLM, so `lib/` can be tested without Cordis.
 *
 * Usage:
 *   const llm = fakeLlm({ replies: ['{"skills":[]}', new Error('boom')] })
 *   await extractProfile(input, { complete: llm.complete })
 *   assert.equal(llm.calls.length, 2)
 *
 * @param {{ replies?: Array<string | Error>, error?: Error }} [script]
 */
export function fakeLlm(script = {}) {
  const replies = script.replies ?? []
  const calls = []

  /** @param {{ system: string, messages: object[], signal?: AbortSignal }} request */
  async function complete(request) {
    calls.push(request)
    if (script.error !== undefined && script.error !== null) throw script.error
    const next = replies[calls.length - 1]
    if (next === undefined) throw new Error(`fakeLlm: no scripted reply for call #${calls.length}`)
    if (next instanceof Error) throw next
    return next
  }

  return { complete, calls }
}