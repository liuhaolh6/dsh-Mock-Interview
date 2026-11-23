#!/usr/bin/env node
/**
 * Contract + syntax gate (`npm run lint`).
 *
 * This project has no ESLint dependency (see docs/adr/0002), so "lint 0 error"
 * means three mechanical checks that catch the mistakes this codebase can
 * actually make:
 *
 *   1. syntax      — `node --check` on every JS module in the package;
 *   2. contract    — lib/contracts.js ACTIONS equals the dispatch switch in
 *                    index.js, in both directions;
 *   3. wiring      — error codes used by the host exist in ERROR_CODES, the
 *                    client half posts to the same RPC path, and the package
 *                    name matches the bundle patch id.
 *
 * Exit code 1 on any error, 0 when clean. Warnings never fail the build.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')

const errors = []
const warnings = []
const passed = []

function note(list, message) {
  list.push(message)
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git' || entry === 'coverage') continue
    const path = join(dir, entry)
    const stats = statSync(path)
    if (stats.isDirectory()) walk(path, out)
    else if (/\.(js|mjs)$/.test(entry)) out.push(path)
  }
  return out
}

const rel = (path) => relative(ROOT, path).split(sep).join('/')

/* 1. syntax --------------------------------------------------------------- */

const sources = walk(ROOT).filter((path) => !rel(path).startsWith('tests/fixtures/'))
for (const path of sources) {
  const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' })
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim().split('\n').slice(0, 3).join(' | ')
    note(errors, `syntax: ${rel(path)} — ${detail}`)
  }
}
if (errors.length === 0) note(passed, `syntax: ${sources.length} modules parsed`)

/* 2. contract table vs dispatch ------------------------------------------- */

const contracts = await import(new URL('../lib/contracts.js', import.meta.url))
const { ACTIONS, DIMENSIONS, DURATIONS, ERROR_CODES, MODES, PLANNED_ERROR_CODES, RPC_PATH } = contracts

const indexSource = readFileSync(join(ROOT, 'index.js'), 'utf8')
const caseNames = new Set([...indexSource.matchAll(/case\s+'([^']+)'\s*:/g)].map((match) => match[1]))
const declared = new Set(ACTIONS)

for (const action of declared) {
  if (!caseNames.has(action)) note(errors, `contract: action "${action}" has no \`case\` in index.js`)
}
for (const action of caseNames) {
  if (!declared.has(action)) note(errors, `contract: \`case "${action}"\` in index.js is not in ACTIONS`)
}
if (declared.size === 0) note(errors, 'contract: ACTIONS is empty')
if (declared.size === caseNames.size) note(passed, `contract: ${declared.size} action(s) match the dispatch switch`)

/* 3. wiring --------------------------------------------------------------- */

const libSources = walk(join(ROOT, 'lib'))
  .filter((file) => file.endsWith('.mjs'))
  .map((file) => readFileSync(file, 'utf8'))
  .join('\n')
const codeUseSource = `${indexSource}\n${libSources}`
const usedCodes = new Set([...codeUseSource.matchAll(/(?:\bfail\(\s*'|\bcode:\s*'|\bContractError\(\s*')([A-Z_]+)'/g)].map((match) => match[1]))
for (const code of usedCodes) {
  const declaredNow = Object.hasOwn(ERROR_CODES, code)
  const declaredPlanned = PLANNED_ERROR_CODES.includes(code)
  if (!declaredNow && !declaredPlanned) {
    note(errors, `error code: "${code}" used in index.js/lib but missing from ERROR_CODES and PLANNED_ERROR_CODES`)
  }
}
for (const code of Object.keys(ERROR_CODES)) {
  if (!usedCodes.has(code)) note(warnings, `error code: "${code}" declared but never returned yet`)
}

/* 3b. tables (G2) --------------------------------------------------------- */

const docSource = readFileSync(join(ROOT, 'docs', 'contracts.md'), 'utf8')
for (const code of PLANNED_ERROR_CODES) {
  if (!docSource.includes(code)) note(errors, `tables: planned code "${code}" is missing from docs/contracts.md`)
  if (Object.hasOwn(ERROR_CODES, code)) {
    note(errors, `tables: "${code}" is both planned and implemented; delete the planned entry`)
  }
}
for (const mode of MODES) {
  if (!docSource.includes(mode)) note(warnings, `tables: mode "${mode}" is not mentioned in docs/contracts.md`)
}
const minutes = Object.keys(DURATIONS).map(Number)
if (minutes.some((value) => !Number.isInteger(value) || value <= 0)) note(errors, 'tables: DURATIONS keys must be positive integers')
if (Object.values(DURATIONS).some((value) => !Number.isInteger(value) || value <= 0)) note(errors, 'tables: DURATIONS budgets must be positive integers')
if (new Set(DIMENSIONS).size !== DIMENSIONS.length) note(errors, 'tables: DIMENSIONS contains duplicates')
if (DIMENSIONS.length === 0) note(errors, 'tables: DIMENSIONS is empty')
if (errors.length === 0) {
  note(passed, `tables: ${PLANNED_ERROR_CODES.length} planned code(s) documented, ${MODES.length} mode(s), ${DIMENSIONS.length} dimension(s)`)
}

const clientSource = readFileSync(join(ROOT, 'client.js'), 'utf8')
const clientRoute = clientSource.match(/const\s+RPC\s*=\s*'([^']+)'/)?.[1]
if (clientRoute === undefined) note(errors, 'wiring: client.js has no RPC constant')
else if (clientRoute !== RPC_PATH) note(errors, `wiring: client.js posts to ${clientRoute}, host serves ${RPC_PATH}`)
else note(passed, `wiring: both halves use ${RPC_PATH}`)

for (const slot of ["'main'", "'sidebar.panellist'"]) {
  if (!clientSource.includes(`inject(${slot}`)) note(errors, `wiring: client.js does not inject ${slot}`)
}

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const patch = readFileSync(join(ROOT, 'cordis.patch.yml'), 'utf8')
if (!patch.includes(`name: ${pkg.name}`)) note(errors, `wiring: cordis.patch.yml does not load package "${pkg.name}"`)
else note(passed, 'wiring: bundle patch matches package name')
if (pkg.dsh?.bundle?.patch !== './cordis.patch.yml') note(errors, 'wiring: package.json dsh.bundle.patch is not ./cordis.patch.yml')
if (pkg.dsh?.client === undefined) note(errors, 'wiring: package.json has no dsh.client (browser half would never load)')

/* i18n and pill labels ----------------------------------------------------- */

// A pill built from raw strings renders as an empty button (the Choice component
// reads option.value/option.label). Catch the shape before it reaches the UI.
if (/options:\s*\[\s*'/.test(clientSource)) {
  note(errors, 'ui: client.js passes raw strings to a Choice (options must be { value, label } objects)')
} else {
  note(passed, 'ui: every Choice receives { value, label } options')
}

// Every t('key') must exist in both the zh and en dictionaries; a missing key
// silently renders an empty label.
const dictKeys = new Map()
for (const match of clientSource.matchAll(/^\s*'([^']+)':/gm)) {
  dictKeys.set(match[1], (dictKeys.get(match[1]) ?? 0) + 1)
}
const usedKeys = new Set([...clientSource.matchAll(/\bt\('([^']+)'\)/g)].map((match) => match[1]))
for (const key of usedKeys) {
  const count = dictKeys.get(key) ?? 0
  if (count === 0) note(errors, `i18n: client.js uses t('${key}') but no dictionary entry exists`)
  else if (count < 2) note(errors, `i18n: dictionary key "${key}" is missing from one locale (found ${count}, need zh + en)`)
}

/* report ------------------------------------------------------------------ */

for (const line of passed) console.log(`ok   ${line}`)
for (const line of warnings) console.log(`warn ${line}`)
for (const line of errors) console.log(`err  ${line}`)
console.log(`\n${errors.length} error(s), ${warnings.length} warning(s), ${sources.length} file(s) scanned`)

if (errors.length > 0) process.exitCode = 1