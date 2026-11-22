/**
 * Resume + JD → editable Profile (contract §3.2, AC-1).
 *
 * Deliberately free of Cordis: the caller passes a `complete` function that
 * turns a prompt into text, which keeps the module unit-testable with a fake
 * and leaves `index.js` to adapt `ctx.llm.stream` once.
 *
 * @module lib/profile
 */

/**
 * @param {{ resumeText?: string, jdText?: string, jd?: { title?: string, company?: string, level?: string } }} input
 * @param {{ complete?: (request: { system: string, messages: object[], signal?: AbortSignal }) => Promise<string> }} [deps]
 * @returns {Promise<{ profile: object, warnings: string[] }>}
 */
export async function extractProfile(input, deps = {}) {
  void input
  void deps
  throw new Error('not implemented yet: extractProfile (G4)')
}