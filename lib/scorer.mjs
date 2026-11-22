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
  void input
  throw new Error('not implemented yet: scoreAnswer (G4)')
}