import assert from 'node:assert/strict'
import { join } from 'node:path'
import test from 'node:test'

import { DIMENSIONS } from '../../lib/contracts.js'
import { buildReport, exportReport, renderMarkdown, reportFileName, resolveExportDir } from '../../lib/report.mjs'

// S5b: the export failure modes and the "sample is adequate" branch.

const report = {
  sessionId: 'abcdef123456',
  generatedAt: Date.UTC(2026, 10, 23, 3, 0, 0),
  mode: 'tech-1',
  difficulty: 'mid',
  minutes: 30,
  planned: 3,
  answered: 1,
  sampleAdequate: true,
  overall: 3,
  radar: { dims: Object.fromEntries(DIMENSIONS.map((name) => [name, 3])) },
  items: [{ questionId: 'q1', kind: 'basics', target: 'skill:Java', topic: '', overall: 3, verdict: 'ok', missing: [] }],
  weakTop3: ['depth'],
  actions: ['补三层结构'],
  summary: 'tech-1 模式 / mid 难度，作答 1 / 3 题，综合 3.0 分；最该补的是 depth。',
  codeVerified: false,
}

test('TC-EDG-040 exporting without a report is a bad request, not a crash', async () => {
  await assert.rejects(() => exportReport({ report: null, cwd: 'D:/project' }), { code: 'E_BAD_REQUEST' })
})

test('TC-EDG-041 a directory or file that refuses to be written is an export failure', async () => {
  const brokenMkdir = {
    mkdir: async () => {
      throw Object.assign(new Error('nope'), { code: 'EACCES' })
    },
    stat: async () => {
      throw new Error('missing')
    },
    writeFile: async () => {},
  }
  await assert.rejects(() => exportReport({ report, cwd: 'D:/project', fs: brokenMkdir }), {
    code: 'E_EXPORT_FAILED',
  })

  const brokenWrite = {
    mkdir: async () => {},
    stat: async () => {
      throw new Error('missing')
    },
    writeFile: async () => {
      throw Object.assign(new Error('disk full'), { code: 'ENOSPC' })
    },
  }
  await assert.rejects(() => exportReport({ report, cwd: 'D:/project', fs: brokenWrite }), {
    code: 'E_EXPORT_FAILED',
  })
})

test('TC-EDG-042 the default directory is used, absolute paths inside cwd pass, outside ones do not', () => {
  const cwd = 'D:/project/06-temp'
  assert.equal(resolveExportDir(undefined, cwd), join(cwd, 'interview-reports'))
  assert.equal(resolveExportDir(join(cwd, 'out'), cwd), join(cwd, 'out'))
  assert.throws(() => resolveExportDir('..', cwd), { code: 'E_BAD_REQUEST' })
  assert.throws(() => resolveExportDir('C:/Windows', cwd), { code: 'E_BAD_REQUEST' })
  assert.throws(() => resolveExportDir('.', cwd), { code: 'E_BAD_REQUEST' })
})

test('TC-EDG-043 an adequate sample names the weakest dimensions in the markdown', () => {
  const markdown = renderMarkdown(report)
  assert.match(markdown, /三处最该补的短板|短板/)
  assert.match(markdown, /depth/)
  assert.match(markdown, /补三层结构/)
  assert.equal(reportFileName('D:/project/interview-reports/x.md'), 'x.md')
})

test('TC-EDG-044 an unmeasured dimension is never reported as a zero', () => {
  const session = {
    schemaVersion: 1,
    id: 's9',
    mode: 'algo',
    difficulty: 'junior',
    minutes: 15,
    plan: { items: [{ id: 'q1', kind: 'basics', target: 'bank:手撕', topic: '数组' }] },
    turns: [
      {
        questionId: 'q1',
        answer: '不知道',
        score: { dims: { correctness: null, depth: 2 }, overall: 2, verdict: 'weak', missing: ['结构'] },
      },
    ],
  }
  const built = buildReport(session)
  assert.equal(built.radar.dims.correctness, null)
  assert.equal(built.radar.dims.depth, 2)
  assert.deepEqual(
    built.weakTop3,
    ['depth'],
    'an unmeasured dimension must not outrank a measured weak one',
  )
  assert.equal(built.items[0].verdict, 'weak')
  assert.deepEqual(built.items[0].missing, ['结构'])
})
test('TC-EDG-045 repeated exports walk up the suffix and stop before infinity', async () => {
  const written = []
  const alwaysTaken = {
    mkdir: async () => {},
    stat: async () => ({ size: 1 }),
    writeFile: async (path) => {
      written.push(path)
    },
  }
  const result = await exportReport({ report, cwd: 'D:/project', fs: alwaysTaken })
  assert.match(result.path, /-99\.md$/)
  assert.equal(written.length, 1)
  assert.equal(result.bytes, Buffer.byteLength(renderMarkdown(report), 'utf8'))
})
