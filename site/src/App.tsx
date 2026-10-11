import { useEffect, useState } from 'react'
import { AgentPanel } from './components/AgentPanel'
import { Architecture } from './components/Architecture'
import { Collapsible } from './components/Collapsible'
import { Cores } from './components/Cores'
import { Decisions } from './components/Decisions'
import { Mismatches } from './components/Mismatches'
import { Customer360 } from './components/Customer360'
import { Footer } from './components/Footer'
import { Hero } from './components/Hero'
import { MatchReport } from './components/MatchReport'
import { ModeToggle } from './components/ModeToggle'
import { QualityPanel } from './components/Quality'
import { SqlConsole } from './components/SqlConsole'
import { Tour, TourOffer } from './components/Tour'
import { loadLakehouse, type Lakehouse } from './lib/lakehouse'
import { ModeProvider, useBankMode } from './lib/ModeContext'
import { AsOfProvider, useAsOf, versionDir } from './lib/AsOfContext'
import { selectVersion } from './lib/duckdb'

const NAV_BANK = [
  ['#ask', 'Ask'],
  ['#customer360', 'Customers'],
  ['#matching', 'Matching'],
  ['#quality', 'Checks'],
  ['#sql', 'Analyst SQL'],
  ['#cores', 'Raw feeds'],
  ['#architecture', 'How it\'s built'],
] as const
const NAV_TECH = [
  ['#ask', 'Ask'],
  ['#customer360', 'Customer 360'],
  ['#matching', 'Matching'],
  ['#quality', 'Checks'],
  ['#sql', 'SQL'],
  ['#cores', 'The two cores'],
  ['#architecture', 'Architecture'],
] as const

export default function App() {
  return (
    <ModeProvider>
      <AsOfProvider>
        <Shell />
      </AsOfProvider>
    </ModeProvider>
  )
}

function Shell() {
  const bank = useBankMode()
  const { version } = useAsOf()
  const [lh, setLh] = useState<Lakehouse | null>(null)
  const [error, setError] = useState('')
  const [tour, setTour] = useState(false)
  const [ready, setReady] = useState(0)
  useEffect(() => {
    let cancelled = false
    setLh(null)
    Promise.all([loadLakehouse(versionDir(version)), selectVersion(version)])
      .then(([data]) => {
        if (cancelled) return
        setLh(data)
        setReady((n) => n + 1)
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
    return () => {
      cancelled = true
    }
  }, [version])
  const nav = bank ? NAV_BANK : NAV_TECH

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
        <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-sm">
          <a href="#overview" className="mr-2 font-semibold tracking-tight">Bank Core 360</a>
          {nav.map(([href, label]) => (
            <a key={href} href={href} className="text-slate-600 hover:text-slate-900">{label}</a>
          ))}
          {bank && (
            <button type="button" onClick={() => setTour(true)} className="rounded-full border border-violet-300 bg-violet-50 px-3 py-1 text-xs font-medium text-violet-900 hover:bg-violet-100">
              Show me around
            </button>
          )}
          <ModeToggle />
        </nav>
      </header>
      <main className="mx-auto max-w-6xl space-y-12 px-4 py-8">
        {error && <pre className="rounded-md bg-red-50 p-3 text-xs text-red-700">Could not load the lakehouse exports: {error}</pre>}
        {bank && !tour && <TourOffer onStart={() => setTour(true)} />}
        <Hero manifest={lh?.manifest ?? null} report={lh?.matchReport ?? null} changes={lh?.changes ?? null} latest={lh?.latest ?? null} />
        <AgentPanel key={`ask-${ready}`} lineage={lh?.lineage ?? null} />
        <Customer360 key={`c360-${ready}`} lineage={lh?.lineage ?? null} />
        {bank ? <Decisions key={`dec-${ready}`} report={lh?.matchReport ?? null} /> : <MatchReport key={`mr-${ready}`} report={lh?.matchReport ?? null} />}
        <QualityPanel />
        <Collapsible
          id="sql"
          title={bank ? 'For analysts: run your own SQL' : 'SQL console'}
          teaser="Every answer on this page is a query over the same tables. Analysts can write their own here, in the browser."
          defaultOpen={!bank}
        >
          <SqlConsole key={`sql-${ready}`} lineage={lh?.lineage ?? null} embedded />
        </Collapsible>
        <Collapsible
          id="cores"
          title={bank ? 'What the bank handed us' : 'Two cores that disagree'}
          teaser={bank ? 'The same facts, written two different ways by the two banks. See the actual rows.' : "The two systems' raw files, exactly as received: different ids, date formats, product codes and currencies."}
          defaultOpen={!bank}
        >
          {bank ? (
            <Mismatches samples={lh?.rawSamples ?? null}>
              <Cores samples={lh?.rawSamples ?? null} lineage={lh?.lineage ?? null} embedded />
            </Mismatches>
          ) : (
            <Cores samples={lh?.rawSamples ?? null} lineage={lh?.lineage ?? null} embedded />
          )}
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
      <Tour open={tour} onClose={() => setTour(false)} />
    </div>
  )
}
