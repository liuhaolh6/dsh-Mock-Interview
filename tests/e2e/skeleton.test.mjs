/**
 * G1 packaging e2e: proves the three artifacts a DSH bundle needs are present
 * and consistent on disk (manifest ↔ patch ↔ browser half). The interview flow
 * e2e (profile → questions → answers → scoring → report) replaces this file's
 * scope in G4; until then this is the honest "the skeleton is loadable" check.
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const read = (name) => readFileSync(join(ROOT, name), 'utf8')
const pkg = JSON.parse(read('package.json'))

test('TC-PKG-001 the manifest points at files that exist', () => {
  assert.equal(pkg.name, 'dsh-mock-interview')
  assert.equal(pkg.type, 'module')
  assert.equal(pkg.main, './index.js')
  assert.equal(pkg.exports['.'], './index.js')
  assert.equal(pkg.exports['./client'], './client.js')
  for (const file of ['index.js', 'client.js', 'cordis.patch.yml', 'icon.svg', 'README.md']) {
    assert.ok(existsSync(join(ROOT, file)), `missing ${file}`)
  }
})

test('TC-PKG-002 the bundle patch inserts this package once', () => {
  const patch = read('cordis.patch.yml')
  assert.match(patch, /^- insert:/m)
  const ids = [...patch.matchAll(/^\s*- id:\s*(\S+)/gm)].map((match) => match[1])
  assert.deepEqual(ids, ['dsh-mock-interview'])
  assert.match(patch, /^\s*name:\s*dsh-mock-interview$/m)
})

test('TC-PKG-003 the browser half declares the web platform and its slot host', () => {
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.ok(Array.isArray(pkg.dsh.client.inject))
  assert.ok(pkg.dsh.client.inject.length >= 1)
  assert.ok(pkg.dsh.compatibility.dshReleases['0.2.1-rc.2'] === 'compatible')
})

test('TC-PKG-004 client.js loads through the shell module loader under its own id', () => {
  const client = read('client.js')
  assert.match(client, /window\.__ModuleLoader__\.load\(/)
  assert.match(client, /id:\s*'dsh-mock-interview'/)
  assert.match(client, /factory\(require\)\s*\{/)
})

test('TC-PKG-005 both surfaces are registered with the same panel key', () => {
  const client = read('client.js')
  assert.match(client, /const PANEL = 'mock-interview'/)
  assert.match(client, /name: 'sidebar\.panellist',\s*\n\s*id: PANEL/m)
  assert.match(client, /name: 'main',\s*\n\s*key: PANEL/m)
})

test('TC-PKG-006 scripts and the declared command set are runnable', () => {
  for (const script of ['build', 'lint', 'test', 'e2e', 'coverage']) {
    assert.equal(typeof pkg.scripts[script], 'string', `missing npm script ${script}`)
  }
  assert.match(pkg.scripts.test, /^node --test /)
})