import { createContext, useContext, useState, type ReactNode } from 'react'
import { versionDir, type VersionId } from './versions'

export { versionDir, versionIds, type VersionId } from './versions'

export function resolveVersion(search: string): VersionId {
  const q = new URLSearchParams(search).get('asof')
  return q && /^v\d+$/.test(q) ? (q as VersionId) : 'latest'
}

const Ctx = createContext<{ version: VersionId; setVersion: (v: VersionId) => void }>({ version: 'latest', setVersion: () => {} })

export function AsOfProvider({ children }: { children: ReactNode }) {
  const [version, setVersion] = useState<VersionId>(() => resolveVersion(window.location.search))
  return <Ctx.Provider value={{ version, setVersion }}>{children}</Ctx.Provider>
}

export function useAsOf() {
  return useContext(Ctx)
}
