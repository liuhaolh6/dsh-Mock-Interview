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
export const SCHEMA_VERSION = 1

/** Single JSON-over-POST endpoint, same shape as the other local plugins. */
export const RPC_PATH = '/api/dsh-mock-interview/rpc'

/**
 * Every operation the endpoint accepts, keyed by the `op` field of the body.
 * Alphabetical on purpose: the lint compares this list with the dispatch
 * switch, and a sorted list makes a missing case obvious in review.
 */
export const ACTIONS = ['ping']

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