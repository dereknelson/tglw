import { describe, it, expect, vi, beforeEach } from 'vitest'
import { discoverStore } from './discover.js'

describe('discoverStore', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns llmsTxt and x402 when both exist', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = url.toString()
      if (urlStr.endsWith('/llms.txt')) {
        return new Response('# Store\nBuy stuff here', { status: 200 })
      }
      if (urlStr.endsWith('/.well-known/x402.json')) {
        return Response.json({ products: [{ id: 'tee', price: '35.00' }] })
      }
      return new Response('Not found', { status: 404 })
    })

    const result = await discoverStore('https://example.com')
    expect(result.llmsTxt).toContain('Buy stuff here')
    expect(result.x402).toEqual({ products: [{ id: 'tee', price: '35.00' }] })
  })

  it('returns nulls when store has no MPP metadata', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Not found', { status: 404 }),
    )

    const result = await discoverStore('https://example.com')
    expect(result.llmsTxt).toBeNull()
    expect(result.x402).toBeNull()
  })
})
