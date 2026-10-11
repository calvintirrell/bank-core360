import { Section } from './Section'

const STEPS: Array<{ title: string; detail: string; tone: string }> = [
  { title: 'Core A + Core B', detail: 'Raw feeds: pipe-delimited extracts and JSON lines, mismatched ids, dates and product codes', tone: 'border-amber-300 bg-amber-50' },
  { title: 'Bronze', detail: '6 Delta tables, landed untouched with ingest metadata', tone: 'border-orange-300 bg-orange-50' },
  { title: 'Silver', detail: 'One schema per entity: parsed dates, signed amounts, canonical products, name keys', tone: 'border-slate-300 bg-slate-50' },
  { title: 'Match', detail: 'Entity resolution across cores: deterministic tier, fuzzy tier with confidence, review queue', tone: 'border-violet-300 bg-violet-50' },
  { title: 'Gold', detail: 'customer_360 and account_360 as Delta, with survivorship and dormancy rules', tone: 'border-yellow-300 bg-yellow-50' },
  { title: 'Export + lineage', detail: 'Parquet for the browser, lineage.json mapping every column to its source and rule', tone: 'border-emerald-300 bg-emerald-50' },
  { title: 'Browser', detail: 'DuckDB-WASM runs SQL over the gold Parquet on this page', tone: 'border-sky-300 bg-sky-50' },
  { title: 'Agent', detail: 'Claude writes the SQL, runs it here, explains the answer, with lineage on every column', tone: 'border-pink-300 bg-pink-50' },
]

export function Architecture({ embedded }: { embedded?: boolean }) {
  return (
    <Section id="architecture" embedded={embedded} title="Architecture" subtitle="For the engineers: a medallion lakehouse built in Python on every push by GitHub Actions. The outputs, including the Delta transaction logs, are committed so anyone can open them.">
      <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((s, i) => (
          <li key={s.title} className={`relative rounded-xl border p-3 ${s.tone}`}>
            <div className="mb-0.5 flex items-center gap-2">
              <span className="rounded-full bg-white/80 px-1.5 font-mono text-[10px] font-bold text-slate-700">{i + 1}</span>
              <span className="text-sm font-semibold">{s.title}</span>
            </div>
            <p className="text-xs text-slate-700">{s.detail}</p>
            {i < STEPS.length - 1 && <span className="absolute -right-2 top-1/2 hidden -translate-y-1/2 text-slate-400 lg:inline">→</span>}
          </li>
        ))}
      </ol>
      <p className="mt-3 text-xs text-slate-500">
        Pipeline: Python 3.12, Polars, delta-rs. Hosting: GitHub Pages, static. Query engine: DuckDB-WASM. Everything on this page is synthetic; no real customers.
      </p>
    </Section>
  )
}
