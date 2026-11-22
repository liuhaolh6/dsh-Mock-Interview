import assert from 'node:assert/strict'
import test from 'node:test'

import { reviewCode } from '../../lib/code-review.mjs'
import { extractObject } from '../../lib/json.mjs'
import { fakeLlm } from '../helpers/fake-llm.mjs'
import { CODE_REVIEW_OK, ITEM_CODE } from '../fixtures/code.mjs'

// S3b: the branches the four functional cases do not reach.

test('TC-EDG-010 an unparseable review is a contract error, not a crash', async () => {
  const llm = fakeLlm({ replies: ['抱歉，我无法评审这段代码。'] })
  await assert.rejects(
    () => reviewCode({ item: ITEM_CODE, code: 'x = 1', language: 'javascript', complete: llm.complete }),
    { code: 'E_SCORE_INVALID' },
  )
})

test('TC-EDG-011 an unknown verdict degrades to unverifiable with a warning', async () => {
  const reply = JSON.stringify({ ...JSON.parse(CODE_REVIEW_OK), verdict: 'perfect' })
  const llm = fakeLlm({ replies: [reply] })
  const result = await reviewCode({
    item: ITEM_CODE,
    code: 'x = 1',
    language: 'javascript',
    complete: llm.complete,
  })
  assert.equal(result.verdict, 'unverifiable')
  assert.ok(result.warnings.some((line) => line.includes('perfect')))
})

test('TC-EDG-012 fewer than five cases are padded and flagged', async () => {
  const parsed = JSON.parse(CODE_REVIEW_OK)
  parsed.cases = parsed.cases.slice(0, 2)
  const llm = fakeLlm({ replies: [JSON.stringify(parsed)] })
  const result = await reviewCode({
    item: ITEM_CODE,
    code: 'x = 1',
    language: 'javascript',
    complete: llm.complete,
  })
  assert.equal(result.cases.length, 5)
  assert.equal(result.cases[2].ok, false)
  assert.ok(result.warnings.some((line) => line.includes('不足 5 条')))
})

test('TC-EDG-013 a missing cases field still yields five placeholders', async () => {
  const parsed = JSON.parse(CODE_REVIEW_OK)
  delete parsed.cases
  const llm = fakeLlm({ replies: [JSON.stringify(parsed)] })
  const result = await reviewCode({
    item: ITEM_CODE,
    code: 'x = 1',
    language: 'javascript',
    complete: llm.complete,
  })
  assert.equal(result.cases.length, 5)
  assert.equal(result.executed, false)
})

test('TC-EDG-014 the extractor ignores braces inside strings and unbalanced tails', () => {
  assert.deepEqual(extractObject('{"a":"}{"}'), { a: '}{' })
  assert.deepEqual(extractObject('先说明 {"a": "}{"} 结束'), { a: '}{' })
  assert.equal(extractObject('{"a": 1'), null)
  assert.equal(extractObject('[1,2]'), null)
})

test('TC-EDG-015 the richest candidate wins and ties go to the later one', () => {
  assert.deepEqual(extractObject('{"verdict":"presumed-correct"} 然后 {"dims":{"code":5}}'), { dims: { code: 5 } })
  assert.deepEqual(extractObject('{"a":1} {"b":2}'), { b: 2 })
})
test('TC-EDG-016 a non-string submission is treated as empty, not as a crash', async () => {
  const llm = fakeLlm({ replies: [CODE_REVIEW_OK] })
  const result = await reviewCode({ item: ITEM_CODE, code: undefined, complete: llm.complete })
  assert.equal(result.verdict, 'unverifiable')
  assert.equal(llm.calls.length, 0)
})

test('TC-EDG-017 malformed case entries are normalised to strings and false', async () => {
  const parsed = JSON.parse(CODE_REVIEW_OK)
  parsed.cases = [{ input: 1, expected: null, ok: 'yes' }]
  const llm = fakeLlm({ replies: [JSON.stringify(parsed)] })
  const result = await reviewCode({
    item: ITEM_CODE,
    code: 'x = 1',
    language: 'javascript',
    complete: llm.complete,
  })
  assert.deepEqual(result.cases[0], { input: '1', expected: '', actual: '', ok: false })
  assert.equal(result.cases.length, 5)
})

test('TC-EDG-018 extra cases are truncated to five and a missing language is labelled', async () => {
  const parsed = JSON.parse(CODE_REVIEW_OK)
  parsed.cases = [...parsed.cases, { input: '9', expected: '9', actual: '9', ok: true }, { input: '8', expected: '8', actual: '8', ok: true }]
  const llm = fakeLlm({ replies: [JSON.stringify(parsed)] })
  const result = await reviewCode({ item: ITEM_CODE, code: 'x = 1', complete: llm.complete })
  assert.equal(result.cases.length, 5)
  assert.ok(llm.calls[0].messages[0].content.includes('unknown'))
})
