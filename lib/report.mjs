import { mkdir, stat, writeFile } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'

import { applicableDims, DIMENSIONS } from './contracts.js'
import { ContractError } from './errors.mjs'

/**
 * Reporting: turn a finished session into a `Report` (contract §2), render it as
 * Markdown, and export it under the working directory.
 *
 * The rubric never executes candidate code (ADR-0004), so every report states
 * `codeVerified: false` and the export carries the same admission in text.
 *
 * @module lib/report
 */

/** What the candidate should do about a weak dimension, one line each. */
const ACTIONS = {
  correctness:
    '先把答案的「结论 + 依据」写成两句话再开口：结论是什么、凭什么成立。遇到不确定的概念，先给最小可验证的例子。',
  depth:
    '每个知识点准备三层：它是什么、它内部怎么实现、它在什么条件下会失效。追问「为什么不是另一个方案」时能立刻答上第二层。',
  structure:
    '用「背景 → 方案 → 取舍 → 风险」四段组织长回答，先说结论再展开，避免边想边说导致面试官听不出重点。',
  project:
    '把简历项目按「我负责什么 → 难点在哪 → 怎么量化效果」重写一遍，每个项目准备一条数据（QPS、延迟、覆盖率、故障次数）。',
  code:
    '手撕题先口述思路和复杂度，再落笔；写完主动报边界用例（空输入、单元素、重复值、越界），并把变量名改成能自解释的。',
  communication:
    '控制单次回答在 60 秒内，用「我先说结论，再补两点理由」开场；被打断时先确认问题再回答，不要抢话。',
}

const ROUND = 10

function round1(value) {
  return Math.round(value * ROUND) / ROUND
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function numbers(values) {
  return values.filter((value) => typeof value === 'number' && Number.isFinite(value))
}

/**
 * @param {object} session persisted session document
 * @returns {object} Report
 */
export function buildReport(session) {
  const turns = Array.isArray(session?.turns) ? session.turns : []
  const planItems = Array.isArray(session?.plan?.items) ? session.plan.items : []
  const itemOf = (id) => planItems.find((item) => item?.id === id)

  const items = turns.map((turn) => {
    const planned = itemOf(turn?.questionId)
    return {
      questionId: turn?.questionId ?? '',
      kind: planned?.kind ?? 'unknown',
      target: planned?.target ?? '',
      topic: planned?.topic ?? '',
      overall: typeof turn?.score?.overall === 'number' ? turn.score.overall : null,
      verdict: turn?.score?.verdict ?? 'unverifiable',
      missing: Array.isArray(turn?.score?.missing) ? turn.score.missing : [],
      // B4: a report you cannot study from is only a score. Keep the answer the
      // candidate actually gave, what the model said a good answer looks like,
      // and the evidence it quoted.
      inputMode: turn?.inputMode ?? 'text',
      answer: typeof turn?.answer === 'string' ? turn.answer : '',
      reference: Array.isArray(turn?.score?.reference) ? turn.score.reference : [],
      evidence: Array.isArray(turn?.score?.evidence) ? turn.score.evidence : [],
      cases: Array.isArray(turn?.cases) ? turn.cases : [],
      warnings: Array.isArray(turn?.warnings) ? turn.warnings : [],
      probe: turn?.probe ?? { asked: false, reason: '' },
    }
  })

  // A dimension only aggregates over the questions that could exercise it
  // (contract §2.4): a skill answer scored project:1 must not become a
  // "weak project skill" in the radar.
  const dims = {}
  for (const name of DIMENSIONS) {
    const measured = numbers(
      items.map((item, at) => (applicableDims(item.kind).includes(name) ? turns[at]?.score?.dims?.[name] : null)),
    )
    dims[name] = measured.length === 0 ? null : round1(mean(measured))
  }

  const scored = numbers(turns.map((turn) => turn?.score?.overall))
  const overall = scored.length === 0 ? null : round1(mean(scored))

  // Only measured dimensions can be called weak; a null is "not tested", not 0.
  const weaknesses = DIMENSIONS.map((name) => ({ dimension: name, average: dims[name] }))
    .filter((entry) => entry.average !== null)
    .sort((a, b) => a.average - b.average || DIMENSIONS.indexOf(a.dimension) - DIMENSIONS.indexOf(b.dimension))
    .slice(0, 3)
    .map((entry) => ({ ...entry, action: ACTIONS[entry.dimension] }))

  // §2 wants weakTop3 / actions as parallel string arrays plus a one-line
  // summary; the structured forms stay alongside them for the UI.
  const weakTop3 = weaknesses.map((entry) => entry.dimension)
  const actions = weaknesses.map((entry) => entry.action)

  return {
    sessionId: session?.id ?? '',
    summary: summarise({ mode: session?.mode, difficulty: session?.difficulty, answered: turns.length, planned: planItems.length, overall, weakTop3 }),
    radar: { dims },
    weakTop3,
    actions,
    codeVerified: false,
    // Additive fields (§2 addendum): the UI needs numbers, not prose.
    generatedAt: Date.now(),
    mode: session?.mode ?? '',
    difficulty: session?.difficulty ?? '',
    minutes: session?.minutes ?? 0,
    planned: planItems.length,
    answered: turns.length,
    // Fewer than three answers cannot support a "weakness" verdict.
    sampleAdequate: turns.length >= 3,
    overall,
    dims,
    items,
    weaknesses,
  }
}

function summarise({ mode, difficulty, answered, planned, overall, weakTop3 }) {
  if (answered === 0) return '本场没有作答记录，无法给出结论；建议至少完成 5 题再回看。'
  const score = overall === null ? '未评分' : overall.toFixed(1)
  const weak = weakTop3.length === 0 ? '暂无明显短板' : `最该补的是 ${weakTop3.join('、')}`
  return `${mode} 模式 / ${difficulty} 难度，作答 ${answered} / ${planned} 题，综合 ${score} 分；${weak}。`
}

/** @param {object} report */
export function renderMarkdown(report) {
  const lines = []
  const label = report.sampleAdequate ? '成绩单' : '成绩单（样本不足，仅供参考）'
  lines.push(`# 模拟面试${label}`, '')
  lines.push(`- 会话：\`${report.sessionId}\``)
  lines.push(`- 模式：${report.mode} · 难度：${report.difficulty} · 时长：${report.minutes} 分钟`)
  lines.push(`- 作答：${report.answered} / ${report.planned} 题`)
  lines.push(`- 综合得分：${report.overall === null ? '未评分' : report.overall.toFixed(1)} / 5.0`)
  if (report.summary) lines.push(`- 一句话：${report.summary}`)
  if (!report.sampleAdequate) {
    lines.push('', '> ⚠️ 样本不足：作答少于 3 题，维度结论仅供参考，请补足后再看趋势。')
  }
  lines.push('', '## 六维评分', '', '| 维度 | 平均分 |', '| --- | --- |')
  const dims = report.radar?.dims ?? report.dims ?? {}
  for (const name of DIMENSIONS) {
    const value = dims[name]
    lines.push(`| ${name} | ${value === null ? '未考察' : value.toFixed(1)} |`)
  }

  lines.push('', '## 逐题记录', '', '| 题目 | 类型 | 考察点 | 得分 | 判定 |', '| --- | --- | --- | --- | --- |')
  for (const item of report.items) {
    const score = item.overall === null ? '未评分' : item.overall.toFixed(1)
    const target = item.topic === '' ? item.target : `${item.target} · ${item.topic}`
    lines.push(`| ${item.questionId} | ${item.kind} | ${target} | ${score} | ${item.verdict} |`)
  }

  const answered = (report.items ?? []).filter((item) => String(item.answer ?? '').trim() !== '')
  if (answered.length > 0) {
    lines.push('', '## 逐题原文与参考解', '')
    for (const item of answered) {
      const title = item.topic === '' ? item.questionId : `${item.questionId} · ${item.topic}`
      lines.push(`### ${title}`, '')
      lines.push(`- 类型：${item.kind} · 考察点：${item.target === '' ? '（未指定）' : item.target}`)
      const how = item.inputMode === 'voice' ? '语音（已转写）' : item.inputMode === 'code' ? '手撕代码' : '文字'
      lines.push(`- 作答方式：${how}`)
      lines.push('', '**你的回答**', '', '```text', item.answer, '```', '')
      if (Array.isArray(item.cases) && item.cases.length > 0) {
        lines.push('**边界用例推演（未真实执行）**', '', '| 输入 | 期望 | 实际（推演） | 结论 |', '| --- | --- | --- | --- |')
        for (const one of item.cases) {
          lines.push(`| ${one.input ?? ''} | ${one.expected ?? ''} | ${one.actual ?? ''} | ${one.ok === true ? '通过' : '不通过'} |`)
        }
        lines.push('')
      }
      if (Array.isArray(item.evidence) && item.evidence.length > 0) {
        lines.push('**扣分依据**', '')
        for (const quote of item.evidence) lines.push(`> ${quote}`, '')
      }
      if (Array.isArray(item.reference) && item.reference.length > 0) {
        lines.push('**参考解**', '')
        for (const point of item.reference) lines.push(`- ${point}`)
        lines.push('')
      }
      if (Array.isArray(item.warnings) && item.warnings.length > 0) {
        for (const warning of item.warnings) lines.push(`> 提示：${warning}`)
        lines.push('')
      }
    }
  }

  const weakTop3 = report.weakTop3 ?? (report.weaknesses ?? []).map((entry) => entry.dimension)
  const actions = report.actions ?? (report.weaknesses ?? []).map((entry) => entry.action)
  if (weakTop3.length > 0) {
    lines.push('', '## 三处最该补的短板', '')
    weakTop3.forEach((name, index) => {
      const value = dims[name]
      const head = value === null || value === undefined ? name : `${name}（均分 ${value.toFixed(1)}）`
      lines.push(`### ${head}`, '', actions[index] ?? '', '')
    })
  }

  lines.push(
    '## 说明',
    '',
    '- 手撕题由模型做静态评审并推演边界用例，**未真实执行**（`executed: false` / `codeVerified: false`），结论不代表代码能跑通。',
    '- 维度分为 1–5，`overall` 是六维算术平均；未考察的维度记为「未考察」，不以 0 分拉低总分。',
    '',
  )
  return lines.join('\n')
}

/**
 * Resolve an export directory that must stay inside `cwd`.
 *
 * @param {string} dir requested directory (relative to cwd, or absolute inside it)
 * @param {string} cwd working directory
 * @returns {string} absolute directory
 */
export function resolveExportDir(dir, cwd) {
  const requested = typeof dir === 'string' && dir.trim() !== '' ? dir.trim() : './interview-reports'
  // An absolute path is the export directory itself: the user picked it, so it
  // is not judged against the session's working directory. A relative path is
  // resolved inside that directory and may not climb out of it.
  if (isAbsolute(requested)) return resolve(requested)
  const root = resolve(cwd)
  const target = resolve(root, requested)
  const rel = relative(root, target)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new ContractError('E_BAD_REQUEST', `导出目录必须位于工作目录内：${requested}`)
  }
  return target
}

/**
 * Write the report into `dir`, never overwriting an existing file: the second
 * export of the same session becomes `…-2.md`, then `-3.md`.
 *
 * @param {{ report: object, dir?: string, cwd?: string, fs?: object }} input
 * @returns {Promise<{ path: string, bytes: number }>}
 */
export async function exportReport(input) {
  const { report, dir, cwd = process.cwd(), fs: injected } = input ?? {}
  if (report === undefined || report === null) {
    throw new ContractError('E_BAD_REQUEST', '缺少报告内容')
  }
  const io = injected ?? { mkdir, stat, writeFile }
  const format = normaliseFormat(input?.format)
  const targetDir = resolveExportDir(dir, cwd)
  const stamp = new Date(report.generatedAt ?? Date.now())
  const day = `${stamp.getFullYear()}-${String(stamp.getMonth() + 1).padStart(2, '0')}-${String(stamp.getDate()).padStart(2, '0')}`
  const base = `${day}-${String(report.sessionId ?? 'session').slice(0, 8)}`
  const extension = format === 'json' ? '.json' : '.md'
  // JSON keeps every field the UI saw, so a report can be diffed or fed to
  // another tool without re-parsing markdown.
  const text = format === 'json' ? `${JSON.stringify(report, null, 2)}\n` : renderMarkdown(report)

  try {
    await io.mkdir(targetDir, { recursive: true })
  } catch (problem) {
    throw new ContractError('E_EXPORT_FAILED', `无法创建导出目录：${problem?.code ?? 'unknown'}`)
  }

  let path = join(targetDir, `${base}${extension}`)
  for (let attempt = 2; attempt < 100; attempt += 1) {
    try {
      await io.stat(path)
      path = join(targetDir, `${base}-${attempt}${extension}`)
    } catch {
      break
    }
  }

  try {
    await io.writeFile(path, text, 'utf8')
  } catch (problem) {
    throw new ContractError('E_EXPORT_FAILED', `报告写入失败：${problem?.code ?? 'unknown'}`)
  }
  return { path, bytes: Buffer.byteLength(text, 'utf8') }
}

/** Only these two formats exist; anything else is a client bug, not a fallback. */
export function normaliseFormat(format) {
  if (format === undefined || format === null || format === '') return 'md'
  if (format === 'md' || format === 'json') return format
  throw new ContractError('E_BAD_REQUEST', `不支持的导出格式 ${format}，可选 md / json`)
}

/** Filename a caller can show in a toast without leaking the whole path. */
export function reportFileName(path) {
  return basename(String(path))
}