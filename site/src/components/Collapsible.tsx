import { useEffect, useState, type ReactNode } from 'react'

/** A section that starts collapsed in bank mode and open in tech mode, with a one-line teaser. */
export function Collapsible({ id, title, teaser, defaultOpen, children }: { id: string; title: string; teaser?: string; defaultOpen: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  useEffect(() => setOpen(defaultOpen), [defaultOpen])
  return (
    <section id={id} className="scroll-mt-20">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-start justify-between gap-3 text-left"
      >
        <span>
          <span className="block text-xl font-semibold tracking-tight">{title}</span>
          {teaser && !open && <span className="mt-1 block text-sm text-slate-600">{teaser}</span>}
        </span>
        <span className="mt-1 shrink-0 rounded-full border border-slate-300 px-2 py-0.5 text-xs text-slate-600">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && <div className="mt-3">{children}</div>}
    </section>
  )
}
