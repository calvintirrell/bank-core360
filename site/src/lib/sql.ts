/** Read-only SQL guard and the example queries shown in the console. Pure functions, unit-tested. */

const FORBIDDEN = /\b(attach|copy|export|import|install|load|pragma|create|insert|update|delete|drop|alter|truncate|call|set|reset|vacuum|checkpoint)\b/i

export class SqlGuardError extends Error {}

/** Returns the trimmed statement if it is a single read-only query, otherwise throws. */
export function assertReadOnly(sql: string): string {
  const stripped = sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .trim()
    .replace(/;+\s*$/, '')
  if (!stripped) throw new SqlGuardError('Enter a query.')
  if (stripped.includes(';')) throw new SqlGuardError('One statement at a time.')
  const first = stripped.split(/\s+/)[0].toLowerCase()
  if (!['select', 'with', 'describe', 'show', 'explain', 'summarize', 'from'].includes(first)) {
    throw new SqlGuardError(`Only read-only queries are allowed (got "${first}").`)
  }
  const bad = stripped.match(FORBIDDEN)
  if (bad) throw new SqlGuardError(`"${bad[0]}" is not allowed in the console.`)
  return stripped
}

export type Example = { label: string; sql: string }

export const EXAMPLES: Example[] = [
  {
    label: 'Mortgage + dormant checking',
    sql: `SELECT customer_key, full_name, source_systems, match_confidence,
       loan_balance, dormant_checking_last_txn_ts
FROM customer_360
WHERE has_mortgage AND checking_dormant_180d
ORDER BY loan_balance DESC
LIMIT 25`,
  },
  {
    label: 'Cross-core merges by confidence',
    sql: `SELECT match_tier, round(match_confidence, 2) AS confidence, count(*) AS customers
FROM customer_360
WHERE source_systems = 'core_a+core_b'
GROUP BY 1, 2
ORDER BY 1, 2 DESC`,
  },
  {
    label: 'Deposits by state',
    sql: `SELECT state, count(*) AS customers,
       round(sum(deposit_balance)) AS deposits,
       round(sum(loan_balance)) AS loans
FROM customer_360
GROUP BY 1
ORDER BY deposits DESC
LIMIT 10`,
  },
  {
    label: 'Account activity by product',
    sql: `SELECT product_type, source_system, count(*) AS accounts,
       round(avg(txn_count_90d), 1) AS avg_txns_90d,
       sum(CASE WHEN is_dormant_180d THEN 1 ELSE 0 END) AS dormant
FROM account_360
WHERE is_open
GROUP BY 1, 2
ORDER BY 1, 2`,
  },
  {
    label: 'Transaction flow by core',
    sql: `SELECT source_system, direction, count(*) AS transactions,
       round(sum(amount)) AS total
FROM transactions
GROUP BY 1, 2
ORDER BY 1, 2`,
  },
  {
    label: 'Review queue by money at stake',
    sql: `SELECT priority, core_a_name, core_b_name, dob, confidence,
       core_b_ssn_missing, phone_match, postal_code_match, combined_balance
FROM review_queue
ORDER BY priority
LIMIT 25`,
  },
  {
    label: 'Time travel: what changed',
    sql: `SELECT 'customers' AS what, (SELECT count(*) FROM customer_360_v0) AS first_load, (SELECT count(*) FROM customer_360_latest) AS now
UNION ALL SELECT 'in review queue', (SELECT count(*) FROM review_queue_v0), (SELECT count(*) FROM review_queue_latest)
UNION ALL SELECT 'quiet checking accounts',
  (SELECT count(*) FROM account_360_v0 WHERE product_type='checking' AND is_dormant_180d),
  (SELECT count(*) FROM account_360_latest WHERE product_type='checking' AND is_dormant_180d)
UNION ALL SELECT 'confirmed by a reviewer',
  (SELECT count(*) FROM customer_360_v0 WHERE match_tier = 3),
  (SELECT count(*) FROM customer_360_latest WHERE match_tier = 3)`,
  },
  {
    label: 'One customer, both cores',
    sql: `SELECT a.customer_key, c.full_name, a.source_system, a.product_type,
       a.balance, a.is_open, a.last_txn_ts, a.is_dormant_180d
FROM account_360 a
JOIN customer_360 c USING (customer_key)
WHERE c.source_systems = 'core_a+core_b' AND c.has_mortgage AND c.checking_dormant_180d
ORDER BY a.customer_key, a.source_system
LIMIT 30`,
  },
]
