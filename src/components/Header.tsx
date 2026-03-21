import { Link } from '@tanstack/react-router'

export default function Header() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 px-6 py-5">
      <nav className="mx-auto flex max-w-7xl items-center justify-between">
        <Link
          to="/"
          className="text-sm font-semibold uppercase tracking-[0.2em] text-[var(--ink)] no-underline"
        >
          TGLW
        </Link>
      </nav>
    </header>
  )
}
