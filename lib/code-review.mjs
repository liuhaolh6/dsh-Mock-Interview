import { ContractError, isContractError } from './errors.mjs'
import { LIMITS } from './contracts.js'
import { zeroCard } from './scorer.mjs'

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

  // Nothing submitted: say so plainly instead of paying for a model round-trip.
  if (text.trim() === '') {
    return {
      verdict: 'unverifiable',
      executed: false,
      cases: [],
      score: zeroCard(['未提交代码']),
      warnings: ['考生没有提交代码，本题无法评审'],
    }
  }

  throw new Error('not implemented yet: reviewCode (G4)')
}

export { CASE_COUNT }
void isContractError