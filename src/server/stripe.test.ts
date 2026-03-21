import { describe, it, expect, vi } from 'vitest'

describe('createCheckoutPaymentIntent', () => {
  it('creates a PaymentIntent with correct amount and metadata', async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      id: 'pi_test123',
      client_secret: 'pi_test123_secret_abc',
      status: 'requires_payment_method',
    })

    vi.doMock('stripe', () => ({
      default: class {
        paymentIntents = { create: mockCreate }
      },
    }))

    const { createCheckoutPaymentIntent } = await import('./stripe')

    const result = await createCheckoutPaymentIntent({
      shipping: {
        name: 'Test User',
        address1: '123 Main St',
        city: 'Austin',
        state: 'TX',
        zip: '78701',
        country: 'US',
      },
      size: 'L',
      designUrl: 'https://example.com/design.png',
    })

    expect(result.clientSecret).toBe('pi_test123_secret_abc')
    expect(result.paymentIntentId).toBe('pi_test123')
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 3500,
        currency: 'usd',
        metadata: expect.objectContaining({
          size: 'L',
          designUrl: 'https://example.com/design.png',
        }),
      }),
    )
  })
})

describe('verifyPaymentIntent', () => {
  it('returns verified: true when status is succeeded', async () => {
    vi.resetModules()

    const mockRetrieve = vi.fn().mockResolvedValue({
      status: 'succeeded',
      metadata: { size: 'L' },
    })

    vi.doMock('stripe', () => ({
      default: class {
        paymentIntents = { create: vi.fn(), retrieve: mockRetrieve }
      },
    }))

    const { verifyPaymentIntent } = await import('./stripe')

    const result = await verifyPaymentIntent('pi_test123')

    expect(result.verified).toBe(true)
    expect(result.metadata).toEqual({ size: 'L' })
    expect(mockRetrieve).toHaveBeenCalledWith('pi_test123')
  })

  it('returns verified: false when status is not succeeded', async () => {
    vi.resetModules()

    const mockRetrieve = vi.fn().mockResolvedValue({
      status: 'requires_payment_method',
      metadata: {},
    })

    vi.doMock('stripe', () => ({
      default: class {
        paymentIntents = { create: vi.fn(), retrieve: mockRetrieve }
      },
    }))

    const { verifyPaymentIntent } = await import('./stripe')

    const result = await verifyPaymentIntent('pi_test456')

    expect(result.verified).toBe(false)
    expect(result.metadata).toEqual({})
    expect(mockRetrieve).toHaveBeenCalledWith('pi_test456')
  })
})
