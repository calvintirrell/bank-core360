import type { Changes, Manifest, MatchReport } from '../lib/lakehouse'
import { useAsOf } from '../lib/AsOfContext'
import { useBankMode } from '../lib/ModeContext'
import { Stat } from './Section'
import { Term } from './Term'

const fmtDate = (iso?: string) =>
  iso ? new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '…'

export function Hero({ manifest, report, changes, latest }: { manifest: Manifest | null; report: MatchReport | null; changes: Changes | null; latest: Manifest | null }) {
  const bank = useBankMode()
  const { version, setVersion } = useAsOf()
  const money = (v: number) => `$${(v / 1e6).toFixed(1)}M`
  const customers = manifest?.export.customer_360.rows
  const sourceRecords = manifest ? manifest.bronze.core_a_custmast + manifest.bronze.core_b_customers : undefined
  const n = (v?: number) => v?.toLocaleString() ?? '…'
  return (
    <section id="overview" className="scroll-mt-20">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Bank Core 360</h1>
      {bank ? (
        <div className="mt-3 max-w-3xl space-y-2 text-slate-700">
          <p>
            <strong>Harbor Bank just acquired Riverside Bank.</strong> Each ran its own <Term k="core">core banking system</Term>, and the two disagree about almost
            everything: who the customers are, what an account is called, even how a date is written.
          </p>
          <p>
            This page is the first week after the deal. Both systems have been brought together, every customer <Term k="entity-resolution">resolved to one person</Term>, and
            any question can be asked in plain English, with a note on <Term k="lineage">where each number came from</Term>. All of it is synthetic data.
          </p>
        </div>
      ) : (
        <p className="mt-2 max-w-3xl text-slate-600">
          Two mismatched banking cores, one governed customer-360 lakehouse, queryable in plain English with lineage on every answer. Static site,
          runs free on GitHub Pages. All data is synthetic.
        </p>
      )}
      {latest?.versions && latest.versions.length > 1 && (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-600">{bank ? 'See the bank as of' : 'As of'}</span>
          <div className="flex items-center gap-1 rounded-full border border-slate-200 bg-white p-0.5">
            {latest.versions.map((v, i) => {
              const id = i === latest.versions!.length - 1 ? 'latest' : (`v${i}` as const)
              const on = version === id
              return (
                <button key={v.as_of} type="button" onClick={() => setVersion(id)} aria-pressed={on} className={`rounded-full px-3 py-1 text-xs font-medium ${on ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
                  {fmtDate(v.as_of)}
                </button>
              )
            })}
          </div>
          {!bank && manifest?.delta_versions && (
            <span className="text-xs text-slate-500">Delta version {Object.values(manifest.delta_versions)[0]} of every table · time travel via the *_v0 / *_latest views</span>
          )}
        </div>
      )}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {bank ? (
          <>
            <Stat label="customer records arrived" value={n(sourceRecords)} hint="from the two systems" />
            <Stat label="real people, once duplicates were resolved" value={n(customers)} hint="one row per person" />
            <Stat label="people were in both systems" value={n(report?.auto_merged)} hint="they would have been counted twice" />
            <Stat label="accounts" value={n(manifest?.export.account_360.rows)} hint="checking, savings, mortgages, CDs" />
            <Stat label="transactions" value={n(manifest?.export.transactions.rows)} hint="the last twelve months" />
            <Stat label="as of" value={fmtDate(manifest?.as_of)} hint="every 'quiet' or 'recent' is measured from this date" />
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
      {changes && version === 'latest' && (
        <div className="mt-4 rounded-xl border border-violet-200 bg-violet-50 p-4 text-sm">
          <div className="mb-1 text-xs uppercase tracking-wide text-violet-800">What changed since {fmtDate(changes.from_as_of)}</div>
          <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3 text-slate-800">
            <li><b>{changes.new_customers}</b> new customers joined, bringing {changes.new_accounts} new accounts.</li>
            <li><b>{changes.customers_merged_by_reviewer}</b> possible duplicates were confirmed by a reviewer and merged; <b>{changes.pairs_rejected_by_reviewer}</b> were rejected as different people.</li>
            <li>The review queue went from {changes.review_queue_before} to <b>{changes.review_queue_after}</b>.</li>
            <li>
              <b>{changes.checking_accounts_went_quiet ?? changes.accounts_went_quiet}</b> checking accounts went quiet and{' '}
              <b>{changes.checking_accounts_woke_up ?? changes.accounts_woke_up}</b> woke up
              {changes.checking_accounts_went_quiet != null && ` (${changes.accounts_went_quiet} and ${changes.accounts_woke_up} across every product)`}.
            </li>
            <li><b>{changes.address_changes}</b> customers changed address.</li>
            <li>{changes.transactions_in_new_month.toLocaleString()} transactions in the new month; deposits {money(changes.deposits_before)} → <b>{money(changes.deposits_after)}</b>.</li>
          </ul>
          <button type="button" onClick={() => setVersion('v0')} className="mt-2 text-xs text-violet-800 underline">See the page as it was on {fmtDate(changes.from_as_of)}</button>
        </div>
      )}
      {version !== 'latest' && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          You are looking at the bank as of {fmtDate(manifest?.as_of)}: the first load, before the second month arrived. Every table, answer and check on this page is from that version.
          <button type="button" onClick={() => setVersion('latest')} className="ml-2 underline">Back to today</button>
        </div>
      )}
    </section>
  )
}
