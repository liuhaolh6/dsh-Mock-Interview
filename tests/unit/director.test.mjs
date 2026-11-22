import assert from 'node:assert/strict'
import test from 'node:test'

import { DIFFICULTY_TAGS, composePrompt, decideProbe } from '../../lib/director.mjs'
import { buildPlan } from '../../lib/session.mjs'
import { scoreAnswer } from '../../lib/scorer.mjs'
import { PROFILE_CONFIRMED } from '../fixtures/resume.mjs'
import { ITEM_SKILL } from '../fixtures/score.mjs'

test('TC-DIR-001 each difficulty asks in its own register', () => {
  const prompts = ['junior', 'mid', 'senior'].map((difficulty) =>
    composePrompt({ item: ITEM_SKILL, difficulty }),
  )
  for (const [index, difficulty] of ['junior', 'mid', 'senior'].entries()) {
    assert.equal(prompts[index].includes(DIFFICULTY_TAGS[difficulty]), true, `${difficulty} tag missing`)
  }
  assert.equal(new Set(prompts).size, 3, 'the three difficulties produced identical wording')
})

test('TC-DIR-002 a 45-minute run never asks the same target twice', async () => {
  const plan = await buildPlan({
    profile: PROFILE_CONFIRMED,
    mode: 'tech-1',
    difficulty: 'mid',
    minutes: 45,
  })
  const targets = plan.items.map((item) => item.target)
  assert.equal(targets.filter((target) => target === '').length, 0, 'some question has no target')
  assert.equal(new Set(targets).size, targets.length, `duplicate targets: ${targets.join(', ')}`)
})

test('TC-DIR-003 a conclusion-only answer triggers one probe with a stated reason', () => {
  const probe = decideProbe({ answer: '就是缓存', alreadyProbed: false })
  assert.equal(probe.asked, true)
  assert.equal(typeof probe.reason, 'string')
  assert.ok(probe.reason.length > 0)
})

test('TC-DIR-004 the same shallow answer is not probed a second time', () => {
  const probe = decideProbe({ answer: '就是缓存', alreadyProbed: true })
  assert.equal(probe.asked, false)
})

test('TC-DIR-005 an empty answer scores zero and asks once instead of throwing', async () => {
  const probe = decideProbe({ answer: '   ', alreadyProbed: false })
  assert.equal(probe.asked, true)

  let calls = 0
  const { score } = await scoreAnswer({
    item: ITEM_SKILL,
    answer: '   ',
    difficulty: 'mid',
    complete: async () => {
      calls += 1
      throw new Error('the model must not be asked to grade nothing')
    },
  })
  assert.equal(calls, 0)
  assert.equal(score.overall, 0)
  assert.deepEqual(Object.values(score.dims), [0, 0, 0, 0, 0, 0])
})