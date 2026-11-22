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

/**
 * Last resort for chatty replies: scan every balanced `{...}` that parses as an
 * object and keep the richest one (most keys). A decoy like
 * `{"verdict":"presumed-correct"}` quoted in prose therefore loses to the real
 * card; when two candidates tie, the later one wins because models append the
 * real answer after their thinking.
 *
 * @param {unknown} text
 * @returns {object | null}
 */
export function extractObject(text) {
  const source = String(text ?? '')
  const candidates = []
  let depth = 0
  let start = -1
  let inString = false
  let escaped = false

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]

    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{') {
      if (depth === 0) start = index
      depth += 1
      continue
    }
    if (char === '}' && depth > 0) {
      depth -= 1
      if (depth !== 0) continue
      const candidate = source.slice(start, index + 1)
      start = -1
      const parsed = tryParseObject(candidate)
      if (parsed !== null) candidates.push(parsed)
    }
  }

  let best = null
  for (const parsed of candidates) {
    const keys = Object.keys(parsed).length
    if (best === null || keys >= best.keys) best = { keys, parsed }
  }
  return best === null ? null : best.parsed
}