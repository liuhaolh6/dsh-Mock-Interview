import test from 'node:test'
import assert from 'node:assert/strict'

import { contrastRatio, pickTheme, PALETTES } from '../../lib/theme.mjs'

// S-C6: the panel must stay readable in both colour schemes. Contrast is
// arithmetic, so it belongs in a test rather than in someone's eyes.

function pairs(palette) {
  return [
    ['text', palette.text, palette.bg],
    ['muted', palette.muted, palette.bg],
    ['primary text', palette.primaryText, palette.primary],
    ['ok', palette.ok, palette.bg],
    ['bad', palette.bad, palette.bg],
    ['warn', palette.warn, palette.bg],
    ['border', palette.border, palette.bg],
  ]
}

test('TC-THM-001 light palette meets 4.5:1 for every text pair', () => {
  for (const [name, fg, bg] of pairs(PALETTES.light)) {
    if (name === 'border') continue
    const ratio = contrastRatio(fg, bg)
    assert.ok(ratio >= 4.5, `light ${name} contrast ${ratio.toFixed(2)} < 4.5`)
  }
})

test('TC-THM-002 dark palette meets 4.5:1 for every text pair', () => {
  for (const [name, fg, bg] of pairs(PALETTES.dark)) {
    if (name === 'border') continue
    const ratio = contrastRatio(fg, bg)
    assert.ok(ratio >= 4.5, `dark ${name} contrast ${ratio.toFixed(2)} < 4.5`)
  }
})

test('TC-THM-003 borders are visible but not loud (>=1.4:1, <=4.5:1)', () => {
  for (const scheme of ['light', 'dark']) {
    const palette = PALETTES[scheme]
    const ratio = contrastRatio(palette.border, palette.bg)
    assert.ok(ratio >= 1.4, `${scheme} border ${ratio.toFixed(2)} too faint`)
    assert.ok(ratio <= 4.5, `${scheme} border ${ratio.toFixed(2)} competes with text`)
  }
})

test('TC-THM-004 pickTheme resolves only known schemes and defaults to light', () => {
  assert.equal(pickTheme('dark').bg, PALETTES.dark.bg)
  assert.equal(pickTheme('light').bg, PALETTES.light.bg)
  assert.equal(pickTheme('sepia').bg, PALETTES.light.bg)
  assert.equal(pickTheme(undefined).bg, PALETTES.light.bg)
})

test('TC-THM-005 contrastRatio is symmetric and capped at 21', () => {
  assert.equal(contrastRatio('#000000', '#ffffff'), 21)
  assert.equal(contrastRatio('#ffffff', '#000000'), 21)
  assert.equal(contrastRatio('#777777', '#777777'), 1)
})
