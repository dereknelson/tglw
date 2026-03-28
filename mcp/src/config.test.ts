import { describe, it, expect, vi, beforeEach } from 'vitest'
import { loadConfig, saveConfig } from './config.js'
import { readFile, writeFile, mkdir } from 'node:fs/promises'

vi.mock('node:fs/promises')

describe('config', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns empty config when file does not exist', async () => {
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'))
    const config = await loadConfig()
    expect(config).toEqual({})
  })

  it('round-trips config', async () => {
    let stored = ''
    vi.mocked(mkdir).mockResolvedValue(undefined)
    vi.mocked(writeFile).mockImplementation(async (_path, data) => {
      stored = data as string
    })
    vi.mocked(readFile).mockImplementation(async () => stored)

    const config = {
      stripeSecretKey: 'sk_test_123',
      paymentMethod: 'pm_card_visa',
      shipping: {
        name: 'Test User',
        address1: '123 Main St',
        city: 'LA',
        state: 'CA',
        zip: '90001',
        country: 'US',
      },
    }

    await saveConfig(config)
    const loaded = await loadConfig()
    expect(loaded).toEqual(config)
  })
})
