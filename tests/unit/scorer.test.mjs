import assert from 'node:assert/strict'
import test from 'node:test'

import { scoreAnswer } from '../../lib/scorer.mjs'
import { fakeLlm } from '../helpers/fake-llm.mjs'
import { DIMS, ITEM_SKILL, SCORE_MISSING_DIM, SCORE_NO_EVIDENCE, SCORE_OUT_OF_RANGE, SCORE_VALID } from '../fixtures/score.mjs'

test('TC-SCR-001 a valid reply fills all six dimensions and averages the applicable ones', async () => {
  const llm = fakeLlm({ replies: [SCORE_VALID] })
  const { score, warnings } = await scoreAnswer({
    item: ITEM_SKILL,
    answer: '缓存分本地和分布式两层，本地用 Caffeine，分布式用 Redis。',
    difficulty: 'mid',
    complete: llm.complete,
  })
  assert.deepEqual(Object.keys(score.dims).sort(), [...DIMS].sort())
  // kind 'skill' averages correctness/depth/structure/communication only:
  // (3 + 2 + 3 + 3) / 4 = 2.75 -> 2.8. project/code do not enter the mean.
  assert.equal(score.overall, 2.8)
  assert.ok(score.evidence.length >= 1)
  assert.equal(score.verdict, 'weak')
  assert.deepEqual(warnings, [])
  assert.equal(llm.calls.length, 1)
})

test('TC-SCR-002 out-of-range dimensions are clamped and reported', async () => {
  const llm = fakeLlm({ replies: [SCORE_OUT_OF_RANGE] })
  const { score, warnings } = await scoreAnswer({
    item: ITEM_SKILL,
    answer: '随便说说。',
    difficulty: 'mid',
    complete: llm.complete,
  })
  for (const value of Object.values(score.dims)) {
    assert.ok(Number.isInteger(value) && value >= 1 && value <= 5, `dimension ${value} escapes 1..5`)
  }
  assert.equal(score.dims.correctness, 5)
  assert.equal(score.dims.depth, 1)
  assert.equal(score.dims.communication, 1)
  assert.ok(warnings.length >= 1)
})

test('TC-SCR-003 a reply without evidence is invalid and is retried once', async () => {
  const llm = fakeLlm({ replies: [SCORE_NO_EVIDENCE, SCORE_VALID] })
  const { score } = await scoreAnswer({
    item: ITEM_SKILL,
    answer: '缓存穿透用布隆过滤器挡。',
    difficulty: 'mid',
    complete: llm.complete,
  })
  assert.equal(llm.calls.length, 2)
  assert.ok(score.evidence.length >= 1)
})

test('TC-SCR-004 two unparsable replies fail with E_SCORE_INVALID and nothing is stored', async () => {
  const llm = fakeLlm({ replies: ['不是 JSON', '也不是 {' ] })
  const store = { writes: 0 }
  await assert.rejects(
    () =>
      scoreAnswer({
        item: ITEM_SKILL,
        answer: '缓存一致性用双删。',
        difficulty: 'mid',
        complete: llm.complete,
        onScore: () => {
          store.writes += 1
        },
      }),
    { code: 'E_SCORE_INVALID' },
  )
  assert.equal(llm.calls.length, 2)
  assert.equal(store.writes, 0)
})

test('TC-SCR-005 a missing dimension becomes null with a warning, not a failure', async () => {
  const llm = fakeLlm({ replies: [SCORE_MISSING_DIM] })
  const { score, warnings } = await scoreAnswer({
    item: ITEM_SKILL,
    answer: '缓存雪崩加随机过期时间。',
    difficulty: 'mid',
    complete: llm.complete,
  })
  assert.equal(score.dims.communication, null)
  assert.equal(Object.keys(score.dims).length, DIMS.length)
  assert.ok(warnings.some((warning) => warning.includes('communication')))
})