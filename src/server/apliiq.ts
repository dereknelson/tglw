import { createHmac } from 'node:crypto'

const APLIIQ_BASE = 'https://api.apliiq.com/api'

function buildAuthHeader(method: string, path: string, body: string): string {
  const appKey = process.env.APLIIQ_APP_KEY!
  const sharedSecret = process.env.APLIIQ_SHARED_SECRET!
  const rts = Math.floor(Date.now() / 1000).toString()
  const state = '' // empty for stateless calls

  // HMAC signature: method + path + body + timestamp
  const message = `${method}${path}${body}${rts}`
  const sig = createHmac('sha256', sharedSecret)
    .update(message)
    .digest('base64')

  return `${rts}:${sig}:${appKey}:${state}`
}

async function apliiqRequest(
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<unknown> {
  const bodyStr = body ? JSON.stringify(body) : ''
  const authHeader = buildAuthHeader(method, path, bodyStr)

  console.log(`[apliiq] ${method} ${path}`)
  const res = await fetch(`${APLIIQ_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-apliiq-auth': authHeader,
    },
    ...(body ? { body: bodyStr } : {}),
  })

  if (!res.ok) {
    const text = await res.text()
    console.error(`[apliiq] ${method} ${path} failed:`, res.status, text)
    throw new Error(`Apliiq API error ${res.status}: ${text}`)
  }

  const data = await res.json()
  console.log(`[apliiq] ${method} ${path} OK`)
  return data
}

export interface ShippingInfo {
  name: string
  address1: string
  city: string
  state: string
  zip: string
  country: string
}

export interface CreateOrderResult {
  orderId: string
  status: string
}

export async function createOrder(
  shipping: ShippingInfo,
  size: string,
  designUrl?: string,
): Promise<CreateOrderResult> {
  const orderData = {
    shipping_address: {
      first_name: shipping.name.split(' ')[0] || shipping.name,
      last_name: shipping.name.split(' ').slice(1).join(' ') || '',
      address1: shipping.address1,
      city: shipping.city,
      province: shipping.state,
      zip: shipping.zip,
      country: shipping.country,
    },
    line_items: [
      {
        quantity: 1,
        size,
        product_id: process.env.APLIIQ_PRODUCT_ID || 'PLACEHOLDER',
        ...(designUrl ? { artwork_url: designUrl } : {}),
      },
    ],
  }

  const result = (await apliiqRequest('POST', '/Order/', orderData)) as {
    id?: string
    order_id?: string
    status?: string
  }

  return {
    orderId: result.id || result.order_id || 'unknown',
    status: result.status || 'submitted',
  }
}

export async function getProducts(): Promise<unknown> {
  return apliiqRequest('GET', '/Product/')
}
