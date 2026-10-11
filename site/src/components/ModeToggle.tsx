import { useMode } from '../lib/ModeContext'

export function ModeToggle() {
  const { mode, setMode } = useMode()
  const btn = (m: 'bank' | 'tech', label: string) => (
    <button
      type="button"
      onClick={() => setMode(m)}
      aria-pressed={mode === m}
      className={`rounded-full px-3 py-1 text-xs font-medium transition ${mode === m ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
    >
      {label}
    </button>
  )
  return (
    <div className="ml-auto flex items-center gap-1 rounded-full border border-slate-200 bg-white p-0.5" title="Choose how much detail to show">
      {btn('bank', 'I run the bank')}
      {btn('tech', 'I build the data')}
    </div>
  )
}
