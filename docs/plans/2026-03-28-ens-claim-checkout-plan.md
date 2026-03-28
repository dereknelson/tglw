# ENS Claim Checkout Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let users pay by sending $25 USDC to computa.eth on Base, then claim their order by proving they're the sender via wallet signature. Includes a /claim page, API endpoint, and background poller with Slack alerts.

**Architecture:** New `/api/claim` endpoint verifies on-chain USDC transfers to computa.eth and wallet signatures. New `/claim` page connects wallet, finds matching txs, collects shipping. Vercel cron poller checks for unclaimed payments and alerts via Slack. Price becomes a configurable env var across the whole app.

**Tech Stack:** viem (already installed) for on-chain reads + signature verification, existing RainbowKit/wagmi for wallet connection, Vercel cron for poller

---

### Task 1: Make price configurable and update to $25

**Files:**
- Create: `src/server/price.ts`
- Modify: `src/routes/api/checkout.ts`
- Modify: `src/server/stripe.ts`
- Modify: `src/routes/index.tsx`
- Modify: `src/components/CheckoutForm.tsx`
- Modify: `src/components/CardPaymentForm.tsx`
- Modify: `src/components/CryptoPayment.tsx`
- Modify: `public/.well-known/x402.json`
- Modify: `public/llms.txt`

**Step 1: Create price.ts**

```typescript
// src/server/price.ts
const PRICE_USD = parseInt(process.env.TGLW_PRICE_USDC || '25', 10)

export const PRICE = {
  usd: PRICE_USD,
  cents: PRICE_USD * 100,
  usdc6: (PRICE_USD * 1_000_000).toString(),
  display: `$${PRICE_USD}`,
  displayUsdc: `$${PRICE_USD}.00 USDC`,
}
```

**Step 2: Update checkout.ts** — replace hardcoded `PRICE_AMOUNT = '35000000'` with `import { PRICE } from '../../server/price'` and use `PRICE.usdc6`, `PRICE.display`, `PRICE.displayUsdc` throughout. Replace the `3500` in the SPT path with `PRICE.cents`.

**Step 3: Update stripe.ts** — replace `CHECKOUT_AMOUNT_CENTS = 3500` with `import { PRICE } from './price'` and use `PRICE.cents`.

**Step 4: Update frontend files** — all `$35` references become dynamic. Since these are client components, pass price as a prop or hardcode `$25` (simpler — it rarely changes). Replace all `$35` strings with `$25` in:
- `src/routes/index.tsx` (line 129)
- `src/components/CheckoutForm.tsx` (lines 302, 313, 314)
- `src/components/CardPaymentForm.tsx` (line 67)
- `src/components/CryptoPayment.tsx` (line 91)

**Step 5: Update static files**
- `public/.well-known/x402.json`: change `"price": "35.00"` to `"price": "25.00"`
- `public/llms.txt`: change `$35` to `$25`

**Step 6: Add env var**
- Add `TGLW_PRICE_USDC=25` to `.env`
- Add to Vercel: `vercel env add TGLW_PRICE_USDC production <<< "25"`

**Step 7: Verify and commit**

Run: `npx tsc --noEmit`

```bash
git add src/server/price.ts src/routes/api/checkout.ts src/server/stripe.ts src/routes/index.tsx src/components/CheckoutForm.tsx src/components/CardPaymentForm.tsx src/components/CryptoPayment.tsx public/.well-known/x402.json public/llms.txt .env
git commit -m "feat: make price configurable via TGLW_PRICE_USDC, update to $25"
```

---

### Task 2: Create /api/claim endpoint

**Files:**
- Create: `src/server/claim.ts`
- Create: `src/routes/api/claim.ts`

**Step 1: Create claim.ts — on-chain verification logic**

```typescript
// src/server/claim.ts
import { createPublicClient, http, parseAbiItem, type Hex } from 'viem'
import { base } from 'viem/chains'
import { PRICE } from './price'

const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const
const COMPUTA_ADDRESS = '0x08379e7d313a0781612c9624741b38a263f499f6' as const // computa.eth resolved

const client = createPublicClient({
  chain: base,
  transport: http(),
})

// In-memory set of claimed tx hashes (survives within a single deployment)
const claimedTxs = new Set<string>()

export function isAlreadyClaimed(txHash: string): boolean {
  return claimedTxs.has(txHash.toLowerCase())
}

export function markClaimed(txHash: string): void {
  claimedTxs.add(txHash.toLowerCase())
}

export interface TxVerification {
  valid: boolean
  sender: string | null
  error?: string
}

export async function verifyUsdcTransfer(txHash: Hex): Promise<TxVerification> {
  try {
    const receipt = await client.getTransactionReceipt({ hash: txHash })

    // Find USDC Transfer event: Transfer(address from, address to, uint256 value)
    const transferEvent = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)')

    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== USDC_BASE.toLowerCase()) continue

      try {
        const { args } = {
          args: {
            from: ('0x' + log.topics[1]?.slice(26)) as Hex,
            to: ('0x' + log.topics[2]?.slice(26)) as Hex,
            value: BigInt(log.data),
          },
        }

        if (
          args.to.toLowerCase() === COMPUTA_ADDRESS.toLowerCase() &&
          args.value >= BigInt(PRICE.usdc6)
        ) {
          return { valid: true, sender: args.from.toLowerCase() }
        }
      } catch {
        continue
      }
    }

    return { valid: false, sender: null, error: 'No matching USDC transfer found in tx' }
  } catch (err) {
    return { valid: false, sender: null, error: `Failed to fetch tx: ${(err as Error).message}` }
  }
}

export async function verifyClaim(
  txHash: Hex,
  signature: Hex,
): Promise<{ valid: boolean; error?: string }> {
  if (isAlreadyClaimed(txHash)) {
    return { valid: false, error: 'This transaction has already been claimed' }
  }

  const txResult = await verifyUsdcTransfer(txHash)
  if (!txResult.valid) {
    return { valid: false, error: txResult.error }
  }

  // Verify signature: message is "Claiming TGLW order for tx {txHash}"
  const { verifyMessage } = await import('viem')
  const message = `Claiming TGLW order for tx ${txHash}`

  try {
    const recoveredAddress = await import('viem').then(v =>
      v.recoverAddress({ hash: v.hashMessage(message), signature })
    )

    if (recoveredAddress.toLowerCase() !== txResult.sender) {
      return { valid: false, error: 'Signature does not match tx sender' }
    }
  } catch {
    return { valid: false, error: 'Invalid signature' }
  }

  return { valid: true }
}
```

**Step 2: Create the route**

```typescript
// src/routes/api/claim.ts
import { createFileRoute } from '@tanstack/react-router'
import { verifyClaim, markClaimed, isAlreadyClaimed } from '../../server/claim'
import { createOrder } from '../../server/apliiq'
import type { ShippingInfo } from '../../server/apliiq'
import type { Hex } from 'viem'

const VALID_SIZES = ['S', 'M', 'L', 'XL', '2XL']

export const Route = createFileRoute('/api/claim')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: {
          tx_hash?: string
          signature?: string
          size?: string
          shipping?: ShippingInfo
        }
        try {
          body = await request.json()
        } catch {
          return Response.json({ error: 'Invalid JSON' }, { status: 400 })
        }

        const { tx_hash, signature, size, shipping } = body
        if (!tx_hash || !signature || !size || !shipping) {
          return Response.json(
            { error: 'Missing required fields: tx_hash, signature, size, shipping' },
            { status: 400 },
          )
        }

        if (!VALID_SIZES.includes(size)) {
          return Response.json(
            { error: `Invalid size. Must be one of: ${VALID_SIZES.join(', ')}` },
            { status: 400 },
          )
        }

        if (!shipping.name || !shipping.address1 || !shipping.city || !shipping.state || !shipping.zip || !shipping.country) {
          return Response.json(
            { error: 'Missing shipping fields' },
            { status: 400 },
          )
        }

        const result = await verifyClaim(tx_hash as Hex, signature as Hex)
        if (!result.valid) {
          return Response.json({ error: result.error }, { status: 400 })
        }

        let orderResult: { orderId: string; status: string }
        try {
          orderResult = await createOrder(shipping, size)
        } catch (err) {
          console.error('Order creation failed after claim:', err)
          return Response.json(
            { error: 'Order fulfillment failed. Payment verified. Contact support.' },
            { status: 500 },
          )
        }

        markClaimed(tx_hash)

        return Response.json({
          order_id: orderResult.orderId,
          status: orderResult.status,
          tx_hash,
          payment_method: 'ens_claim',
          message: 'Your shirt is on the way.',
        })
      },

      GET: async ({ request }) => {
        const url = new URL(request.url)
        const tx = url.searchParams.get('tx')
        if (!tx) {
          return Response.json({ error: 'Missing tx param' }, { status: 400 })
        }
        return Response.json({ claimed: isAlreadyClaimed(tx) })
      },
    },
  },
})
```

**Step 3: Verify and commit**

Run: `npx tsc --noEmit`

```bash
git add src/server/claim.ts src/routes/api/claim.ts
git commit -m "feat: add /api/claim endpoint for ENS payment verification"
```

---

### Task 3: Create /claim frontend page

**Files:**
- Create: `src/routes/claim.tsx`

**Step 1: Create the claim page**

```tsx
// src/routes/claim.tsx
import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import { useAccount, useWalletClient, usePublicClient } from 'wagmi'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { parseAbiItem, type Hex } from 'viem'
import { Elements, AddressElement } from '@stripe/react-stripe-js'
import { loadStripe } from '@stripe/stripe-js'
import type { StripeAddressElementChangeEvent } from '@stripe/stripe-js'

export const Route = createFileRoute('/claim')({ component: ClaimPage })

const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const COMPUTA_ADDRESS = '0x08379e7d313a0781612c9624741b38a263f499f6'
const PRICE_USDC = 25
const PRICE_USDC_RAW = BigInt(PRICE_USDC * 1_000_000)

const stripePromise = loadStripe(
  typeof window !== 'undefined'
    ? (import.meta as any).env?.VITE_STRIPE_PUBLISHABLE_KEY || ''
    : '',
)

interface MatchingTx {
  hash: Hex
  value: bigint
  blockNumber: bigint
}

function ClaimPageInner() {
  const { address, isConnected } = useAccount()
  const { data: walletClient } = useWalletClient()
  const publicClient = usePublicClient()
  const [txs, setTxs] = useState<MatchingTx[]>([])
  const [scanning, setScanning] = useState(false)
  const [selectedTx, setSelectedTx] = useState<Hex | null>(null)
  const [size, setSize] = useState('L')
  const [shipping, setShipping] = useState<{
    name: string; address1: string; city: string; state: string; zip: string; country: string
  } | null>(null)
  const [shippingComplete, setShippingComplete] = useState(false)
  const [status, setStatus] = useState<'idle' | 'signing' | 'claiming' | 'success' | 'error'>('idle')
  const [error, setError] = useState('')
  const [orderResult, setOrderResult] = useState<{ order_id: string } | null>(null)

  const SIZES = ['S', 'M', 'L', 'XL', '2XL'] as const

  // Scan for matching USDC transfers when wallet connects
  useEffect(() => {
    if (!isConnected || !address || !publicClient) return

    async function scan() {
      setScanning(true)
      try {
        const currentBlock = await publicClient!.getBlockNumber()
        // Scan last ~24h of blocks (~2s per block on Base = ~43200 blocks)
        const fromBlock = currentBlock - 43200n

        const logs = await publicClient!.getLogs({
          address: USDC_BASE as Hex,
          event: parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)'),
          args: {
            from: address,
            to: COMPUTA_ADDRESS as Hex,
          },
          fromBlock,
          toBlock: 'latest',
        })

        const matching: MatchingTx[] = []
        for (const log of logs) {
          const value = BigInt(log.data)
          if (value >= PRICE_USDC_RAW) {
            // Check if already claimed
            const checkRes = await fetch(`/api/claim?tx=${log.transactionHash}`)
            const checkData = await checkRes.json()
            if (!checkData.claimed) {
              matching.push({
                hash: log.transactionHash!,
                value,
                blockNumber: log.blockNumber!,
              })
            }
          }
        }
        setTxs(matching)
      } catch (err) {
        console.error('Failed to scan txs:', err)
      } finally {
        setScanning(false)
      }
    }

    scan()
  }, [isConnected, address, publicClient])

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

  async function handleClaim() {
    if (!selectedTx || !shipping || !walletClient) return

    setStatus('signing')
    setError('')

    try {
      const message = `Claiming TGLW order for tx ${selectedTx}`
      const signature = await walletClient.signMessage({ message })

      setStatus('claiming')

      const res = await fetch('/api/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tx_hash: selectedTx,
          signature,
          size,
          shipping,
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Claim failed')

      setOrderResult(data)
      setStatus('success')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Claim failed')
      setStatus('error')
    }
  }

  if (status === 'success' && orderResult) {
    return (
      <main className="flex min-h-svh flex-col items-center justify-center px-6">
        <div className="w-full max-w-sm rounded-2xl bg-[var(--surface)] p-8 text-center shadow-xl">
          <div className="mb-4 text-4xl">&#10003;</div>
          <h2 className="mb-2 text-xl font-semibold text-[var(--ink)]">Order Confirmed</h2>
          <p className="mb-1 text-sm text-[var(--ink-soft)]">Order #{orderResult.order_id}</p>
          <p className="mb-6 text-sm text-[var(--ink-soft)]">Your shirt is on the way.</p>
          <a href="/" className="rounded-full bg-[var(--accent)] px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-[var(--accent-hover)]">
            Back to Store
          </a>
        </div>
      </main>
    )
  }

  return (
    <main className="flex min-h-svh flex-col items-center px-6 pt-14 pb-16">
      <div className="w-full max-w-md">
        <h1 className="mb-2 text-2xl font-bold text-[var(--ink)]">Claim Your Order</h1>
        <p className="mb-8 text-sm text-[var(--ink-soft)]">
          Already sent ${PRICE_USDC} USDC to computa.eth? Connect your wallet to claim.
        </p>

        {!isConnected ? (
          <div className="flex flex-col items-center gap-4 rounded-2xl bg-[var(--surface)] p-8 shadow-sm">
            <p className="text-sm text-[var(--ink-soft)]">Connect the wallet you paid from</p>
            <ConnectButton />
          </div>
        ) : scanning ? (
          <div className="rounded-2xl bg-[var(--surface)] p-8 text-center shadow-sm">
            <p className="text-sm text-[var(--ink-soft)]">Scanning for payments...</p>
          </div>
        ) : txs.length === 0 ? (
          <div className="rounded-2xl bg-[var(--surface)] p-8 text-center shadow-sm">
            <p className="mb-2 text-sm font-medium text-[var(--ink)]">No unclaimed payments found</p>
            <p className="text-sm text-[var(--ink-soft)]">
              Send ${PRICE_USDC} USDC to computa.eth on Base, then come back here.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Transaction selection */}
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-widest text-[var(--ink-muted)]">
                Payment
              </label>
              <div className="space-y-2">
                {txs.map((tx) => (
                  <button
                    key={tx.hash}
                    type="button"
                    onClick={() => setSelectedTx(tx.hash)}
                    className={`w-full rounded-lg border p-3 text-left text-sm transition ${
                      selectedTx === tx.hash
                        ? 'border-[var(--ink)] bg-[var(--ink)] text-white'
                        : 'border-[var(--line)] text-[var(--ink-soft)] hover:border-[var(--ink-muted)]'
                    }`}
                  >
                    {tx.hash.slice(0, 10)}...{tx.hash.slice(-8)} — ${Number(tx.value) / 1_000_000} USDC
                  </button>
                ))}
              </div>
            </div>

            {selectedTx && (
              <>
                {/* Size */}
                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-widest text-[var(--ink-muted)]">
                    Size
                  </label>
                  <div className="flex gap-2">
                    {SIZES.map((s) => (
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

                {/* Shipping */}
                <div>
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

                {/* Claim button */}
                <button
                  type="button"
                  onClick={handleClaim}
                  disabled={!shippingComplete || status === 'signing' || status === 'claiming'}
                  className="w-full cursor-pointer rounded-full bg-[var(--accent)] px-8 py-3.5 text-sm font-semibold uppercase tracking-[0.15em] text-white transition hover:bg-[var(--accent-hover)] hover:scale-[1.02] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {status === 'signing'
                    ? 'Sign message in wallet...'
                    : status === 'claiming'
                      ? 'Claiming...'
                      : 'Sign & Claim Order'}
                </button>
              </>
            )}

            {error && <p className="text-center text-sm text-red-500">{error}</p>}
          </div>
        )}
      </div>
    </main>
  )
}

function ClaimPage() {
  return (
    <Elements stripe={stripePromise}>
      <ClaimPageInner />
    </Elements>
  )
}
```

**Step 2: Verify and commit**

Run: `npx tsc --noEmit`

```bash
git add src/routes/claim.tsx
git commit -m "feat: add /claim page for ENS payment claim flow"
```

---

### Task 4: Create cron poller for unclaimed payments

**Files:**
- Create: `src/routes/api/cron/check-payments.ts`
- Create: `vercel.json`

**Step 1: Create the cron endpoint**

```typescript
// src/routes/api/cron/check-payments.ts
import { createFileRoute } from '@tanstack/react-router'
import { createPublicClient, http, parseAbiItem, type Hex } from 'viem'
import { base } from 'viem/chains'
import { isAlreadyClaimed } from '../../../server/claim'
import { PRICE } from '../../../server/price'

const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const
const COMPUTA_ADDRESS = '0x08379e7d313a0781612c9624741b38a263f499f6' as const
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL || ''

const client = createPublicClient({
  chain: base,
  transport: http(),
})

async function sendSlackAlert(message: string) {
  if (!SLACK_WEBHOOK_URL) {
    console.log('[cron] No SLACK_WEBHOOK_URL, skipping alert:', message)
    return
  }
  await fetch(SLACK_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: message }),
  })
}

export const Route = createFileRoute('/api/cron/check-payments')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        // Verify cron secret (Vercel sends this header)
        const authHeader = request.headers.get('authorization')
        const cronSecret = process.env.CRON_SECRET
        if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }

        try {
          const currentBlock = await client.getBlockNumber()
          // Check last ~5 minutes (~150 blocks on Base)
          const fromBlock = currentBlock - 150n

          const logs = await client.getLogs({
            address: USDC_BASE,
            event: parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)'),
            args: { to: COMPUTA_ADDRESS },
            fromBlock,
            toBlock: 'latest',
          })

          let unclaimed = 0
          for (const log of logs) {
            const value = BigInt(log.data)
            if (value < BigInt(PRICE.usdc6)) continue

            const txHash = log.transactionHash!
            if (isAlreadyClaimed(txHash)) continue

            unclaimed++
            const sender = '0x' + log.topics[1]?.slice(26)
            const amount = Number(value) / 1_000_000

            await sendSlackAlert(
              `🧢 Unclaimed TGLW payment: ${sender} sent $${amount} USDC to computa.eth\nTx: https://basescan.org/tx/${txHash}\nClaim: https://tglw.com/claim`,
            )
          }

          return Response.json({
            checked: logs.length,
            unclaimed,
            block: currentBlock.toString(),
          })
        } catch (err) {
          console.error('[cron] check-payments failed:', err)
          return Response.json({ error: 'Check failed' }, { status: 500 })
        }
      },
    },
  },
})
```

**Step 2: Create vercel.json**

```json
{
  "crons": [
    {
      "path": "/api/cron/check-payments",
      "schedule": "* * * * *"
    }
  ]
}
```

**Step 3: Verify and commit**

Run: `npx tsc --noEmit`

```bash
git add src/routes/api/cron/check-payments.ts vercel.json
git commit -m "feat: add cron poller for unclaimed ENS payments with Slack alerts"
```

---

### Task 5: Update storefront with claim link + deploy

**Files:**
- Modify: `src/routes/index.tsx`
- Modify: `public/llms.txt`

**Step 1: Add "Already paid?" link to storefront**

Below the "Pay with USDC or Card" text in `src/routes/index.tsx`, add:

```tsx
<a
  href="/claim"
  className="mt-1 text-xs text-[var(--ink-muted)] underline hover:text-[var(--ink-soft)]"
>
  Already sent USDC to computa.eth? Claim here
</a>
```

**Step 2: Update llms.txt** — add claim info:

```markdown
## How to Buy (Direct ENS Transfer)
Send $25 USDC to computa.eth on Base.
Then POST /api/claim with:
{
  "tx_hash": "0x...",
  "signature": "0x... (sign: 'Claiming TGLW order for tx {tx_hash}')",
  "size": "L",
  "shipping": { "name", "address1", "city", "state", "zip", "country" }
}

## ENS Records
Resolve computa.eth text records for machine-readable store info (tglw.product, tglw.price, tglw.claim, etc.)
```

**Step 3: Commit, push, deploy**

```bash
git add src/routes/index.tsx public/llms.txt
git commit -m "feat: add claim link to storefront and update llms.txt"
git push
vercel --prod
```
