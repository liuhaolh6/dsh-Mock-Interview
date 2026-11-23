import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import vm from 'node:vm'

// S-C3b: a render-time exception blanks the whole panel and no unit test sees it.
// This harness runs the real client module against a minimal React stub and
// renders the first screen, so temporal-dead-zone mistakes and typos in the
// initial tree fail here instead of in front of the user.

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const source = readFileSync(join(ROOT, 'client.js'), 'utf8')

/** The smallest React that can render a function component once. */
function fakeReact() {
  const createElement = (type, props, ...children) => ({ type, props: props ?? {}, children, key: props?.key })
  return {
    createElement,
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useCallback: (fn) => fn,
    useEffect: () => {},
    useRef: (value) => ({ current: value }),
    useMemo: (fn) => fn(),
  }
}

/** Load client.js in an isolated context and return its registered slots. */
function loadPanel() {
  const registered = []
  const context = {
    window: {
      __ModuleLoader__: {
        load(definition) {
          const module = definition.factory((name) => {
            if (name === 'react') return fakeReact()
            throw new Error(`unexpected require(${name})`)
          })
          const ctx = {
            effect: () => {},
            locale: { register: () => {}, bind: () => (key) => key },
            slots: {
              inject: (_name, register) => register(),
              register: (options, component) => {
                registered.push({ options, component })
                return { dispose() {} }
              },
            },
          }
          module.apply(ctx)
        },
      },
      speechSynthesis: undefined,
    },
    console,
  }
  context.globalThis = context
  vm.createContext(context)
  vm.runInContext(source, context, { filename: 'client.js' })
  return registered
}

/** Recursively collect the text of a rendered tree. */
function textOf(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join(' ')
  const head = node.type?.name ? `<${node.type.name}>` : ''
  const labels = [node.props?.label, node.props?.placeholder, node.props?.title]
    .filter((value) => typeof value === 'string')
    .join(' ')
  return `${head} ${labels} ${textOf(node.props?.children ?? [])} ${textOf(node.children)}`
}

test('TC-UX-009 the panel module loads and registers both slots', () => {
  const slots = loadPanel()
  const names = slots.map((entry) => entry.options.name)
  assert.ok(names.includes('sidebar.panellist'), 'expected the sidebar icon')
  assert.ok(names.includes('main'), 'expected the main page')
})

test('TC-UX-010 the first screen renders without throwing', () => {
  const slots = loadPanel()
  const page = slots.find((entry) => entry.options.name === 'main').component
  let tree
  assert.doesNotThrow(() => {
    tree = page({ ctx: { get: () => undefined }, t: (key) => key })
  }, 'rendering the setup screen must not throw')
  const text = textOf(tree)
  assert.match(text, /setup\.title|panel\.title/, 'expected the setup heading')
  assert.match(text, /setup\.resume/, 'expected the résumé field')
})

test('TC-UX-011 every render path stays inside the palette wrapper', () => {
  const slots = loadPanel()
  const page = slots.find((entry) => entry.options.name === 'main').component
  const tree = page({ ctx: { get: () => undefined }, t: (key) => key })
  assert.equal(tree.props?.style?.minHeight !== undefined || tree.props?.style !== undefined, true)
  assert.equal(tree.type, 'div', 'the page root must be a div with the page style')
})