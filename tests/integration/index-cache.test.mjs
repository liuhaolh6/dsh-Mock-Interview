import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import * as realFs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createStore, sessionsDir } from '../../lib/store.mjs'

// B2: listing must not re-read every record body once the index exists, but a
// stale or corrupt index may never hide or invent a record.

async function tempHome() {
  return mkdtemp(join(tmpdir(), 'dsh-mock-interview-idx-'))
}

function countingFs() {
  const counts = { readFile: 0, readdir: 0 }
  // Only record bodies count: the index file and .bak copies are not body reads.
  const isRecord = (file) => typeof file === 'string' && file.endsWith('.json') && !file.endsWith('index.json')
  const fs = {
    ...realFs,
    readFile: async (...args) => {
      if (isRecord(args[0])) counts.readFile += 1
      return realFs.readFile(...args)
    },
    readdir: async (...args) => {
      counts.readdir += 1
      return realFs.readdir(...args)
    },
  }
  return { fs, counts }
}

const record = (id, over = {}) => ({
  schemaVersion: 1,
  id,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  status: 'active',
  mode: 'tech-1',
  difficulty: 'mid',
  minutes: 15,
  plan: { items: [] },
  turns: [],
  ...over,
})

test('TC-IDX-001 the first list builds the index, the second one reuses it', async () => {
  const home = await tempHome()
  const { fs, counts } = countingFs()
  const store = createStore({ home, fs })

  await store.put(record('a'))
  await store.put(record('b'))
  await store.put(record('c'))

  const first = await store.list()
  assert.equal(first.length, 3)
  const readsAfterFirst = counts.readFile
  assert.ok(readsAfterFirst >= 3, 'a cold list must read the records')

  const second = await store.list()
  assert.equal(second.length, 3)
  assert.equal(counts.readFile, readsAfterFirst, 'a warm list must not read record bodies again')

  const index = JSON.parse(await readFile(join(sessionsDir(home), 'index.json'), 'utf8'))
  assert.equal(Object.keys(index.entries).length, 3)
  await rm(home, { recursive: true, force: true })
})

test('TC-IDX-002 only the record that changed is re-read', async () => {
  const home = await tempHome()
  const { fs, counts } = countingFs()
  const store = createStore({ home, fs })
  await store.put(record('a'))
  await store.put(record('b'))
  await store.list()

  await store.put(record('b', { updatedAt: 1_700_000_900_000, turns: [{ questionId: 'q1' }] }))
  // put() itself reads the previous document to decide whether a .bak is needed.
  const afterWrite = counts.readFile
  const after = await store.list()

  assert.equal(counts.readFile, afterWrite + 1, 'exactly one body re-read after one write')
  const b = after.find((row) => row.id === 'b')
  assert.equal(b.turns, 1)
  assert.ok(b.updatedAt > 1_700_000_000_000 || b.overall === null)
  await rm(home, { recursive: true, force: true })
})

test('TC-IDX-003 a deleted record disappears even if the index still lists it', async () => {
  const home = await tempHome()
  const store = createStore({ home })
  await store.put(record('a'))
  await store.put(record('b'))
  await store.list()

  await store.remove('a')
  const rows = await store.list()
  assert.deepEqual(rows.map((row) => row.id), ['b'])
  await rm(home, { recursive: true, force: true })
})

test('TC-IDX-004 a corrupt index is rebuilt instead of crashing the list', async () => {
  const home = await tempHome()
  const store = createStore({ home })
  await store.put(record('a'))
  await store.list()

  await writeFile(join(sessionsDir(home), 'index.json'), '{ not json', 'utf8')
  const rows = await store.list()
  assert.deepEqual(rows.map((row) => row.id), ['a'])

  const rebuilt = JSON.parse(await readFile(join(sessionsDir(home), 'index.json'), 'utf8'))
  assert.ok(rebuilt.entries.a !== undefined)
  await rm(home, { recursive: true, force: true })
})

test('TC-IDX-005 a record edited behind our back is picked up (mtime wins)', async () => {
  const home = await tempHome()
  const store = createStore({ home })
  await store.put(record('a'))
  await store.list()

  const file = join(sessionsDir(home), 'a.json')
  const onDisk = JSON.parse(await readFile(file, 'utf8'))
  await writeFile(file, JSON.stringify({ ...onDisk, title: '外部改的名字', updatedAt: 1_800_000_000_000 }, null, 2), 'utf8')

  const rows = await store.list()
  assert.equal(rows[0].title, '外部改的名字')
  await rm(home, { recursive: true, force: true })
})