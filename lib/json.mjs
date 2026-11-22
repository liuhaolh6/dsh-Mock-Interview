/**
 * Model replies arrive as prose more often than as pure JSON: fenced blocks,
 * stray apologies, missing braces. These two helpers are the only place that
 * knows about that, so `profile` and `scorer` parse the same way.
 *
 * @module lib/json
 */

/** Models sometimes wrap JSON in ```json fences even when told not to. */
export function stripFence(text) {
  const trimmed = String(text).trim()
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed)
  return fenced ? fenced[1] : trimmed
}

/** @returns {object | null} a plain object, or null when the text is not one. */
export function tryParseObject(text) {
  try {
    const value = JSON.parse(stripFence(text))
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null
  } catch {
    return null
  }
}