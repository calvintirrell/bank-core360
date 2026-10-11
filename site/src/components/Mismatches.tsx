import { useState } from 'react'
import type { RawSamples } from '../lib/lakehouse'
import { Card } from './Section'

function cell(samples: RawSamples, system: 'core_a' | 'core_b', file: string, column: string, row = 0): string {
  const t = samples[system][file]
  const i = t?.columns.indexOf(column) ?? -1
  return i >= 0 ? (t.rows[row]?.[i] ?? '') : ''
}

/** Bank-mode view of the raw feeds: the same facts written two different ways, side by side. */
export function Mismatches({ samples, children }: { samples: RawSamples | null; children: React.ReactNode }) {
  const [showRaw, setShowRaw] = useState(false)
  if (!samples) return null
  const pairs: Array<{ title: string; a: string; b: string; note: string }> = [
    { title: 'A date of birth', a: cell(samples, 'core_a', 'CUSTMAST.psv', 'DOB'), b: cell(samples, 'core_b', 'customers.jsonl', 'date_of_birth'), note: 'Eight digits run together versus a dashed date. Both have to become one real date before anyone can be matched.' },
    { title: 'A customer id', a: cell(samples, 'core_a', 'CUSTMAST.psv', 'CIF_NO'), b: cell(samples, 'core_b', 'customers.jsonl', 'customer_id'), note: 'Different id systems, so there is no shared number to join on. Matching has to use the person: name, birthday, SSN digits, phone, address.' },
    { title: 'A checking account', a: cell(samples, 'core_a', 'ACCTMAST.psv', 'PROD_CD'), b: cell(samples, 'core_b', 'accounts.jsonl', 'product_type'), note: 'Harbor Bank says DDA, Riverside says checking. Four product codes on one side map to four words on the other.' },
    { title: 'A balance', a: `${cell(samples, 'core_a', 'ACCTMAST.psv', 'CUR_BAL_CENTS')} (cents)`, b: `${cell(samples, 'core_b', 'accounts.jsonl', 'balance')} (dollars)`, note: 'One system counts cents, the other dollars. Add them together unconverted and every total is wrong by a hundred times.' },
    { title: 'A name', a: cell(samples, 'core_a', 'CUSTMAST.psv', 'CUST_NAME'), b: `${cell(samples, 'core_b', 'customers.jsonl', 'first_name')} ${cell(samples, 'core_b', 'customers.jsonl', 'last_name')}`, note: 'Last name first in capitals versus first and last in separate fields. Names are split and normalised before they are compared.' },
    { title: 'A transaction amount', a: `${cell(samples, 'core_a', 'TXNHIST.psv', 'AMT')} ${cell(samples, 'core_a', 'TXNHIST.psv', 'DR_CR')}`, b: cell(samples, 'core_b', 'transactions.jsonl', 'amount'), note: 'Harbor Bank writes a positive amount with a D or C flag; Riverside writes a signed number. Both become money in or money out.' },
  ]
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        The same facts arrived written two different ways. These are real rows from the two files, untouched.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {pairs.map((p) => (
          <Card key={p.title} title={p.title}>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded border border-amber-300 bg-amber-50 p-2">
                <div className="mb-1 font-semibold text-amber-900">Harbor Bank</div>
                <div className="break-all font-mono text-slate-800">{p.a}</div>
              </div>
              <div className="rounded border border-sky-300 bg-sky-50 p-2">
                <div className="mb-1 font-semibold text-sky-900">Riverside Bank</div>
                <div className="break-all font-mono text-slate-800">{p.b}</div>
              </div>
            </div>
            <p className="mt-2 text-xs text-slate-600">{p.note}</p>
          </Card>
        ))}
      </div>
      <button type="button" onClick={() => setShowRaw((v) => !v)} className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs hover:bg-slate-100">
        {showRaw ? 'Hide the raw files' : 'See the raw files'}
      </button>
      {showRaw && <div>{children}</div>}
    </div>
  )
}
