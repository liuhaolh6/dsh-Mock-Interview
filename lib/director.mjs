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
 * @param {{ answer: string, alreadyProbed?: boolean, emptyStreak?: number }} input
 * @returns {{ asked: boolean, reason: string, skip?: boolean }}
 */
export function decideProbe(input) {
  const { answer = '', alreadyProbed = false, emptyStreak = 0 } = input ?? {}
  if (alreadyProbed) return { asked: false, reason: '' }

  const text = String(answer).trim()

  // Two blanks in a row is not a shallow answer any more — it is a stuck
  // candidate. Probing the same question a third time wastes the slot, so the
  // run moves on and the report keeps the zero.
  if (text === '' && emptyStreak >= 2) {
    return { asked: false, reason: '', skip: true }
  }

  const verdict = shallowness(text)
  return verdict === '' ? { asked: false, reason: '' } : { asked: true, reason: verdict }
}

/** An answer long enough to contain a mechanism usually explains itself. */
const SHALLOW_CHARS = 30

function shallowness(text) {
  if (text === '') return '考生没有作答，需要先问清楚是卡在概念上还是没听清题目'
  if (text.length < SHALLOW_CHARS) return '回答只有结论，没有展开机制和取舍，需要一个追问把过程逼出来'
  return ''
}