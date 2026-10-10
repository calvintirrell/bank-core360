import type { Manifest, MatchReport } from '../lib/lakehouse'
import { Stat } from './Section'

export function Hero({ manifest, report }: { manifest: Manifest | null; report: MatchReport | null }) {
  const customers = manifest?.export.customer_360.rows
  const sourceRecords = manifest ? manifest.bronze.core_a_custmast + manifest.bronze.core_b_customers : undefined
  return (
    <section id="overview" className="scroll-mt-20">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Bank Core 360</h1>
      <p className="mt-2 max-w-3xl text-slate-600">
        Two mismatched banking cores, one governed customer-360 lakehouse, queryable in plain English with lineage on every answer.
        Static site, runs free on GitHub Pages. All data is synthetic.
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Source customer records" value={sourceRecords?.toLocaleString() ?? '…'} hint="across two cores" />
        <Stat label="Resolved customers" value={customers?.toLocaleString() ?? '…'} hint="one row per person" />
        <Stat label="Cross-core merges" value={report?.auto_merged.toLocaleString() ?? '…'} hint={report ? `precision ${(report.precision * 100).toFixed(0)}%` : ''} />
        <Stat label="Accounts" value={manifest?.export.account_360.rows.toLocaleString() ?? '…'} />
        <Stat label="Transactions" value={manifest?.export.transactions.rows.toLocaleString() ?? '…'} />
        <Stat label="As of" value={manifest?.as_of ?? '…'} hint="dormancy and recency rules" />
      </div>
    </section>
  )
}
