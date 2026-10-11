import { useEffect, useState } from 'react'
import { dataUrl } from '../lib/duckdb'
import { useBankMode } from '../lib/ModeContext'
import { Section } from './Section'
import { WhyItMatters } from './WhyItMatters'

type Check = { id: string; title: string; plain: string; sql: string | null; value: unknown; expected: unknown; passed: boolean; detail?: string }
type Quality = { as_of: string; passed: boolean; checks: Check[] }

const fmt = (v: unknown) => (typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v))

/** The data-quality checks the pipeline ran on this build. Bank mode: sentences; tech mode: SQL and values. */
export function QualityPanel() {
  const bank = useBankMode()
  const [q, setQ] = useState<Quality | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  useEffect(() => {
    fetch(dataUrl('quality.json'))
      .then((r) => (r.ok ? r.json() : null))
      .then(setQ)
      .catch(() => setQ(null))
  }, [])
  if (!q) return null
  const passed = q.checks.filter((c) => c.passed).length
  return (
    <Section
      id="quality"
      title={bank ? 'Can these numbers be trusted?' : 'Data-quality checks'}
      subtitle={
        bank
          ? `${passed} of ${q.checks.length} checks passed on this build. The pipeline refuses to publish if any fails.`
          : `${passed} of ${q.checks.length} checks passed. Enforced in the pipeline: a failing check raises and CI never commits the data.`
      }
    >
      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
        {q.checks.map((c) => (
          <li key={c.id} className="px-4 py-3">
            <div className="flex items-start gap-3">
              <span className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${c.passed ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`} aria-label={c.passed ? 'passed' : 'failed'}>
                {c.passed ? '✓' : '✗'}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{c.title}</div>
                <div className="text-sm text-slate-600">{c.plain}</div>
                {!bank && (
                  <div className="mt-1 text-xs text-slate-500">
                    <span className="font-mono">{c.id}</span> · value {fmt(c.value)} · expected {fmt(c.expected)}
                    {c.detail && ` · ${c.detail}`}
                    {c.sql && (
                      <button type="button" onClick={() => setOpenId(openId === c.id ? null : c.id)} className="ml-2 underline">
                        {openId === c.id ? 'hide SQL' : 'SQL'}
                      </button>
                    )}
                  </div>
                )}
                {!bank && openId === c.id && c.sql && (
                  <pre className="mt-2 overflow-x-auto rounded-md bg-slate-950 p-2 font-mono text-[11px] leading-snug text-slate-100">{c.sql.replace(/\s+/g, ' ').trim()}</pre>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
      <WhyItMatters id="quality" />
    </Section>
  )
}
