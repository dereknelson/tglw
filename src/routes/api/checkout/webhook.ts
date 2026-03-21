import { createFileRoute } from '@tanstack/react-router'
import { constructWebhookEvent } from '../../../server/stripe'
import { createOrder } from '../../../server/apliiq'
import type { ShippingInfo } from '../../../server/apliiq'

// In-memory idempotency guard to prevent duplicate orders from webhook retries.
// In production, replace with Redis or a database check.
const processedPaymentIntents = new Set<string>()

export const Route = createFileRoute('/api/checkout/webhook')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await request.text()
        const signature = request.headers.get('stripe-signature')

        if (!signature) {
          return Response.json({ error: 'Missing signature' }, { status: 400 })
        }

        let event
        try {
          event = constructWebhookEvent(body, signature)
        } catch (err) {
          console.error('Webhook signature verification failed:', err)
          return Response.json({ error: 'Invalid signature' }, { status: 400 })
        }

        if (event.type === 'payment_intent.succeeded') {
          const pi = event.data.object as {
            id: string
            metadata: Record<string, string>
          }

          if (processedPaymentIntents.has(pi.id)) {
            console.log(`Webhook: already processed PI ${pi.id}, skipping`)
            return Response.json({ received: true })
          }
          processedPaymentIntents.add(pi.id)

          const { metadata } = pi
          const shipping: ShippingInfo = {
            name: metadata.shipping_name,
            address1: metadata.shipping_address1,
            city: metadata.shipping_city,
            state: metadata.shipping_state,
            zip: metadata.shipping_zip,
            country: metadata.shipping_country,
          }

          try {
            const order = await createOrder(
              shipping,
              metadata.size,
              metadata.designUrl,
            )
            console.log(
              `Webhook: created Apliiq order ${order.orderId} for PI ${pi.id}`,
            )
          } catch (err) {
            console.error(
              `Webhook: failed to create order for PI ${pi.id}:`,
              err,
            )
            return Response.json(
              { error: 'Order creation failed' },
              { status: 500 },
            )
          }
        }

        return Response.json({ received: true })
      },
    },
  },
})
