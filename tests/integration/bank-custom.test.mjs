import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { dispatch, RPC_PATH } from '../../index.js'
import { customBankPath } from '../../lib/bank.mjs'
import { PROFILE_CONFIRMED } from '../fixtures/resume.mjs'

// D4: 用户粘贴自己的题库 → 校验 → 落盘 → 新建面试就从这份题库出题。

const URL_BASE = 'http://localhost' + RPC_PATH
const START = { op: 'session/create', profile: PROFILE_CONFIRMED, mode: 'tech-1', difficulty: 'mid', minutes: 15 }

const CUSTOM = {
  version: 1,
  topics: [
    { id: 'c1', topic: '自定：分布式事务 TCC', kind: 'skill', keywords: ['分布式'] },
    { id: 'c2', topic: '自定：灰度发布预案', kind: 'project', keywords: ['灰度'] },
    { id: 'c3', topic: '自定：LRU 手写', kind: 'code', keywords: ['LRU'] },
  ],
}

async function call(body, deps) {
  const response = await dispatch(
    new Request(URL_BASE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    deps,
  )
  assert.equal(response.status, 200)
  return response.json()
}

test('TC-BNK-210 a saved custom bank becomes the bank the next run draws from', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-mock-interview-d4-'))

  const checked = await call({ op: 'bank/validate', bank: CUSTOM }, { home })
  assert.equal(checked.ok, true)
  assert.equal(checked.value.count, 3)
  assert.equal(checked.value.kinds.code, 1)

  const saved = await call({ op: 'bank/save', bank: CUSTOM }, { home })
  assert.equal(saved.ok, true)
  assert.equal(saved.value.count, 3)
  assert.equal(JSON.parse(await readFile(customBankPath(home), 'utf8')).topics.length, 3)

  const info = await call({ op: 'bank/get' }, { home })
  assert.equal(info.value.custom.exists, true)
  assert.equal(info.value.custom.count, 3)
  assert.equal(info.value.active.source, 'custom')

  const created = await call(START, { home })
  assert.equal(created.ok, true)
  assert.equal(created.value.plan.bankSource, 'custom')
  // 3 题的小题库要撑起 5 道题：循环取，不能出现 undefined 或跑到内置题库里去。
  const topics = created.value.plan.items.map((item) => item.topic)
  assert.equal(topics.length, 5)
  for (const topic of topics) assert.ok(topic.length > 0)
  assert.ok(topics.some((topic) => topic.includes('自定：')), `题面应来自自定义题库：${topics.join(' / ')}`)
  assert.equal(created.value.plan.items.at(-1).kind, 'code', '最后一道仍是手撕')

  const reset = await call({ op: 'bank/reset' }, { home })
  assert.equal(reset.value.removed, true)
  const after = await call({ op: 'bank/get' }, { home })
  assert.equal(after.value.custom.exists, false)
  assert.equal(after.value.active.source, 'default')

  await rm(home, { recursive: true, force: true })
})

test('TC-BNK-213 bank/save reports the kinds it actually stored', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-mi-save-'))
  const saved = await call({ op: 'bank/save', bank: CUSTOM }, { home })
  assert.equal(saved.ok, true)
  assert.equal(saved.value.count, 3)
  assert.deepEqual(saved.value.kinds, { skill: 1, project: 1, behavior: 0, code: 1 })
})

test('TC-BNK-211 a bad bank is refused by both validate and save, and nothing is written', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-mock-interview-d4-'))

  const broken = { topics: [{ kind: 'code' }] }
  const checked = await call({ op: 'bank/validate', bank: broken }, { home })
  assert.equal(checked.ok, false)
  assert.equal(checked.error.code, 'E_BAD_REQUEST')
  assert.match(checked.error.message, /第 1 条/)

  const saved = await call({ op: 'bank/save', bank: broken }, { home })
  assert.equal(saved.ok, false)
  assert.equal(saved.error.code, 'E_BAD_REQUEST')

  const info = await call({ op: 'bank/get' }, { home })
  assert.equal(info.value.custom.exists, false, '校验失败绝不能留下半个文件')

  await rm(home, { recursive: true, force: true })
})

test('TC-BNK-212 a hand-corrupted custom bank falls back to the built-in and says so', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-mock-interview-d4-'))
  await call({ op: 'bank/save', bank: CUSTOM }, { home })
  await writeFile(customBankPath(home), '{ "topics": [', 'utf8')

  const info = await call({ op: 'bank/get' }, { home })
  assert.equal(info.value.active.source, 'default')
  assert.ok(info.value.active.warning, '回退必须带 warning')

  const created = await call(START, { home })
  assert.equal(created.ok, true, '题库坏了不能把面试也一起拦住')
  assert.equal(created.value.plan.bankSource, 'default')

  await rm(home, { recursive: true, force: true })
})