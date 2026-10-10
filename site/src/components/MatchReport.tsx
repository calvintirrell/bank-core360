import type { MatchReport as Report } from '../lib/lakehouse'
import { Card, Section, Stat } from './Section'

const KIND_LABELS: Record<string, string> = {
  clean: 'Identical after standardization',
  nickname: 'Nickname (Bill / William)',
  typo: 'Typo in last name',
  middle_hyphen: 'Hyphenated last name, no middle initial',
  ssn_missing: 'SSN last-4 missing in Core B',
  lastname_changed: 'Last name changed, SSN present',
  lastname_changed_ssn_missing: 'Last name changed, SSN missing',
  ssn_missing_moved: 'SSN missing and moved house',
  lastname_changed_ssn_missing_moved_newphone: 'New name, address and phone, SSN missing',
  trap: 'Same name and birthday, different person',
}

export function MatchReport({ report }: { report: Report | null }) {
  if (!report) return null
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`
  return (
    <Section id="matching" title="Entity resolution, scored" subtitle="Which customers are the same person across the two cores. Because the data is synthetic, the generator's ground truth lets the matcher grade itself; in production this is a sampled audit.">
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Auto-merged" value={report.auto_merged.toLocaleString()} hint={`${report.tier_1_deterministic} deterministic, ${report.tier_2_fuzzy} fuzzy`} />
        <Stat label="Review queue" value={report.review_queue.toLocaleString()} hint="not merged, for a human" />
        <Stat label="Precision" value={pct(report.precision)} hint="no false merges" />
        <Stat label="Recall" value={pct(report.recall)} hint={`${report.review_queue} in review, ${report.false_negatives - report.review_queue} undetectable`} />
        <Stat label="Traps merged" value={String(report.traps_merged)} hint="same name + DOB, different person" />
        <Stat label="Candidates scored" value={report.candidates_scored.toLocaleString()} hint="after blocking on DOB" />
      </div>
      <div className="grid gap-4 md:grid-cols-5">
        <Card title="Outcome by designed difficulty" className="md:col-span-3">
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="text-left text-slate-600">
                  <th className="py-1 pr-3 font-medium">Case</th>
                  <th className="py-1 pr-3 text-right font-medium">Merged</th>
                  <th className="py-1 pr-3 text-right font-medium">Review</th>
                  <th className="py-1 text-right font-medium">Unmatched</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(report.by_kind).map(([k, v]) => (
                  <tr key={k} className="border-t border-slate-100">
                    <td className="py-1 pr-3">{KIND_LABELS[k] ?? k}</td>
                    <td className="py-1 pr-3 text-right font-mono tabular-nums">{v.merged}</td>
                    <td className="py-1 pr-3 text-right font-mono tabular-nums">{v.review}</td>
                    <td className="py-1 text-right font-mono tabular-nums">{v.unmatched}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="How a pair is scored" className="md:col-span-2 text-xs text-slate-700">
          <ol className="list-decimal space-y-1 pl-4">
            <li>Candidates must share a date of birth.</li>
            <li>Both cores have SSN last-4 and they differ: rejected outright.</li>
            <li>Tier 1: same name after nickname and hyphen normalization, same SSN last-4: confidence 1.00.</li>
            <li>
              Tier 2: {report.weights.name} × name similarity + {report.weights.ssn} × SSN (1 equal, 0.5 missing) + {report.weights.phone} × phone + {report.weights.postal_code} × postal code.
            </li>
            <li>Auto-merge at ≥ {report.thresholds.auto_merge}; review between {report.thresholds.review_floor} and {report.thresholds.auto_merge}; below that, no match.</li>
            <li>Each record merges at most once, highest confidence first.</li>
          </ol>
        </Card>
      </div>
    </Section>
  )
}
