/** Runs async jobs one at a time. Each call names what it wants; a queued job whose key is no
 *  longer the most recent request is skipped, so rapid switches settle on the last one and two
 *  jobs never interleave. A failed job rejects its own promise and leaves the queue usable. */
export function latestOnlyQueue<K>() {
  let chain: Promise<unknown> = Promise.resolve()
  let wanted: K | undefined
  return (key: K, job: () => Promise<void>): Promise<void> => {
    wanted = key
    const p = chain.then(() => (wanted === key ? job() : undefined))
    chain = p.catch(() => undefined)
    return p
  }
}
