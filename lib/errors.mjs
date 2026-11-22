/**
 * The single error type the host half throws across module boundaries.
 *
 * `code` must exist in `lib/contracts.js` (`ERROR_CODES` once implemented,
 * `PLANNED_ERROR_CODES` while the case is still being built). `index.js`
 * maps it straight into the `{ ok: false, error }` envelope, so throwing a
 * bare `Error` anywhere in `lib/` is a bug: it becomes `E_INTERNAL`.
 *
 * @module lib/errors
 */
export class ContractError extends Error {
  /**
   * @param {string} code one of the contract error codes
   * @param {string} [message] human-readable detail; defaults to the code
   */
  constructor(code, message) {
    super(message === undefined ? code : message)
    this.name = 'ContractError'
    this.code = code
  }
}

/**
 * @param {unknown} problem
 * @returns {problem is ContractError}
 */
export function isContractError(problem) {
  return problem instanceof ContractError
}