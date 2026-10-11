import type { Headline } from '../lib/agent'

const num = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })
const pretty = (s: string) => s.replace(/_/g, ' ')

/** One number, or one small single-series bar chart. Single hue, text in ink, no legend (one series). */
export function HeadlineView({ h }: { h: Headline }) {
  if (h.kind === 'number') {
    return (
      <div className="flex items-baseline gap-3">
        <span className="text-4xl font-semibold tabular-nums tracking-tight">{num.format(h.value)}</span>
        <span className="text-sm text-slate-600">{pretty(h.label)}</span>
      </div>
    )
  }
  const max = Math.max(...h.bars.map((b) => Math.abs(b.value)), 1)
  const rowH = 22
  const labelW = 150
  const chartW = 420
  const width = labelW + chartW + 70
  const height = h.bars.length * rowH + 6
  return (
    <figure className="w-full max-w-2xl">
      <figcaption className="mb-1 text-xs text-slate-600">
        {pretty(h.valueName)} by {pretty(h.categoryName)}
      </figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label={h.label}>
        <line x1={labelW} y1={0} x2={labelW} y2={height} stroke="#cbd5e1" strokeWidth={1} />
        {h.bars.map((b, i) => {
          const y = i * rowH + 3
          const w = Math.max(2, (Math.abs(b.value) / max) * chartW)
          return (
            <g key={b.category} className="group">
              <title>{`${b.category}: ${num.format(b.value)}`}</title>
              <text x={labelW - 8} y={y + 12} textAnchor="end" fontSize={11} fill="#334155" className="font-mono">
                {b.category.length > 22 ? b.category.slice(0, 21) + '…' : b.category}
              </text>
              <rect x={labelW} y={y} width={w} height={rowH - 8} rx={4} fill="#475569" className="transition group-hover:fill-slate-900" />
              <text x={labelW + w + 6} y={y + 12} fontSize={11} fill="#334155" className="tabular-nums">
                {Math.abs(b.value) >= 10000 ? compact.format(b.value) : num.format(b.value)}
              </text>
            </g>
          )
        })}
      </svg>
    </figure>
  )
}
