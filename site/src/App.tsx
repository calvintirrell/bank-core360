import { useEffect, useState } from 'react'
import { AgentPanel } from './components/AgentPanel'
import { Architecture } from './components/Architecture'
import { Cores } from './components/Cores'
import { Customer360 } from './components/Customer360'
import { Footer } from './components/Footer'
import { Hero } from './components/Hero'
import { MatchReport } from './components/MatchReport'
import { SqlConsole } from './components/SqlConsole'
import { loadLakehouse, type Lakehouse } from './lib/lakehouse'

const NAV = [
  ['#overview', 'Overview'],
  ['#architecture', 'Architecture'],
  ['#cores', 'The two cores'],
  ['#customer360', 'Customer 360'],
  ['#matching', 'Matching'],
  ['#sql', 'SQL'],
  ['#ask', 'Ask'],
] as const

export default function App() {
  const [lh, setLh] = useState<Lakehouse | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    loadLakehouse().then(setLh).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
        <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-sm">
          <a href="#overview" className="mr-2 font-semibold tracking-tight">Bank Core 360</a>
          {NAV.slice(1).map(([href, label]) => (
            <a key={href} href={href} className="text-slate-600 hover:text-slate-900">{label}</a>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl space-y-12 px-4 py-8">
        {error && <pre className="rounded-md bg-red-50 p-3 text-xs text-red-700">Could not load the lakehouse exports: {error}</pre>}
        <Hero manifest={lh?.manifest ?? null} report={lh?.matchReport ?? null} />
        <Architecture />
        <Cores samples={lh?.rawSamples ?? null} lineage={lh?.lineage ?? null} />
        <Customer360 lineage={lh?.lineage ?? null} />
        <MatchReport report={lh?.matchReport ?? null} />
        <SqlConsole lineage={lh?.lineage ?? null} />
        <AgentPanel lineage={lh?.lineage ?? null} />
        <Footer />
      </main>
    </div>
  )
}
