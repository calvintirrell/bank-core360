import { WhyItMatters } from './WhyItMatters'
import type { Lineage } from '../lib/lineage'
import type { RawSample, RawSamples } from '../lib/lakehouse'
import { Card, Section } from './Section'

function SampleTable({ name, sample }: { name: string; sample: RawSample }) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="font-mono text-xs font-semibold">{name}</span>
        <span className="text-[11px] text-slate-500">{sample.total_rows.toLocaleString()} rows</span>
      </div>
      <div className="overflow-x-auto rounded border border-slate-200">
        <table className="min-w-full text-[11px]">
          <thead className="bg-slate-50">
            <tr>{sample.columns.map((c) => <th key={c} className="whitespace-nowrap px-2 py-1 text-left font-mono font-medium text-slate-600">{c}</th>)}</tr>
          </thead>
          <tbody>
            {sample.rows.map((r, i) => (
              <tr key={i} className="border-t border-slate-100">
                {r.map((v, j) => <td key={j} className="max-w-[16rem] truncate whitespace-nowrap px-2 py-1 font-mono text-slate-800" title={v}>{v}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function Cores({ samples, lineage, embedded }: { samples: RawSamples | null; lineage: Lineage | null; embedded?: boolean }) {
  const systems: Array<{ id: 'core_a' | 'core_b'; badge: string; color: string }> = [
    { id: 'core_a', badge: 'A', color: 'border-amber-300 bg-amber-50' },
    { id: 'core_b', badge: 'B', color: 'border-sky-300 bg-sky-50' },
  ]
  return (
    <Section id="cores" embedded={embedded} title="Two cores that disagree" subtitle="Where it all started: the same bank after an acquisition, with a legacy in-house core and the acquired bank's core, each with its own ids, formats and product codes. These are the feeds exactly as landed in bronze.">
      <div className="grid gap-4 md:grid-cols-2">
        {systems.map((s) => (
          <Card key={s.id} className={s.color}>
            <div className="mb-1 flex items-center gap-2">
              <span className="rounded border border-current px-1.5 font-mono text-xs font-bold">{s.badge}</span>
              <h3 className="text-sm font-semibold">{lineage?.systems[s.id].label ?? s.id}</h3>
            </div>
            <p className="mb-3 text-xs text-slate-700">{lineage?.systems[s.id].conventions}</p>
            <div className="space-y-3">
              {samples && Object.entries(samples[s.id]).map(([name, sample]) => <SampleTable key={name} name={name} sample={sample} />)}
            </div>
          </Card>
        ))}
      </div>
      <WhyItMatters id="cores" />
    </Section>
  )
}
