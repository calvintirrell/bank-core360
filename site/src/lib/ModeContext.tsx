import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { MODE_KEY, resolveMode, type Mode } from './mode'

const Ctx = createContext<{ mode: Mode; setMode: (m: Mode) => void }>({ mode: 'bank', setMode: () => {} })

export function ModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<Mode>(() => {
    let stored: string | null = null
    try {
      stored = localStorage.getItem(MODE_KEY)
    } catch {
      /* private mode or blocked storage: fall through to the default */
    }
    return resolveMode(window.location.search, stored)
  })
  useEffect(() => {
    try {
      localStorage.setItem(MODE_KEY, mode)
    } catch {
      /* ignore */
    }
  }, [mode])
  return <Ctx.Provider value={{ mode, setMode: setModeState }}>{children}</Ctx.Provider>
}

export function useMode() {
  return useContext(Ctx)
}

/** Convenience: true in the non-technical view. */
export function useBankMode() {
  return useContext(Ctx).mode === 'bank'
}
