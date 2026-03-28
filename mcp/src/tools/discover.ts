import { z } from 'zod'

export const discoverSchema = {
  url: z.string().url().describe('Base URL of the store (e.g. https://tglw.com)'),
}

export async function discoverStore(url: string): Promise<{
  llmsTxt: string | null
  x402: Record<string, unknown> | null
}> {
  const base = url.replace(/\/$/, '')

  let llmsTxt: string | null = null
  try {
    const res = await fetch(`${base}/llms.txt`)
    if (res.ok) llmsTxt = await res.text()
  } catch {}

  let x402: Record<string, unknown> | null = null
  try {
    const res = await fetch(`${base}/.well-known/x402.json`)
    if (res.ok) x402 = await res.json() as Record<string, unknown>
  } catch {}

  return { llmsTxt, x402 }
}
