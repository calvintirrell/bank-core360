import type { ReactNode } from 'react'

export function Section({ id, title, subtitle, children }: { id: string; title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      {subtitle && <p className="mt-1 mb-4 text-sm text-slate-600">{subtitle}</p>}
      {children}
    </section>
  )
}

export function Card({ title, children, className = '' }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm ${className}`}>
      {title && <h3 className="mb-2 text-sm font-semibold">{title}</h3>}
      {children}
    </div>
  )
}

export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
      <div className="text-xs text-slate-600">{label}</div>
      {hint && <div className="text-[11px] text-slate-400">{hint}</div>}
    </div>
  )
}
