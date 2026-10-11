import { useEffect, useState } from 'react'
import { AgentPanel } from './components/AgentPanel'
import { Architecture } from './components/Architecture'
import { Collapsible } from './components/Collapsible'
import { Cores } from './components/Cores'
import { Customer360 } from './components/Customer360'
import { Footer } from './components/Footer'
import { Hero } from './components/Hero'
import { MatchReport } from './components/MatchReport'
import { ModeToggle } from './components/ModeToggle'
import { SqlConsole } from './components/SqlConsole'
import { loadLakehouse, type Lakehouse } from './lib/lakehouse'
import { ModeProvider, useBankMode } from './lib/ModeContext'

const NAV_BANK = [
  ['#ask', 'Ask'],
  ['#customer360', 'Customers'],
  ['#matching', 'Matching'],
  ['#sql', 'Analyst SQL'],
  ['#cores', 'Raw feeds'],
  ['#architecture', 'How it\'s built'],
] as const
const NAV_TECH = [
  ['#ask', 'Ask'],
  ['#customer360', 'Customer 360'],
  ['#matching', 'Matching'],
  ['#sql', 'SQL'],
  ['#cores', 'The two cores'],
  ['#architecture', 'Architecture'],
] as const

export default function App() {
  return (
    <ModeProvider>
      <Shell />
    </ModeProvider>
  )
}

function Shell() {
  const bank = useBankMode()
  const [lh, setLh] = useState<Lakehouse | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    loadLakehouse().then(setLh).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [])
  const nav = bank ? NAV_BANK : NAV_TECH

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
        <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-sm">
          <a href="#overview" className="mr-2 font-semibold tracking-tight">Bank Core 360</a>
          {nav.map(([href, label]) => (
            <a key={href} href={href} className="text-slate-600 hover:text-slate-900">{label}</a>
          ))}
          <ModeToggle />
        </nav>
      </header>
      <main className="mx-auto max-w-6xl space-y-12 px-4 py-8">
        {error && <pre className="rounded-md bg-red-50 p-3 text-xs text-red-700">Could not load the lakehouse exports: {error}</pre>}
        <Hero manifest={lh?.manifest ?? null} report={lh?.matchReport ?? null} />
        <AgentPanel lineage={lh?.lineage ?? null} />
        <Customer360 lineage={lh?.lineage ?? null} />
        <MatchReport report={lh?.matchReport ?? null} />
        <Collapsible
          id="sql"
          title={bank ? 'For analysts: run your own SQL' : 'SQL console'}
          teaser="Every answer on this page is a query over the same tables. Analysts can write their own here, in the browser."
          defaultOpen={!bank}
        >
          <SqlConsole lineage={lh?.lineage ?? null} embedded />
        </Collapsible>
        <Collapsible
          id="cores"
          title={bank ? 'What the bank handed us' : 'Two cores that disagree'}
          teaser="The two systems' raw files, exactly as received: different ids, date formats, product codes and currencies."
          defaultOpen={!bank}
        >
          <Cores samples={lh?.rawSamples ?? null} lineage={lh?.lineage ?? null} embedded />
        </Collapsible>
        <Collapsible
          id="architecture"
          title={bank ? "How it's built" : 'Architecture'}
          teaser="A Python pipeline rebuilds the lakehouse on every change; the page queries it in your browser. For the engineers."
          defaultOpen={!bank}
        >
          <Architecture embedded />
        </Collapsible>
        <Footer />
      </main>
    </div>
  )
}
