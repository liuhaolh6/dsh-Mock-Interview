import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ARCHIVED_TAG,
  isArchived,
  withArchivedFlag,
  listSessions,
  pickPatch,
} from '../../lib/history.mjs'

// D2: 归档不是新字段，而是记录上的一个系统标签。这样 schemaVersion 不动、
// 旧文件不需要迁移，用户也能在标签里看见它。

function row(id, { tags = [], updatedAt = 1, status = 'active' } = {}) {
  return {
    id,
    title: `记录 ${id}`,
    tags,
    note: '',
    difficulty: 'mid',
    mode: 'tech-1',
    status,
    turns: 1,
    overall: 3,
    createdAt: updatedAt,
    updatedAt,
  }
}

test('TC-HIS-201 the archived flag is a system tag and toggling it is idempotent', () => {
  assert.equal(ARCHIVED_TAG, '已归档')
  assert.equal(isArchived({ tags: [ARCHIVED_TAG] }), true)
  assert.equal(isArchived({ tags: ['Redis'] }), false)
  assert.equal(isArchived({}), false)

  assert.deepEqual(withArchivedFlag(['Redis'], true), ['Redis', ARCHIVED_TAG])
  assert.deepEqual(withArchivedFlag([ARCHIVED_TAG], true), [ARCHIVED_TAG], '重复归档不能出现两个标签')
  assert.deepEqual(withArchivedFlag(['Redis', ARCHIVED_TAG], false), ['Redis'])
  assert.deepEqual(withArchivedFlag(undefined, false), [])
})

test('TC-HIS-202 listSessions hides archived records by default and can show them on demand', () => {
  const rows = [
    row('a', { tags: [ARCHIVED_TAG], updatedAt: 300 }),
    row('b', { updatedAt: 200 }),
    row('c', { updatedAt: 100 }),
  ]

  assert.deepEqual(
    listSessions(rows).sessions.map((item) => item.id),
    ['b', 'c'],
    '默认列表只给没归档的',
  )
  assert.deepEqual(
    listSessions(rows, { archived: 'include' }).sessions.map((item) => item.id),
    ['a', 'b', 'c'],
  )
  assert.deepEqual(
    listSessions(rows, { archived: 'only' }).sessions.map((item) => item.id),
    ['a'],
  )
  assert.throws(() => listSessions(rows, { archived: 'yes' }), /archived/)
})

test('TC-HIS-203 an archived record is still searchable once archived records are included', () => {
  const rows = [row('a', { tags: [ARCHIVED_TAG, 'Redis'] }), row('b')]

  assert.equal(listSessions(rows, { query: 'redis' }).total, 0, '默认搜索不越过归档')
  assert.equal(listSessions(rows, { query: 'redis', archived: 'include' }).total, 1)
})

test('TC-HIS-204 pickPatch accepts an archived toggle and still rejects a non-boolean', () => {
  assert.deepEqual(pickPatch({ archived: true }), { archived: true })
  assert.deepEqual(pickPatch({ archived: false }), { archived: false })
  assert.deepEqual(pickPatch({ title: '改名', archived: true }), { title: '改名', archived: true })
  assert.throws(() => pickPatch({ archived: 'yes' }), /archived/)
  assert.throws(() => pickPatch({}), /至少/)
})

test("TC-HIS-205 the archived tag and an explicit tag filter never contradict each other", () => {
  const rows = [row('a', { tags: [ARCHIVED_TAG] }), row('b', { tags: ['Redis'] })]

  assert.equal(listSessions(rows, { tag: ARCHIVED_TAG }).total, 0, '默认视图下点「已归档」标签应无结果')
  assert.equal(listSessions(rows, { tag: ARCHIVED_TAG, archived: 'only' }).total, 1)
  assert.equal(listSessions(rows, { tag: 'redis' }).total, 1)
})