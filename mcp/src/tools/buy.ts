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
