import { formatCell, type QueryResult } from '../lib/duckdb'
import type { Lineage } from '../lib/lineage'
import { LineageBadge } from './LineageBadge'

const MAX_ROWS = 500

export function ResultTable({ result, lineage, table, maxRows = MAX_ROWS }: { result: QueryResult; lineage: Lineage | null; table?: string; maxRows?: number }) {
  const rows = result.rows.slice(0, maxRows)
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50">
          <tr className="text-left text-xs uppercase tracking-wide text-slate-600">
            {result.columns.map((c) => (
              <th key={c.name} className="whitespace-nowrap px-3 py-2 font-medium">
                {c.name}
                <LineageBadge column={c.name} lineage={lineage} table={table} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t border-slate-100 hover:bg-slate-50">
              {result.columns.map((c) => (
                <td key={c.name} className={`whitespace-nowrap px-3 py-1.5 font-mono text-xs tabular-nums ${c.kind === 'number' || c.kind === 'integer' ? 'text-right' : ''}`}>
                  {formatCell(row[c.name], c.kind)}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td className="px-3 py-3 text-slate-500" colSpan={result.columns.length}>No rows.</td></tr>
          )}
        </tbody>
      </table>
      {result.rows.length > maxRows && (
        <div className="border-t border-slate-100 px-3 py-1.5 text-xs text-slate-500">Showing the first {maxRows} of {result.rows.length} rows.</div>
      )}
    </div>
  )
}
