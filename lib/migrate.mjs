import { SCHEMA_VERSION } from './contracts.js'
import { ContractError } from './errors.mjs'
import { defaultTitle } from './history.mjs'

/**
 * v0.2 / B2: schema upgrade.
 *
 * v0.1 wrote `schemaVersion: 1` records without `title`/`tags`/`note`. Reading
 * one must not fail and must not rewrite the file — the upgrade is a *view*
 * until something actually writes the record back, at which point `store.put`
 * upgrades the document and keeps the original as `<id>.json.v1.bak`.
 *
 * A record written by a *newer* plugin is refused: silently degrading it to the
 * current shape would lose whatever the newer version added.
 *
 * @module lib/migrate
 */

export const MIN_SCHEMA_VERSION = 1

/** File suffix used for the one-time backup of a pre-upgrade document. */
export function backupName(version) {
  return `.v${version}.bak`
}

/**
 * @param {object} raw parsed JSON document from disk
 * @returns {{ session: object, from: number, migrated: boolean }}
 */
export function migrateSession(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ContractError('E_SESSION_NOT_FOUND', '会话文件不是一个对象')
  }

  // Records written before the field existed are v1 by definition.
  const from = raw.schemaVersion === undefined ? MIN_SCHEMA_VERSION : raw.schemaVersion

  if (!Number.isInteger(from) || from < MIN_SCHEMA_VERSION || from > SCHEMA_VERSION) {
    throw new ContractError(
      'E_SCHEMA_VERSION',
      `会话的 schemaVersion=${String(from)} 超出当前插件支持的 ${MIN_SCHEMA_VERSION}–${SCHEMA_VERSION}`,
    )
  }

  const session = {
    ...raw,
    schemaVersion: SCHEMA_VERSION,
    title: typeof raw.title === 'string' && raw.title.length > 0 ? raw.title : defaultTitle(raw),
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    note: typeof raw.note === 'string' ? raw.note : '',
  }

  return { session, from, migrated: from !== SCHEMA_VERSION }
}