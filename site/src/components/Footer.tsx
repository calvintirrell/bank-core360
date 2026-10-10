import { useEffect, useState } from 'react'
import { loadBuildInfo, type BuildInfo } from '../lib/lakehouse'

export function Footer() {
  const [info, setInfo] = useState<BuildInfo | null>(null)
  useEffect(() => {
    loadBuildInfo().then(setInfo)
  }, [])
  return (
    <footer className="border-t border-slate-200 pt-4 text-xs text-slate-500">
      {info ? `Built by GitHub Actions run #${info.run_number} from ${info.sha} at ${info.built_at}` : 'Build info unavailable'}
      {' · '}
      <a className="underline" href="https://github.com/calvintirrell/bank-core360">source</a>
      {' · '}synthetic data, no real customers
    </footer>
  )
}
