import { Link } from '@tanstack/react-router'

export default function Header() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 px-6 py-4 backdrop-blur-md bg-[var(--bg)]/80">
      <nav className="mx-auto flex max-w-7xl items-center justify-between">
        <Link
          to="/"
          className="flex items-center gap-2 no-underline"
        >
          <span className="text-lg font-bold tracking-[0.15em] text-[var(--ink)]">
            TGLW
          </span>
          <span className="rounded-full bg-[var(--green-soft)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-[var(--green)]">
            Drop 01
          </span>
        </Link>
        <span className="text-xs text-[var(--ink-muted)]">
          est. 2026
        </span>
      </nav>
    </header>
  )
}
