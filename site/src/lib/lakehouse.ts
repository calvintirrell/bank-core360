import { dataUrl } from './duckdb'
import type { Lineage } from './lineage'

export type Changes = {
  from_as_of: string
  to_as_of: string
  customers_before: number
  customers_after: number
  new_customers: number
  customers_merged_by_reviewer: number
  pairs_rejected_by_reviewer: number
  review_queue_before: number
  review_queue_after: number
  address_changes: number
  accounts_went_quiet: number
  accounts_woke_up: number
  /** Checking only; absent on builds before the split (then fall back to the all-product figures). */
  checking_accounts_went_quiet?: number
  checking_accounts_woke_up?: number
  new_accounts: number
  transactions_in_new_month: number
  deposits_before: number
  deposits_after: number
}

export type Manifest = {
  schema_version: number
  seed: number
  as_of: string
  version?: number
  is_latest?: boolean
  versions?: { as_of: string; dir: string }[]
  delta_versions?: Record<string, number>
  generator?: Record<string, number | string>
  changes?: Changes
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
  /** Every reviewer decision and what happened to it (ER-08); absent on builds before it was reported. */
  decisions?: {
    total: number
    applied: number
    pending: number
    ignored_unknown_id: number
    confirm_applied: number
    reject_applied: number
    rows: { core_a_cif: string; core_b_customer_id: string; decision: 'confirm' | 'reject'; decided_on: string; reviewer: string; status: string; was_candidate: boolean | null }[]
  }
}

export type RawSample = { columns: string[]; rows: string[][]; total_rows: number }
export type RawSamples = Record<'core_a' | 'core_b', Record<string, RawSample>>

export type BuildInfo = { run_number: string; sha: string; built_at: string }

/** Shape shared with pipeline/replay.py (rows as arrays). */
export type ToolResult = { columns: string[]; rows: unknown[][]; row_count: number }
export type ReplayStep = { sql: string; result: ToolResult | null; error: string | null }
export type ReplayAgent = {
  model: string
  calls: number
  usage: { input_tokens: number; output_tokens: number }
  steps: ReplayStep[]
  explanation: string | null
  follow_ups?: string[]
}
export type ReplayEntry = { id: string; question: string; fingerprint: string; sql: string; follow_ups?: string[]; result: ToolResult; agent: ReplayAgent | null }
export type Replay = { schema_version: number; questions: ReplayEntry[] }
export type AgentTool = { name: string; description: string; input_schema: Record<string, unknown>; strict: boolean }

async function loadJson<T>(file: string, dir = ''): Promise<T> {
  const r = await fetch(dataUrl(file, dir))
  if (!r.ok) throw new Error(`${dir}${file}: HTTP ${r.status}`)
  return (await r.json()) as T
}

export type Lakehouse = { lineage: Lineage; manifest: Manifest; matchReport: MatchReport; rawSamples: RawSamples; changes: Changes | null; latest: Manifest }

/** Loads the per-version files for `dir` ('' = latest, 'v0/' = first batch) plus the latest-only files. */
export async function loadLakehouse(dir = ''): Promise<Lakehouse> {
  const [lineage, manifest, matchReport, rawSamples, changes, latest] = await Promise.all([
    loadJson<Lineage>('lineage.json', dir),
    loadJson<Manifest>('manifest.json', dir),
    loadJson<MatchReport>('match_report.json', dir),
    loadJson<RawSamples>('raw_samples.json'),
    loadJson<Changes>('changes.json').catch(() => null),
    dir ? loadJson<Manifest>('manifest.json') : Promise.resolve<Manifest | null>(null),
  ])
  return { lineage, manifest, matchReport, rawSamples, changes, latest: latest ?? manifest }
}

export function loadReplay(): Promise<Replay> {
  return loadJson<Replay>('replay.json')
}

export async function loadAgentPrompt(dir = ''): Promise<string> {
  const r = await fetch(dataUrl('agent_prompt.md', dir))
  if (!r.ok) throw new Error(`agent_prompt.md: HTTP ${r.status}`)
  return r.text()
}

export function loadAgentTool(): Promise<AgentTool> {
  return loadJson<AgentTool>('agent_tool.json')
}

export function loadBuildInfo(): Promise<BuildInfo | null> {
  return loadJson<BuildInfo>('build_info.json').catch(() => null)
}
