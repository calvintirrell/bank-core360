import Anthropic from '@anthropic-ai/sdk'
import { makeClient, translateError, type ModelId } from './anthropic'
import { runSql, type Column, type ColumnKind, type QueryResult } from './duckdb'
import type { AgentTool, ReplayEntry, ToolResult } from './lakehouse'
import { assertReadOnly } from './sql'

export const MAX_CALLS = 4
const MAX_TOOL_ROWS = 50

export type Route = 'proxy' | 'byok' | 'replay'
export type AgentStep = { sql: string; result: ToolResult | null; error: string | null }
export type AgentRun = {
  question: string
  route: Route
  model: string | null
  steps: AgentStep[]
  explanation: string | null
  calls: number
  usage: { input_tokens: number; output_tokens: number }
  stopReason: string | null
  pending: boolean
}

/** Converts a DuckDB result into the compact shape the model receives (same as pipeline/replay.py). */
export function toToolResult(r: QueryResult): ToolResult {
  return {
    columns: r.columns.map((c) => c.name),
    rows: r.rows.slice(0, MAX_TOOL_ROWS).map((row) => r.columns.map((c) => normalize(row[c.name], c.kind))),
    row_count: r.rows.length,
  }
}

function normalize(v: unknown, kind: ColumnKind): unknown {
  if (v === null || v === undefined) return null
  if (typeof v === 'bigint') return Number(v)
  if (kind === 'date' || kind === 'timestamp') {
    const d = v instanceof Date ? v : new Date(v as number)
    return Number.isNaN(d.getTime()) ? String(v) : kind === 'date' ? d.toISOString().slice(0, 10) : d.toISOString()
  }
  return v
}

/** Converts a tool result (live or replayed) back into a displayable table, inferring column kinds. */
export function fromToolResult(t: ToolResult): QueryResult {
  const columns: Column[] = t.columns.map((name, i) => {
    const sample = t.rows.map((r) => r[i]).find((v) => v !== null && v !== undefined)
    return { name, kind: inferKind(sample) }
  })
  const rows = t.rows.map((r) => Object.fromEntries(t.columns.map((c, i) => [c, coerce(r[i], columns[i].kind)])))
  return { columns, rows, ms: 0 }
}

function inferKind(v: unknown): ColumnKind {
  if (typeof v === 'boolean') return 'boolean'
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number'
  if (typeof v === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return 'date'
    if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(v)) return 'timestamp'
  }
  return 'text'
}

function coerce(v: unknown, kind: ColumnKind): unknown {
  if ((kind === 'date' || kind === 'timestamp') && typeof v === 'string') return new Date(v)
  return v
}

export function replayRun(entry: ReplayEntry): AgentRun {
  const a = entry.agent
  return {
    question: entry.question,
    route: 'replay',
    model: a?.model ?? null,
    steps: a?.steps ?? [{ sql: entry.sql, result: entry.result, error: null }],
    explanation: a?.explanation ?? null,
    calls: a?.calls ?? 0,
    usage: a?.usage ?? { input_tokens: 0, output_tokens: 0 },
    stopReason: null,
    pending: !a?.explanation,
  }
}

export type AskOptions = {
  apiKey: string
  model: ModelId
  prompt: string
  tool: AgentTool
  onUpdate?: (run: AgentRun) => void
}

/** Runs the question through Claude with the run_sql tool, executing SQL in DuckDB-WASM here. */
export async function askLive(question: string, opts: AskOptions): Promise<AgentRun> {
  const client = makeClient(opts.apiKey)
  const run: AgentRun = {
    question,
    route: opts.apiKey ? 'byok' : 'proxy',
    model: opts.model,
    steps: [],
    explanation: null,
    calls: 0,
    usage: { input_tokens: 0, output_tokens: 0 },
    stopReason: null,
    pending: false,
  }
  const tools: Anthropic.Tool[] = [
    {
      name: opts.tool.name,
      description: opts.tool.description,
      input_schema: opts.tool.input_schema as Anthropic.Tool.InputSchema,
      strict: opts.tool.strict,
    },
  ]
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: question }]

  while (run.calls < MAX_CALLS) {
    run.calls += 1
    opts.onUpdate?.({ ...run })
    let res: Anthropic.Message
    try {
      res = await client.messages.create({
        model: opts.model,
        max_tokens: 2048,
        system: opts.prompt,
        tools,
        messages,
        output_config: { effort: 'low' },
      })
    } catch (e) {
      throw translateError(e)
    }
    run.usage.input_tokens += res.usage.input_tokens
    run.usage.output_tokens += res.usage.output_tokens
    run.stopReason = res.stop_reason
    messages.push({ role: 'assistant', content: res.content })

    if (res.stop_reason === 'tool_use') {
      const results: Anthropic.ToolResultBlockParam[] = []
      for (const block of res.content) {
        if (block.type !== 'tool_use') continue
        const sql = String((block.input as { sql?: unknown }).sql ?? '')
        try {
          const r = await runSql(assertReadOnly(sql))
          const tr = toToolResult(r)
          run.steps.push({ sql, result: tr, error: null })
          results.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(tr) })
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          run.steps.push({ sql, result: null, error: msg })
          results.push({ type: 'tool_result', tool_use_id: block.id, content: msg, is_error: true })
        }
        opts.onUpdate?.({ ...run, steps: [...run.steps] })
      }
      messages.push({ role: 'user', content: results })
      continue
    }

    if (res.stop_reason === 'refusal') {
      run.explanation = 'The model declined to answer this question.'
      break
    }
    run.explanation = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim()
    if (res.stop_reason === 'max_tokens') run.explanation += '\n\n(Answer cut off at the demo token limit.)'
    break
  }
  if (run.explanation === null) run.explanation = 'Stopped after the maximum number of tool calls without a final answer.'
  return run
}
