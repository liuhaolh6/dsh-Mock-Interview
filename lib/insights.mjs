/**
 * Progress and trend arithmetic (v0.3 C2/C5).
 *
 * The panel should never recompute "which question am I on" with its own
 * ad-hoc arithmetic: those numbers must agree with the record list and with
 * the report. Pure functions, no DOM, no clock — the caller passes `now`.
 */

const round1 = (value) => Math.round(value * 10) / 10

function scoredTurns(turns) {
  return (Array.isArray(turns) ? turns : []).filter(
    (turn) => turn !== null && typeof turn === 'object' && turn.score !== null && typeof turn.score?.overall === 'number',
  )
}

/**
 * @param {object} session stored session (any schema version, already migrated)
 * @param {{now?: number}} [options]
 * @returns {{index: number, total: number, answered: number, remaining: number,
 *   elapsedMs: number, avgScore: number|null, finished: boolean}}
 */
export function progressOf(session, options = {}) {
  const now = typeof options.now === 'number' ? options.now : Date.now()
  const items = Array.isArray(session?.plan?.items) ? session.plan.items : []
  const turns = Array.isArray(session?.turns) ? session.turns : []
  const answeredIds = new Set(turns.map((turn) => turn?.questionId).filter((id) => id !== undefined))
  const total = items.length
  const answered = items.filter((item) => answeredIds.has(item?.id)).length
  const nextIndex = items.findIndex((item) => !answeredIds.has(item?.id))
  const index = nextIndex < 0 ? (total === 0 ? 0 : total) : nextIndex + 1
  const scored = scoredTurns(turns)
  const avgScore = scored.length === 0 ? null : round1(scored.reduce((sum, turn) => sum + turn.score.overall, 0) / scored.length)
  const createdAt = typeof session?.createdAt === 'number' ? session.createdAt : now
  return {
    index,
    total,
    answered,
    remaining: Math.max(total - answered, 0),
    elapsedMs: Math.max(now - createdAt, 0),
    avgScore,
    finished: session?.status === 'finished',
  }
}

/**
 * @param {Array<object>} rows `session/list` rows
 * @returns {{total: number, finished: number, active: number, avgScore: number|null, answeredTurns: number}}
 */
export function statsOf(rows) {
  const list = Array.isArray(rows) ? rows.filter((row) => row !== null && typeof row === 'object') : []
  const finished = list.filter((row) => row.status === 'finished')
  const scored = list.filter((row) => typeof row.overall === 'number')
  const answeredTurns = list.reduce((sum, row) => sum + (typeof row.turns === 'number' ? row.turns : 0), 0)
  return {
    total: list.length,
    finished: finished.length,
    active: list.length - finished.length,
    avgScore: scored.length === 0 ? null : round1(scored.reduce((sum, row) => sum + row.overall, 0) / scored.length),
    answeredTurns,
  }
}

/**
 * Newest `limit` scored sessions, oldest → newest, for the little bar strip.
 *
 * @param {Array<object>} rows `session/list` rows
 * @param {number} [limit]
 * @returns {Array<{id: string, overall: number, createdAt: number}>}
 */
export function trendOf(rows, limit = 10) {
  const list = Array.isArray(rows) ? rows.filter((row) => row !== null && typeof row === 'object') : []
  const scored = list
    .filter((row) => typeof row.overall === 'number')
    .sort((left, right) => (right.updatedAt ?? right.createdAt ?? 0) - (left.updatedAt ?? left.createdAt ?? 0))
  return scored
    .slice(0, Math.max(limit, 0))
    .map((row) => ({ id: row.id, overall: row.overall, createdAt: row.createdAt ?? row.updatedAt ?? 0 }))
    .reverse()
}
