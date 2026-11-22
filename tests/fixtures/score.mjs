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