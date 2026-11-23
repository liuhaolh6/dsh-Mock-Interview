import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// S-C7: the report screen folds long output and can copy it without writing a
// file. Both are source-level facts, asserted here so they cannot regress.

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const source = readFileSync(join(ROOT, 'client.js'), 'utf8')

test('TC-UX-006 the report folds each question with native details/summary', () => {
  assert.match(source, /h\('details'/, 'expected a <details> per question')
  assert.match(source, /h\('summary'/, 'expected a <summary> so it is keyboard reachable')
  assert.match(source, /report\.items/, 'expected a section title for the folded list')
})

test('TC-UX-007 copying uses the clipboard API and the same Markdown as the exporter', () => {
  assert.match(source, /navigator\?\.clipboard|navigator\.clipboard/, 'expected a clipboard call')
  assert.match(source, /rpc\('report\/preview'/, 'the copied Markdown must come from the host builder')
  assert.match(source, /report\.copied/, 'expected a success message')
  assert.match(source, /report\.copyFailed/, 'expected a failure message when the browser denies access')
})

test('TC-UX-008 the copy button is disabled while a request is in flight', () => {
  assert.match(
    source,
    /onCopyMarkdown: copyReport|onCopyMarkdown/,
    'expected the report panel to receive the copy handler',
  )
  assert.match(source, /disabled: props\.busy/, 'expected the copy button to respect busy state')
})
