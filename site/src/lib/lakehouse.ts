import { dataUrl } from './duckdb'
import type { Lineage } from './lineage'

export type Manifest = {
  schema_version: number
  seed: number
  as_of: string
  bronze: Record<string, number>
  silver: Record<string, number>
  gold: Record<string, number>
  export: Record<string, { rows: number; columns: string[] }>
  match: Record<string, number>
}

export type MatchReport = {
  auto_merged: number
  tier_1_deterministic: number
  tier_2_fuzzy: number
  review_queue: number
  candidates_scored: number
  thresholds: { auto_merge: number; review_floor: number }
  weights: Record<string, number>
  truth_pairs: number
  true_positives: number
  false_positives: number
  false_negatives: number
  precision: number
  recall: number
  traps_merged: number
  by_kind: Record<string, { merged: number; review: number; unmatched: number }>
}

export type RawSample = { columns: string[]; rows: string[][]; total_rows: number }
export type RawSamples = Record<'core_a' | 'core_b', Record<string, RawSample>>

export type BuildInfo = { run_number: string; sha: string; built_at: string }

async function loadJson<T>(file: string): Promise<T> {
  const r = await fetch(dataUrl(file))
  if (!r.ok) throw new Error(`${file}: HTTP ${r.status}`)
  return (await r.json()) as T
}

export type Lakehouse = { lineage: Lineage; manifest: Manifest; matchReport: MatchReport; rawSamples: RawSamples }

export async function loadLakehouse(): Promise<Lakehouse> {
  const [lineage, manifest, matchReport, rawSamples] = await Promise.all([
    loadJson<Lineage>('lineage.json'),
    loadJson<Manifest>('manifest.json'),
    loadJson<MatchReport>('match_report.json'),
    loadJson<RawSamples>('raw_samples.json'),
  ])
  return { lineage, manifest, matchReport, rawSamples }
}

export function loadBuildInfo(): Promise<BuildInfo | null> {
  return loadJson<BuildInfo>('build_info.json').catch(() => null)
}
