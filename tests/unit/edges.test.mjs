import assert from 'node:assert/strict'
import test from 'node:test'

import { composePrompt } from '../../lib/director.mjs'
import { ContractError, isContractError } from '../../lib/errors.mjs'
import { stripFence, tryParseObject } from '../../lib/json.mjs'
import { extractProfile } from '../../lib/profile.mjs'
import { scoreAnswer } from '../../lib/scorer.mjs'
import { fakeLlm } from '../helpers/fake-llm.mjs'
import { DIMS, ITEM_SKILL } from '../fixtures/score.mjs'

test('TC-EDG-001 isContractError only recognises our own error type', () => {
  assert.equal(isContractError(new ContractError('E_BAD_REQUEST', '坏请求')), true)
  assert.equal(isContractError(new Error('E_BAD_REQUEST')), false)
  assert.equal(isContractError(null), false)
})

test('TC-EDG-002 an unknown difficulty is a programming error, not a bad request', () => {
  assert.throws(() => composePrompt({ item: ITEM_SKILL, difficulty: 'god-tier' }), /unknown difficulty/)
})

test('TC-EDG-003 every kind of question gets its own instruction', () => {
  const kinds = ['project', 'code', 'behavior', 'knowledge']
  const prompts = kinds.map((kind) => composePrompt({ item: { ...ITEM_SKILL, kind }, difficulty: 'mid' }))
  assert.equal(new Set(prompts).size, kinds.length)
  const fallback = composePrompt({ item: { id: 'q9', kind: 'skill', target: 42 }, difficulty: 'mid' })
  assert.equal(fallback.includes('你简历里的项目'), true)
})

test('TC-EDG-004 a non-numeric dimension scores zero and says so', async () => {
  const reply = JSON.stringify({
    dims: { correctness: '4', depth: 3, structure: 3, project: 3, code: 0, communication: 3 },
    evidence: ['考生讲了链路'],
    missing: [],
    reference: [],
  })
  const llm = fakeLlm({ replies: [reply] })
  const { score, warnings } = await scoreAnswer({
    item: ITEM_SKILL,
    answer: '缓存分层，先本地后分布式。',
    difficulty: 'mid',
    complete: llm.complete,
  })
  assert.equal(score.dims.correctness, 0)
  assert.ok(warnings.some((warning) => warning.includes('correctness')))
  assert.equal(Object.keys(score.dims).length, DIMS.length)
})

test('TC-EDG-005 the JSON helper tolerates fences and rejects non-objects', () => {
  assert.equal(stripFence('```json\n{"a":1}\n```'), '{"a":1}')
  assert.deepEqual(tryParseObject('```json\n{"a":1}\n```'), { a: 1 })
  assert.equal(tryParseObject('[1,2,3]'), null)
  assert.equal(tryParseObject('42'), null)
  assert.equal(tryParseObject('不是 JSON'), null)
})

test('TC-EDG-006 a question without a topic falls back to its target', () => {
  assert.equal(
    composePrompt({ item: { id: 'q1', kind: 'skill', target: 'skill:Redis' }, difficulty: 'junior' })
      .includes('Redis'),
    true,
  )
  assert.equal(
    composePrompt({ item: { id: 'q2', kind: 'skill', target: 42 }, difficulty: 'mid' }).includes('你简历里的项目'),
    true,
  )
})

test('TC-EDG-007 a non-abort model failure is rethrown untouched', async () => {
  const llm = fakeLlm({ error: new Error('socket hang up') })
  await assert.rejects(
    () => extractProfile({ resumeText: 'Java 三年' }, { complete: llm.complete }),
    /socket hang up/,
  )
})

test('TC-EDG-008 the verdict band moves with the average', async () => {
  const strong = JSON.stringify({
    dims: { correctness: 5, depth: 5, structure: 5, project: 5, code: 0, communication: 5 },
    evidence: ['考生讲了 GC 日志怎么读'],
    missing: [],
    reference: [],
  })
  const ok = JSON.stringify({
    dims: { correctness: 4, depth: 3, structure: 4, project: 3, code: 0, communication: 4 },
    evidence: ['考生讲了主流程'],
    missing: [],
    reference: [],
  })
  const first = await scoreAnswer({
    item: ITEM_SKILL,
    answer: 'GC 日志看 Full GC 频率和停顿。',
    difficulty: 'senior',
    complete: fakeLlm({ replies: [strong] }).complete,
  })
  const second = await scoreAnswer({
    item: ITEM_SKILL,
    answer: '缓存分两层，本地加分布式。',
    difficulty: 'mid',
    complete: fakeLlm({ replies: [ok] }).complete,
  })
  assert.equal(first.score.verdict, 'strong')
  assert.equal(second.score.verdict, 'ok')
})

test('TC-EDG-009 a contract error without a message uses its code', () => {
  const problem = new ContractError('E_INTERNAL')
  assert.equal(problem.message, 'E_INTERNAL')
  assert.equal(problem.name, 'ContractError')
})