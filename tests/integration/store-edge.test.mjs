import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { apply, dispatch, RPC_PATH } from '../../index.js'
import { createStore, sessionsDir } from '../../lib/store.mjs'
import { CODE_REVIEW_OK } from '../fixtures/code.mjs'
import { PROFILE_CONFIRMED } from '../fixtures/resume.mjs'

// S4b: the branches the seven integration cases do not reach.

const URL_BASE = 'http://localhost' + RPC_PATH

async function tempHome() {
  return mkdtemp(join(tmpdir(), 'dsh-mock-interview-edge-'))
}

async function call(body, deps) {
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

const START = { op: 'session/create', profile: PROFILE_CONFIRMED, mode: 'tech-1', difficulty: 'mid', minutes: 30 }

test('TC-EDG-021 a store needs a home and a session needs an id', async () => {
  assert.throws(() => createStore({}), { code: 'E_BAD_REQUEST' })
  const home = await tempHome()
  const store = createStore({ home })
  await assert.rejects(() => store.put({ updatedAt: 1 }), { code: 'E_BAD_REQUEST' })
  await rm(home, { recursive: true, force: true })
})

test('TC-EDG-022 a blank, missing or corrupt session id is refused clearly', async () => {
  const home = await tempHome()
  const store = createStore({ home })
  await assert.rejects(() => store.get(''), { code: 'E_BAD_REQUEST' })
  await assert.rejects(() => store.get('nope'), { code: 'E_SESSION_NOT_FOUND' })

  const dir = sessionsDir(home)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'broken.json'), '{not json', 'utf8')
  await assert.rejects(() => store.get('broken'), { code: 'E_SESSION_NOT_FOUND' })
  await rm(home, { recursive: true, force: true })
})

test('TC-EDG-023 list survives an empty history and a corrupt file', async () => {
  const home = await tempHome()
  const store = createStore({ home })
  assert.deepEqual(await store.list(), [])

  await store.put({ id: 'good', schemaVersion: 1, updatedAt: 10, status: 'active', turns: [] })
  await writeFile(join(sessionsDir(home), 'broken.json'), 'nope', 'utf8')
  const listed = await store.list()
  assert.deepEqual(listed.map((entry) => entry.id), ['good'])
  assert.equal(listed[0].answered, 0)
  await rm(home, { recursive: true, force: true })
})

test('TC-EDG-024 deleting a session that is gone says not found', async () => {
  const home = await tempHome()
  const store = createStore({ home })
  await assert.rejects(() => store.remove('ghost'), { code: 'E_SESSION_NOT_FOUND' })
  await store.put({ id: 'real', schemaVersion: 1, updatedAt: 1 })
  assert.deepEqual(await store.remove('real'), { deleted: true })
  await rm(home, { recursive: true, force: true })
})

test('TC-EDG-025 dispatch refusals: no home, no sessionId, no model, unknown question, finished run', async () => {
  const home = await tempHome()

  const noHome = await call({ op: 'session/list' }, { home: '' })
  assert.equal(noHome.error.code, 'E_BAD_REQUEST')

  const noId = await call({ op: 'session/get' }, { home })
  assert.equal(noId.error.code, 'E_BAD_REQUEST')

  const created = await call(START, { home })
  const { sessionId, plan } = created.value

  const noModel = await call(
    { op: 'turn/answer', sessionId, questionId: plan.items[0].id, answer: '随便说说' },
    { home },
  )
  assert.equal(noModel.error.code, 'E_LLM_UNAVAILABLE')

  const unknown = await call(
    { op: 'turn/answer', sessionId, questionId: 'q999', answer: 'x' },
    { home, complete: async () => CODE_REVIEW_OK },
  )
  assert.equal(unknown.error.code, 'E_BAD_REQUEST')

  const store = createStore({ home })
  const session = await store.get(sessionId)
  await store.put({ ...session, status: 'finished' })
  const finished = await call(
    { op: 'turn/answer', sessionId, questionId: plan.items[0].id, answer: 'x' },
    { home, complete: async () => CODE_REVIEW_OK },
  )
  assert.equal(finished.error.code, 'E_SESSION_FINISHED')
  await rm(home, { recursive: true, force: true })
})

test('TC-EDG-026 the host adapter streams a real turn through ctx.llm', async () => {
  const home = await tempHome()
  const saved = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    const llm = {
      stream: async function* () {
        yield { text: CODE_REVIEW_OK.slice(0, 10) }
        yield { delta: CODE_REVIEW_OK.slice(10) }
      },
    }
    const captured = {}
    const server = {
      register(route) {
        captured.route = route
      },
    }
    const scope = {
      get(name) {
        if (name === 'webServer') return server
        if (name === 'llm') return llm
        return undefined
      },
      effect(run) {
        run()
      },
    }
    apply({
      inject(_services, run) {
        run(scope)
      },
    })
    assert.equal(captured.route.path, RPC_PATH)

    const ask = async (body) => {
      const chunks = [Buffer.from(JSON.stringify(body), 'utf8')]
      const req = {
        async *[Symbol.asyncIterator]() {
          for (const chunk of chunks) yield chunk
        },
      }
      let status = 0
      let text = ''
      const res = {
        writeHead(code) {
          status = code
        },
        end(payload) {
          text = payload
        },
      }
      await captured.route.handler(req, res)
      assert.equal(status, 200)
      return JSON.parse(text)
    }

    const created = await ask(START)
    assert.equal(created.ok, true)
    const answered = await ask({
      op: 'turn/answer',
      sessionId: created.value.sessionId,
      questionId: created.value.plan.items[0].id,
      answer: '双指针去重。',
    })
    assert.equal(answered.ok, true, JSON.stringify(answered))
    assert.equal(typeof answered.value.turn.score.overall, 'number')
  } finally {
    if (saved === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = saved
    await rm(home, { recursive: true, force: true })
  }
})
test('TC-EDG-027 a write that cannot land is an export failure, never a lost session', async () => {
  const home = await tempHome()
  const dir = sessionsDir(home)
  await mkdir(join(dir, 'occupied.json'), { recursive: true })
  const store = createStore({ home })
  await assert.rejects(
    () => store.put({ id: 'occupied', updatedAt: 1 }),
    { code: 'E_EXPORT_FAILED' },
  )
  await rm(home, { recursive: true, force: true })
})

test('TC-EDG-028 a directory masquerading as a session reads as not found', async () => {
  const home = await tempHome()
  const dir = sessionsDir(home)
  await mkdir(join(dir, 'fake.json'), { recursive: true })
  const store = createStore({ home })
  await assert.rejects(() => store.get('fake'), { code: 'E_SESSION_NOT_FOUND' })
  await assert.rejects(() => store.remove('fake'), { code: 'E_SESSION_NOT_FOUND' })
  assert.deepEqual(await store.list(), [])
  await rm(home, { recursive: true, force: true })
})

test('TC-EDG-029 a storage path that is a regular file means an empty history', async () => {
  const home = await tempHome()
  await writeFile(join(home, 'storages'), 'file', 'utf8')
  const store = createStore({ home })
  assert.deepEqual(await store.list(), [])
  await assert.rejects(() => store.get('any'), { code: 'E_SESSION_NOT_FOUND' })
  await rm(home, { recursive: true, force: true })
})

test('TC-EDG-030 an unexpected I/O error is rethrown untouched, not disguised', async () => {
  const ioError = Object.assign(new Error('disk on fire'), { code: 'EIO' })
  const fakeFs = {
    mkdir: async () => {},
    writeFile: async () => {},
    rename: async () => {},
    rm: async () => {},
    readFile: async () => {
      throw ioError
    },
    readdir: async () => {
      throw ioError
    },
  }
  const store = createStore({ home: 'D:/project/06-temp/never-used', fs: fakeFs })
  await assert.rejects(() => store.get('x'), (problem) => problem === ioError)
  await assert.rejects(() => store.list(), (problem) => problem === ioError)
})
