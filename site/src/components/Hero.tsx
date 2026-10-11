import type { Manifest, MatchReport } from '../lib/lakehouse'
import { useBankMode } from '../lib/ModeContext'
import { Stat } from './Section'

const fmtDate = (iso?: string) =>
  iso ? new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '…'

export function Hero({ manifest, report }: { manifest: Manifest | null; report: MatchReport | null }) {
  const bank = useBankMode()
  const customers = manifest?.export.customer_360.rows
  const sourceRecords = manifest ? manifest.bronze.core_a_custmast + manifest.bronze.core_b_customers : undefined
  const n = (v?: number) => v?.toLocaleString() ?? '…'
  return (
    <section id="overview" className="scroll-mt-20">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Bank Core 360</h1>
      {bank ? (
        <div className="mt-3 max-w-3xl space-y-2 text-slate-700">
          <p>
            <strong>Harbor Bank just acquired Riverside Bank.</strong> Each ran its own core banking system, and the two disagree about almost
            everything: who the customers are, what an account is called, even how a date is written.
          </p>
          <p>
            This page is the first week after the deal. Both systems have been brought together, every customer resolved to one person, and
            any question can be asked in plain English, with a note on where each number came from. All of it is synthetic data.
          </p>
        </div>
      ) : (
        <p className="mt-2 max-w-3xl text-slate-600">
          Two mismatched banking cores, one governed customer-360 lakehouse, queryable in plain English with lineage on every answer. Static site,
          runs free on GitHub Pages. All data is synthetic.
        </p>
      )}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {bank ? (
          <>
            <Stat label="customer records arrived" value={n(sourceRecords)} hint="from the two systems" />
            <Stat label="real people, once duplicates were resolved" value={n(customers)} hint="one row per person" />
            <Stat label="people were in both systems" value={n(report?.auto_merged)} hint="they would have been counted twice" />
            <Stat label="accounts" value={n(manifest?.export.account_360.rows)} hint="checking, savings, mortgages, CDs" />
            <Stat label="transactions" value={n(manifest?.export.transactions.rows)} hint="the last twelve months" />
            <Stat label="as of" value={fmtDate(manifest?.as_of)} hint="every 'dormant' or 'recent' is measured from here" />
          </>
        ) : (
          <>
            <Stat label="Source customer records" value={n(sourceRecords)} hint="across two cores" />
            <Stat label="Resolved customers" value={n(customers)} hint="one row per person" />
            <Stat label="Cross-core merges" value={n(report?.auto_merged)} hint={report ? `precision ${(report.precision * 100).toFixed(0)}%` : ''} />
            <Stat label="Accounts" value={n(manifest?.export.account_360.rows)} />
            <Stat label="Transactions" value={n(manifest?.export.transactions.rows)} />
            <Stat label="As of" value={manifest?.as_of ?? '…'} hint="dormancy and recency rules" />
          </>
        )}
      </div>
    </section>
  )
}
