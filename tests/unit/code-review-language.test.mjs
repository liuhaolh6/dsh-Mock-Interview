import assert from 'node:assert/strict'
import test from 'node:test'

import {
  GENERIC_HINTS,
  LANGUAGE_HINTS,
  LANGUAGES,
  buildReviewPrompt,
  resolveLanguage,
  reviewCode,
} from '../../lib/code-review.mjs'
import { fakeLlm } from '../helpers/fake-llm.mjs'
import { REVIEW_OK } from '../fixtures/score.mjs'

// D3: 同一道题用 Java 和 Go 提，检查点必须跟着语言走，而不是套同一段泛泛而谈。

const ITEM = { id: 'q-9', kind: 'code', topic: '算法：链表反转', target: 'bank:算法：链表反转' }

function promptFor(language) {
  return buildReviewPrompt({ item: ITEM, code: 'func solve(){}\n', language })
}

test('TC-COD-207 a review asks for a bigger output budget and a bounded shape', async () => {
  const calls = []
  const complete = async (options) => {
    calls.push(options)
    return JSON.stringify(REVIEW_OK)
  }
  const reviewed = await reviewCode({
    item: { id: 'q-1', kind: 'code', topic: '算法：LRU', target: 'bank:算法：LRU' },
    code: 'class LRU {}',
    language: 'java',
    complete,
  })
  assert.equal(reviewed.cases.length, 5)
  // 5 条用例 + 六维 + 证据 + 参考解，4 096 真机实测会被写完（截断 = E_LLM_UNAVAILABLE）。
  assert.ok(
    typeof calls[0].maxTokens === 'number' && calls[0].maxTokens >= 6_000,
    `expected a review-specific budget, got ${calls[0].maxTokens}`,
  )
  // 光加预算不够：还得压住模型的篇幅，否则重试一次仍然截断。
  assert.match(calls[0].system, /不要代码块/, 'expected the prompt to forbid code blocks')
  assert.match(calls[0].system, /不超过/, 'expected per-field length caps')
})

test('TC-COD-201 each supported language gets its own checklist instead of a generic one', () => {
  assert.deepEqual([...LANGUAGES], ['java', 'python', 'javascript', 'go', 'c++', 'sql'])

  const seen = new Set()
  for (const language of LANGUAGES) {
    const hint = LANGUAGE_HINTS[language]
    assert.ok(hint, `${language} 必须有自己的检查点`)
    assert.ok(hint.label.length > 0, `${language} 要有可显示的标签`)
    assert.ok(hint.checklist.length >= 3, `${language} 至少 3 条检查点，实际 ${hint.checklist.length}`)
    assert.ok(hint.caseStyle.length > 0, `${language} 要给边界用例的语言习惯`)
    const key = hint.checklist.join('|')
    assert.equal(seen.has(key), false, `${language} 的检查点不能与其它语言完全一样`)
    seen.add(key)
  }
})

test('TC-COD-202 the checklist of a language actually reaches the model', () => {
  const java = promptFor('java').system
  assert.match(java, /java/i)
  assert.match(java, /null|NullPointer|空指针/i, 'Java 必须提醒空引用')
  assert.match(java, /int|溢出|overflow/i, 'Java 必须提醒整数溢出')

  const go = promptFor('go').system
  assert.match(go, /nil|goroutine|defer/i, 'Go 必须提醒 nil / goroutine / defer')

  const sql = promptFor('sql').system
  assert.match(sql, /NULL|索引|事务|index/i, 'SQL 必须提醒 NULL / 索引 / 事务')
})

test('TC-COD-203 the user message asks for cases in that language and names the language', () => {
  const python = promptFor('python')
  assert.match(python.user, /python/i)
  assert.match(python.user, /None|可变默认参数|列表/, 'python 的用例要按该语言习惯构造')

  const cpp = promptFor('c++')
  assert.match(cpp.user, /c\+\+/i)
  assert.match(cpp.user, /指针|越界|内存|UB/, 'C++ 的用例要指向内存与越界')
})

test('TC-COD-204 aliases resolve to one canonical language and unknown ones fall back', () => {
  assert.equal(resolveLanguage('Java').language, 'java')
  assert.equal(resolveLanguage('  JAVA ').language, 'java')
  assert.equal(resolveLanguage('js').language, 'javascript')
  assert.equal(resolveLanguage('JavaScript').language, 'javascript')
  assert.equal(resolveLanguage('py').language, 'python')
  assert.equal(resolveLanguage('golang').language, 'go')
  assert.equal(resolveLanguage('cpp').language, 'c++')
  assert.equal(resolveLanguage('C++11').language, 'c++')
  assert.equal(resolveLanguage('mysql').language, 'sql')
  assert.equal(resolveLanguage('postgresql').language, 'sql')

  const rust = resolveLanguage('rust')
  assert.equal(rust.language, 'generic', '没准备过的语言走通用检查点，而不是报错')
  assert.match(rust.note, /rust/)
  assert.equal(resolveLanguage(undefined).language, 'generic')
  assert.deepEqual(resolveLanguage(undefined).hint, GENERIC_HINTS)
})

test('TC-COD-205 the language is recorded as scoring evidence, not just in the prompt', async () => {
  const llm = fakeLlm({ replies: [JSON.stringify(REVIEW_OK)] })
  const { reviewCode } = await import('../../lib/code-review.mjs')
  const result = await reviewCode({ item: ITEM, code: 'int solve(){ return 1; }\n', language: 'Go', complete: llm.complete })

  assert.equal(result.language, 'go')
  assert.equal(result.executed, false)
  assert.ok(
    result.score.evidence.some((line) => /go/i.test(String(line))),
    `评分证据里要能看出按哪种语言评审：${JSON.stringify(result.score.evidence)}`,
  )
})

test('TC-COD-206 an unknown language still reviews, with a warning that it fell back', async () => {
  const llm = fakeLlm({ replies: [JSON.stringify(REVIEW_OK)] })
  const { reviewCode } = await import('../../lib/code-review.mjs')
  const result = await reviewCode({ item: ITEM, code: 'fn solve() {}\n', language: 'elixir', complete: llm.complete })

  assert.equal(result.language, 'generic')
  assert.ok(result.warnings.some((line) => /elixir/.test(line)), '回退必须说出来，不能静默')
  assert.equal(result.executed, false)
})