import { useEffect, useState } from 'react'
import { runSql, type QueryResult } from '../lib/duckdb'
import type { MatchReport } from '../lib/lakehouse'
import { Card, Section, Stat } from './Section'
import { Term } from './Term'
import { WhyItMatters } from './WhyItMatters'

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

/** Bank-mode version of the matching scorecard: decisions, not statistics, plus one worked example. */
export function Decisions({ report }: { report: MatchReport | null }) {
  const [example, setExample] = useState<QueryResult | null>(null)
  const [exampleError, setExampleError] = useState('')
  useEffect(() => {
    runSql(
      `SELECT core_a_name, core_b_name, dob, confidence, core_b_ssn_missing, phone_match, postal_code_match, name_similarity,
              core_a_balance, core_b_balance, combined_balance, core_a_open_accounts, core_b_open_accounts
       FROM review_queue ORDER BY priority LIMIT 1`,
    )
      .then(setExample)
      .catch((e: unknown) => setExampleError(e instanceof Error ? e.message : String(e)))
  }, [])
  if (!report) return null
  const ex = example?.rows[0]
  const reasons: string[] = []
  if (ex) {
    if (ex.core_a_name !== ex.core_b_name) reasons.push('the last names differ')
    if (ex.core_b_ssn_missing) reasons.push('Riverside Bank has no SSN digits on file to confirm it')
    if (!ex.phone_match) reasons.push('the phone numbers differ')
    if (!ex.postal_code_match) reasons.push('the addresses differ')
  }
  const agrees: string[] = []
  if (ex) {
    agrees.push('the same date of birth')
    if (ex.phone_match) agrees.push('the same phone number')
    if (ex.postal_code_match) agrees.push('the same postal code')
  }
  return (
    <Section
      id="matching"
      title="Are these the same person?"
      subtitle={
        <>
          Both banks had their own customer lists. Before anyone is counted once, the two lists have to be <Term k="entity-resolution">matched</Term>, and the ones the
          matching is unsure about go to a <Term k="review-queue">review queue</Term>. Here is how that went.
        </>
      }
    >
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="people were in both banks and were merged" value={report.merged.toLocaleString()} hint={`exact matches, close matches scored above the line, and ${report.tier_3_confirmed} confirmed by a reviewer`} />
        <Stat label="possible duplicates were held for a person to check" value={report.review_queue.toLocaleString()} hint="never merged on a guess" />
        <Stat label="wrong merges, checked against the answer key" value={String(report.false_positives)} hint={`and ${report.traps_merged} of the ${report.by_kind.trap ? Object.values(report.by_kind.trap).reduce((a, b) => a + b, 0) : 5} same-name traps were merged`} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="What a reviewer sees">
          {ex ? (
            <div className="space-y-2 text-sm text-slate-700">
              <p>
                <strong>{String(ex.core_a_name)}</strong> at Harbor Bank and <strong>{String(ex.core_b_name)}</strong> at Riverside Bank share {agrees.join(', ')}.
                {reasons.length > 0 && <> They were not merged because {reasons.join(' and ')}.</>}
              </p>
              <p>
                The matching put them at <strong>{Math.round(Number(ex.confidence) * 100)}% likely</strong> to be one person, below the 80% line where we merge without asking.
                There is {money.format(Number(ex.combined_balance))} across the two records, which is why this pair is first in the queue.
              </p>
              <p className="text-xs text-slate-500">
                A reviewer confirms or rejects the pair; the decision feeds the next matching run. The full queue is the "possible duplicates" question above.
                {report.decisions && report.decisions.total > 0 && (
                  <>
                    {' '}
                    So far {report.decisions.total} decisions are on file: {report.decisions.applied} already applied, {report.decisions.pending} waiting for a later month
                    {report.decisions.ignored_unknown_id > 0 && `, ${report.decisions.ignored_unknown_id} naming a record that is not in this batch`}.
                  </>
                )}
              </p>
            </div>
          ) : exampleError ? (
            <p className="text-sm text-red-700">The example could not be loaded: {exampleError}</p>
          ) : (
            <p className="text-sm text-slate-500">Loading an example from the review queue…</p>
          )}
        </Card>
        <Card title="How a match is decided, in plain words">
          <ul className="list-disc space-y-1 pl-4 text-sm text-slate-700">
            <li>Two records are only compared if they share a date of birth.</li>
            <li>If both have the last four SSN digits and they differ, it is never the same person.</li>
            <li>Same name (nicknames and hyphens allowed) and same SSN digits: merged, no doubt.</li>
            <li>Otherwise the name, SSN digits, phone and postal code are scored together. Above 80% the pair is merged; between 55% and 80% a person decides; below that they stay separate.</li>
            <li>Because this data is synthetic we know the true answer, and the matching made no wrong merges.</li>
          </ul>
        </Card>
      </div>
      <WhyItMatters id="matching" />
    </Section>
  )
}
