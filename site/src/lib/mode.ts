/** Viewing mode: "bank" hides the plumbing for non-technical readers; "tech" shows everything. */

export type Mode = 'bank' | 'tech'
export const MODE_KEY = 'bc360.mode'

/** URL ?mode=... wins, then the remembered choice, then bank mode. Pure, unit-tested. */
export function resolveMode(search: string, stored: string | null): Mode {
  const q = new URLSearchParams(search).get('mode')
  if (q === 'tech' || q === 'bank') return q
  if (stored === 'tech' || stored === 'bank') return stored
  return 'bank'
}
