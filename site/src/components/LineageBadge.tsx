import { useEffect, useRef, useState } from 'react'
import { badgeText, lookupColumn, systemsOf, systemsSentence, type Lineage } from '../lib/lineage'
import { useBankMode } from '../lib/ModeContext'

const COLORS: Record<string, string> = {
  A: 'bg-amber-100 text-amber-900 border-amber-300',
  B: 'bg-sky-100 text-sky-900 border-sky-300',
  'A+B': 'bg-violet-100 text-violet-900 border-violet-300',
  derived: 'bg-slate-100 text-slate-600 border-slate-300',
}

const CARD_W = 300

/** Small source-system badge next to a column name; click for the full lineage card.
 *  The card is position:fixed so it is never clipped by a scrolling table container. */
export function LineageBadge({ column, lineage, table }: { column: string; lineage: Lineage | null; table?: string }) {
  const bank = useBankMode()
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const card = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!pos) return
    const onDown = (e: MouseEvent) => {
      if (card.current?.contains(e.target as Node) || btn.current?.contains(e.target as Node)) return
      setPos(null)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPos(null)
    const onScroll = () => setPos(null)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [pos])

  if (!lineage) return null
  const hit = lookupColumn(lineage, column, table)
  const text = hit ? badgeText(systemsOf(hit.lineage)) : 'derived'
  const title = hit ? `${hit.table}.${column}: ${hit.lineage.transform}` : 'Computed in this query, not a lakehouse column'

  function toggle() {
    if (pos) return setPos(null)
    const r = btn.current!.getBoundingClientRect()
    const left = Math.max(8, Math.min(r.left, window.innerWidth - CARD_W - 8))
    setPos({ top: r.bottom + 6, left })
  }

  return (
    <>
      <button
        ref={btn}
        type="button"
        onClick={toggle}
        title={title}
        className={`ml-1 rounded border px-1 text-[10px] font-semibold leading-4 ${COLORS[text]}`}
        aria-label={`lineage for ${column}`}
        aria-expanded={!!pos}
      >
        {text}
      </button>
      {pos && (
        <div
          ref={card}
          role="dialog"
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: CARD_W }}
          className="z-50 rounded-lg border border-slate-200 bg-white p-3 text-left text-xs font-normal normal-case tracking-normal text-slate-800 shadow-xl"
        >
          <div className="mb-1 flex items-start justify-between gap-2">
            <span className={bank ? 'font-semibold' : 'font-mono font-semibold'}>{bank ? column.replace(/_/g, ' ') : hit ? `${hit.table}.${column}` : column}</span>
            <button type="button" onClick={() => setPos(null)} className="text-slate-400 hover:text-slate-700" aria-label="close">×</button>
          </div>
          {hit && bank ? (
            <div className="space-y-1 text-slate-700">
              <p>{systemsSentence(lineage, systemsOf(hit.lineage))}</p>
              {hit.lineage.plain && <p>{hit.lineage.plain}</p>}
            </div>
          ) : hit ? (
            <>
              <div className="mb-1 text-slate-600">{hit.lineage.transform}</div>
              <ul className="mb-1 space-y-0.5">
                {hit.lineage.sources.map((s, i) => (
                  <li key={i} className="font-mono">
                    <span className={`mr-1 rounded border px-1 ${COLORS[s.system === 'core_a' ? 'A' : 'B']}`}>{s.system === 'core_a' ? 'A' : 'B'}</span>
                    {s.table}.{s.field}
                  </li>
                ))}
              </ul>
              {hit.lineage.rules.length > 0 && (
                <ul className="space-y-0.5 border-t border-slate-100 pt-1 text-slate-600">
                  {hit.lineage.rules.map((r) => (
                    <li key={r}><span className="font-mono text-slate-800">{r}</span> {lineage.rules[r]}</li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <div className="text-slate-600">{bank ? 'Worked out in this answer from the columns above, not stored anywhere.' : 'Computed in this query (aggregate or expression), not a lakehouse column.'}</div>
          )}
        </div>
      )}
    </>
  )
}
