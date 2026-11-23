/**
 * Scoring fixtures: one well-formed model reply, plus the malformed variants
 * the scorer must survive (contract §2.4, AC-4).
 */

export const DIMS = ['correctness', 'depth', 'structure', 'project', 'code', 'communication']

export const SCORE_VALID = JSON.stringify({
  dims: { correctness: 3, depth: 2, structure: 3, project: 4, code: 0, communication: 3 },
  evidence: ['考生说「缓存就是存热点数据」'],
  missing: ['缺：缓存穿透/雪崩的应对'],
  reference: ['多级缓存', '一致性策略'],
})

export const SCORE_OUT_OF_RANGE = JSON.stringify({
  dims: { correctness: 7, depth: 0, structure: 3, project: 3, code: 3, communication: -1 },
  evidence: ['考生说「背了八股」'],
  missing: [],
  reference: [],
})

export const SCORE_NO_EVIDENCE = JSON.stringify({
  dims: { correctness: 3, depth: 3, structure: 3, project: 3, code: 3, communication: 3 },
  evidence: [],
  missing: [],
  reference: [],
})

export const SCORE_MISSING_DIM = JSON.stringify({
  dims: { correctness: 3, depth: 3, structure: 3, project: 3, code: 3 },
  evidence: ['考生讲清了主流程'],
  missing: [],
  reference: [],
})

export const ITEM_SKILL = { id: 'q1', kind: 'skill', topic: 'JVM GC', target: 'skill:Java' }
/** A well-formed static review (D3): verdict, five cases, six dims, evidence. */
export const REVIEW_OK = {
  verdict: 'presumed-correct',
  cases: [
    { input: 'head = null', expected: 'null', actual: 'null', ok: true },
    { input: 'head = [1]', expected: '[1]', actual: '[1]', ok: true },
    { input: 'head = [1,2]', expected: '[2,1]', actual: '[2,1]', ok: true },
    { input: 'head = [1,2,3]', expected: '[3,2,1]', actual: '[3,2,1]', ok: true },
    { input: 'head has 10^4 nodes', expected: 'O(n) time, O(1) space', actual: 'O(n) time, O(1) space', ok: true },
  ],
  dims: { correctness: 4, depth: 3, structure: 4, project: 2, code: 4, communication: 3 },
  evidence: ['用三指针就地反转，没有新建节点', '空表与单节点都在开头处理了'],
  missing: ['没有说明并发场景下的可见性'],
  reference: ['先保存 next，再改指针，最后整体前移'],
}
