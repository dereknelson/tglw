import { useState, useEffect, useCallback } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Elements, AddressElement } from '@stripe/react-stripe-js'
import { loadStripe } from '@stripe/stripe-js'
import type { StripeAddressElementChangeEvent } from '@stripe/stripe-js'
import { useAccount, usePublicClient, useWalletClient } from 'wagmi'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { parseAbiItem, type Hash } from 'viem'

const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const
const COMPUTA_ADDRESS = '0x08379e7d313a0781612c9624741b38a263f499f6' as const
const MIN_AMOUNT = 25_000_000n // $25 USDC (6 decimals)
const BLOCKS_24H = 43200n // ~24h at 2s blocks
const VALID_SIZES = ['S', 'M', 'L', 'XL', '2XL'] as const

const stripePromise =
  typeof window !== 'undefined'
    ? loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || '')
    : Promise.resolve(null)

export const Route = createFileRoute('/claim')({ component: ClaimPage })

interface UsdcTx {
  hash: Hash
  from: string
  value: bigint
  blockNumber: bigint
  claimed: boolean
}

interface ShippingData {
  name: string
  address1: string
  city: string
  state: string
  zip: string
  country: string
}

function ClaimPageInner() {
  const { address, isConnected } = useAccount()
  const publicClient = usePublicClient()
  const { data: walletClient } = useWalletClient()

  const [txs, setTxs] = useState<UsdcTx[]>([])
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState('')
  const [selectedTx, setSelectedTx] = useState<UsdcTx | null>(null)
  const [size, setSize] = useState<string>('L')
  const [shipping, setShipping] = useState<ShippingData | null>(null)
  const [shippingComplete, setShippingComplete] = useState(false)
  const [status, setStatus] = useState<'idle' | 'signing' | 'submitting' | 'success' | 'error'>('idle')
  const [error, setError] = useState('')
  const [orderResult, setOrderResult] = useState<{ order_id: string } | null>(null)

  const scanForTransfers = useCallback(async () => {
    if (!publicClient || !address) return

    setScanning(true)
    setScanError('')
    setTxs([])
    setSelectedTx(null)

    try {
      const currentBlock = await publicClient.getBlockNumber()
      const fromBlock = currentBlock - BLOCKS_24H

      const logs = await publicClient.getLogs({
        address: USDC_ADDRESS,
        event: parseAbiItem(
          'event Transfer(address indexed from, address indexed to, uint256 value)',
        ),
        args: {
          from: address,
          to: COMPUTA_ADDRESS,
        },
        fromBlock,
        toBlock: currentBlock,
      })

      const qualifying = logs
        .filter((log) => {
          const value = log.args.value ?? 0n
          return value >= MIN_AMOUNT
        })
        .map((log) => ({
          hash: log.transactionHash!,
          from: log.args.from!,
          value: log.args.value!,
          blockNumber: log.blockNumber,
          claimed: false,
        }))

      // Check each tx against the API to see if already claimed
      const checked = await Promise.all(
        qualifying.map(async (tx) => {
          try {
            const res = await fetch(`/api/claim?tx=${tx.hash}`)
            if (res.ok) {
              const data = await res.json()
              return { ...tx, claimed: data.claimed === true }
            }
          } catch {
            // If check fails, assume unclaimed
          }
          return tx
        }),
      )

      setTxs(checked)
    } catch (err) {
      setScanError(err instanceof Error ? err.message : 'Failed to scan for transfers')
    } finally {
      setScanning(false)
    }
  }, [publicClient, address])

  // Scan when wallet connects
  useEffect(() => {
    if (isConnected && address && publicClient) {
      scanForTransfers()
    }
  }, [isConnected, address, publicClient, scanForTransfers])

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
    if (!selectedTx || !shipping || !walletClient || !address) return

    setStatus('signing')
    setError('')

    try {
      const message = `Claiming TGLW order for tx ${selectedTx.hash}`
      const signature = await walletClient.signMessage({
        message,
        account: address,
      })

      setStatus('submitting')

      const res = await fetch('/api/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tx: selectedTx.hash,
          signature,
          message,
          wallet: address,
          size,
          shipping,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Claim failed')
      }

      const data = await res.json()
      setOrderResult(data)
      setStatus('success')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Claim failed')
      setStatus('error')
    }
  }

  // Success screen
  if (status === 'success' && orderResult) {
    return (
      <div className="flex flex-col items-center text-center">
        <div className="mb-4 text-5xl">&#10003;</div>
        <h2 className="mb-2 text-2xl font-semibold text-[var(--ink)]">
          Order Confirmed
        </h2>
        <p className="mb-1 text-sm text-[var(--ink-soft)]">
          Order #{orderResult.order_id}
        </p>
        <p className="mb-6 text-sm text-[var(--ink-soft)]">
          Your shirt is on the way.
        </p>
        <Link
          to="/"
          className="rounded-full bg-[var(--accent)] px-6 py-2.5 text-sm font-semibold text-white no-underline transition hover:bg-[var(--accent-hover)]"
        >
          Back to Store
        </Link>
      </div>
    )
  }

  // Step 1: Connect wallet
  if (!isConnected) {
    return (
      <div className="flex flex-col items-center text-center">
        <h2 className="mb-2 text-xl font-semibold text-[var(--ink)]">
          Connect Your Wallet
        </h2>
        <p className="mb-6 text-sm text-[var(--ink-soft)]">
          Connect the wallet you used to send USDC to computa.eth
        </p>
        <ConnectButton />
      </div>
    )
  }

  // Step 2: Scanning / selecting tx
  if (!selectedTx) {
    return (
      <div className="flex w-full flex-col items-center">
        <h2 className="mb-2 text-xl font-semibold text-[var(--ink)]">
          Your USDC Transfers
        </h2>
        <p className="mb-4 text-sm text-[var(--ink-soft)]">
          Showing $25+ transfers to computa.eth in the last 24h
        </p>

        {scanning && (
          <div className="flex items-center gap-3 py-8">
            <svg
              className="h-5 w-5 animate-spin text-[var(--green)]"
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            <span className="text-sm text-[var(--ink-soft)]">
              Scanning Base for transfers...
            </span>
          </div>
        )}

        {scanError && (
          <p className="mb-4 text-center text-sm text-red-500">{scanError}</p>
        )}

        {!scanning && txs.length === 0 && !scanError && (
          <div className="py-8 text-center">
            <p className="mb-4 text-sm text-[var(--ink-muted)]">
              No qualifying transfers found in the last 24 hours.
            </p>
            <button
              type="button"
              onClick={scanForTransfers}
              className="rounded-full border border-[var(--line)] px-5 py-2 text-sm font-medium text-[var(--ink-soft)] transition hover:border-[var(--ink-muted)]"
            >
              Scan Again
            </button>
          </div>
        )}

        {!scanning && txs.length > 0 && (
          <div className="w-full space-y-3">
            {txs.map((tx) => {
              const amount = Number(tx.value) / 1_000_000
              return (
                <button
                  key={tx.hash}
                  type="button"
                  disabled={tx.claimed}
                  onClick={() => setSelectedTx(tx)}
                  className={`w-full rounded-xl border p-4 text-left transition ${
                    tx.claimed
                      ? 'cursor-not-allowed border-[var(--line)] opacity-50'
                      : 'cursor-pointer border-[var(--line)] hover:border-[var(--green)] hover:shadow-md'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-[var(--ink)]">
                      ${amount.toFixed(2)} USDC
                    </span>
                    {tx.claimed ? (
                      <span className="rounded-full bg-[var(--ink-muted)]/20 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-[var(--ink-muted)]">
                        Claimed
                      </span>
                    ) : (
                      <span className="rounded-full bg-[var(--green-soft)] px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-[var(--green)]">
                        Available
                      </span>
                    )}
                  </div>
                  <p className="mt-1 font-mono text-xs text-[var(--ink-muted)]">
                    {tx.hash.slice(0, 10)}...{tx.hash.slice(-8)}
                  </p>
                </button>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  // Step 3: Size + shipping + sign
  return (
    <div className="flex w-full flex-col">
      {/* Selected tx summary */}
      <div className="mb-5 rounded-xl border border-[var(--green)] bg-[var(--green-soft)]/30 p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-[var(--ink)]">
            ${(Number(selectedTx.value) / 1_000_000).toFixed(2)} USDC
          </span>
          <button
            type="button"
            onClick={() => setSelectedTx(null)}
            className="text-xs font-medium text-[var(--ink-muted)] hover:text-[var(--ink)]"
          >
            Change
          </button>
        </div>
        <p className="mt-1 font-mono text-xs text-[var(--ink-muted)]">
          {selectedTx.hash.slice(0, 10)}...{selectedTx.hash.slice(-8)}
        </p>
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

      {/* Shipping */}
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

      {/* Claim button */}
      <button
        type="button"
        onClick={handleClaim}
        disabled={
          status === 'signing' ||
          status === 'submitting' ||
          !shippingComplete ||
          !shipping
        }
        className="w-full cursor-pointer rounded-full bg-[var(--green)] px-8 py-4 text-sm font-semibold uppercase tracking-[0.15em] text-white transition hover:bg-[var(--accent-hover)] hover:scale-[1.02] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {status === 'signing'
          ? 'Sign in Wallet...'
          : status === 'submitting'
            ? 'Submitting Claim...'
            : 'Sign & Claim Order'}
      </button>

      {error && (
        <p className="mt-3 text-center text-sm text-red-500">{error}</p>
      )}

      <p className="mt-4 text-center text-xs text-[var(--ink-muted)]">
        Signs a message to verify wallet ownership. No gas required.
      </p>
    </div>
  )
}

export default function ClaimPage() {
  return (
    <Elements stripe={stripePromise}>
      <main className="flex min-h-svh flex-col items-center px-6 pt-14 pb-16">
        <div className="flex w-full max-w-md flex-col items-center pt-10">
          {/* Page header */}
          <div className="mb-8 text-center">
            <h1 className="mb-2 text-2xl font-bold tracking-tight text-[var(--ink)]">
              Claim Your Shirt
            </h1>
            <p className="text-sm text-[var(--ink-soft)]">
              Already sent USDC to computa.eth? Claim your TGLW tee here.
            </p>
          </div>

          <ClaimPageInner />

          {/* Back link */}
          <div className="mt-10 border-t border-[var(--line)] pt-6">
            <Link
              to="/"
              className="text-sm text-[var(--ink-muted)] no-underline transition hover:text-[var(--ink)]"
            >
              &larr; Back to Store
            </Link>
          </div>
        </div>
      </main>
    </Elements>
  )
}
