import Stripe from 'stripe'
import type { ShippingInfo } from './apliiq'

let _stripe: Stripe | null = null

function getStripe(): Stripe {
  if (!_stripe) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY is not configured')
    }
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2026-03-04.preview' as Stripe.LatestApiVersion,
    })
  }
  return _stripe
}

/** $35.00 in cents */
const CHECKOUT_AMOUNT_CENTS = 3500

export interface CheckoutPaymentInput {
  shipping: ShippingInfo
  size: string
  designUrl?: string
}

export async function createCheckoutPaymentIntent(input: CheckoutPaymentInput) {
  const { shipping, size, designUrl } = input

  const paymentIntent = await getStripe().paymentIntents.create({
    amount: CHECKOUT_AMOUNT_CENTS,
    currency: 'usd',
    payment_method_types: ['card'],
    metadata: {
      shipping_name: shipping.name,
      shipping_address1: shipping.address1,
      shipping_city: shipping.city,
      shipping_state: shipping.state,
      shipping_zip: shipping.zip,
      shipping_country: shipping.country,
      size,
      ...(designUrl ? { designUrl } : {}),
    },
  })

  return {
    clientSecret: paymentIntent.client_secret!,
    paymentIntentId: paymentIntent.id,
  }
}

export async function verifyPaymentIntent(paymentIntentId: string) {
  const pi = await getStripe().paymentIntents.retrieve(paymentIntentId)
  return {
    verified: pi.status === 'succeeded',
    metadata: pi.metadata,
  }
}

export function constructWebhookEvent(
  body: string,
  signature: string,
): Stripe.Event {
  return getStripe().webhooks.constructEvent(
    body,
    signature,
    process.env.STRIPE_WEBHOOK_SECRET!,
  )
}
