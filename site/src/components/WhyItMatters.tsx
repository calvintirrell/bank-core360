import { useState } from 'react'

const WHY: Record<string, { problem: string; decision: string; tradeoff: string }> = {
  ask: {
    problem: 'Questions about customers wait in an IT ticket queue for days, so most never get asked.',
    decision: 'Lets a branch or operations lead act on a question the same hour, with the working shown.',
    tradeoff: 'Live questions are capped per day on this shared demo. A product would meter the data under management, not the questions, so people keep asking.',
  },
  customer360: {
    problem: 'Two customer lists after an acquisition means one person counted twice and two versions of their details.',
    decision: 'Who to contact, which record to trust, and what each person actually holds with the bank.',
    tradeoff: 'When the banks disagree, the acquired bank\'s newer details win. A product would let the bank choose that rule per field.',
  },
  matching: {
    problem: 'A wrong merge is worse than a missed one: it mixes two people\'s money and mail.',
    decision: 'Which pairs a human must confirm before they are merged, and in what order.',
    tradeoff: 'Merging automatically at 80% confidence. Higher means more manual review; lower means more risk. That number is a policy, not a constant.',
  },
  sql: {
    problem: 'Analysts rebuild the same joins in spreadsheets and nobody can reproduce last month\'s number.',
    decision: 'One shared set of tables that every report and every answer on this page uses.',
    tradeoff: 'Everything runs in the browser, so the data is kept small. A product would run the same SQL against the bank\'s warehouse.',
  },
  cores: {
    problem: 'Every acquisition or core conversion brings a system that disagrees with yours about formats and codes.',
    decision: 'What to standardise first, and what to leave exactly as received for audit.',
    tradeoff: 'The raw files are kept untouched and standardised downstream. That doubles storage but keeps a trail from any number back to a file the bank handed over.',
  },
  architecture: {
    problem: 'Pipelines that only run on one laptop cannot be trusted or handed over.',
    decision: 'Whether every number can be rebuilt from the sources, by anyone, the same way.',
    tradeoff: 'Rebuilding everything on every change is simple and auditable but will not scale past a few million rows. A product would load changes incrementally.',
  },
}

/** The product-manager lens on a section: the problem, the decision it supports, one trade-off. Collapsed by default. */
export function WhyItMatters({ id }: { id: keyof typeof WHY }) {
  const [open, setOpen] = useState(false)
  const w = WHY[id]
  if (!w) return null
  return (
    <div className="mt-4">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-100">
        {open ? 'Hide why this matters' : 'Why this matters'}
      </button>
      {open && (
        <dl className="mt-2 grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm sm:grid-cols-3">
          <div><dt className="text-xs uppercase tracking-wide text-slate-500">The problem</dt><dd className="text-slate-700">{w.problem}</dd></div>
          <div><dt className="text-xs uppercase tracking-wide text-slate-500">The decision it supports</dt><dd className="text-slate-700">{w.decision}</dd></div>
          <div><dt className="text-xs uppercase tracking-wide text-slate-500">One trade-off</dt><dd className="text-slate-700">{w.tradeoff}</dd></div>
        </dl>
      )}
    </div>
  )
}
