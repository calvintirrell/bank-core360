import { describe, expect, it } from 'vitest'
import { assertReadOnly, EXAMPLES, SqlGuardError } from './sql'

describe('assertReadOnly', () => {
  it('accepts SELECT and WITH, strips trailing semicolons and comments', () => {
    expect(assertReadOnly('SELECT 1;')).toBe('SELECT 1')
    expect(assertReadOnly('-- note\nWITH x AS (SELECT 1) SELECT * FROM x')).toMatch(/^WITH/)
    expect(assertReadOnly('/* c */ select count(*) from customer_360')).toMatch(/^select/)
  })
  it('rejects writes, DDL, extension loads and multi-statements', () => {
    for (const bad of [
      'DROP TABLE customer_360',
      'INSERT INTO t VALUES (1)',
      'SELECT 1; SELECT 2',
      'INSTALL httpfs',
      'CREATE TABLE t AS SELECT 1',
      "COPY customer_360 TO 'x.csv'",
      'SELECT * FROM x; DROP TABLE x',
      '',
    ]) {
      expect(() => assertReadOnly(bad)).toThrow(SqlGuardError)
    }
  })
  it('every example passes the guard', () => {
    for (const e of EXAMPLES) expect(() => assertReadOnly(e.sql)).not.toThrow()
  })
})
