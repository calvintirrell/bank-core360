import { useEffect, useRef, useState, type ReactNode } from 'react'
import { GLOSSARY, type GlossaryKey } from '../lib/glossary'

/** An underlined term with a definition on hover, focus or tap. */
export function Term({ k, children }: { k: GlossaryKey; children?: ReactNode }) {
  const g = GLOSSARY[k]
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
  const ref = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    window.addEventListener('scroll', close, true)
    document.addEventListener('keydown', (e) => e.key === 'Escape' && close())
    return () => window.removeEventListener('scroll', close, true)
  }, [open])
  function show() {
    const r = ref.current!.getBoundingClientRect()
    setPos({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - 300)) })
    setOpen(true)
  }
  return (
    <>
      <button
        ref={ref}
        type="button"
        onMouseEnter={show}
        onMouseLeave={() => setOpen(false)}
        onFocus={show}
        onBlur={() => setOpen(false)}
        onClick={() => (open ? setOpen(false) : show())}
        className="cursor-help border-b border-dotted border-slate-500 bg-transparent p-0 text-inherit"
        aria-describedby={open ? `term-${k}` : undefined}
      >
        {children ?? g.term}
      </button>
      {open && (
        <span id={`term-${k}`} role="tooltip" style={{ position: 'fixed', top: pos.top, left: pos.left, width: 290 }} className="z-50 block rounded-lg border border-slate-200 bg-white p-3 text-left text-xs leading-relaxed text-slate-800 shadow-xl">
          <span className="mb-1 block font-semibold">{g.term}</span>
          {g.definition}
        </span>
      )}
    </>
  )
}
