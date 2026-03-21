import { createFileRoute } from '@tanstack/react-router'
import { useState, useRef, lazy, Suspense } from 'react'

const CheckoutForm = lazy(() => import('../components/CheckoutForm'))

export const Route = createFileRoute('/')({ component: Store })

function Store() {
  const [showCheckout, setShowCheckout] = useState(false)
  const [designUrl, setDesignUrl] = useState('/design.png')
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
    <main className="flex min-h-svh flex-col items-center justify-center px-6 pt-20 pb-12">
      <div className="rise-in flex w-full max-w-md flex-col items-center text-center">
        {/* Product image with upload overlay */}
        <div className="relative mb-10 w-full max-w-sm">
          <div className="overflow-hidden rounded-2xl bg-[var(--surface)] shadow-[0_2px_40px_rgba(0,0,0,0.06)]">
            <img
              src={designUrl}
              alt="TGLW shirt design"
              className="h-auto w-full"
            />

            {isCustomizing && (
              <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-black/50">
                <div className="flex flex-col items-center gap-3 text-white">
                  <svg
                    className="h-8 w-8 animate-spin"
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
                  <span className="text-sm font-medium">
                    Creating your design...
                  </span>
                </div>
              </div>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleUpload}
            className="hidden"
          />

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isCustomizing}
            className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-white/90 px-4 py-2 text-xs font-semibold text-[var(--ink)] shadow-lg backdrop-blur transition hover:bg-white disabled:opacity-50"
          >
            {designUrl === '/design.png'
              ? 'Upload your photo'
              : 'Try another photo'}
          </button>

          {customizeError && (
            <p className="mt-2 text-center text-sm text-red-500">
              {customizeError}
            </p>
          )}

          <p className="mt-3 text-xs leading-relaxed text-[var(--ink-muted)]">
            For best results: face clearly visible, good lighting, front-facing
          </p>
        </div>

        {/* Product info */}
        <h1 className="mb-3 font-[var(--font-serif)] text-3xl font-medium tracking-tight text-[var(--ink)] sm:text-4xl">
          Lift Weights Touch Grass
        </h1>

        <p className="mb-1 text-sm text-[var(--ink-soft)]">
          Black tee · 100% cotton
        </p>

        <p className="mb-8 text-xl font-semibold text-[var(--ink)]">$35</p>

        <button
          type="button"
          onClick={() => setShowCheckout(true)}
          className="w-full max-w-xs cursor-pointer rounded-full bg-[var(--accent)] px-8 py-4 text-sm font-semibold uppercase tracking-[0.15em] text-white transition hover:bg-[var(--accent-hover)] hover:scale-[1.02] active:scale-[0.98]"
        >
          Buy Now
        </button>

        <p className="mt-4 text-xs text-[var(--ink-muted)]">Powered by x402 + Stripe</p>
      </div>

      {showCheckout && (
        <Suspense>
          <CheckoutForm
            onClose={() => setShowCheckout(false)}
            designUrl={designUrl}
          />
        </Suspense>
      )}
    </main>
  )
}
