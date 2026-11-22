/**
 * The interviewer's voice (contract §3.6 `next.type`, AC-3).
 *
 * Two jobs: turn a plan item into a spoken prompt in the right register, and
 * decide whether the last answer was thin enough to warrant one probe. Both are
 * deterministic on purpose — the probe decision must be reproducible in tests
 * and must never depend on a model round-trip.
 *
 * @module lib/director
 */

/** How each difficulty level is asked, not what is asked. */
export const DIFFICULTY_TAGS = {
  junior: '先讲清楚概念和用法',
  mid: '讲清机制、取舍和边界',
  senior: '讲清架构权衡、故障场景和演进',
}

/**
 * @param {{ item: { id: string, kind: string, topic?: string, target: string }, difficulty: string }} input
 * @returns {string}
 */
export function composePrompt(input) {
  const { item, difficulty = 'mid' } = input ?? {}
  const tag = DIFFICULTY_TAGS[difficulty]
  if (tag === undefined) {
    throw new Error(`unknown difficulty: ${difficulty}`)
  }
  const topic = item?.topic || targetLabel(item?.target) || '你简历里的项目'
  const shape = SHAPES[item?.kind] ?? SHAPES.knowledge
  return `${tag}：请就「${topic}」${shape}`
}

const SHAPES = {
  skill: '讲一遍你的理解，并给一个你踩过的坑。',
  project: '说明你负责的部分、关键决定，以及当时为什么这么选。',
  code: '在白板上写出实现，并说明边界条件。',
  behavior: '用 STAR 讲一件具体的事，别讲原则。',
  knowledge: '讲一遍你的理解。',
}

/** `skill:Java` → `Java`; `project:订单中心` → `订单中心`. */
function targetLabel(target) {
  if (typeof target !== 'string') return ''
  const [, name = ''] = target.split(':')
  return name.trim()
}

/**
 * @param {{ answer: string, alreadyProbed?: boolean }} input
 * @returns {{ asked: boolean, reason: string }}
 */
export function decideProbe(input) {
  void input
  throw new Error('not implemented yet: decideProbe (G4)')
}