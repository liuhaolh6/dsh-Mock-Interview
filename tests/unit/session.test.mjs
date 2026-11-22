import assert from 'node:assert/strict'
import test from 'node:test'

import { buildPlan } from '../../lib/session.mjs'
import { PROFILE_CONFIRMED, PROFILE_EMPTY } from '../fixtures/resume.mjs'

const BASE = { profile: PROFILE_CONFIRMED, mode: 'tech-1', difficulty: 'mid', minutes: 30 }

test('TC-SES-001 a 30-minute run budgets 9 questions within the ±2 tolerance', async () => {
  const plan = await buildPlan({ ...BASE })
  assert.equal(plan.budget, 9)
  assert.ok(plan.items.length >= 7 && plan.items.length <= 11, `got ${plan.items.length} items`)
})

test('TC-SES-002 an unsupported duration is rejected', async () => {
  await assert.rejects(() => buildPlan({ ...BASE, minutes: 20 }), { code: 'E_BAD_REQUEST' })
})

test('TC-SES-003 a profile without skills and projects cannot start a run', async () => {
  await assert.rejects(() => buildPlan({ ...BASE, profile: PROFILE_EMPTY }), { code: 'E_PROFILE_INCOMPLETE' })
})

test('TC-SES-004 every run contains at least one hands-on code question', async () => {
  const plan = await buildPlan({ ...BASE })
  assert.equal(plan.items.some((item) => item.kind === 'code'), true)
})

test('TC-SES-005 at least three questions target the candidate own skills or projects', async () => {
  const plan = await buildPlan({ ...BASE })
  const targets = plan.items.map((item) => item.target).filter((target) => typeof target === 'string')
  const owned = targets.filter((target) => {
    const [kind, name] = target.split(':')
    if (kind === 'skill') return PROFILE_CONFIRMED.skills.some((skill) => target.includes(skill.toLowerCase()) || name === skill)
    if (kind === 'project') return PROFILE_CONFIRMED.projects.some((project) => target.includes(project.name))
    return false
  })
  assert.ok(owned.length >= 3, `only ${owned.length} targeted questions: ${targets.join(', ')}`)
})

test('TC-SES-006 an unknown interview mode is rejected', async () => {
  await assert.rejects(() => buildPlan({ ...BASE, mode: 'hr' }), { code: 'E_BAD_REQUEST' })
})