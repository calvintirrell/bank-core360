// Copies the pipeline's export layer into public/data so Vite serves it next to the app,
// and writes build_info.json (run number + sha come from CI; local builds say "local").
import { cpSync, mkdirSync, existsSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const src = resolve(here, '../../lakehouse/export')
const dst = resolve(here, '../public/data')

mkdirSync(dst, { recursive: true })
if (existsSync(src)) {
  cpSync(src, dst, { recursive: true, force: true })
  console.log(`synced ${src} -> ${dst}`)
} else {
  console.warn(`no export layer at ${src}; run \`uv run python -m pipeline\` first`)
}

const info = {
  run_number: process.env.BUILD_RUN_NUMBER ?? 'local',
  sha: (process.env.BUILD_SHA ?? 'local').slice(0, 7),
  built_at: new Date().toISOString(),
}
writeFileSync(resolve(dst, 'build_info.json'), JSON.stringify(info, null, 2) + '\n')
