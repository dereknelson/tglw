import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({ component: Store })

function Store() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center px-6 pt-20 pb-12">
      <div className="rise-in flex w-full max-w-md flex-col items-center text-center">
        {/* Shirt mockup placeholder */}
        <div className="relative mb-10 aspect-square w-full max-w-sm">
          <div className="flex h-full w-full items-center justify-center rounded-2xl bg-[var(--surface)] shadow-[0_2px_40px_rgba(0,0,0,0.06)]">
            <div className="flex flex-col items-center gap-3 text-[var(--ink-muted)]">
              <svg
                width="64"
                height="64"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M20.38 3.46 16 2 12 5 8 2 3.62 3.46a2 2 0 0 0-1.34 1.88v1.14a2 2 0 0 0 .78 1.58L7 11v10h10V11l3.94-2.94a2 2 0 0 0 .78-1.58V5.34a2 2 0 0 0-1.34-1.88Z" />
              </svg>
              <span className="text-xs font-medium uppercase tracking-widest">
                Shirt Mockup
              </span>
            </div>
          </div>
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
          className="w-full max-w-xs cursor-pointer rounded-full bg-[var(--accent)] px-8 py-4 text-sm font-semibold uppercase tracking-[0.15em] text-white transition hover:bg-[var(--accent-hover)] hover:scale-[1.02] active:scale-[0.98]"
          onClick={() => {
            // x402 checkout — wired up later
          }}
        >
          Buy Now
        </button>

        <p className="mt-4 text-xs text-[var(--ink-muted)]">
          Powered by x402
        </p>
      </div>
    </main>
  )
}
