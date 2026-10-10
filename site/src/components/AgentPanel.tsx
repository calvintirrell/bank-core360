import { useEffect, useState } from 'react'
import { DEFAULT_MODEL, DemoCapError, MODELS, PROXY_URL, fetchQuota, ping, routeLabel, type ModelId, type Quota } from '../lib/anthropic'
import { Card, Section } from './Section'

/** The own-key field is hidden by default; append ?byok to the URL to reveal it (or it shows
 *  automatically when a key is already stored in this tab's session). */
function byokRequested(): boolean {
  return new URLSearchParams(window.location.search).has('byok')
}

export function AgentPanel() {
  const [apiKey, setApiKey] = useState(() => sessionStorage.getItem('bc360.apiKey') ?? '')
  const showByok = byokRequested() || apiKey !== '' || !PROXY_URL
  const models = showByok ? MODELS : MODELS.filter((m) => m.proxy)
  const [model, setModel] = useState<ModelId>(DEFAULT_MODEL)
  const [busy, setBusy] = useState(false)
  const [reply, setReply] = useState('')
  const [error, setError] = useState('')
  const [quota, setQuota] = useState<Quota | null>(null)
  const [capHit, setCapHit] = useState(false)

  useEffect(() => {
    fetchQuota().then(setQuota)
  }, [])

  const usingProxy = !apiKey && !!PROXY_URL
  const exhausted = usingProxy && (capHit || (quota !== null && quota.remaining_today <= 0))

  async function onPing() {
    setBusy(true)
    setReply('')
    setError('')
    try {
      sessionStorage.setItem('bc360.apiKey', apiKey)
      setReply(await ping(apiKey, model))
    } catch (e) {
      if (e instanceof DemoCapError) setCapHit(true)
      else setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      if (usingProxy) fetchQuota().then(setQuota)
    }
  }

  return (
    <Section id="ask" title="Ask in plain English" subtitle="Next phase: a Claude agent that writes the SQL, runs it in this page, and explains the answer with lineage. For now this is the connectivity check.">
      <Card>
        <p className="mb-2 text-sm text-slate-600">
          {PROXY_URL
            ? 'No key needed: requests go through a shared, rate-limited demo proxy.'
            : "Enter your own key. It is kept in this tab's session storage only and sent only to api.anthropic.com."}
          {showByok && PROXY_URL && ' Paste your own key to bypass it.'}
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          {showByok && (
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={PROXY_URL ? 'optional: your own sk-ant-… key' : 'sk-ant-…'}
              className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm font-mono"
              autoComplete="off"
            />
          )}
          <select value={model} onChange={(e) => setModel(e.target.value as ModelId)} className="rounded-md border border-slate-300 px-3 py-2 text-sm">
            {models.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={onPing}
            disabled={busy || (!apiKey && !PROXY_URL) || exhausted}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            {busy ? 'Calling…' : 'Ping'}
          </button>
        </div>
        {usingProxy && quota && !exhausted && (
          <p className="mt-2 text-xs text-slate-500">Shared demo: {quota.remaining_today} of {quota.cap_today} queries left today.</p>
        )}
        {exhausted && (
          <p role="alert" className="mt-2 text-sm font-medium text-red-600">
            Daily demo limit reached ({quota?.cap_today ?? 4} queries per day). Try again tomorrow after midnight UTC{byokRequested() ? ', or enter your own key.' : '.'}
          </p>
        )}
        {reply && (
          <p className="mt-2 text-sm">
            Model replied: <span className="font-mono">{reply}</span> <span className="text-slate-500">via {routeLabel(apiKey)}</span>
          </p>
        )}
        {error && <pre className="mt-2 whitespace-pre-wrap text-sm text-red-700">{error}</pre>}
      </Card>
    </Section>
  )
}
