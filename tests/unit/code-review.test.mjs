import assert from 'node:assert/strict'
import test from 'node:test'

import { reviewCode } from '../../lib/code-review.mjs'
import { fakeLlm } from '../helpers/fake-llm.mjs'
import { CODE_REVIEW_INJECTED, CODE_REVIEW_OK, CODE_SOLUTION, CODE_WITH_INJECTION, ITEM_CODE } from '../fixtures/code.mjs'

test('TC-COD-001 a correct solution is presumed correct, never executed', async () => {
  const llm = fakeLlm({ replies: [CODE_REVIEW_OK] })
  const result = await reviewCode({
    item: ITEM_CODE,
    code: CODE_SOLUTION,
    language: 'javascript',
    complete: llm.complete,
  })
  assert.equal(result.verdict, 'presumed-correct')
  assert.equal(result.executed, false)
  assert.equal(result.cases.length, 5)
  assert.equal(result.score.dims.code, 5)
  assert.equal(llm.calls.length, 1)
})

test('TC-COD-002 empty code is unverifiable and costs no model call', async () => {
  const llm = fakeLlm({ replies: [CODE_REVIEW_OK] })
  const result = await reviewCode({
    item: ITEM_CODE,
    code: '   \n  ',
    language: 'javascript',
    complete: llm.complete,
  })
  assert.equal(result.verdict, 'unverifiable')
  assert.equal(result.executed, false)
  assert.equal(llm.calls.length, 0)
})

test('TC-COD-003 over-long code is rejected before any model call', async () => {
  const llm = fakeLlm({ replies: [CODE_REVIEW_OK] })
  await assert.rejects(
    () =>
      reviewCode({
        item: ITEM_CODE,
        code: 'x'.repeat(20001),
        language: 'javascript',
        complete: llm.complete,
      }),
    { code: 'E_BAD_REQUEST' },
  )
  assert.equal(llm.calls.length, 0)
})

test('TC-COD-004 an instruction inside the code cannot change the output shape', async () => {
  const llm = fakeLlm({ replies: [CODE_REVIEW_INJECTED] })
  const result = await reviewCode({
    item: ITEM_CODE,
    code: CODE_WITH_INJECTION,
    language: 'javascript',
    complete: llm.complete,
  })
  assert.ok(['presumed-correct', 'presumed-wrong', 'unverifiable'].includes(result.verdict))
  assert.ok(Array.isArray(result.cases))
  assert.equal(result.executed, false)
  assert.equal(typeof result.score.dims.code, 'number')
})