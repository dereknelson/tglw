import { useState, useMemo, lazy, Suspense } from 'react'
import { Elements, AddressElement } from '@stripe/react-stripe-js'
import { loadStripe } from '@stripe/stripe-js'
import type { StripeAddressElementChangeEvent } from '@stripe/stripe-js'

const CryptoPayment = lazy(() => import('./CryptoPayment'))
const CardPaymentForm = lazy(() => import('./CardPaymentForm'))

const VALID_SIZES = ['S', 'M', 'L', 'XL', '2XL'] as const

type PaymentMethod = 'crypto' | 'card'

interface CheckoutFormProps {
  onClose: () => void
  designUrl?: string
}

interface ShippingData {
  name: string
  address1: string
  city: string
  state: string
  zip: string
  country: string
}

function CheckoutFormInner({
  onClose,
  designUrl,
}: CheckoutFormProps) {
  const [size, setSize] = useState<string>('L')
  const [shipping, setShipping] = useState<ShippingData | null>(null)
  const [shippingComplete, setShippingComplete] = useState(false)
  const [status, setStatus] = useState<'idle' | 'paying' | 'success' | 'error'>(
    'idle',
  )
  const [error, setError] = useState('')
  const [orderResult, setOrderResult] = useState<{
    order_id: string
    tx_hash: string | null
    payment_method: string
  } | null>(null)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('card')
  const [stripeInfo, setStripeInfo] = useState<{
    clientSecret: string
    paymentIntentId: string
    publishableKey: string
  } | null>(null)

  function handleAddressChange(event: StripeAddressElementChangeEvent) {
    setShippingComplete(event.complete)
    if (event.complete) {
      const addr = event.value.address
      setShipping({
        name: event.value.name,
        address1: addr.line1,
        city: addr.city,
        state: addr.state,
        zip: addr.postal_code,
        country: addr.country,
      })
    } else {
      setShipping(null)
    }
  }

  async function initPayment() {
    if (!shipping) return null
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
        setStatus('idle')
        return data
      }

      throw new Error('Unexpected response')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to initialize payment')
      setStatus('idle')
      return null
    }
  }

  async function handleCardInit() {
    await initPayment()
  }

  async function handleCardSuccess(paymentIntentId: string) {
    if (!shipping) return
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
      <div className="rise-in w-full max-w-sm rounded-2xl bg-[var(--surface)] p-6 shadow-xl max-h-[90vh] overflow-y-auto">
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

        {/* Shipping — Stripe Address Element */}
        <div className="mb-5">
          <label className="mb-2 block text-xs font-semibold uppercase tracking-widest text-[var(--ink-muted)]">
            Shipping
          </label>
          <AddressElement
            options={{
              mode: 'shipping',
              autocomplete: { mode: 'automatic' },
              allowedCountries: ['US'],
            }}
            onChange={handleAddressChange}
          />
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
            <Suspense
              fallback={
                <div className="py-4 text-center text-sm text-[var(--ink-muted)]">
                  Loading...
                </div>
              }
            >
              <CryptoPayment
                shipping={shipping || { name: '', address1: '', city: '', state: '', zip: '', country: 'US' }}
                size={size}
                designUrl={designUrl}
                shippingValid={shippingComplete}
                status={status}
                onStatusChange={setStatus}
                onError={(err) => {
                  setError(err)
                  setStatus('error')
                }}
                onSuccess={(result) => {
                  setOrderResult(result)
                  setStatus('success')
                }}
              />
            </Suspense>
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
                  disabled={status === 'paying' || !shippingComplete}
                  className="w-full cursor-pointer rounded-full bg-[var(--accent)] px-8 py-3.5 text-sm font-semibold uppercase tracking-[0.15em] text-white transition hover:bg-[var(--accent-hover)] hover:scale-[1.02] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {status === 'paying' ? 'Loading...' : 'Pay $25 Card'}
                </button>
              )}
            </>
          )}

          {error && <p className="text-center text-sm text-red-500">{error}</p>}
        </div>

        <p className="mt-4 text-center text-xs text-[var(--ink-muted)]">
          {paymentMethod === 'crypto'
            ? '$25 USDC on Base · Powered by x402'
            : '$25.00 · Powered by Stripe'}
        </p>
      </div>
    </div>
  )
}

export default function CheckoutForm(props: CheckoutFormProps) {
  const stripePromise = useMemo(
    () => loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || ''),
    [],
  )

  return (
    <Elements stripe={stripePromise}>
      <CheckoutFormInner {...props} />
    </Elements>
  )
}
