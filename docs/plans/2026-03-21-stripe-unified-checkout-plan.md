# Unified Stripe + x402 Checkout Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add credit card payments (Stripe Elements for humans, MPP/SPTs for agents) alongside existing x402 crypto payments, with all revenue settling into a single Stripe account.

**Architecture:** Single `/api/checkout` endpoint returns 402 with multiple accepted payment schemes (x402 crypto + Stripe card). The server inspects the payment header to determine verification path. Both paths call `createOrder(apliiq)` on success. A webhook provides idempotent fallback for card payments.

**Tech Stack:** Stripe SDK, @stripe/stripe-js, @stripe/react-stripe-js, mppx (for MPP/SPT agent card path), TanStack Start, Vitest

---

### Task 1: Install dependencies and add env vars

**Files:**
- Modify: `package.json`
- Modify: `.env`

**Step 1: Install Stripe packages**

Run:
```bash
npm install stripe @stripe/stripe-js @stripe/react-stripe-js mppx
```

**Step 2: Add Stripe env vars to `.env`**

Add these lines to `.env`:
```
STRIPE_SECRET_KEY=sk_test_PLACEHOLDER
STRIPE_PUBLISHABLE_KEY=pk_test_PLACEHOLDER
STRIPE_WEBHOOK_SECRET=whsec_PLACEHOLDER
```

**Step 3: Commit**

```bash
git add package.json package-lock.json .env
git commit -m "chore: add stripe and mppx dependencies"
```

---

### Task 2: Create Stripe server utility

**Files:**
- Create: `src/server/stripe.ts`
- Test: `src/server/stripe.test.ts`

**Step 1: Write the failing test**

```typescript
// src/server/stripe.test.ts
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
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/stripe.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```typescript
// src/server/stripe.ts
import Stripe from 'stripe'
import type { ShippingInfo } from './apliiq'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-03-04.preview' as Stripe.LatestApiVersion,
})

export { stripe }

interface CheckoutPaymentInput {
  shipping: ShippingInfo
  size: string
  designUrl?: string
}

export async function createCheckoutPaymentIntent(input: CheckoutPaymentInput) {
  const { shipping, size, designUrl } = input

  const paymentIntent = await stripe.paymentIntents.create({
    amount: 3500,
    currency: 'usd',
    payment_method_types: ['card'],
    metadata: {
      shipping_name: shipping.name,
      shipping_address1: shipping.address1,
      shipping_city: shipping.city,
      shipping_state: shipping.state,
      shipping_zip: shipping.zip,
      shipping_country: shipping.country,
      size,
      ...(designUrl ? { designUrl } : {}),
    },
  })

  return {
    clientSecret: paymentIntent.client_secret!,
    paymentIntentId: paymentIntent.id,
  }
}

export async function verifyPaymentIntent(paymentIntentId: string) {
  const pi = await stripe.paymentIntents.retrieve(paymentIntentId)
  return {
    verified: pi.status === 'succeeded',
    metadata: pi.metadata,
  }
}

export function constructWebhookEvent(
  body: string,
  signature: string,
): Stripe.Event {
  return stripe.webhooks.constructEvent(
    body,
    signature,
    process.env.STRIPE_WEBHOOK_SECRET!,
  )
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/server/stripe.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/server/stripe.ts src/server/stripe.test.ts
git commit -m "feat: add Stripe server utility for PaymentIntents"
```

---

### Task 3: Create `/api/checkout/create-intent` endpoint

**Files:**
- Create: `src/routes/api/checkout/create-intent.ts`

**Step 1: Write the endpoint**

```typescript
// src/routes/api/checkout/create-intent.ts
import { createFileRoute } from '@tanstack/react-router'
import { createCheckoutPaymentIntent } from '../../../server/stripe'
import type { ShippingInfo } from '../../../server/apliiq'

const VALID_SIZES = ['S', 'M', 'L', 'XL', '2XL']

export const Route = createFileRoute('/api/checkout/create-intent')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: { shipping?: ShippingInfo; size?: string; designUrl?: string }
        try {
          body = await request.json()
        } catch {
          return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
        }

        const { shipping, size } = body
        if (!shipping || !size) {
          return Response.json(
            { error: 'Missing required fields: shipping, size' },
            { status: 400 },
          )
        }

        if (!VALID_SIZES.includes(size)) {
          return Response.json(
            { error: `Invalid size. Must be one of: ${VALID_SIZES.join(', ')}` },
            { status: 400 },
          )
        }

        if (
          !shipping.name ||
          !shipping.address1 ||
          !shipping.city ||
          !shipping.state ||
          !shipping.zip ||
          !shipping.country
        ) {
          return Response.json(
            { error: 'Missing shipping fields: name, address1, city, state, zip, country' },
            { status: 400 },
          )
        }

        try {
          const result = await createCheckoutPaymentIntent({
            shipping,
            size,
            designUrl: body.designUrl,
          })

          return Response.json({
            clientSecret: result.clientSecret,
            paymentIntentId: result.paymentIntentId,
          })
        } catch (err) {
          console.error('Failed to create PaymentIntent:', err)
          return Response.json(
            { error: 'Failed to create payment session' },
            { status: 500 },
          )
        }
      },
    },
  },
})
```

**Step 2: Commit**

```bash
git add src/routes/api/checkout/create-intent.ts
git commit -m "feat: add /api/checkout/create-intent endpoint for card payments"
```

---

### Task 4: Create `/api/checkout/webhook` endpoint

**Files:**
- Create: `src/routes/api/checkout/webhook.ts`

**Step 1: Write the webhook handler**

```typescript
// src/routes/api/checkout/webhook.ts
import { createFileRoute } from '@tanstack/react-router'
import { constructWebhookEvent } from '../../../server/stripe'
import { createOrder } from '../../../server/apliiq'
import type { ShippingInfo } from '../../../server/apliiq'

export const Route = createFileRoute('/api/checkout/webhook')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await request.text()
        const signature = request.headers.get('stripe-signature')

        if (!signature) {
          return Response.json({ error: 'Missing signature' }, { status: 400 })
        }

        let event
        try {
          event = constructWebhookEvent(body, signature)
        } catch (err) {
          console.error('Webhook signature verification failed:', err)
          return Response.json({ error: 'Invalid signature' }, { status: 400 })
        }

        if (event.type === 'payment_intent.succeeded') {
          const pi = event.data.object as {
            id: string
            metadata: Record<string, string>
          }

          const { metadata } = pi
          const shipping: ShippingInfo = {
            name: metadata.shipping_name,
            address1: metadata.shipping_address1,
            city: metadata.shipping_city,
            state: metadata.shipping_state,
            zip: metadata.shipping_zip,
            country: metadata.shipping_country,
          }

          try {
            const order = await createOrder(
              shipping,
              metadata.size,
              metadata.designUrl,
            )
            console.log(
              `Webhook: created Apliiq order ${order.orderId} for PI ${pi.id}`,
            )
          } catch (err) {
            console.error(
              `Webhook: failed to create order for PI ${pi.id}:`,
              err,
            )
            // Return 500 so Stripe retries
            return Response.json(
              { error: 'Order creation failed' },
              { status: 500 },
            )
          }
        }

        return Response.json({ received: true })
      },
    },
  },
})
```

**Step 2: Commit**

```bash
git add src/routes/api/checkout/webhook.ts
git commit -m "feat: add Stripe webhook handler for card payment fulfillment"
```

---

### Task 5: Update `/api/checkout` to accept both x402 and Stripe card payments

**Files:**
- Modify: `src/routes/api/checkout.ts`

**Step 1: Update the checkout endpoint**

The 402 response now advertises both x402 and Stripe schemes. When a `X-Stripe-Payment-Intent` header is present, verify via Stripe instead of x402 facilitator.

Replace the entire file with:

```typescript
// src/routes/api/checkout.ts
import { createFileRoute } from '@tanstack/react-router'
import { createOrder } from '../../server/apliiq'
import { verifyPaymentIntent, createCheckoutPaymentIntent } from '../../server/stripe'
import type { ShippingInfo } from '../../server/apliiq'

const PAY_TO = process.env.X402_PAY_TO!
const FACILITATOR_URL = 'https://api.cdp.coinbase.com/platform/v2/x402'

// USDC on Base mainnet
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const NETWORK_BASE = 'eip155:8453'

// $35.00 in USDC base units (6 decimals)
const PRICE_AMOUNT = '35000000'

const VALID_SIZES = ['S', 'M', 'L', 'XL', '2XL']

const x402Requirements = {
  scheme: 'exact',
  network: NETWORK_BASE,
  asset: USDC_BASE,
  amount: PRICE_AMOUNT,
  payTo: PAY_TO,
  maxTimeoutSeconds: 300,
  description: 'TGLW — Lift Weights Touch Grass Black Tee — $35 USDC on Base',
  extra: {},
}

export const Route = createFileRoute('/api/checkout')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: { shipping?: ShippingInfo; size?: string; designUrl?: string }
        try {
          body = await request.json()
        } catch {
          return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
        }

        const { shipping, size } = body
        if (!shipping || !size) {
          return Response.json(
            { error: 'Missing required fields: shipping, size' },
            { status: 400 },
          )
        }

        if (!VALID_SIZES.includes(size)) {
          return Response.json(
            { error: `Invalid size. Must be one of: ${VALID_SIZES.join(', ')}` },
            { status: 400 },
          )
        }

        if (
          !shipping.name ||
          !shipping.address1 ||
          !shipping.city ||
          !shipping.state ||
          !shipping.zip ||
          !shipping.country
        ) {
          return Response.json(
            { error: 'Missing shipping fields: name, address1, city, state, zip, country' },
            { status: 400 },
          )
        }

        // Check for Stripe card payment
        const stripePaymentIntentId = request.headers.get(
          'X-Stripe-Payment-Intent',
        )

        // Check for x402 payment signature
        const paymentSignature =
          request.headers.get('Payment-Signature') ||
          request.headers.get('X-Payment')

        // No payment header — return 402 with all accepted methods
        if (!stripePaymentIntentId && !paymentSignature) {
          // Create a PaymentIntent for the card option
          let stripeClientSecret: string | null = null
          let stripePaymentId: string | null = null
          try {
            const intent = await createCheckoutPaymentIntent({
              shipping,
              size,
              designUrl: body.designUrl,
            })
            stripeClientSecret = intent.clientSecret
            stripePaymentId = intent.paymentIntentId
          } catch (err) {
            console.error('Failed to create Stripe PaymentIntent:', err)
          }

          const paymentRequired = btoa(
            JSON.stringify({
              x402Version: 2,
              accepts: [x402Requirements],
            }),
          )

          return new Response(
            JSON.stringify({
              error: 'Payment required',
              description: x402Requirements.description,
              methods: {
                x402: {
                  price: '$35.00 USDC',
                  network: 'Base',
                },
                stripe: stripeClientSecret
                  ? {
                      price: '$35.00',
                      clientSecret: stripeClientSecret,
                      paymentIntentId: stripePaymentId,
                      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
                    }
                  : null,
              },
            }),
            {
              status: 402,
              headers: {
                'Content-Type': 'application/json',
                'Payment-Required': paymentRequired,
              },
            },
          )
        }

        // === Stripe card payment path ===
        if (stripePaymentIntentId) {
          const verification = await verifyPaymentIntent(stripePaymentIntentId)

          if (!verification.verified) {
            return Response.json(
              { error: 'Card payment not confirmed' },
              { status: 402 },
            )
          }

          let orderResult: { orderId: string; status: string }
          try {
            orderResult = await createOrder(shipping, size, body.designUrl)
          } catch (err) {
            console.error('Apliiq order creation failed:', err)
            return Response.json(
              {
                error:
                  'Order fulfillment failed. Payment was captured. Contact support.',
              },
              { status: 500 },
            )
          }

          return Response.json({
            order_id: orderResult.orderId,
            status: orderResult.status,
            payment_method: 'card',
            message: 'Your shirt is on the way.',
          })
        }

        // === x402 crypto payment path ===
        let paymentPayload: Record<string, unknown>
        try {
          paymentPayload = JSON.parse(atob(paymentSignature!))
        } catch {
          return Response.json(
            { error: 'Invalid payment signature encoding' },
            { status: 400 },
          )
        }

        const verifyRes = await fetch(`${FACILITATOR_URL}/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            x402Version: paymentPayload.x402Version ?? 2,
            paymentPayload,
            paymentRequirements: x402Requirements,
          }),
        })

        const verifyResult = (await verifyRes.json()) as {
          isValid: boolean
          invalidReason?: string
        }

        if (!verifyResult.isValid) {
          return Response.json(
            {
              error: 'Payment verification failed',
              reason: verifyResult.invalidReason,
            },
            { status: 402 },
          )
        }

        let orderResult: { orderId: string; status: string }
        try {
          orderResult = await createOrder(shipping, size, body.designUrl)
        } catch (err) {
          console.error('Apliiq order creation failed:', err)
          return Response.json(
            {
              error:
                'Order fulfillment failed. Payment was verified. Contact support.',
            },
            { status: 500 },
          )
        }

        const settleRes = await fetch(`${FACILITATOR_URL}/settle`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            x402Version: paymentPayload.x402Version ?? 2,
            paymentPayload,
            paymentRequirements: x402Requirements,
          }),
        })

        const settleResult = (await settleRes.json()) as {
          success: boolean
          transaction?: string
          errorReason?: string
        }

        if (!settleResult.success) {
          console.error('Payment settlement failed:', settleResult.errorReason)
        }

        const responseBody = {
          order_id: orderResult.orderId,
          status: orderResult.status,
          tx_hash: settleResult.transaction || null,
          payment_method: 'x402',
          message: 'Your shirt is on the way.',
        }

        const paymentResponse = btoa(
          JSON.stringify({
            success: settleResult.success,
            transaction: settleResult.transaction,
          }),
        )

        return new Response(JSON.stringify(responseBody), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Payment-Response': paymentResponse,
          },
        })
      },
    },
  },
})
```

**Step 2: Run build to check for type errors**

Run: `npm run build`
Expected: PASS (or only pre-existing warnings)

**Step 3: Commit**

```bash
git add src/routes/api/checkout.ts
git commit -m "feat: update /api/checkout to accept both x402 and Stripe card payments"
```

---

### Task 6: Create `CardPaymentForm` component

**Files:**
- Create: `src/components/CardPaymentForm.tsx`

**Step 1: Write the component**

```typescript
// src/components/CardPaymentForm.tsx
import { useState } from 'react'
import {
  Elements,
  CardElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js'
import { loadStripe } from '@stripe/stripe-js'

interface CardPaymentFormProps {
  clientSecret: string
  publishableKey: string
  onSuccess: (paymentIntentId: string) => void
  onError: (error: string) => void
  disabled?: boolean
}

function CardForm({
  clientSecret,
  onSuccess,
  onError,
  disabled,
}: Omit<CardPaymentFormProps, 'publishableKey'>) {
  const stripe = useStripe()
  const elements = useElements()
  const [processing, setProcessing] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!stripe || !elements) return

    setProcessing(true)

    const result = await stripe.confirmCardPayment(clientSecret, {
      payment_method: { card: elements.getElement(CardElement)! },
    })

    if (result.error) {
      onError(result.error.message || 'Card payment failed')
      setProcessing(false)
    } else if (result.paymentIntent?.status === 'succeeded') {
      onSuccess(result.paymentIntent.id)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-3">
        <CardElement
          options={{
            style: {
              base: {
                fontSize: '14px',
                color: 'var(--ink)',
                '::placeholder': { color: 'var(--ink-muted)' },
              },
            },
          }}
        />
      </div>
      <button
        type="submit"
        disabled={!stripe || processing || disabled}
        className="mt-3 w-full cursor-pointer rounded-full bg-[var(--accent)] px-8 py-3.5 text-sm font-semibold uppercase tracking-[0.15em] text-white transition hover:bg-[var(--accent-hover)] hover:scale-[1.02] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {processing ? 'Processing...' : 'Pay $35'}
      </button>
    </form>
  )
}

export default function CardPaymentForm(props: CardPaymentFormProps) {
  const stripePromise = loadStripe(props.publishableKey)

  return (
    <Elements stripe={stripePromise} options={{ clientSecret: props.clientSecret }}>
      <CardForm
        clientSecret={props.clientSecret}
        onSuccess={props.onSuccess}
        onError={props.onError}
        disabled={props.disabled}
      />
    </Elements>
  )
}
```

**Step 2: Commit**

```bash
git add src/components/CardPaymentForm.tsx
git commit -m "feat: add CardPaymentForm component with Stripe Elements"
```

---

### Task 7: Update `CheckoutForm` with payment method toggle

**Files:**
- Modify: `src/components/CheckoutForm.tsx`

**Step 1: Update CheckoutForm to support both payment methods**

Replace the entire file with:

```typescript
// src/components/CheckoutForm.tsx
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

  // Request 402 to get both payment options
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

  // x402 crypto checkout
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

  // Card checkout: first get clientSecret, then user fills card in CardPaymentForm
  async function handleCardInit() {
    const data = await initPayment()
    if (!data) return
    // stripeInfo is now set, CardPaymentForm will render
    // Status stays 'paying' until card is confirmed
  }

  // Called by CardPaymentForm on success
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
```

**Step 2: Run build to check for type errors**

Run: `npm run build`
Expected: PASS

**Step 3: Commit**

```bash
git add src/components/CheckoutForm.tsx
git commit -m "feat: add payment method toggle (USDC / Card) to CheckoutForm"
```

---

### Task 8: Add MPP/SPT support for agent card payments

**Files:**
- Modify: `src/routes/api/checkout.ts`

**Step 1: Add SPT handling to the checkout endpoint**

Add a check for `X-Shared-Payment-Token` header in the existing checkout handler. When present, create and confirm a PaymentIntent using the SPT, then proceed with order creation.

In `src/routes/api/checkout.ts`, add after the Stripe import:

```typescript
import { stripe } from '../../server/stripe'
```

Add this block after the `stripePaymentIntentId` check and before the x402 path:

```typescript
        // === MPP / SPT agent card payment path ===
        const sptToken = request.headers.get('X-Shared-Payment-Token')
        if (sptToken) {
          try {
            const pi = await stripe.paymentIntents.create({
              amount: 3500,
              currency: 'usd',
              shared_payment_granted_token: sptToken,
              confirm: true,
              metadata: {
                shipping_name: shipping.name,
                shipping_address1: shipping.address1,
                shipping_city: shipping.city,
                shipping_state: shipping.state,
                shipping_zip: shipping.zip,
                shipping_country: shipping.country,
                size,
                ...(designUrl ? { designUrl: body.designUrl! } : {}),
              },
            } as any)

            if (pi.status !== 'succeeded') {
              return Response.json(
                { error: 'SPT payment not confirmed', status: pi.status },
                { status: 402 },
              )
            }

            let orderResult: { orderId: string; status: string }
            try {
              orderResult = await createOrder(shipping, size, body.designUrl)
            } catch (err) {
              console.error('Apliiq order creation failed:', err)
              return Response.json(
                {
                  error:
                    'Order fulfillment failed. Payment was captured. Contact support.',
                },
                { status: 500 },
              )
            }

            return Response.json({
              order_id: orderResult.orderId,
              status: orderResult.status,
              payment_method: 'spt',
              message: 'Your shirt is on the way.',
            })
          } catch (err) {
            console.error('SPT payment failed:', err)
            return Response.json(
              { error: 'SPT payment failed' },
              { status: 402 },
            )
          }
        }
```

**Step 2: Run build to check for type errors**

Run: `npm run build`
Expected: PASS

**Step 3: Commit**

```bash
git add src/routes/api/checkout.ts
git commit -m "feat: add MPP/SPT support for agent card payments"
```

---

### Task 9: Update store page footer text

**Files:**
- Modify: `src/routes/index.tsx`

**Step 1: Update the "Powered by" text**

Change line 133 from:
```tsx
<p className="mt-4 text-xs text-[var(--ink-muted)]">Powered by x402</p>
```
to:
```tsx
<p className="mt-4 text-xs text-[var(--ink-muted)]">Powered by x402 + Stripe</p>
```

**Step 2: Commit**

```bash
git add src/routes/index.tsx
git commit -m "chore: update footer to reflect both payment methods"
```

---

### Task 10: Manual smoke test

**Step 1: Start dev server**

Run: `npm run dev`

**Step 2: Test card flow**

1. Open `http://localhost:3001`
2. Click "Buy Now"
3. Fill in size + shipping
4. Toggle to "Card"
5. Click "Pay $35 Card" — should show Stripe card input
6. Use test card `4242 4242 4242 4242`, any future expiry, any CVC
7. Should see order confirmation

**Step 3: Test crypto flow still works**

1. Toggle back to "USDC"
2. Connect wallet
3. Click "Pay $35 USDC" — should trigger x402 flow as before

**Step 4: Test agent SPT flow (curl)**

```bash
# First create a test SPT in Stripe sandbox (run once)
curl -X POST https://api.stripe.com/v1/test_helpers/shared_payment/granted_tokens \
  -u sk_test_YOUR_KEY: \
  -d payment_method=pm_card_visa \
  -d "usage_limits[currency]=usd" \
  -d "usage_limits[max_amount]=10000" \
  -d "usage_limits[expires_at]=1999999999"

# Then use the SPT to buy
curl -X POST http://localhost:3001/api/checkout \
  -H "Content-Type: application/json" \
  -H "X-Shared-Payment-Token: spt_XXXXX" \
  -d '{"shipping":{"name":"Agent Smith","address1":"123 AI St","city":"Austin","state":"TX","zip":"78701","country":"US"},"size":"L"}'
```

Expected: `{ "order_id": "...", "payment_method": "spt", "message": "Your shirt is on the way." }`

**Step 5: Final commit**

```bash
git add -A
git commit -m "feat: unified checkout with x402 crypto + Stripe card + MPP/SPT agent payments"
```
