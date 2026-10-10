import * as duckdb from '@duckdb/duckdb-wasm'

export type QueryResult = { columns: string[]; rows: Record<string, unknown>[] }

let dbPromise: Promise<duckdb.AsyncDuckDB> | null = null

/** One DuckDB-WASM instance per page. Bundles come from jsDelivr so Vite needs no worker config. */
export function getDb(): Promise<duckdb.AsyncDuckDB> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles())
      const workerUrl = URL.createObjectURL(
        new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' }),
      )
      const worker = new Worker(workerUrl)
      const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING), worker)
      await db.instantiate(bundle.mainModule, bundle.pthreadWorker)
      URL.revokeObjectURL(workerUrl)
      return db
    })()
  }
  return dbPromise
}

/** Absolute URL for a file in the export layer, honoring the Pages base path. */
export function dataUrl(file: string): string {
  return new URL(`${import.meta.env.BASE_URL}data/${file}`, window.location.origin).href
}

/** Registers a Parquet file served by Pages so SQL can reference it by name. */
export async function registerParquet(name: string, file: string): Promise<void> {
  const db = await getDb()
  await db.registerFileURL(name, dataUrl(file), duckdb.DuckDBDataProtocol.HTTP, false)
}

export async function runSql(sql: string): Promise<QueryResult> {
  const db = await getDb()
  const conn = await db.connect()
  try {
    const table = await conn.query(sql)
    const columns = table.schema.fields.map((f) => f.name)
    const rows = table.toArray().map((r) => r.toJSON() as Record<string, unknown>)
    return { columns, rows }
  } finally {
    await conn.close()
  }
}

export function formatCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'bigint') return v.toString()
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2)
  return String(v)
}
