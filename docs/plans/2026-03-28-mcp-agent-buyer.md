# MCP Agent Buyer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an MCP server that lets Claude discover MPP-enabled stores and buy physical goods using Stripe SPTs — fully end-to-end, no browser needed.

**Architecture:** A standalone MCP server (`mcp/` directory in the tglw repo) with two tools: `discover_store` (reads llms.txt + .well-known/x402.json) and `buy` (posts to the store's checkout endpoint with an SPT for payment). Uses the Stripe test helper API to create SPTs from a saved payment method. Also exposes a `setup_payment` tool so the user can configure their payment method and shipping address once.

**Tech Stack:** TypeScript, `@modelcontextprotocol/sdk`, `stripe`, `node:fetch`

---

### Task 1: Scaffold MCP server package

**Files:**
- Create: `mcp/package.json`
- Create: `mcp/tsconfig.json`
- Create: `mcp/src/index.ts`

**Step 1: Create package.json**

```json
{
  "name": "tglw-mcp-buyer",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": {
    "tglw-buy": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/index.ts",
    "test": "vitest run"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.1",
    "stripe": "^20.4.1"
  },
  "devDependencies": {
    "tsx": "^4.19.0",
    "typescript": "^5.7.2",
    "vitest": "^3.0.5",
    "@types/node": "^22.10.2"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true
  },
  "include": ["src"]
}
```

**Step 3: Create minimal src/index.ts**

```typescript
#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

const server = new McpServer({
  name: 'tglw-buy',
  version: '0.1.0',
})

const transport = new StdioServerTransport()
await server.connect(transport)
```

**Step 4: Install dependencies**

Run: `cd mcp && npm install`
Expected: node_modules created, no errors

**Step 5: Verify it runs**

Run: `cd mcp && npx tsx src/index.ts`
Expected: Process starts and waits for stdio input (ctrl-c to exit)

**Step 6: Commit**

```bash
git add mcp/
git commit -m "feat: scaffold MCP server package for agent buyer"
```

---

### Task 2: Add `discover_store` tool

**Files:**
- Create: `mcp/src/tools/discover.ts`
- Modify: `mcp/src/index.ts`

**Step 1: Create discover.ts**

```typescript
import { z } from 'zod'

export const discoverSchema = {
  url: z.string().url().describe('Base URL of the store (e.g. https://tglw.com)'),
}

export async function discoverStore(url: string): Promise<{
  llmsTxt: string | null
  x402: Record<string, unknown> | null
}> {
  const base = url.replace(/\/$/, '')

  let llmsTxt: string | null = null
  try {
    const res = await fetch(`${base}/llms.txt`)
    if (res.ok) llmsTxt = await res.text()
  } catch {}

  let x402: Record<string, unknown> | null = null
  try {
    const res = await fetch(`${base}/.well-known/x402.json`)
    if (res.ok) x402 = await res.json() as Record<string, unknown>
  } catch {}

  return { llmsTxt, x402 }
}
```

**Step 2: Register tool in index.ts**

Add to `src/index.ts` after server creation:

```typescript
import { discoverStore, discoverSchema } from './tools/discover.js'

server.tool(
  'discover_store',
  'Discover products and payment info from an MPP-enabled store. Reads llms.txt and .well-known/x402.json.',
  discoverSchema,
  async ({ url }) => {
    const result = await discoverStore(url)

    if (!result.llmsTxt && !result.x402) {
      return {
        content: [{ type: 'text', text: `No MPP metadata found at ${url}. This store may not support agent purchases.` }],
      }
    }

    let text = ''
    if (result.llmsTxt) text += `## llms.txt\n\n${result.llmsTxt}\n\n`
    if (result.x402) text += `## x402.json\n\n${JSON.stringify(result.x402, null, 2)}`

    return { content: [{ type: 'text', text }] }
  },
)
```

**Step 3: Verify it compiles**

Run: `cd mcp && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add mcp/src/tools/discover.ts mcp/src/index.ts
git commit -m "feat: add discover_store tool to MCP server"
```

---

### Task 3: Add `setup_payment` tool (config storage)

**Files:**
- Create: `mcp/src/config.ts`
- Modify: `mcp/src/index.ts`

**Step 1: Create config.ts**

Stores user config (payment method, default shipping) in a JSON file at `~/.config/tglw-buy/config.json`.

```typescript
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'

const CONFIG_DIR = join(homedir(), '.config', 'tglw-buy')
const CONFIG_PATH = join(CONFIG_DIR, 'config.json')

export interface BuyerConfig {
  stripeSecretKey?: string
  paymentMethod?: string
  shipping?: {
    name: string
    address1: string
    city: string
    state: string
    zip: string
    country: string
  }
}

export async function loadConfig(): Promise<BuyerConfig> {
  try {
    const raw = await readFile(CONFIG_PATH, 'utf-8')
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

export async function saveConfig(config: BuyerConfig): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true })
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2))
}
```

**Step 2: Register setup_payment tool in index.ts**

```typescript
import { z } from 'zod'
import { loadConfig, saveConfig } from './config.js'

server.tool(
  'setup_payment',
  'Configure payment method and default shipping address for purchases. Run this once before buying.',
  {
    stripe_secret_key: z.string().describe('Your Stripe secret key (sk_test_...)'),
    payment_method: z.string().optional().describe('Stripe payment method ID. Defaults to pm_card_visa for testing.'),
    name: z.string().describe('Shipping name'),
    address1: z.string().describe('Street address'),
    city: z.string().describe('City'),
    state: z.string().describe('State/province'),
    zip: z.string().describe('ZIP/postal code'),
    country: z.string().describe('Country (ISO 2-letter, e.g. US)'),
  },
  async (params) => {
    const config = await loadConfig()
    config.stripeSecretKey = params.stripe_secret_key
    config.paymentMethod = params.payment_method || 'pm_card_visa'
    config.shipping = {
      name: params.name,
      address1: params.address1,
      city: params.city,
      state: params.state,
      zip: params.zip,
      country: params.country,
    }
    await saveConfig(config)

    return {
      content: [{ type: 'text', text: `Payment configured. Using payment method: ${config.paymentMethod}. Default shipping to ${params.name}, ${params.city}, ${params.state}.` }],
    }
  },
)
```

**Step 3: Verify it compiles**

Run: `cd mcp && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add mcp/src/config.ts mcp/src/index.ts
git commit -m "feat: add setup_payment tool with config storage"
```

---

### Task 4: Add `buy` tool

**Files:**
- Create: `mcp/src/tools/buy.ts`
- Modify: `mcp/src/index.ts`

**Step 1: Create buy.ts**

This is the core tool. It:
1. Reads the store's x402.json to get the checkout endpoint
2. Creates an SPT via Stripe test helper, scoped to the merchant
3. POSTs to the checkout endpoint with the SPT in the header
4. Returns the order confirmation

```typescript
import Stripe from 'stripe'
import type { BuyerConfig } from '../config.js'

interface BuyParams {
  store_url: string
  product_id?: string
  size: string
  shipping_name?: string
  shipping_address1?: string
  shipping_city?: string
  shipping_state?: string
  shipping_zip?: string
  shipping_country?: string
}

export async function buy(params: BuyParams, config: BuyerConfig): Promise<string> {
  if (!config.stripeSecretKey) {
    throw new Error('No Stripe key configured. Run setup_payment first.')
  }
  if (!config.shipping && !params.shipping_name) {
    throw new Error('No shipping address. Run setup_payment or provide shipping params.')
  }

  const base = params.store_url.replace(/\/$/, '')

  // 1. Discover the store
  const x402Res = await fetch(`${base}/.well-known/x402.json`)
  if (!x402Res.ok) throw new Error(`Store at ${base} has no x402.json`)
  const x402 = await x402Res.json() as {
    products: Array<{
      id: string
      name: string
      price: string
      sizes?: string[]
      checkout: { endpoint: string; method: string }
    }>
  }

  const product = params.product_id
    ? x402.products.find((p) => p.id === params.product_id)
    : x402.products[0]

  if (!product) throw new Error(`Product not found: ${params.product_id || 'default'}`)

  const checkoutUrl = `${base}${product.checkout.endpoint}`
  const priceInCents = Math.round(parseFloat(product.price) * 100)

  // 2. Build shipping from params or config defaults
  const shipping = {
    name: params.shipping_name || config.shipping!.name,
    address1: params.shipping_address1 || config.shipping!.address1,
    city: params.shipping_city || config.shipping!.city,
    state: params.shipping_state || config.shipping!.state,
    zip: params.shipping_zip || config.shipping!.zip,
    country: params.shipping_country || config.shipping!.country,
  }

  // 3. Create SPT via Stripe test helper
  const stripe = new Stripe(config.stripeSecretKey, {
    apiVersion: '2026-03-04.preview' as Stripe.LatestApiVersion,
  })

  const sptRes = await fetch('https://api.stripe.com/v1/test_helpers/shared_payment/granted_tokens', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${Buffer.from(`${config.stripeSecretKey}:`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      'payment_method': config.paymentMethod || 'pm_card_visa',
      'usage_limits[currency]': 'usd',
      'usage_limits[max_amount]': priceInCents.toString(),
      'usage_limits[expires_at]': Math.floor(Date.now() / 1000 + 3600).toString(),
    }),
  })

  if (!sptRes.ok) {
    const err = await sptRes.text()
    throw new Error(`Failed to create SPT: ${err}`)
  }

  const spt = (await sptRes.json()) as { id: string }

  // 4. POST to checkout with SPT
  const orderRes = await fetch(checkoutUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shared-Payment-Token': spt.id,
    },
    body: JSON.stringify({ shipping, size: params.size }),
  })

  const orderBody = await orderRes.json() as Record<string, unknown>

  if (!orderRes.ok) {
    throw new Error(`Checkout failed (${orderRes.status}): ${JSON.stringify(orderBody)}`)
  }

  return JSON.stringify(orderBody, null, 2)
}
```

**Step 2: Register buy tool in index.ts**

```typescript
import { buy } from './tools/buy.js'

server.tool(
  'buy',
  'Buy a product from an MPP-enabled store using Stripe SPT. Requires setup_payment to be run first.',
  {
    store_url: z.string().url().describe('Base URL of the store'),
    product_id: z.string().optional().describe('Product ID from x402.json. Defaults to first product.'),
    size: z.string().describe('Size (e.g. S, M, L, XL, 2XL)'),
    shipping_name: z.string().optional().describe('Override default shipping name'),
    shipping_address1: z.string().optional().describe('Override default street address'),
    shipping_city: z.string().optional().describe('Override default city'),
    shipping_state: z.string().optional().describe('Override default state'),
    shipping_zip: z.string().optional().describe('Override default ZIP'),
    shipping_country: z.string().optional().describe('Override default country'),
  },
  async (params) => {
    const config = await loadConfig()
    try {
      const result = await buy(params, config)
      return { content: [{ type: 'text', text: `Order placed!\n\n${result}` }] }
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Purchase failed: ${(err as Error).message}` }],
        isError: true,
      }
    }
  },
)
```

**Step 3: Verify it compiles**

Run: `cd mcp && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add mcp/src/tools/buy.ts mcp/src/index.ts
git commit -m "feat: add buy tool with SPT payment flow"
```

---

### Task 5: Add tests

**Files:**
- Create: `mcp/src/tools/discover.test.ts`
- Create: `mcp/src/config.test.ts`

**Step 1: Write discover test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { discoverStore } from './discover.js'

describe('discoverStore', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns llmsTxt and x402 when both exist', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = url.toString()
      if (urlStr.endsWith('/llms.txt')) {
        return new Response('# Store\nBuy stuff here', { status: 200 })
      }
      if (urlStr.endsWith('/x402.json')) {
        return Response.json({ products: [{ id: 'tee', price: '35.00' }] })
      }
      return new Response('Not found', { status: 404 })
    })

    const result = await discoverStore('https://example.com')
    expect(result.llmsTxt).toContain('Buy stuff here')
    expect(result.x402).toEqual({ products: [{ id: 'tee', price: '35.00' }] })
  })

  it('returns nulls when store has no MPP metadata', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Not found', { status: 404 }),
    )

    const result = await discoverStore('https://example.com')
    expect(result.llmsTxt).toBeNull()
    expect(result.x402).toBeNull()
  })
})
```

**Step 2: Write config test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { loadConfig, saveConfig } from './config.js'
import { readFile, writeFile, mkdir } from 'node:fs/promises'

vi.mock('node:fs/promises')

describe('config', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns empty config when file does not exist', async () => {
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'))
    const config = await loadConfig()
    expect(config).toEqual({})
  })

  it('round-trips config', async () => {
    let stored = ''
    vi.mocked(mkdir).mockResolvedValue(undefined)
    vi.mocked(writeFile).mockImplementation(async (_path, data) => {
      stored = data as string
    })
    vi.mocked(readFile).mockImplementation(async () => stored)

    const config = {
      stripeSecretKey: 'sk_test_123',
      paymentMethod: 'pm_card_visa',
      shipping: {
        name: 'Test User',
        address1: '123 Main St',
        city: 'LA',
        state: 'CA',
        zip: '90001',
        country: 'US',
      },
    }

    await saveConfig(config)
    const loaded = await loadConfig()
    expect(loaded).toEqual(config)
  })
})
```

**Step 3: Run tests**

Run: `cd mcp && npx vitest run`
Expected: All tests pass

**Step 4: Commit**

```bash
git add mcp/src/tools/discover.test.ts mcp/src/config.test.ts
git commit -m "test: add discover and config tests"
```

---

### Task 6: Add CLI wrapper

**Files:**
- Create: `mcp/src/cli.ts`
- Modify: `mcp/package.json`

**Step 1: Create cli.ts**

A simple CLI that wraps the buy tool for terminal use.

```typescript
#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { loadConfig, saveConfig } from './config.js'
import { discoverStore } from './tools/discover.js'
import { buy } from './tools/buy.js'

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    size: { type: 'string', short: 's' },
    name: { type: 'string' },
    address: { type: 'string' },
    city: { type: 'string' },
    state: { type: 'string' },
    zip: { type: 'string' },
    country: { type: 'string', default: 'US' },
    'stripe-key': { type: 'string' },
    'payment-method': { type: 'string' },
  },
})

const [command, ...args] = positionals

if (command === 'setup') {
  if (!values['stripe-key'] || !values.name || !values.address || !values.city || !values.state || !values.zip) {
    console.error('Usage: tglw-buy setup --stripe-key sk_test_... --name "Name" --address "123 St" --city LA --state CA --zip 90001')
    process.exit(1)
  }
  await saveConfig({
    stripeSecretKey: values['stripe-key'],
    paymentMethod: values['payment-method'] || 'pm_card_visa',
    shipping: {
      name: values.name,
      address1: values.address,
      city: values.city,
      state: values.state,
      zip: values.zip,
      country: values.country || 'US',
    },
  })
  console.log('Config saved.')
} else if (command === 'discover') {
  const url = args[0]
  if (!url) { console.error('Usage: tglw-buy discover <url>'); process.exit(1) }
  const result = await discoverStore(url)
  if (result.llmsTxt) console.log(result.llmsTxt)
  if (result.x402) console.log(JSON.stringify(result.x402, null, 2))
  if (!result.llmsTxt && !result.x402) console.log('No MPP metadata found.')
} else if (command === 'buy') {
  const url = args[0]
  if (!url || !values.size) {
    console.error('Usage: tglw-buy buy <url> --size M')
    process.exit(1)
  }
  const config = await loadConfig()
  const result = await buy({ store_url: url, size: values.size }, config)
  console.log(result)
} else {
  console.log(`tglw-buy — Agent buyer for MPP-enabled stores

Commands:
  setup     Configure payment method and shipping address
  discover  Read store metadata (llms.txt, x402.json)
  buy       Purchase a product from a store

Examples:
  tglw-buy setup --stripe-key sk_test_... --name "Derek" --address "123 Main St" --city LA --state CA --zip 90001
  tglw-buy discover https://tglw.com
  tglw-buy buy https://tglw.com --size M`)
}
```

**Step 2: Add cli script to package.json**

Add to scripts: `"cli": "tsx src/cli.ts"`

Update bin: `"tglw-buy": "./dist/cli.js"`

**Step 3: Verify it runs**

Run: `cd mcp && npx tsx src/cli.ts`
Expected: Prints help text

**Step 4: Commit**

```bash
git add mcp/src/cli.ts mcp/package.json
git commit -m "feat: add CLI wrapper for agent buyer"
```

---

### Task 7: Update store's llms.txt and x402.json to advertise SPT support

**Files:**
- Modify: `public/llms.txt`
- Modify: `public/.well-known/x402.json`

**Step 1: Update llms.txt**

Add SPT payment info:

```markdown
## How to Buy (Agent / SPT)
POST /api/checkout
Payment: Stripe SPT (Shared Payment Token)
Header: X-Shared-Payment-Token: spt_...

Same request body as above. Create an SPT scoped to this merchant, include it in the header, and the checkout is fully automated.
```

**Step 2: Update x402.json**

Add `payment_methods` array to the product's checkout config:

```json
"payment_methods": ["x402", "stripe_card", "stripe_spt"]
```

**Step 3: Commit**

```bash
git add public/llms.txt public/.well-known/x402.json
git commit -m "feat: advertise SPT payment support in store metadata"
```

---

### Task 8: Wire up MCP server config for Claude Code

**Files:**
- Document the MCP server config for Claude Code's settings

**Step 1: Test the full flow locally**

1. Start the TGLW store: `cd /Users/derek/projects/tglw && npm run dev`
2. In another terminal, run discover: `cd mcp && npx tsx src/cli.ts discover http://localhost:3001`
3. Expected: See llms.txt and x402.json content
4. Run setup: `npx tsx src/cli.ts setup --stripe-key sk_test_... --name "Derek" --address "123 Main St" --city LA --state CA --zip 90001`
5. Run buy: `npx tsx src/cli.ts buy http://localhost:3001 --size M`
6. Expected: Order confirmation JSON (or SPT error if Stripe test mode not fully configured)

**Step 2: Add MCP config instructions**

Add to Claude Code settings (`~/.claude/settings.json` or project `.claude/settings.json`):

```json
{
  "mcpServers": {
    "tglw-buy": {
      "command": "npx",
      "args": ["tsx", "/Users/derek/projects/tglw/mcp/src/index.ts"]
    }
  }
}
```

**Step 3: Commit**

```bash
git commit -m "docs: add MCP server config for Claude Code"
```
