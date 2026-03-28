import { createFileRoute } from '@tanstack/react-router'
import { useState, useRef, lazy, Suspense } from 'react'
import TshirtMockup from '../components/TshirtMockup'

const CheckoutForm = lazy(() => import('../components/CheckoutForm'))

export const Route = createFileRoute('/')({ component: Store })

function Store() {
  const [showCheckout, setShowCheckout] = useState(false)
  const [designUrl, setDesignUrl] = useState('/tglw.png')
  const [isCustomizing, setIsCustomizing] = useState(false)
  const [customizeError, setCustomizeError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setIsCustomizing(true)
    setCustomizeError('')

    try {
      const formData = new FormData()
      formData.append('photo', file)

      const res = await fetch('/api/customize', {
        method: 'POST',
        body: formData,
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Customization failed')
      }

      const data = await res.json()
      setDesignUrl(data.imageUrls[0])
    } catch (err) {
      setCustomizeError(
        err instanceof Error ? err.message : 'Customization failed',
      )
    } finally {
      setIsCustomizing(false)
    }
  }

  return (
    <main className="flex min-h-svh flex-col items-center px-6 pt-14 pb-16">
      {/* Hero section */}
      <div className="flex w-full max-w-xl flex-col items-center text-center">
        {/* Tagline + Title */}
        <h1 className="mb-3 text-3xl font-bold tracking-tight text-[var(--ink)] sm:text-4xl">
          Touch Grass.
          <br />
          Lift Weights.
          <br />
          Text Computa.
        </h1>
        <p className="mb-4 max-w-sm text-base leading-relaxed text-[var(--ink-soft)]">
          The official tee for cyborgs who split their time between the squat rack
          and the terminal. 100% cotton. 0% synthetic consciousness.
        </p>

        {/* T-shirt mockup */}
        <div className="relative mb-4 w-full">
          {isCustomizing ? (
            <div className="flex h-[460px] items-center justify-center rounded-2xl bg-[var(--surface)]">
              <div className="flex flex-col items-center gap-3">
                <svg
                  className="h-8 w-8 animate-spin text-[var(--green)]"
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
                <span className="text-sm font-medium text-[var(--ink-soft)]">
                  Swapping your face onto a cyborg...
                </span>
              </div>
            </div>
          ) : (
            <TshirtMockup designUrl={designUrl} alt="TGLW shirt design" />
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleUpload}
            className="hidden"
          />
        </div>

        {/* Customize button */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isCustomizing}
          className="mb-4 flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface)] px-5 py-2.5 text-sm font-medium text-[var(--ink)] shadow-sm transition hover:shadow-md hover:border-[var(--green)] disabled:opacity-50"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
          {designUrl === '/tglw.png'
            ? 'Put your face on it'
            : 'Try another face'}
        </button>

        {customizeError && (
          <p className="mb-4 text-center text-sm text-red-500">
            {customizeError}
          </p>
        )}

        <p className="mb-3 text-3xl font-bold text-[var(--ink)]">$35</p>

        <button
          type="button"
          onClick={() => setShowCheckout(true)}
          className="pulse-green w-full max-w-xs cursor-pointer rounded-full bg-[var(--green)] px-8 py-4 text-sm font-semibold uppercase tracking-[0.15em] text-white transition hover:bg-[var(--accent-hover)] hover:scale-[1.02] active:scale-[0.98]"
        >
          Buy Now
        </button>

        <p className="mt-3 text-xs text-[var(--ink-muted)]">
          Pay with USDC or Card
        </p>
      </div>

      {/* Footer */}
      <footer className="mt-20 w-full max-w-lg border-t border-[var(--line)] pt-8 text-center">
        <p className="mb-2 text-xs font-medium uppercase tracking-widest text-[var(--ink-muted)]">
          TGLW &mdash; Drop 01
        </p>
        <p className="text-xs leading-relaxed text-[var(--ink-muted)]">
          Born from the intersection of iron and silicon.
          <br />
          Powered by x402 + Stripe. Printed by Apliiq.
        </p>
      </footer>

      {showCheckout && (
        <Suspense fallback={null}>
          <CheckoutForm
            onClose={() => setShowCheckout(false)}
            designUrl={designUrl}
          />
        </Suspense>
      )}
    </main>
  )
}
