/**
 * v0.2 / B2: a small directory index so listing N records does not read N JSON
 * bodies. Each entry remembers the file's mtime; a changed mtime means the body
 * is re-read. The index is a cache, never a source of truth:
 *
 * - corrupt index → rebuilt from the files;
 * - deleted file → dropped from the index;
 * - file edited behind our back → mtime differs → re-read.
 *
 * @module lib/index-cache
 */

const INDEX_FILE = 'index.json'
const INDEX_VERSION = 1

/** @param {string} dir */
export function indexPath(dir) {
  return `${dir}/${INDEX_FILE}`
}

/** Read the index; any problem means "no cache", never an error to the caller. */
export async function loadIndex(dir, io) {
  try {
    const text = await io.readFile(indexPath(dir), 'utf8')
    const parsed = JSON.parse(text)
    if (parsed?.version !== INDEX_VERSION || typeof parsed.entries !== 'object' || parsed.entries === null) {
      return { entries: {}, usable: false }
    }
    return { entries: parsed.entries, usable: true }
  } catch {
    return { entries: {}, usable: false }
  }
}

/** Persist the index. Failing to write a cache must not fail the list. */
export async function saveIndex(dir, io, entries) {
  try {
    const text = JSON.stringify({ version: INDEX_VERSION, entries }, null, 2)
    const temp = `${indexPath(dir)}.${process.pid}.tmp`
    await io.writeFile(temp, text, 'utf8')
    await io.rename(temp, indexPath(dir))
    return true
  } catch {
    return false
  }
}

/**
 * Merge the directory listing with the cache: reuse entries whose mtime still
 * matches, drop entries whose file is gone, and let the caller load the rest.
 *
 * @param {{ names: string[], entries: Record<string, any>, dir: string, io: any }} input
 * @returns {Promise<{ reused: Record<string, any>, pending: string[] }>}
 */
export async function reconcile({ names, entries, dir, io }) {
  const reused = {}
  const pending = []

  for (const name of names) {
    if (!name.endsWith('.json') || name === INDEX_FILE) continue
    const id = name.slice(0, -'.json'.length)
    let mtime
    try {
      const stats = await io.stat(`${dir}/${name}`)
      mtime = stats.mtimeMs
    } catch {
      continue
    }
    const cached = entries[id]
    if (cached !== undefined && cached.mtime === mtime && cached.row !== undefined) {
      reused[id] = cached
    } else {
      pending.push(id)
    }
  }

  return { reused, pending }
}