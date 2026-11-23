/**
 * Onboarding decisions for the panel's first screens.
 *
 * The panel is deliberately dumb: it renders whatever reason it is handed
 * instead of guessing "why is this list empty". Keeping the decision here
 * means an empty list caused by a filter can never be mistaken for a brand
 * new user who has never run an interview.
 */

/**
 * Why a record list has no rows.
 *
 * @param {{allCount?: number, pageCount?: number, filtered?: boolean}} input
 *   `allCount` counts every stored session, `pageCount` the rows that survived
 *   filtering/paging.
 * @returns {'none'|'filtered'|null} `'none'` when nothing was ever stored,
 *   `'filtered'` when rows exist but this page has none, `null` when the page
 *   has rows.
 */
export function emptyReasonFor({ allCount = 0, pageCount = 0, filtered = false } = {}) {
  if (pageCount > 0) return null
  if (!Number.isFinite(allCount) || allCount <= 0) return 'none'
  if (filtered) return 'filtered'
  return 'filtered'
}

/**
 * Whether a profile is complete enough to start an interview.
 *
 * A profile with skills but no projects is startable — the plan falls back to
 * bank questions. Blockers are reported so the confirm screen can say what is
 * still thin instead of just greying the button out.
 *
 * @param {{skills?: unknown, projects?: unknown}|null|undefined} profile
 * @returns {{ready: boolean, blockers: string[]}} blockers ⊆ ['skills','projects']
 */
export function readinessOf(profile) {
  const skills = Array.isArray(profile?.skills) ? profile.skills : []
  const projects = Array.isArray(profile?.projects) ? profile.projects : []
  const blockers = []
  if (skills.length === 0) blockers.push('skills')
  if (projects.length === 0) blockers.push('projects')
  return { ready: skills.length > 0 || projects.length > 0, blockers }
}
