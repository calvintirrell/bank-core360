/** Exported versions, as the manifest lists them: the last entry is the latest export (served from
 *  data/), earlier ones live in data/v<i>/. Pure, shared by the DuckDB layer and the page. */

export type VersionId = 'latest' | `v${number}`
export type ManifestVersion = { as_of: string; dir: string }

export function versionDir(v: VersionId): string {
  return v === 'latest' ? '' : `${v}/`
}

/** The ids in manifest order: ['v0', 'v1', ..., 'latest']. */
export function versionIds(versions: ManifestVersion[] | undefined): VersionId[] {
  const n = versions?.length ?? 0
  if (n === 0) return ['latest']
  return versions!.map((_, i) => (i === n - 1 ? 'latest' : (`v${i}` as VersionId)))
}

/** id -> folder under data/, from the manifest ('' for the latest). */
export function versionDirs(versions: ManifestVersion[] | undefined): Record<string, string> {
  const ids = versionIds(versions)
  const out: Record<string, string> = {}
  ids.forEach((id, i) => {
    const dir = versions?.[i]?.dir ?? ''
    out[id] = id === 'latest' ? '' : dir ? `${dir.replace(/\/+$/, '')}/` : versionDir(id)
  })
  return out
}
