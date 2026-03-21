import { createFileRoute } from '@tanstack/react-router'
import { createCheckoutPaymentIntent } from '../../../server/stripe'
import type { ShippingInfo } from '../../../server/apliiq'

const VALID_SIZES = ['S', 'M', 'L', 'XL', '2XL']

export const Route = createFileRoute('/api/checkout/create-intent')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: { shipping?: ShippingInfo; size?: string; designUrl?: string }
        try {
          body = await request.json()
        } catch {
          return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
        }

        const { shipping, size } = body
        if (!shipping || !size) {
          return Response.json(
            { error: 'Missing required fields: shipping, size' },
            { status: 400 },
          )
        }

        if (!VALID_SIZES.includes(size)) {
          return Response.json(
            { error: `Invalid size. Must be one of: ${VALID_SIZES.join(', ')}` },
            { status: 400 },
          )
        }

        if (
          !shipping.name ||
          !shipping.address1 ||
          !shipping.city ||
          !shipping.state ||
          !shipping.zip ||
          !shipping.country
        ) {
          return Response.json(
            {
              error:
                'Missing shipping fields: name, address1, city, state, zip, country',
            },
            { status: 400 },
          )
        }

        try {
          const result = await createCheckoutPaymentIntent({
            shipping,
            size,
            designUrl: body.designUrl,
          })

          return Response.json({
            clientSecret: result.clientSecret,
            paymentIntentId: result.paymentIntentId,
          })
        } catch (err) {
          console.error('Failed to create PaymentIntent:', err)
          return Response.json(
            { error: 'Failed to create payment session' },
            { status: 500 },
          )
        }
      },
    },
  },
})
