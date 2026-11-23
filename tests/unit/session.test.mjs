import assert from 'node:assert/strict'
import test from 'node:test'

import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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

// 真机验证时抓到：最后一道题被无条件改成 kind='code'，但靶子是 skill:MySQL，
// 于是面板会给一道 MySQL 理论题配手写代码编辑器。kind 必须与靶子一致。
function kindOfTarget(target) {
  if (typeof target !== 'string') return 'unknown'
  if (target.startsWith('skill:')) return 'skill'
  if (target.startsWith('project:')) return 'project'
  return 'bank'
}

async function bankFile(topics) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-mi-ses-'))
  const path = join(dir, 'bank.json')
  await writeFile(path, JSON.stringify({ version: 1, topics }, null, 2), 'utf8')
  return path
}

test('TC-SES-008 a skill target is never relabelled as a code question', async () => {
  // 简历题多于预算、题库里没有手撕题：最容易踩到「最后一格强行变 code」。
  const path = await bankFile([{ topic: '自定：Redis 大 Key 怎么拆', kind: 'skill' }])
  const plan = await buildPlan({ ...BASE, minutes: 15 }, { bank: path })
  for (const item of plan.items) {
    const kind = kindOfTarget(item.target)
    if (kind === 'skill' || kind === 'project') {
      assert.equal(item.kind, kind, `${item.target} 被标成了 ${item.kind}`)
    }
  }
})

test('TC-SES-009 a bank without code topics still yields one real hands-on question', async () => {
  const path = await bankFile([{ topic: '自定：Redis 大 Key 怎么拆', kind: 'skill' }])
  const plan = await buildPlan({ ...BASE, minutes: 15 }, { bank: path })
  const code = plan.items.filter((item) => item.kind === 'code')
  assert.equal(code.length, 1, `expected exactly one code question, got ${code.length}`)
  assert.equal(plan.items.at(-1).kind, 'code', 'the hands-on question still closes the run')
  assert.match(code[0].target, /^bank:/, 'the code question must come from a real code topic')
  assert.match(code[0].topic, /算法/, 'packaged code topics are the fallback, not a theory question')
})

test('TC-SES-010 a bank that ships its own code topic uses it instead of the packaged one', async () => {
  const path = await bankFile([{ topic: '自定：手写 LFU 缓存', kind: 'code' }])
  const plan = await buildPlan({ ...BASE, minutes: 15 }, { bank: path })
  const code = plan.items.filter((item) => item.kind === 'code')
  assert.equal(code.length, 1)
  assert.equal(code[0].target, 'bank:自定：手写 LFU 缓存')
})