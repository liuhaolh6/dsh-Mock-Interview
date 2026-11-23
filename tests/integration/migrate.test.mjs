import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { SCHEMA_VERSION } from '../../lib/contracts.js'
import { sessionsDir, createStore } from '../../lib/store.mjs'

// B2: v0.1 wrote schemaVersion 1. Reading it must upgrade the view, never the
// file; writing it must upgrade the file and keep the original as a backup.

async function tempHome() {
  return mkdtemp(join(tmpdir(), 'dsh-mock-interview-b2-'))
}

async function seed(home, id, payload) {
  const dir = sessionsDir(home)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, `${id}.json`), JSON.stringify(payload, null, 2), 'utf8')
}

const V1 = {
  schemaVersion: 1,
  id: 'old',
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_100_000,
  status: 'active',
  mode: 'tech-1',
  difficulty: 'mid',
  minutes: 30,
  profile: { skills: ['Java'], projects: [{ name: '订单中心', role: '后端', highlights: ['缓存'] }], jd: { title: 'Java 后端' } },
  plan: { mode: 'tech-1', difficulty: 'mid', minutes: 30, items: [] },
  turns: [],
}

test('TC-MIG-001 a v1 record reads as v2 with defaults, and the file is untouched', async () => {
  const home = await tempHome()
  await seed(home, 'old', V1)
  const store = createStore({ home })

  const session = await store.get('old')
  assert.equal(session.schemaVersion, SCHEMA_VERSION)
  assert.ok(typeof session.title === 'string' && session.title.includes('Java 后端'))
  assert.deepEqual(session.tags, [])
  assert.equal(session.note, '')

  const onDisk = JSON.parse(await readFile(join(sessionsDir(home), 'old.json'), 'utf8'))
  assert.equal(onDisk.schemaVersion, 1, 'reading must not rewrite the file')
  assert.equal(existsSync(join(sessionsDir(home), 'old.json.v1.bak')), false)
  await rm(home, { recursive: true, force: true })
})

test('TC-MIG-002 the first write upgrades to v2 and keeps a one-time v1 backup', async () => {
  const home = await tempHome()
  await seed(home, 'old', V1)
  const store = createStore({ home })

  const session = await store.get('old')
  await store.put({ ...session, updatedAt: 1_700_000_200_000 })

  const dir = sessionsDir(home)
  const upgraded = JSON.parse(await readFile(join(dir, 'old.json'), 'utf8'))
  assert.equal(upgraded.schemaVersion, SCHEMA_VERSION)
  assert.equal(upgraded.title, session.title)

  const backup = JSON.parse(await readFile(join(dir, 'old.json.v1.bak'), 'utf8'))
  assert.equal(backup.schemaVersion, 1)
  assert.deepEqual(backup, V1, 'the backup is the byte-for-byte original record')

  // Second write must not touch the backup again.
  const stamp = await readFile(join(dir, 'old.json.v1.bak'), 'utf8')
  await store.put({ ...session, note: '第二次写' })
  assert.equal(await readFile(join(dir, 'old.json.v1.bak'), 'utf8'), stamp)
  await rm(home, { recursive: true, force: true })
})

test('TC-MIG-003 a newer-than-plugin record is refused and never rewritten', async () => {
  const home = await tempHome()
  const future = { ...V1, id: 'future', schemaVersion: SCHEMA_VERSION + 1 }
  await seed(home, 'future', future)
  const store = createStore({ home })

  await assert.rejects(() => store.get('future'), { code: 'E_SCHEMA_VERSION' })
  await assert.rejects(() => store.put({ ...future, schemaVersion: 2, title: 'x' }), { code: 'E_SCHEMA_VERSION' })

  const onDisk = JSON.parse(await readFile(join(sessionsDir(home), 'future.json'), 'utf8'))
  assert.deepEqual(onDisk, future)
  assert.equal(existsSync(join(sessionsDir(home), 'future.json.v1.bak')), false)
  await rm(home, { recursive: true, force: true })
})

test('TC-MIG-004 migration keeps fields the old record already had', async () => {
  const home = await tempHome()
  await seed(home, 'titled', { ...V1, id: 'titled', title: '订单中心专场', tags: ['Redis'], note: '缓存要补' })
  const store = createStore({ home })

  const session = await store.get('titled')
  assert.equal(session.title, '订单中心专场')
  assert.deepEqual(session.tags, ['Redis'])
  assert.equal(session.note, '缓存要补')
  await rm(home, { recursive: true, force: true })
})

test('TC-MIG-005 a record without schemaVersion is treated as v1, not as garbage', async () => {
  const home = await tempHome()
  const legacy = { ...V1 }
  delete legacy.schemaVersion
  await seed(home, 'legacy', legacy)
  const store = createStore({ home })

  const session = await store.get('legacy')
  assert.equal(session.schemaVersion, SCHEMA_VERSION)
  assert.ok(session.title.length > 0)
  await rm(home, { recursive: true, force: true })
})