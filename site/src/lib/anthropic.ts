import Anthropic from '@anthropic-ai/sdk'

export const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (default)' },
  { id: 'claude-fable-5-1', label: 'Claude Fable 5.1' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
] as const
export type ModelId = (typeof MODELS)[number]['id']
export const DEFAULT_MODEL: ModelId = 'claude-opus-5-5'

/** Bring-your-own-key client. The key stays in the browser and goes only to api.anthropic.com. */
export function makeClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true })
}

/** Phase 0 spike: one round trip proves the browser -> Anthropic path works on GitHub Pages. */
export async function ping(apiKey: string, model: ModelId = DEFAULT_MODEL): Promise<string> {
  const client = makeClient(apiKey)
  const res = await client.messages.create({
    model,
    max_tokens: 1024,
    output_config: { effort: 'low' },
    messages: [{ role: 'user', content: 'Reply with exactly one word: READY' }],
  })
  if (res.stop_reason === 'refusal') return `refused (${res.stop_details?.category ?? 'unknown'})`
  return res.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()
}
