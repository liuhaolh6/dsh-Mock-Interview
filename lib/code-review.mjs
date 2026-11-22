import { ContractError, isContractError } from './errors.mjs'
import { LIMITS } from './contracts.js'

/**
 * Static review of a whiteboard answer. Nothing here executes the candidate's
 * code: the result always carries `executed: false` so reports can say
 * 「未真实执行」 without the caller having to remember.
 */

export const VERDICTS = ['presumed-correct', 'presumed-wrong', 'unverifiable']

const CASE_COUNT = 5

export async function reviewCode(input) {
  const { item, code, language, complete } = input ?? {}
  void item
  void language
  void complete

  const text = typeof code === 'string' ? code : ''
  if (text.length > LIMITS.maxCodeChars) {
    throw new ContractError('E_BAD_REQUEST', `代码超过 ${LIMITS.maxCodeChars} 字符上限`)
  }

  throw new Error('not implemented yet: reviewCode (G4)')
}

export { CASE_COUNT }
void isContractError