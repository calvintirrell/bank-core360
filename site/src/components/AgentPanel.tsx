import { useEffect, useMemo, useState } from 'react'
import { ready } from '../lib/duckdb'
import { useBankMode } from '../lib/ModeContext'
import { askLive, fromToolResult, replayRun, type AgentRun } from '../lib/agent'
import { DEFAULT_MODEL, DemoCapError, MODELS, PROXY_URL, fetchQuota, routeLabel, type ModelId, type Quota } from '../lib/anthropic'
import { loadAgentPrompt, loadAgentTool, loadReplay, type AgentTool, type Replay } from '../lib/lakehouse'
import type { Lineage } from '../lib/lineage'
import { ResultTable } from './ResultTable'
import { Card, Section } from './Section'

/** The own-key field is hidden by default; append ?byok to the URL to reveal it (or it shows
 *  automatically when a key is already stored in this tab's session). */
function byokRequested(): boolean {
  return new URLSearchParams(window.location.search).has('byok')
}

export function AgentPanel({ lineage }: { lineage: Lineage | null }) {
  const bank = useBankMode()
  const [showSettings, setShowSettings] = useState(false)
  const [apiKey, setApiKey] = useState(() => sessionStorage.getItem('bc360.apiKey') ?? '')
  const showByok = byokRequested() || apiKey !== '' || !PROXY_URL
  const models = showByok ? MODELS : MODELS.filter((m) => m.proxy)
  const [model, setModel] = useState<ModelId>(DEFAULT_MODEL)
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [run, setRun] = useState<AgentRun | null>(null)
  const [error, setError] = useState('')
  const [quota, setQuota] = useState<Quota | null>(null)
  const [capHit, setCapHit] = useState(false)
  const [replay, setReplay] = useState<Replay | null>(null)
  const [prompt, setPrompt] = useState<string | null>(null)
  const [tool, setTool] = useState<AgentTool | null>(null)
  const [useReplay, setUseReplay] = useState(false)
  const [engine, setEngine] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    ready().then(() => setEngine('ready')).catch(() => setEngine('error'))
    fetchQuota().then(setQuota)
    loadReplay().then(setReplay).catch(() => setReplay(null))
    loadAgentPrompt().then(setPrompt).catch(() => setPrompt(null))
    loadAgentTool().then(setTool).catch(() => setTool(null))
  }, [])

  const usingProxy = !apiKey && !!PROXY_URL
  const exhausted = usingProxy && (capHit || (quota !== null && quota.remaining_today <= 0))
  const liveAvailable = (!!apiKey || !!PROXY_URL) && !exhausted && !!prompt && !!tool
  const engineReady = engine === 'ready'
  const replayActive = useReplay || !liveAvailable

  const cached = useMemo(() => replay?.questions.find((q) => q.question === question.trim()) ?? null, [replay, question])

  async function ask(q: string) {
    const text = q.trim()
    if (!text) return
    setError('')
    const entry = replay?.questions.find((e) => e.question === text) ?? null
    if (replayActive) {
      if (!entry) {
        setError('Cached answers exist only for the listed questions. Pick one, or wait for the daily limit to reset.')
        return
      }
      setRun(replayRun(entry))
      return
    }
    setBusy(true)
    setRun(null)
    try {
      sessionStorage.setItem('bc360.apiKey', apiKey)
      const result = await askLive(text, { apiKey, model, prompt: prompt!, tool: tool!, onUpdate: setRun })
      setRun(result)
    } catch (e) {
      if (e instanceof DemoCapError) {
        setCapHit(true)
        if (entry) setRun(replayRun(entry))
      } else {
        setError(e instanceof Error ? e.message : String(e))
      }
    } finally {
      setBusy(false)
      if (usingProxy) fetchQuota().then(setQuota)
    }
  }

  return (
    <Section
      id="ask"
      title="Ask in plain English"
      subtitle={
        bank
          ? 'Pick a question or type your own. You get the answer in a sentence, and can open up how it was worked out.'
          : 'Pick a question or type your own. Claude writes the SQL, runs it right here in your browser, and explains the answer. Every column in the result keeps a badge saying which core it came from.'
      }
    >
      <Card>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {replay?.questions.map((q) => (
            <button
              key={q.id}
              type="button"
              disabled={busy || !engineReady}
              onClick={() => {
                setQuestion(q.question)
                ask(q.question)
              }}
              className="rounded-full border border-slate-300 bg-white px-3 py-1 text-left text-xs hover:bg-slate-100 disabled:opacity-40"
            >
              {q.question}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !busy && ask(question)}
            placeholder="Ask anything about these customers, accounts or transactions…"
            className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={() => ask(question)}
            disabled={busy || !engineReady || !question.trim() || (replayActive && !cached)}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            {!engineReady ? 'Loading engine…' : busy ? 'Thinking…' : replayActive ? 'Show cached answer' : 'Ask'}
          </button>
        </div>

        {bank && (
          <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
            <span>
              {engine === 'loading' && 'Loading the in-browser query engine…'}
              {engine === 'error' && <span className="text-red-700">The query engine failed to load; reload the page.</span>}
            </span>
            <button type="button" onClick={() => setShowSettings((v) => !v)} className="rounded-full border border-slate-300 px-2 py-0.5 hover:bg-slate-100" aria-expanded={showSettings} title="Model, cached answers, daily limit">
              ⚙ {showSettings ? 'hide settings' : 'settings'}
            </button>
          </div>
        )}
        <div className={`mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 ${bank && !showSettings ? 'hidden' : ''}`}>
          {showByok && (
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={PROXY_URL ? 'optional: your own sk-ant-… key' : 'sk-ant-…'}
              className="w-full rounded-md border border-slate-300 px-2 py-1 font-mono text-xs sm:w-64"
              autoComplete="off"
            />
          )}
          <label className="flex items-center gap-1">
            model
            <select value={model} onChange={(e) => setModel(e.target.value as ModelId)} className="rounded border border-slate-300 px-1 py-0.5 text-xs">
              {models.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={replayActive} disabled={!liveAvailable} onChange={(e) => setUseReplay(e.target.checked)} />
            cached answers only
          </label>
          {!bank && engine === 'loading' && <span>Loading the in-browser query engine…</span>}
          {!bank && engine === 'error' && <span className="text-red-700">The query engine failed to load; reload the page.</span>}
          {usingProxy && quota && !exhausted && (
            <span>
              Shared demo: {quota.remaining_today} of {quota.cap_today} {quota.unit === 'questions' ? 'questions' : 'API calls'} left today.
            </span>
          )}
          {!!apiKey && <span>Using your key, direct to api.anthropic.com.</span>}
        </div>

        {exhausted && (
          <p role="alert" className="mt-2 text-sm font-medium text-red-600">
            Daily demo limit reached ({quota?.cap_today ?? 8} {quota?.unit === 'questions' ? 'questions' : 'API calls'} per day). Cached answers for the listed questions still work. Live questions return after midnight UTC
            {byokRequested() ? ', or enter your own key.' : '.'}
          </p>
        )}
        {error && <pre className="mt-2 whitespace-pre-wrap text-sm text-red-700">{error}</pre>}
      </Card>

      {run && <Transcript run={run} lineage={lineage} apiKey={apiKey} busy={busy} />}
    </Section>
  )
}

function Transcript({ run, lineage, apiKey, busy }: { run: AgentRun; lineage: Lineage | null; apiKey: string; busy: boolean }) {
  const routeText = run.route === 'replay' ? 'cached answer (replay)' : routeLabel(apiKey)
  return (
    <div className="mt-4 space-y-3">
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
        <div className="text-xs uppercase tracking-wide text-slate-500">Question</div>
        <div className="text-sm font-medium">{run.question}</div>
      </div>
      {run.steps.map((s, i) => (
        <div key={i} className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="mb-1 text-xs uppercase tracking-wide text-slate-500">
            Step {i + 1}: ran SQL in the browser{s.result ? ` · ${s.result.row_count.toLocaleString()} row${s.result.row_count === 1 ? '' : 's'}` : ''}
          </div>
          <pre className="mb-2 overflow-x-auto rounded-md bg-slate-950 p-2 font-mono text-[11px] leading-snug text-slate-100">{s.sql}</pre>
          {s.error && <pre className="whitespace-pre-wrap rounded-md bg-red-50 p-2 text-xs text-red-700">{s.error}</pre>}
          {s.result && <ResultTable result={fromToolResult(s.result)} lineage={lineage} maxRows={25} />}
        </div>
      ))}
      {busy && run.steps.length === 0 && <div className="text-sm text-slate-500">Writing the query…</div>}
      {busy && run.steps.length > 0 && !run.explanation && <div className="text-sm text-slate-500">Reading the result…</div>}
      {run.explanation !== null && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
          <div className="mb-1 text-xs uppercase tracking-wide text-emerald-800">Answer</div>
          <Prose text={run.explanation} />
        </div>
      )}
      {run.pending && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          Cached answer: the SQL and result above are real, run by the pipeline. The model's written explanation for this question is generated in CI once an API key is configured there.
        </div>
      )}
      <div className="text-xs text-slate-500">
        {run.model ? `${run.model} via ${routeText}` : routeText}
        {run.calls > 0 && ` · ${run.calls} API call${run.calls === 1 ? '' : 's'} · ${run.usage.input_tokens.toLocaleString()} in / ${run.usage.output_tokens.toLocaleString()} out tokens`}
      </div>
    </div>
  )
}

/** Minimal rendering for the model's short answer: paragraphs, "- " bullets, **bold** and `code`. */
function Prose({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/)
  return (
    <div className="space-y-2 text-sm text-slate-800">
      {blocks.map((b, i) => {
        const lines = b.split('\n').filter((l) => l.trim() !== '')
        if (lines.length > 1 && lines.every((l) => /^\s*\|.*\|\s*$/.test(l))) {
          const rows = lines.filter((l) => !/^\s*\|[\s:|-]+\|\s*$/.test(l)).map((l) => l.trim().slice(1, -1).split('|').map((c) => c.trim()))
          return (
            <div key={i} className="overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead><tr>{rows[0].map((c, j) => <th key={j} className="px-2 py-1 text-left font-medium text-slate-600"><Inline text={c} /></th>)}</tr></thead>
                <tbody>{rows.slice(1).map((r, k) => <tr key={k} className="border-t border-emerald-100">{r.map((c, j) => <td key={j} className="px-2 py-1 font-mono"><Inline text={c} /></td>)}</tr>)}</tbody>
              </table>
            </div>
          )
        }
        if (lines.length > 0 && lines.every((l) => /^\s*[-•*]\s+/.test(l))) {
          return (
            <ul key={i} className="list-disc space-y-0.5 pl-5">
              {lines.map((l, j) => <li key={j}><Inline text={l.replace(/^\s*[-•*]\s+/, '')} /></li>)}
            </ul>
          )
        }
        return <p key={i}>{lines.map((l, j) => <span key={j}>{j > 0 && <br />}<Inline text={l} /></span>)}</p>
      })}
    </div>
  )
}

function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith('**') && p.endsWith('**')) return <strong key={i}>{p.slice(2, -2)}</strong>
        if (p.startsWith('`') && p.endsWith('`')) return <code key={i} className="rounded bg-white/70 px-1 font-mono text-[12px]">{p.slice(1, -1)}</code>
        return <span key={i}>{p}</span>
      })}
    </>
  )
}
