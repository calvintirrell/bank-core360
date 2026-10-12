/** Read-only SQL guard and the example queries shown in the console. Pure functions, unit-tested. */

export class SqlGuardError extends Error {}

/** Base tables the page registers in DuckDB; `_v<n>` / `_latest` suffixes are the fixed as-of views. */
export const BASE_TABLES = ['customer_360', 'account_360', 'transactions', 'review_queue'] as const
const KNOWN_TABLE = new RegExp(`^(${BASE_TABLES.join('|')})(_v\\d+|_latest)?$`, 'i')
/** Table-valued functions that only generate rows and read nothing. */
const SAFE_TABLE_FUNCTIONS = /^(range|generate_series|unnest)$/i

const FIRST_WORDS = ['select', 'with', 'describe', 'show', 'explain', 'summarize', 'from', 'values']
const FORBIDDEN =
  /\b(attach|detach|copy|export|import|install|load|pragma|create|insert|update|delete|drop|alter|truncate|call|set|reset|vacuum|checkpoint|force|begin|commit|rollback|use|comment)\b/i
/** Functions that read files, URLs, settings or the catalog: nothing may leave the page's own tables. */
const FORBIDDEN_FUNCTIONS = /\b(read_\w+|\w+_scan|glob|sniff_csv|pragma_\w+|duckdb_\w+|getenv|current_setting|st_read)\s*\(/i
/** A string literal that names a file or URL (DuckDB would open it). */
const FILE_OR_URL = /^\s*(\w+:\/\/|\/|~\/|\.{1,2}\/|[a-z]:\\)|\.(parquet|csv|tsv|json|jsonl|ndjson|txt|db|duckdb|xlsx|zst|gz)\s*$/i

export type Scan = { clean: string; masked: string; literals: string[] }

/**
 * One pass over the text. Comments are removed; string literals and quoted identifiers are kept
 * in `clean` (what runs) but replaced by '?' / "?" in `masked` (what is checked), so a keyword or
 * semicolon inside a literal can neither trip the guard nor hide from it. Handles '' and ""
 * escapes and $tag$ … $tag$ strings.
 */
export function scan(sql: string): Scan {
  let clean = ''
  let masked = ''
  const literals: string[] = []
  const n = sql.length
  let i = 0
  while (i < n) {
    const ch = sql[i]
    const next = sql[i + 1]
    if (ch === '-' && next === '-') {
      while (i < n && sql[i] !== '\n') i++
      clean += ' '
      masked += ' '
      continue
    }
    if (ch === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2)
      i = end === -1 ? n : end + 2
      clean += ' '
      masked += ' '
      continue
    }
    if (ch === "'" || ch === '"') {
      let j = i + 1
      let body = ''
      while (j < n) {
        if (sql[j] === ch) {
          if (sql[j + 1] === ch) {
            body += ch
            j += 2
            continue
          }
          break
        }
        body += sql[j]
        j++
      }
      if (j >= n) throw new SqlGuardError('Unterminated quote.')
      clean += sql.slice(i, j + 1)
      masked += `${ch}?${ch}`
      if (ch === "'") literals.push(body)
      i = j + 1
      continue
    }
    if (ch === '$') {
      const m = /^\$([A-Za-z_]\w*)?\$/.exec(sql.slice(i))
      if (m) {
        const tag = m[0]
        const end = sql.indexOf(tag, i + tag.length)
        if (end === -1) throw new SqlGuardError('Unterminated quote.')
        literals.push(sql.slice(i + tag.length, end))
        clean += sql.slice(i, end + tag.length)
        masked += "'?'"
        i = end + tag.length
        continue
      }
    }
    clean += ch
    masked += ch
    i++
  }
  return { clean, masked, literals }
}

/** Returns the statement to run (comments removed, trailing semicolon dropped) if it is a single read-only query over the page's own tables; otherwise throws. */
export function assertReadOnly(sql: string): string {
  const { clean, masked, literals } = scan(sql)
  const text = clean.trim().replace(/;+\s*$/, '')
  const m = masked.trim().replace(/;+\s*$/, '')
  if (!m) throw new SqlGuardError('Enter a query.')
  if (m.includes(';')) throw new SqlGuardError('One statement at a time.')
  const first = m.split(/\s+/)[0].replace(/^\(+/, '').toLowerCase()
  if (!FIRST_WORDS.includes(first)) {
    throw new SqlGuardError(`Only read-only queries are allowed (got "${first}").`)
  }
  const bad = m.match(FORBIDDEN)
  if (bad) throw new SqlGuardError(`"${bad[0]}" is not allowed in the console.`)
  const fn = m.match(FORBIDDEN_FUNCTIONS)
  if (fn) throw new SqlGuardError(`"${fn[1]}()" reads outside the page's tables and is not allowed.`)
  for (const lit of literals) {
    if (FILE_OR_URL.test(lit)) throw new SqlGuardError(`File paths and URLs are not allowed ("${lit.slice(0, 40)}").`)
  }
  if (/\b(from|join)\s+(lateral\s+)?['"]\?['"]/i.test(m)) throw new SqlGuardError('Querying a file or URL is not allowed.')
  // Table allowlist: every FROM / JOIN target is a page table, a CTE defined in this query, or a
  // row generator. A name followed by ')' is skipped (EXTRACT(year FROM col), TRIM(... FROM col)).
  const ctes = new Set([...m.matchAll(/\b([a-z_]\w*)\s+as\s*\(/gi)].map((x) => x[1].toLowerCase()))
  for (const [, , name] of m.matchAll(/\b(from|join)\s+(?:lateral\s+)?([a-z_][\w.]*)(?![\w.])(?!\s*\))/gi)) {
    const lower = name.toLowerCase()
    if (lower === 'lateral') continue // JOIN LATERAL (subquery): the regex may bind the keyword when a '(' follows
    if (KNOWN_TABLE.test(lower) || ctes.has(lower) || SAFE_TABLE_FUNCTIONS.test(lower)) continue
    throw new SqlGuardError(`Unknown table "${name}". Available: ${BASE_TABLES.join(', ')} (add _v0 or _latest for a fixed as-of).`)
  }
  return text
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
