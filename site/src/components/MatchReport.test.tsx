// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ModeProvider } from '../lib/ModeContext'
import type { MatchReport as Report } from '../lib/lakehouse'
import { MatchReport } from './MatchReport'

afterEach(cleanup)

// The committed report for the latest batch, so the tile is checked against real numbers.
const report = JSON.parse(readFileSync(resolve(process.cwd(), '../lakehouse/export/match_report.json'), 'utf8')) as Report

describe('MatchReport', () => {
  it('counts every merged pair, including the ones a reviewer confirmed, and says so in the hint', () => {
    expect(report.merged).toBe(report.tier_1_deterministic + report.tier_2_fuzzy + report.tier_3_confirmed)
    render(
      <ModeProvider>
        <MatchReport report={report} />
      </ModeProvider>,
    )
    expect(screen.getAllByText('Merged').length).toBeGreaterThan(0)
    expect(screen.getByText(report.merged.toLocaleString())).toBeTruthy()
    expect(screen.getByText(`${report.tier_1_deterministic} deterministic, ${report.tier_2_fuzzy} fuzzy, ${report.tier_3_confirmed} reviewer-confirmed`)).toBeTruthy()
  })
})
