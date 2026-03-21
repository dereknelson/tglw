# Face Swap Customization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let users upload a selfie to swap their face onto the shirt design via Grok's image editing API, then buy their personalized shirt.

**Architecture:** New server endpoint `POST /api/customize` receives user's photo, sends it alongside the base design to Grok's multi-image edit API (`POST https://api.x.ai/v1/images/edits`), returns the generated image. Frontend replaces the product image placeholder with the base design, adds an upload overlay button, and shows the customized result. The customized image URL passes through checkout to Apliiq for printing.

**Tech Stack:** xAI Grok Imagine API (image editing), TanStack Start server routes, multipart form handling

---

### Task 1: Add the base design image to the project

**Files:**

- Copy: User's design image to `public/design.png`

**Step 1: Copy the base design image**

```bash
cp /Users/derek/Downloads/image\ \(1\).jpg public/design.png
```

**Step 2: Commit**

```bash
git add public/design.png
git commit -m "feat: add base shirt design image"
```

---

### Task 2: Update the storefront to show the base design

**Files:**

- Modify: `src/routes/index.tsx`

**Step 1: Replace the SVG placeholder with the actual design image**

Replace the entire `src/routes/index.tsx` with:

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { useState, useRef } from 'react'
import CheckoutForm from '../components/CheckoutForm'

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
      setDesignUrl(data.imageUrl)
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

        <p className="mt-4 text-xs text-[var(--ink-muted)]">Powered by x402</p>
      </div>

      {showCheckout && (
        <CheckoutForm
          onClose={() => setShowCheckout(false)}
          designUrl={designUrl}
        />
      )}
    </main>
  )
}
```

**Step 2: Verify build**

```bash
npm run build
```

Build will fail because CheckoutForm doesn't accept `designUrl` yet — that's expected and fixed in Task 4.

**Step 3: Commit**

```bash
git add src/routes/index.tsx
git commit -m "feat: product image with upload overlay and customization flow"
```

---

### Task 3: Create the customize API endpoint

**Files:**

- Create: `src/routes/api/customize.ts`

**Step 1: Create the server endpoint**

This endpoint receives a photo upload, converts it to base64, sends it to Grok alongside the base design, and returns the generated image URL.

```typescript
import { createFileRoute } from '@tanstack/react-router'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const XAI_API_KEY = process.env.XAI_API_KEY || ''
const GROK_API_URL = 'https://api.x.ai/v1/images/edits'

// Load the base design as base64 at startup
let baseDesignBase64: string | null = null

function getBaseDesign(): string {
  if (!baseDesignBase64) {
    const designPath = resolve('public/design.png')
    const buffer = readFileSync(designPath)
    baseDesignBase64 = buffer.toString('base64')
  }
  return baseDesignBase64
}

export const Route = createFileRoute('/api/customize')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!XAI_API_KEY) {
          return Response.json(
            { error: 'Image customization is not configured yet' },
            { status: 503 },
          )
        }

        // Parse multipart form data
        let formData: FormData
        try {
          formData = await request.formData()
        } catch {
          return Response.json(
            { error: 'Expected multipart form data with a photo' },
            { status: 400 },
          )
        }

        const photo = formData.get('photo')
        if (!photo || !(photo instanceof File)) {
          return Response.json({ error: 'Missing photo file' }, { status: 400 })
        }

        // Validate file type
        if (!photo.type.startsWith('image/')) {
          return Response.json(
            { error: 'File must be an image' },
            { status: 400 },
          )
        }

        // Validate file size (max 10MB)
        if (photo.size > 10 * 1024 * 1024) {
          return Response.json(
            { error: 'Image must be under 10MB' },
            { status: 400 },
          )
        }

        // Convert uploaded photo to base64
        const photoBuffer = Buffer.from(await photo.arrayBuffer())
        const photoBase64 = photoBuffer.toString('base64')
        const photoMime = photo.type || 'image/jpeg'

        // Get base design as base64
        const designBase64 = getBaseDesign()

        // Call Grok image edit API
        const grokRes = await fetch(GROK_API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${XAI_API_KEY}`,
          },
          body: JSON.stringify({
            model: 'grok-imagine-image',
            prompt:
              'Replace the face of the muscular cartoon man in <IMAGE_1> with the face from the photo in <IMAGE_0>. Keep the exact same cartoon/illustration art style, body, pose, clothing, text, and all other elements identical. Only change the face to match the person in <IMAGE_0>, rendered in the same cartoon style.',
            images: [
              { url: `data:${photoMime};base64,${photoBase64}` },
              { url: `data:image/png;base64,${designBase64}` },
            ],
            n: 1,
            response_format: 'url',
          }),
        })

        if (!grokRes.ok) {
          const errText = await grokRes.text()
          console.error('Grok API error:', grokRes.status, errText)
          return Response.json(
            { error: 'Image generation failed. Please try again.' },
            { status: 502 },
          )
        }

        const grokData = (await grokRes.json()) as {
          data: Array<{ url?: string; b64_json?: string }>
        }

        const imageUrl = grokData.data?.[0]?.url
        if (!imageUrl) {
          return Response.json(
            { error: 'No image returned from generator' },
            { status: 502 },
          )
        }

        return Response.json({ imageUrl })
      },
    },
  },
})
```

**Step 2: Add XAI_API_KEY to .env**

Append to `.env`:

```
XAI_API_KEY=
```

(User will fill in the actual key later)

**Step 3: Verify build**

```bash
npm run build
```

**Step 4: Commit**

```bash
git add src/routes/api/customize.ts .env
git commit -m "feat: POST /api/customize — Grok face swap endpoint"
```

---

### Task 4: Update CheckoutForm to accept and pass designUrl

**Files:**

- Modify: `src/components/CheckoutForm.tsx`

**Step 1: Add designUrl prop and pass it through checkout**

Update the `CheckoutFormProps` interface to include `designUrl`:

```typescript
interface CheckoutFormProps {
  onClose: () => void
  designUrl?: string
}
```

Update the component function signature:

```typescript
export default function CheckoutForm({ onClose, designUrl }: CheckoutFormProps) {
```

In the `handleCheckout` function, add `designUrl` to the request body. Change this line:

```typescript
body: JSON.stringify({ shipping, size }),
```

To:

```typescript
body: JSON.stringify({ shipping, size, designUrl }),
```

**Step 2: Update the checkout API to accept designUrl**

In `src/routes/api/checkout.ts`, update the body type to include `designUrl`:

```typescript
let body: { shipping?: ShippingInfo; size?: string; designUrl?: string }
```

And pass it to the Apliiq order. After the `createOrder` call, update to:

```typescript
orderResult = await createOrder(shipping, size, body.designUrl)
```

**Step 3: Update the Apliiq createOrder function**

In `src/server/apliiq.ts`, update the `createOrder` function signature to accept `designUrl`:

```typescript
export async function createOrder(
  shipping: ShippingInfo,
  size: string,
  designUrl?: string,
): Promise<CreateOrderResult> {
```

And include it in the order data line items:

```typescript
line_items: [
  {
    quantity: 1,
    size,
    product_id: process.env.APLIIQ_PRODUCT_ID || 'PLACEHOLDER',
    ...(designUrl ? { artwork_url: designUrl } : {}),
  },
],
```

**Step 4: Verify build**

```bash
npm run build
```

**Step 5: Commit**

```bash
git add src/components/CheckoutForm.tsx src/routes/api/checkout.ts src/server/apliiq.ts
git commit -m "feat: pass custom design URL through checkout to Apliiq"
```

---

### Task 5: Lint, build, and push

**Step 1: Run lint and format**

```bash
npm run check
```

**Step 2: Production build**

```bash
npm run build
```

**Step 3: Commit fixes if any**

```bash
git add -A
git commit -m "chore: lint and format fixes"
```

**Step 4: Push**

```bash
git push
```

---

## Notes

- **XAI_API_KEY**: The `.env` placeholder is empty. User needs to add their key from console.x.ai.
- **Grok prompt tuning**: The face swap prompt may need iteration. If results aren't good, adjust the prompt in `src/routes/api/customize.ts`.
- **Image hosting**: Grok returns temporary URLs. For production, you'd want to download and re-host the image (e.g., to S3 or Vercel Blob) so it doesn't expire before Apliiq can use it. Deferred for now.
- **Base design loading**: The `readFileSync` approach works for the base design since it's a static asset. In Vercel serverless, the file needs to be bundled — the `public/` directory should be accessible.
