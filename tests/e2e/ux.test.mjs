import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// S-C4: keyboard reachability is a source-level contract, because the panel is a
// single module with no DOM harness. Each assertion names the exact rule the
// browser needs: guarded keydown handlers and real buttons.

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const source = readFileSync(join(ROOT, 'client.js'), 'utf8')

function keydownHandlers(text) {
  const found = []
  const marker = 'onKeyDown:'
  let index = text.indexOf(marker)
  while (index >= 0) {
    // capture roughly the handler body: from the marker to the matching close
    found.push(text.slice(index, index + 700))
    index = text.indexOf(marker, index + marker.length)
  }
  return found
}

test('TC-UX-001 every keydown handler ignores IME composition', () => {
  const handlers = keydownHandlers(source)
  assert.ok(handlers.length > 0, 'expected at least one keydown handler')
  for (const handler of handlers) {
    assert.match(handler, /isComposing/, 'keydown handler must check event.isComposing')
  }
})

test('TC-UX-002 Ctrl/Cmd+Enter submits the answer without leaving the textarea', () => {
  // Either modifier may drive the shortcut on this platform; both must be
  // consulted in the same expression.
  assert.match(
    source,
    /metaKey[^\n;]{0,40}ctrlKey/,
    'expected a guard that consults both metaKey and ctrlKey',
  )
  assert.match(source, /event\.key === 'Enter'/)
})

test('TC-UX-003 every rendered button declares type="button"', () => {
  const buttons = source.match(/h\('button',\s*\{/g) ?? []
  assert.ok(buttons.length > 10, `expected many buttons, saw ${buttons.length}`)
  const withType = source.match(/h\('button',\s*\{[^}]*type:\s*'button'/g) ?? []
  assert.equal(withType.length, buttons.length, 'a button without type="button" can submit a form')
})

test('TC-UX-004 focus is visible: interactive components toggle an outline on focus', () => {
  assert.match(source, /onFocus:/, 'expected onFocus handlers')
  assert.match(source, /outline/, 'expected an outline style for keyboard focus')
})

test('TC-UX-005 the answer box is a textarea with an accessible label', () => {
  assert.match(source, /h\('textarea'/)
  assert.match(source, /aria-label|label:/, 'expected a visible or aria label near the textarea')
})
