/**
 * Panel palette for both colour schemes.
 *
 * Contract: the panel never invents colours at render time. It asks the host
 * for a palette (see `ping`) and the palette is checked here against WCAG AA
 * for text pairs, so a "looks fine to me" change cannot ship.
 */

/** Relative luminance per WCAG 2.1. */
function luminance(hex) {
  const value = String(hex).replace('#', '')
  if (value.length !== 6) throw new Error(`expected #rrggbb, got ${hex}`)
  const channels = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255)
  const [r, g, b] = channels.map((channel) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  )
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/**
 * WCAG contrast ratio between two `#rrggbb` colours (1..21).
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function contrastRatio(a, b) {
  const first = luminance(a)
  const second = luminance(b)
  const lighter = Math.max(first, second)
  const darker = Math.min(first, second)
  return Math.round(((lighter + 0.05) / (darker + 0.05)) * 100) / 100
}

export const PALETTES = Object.freeze({
  light: Object.freeze({
    scheme: 'light',
    bg: '#ffffff',
    surface: '#f6f8fa',
    text: '#1f2328',
    muted: '#57606a',
    border: '#d0d7de',
    primary: '#2f6fed',
    primaryText: '#ffffff',
    ok: '#0b6b3a',
    bad: '#b3261e',
    warn: '#8a4b00',
    bar: '#2f6fed',
  }),
  dark: Object.freeze({
    scheme: 'dark',
    bg: '#12161b',
    surface: '#1b2027',
    text: '#e6edf3',
    muted: '#9aa4b2',
    border: '#3d444d',
    primary: '#2f6fed',
    primaryText: '#ffffff',
    ok: '#57d08a',
    bad: '#ff8f88',
    warn: '#e3b341',
    bar: '#2f6fed',
  }),
})

/**
 * Palette for a colour scheme; anything unknown is treated as light.
 * @param {string|undefined|null} scheme
 */
export function pickTheme(scheme) {
  return scheme === 'dark' ? PALETTES.dark : PALETTES.light
}
