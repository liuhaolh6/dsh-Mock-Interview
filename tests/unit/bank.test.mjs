import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { loadBank, rankByStack, resetBankCache, stackOf, DEFAULT_BANK_PATH } from '../../lib/bank.mjs'
import { buildPlan } from '../../lib/session.mjs'
import { PROFILE_CONFIRMED } from '../fixtures/resume.mjs'

// TC-BNK-001: the external bank is a straight port of the v0.1 constant, in the
// same order — otherwise every existing plan would silently reshuffle.
test('TC-BNK-001 bank file keeps the v0.1 order and kinds', async () => {
  resetBankCache()
  const topics = await loadBank()
  assert.deepEqual(
    topics.map((entry) => entry.topic),
    [
      'JVM 内存模型',
      'GC 分代与调优',
      '集合源码',
      '并发包',
      'MySQL 索引与执行计划',
      '事务隔离级别',
      'Redis 数据结构与持久化',
      '缓存穿透雪崩',
      '分布式锁',
      '消息队列幂等',
      '微服务拆分边界',
      '接口幂等设计',
      '线上故障排查',
      '限流降级',
      '代码可测试性',
      '系统设计：秒杀',
      '系统设计：短链',
      '算法：链表',
      '算法：二叉树',
      '算法：动态规划',
    ],
  )
  assert.deepEqual(
    topics.filter((entry) => entry.kind === 'code').map((entry) => entry.topic),
    ['算法：链表', '算法：二叉树', '算法：动态规划'],
  )
  assert.ok(topics.every((entry) => entry.keywords.length > 0))
})

// TC-BNK-002: a broken deployment fails loudly with the path in the message.
test('TC-BNK-002 missing or corrupt bank file is E_INTERNAL and names the path', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bank-'))
  try {
    const missing = join(dir, 'nope.json')
    await assert.rejects(() => loadBank({ path: missing }), (problem) => {
      assert.equal(problem.code, 'E_INTERNAL')
      assert.match(problem.message, /题库文件不可用/)
      assert.ok(problem.message.includes(missing))
      return true
    })

    const corrupt = join(dir, 'broken.json')
    await writeFile(corrupt, '{ "topics": [ ] }', 'utf8')
    await assert.rejects(() => loadBank({ path: corrupt }), (problem) => {
      assert.equal(problem.code, 'E_INTERNAL')
      assert.match(problem.message, /没有 topics/)
      return true
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// TC-BNK-003: a Redis-heavy profile gets Redis questions before JVM ones, and
// the planner actually reaches into the ranked bank.
test('TC-BNK-003 stack keywords rank the bank and reach the plan', async () => {
  const topics = [
    { topic: 'JVM 内存模型', kind: 'skill', keywords: ['java', 'jvm'] },
    { topic: 'Redis 数据结构与持久化', kind: 'skill', keywords: ['redis', '缓存'] },
  ]
  const ranked = rankByStack(topics, ['Redis'])
  assert.equal(ranked[0].topic, 'Redis 数据结构与持久化')

  const profile = {
    skills: ['Redis'],
    projects: [],
    jd: { title: '后端工程师' },
  }
  const plan = await buildPlan({ profile, mode: 'tech-1', difficulty: 'mid', minutes: 30 })
  const bankTargets = plan.items.map((item) => item.target).filter((target) => target.startsWith('bank:'))
  assert.ok(bankTargets.length > 0)
  // Cache questions score highest for a Redis candidate; the exact topic inside
  // that family is the bank's business, not the test's.
  assert.match(bankTargets[0], /Redis|缓存/, `first bank target should be cache-related, got ${bankTargets[0]}`)
})

// TC-BNK-004: an unknown stack keeps the bank's own order and the full budget.
test('TC-BNK-004 unrelated stack keeps bank order and the full question budget', async () => {
  const profile = { skills: ['Cobol'], projects: [], jd: { title: 'Mainframe Engineer' } }
  const plan = await buildPlan({ profile, mode: 'tech-1', difficulty: 'junior', minutes: 15 })
  assert.equal(plan.items.length, 5)
  const bankTargets = plan.items.map((item) => item.target).filter((target) => target.startsWith('bank:'))
  assert.deepEqual(bankTargets.slice(0, 3), [
    'bank:JVM 内存模型',
    'bank:GC 分代与调优',
    'bank:集合源码',
  ])
})

// TC-BNK-005: stackOf only picks strings, and trims them.
test('TC-BNK-005 stackOf collects skills, JD and project highlights', () => {
  assert.deepEqual(stackOf(PROFILE_CONFIRMED), [
    'Java',
    'Spring Boot',
    'MySQL',
    'Redis',
    'JVM',
    '分布式事务',
    'Java 后端',
    '某厂',
    'QPS 3k',
    '库存扣减',
    '每日千万级流水',
  ])
  assert.deepEqual(stackOf(undefined), [])
})

// TC-DIR-006: two blanks in a row skip instead of probing a third time.
test('TC-DIR-006 repeated empty answers skip the question', async () => {
  const { decideProbe } = await import('../../lib/director.mjs')
  assert.deepEqual(decideProbe({ answer: '', emptyStreak: 2 }), { asked: false, reason: '', skip: true })
  assert.deepEqual(decideProbe({ answer: '   ', emptyStreak: 3 }), { asked: false, reason: '', skip: true })
  assert.deepEqual(decideProbe({ answer: '', emptyStreak: 1 }), {
    asked: true,
    reason: '考生没有作答，需要先问清楚是卡在概念上还是没听清题目',
  })
  assert.deepEqual(decideProbe({ answer: '因为加锁', emptyStreak: 0 }), {
    asked: true,
    reason: '回答只有结论，没有展开机制和取舍，需要一个追问把过程逼出来',
  })
  const long =
    '因为我们用了本地缓存加分布式锁，锁的粒度是商品维度，库存扣减走 Redis 原子操作，失败回滚用补偿任务兜底'
  assert.deepEqual(decideProbe({ answer: long, emptyStreak: 5 }), { asked: false, reason: '' })
  assert.ok(DEFAULT_BANK_PATH.endsWith('bank.json'))
})
// TC-BNK-006: a deployment can point at its own bank file (custom questions, or
// a company-specific set) without patching the plugin.
test('TC-BNK-006 buildPlan honours a custom bank path', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bank-custom-'))
  try {
    const custom = join(dir, 'bank.json')
    await writeFile(
      custom,
      JSON.stringify({
        version: 1,
        topics: [
          { id: 'k8s', topic: 'Kubernetes 调度', kind: 'skill', keywords: ['k8s', 'kubernetes'] },
          { id: 'algo', topic: '算法：二分', kind: 'code', keywords: ['算法'] },
        ],
      }),
      'utf8',
    )
    const plan = await buildPlan(
      { profile: { skills: ['Kubernetes'], projects: [], jd: { title: '平台工程师' } }, mode: 'tech-1', difficulty: 'mid', minutes: 15 },
      { bank: custom },
    )
    assert.equal(plan.items.length, 5)
    assert.ok(plan.items.every((item) => typeof item.target === 'string'))
    // 契约变更（v0.4 返修）：手撕题固定收尾——原先「谁落在最后一格就把谁标成
    // code」，会把 Kubernetes 调度这种理论题配上手写代码编辑器。
    assert.equal(plan.items.at(-1).kind, 'code')
    assert.equal(plan.items.at(-1).target, 'bank:算法：二分', 'the code topic closes the run')
    assert.deepEqual(
      [...new Set(plan.items.map((item) => item.target))].sort(),
      ['bank:Kubernetes 调度', 'bank:算法：二分', 'skill:Kubernetes'],
      'every target of the custom bank still shows up exactly once as a distinct target',
    )
    assert.deepEqual(
      plan.items.find((item) => item.target === 'bank:Kubernetes 调度').kind,
      'skill',
      'a theory topic stays a skill question',
    )
    assert.deepEqual(
      plan.items.find((item) => item.target === 'bank:算法：二分').kind,
      'code',
      'a bank topic declared as code must become a whiteboard question',
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
