import { describe, expect, it } from 'vitest'
import { assertReadOnly, EXAMPLES, scan, SqlGuardError } from './sql'

const ok = (sql: string) => expect(() => assertReadOnly(sql)).not.toThrow()
const bad = (sql: string, why?: RegExp) => {
  expect(() => assertReadOnly(sql)).toThrow(SqlGuardError)
  if (why) expect(() => assertReadOnly(sql)).toThrow(why)
}

describe('scan', () => {
  it('masks literal contents and removes comments, keeping the runnable text intact', () => {
    const s = scan("SELECT 'a;b', \"c d\" -- drop\nFROM customer_360 /* ; */ WHERE x = 'it''s'")
    expect(s.masked).toBe("SELECT '?', \"?\"  \nFROM customer_360   WHERE x = '?'")
    expect(s.clean).toBe("SELECT 'a;b', \"c d\"  \nFROM customer_360   WHERE x = 'it''s'")
    expect(s.literals).toEqual(['a;b', "it's"])
  })
  it('handles dollar-quoted strings and rejects unterminated quotes', () => {
    expect(scan("SELECT $$x'y$$, $t$;$t$").masked).toBe("SELECT '?', '?'")
    expect(() => scan("SELECT 'open")).toThrow(SqlGuardError)
    expect(() => scan('SELECT "open')).toThrow(SqlGuardError)
  })
})

describe('assertReadOnly', () => {
  it('accepts SELECT and WITH, strips trailing semicolons and comments', () => {
    expect(assertReadOnly('SELECT 1;')).toBe('SELECT 1')
    expect(assertReadOnly('-- note\nWITH x AS (SELECT 1) SELECT * FROM x')).toMatch(/^WITH/)
    expect(assertReadOnly('/* c */ select count(*) from customer_360')).toMatch(/^select/)
    expect(assertReadOnly('SELECT 1; -- trailing comment')).toBe('SELECT 1')
  })

  it('never trips on keywords, semicolons or comment markers inside string literals', () => {
    expect(assertReadOnly("SELECT '--x', 1")).toBe("SELECT '--x', 1")
    ok("SELECT 'a;b' FROM customer_360")
    ok("SELECT * FROM customer_360 WHERE full_name ILIKE '%Call%'")
    ok("SELECT * FROM transactions WHERE memo = 'Delete'")
    ok("SELECT * FROM customer_360 WHERE full_name = 'it''s; drop table x'")
    ok('SELECT 1 -- ; drop table customer_360')
    ok('/* drop table x */ SELECT 1')
    ok("SELECT count(*) FROM account_360 WHERE product_type IN ('cd', 'checking')")
  })

  it('rejects writes, DDL, extension loads, settings and multi-statements', () => {
    for (const sql of [
      'DROP TABLE customer_360',
      'INSERT INTO t VALUES (1)',
      'SELECT 1; SELECT 2',
      'INSTALL httpfs',
      'FORCE INSTALL httpfs',
      'LOAD httpfs',
      'CREATE TABLE t AS SELECT 1',
      "COPY customer_360 TO 'x.csv'",
      'SELECT * FROM x; DROP TABLE x',
      "ATTACH 'other.db' AS o",
      'SET threads = 1',
      'PRAGMA database_size',
      'CALL pragma_version()',
      'BEGIN TRANSACTION',
      'WITH x AS (SELECT 1) INSERT INTO t SELECT * FROM x',
      "SELECT 1 /* */; COPY (SELECT 1) TO 'x'",
      '',
      '   ',
    ]) {
      bad(sql)
    }
  })

  it('rejects every known read-outside-the-page bypass', () => {
    bad("SELECT * FROM read_parquet('https://example.com/x.parquet')", /read_parquet/)
    bad("SELECT * FROM read_csv_auto('https://example.com/x.csv')", /read_csv_auto/)
    bad("SELECT * FROM read_text('/etc/passwd')", /read_text/)
    bad("SELECT * FROM parquet_scan('x.parquet')", /parquet_scan/)
    bad("SELECT * FROM glob('*')", /glob/)
    bad("SELECT * FROM 'https://example.com/x.parquet'", /URL/)
    bad("SELECT * FROM 's3://bucket/x.parquet'", /URL/)
    bad("FROM 'data/customer_360.parquet'", /URL|file/i)
    bad('SELECT * FROM "https://example.com/x.parquet"', /file or URL/)
    bad("SELECT * FROM customer_360 JOIN 'x.csv' USING (a)", /URL|file/i)
    bad("SELECT * FROM customer_360, 'https://evil/x.parquet'", /URL/)
    bad('SELECT * FROM duckdb_settings()', /duckdb_settings/)
    bad("SELECT current_setting('home_directory')", /current_setting/)
    bad("SELECT getenv('HOME')", /getenv/)
    bad("SELECT pragma_database_size()", /pragma/)
    bad("SELECT * FROM sniff_csv('x.csv')", /sniff_csv/)
    bad("SELECT 1 WHERE 'x' = 'file:///etc/passwd'", /URL/)
    bad("DESCRIBE 'x.parquet'", /URL|file/i)
    bad("SUMMARIZE read_parquet('x.parquet')", /read_parquet/)
  })

  it('only allows the page tables, CTEs and row generators as FROM/JOIN targets', () => {
    ok('SELECT * FROM customer_360')
    ok('SELECT * FROM customer_360_v0 JOIN account_360_latest USING (customer_key)')
    ok('WITH t AS (SELECT 1 AS x) SELECT * FROM t')
    ok('WITH a AS (SELECT 1), b AS (SELECT 2) SELECT * FROM a CROSS JOIN b')
    ok('SELECT * FROM range(10)')
    ok('SELECT * FROM (SELECT * FROM customer_360) sub')
    ok('SELECT * FROM customer_360 c LEFT JOIN LATERAL (SELECT 1) x ON true')
    ok('FROM customer_360 SELECT customer_key LIMIT 5')
    ok('SELECT extract(year FROM txn_ts) AS y, count(*) FROM transactions GROUP BY 1')
    ok("SELECT trim(both 'x' FROM full_name) FROM customer_360")
    ok('SELECT substring(full_name FROM 1 FOR 3) FROM customer_360')
    bad('SELECT * FROM secrets', /Unknown table "secrets"/)
    bad('SELECT * FROM information_schema.tables', /Unknown table/)
    bad('SELECT * FROM customer_360 JOIN other_table USING (a)', /Unknown table "other_table"/)
  })

  it('accepts the read-only statement kinds', () => {
    ok('DESCRIBE customer_360')
    ok('SHOW TABLES')
    ok('SUMMARIZE customer_360')
    ok('EXPLAIN SELECT count(*) FROM transactions')
    ok('VALUES (1, 2)')
  })

  it('every example passes the guard', () => {
    for (const e of EXAMPLES) expect(() => assertReadOnly(e.sql)).not.toThrow()
  })
})
