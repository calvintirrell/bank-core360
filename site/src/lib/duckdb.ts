import * as duckdb from '@duckdb/duckdb-wasm'
import { Type, type Field } from 'apache-arrow'
import { latestOnlyQueue } from './serial'
import { versionDirs, type ManifestVersion } from './versions'

export const TABLES = ['customer_360', 'account_360', 'transactions', 'review_queue'] as const
export type TableName = (typeof TABLES)[number]

export type ColumnKind = 'integer' | 'number' | 'boolean' | 'date' | 'timestamp' | 'text'
export type Column = { name: string; kind: ColumnKind }
export type QueryResult = { columns: Column[]; rows: Record<string, unknown>[]; ms: number }

let dbPromise: Promise<duckdb.AsyncDuckDB> | null = null
let readyPromise: Promise<void> | null = null

/** One DuckDB-WASM instance per page. Bundles come from jsDelivr so Vite needs no worker config. */
export function getDb(): Promise<duckdb.AsyncDuckDB> {
  if (!dbPromise) {
    dbPromise = (async () => {
      try {
        const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles())
        const workerUrl = URL.createObjectURL(
          new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' }),
        )
        const worker = new Worker(workerUrl)
        const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING), worker)
        await db.instantiate(bundle.mainModule, bundle.pthreadWorker)
        URL.revokeObjectURL(workerUrl)
        return db
      } catch (e) {
        dbPromise = null // let a reload-free retry try again
        const why = e instanceof Error ? e.message : String(e)
        throw new Error(`The in-browser query engine could not start (${why}). Its files load from cdn.jsdelivr.net; a network that blocks CDNs would cause this.`)
      }
    })()
  }
  return dbPromise
}

/** Absolute URL for a file in the export layer (or a version subfolder), honoring the Pages base path. */
export function dataUrl(file: string, dir = ''): string {
  return new URL(`${import.meta.env.BASE_URL}data/${dir}${file}`, window.location.origin).href
}

/** Versions to expose, read from the latest manifest at startup: '' is the latest export, 'v0/' the first batch. */
let versionDirsLoaded: Record<string, string> = { latest: '' }
let selected = 'latest'

async function loadVersionDirs(): Promise<Record<string, string>> {
  const r = await fetch(dataUrl('manifest.json'))
  if (!r.ok) throw new Error(`manifest.json: HTTP ${r.status}`)
  const m = (await r.json()) as { versions?: ManifestVersion[] }
  return versionDirs(m.versions)
}

/** Registers every version's Parquet files and creates the views. `customer_360` etc. follow the
 *  selected version; `customer_360_v0` / `customer_360_latest` are always available for comparison. */
export function ready(): Promise<void> {
  if (!readyPromise) {
    readyPromise = (async () => {
      const [db, dirs] = await Promise.all([getDb(), loadVersionDirs()])
      versionDirsLoaded = dirs
      for (const [v, dir] of Object.entries(dirs)) {
        for (const t of TABLES) {
          await db.registerFileURL(`${t}_${v}.parquet`, dataUrl(`${t}.parquet`, dir), duckdb.DuckDBDataProtocol.HTTP, false)
        }
      }
      const conn = await db.connect()
      try {
        for (const v of Object.keys(dirs)) {
          for (const t of TABLES) {
            await conn.query(`CREATE OR REPLACE VIEW ${t}_${v} AS SELECT * FROM read_parquet('${t}_${v}.parquet')`)
          }
        }
        await pointViews(conn, selected)
      } finally {
        await conn.close()
      }
    })()
  }
  return readyPromise
}

async function pointViews(conn: duckdb.AsyncDuckDBConnection, v: string): Promise<void> {
  for (const t of TABLES) {
    await conn.query(`CREATE OR REPLACE VIEW ${t} AS SELECT * FROM ${t}_${v}`)
  }
}

const switchQueue = latestOnlyQueue<string>()

/** Switches the unsuffixed views to another version. Switches run one at a time and a switch
 *  that was superseded before it started is skipped, so rapid clicks never leave the four views
 *  pointing at different versions. Resolves once the views are re-pointed (or skipped). */
export function selectVersion(v: string): Promise<void> {
  selected = v
  return switchQueue(v, async () => {
    await ready()
    if (!(v in versionDirsLoaded)) throw new Error(`Unknown version "${v}"; this build has ${Object.keys(versionDirsLoaded).join(', ')}.`)
    const db = await getDb()
    const conn = await db.connect()
    try {
      await pointViews(conn, v)
    } finally {
      await conn.close()
    }
  })
}

/** The version ids this build exposes (after ready()). */
export function availableVersions(): string[] {
  return Object.keys(versionDirsLoaded)
}

function kindOf(f: Field): ColumnKind {
  switch (f.type.typeId) {
    case Type.Timestamp:
      return 'timestamp'
    case Type.Date:
      return 'date'
    case Type.Bool:
      return 'boolean'
    case Type.Int:
      return 'integer'
    case Type.Float:
    case Type.Decimal:
      return 'number'
    default:
      return 'text'
  }
}

/** One long-lived query connection (opening one per query cost a round trip to the worker each time). */
let queryConn: Promise<duckdb.AsyncDuckDBConnection> | null = null

async function connection(): Promise<duckdb.AsyncDuckDBConnection> {
  if (!queryConn) {
    queryConn = getDb().then((db) => db.connect())
    queryConn.catch(() => {
      queryConn = null
    })
  }
  return queryConn
}

export async function runSql(sql: string): Promise<QueryResult> {
  await ready()
  const conn = await connection()
  const t0 = performance.now()
  const table = await conn.query(sql)
  const columns = table.schema.fields.map((f) => ({ name: f.name, kind: kindOf(f) }))
  const rows = table.toArray().map((r) => r.toJSON() as Record<string, unknown>)
  return { columns, rows, ms: Math.round(performance.now() - t0) }
}

/** Escapes a value for inclusion in a SQL string literal. */
export function sqlString(v: string): string {
  return `'${v.replace(/'/g, "''")}'`
}

const num = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function formatCell(v: unknown, kind: ColumnKind = 'text'): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'bigint') return v.toString()
  if (kind === 'date' || kind === 'timestamp') {
    const d = v instanceof Date ? v : new Date(typeof v === 'bigint' ? Number(v) : (v as number))
    if (Number.isNaN(d.getTime())) return String(v)
    const iso = d.toISOString()
    return kind === 'date' ? iso.slice(0, 10) : iso.slice(0, 16).replace('T', ' ')
  }
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : num.format(v)
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  return String(v)
}
