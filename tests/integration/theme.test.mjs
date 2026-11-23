import assert from 'node:assert/strict'
import test from 'node:test'

import { dispatch, RPC_PATH } from '../../index.js'
import { PALETTES, contrastRatio } from '../../lib/theme.mjs'

// S-C6: the panel does not own colours — it asks and renders.

const URL_BASE = 'http://localhost' + RPC_PATH

async function call(body, deps = {}) {
  const response = await dispatch(
    new Request(URL_BASE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    deps,
  )
  assert.equal(response.status, 200)
  return response.json()
}

test('TC-THM-010 ping answers with the palette for the requested scheme', async () => {
  const light = await call({ op: 'ping' })
  assert.equal(light.value.theme.scheme, 'light')
  assert.equal(light.value.theme.bg, PALETTES.light.bg)

  const dark = await call({ op: 'ping', scheme: 'dark' })
  assert.equal(dark.value.theme.scheme, 'dark')
  assert.equal(dark.value.theme.bg, PALETTES.dark.bg)

  const unknown = await call({ op: 'ping', scheme: 'sepia' })
  assert.equal(unknown.value.theme.scheme, 'light')
})

test('TC-THM-011 the palette the panel receives is the one the tests verified', async () => {
  const { value } = await call({ op: 'ping', scheme: 'dark' })
  for (const key of ['text', 'muted', 'ok', 'bad', 'warn']) {
    assert.ok(
      contrastRatio(value.theme[key], value.theme.bg) >= 4.5,
      `${key} lost contrast on the way to the panel`,
    )
  }
})
