import Stripe from 'stripe'
import type { ShippingInfo } from './apliiq'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-03-04.preview' as Stripe.LatestApiVersion,
})

export { stripe }

interface CheckoutPaymentInput {
  shipping: ShippingInfo
  size: string
  designUrl?: string
}

export async function createCheckoutPaymentIntent(input: CheckoutPaymentInput) {
  const { shipping, size, designUrl } = input

  const paymentIntent = await stripe.paymentIntents.create({
    amount: 3500,
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
  const pi = await stripe.paymentIntents.retrieve(paymentIntentId)
  return {
    verified: pi.status === 'succeeded',
    metadata: pi.metadata,
  }
}

export function constructWebhookEvent(
  body: string,
  signature: string,
): Stripe.Event {
  return stripe.webhooks.constructEvent(
    body,
    signature,
    process.env.STRIPE_WEBHOOK_SECRET!,
  )
}
