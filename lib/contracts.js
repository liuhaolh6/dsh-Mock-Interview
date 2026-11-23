/**
 * Frozen-at-review contract table for the mock interview plugin.
 *
 * G1 status: transport only. `ACTIONS` names every operation the single RPC
 * endpoint accepts, and `ERROR_CODES` names every failure the host can return.
 * Both are consumed three ways so they cannot drift:
 *   - `index.js` dispatches on ACTIONS and returns these codes;
 *   - `scripts/contract-lint.mjs` fails the build when the two disagree;
 *   - `tests/unit/contracts.test.mjs` pins the envelope shape.
 *
 * Growing this table is a G2 activity (see docs/adr/): add the action, its
 * input/output shape, its error codes, then a test, then the implementation.
 *
 * @module lib/contracts
 */

/** Version of the on-disk session schema, not of this table. */
export const SCHEMA_VERSION = 2

/** Single JSON-over-POST endpoint, same shape as the other local plugins. */
export const RPC_PATH = '/api/dsh-mock-interview/rpc'

/**
 * Every operation the endpoint accepts, keyed by the `op` field of the body.
 * Alphabetical on purpose: the lint compares this list with the dispatch
 * switch, and a sorted list makes a missing case obvious in review.
 */
export const ACTIONS = [
  'code/review',
  'ping',
  'profile/extract',
  'report/export',
  'report/preview',
  'session/create',
  'session/delete',
  'session/finish',
  'session/get',
  'session/list',
  'session/update',
  'turn/answer',
]

/**
 * Business failures travel inside the envelope (`{ ok: false, error }`) with
 * HTTP 200, so the browser half has exactly one parse path. Transport-level
 * failures (bad JSON body, unreadable stream) still answer with this envelope
 * to keep that promise.
 */
export const ERROR_CODES = {
  E_BAD_REQUEST: '请求体不是合法 JSON 对象，或缺少 op 字段',
  E_UNKNOWN_ACTION: 'op 不在本插件的契约表内',
  E_INTERNAL: '未预期的内部错误，详见宿主日志',
}

/**
 * Codes the contract promises but the host cannot return yet. Kept out of
 * ERROR_CODES so the lint keeps enforcing "declared == reachable": a code
 * moves from here into ERROR_CODES only in the same commit as its `case`.
 * `docs/contracts.md` §4 is the normative table for all of them.
 */
export const PLANNED_ERROR_CODES = [
  'E_ASR_NOT_CONFIGURED',
  'E_EXPORT_FAILED',
  'E_LLM_TIMEOUT',
  'E_LLM_UNAVAILABLE',
  'E_PROFILE_INCOMPLETE',
  'E_PROFILE_INVALID',
  'E_SCHEMA_VERSION',
  'E_SCORE_INVALID',
  'E_SESSION_FINISHED',
  'E_SESSION_NOT_FOUND',
  'E_SESSION_TOO_LARGE',
]

/** Interview modes (AC-2). Keys are wire values, never localized. */
export const MODES = ['tech-1', 'project', 'algo', 'behavior']

/** Difficulty tiers; `mid` is the default in the UI. */
export const DIFFICULTIES = ['junior', 'mid', 'senior']

/** Session length → question budget (AC-2). A run may deviate by ±2. */
export const DURATIONS = { 15: 5, 30: 9, 45: 13 }

/** The six rubric dimensions (AC-4). Each scores 1–5. */
// Which dimensions a question type can actually exercise (contract §2.4).
// A dimension outside this list is still reported (as a number or null) but
// never enters the average, so a skill question is not capped at 25/6.
export const APPLICABLE_DIMENSIONS = Object.freeze({
  skill: ['correctness', 'depth', 'structure', 'communication'],
  project: ['correctness', 'depth', 'structure', 'project', 'communication'],
  behavior: ['depth', 'structure', 'project', 'communication'],
  code: ['correctness', 'depth', 'code', 'communication'],
})

/**
 * @param {string} kind
 * @returns {string[]}
 */
export function applicableDims(kind) {
  return APPLICABLE_DIMENSIONS[kind] ?? APPLICABLE_DIMENSIONS.skill
}

export const DIMENSIONS = ['correctness', 'depth', 'structure', 'project', 'code', 'communication']

/** Hard limits shared by both halves; the browser mirrors these before sending. */
export const LIMITS = {
  maxRequestBytes: 64 * 1024,
  maxResumeChars: 20_000,
  maxAnswerChars: 4_000,
  maxCodeChars: 20_000,
  maxSessionBytes: 2 * 1024 * 1024,
  llmTimeoutMs: 45_000,
  llmMaxTokens: 4_096,
  budgetTolerance: 2,
  // v0.2 / B1 record management (§3.11)
  maxTitleChars: 80,
  maxTags: 10,
  maxTagChars: 24,
  maxNoteChars: 2_000,
  maxBatchDelete: 50,
}