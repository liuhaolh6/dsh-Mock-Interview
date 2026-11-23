import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  customBankPath,
  readCustomBank,
  removeCustomBank,
  resolveBank,
  validateBank,
  writeCustomBank,
} from '../../lib/bank.mjs'
import { isContractError } from '../../lib/errors.mjs'

// D4: 用户能带自己的题库来面，宿主负责校验、落盘、并在题库坏掉时退回内置。

const GOOD = {
  version: 1,
  topics: [
    { id: 'custom-1', topic: '自定：分布式事务 TCC', kind: 'skill', keywords: ['分布式', '事务'] },
    { id: 'custom-2', topic: '自定：项目里的灰度发布', kind: 'project', keywords: ['灰度', '发布'] },
    { id: 'custom-3', topic: '自定：LRU 缓存手写', kind: 'code', keywords: ['LRU', '缓存'] },
  ],
}

function tmpHome() {
  return mkdtemp(join(tmpdir(), 'dsh-mi-bank-'))
}

test('TC-BNK-201 a well-formed custom bank validates and keeps its order and kinds', () => {
  const { topics, warnings } = validateBank(GOOD)
  assert.deepEqual(warnings, [])
  assert.equal(topics.length, 3)
  assert.deepEqual(
    topics.map((entry) => entry.topic),
    ['自定：分布式事务 TCC', '自定：项目里的灰度发布', '自定：LRU 缓存手写'],
  )
  assert.deepEqual(
    topics.map((entry) => entry.kind),
    ['skill', 'project', 'code'],
  )
  assert.deepEqual(topics[2].keywords, ['LRU', '缓存'])
})

test('TC-BNK-202 a structurally broken bank says which part is wrong', () => {
  const cases = [
    ['不是对象', '字符串'],
    [{ version: 1 }, /topics/],
    [{ topics: [] }, /一条/],
    [{ topics: 'abc' }, /topics/],
  ]
  for (const [raw, expected] of cases) {
    assert.throws(
      () => validateBank(raw),
      (problem) => {
        assert.ok(isContractError(problem), `${JSON.stringify(raw)} 必须抛 ContractError`)
        assert.equal(problem.code, 'E_BAD_REQUEST')
        if (expected instanceof RegExp) assert.match(problem.message, expected)
        return true
      },
    )
  }
})

test('TC-BNK-203 per-entry faults name the entry index and drop only the bad keyword', () => {
  assert.throws(
    () => validateBank({ topics: [{ topic: 'ok' }, { kind: 'code' }] }),
    (problem) => {
      assert.equal(problem.code, 'E_BAD_REQUEST')
      assert.match(problem.message, /第 2 条/)
      assert.match(problem.message, /topic/)
      return true
    },
  )
  assert.throws(
    () => validateBank({ topics: [{ topic: 'x', kind: 'essay' }] }),
    (problem) => {
      assert.match(problem.message, /第 1 条/)
      assert.match(problem.message, /kind/)
      assert.match(problem.message, /skill/)
      return true
    },
  )
  assert.throws(
    () => validateBank({ topics: [{ topic: '超长'.repeat(200) }] }),
    (problem) => {
      assert.match(problem.message, /topic/)
      return true
    },
  )

  const lenient = validateBank({
    topics: [{ topic: '宽松条目', keywords: ['ok', 42, '  ', 'keep'] }],
  })
  assert.deepEqual(lenient.topics[0].keywords, ['ok', 'keep'], '非法关键字丢掉，合法保留')
  assert.ok(lenient.warnings.some((line) => /关键字/.test(line)), '丢掉东西要说明')
})

test('TC-BNK-204 an over-long bank is refused instead of silently truncated', () => {
  const topics = Array.from({ length: 200 }, (_unused, index) => ({ topic: `题 ${index + 1}` }))
  assert.throws(
    () => validateBank({ topics }),
    (problem) => {
      assert.equal(problem.code, 'E_BAD_REQUEST')
      assert.match(problem.message, /120/)
      return true
    },
  )
})

test('TC-BNK-205 the custom bank round-trips on disk and a corrupt one falls back to the built-in', async () => {
  const home = await tmpHome()
  const path = customBankPath(home)
  assert.match(path.replaceAll('\\', '/'), /storages\/dsh-mock-interview\/bank\.json$/)

  assert.equal(await readCustomBank({ home }), null, '还没存过就是 null')

  await writeCustomBank({ home, bank: GOOD })
  const stored = JSON.parse(await readFile(path, 'utf8'))
  assert.equal(stored.topics.length, 3)
  const back = await readCustomBank({ home })
  assert.equal(back.topics.length, 3)

  const active = await resolveBank({ home })
  assert.equal(active.source, 'custom')
  assert.equal(active.topics.length, 3)

  // 手工改坏（我们的写入口不会产出这种文件）→ 回退内置，但必须说出来。
  await writeFile(path, '{ "topics": [ ', 'utf8')
  const fallback = await resolveBank({ home })
  assert.equal(fallback.source, 'default')
  assert.ok(fallback.topics.length >= 20)
  assert.ok(fallback.warning, '回退内置要有 warning，不能静默')

  assert.equal(await removeCustomBank({ home }), true)
  assert.equal(await removeCustomBank({ home }), false, '删两次第二次返回 false')
  assert.equal((await resolveBank({ home })).source, 'default')
})

test('TC-BNK-206 writing validates first, so a bad bank never reaches disk', async () => {
  const home = await tmpHome()
  await assert.rejects(
    () => writeCustomBank({ home, bank: { topics: [{ kind: 'code' }] } }),
    (problem) => {
      assert.equal(problem.code, 'E_BAD_REQUEST')
      return true
    },
  )
  assert.equal(await readCustomBank({ home }), null)
})