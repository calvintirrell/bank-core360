/** Types and lookups for lakehouse/export/lineage.json. Pure functions, unit-tested. */

export type SystemId = 'core_a' | 'core_b'
export type LineageSource = { system: SystemId; table: string; field: string }
export type ColumnLineage = { sources: LineageSource[]; transform: string; rules: string[] }
export type TableLineage = { grain: string; columns: Record<string, ColumnLineage> }
export type Lineage = {
  as_of: string
  systems: Record<SystemId, { label: string; conventions: string }>
  rules: Record<string, string>
  tables: Record<string, TableLineage>
}

export type ColumnLookup = { table: string; column: string; lineage: ColumnLineage }

const ORDER = ['customer_360', 'account_360', 'transactions']

/** Finds lineage for a result column by name: preferred table first, then the others. */
export function lookupColumn(lineage: Lineage, column: string, preferTable?: string): ColumnLookup | null {
  const tables = preferTable ? [preferTable, ...ORDER.filter((t) => t !== preferTable)] : ORDER
  for (const t of tables) {
    const hit = lineage.tables[t]?.columns[column]
    if (hit) return { table: t, column, lineage: hit }
  }
  return null
}

export function systemsOf(l: ColumnLineage): SystemId[] {
  const seen = new Set<SystemId>()
  for (const s of l.sources) seen.add(s.system)
  return (['core_a', 'core_b'] as SystemId[]).filter((s) => seen.has(s))
}

export function badgeText(systems: SystemId[]): string {
  if (systems.length === 2) return 'A+B'
  if (systems[0] === 'core_a') return 'A'
  if (systems[0] === 'core_b') return 'B'
  return '?'
}
