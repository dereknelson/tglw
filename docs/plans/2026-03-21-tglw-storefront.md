# TGLW Storefront Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform the TanStack Start template into a clean minimalist single-product t-shirt store for "Lift Weights Touch Grass."

**Architecture:** Single-page app with one route (index). Full-viewport hero layout — centered shirt mockup placeholder, product name, price, and a "Buy" button. Minimal header (brand wordmark only), no footer nav. New color palette: black/white/off-white with minimal accent. Checkout via x402 agents is deferred.

**Tech Stack:** TanStack Start, React 19, Tailwind CSS v4, Vite

---

### Task 1: Strip the template — remove unused routes and components

**Files:**

- Delete: `src/routes/about.tsx`
- Modify: `src/components/Header.tsx`
- Modify: `src/routes/__root.tsx`

**Step 1: Delete the about route**

```bash
rm src/routes/about.tsx
```

**Step 2: Gut the Header — brand wordmark only**

Replace all of `src/components/Header.tsx` with:

```tsx
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
```

**Step 3: Remove Footer from root layout**

In `src/routes/__root.tsx`:

- Remove the `Footer` import
- Remove `<Footer />` from the JSX
- Update the `<title>` meta to `"TGLW — Lift Weights Touch Grass"`

**Step 4: Delete the Footer component**

```bash
rm src/components/Footer.tsx
```

**Step 5: Delete ThemeToggle (we're going light-only for now)**

```bash
rm src/components/ThemeToggle.tsx
```

**Step 6: Remove the theme init script from \_\_root.tsx**

Remove the `THEME_INIT_SCRIPT` constant and the `<script dangerouslySetInnerHTML>` line.

**Step 7: Run dev server to verify it compiles**

```bash
npm run dev
```

Expected: App loads with just the wordmark header and the old index content. No errors.

**Step 8: Commit**

```bash
git add -A
git commit -m "chore: strip template — remove about route, footer, theme toggle"
```

---

### Task 2: New color palette and global styles

**Files:**

- Rewrite: `src/styles.css`

**Step 1: Replace styles.css with the new minimalist palette**

```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Playfair+Display:wght@400;500;600;700&display=swap');
@import 'tailwindcss';

@theme {
  --font-sans: 'Inter', ui-sans-serif, system-ui, sans-serif;
  --font-serif: 'Playfair Display', Georgia, serif;
}

:root {
  --ink: #111111;
  --ink-soft: #666666;
  --ink-muted: #999999;
  --bg: #fafafa;
  --surface: #ffffff;
  --line: rgba(0, 0, 0, 0.08);
  --accent: #111111;
  --accent-hover: #333333;
}

* {
  box-sizing: border-box;
}

html,
body,
#app {
  min-height: 100%;
}

body {
  margin: 0;
  color: var(--ink);
  font-family: var(--font-sans);
  background-color: var(--bg);
  overflow-x: hidden;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

a {
  color: var(--ink);
  text-decoration: none;
}

button {
  transition:
    background-color 200ms ease,
    transform 200ms ease;
}

.rise-in {
  animation: rise-in 800ms cubic-bezier(0.16, 1, 0.3, 1) both;
}

@keyframes rise-in {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
```

**Step 2: Run dev server to verify**

```bash
npm run dev
```

Expected: Page loads with white/off-white background, black text, Inter font. Looks stripped down.

**Step 3: Commit**

```bash
git add src/styles.css
git commit -m "style: new minimalist palette — black, white, Inter + Playfair Display"
```

---

### Task 3: Build the hero storefront page

**Files:**

- Rewrite: `src/routes/index.tsx`

**Step 1: Replace index.tsx with the hero storefront**

```tsx
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
        <h1
          className="mb-3 font-[var(--font-serif)] text-3xl font-medium tracking-tight text-[var(--ink)] sm:text-4xl"
          style={{ fontFamily: 'var(--font-serif)' }}
        >
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

        <p className="mt-4 text-xs text-[var(--ink-muted)]">Powered by x402</p>
      </div>
    </main>
  )
}
```

**Step 2: Run dev server and check**

```bash
npm run dev
```

Expected: Full-viewport centered layout. Placeholder box for shirt mockup, "Lift Weights Touch Grass" in serif, $35, black "Buy Now" button. Clean and minimal.

**Step 3: Commit**

```bash
git add src/routes/index.tsx
git commit -m "feat: hero storefront page — single product layout"
```

---

### Task 4: Clean up root layout for the store

**Files:**

- Modify: `src/routes/__root.tsx`

**Step 1: Simplify the root layout**

Remove TanStack devtools imports and usage (clean production feel). The root should just be:

```tsx
import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'
import Header from '../components/Header'

import appCss from '../styles.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'TGLW — Lift Weights Touch Grass' },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="font-sans antialiased">
        <Header />
        {children}
        <Scripts />
      </body>
    </html>
  )
}
```

**Step 2: Verify**

```bash
npm run dev
```

Expected: Clean page, no devtools panel, just the store.

**Step 3: Commit**

```bash
git add src/routes/__root.tsx
git commit -m "chore: simplify root layout — remove devtools, update meta"
```

---

### Task 5: Verify and polish

**Step 1: Run lint and format**

```bash
npm run check
```

Fix any issues.

**Step 2: Build for production**

```bash
npm run build
```

Expected: Clean build, no errors.

**Step 3: Final commit if any fixes**

```bash
git add -A
git commit -m "chore: lint and build fixes"
```

**Step 4: Push**

```bash
git push
```
