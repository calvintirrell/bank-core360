import { useEffect, useState } from 'react'

const SEEN_KEY = 'bc360.tourSeen'

type Stop = { target: string; title: string; text: string; onEnter?: () => void }

const STOPS: Stop[] = [
  { target: '#overview', title: 'The problem', text: 'Two banks became one, but their systems did not. Two customer lists, two ways of writing everything. Every number below starts from that mess.' },
  { target: '#ask', title: 'Ask a question', text: 'Pick a ready question or type your own in plain English. Nothing to install, no SQL to write.' },
  {
    target: '#ask',
    title: 'Read the answer',
    text: 'You get a sentence and a headline figure. "Show how this was worked out" opens the exact query and the rows behind it. Here is a saved example.',
    onEnter: () => window.dispatchEvent(new CustomEvent('bc360:tour-ask')),
  },
  { target: '#customer360', title: 'One person, not two records', text: 'Every answer comes from this list, one entry per real person even when both banks had a record. Open anyone to see their accounts at each bank.' },
  { target: '#matching', title: 'Who should check what', text: 'Most duplicates were merged automatically. The ones the matching was not sure about were held for a person, with the reason shown. That is the governance.' },
]

function highlight(target: string | null) {
  document.querySelectorAll('[data-tour-hl]').forEach((el) => {
    el.classList.remove('ring-2', 'ring-violet-400', 'ring-offset-4', 'rounded-xl')
    el.removeAttribute('data-tour-hl')
  })
  if (!target) return
  const el = document.querySelector(target)
  if (!el) return
  el.setAttribute('data-tour-hl', '1')
  el.classList.add('ring-2', 'ring-violet-400', 'ring-offset-4', 'rounded-xl')
  el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

/** A five-stop walkthrough in a fixed bottom sheet; highlights and scrolls to each section. */
export function Tour({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [i, setI] = useState(0)
  useEffect(() => {
    if (!open) {
      highlight(null)
      return
    }
    setI(0)
  }, [open])
  useEffect(() => {
    if (!open) return
    const s = STOPS[i]
    highlight(s.target)
    s.onEnter?.()
  }, [open, i])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  const s = STOPS[i]
  const last = i === STOPS.length - 1
  return (
    <div role="dialog" aria-label="Guided tour" className="fixed inset-x-0 bottom-0 z-40 px-3 pb-3 sm:px-6 sm:pb-6">
      <div className="mx-auto max-w-2xl rounded-2xl border border-violet-200 bg-white p-4 shadow-2xl">
        <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
          <span>Show me around · {i + 1} of {STOPS.length}</span>
          <button type="button" onClick={onClose} className="hover:text-slate-800">Skip</button>
        </div>
        <div className="text-base font-semibold">{s.title}</div>
        <p className="mt-1 text-sm text-slate-700">{s.text}</p>
        <div className="mt-3 flex items-center justify-between gap-2">
          <button type="button" disabled={i === 0} onClick={() => setI(i - 1)} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-40">Back</button>
          <div className="flex gap-1">{STOPS.map((_, j) => <span key={j} className={`h-1.5 w-1.5 rounded-full ${j === i ? 'bg-violet-500' : 'bg-slate-300'}`} />)}</div>
          <button type="button" onClick={() => (last ? onClose() : setI(i + 1))} className="rounded-md bg-slate-900 px-4 py-1.5 text-sm font-medium text-white">{last ? 'Done' : 'Next'}</button>
        </div>
      </div>
    </div>
  )
}

/** First-visit offer in bank mode: a small banner under the header. */
export function TourOffer({ onStart }: { onStart: () => void }) {
  const [show, setShow] = useState(() => {
    try {
      return localStorage.getItem(SEEN_KEY) !== '1'
    } catch {
      return false
    }
  })
  function dismiss() {
    try {
      localStorage.setItem(SEEN_KEY, '1')
    } catch {
      /* ignore */
    }
    setShow(false)
  }
  if (!show) return null
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-violet-200 bg-violet-50 px-4 py-2 text-sm">
      <span>New here? A 60-second walk through the five things on this page.</span>
      <span className="flex gap-2">
        <button type="button" onClick={() => { dismiss(); onStart() }} className="rounded-md bg-slate-900 px-3 py-1 text-xs font-medium text-white">Show me around</button>
        <button type="button" onClick={dismiss} className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs">No thanks</button>
      </span>
    </div>
  )
}
