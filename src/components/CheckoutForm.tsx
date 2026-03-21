import { useState, lazy, Suspense } from 'react'
import { useAccount, useWalletClient } from 'wagmi'
import { ConnectButton } from '@rainbow-me/rainbowkit'

const CardPaymentForm = lazy(() => import('./CardPaymentForm'))

const VALID_SIZES = ['S', 'M', 'L', 'XL', '2XL'] as const

type PaymentMethod = 'crypto' | 'card'

interface CheckoutFormProps {
  onClose: () => void
  designUrl?: string
}

export default function CheckoutForm({
  onClose,
  designUrl,
}: CheckoutFormProps) {
  const { isConnected } = useAccount()
  const { data: walletClient } = useWalletClient()
  const [size, setSize] = useState<string>('L')
  const [shipping, setShipping] = useState({
    name: '',
    address1: '',
    city: '',
    state: '',
    zip: '',
    country: 'US',
  })
  const [status, setStatus] = useState<'idle' | 'paying' | 'success' | 'error'>(
    'idle',
  )
  const [error, setError] = useState('')
  const [orderResult, setOrderResult] = useState<{
    order_id: string
    tx_hash: string | null
    payment_method: string
  } | null>(null)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('crypto')
  const [stripeInfo, setStripeInfo] = useState<{
    clientSecret: string
    paymentIntentId: string
    publishableKey: string
  } | null>(null)

  function updateShipping(field: string, value: string) {
    setShipping((prev) => ({ ...prev, [field]: value }))
  }

  const shippingValid =
    shipping.name &&
    shipping.address1 &&
    shipping.city &&
    shipping.state &&
    shipping.zip &&
    shipping.country

  async function initPayment() {
    setStatus('paying')
    setError('')

    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shipping, size, designUrl }),
      })

      if (res.status === 402) {
        const data = await res.json()
        if (data.methods?.stripe) {
          setStripeInfo(data.methods.stripe)
        }
        return data
      }

      throw new Error('Unexpected response')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to initialize payment')
      setStatus('idle')
      return null
    }
  }

  async function handleCryptoCheckout() {
    if (!isConnected || !walletClient) return

    setStatus('paying')
    setError('')

    try {
      const [
        { wrapFetchWithPayment, x402Client },
        { ExactEvmScheme, toClientEvmSigner },
      ] = await Promise.all([import('@x402/fetch'), import('@x402/evm')])

      const signer = toClientEvmSigner(walletClient as any)
      const client = new x402Client().register(
        'eip155:8453',
        new ExactEvmScheme(signer),
      )

      const fetchWithPayment = wrapFetchWithPayment(fetch, client)

      const res = await fetchWithPayment('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shipping, size, designUrl }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || `Request failed: ${res.status}`)
      }

      const data = await res.json()
      setOrderResult(data)
      setStatus('success')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Checkout failed')
      setStatus('error')
    }
  }

  async function handleCardInit() {
    const data = await initPayment()
    if (!data) return
  }

  async function handleCardSuccess(paymentIntentId: string) {
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Stripe-Payment-Intent': paymentIntentId,
        },
        body: JSON.stringify({ shipping, size, designUrl }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Order creation failed')
      }

      const data = await res.json()
      setOrderResult(data)
      setStatus('success')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Order creation failed')
      setStatus('error')
    }
  }

  const inputClass =
    'w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--ink)] outline-none focus:border-[var(--ink)] transition'

  if (status === 'success' && orderResult) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
        <div className="rise-in w-full max-w-sm rounded-2xl bg-[var(--surface)] p-8 text-center shadow-xl">
          <div className="mb-4 text-4xl">&#10003;</div>
          <h2 className="mb-2 text-xl font-semibold text-[var(--ink)]">
            Order Confirmed
          </h2>
          <p className="mb-1 text-sm text-[var(--ink-soft)]">
            Order #{orderResult.order_id}
          </p>
          {orderResult.tx_hash && (
            <p className="mb-4 text-xs text-[var(--ink-muted)]">
              tx: {orderResult.tx_hash.slice(0, 10)}...
            </p>
          )}
          <p className="mb-6 text-sm text-[var(--ink-soft)]">
            Your shirt is on the way.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-[var(--accent)] px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-[var(--accent-hover)]"
          >
            Done
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="rise-in w-full max-w-sm rounded-2xl bg-[var(--surface)] p-6 shadow-xl">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[var(--ink)]">Checkout</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-[var(--ink-muted)] hover:text-[var(--ink)]"
          >
            &times;
          </button>
        </div>

        {/* Size selector */}
        <div className="mb-5">
          <label className="mb-2 block text-xs font-semibold uppercase tracking-widest text-[var(--ink-muted)]">
            Size
          </label>
          <div className="flex gap-2">
            {VALID_SIZES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSize(s)}
                className={`flex-1 rounded-lg border py-2 text-sm font-medium transition ${
                  size === s
                    ? 'border-[var(--ink)] bg-[var(--ink)] text-white'
                    : 'border-[var(--line)] text-[var(--ink-soft)] hover:border-[var(--ink-muted)]'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Shipping fields */}
        <div className="mb-5 space-y-3">
          <label className="mb-2 block text-xs font-semibold uppercase tracking-widest text-[var(--ink-muted)]">
            Shipping
          </label>
          <input
            type="text"
            placeholder="Full name"
            value={shipping.name}
            onChange={(e) => updateShipping('name', e.target.value)}
            className={inputClass}
          />
          <input
            type="text"
            placeholder="Address"
            value={shipping.address1}
            onChange={(e) => updateShipping('address1', e.target.value)}
            className={inputClass}
          />
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="City"
              value={shipping.city}
              onChange={(e) => updateShipping('city', e.target.value)}
              className={inputClass}
            />
            <input
              type="text"
              placeholder="State"
              value={shipping.state}
              onChange={(e) => updateShipping('state', e.target.value)}
              className={`${inputClass} w-20`}
            />
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="ZIP"
              value={shipping.zip}
              onChange={(e) => updateShipping('zip', e.target.value)}
              className={inputClass}
            />
            <input
              type="text"
              placeholder="Country"
              value={shipping.country}
              onChange={(e) => updateShipping('country', e.target.value)}
              className={`${inputClass} w-20`}
            />
          </div>
        </div>

        {/* Payment method toggle */}
        <div className="mb-4">
          <label className="mb-2 block text-xs font-semibold uppercase tracking-widest text-[var(--ink-muted)]">
            Payment
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setPaymentMethod('crypto')
                setStripeInfo(null)
                setStatus('idle')
              }}
              className={`flex-1 rounded-lg border py-2.5 text-sm font-medium transition ${
                paymentMethod === 'crypto'
                  ? 'border-[var(--ink)] bg-[var(--ink)] text-white'
                  : 'border-[var(--line)] text-[var(--ink-soft)] hover:border-[var(--ink-muted)]'
              }`}
            >
              USDC
            </button>
            <button
              type="button"
              onClick={() => {
                setPaymentMethod('card')
                setStatus('idle')
              }}
              className={`flex-1 rounded-lg border py-2.5 text-sm font-medium transition ${
                paymentMethod === 'card'
                  ? 'border-[var(--ink)] bg-[var(--ink)] text-white'
                  : 'border-[var(--line)] text-[var(--ink-soft)] hover:border-[var(--ink-muted)]'
              }`}
            >
              Card
            </button>
          </div>
        </div>

        {/* Payment area */}
        <div className="space-y-3">
          {paymentMethod === 'crypto' ? (
            <>
              {!isConnected ? (
                <div className="flex justify-center">
                  <ConnectButton />
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleCryptoCheckout}
                  disabled={status === 'paying' || !shippingValid}
                  className="w-full cursor-pointer rounded-full bg-[var(--accent)] px-8 py-3.5 text-sm font-semibold uppercase tracking-[0.15em] text-white transition hover:bg-[var(--accent-hover)] hover:scale-[1.02] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {status === 'paying' ? 'Processing...' : 'Pay $35 USDC'}
                </button>
              )}
            </>
          ) : (
            <>
              {stripeInfo ? (
                <Suspense
                  fallback={
                    <div className="py-4 text-center text-sm text-[var(--ink-muted)]">
                      Loading...
                    </div>
                  }
                >
                  <CardPaymentForm
                    clientSecret={stripeInfo.clientSecret}
                    publishableKey={stripeInfo.publishableKey}
                    onSuccess={handleCardSuccess}
                    onError={(err) => {
                      setError(err)
                      setStatus('error')
                    }}
                    disabled={status === 'paying'}
                  />
                </Suspense>
              ) : (
                <button
                  type="button"
                  onClick={handleCardInit}
                  disabled={status === 'paying' || !shippingValid}
                  className="w-full cursor-pointer rounded-full bg-[var(--accent)] px-8 py-3.5 text-sm font-semibold uppercase tracking-[0.15em] text-white transition hover:bg-[var(--accent-hover)] hover:scale-[1.02] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {status === 'paying' ? 'Loading...' : 'Pay $35 Card'}
                </button>
              )}
            </>
          )}

          {error && <p className="text-center text-sm text-red-500">{error}</p>}
        </div>

        <p className="mt-4 text-center text-xs text-[var(--ink-muted)]">
          {paymentMethod === 'crypto'
            ? '$35 USDC on Base · Powered by x402'
            : '$35.00 · Powered by Stripe'}
        </p>
      </div>
    </div>
  )
}
