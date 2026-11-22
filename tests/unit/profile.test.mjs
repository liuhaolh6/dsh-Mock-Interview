import assert from 'node:assert/strict'
import test from 'node:test'

import { extractProfile } from '../../lib/profile.mjs'
import { fakeLlm } from '../helpers/fake-llm.mjs'
import { RESUME_JAVA, JD_JAVA_BACKEND } from '../fixtures/resume.mjs'

const VALID_PROFILE = JSON.stringify({
  skills: ['Java', 'Spring Boot', 'MySQL'],
  years: 3,
  level: 'mid',
  projects: [{ name: '订单中心', role: '后端', highlights: ['QPS 3k'] }],
  jd: { title: 'Java 后端', company: '某厂', level: 'mid' },
})

test('TC-PRO-001 a resume with a JD becomes a structured profile', async () => {
  const llm = fakeLlm({ replies: [VALID_PROFILE] })
  const { profile, warnings } = await extractProfile(
    { resumeText: RESUME_JAVA, jdText: JD_JAVA_BACKEND },
    { complete: llm.complete },
  )
  assert.deepEqual(profile.skills, ['Java', 'Spring Boot', 'MySQL'])
  assert.equal(profile.years, 3)
  assert.equal(profile.projects.length, 1)
  assert.equal(profile.jd.level, 'mid')
  assert.deepEqual(warnings, [])
  assert.equal(llm.calls.length, 1)
})

test('TC-PRO-002 blank resume and blank JD are rejected before any LLM call', async () => {
  const llm = fakeLlm({ replies: [VALID_PROFILE] })
  await assert.rejects(
    () => extractProfile({ resumeText: '   ', jdText: '' }, { complete: llm.complete }),
    { code: 'E_BAD_REQUEST' },
  )
  assert.equal(llm.calls.length, 0)
})

test('TC-PRO-003 two unparsable replies end in E_PROFILE_INVALID after exactly one retry', async () => {
  const llm = fakeLlm({ replies: ['not json at all', 'still { not json'] })
  await assert.rejects(
    () => extractProfile({ resumeText: RESUME_JAVA, jdText: JD_JAVA_BACKEND }, { complete: llm.complete }),
    { code: 'E_PROFILE_INVALID' },
  )
  assert.equal(llm.calls.length, 2)
})

test('TC-PRO-004 a timeout from the LLM surfaces as E_LLM_TIMEOUT', async () => {
  const llm = fakeLlm({ error: Object.assign(new Error('timed out'), { name: 'AbortError' }) })
  await assert.rejects(
    () => extractProfile({ resumeText: RESUME_JAVA, jdText: JD_JAVA_BACKEND }, { complete: llm.complete }),
    { code: 'E_LLM_TIMEOUT' },
  )
})

test('TC-PRO-005 an over-long resume is rejected without calling the LLM', async () => {
  const llm = fakeLlm({ replies: [VALID_PROFILE] })
  await assert.rejects(
    () => extractProfile({ resumeText: 'x'.repeat(20_001), jdText: JD_JAVA_BACKEND }, { complete: llm.complete }),
    { code: 'E_BAD_REQUEST' },
  )
  assert.equal(llm.calls.length, 0)
})

test('TC-PRO-006 a title-only JD still yields a profile, with a warning about the gaps', async () => {
  const llm = fakeLlm({ replies: [VALID_PROFILE] })
  const { profile, warnings } = await extractProfile(
    { resumeText: RESUME_JAVA, jd: { title: 'Java 后端' } },
    { complete: llm.complete },
  )
  assert.equal(profile.jd.title, 'Java 后端')
  assert.equal(warnings.length > 0, true)
  assert.match(warnings.join(''), /公司|级别/)
})