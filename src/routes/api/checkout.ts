import { createFileRoute } from '@tanstack/react-router'
import { createOrder } from '../../server/apliiq'
import {
  verifyPaymentIntent,
  createCheckoutPaymentIntent,
} from '../../server/stripe'
import type { ShippingInfo } from '../../server/apliiq'

const PAY_TO = process.env.X402_PAY_TO!
const FACILITATOR_URL = 'https://api.cdp.coinbase.com/platform/v2/x402'

// USDC on Base mainnet
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const NETWORK_BASE = 'eip155:8453'

// $35.00 in USDC base units (6 decimals)
const PRICE_AMOUNT = '35000000'

const VALID_SIZES = ['S', 'M', 'L', 'XL', '2XL']

const x402Requirements = {
  scheme: 'exact',
  network: NETWORK_BASE,
  asset: USDC_BASE,
  amount: PRICE_AMOUNT,
  payTo: PAY_TO,
  maxTimeoutSeconds: 300,
  description: 'TGLW — Lift Weights Touch Grass Black Tee — $35 USDC on Base',
  extra: {},
}

export const Route = createFileRoute('/api/checkout')({
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
            {
              error: `Invalid size. Must be one of: ${VALID_SIZES.join(', ')}`,
            },
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

        // Check for Stripe card payment
        const stripePaymentIntentId = request.headers.get(
          'X-Stripe-Payment-Intent',
        )

        // Check for x402 payment signature
        const paymentSignature =
          request.headers.get('Payment-Signature') ||
          request.headers.get('X-Payment')

        // No payment header — return 402 with all accepted methods
        if (!stripePaymentIntentId && !paymentSignature) {
          let stripeClientSecret: string | null = null
          let stripePaymentId: string | null = null
          try {
            const intent = await createCheckoutPaymentIntent({
              shipping,
              size,
              designUrl: body.designUrl,
            })
            stripeClientSecret = intent.clientSecret
            stripePaymentId = intent.paymentIntentId
          } catch (err) {
            console.error('Failed to create Stripe PaymentIntent:', err)
          }

          const paymentRequired = btoa(
            JSON.stringify({
              x402Version: 2,
              accepts: [x402Requirements],
            }),
          )

          return new Response(
            JSON.stringify({
              error: 'Payment required',
              description: x402Requirements.description,
              methods: {
                x402: {
                  price: '$35.00 USDC',
                  network: 'Base',
                },
                stripe: stripeClientSecret
                  ? {
                      price: '$35.00',
                      clientSecret: stripeClientSecret,
                      paymentIntentId: stripePaymentId,
                      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
                    }
                  : null,
              },
            }),
            {
              status: 402,
              headers: {
                'Content-Type': 'application/json',
                'Payment-Required': paymentRequired,
              },
            },
          )
        }

        // === Stripe card payment path ===
        if (stripePaymentIntentId) {
          const verification = await verifyPaymentIntent(stripePaymentIntentId)

          if (!verification.verified) {
            return Response.json(
              { error: 'Card payment not confirmed' },
              { status: 402 },
            )
          }

          let orderResult: { orderId: string; status: string }
          try {
            orderResult = await createOrder(shipping, size, body.designUrl)
          } catch (err) {
            console.error('Apliiq order creation failed:', err)
            return Response.json(
              {
                error:
                  'Order fulfillment failed. Payment was captured. Contact support.',
              },
              { status: 500 },
            )
          }

          return Response.json({
            order_id: orderResult.orderId,
            status: orderResult.status,
            payment_method: 'card',
            message: 'Your shirt is on the way.',
          })
        }

        // === x402 crypto payment path ===
        let paymentPayload: Record<string, unknown>
        try {
          paymentPayload = JSON.parse(atob(paymentSignature!))
        } catch {
          return Response.json(
            { error: 'Invalid payment signature encoding' },
            { status: 400 },
          )
        }

        const verifyRes = await fetch(`${FACILITATOR_URL}/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            x402Version: paymentPayload.x402Version ?? 2,
            paymentPayload,
            paymentRequirements: x402Requirements,
          }),
        })

        const verifyResult = (await verifyRes.json()) as {
          isValid: boolean
          invalidReason?: string
        }

        if (!verifyResult.isValid) {
          return Response.json(
            {
              error: 'Payment verification failed',
              reason: verifyResult.invalidReason,
            },
            { status: 402 },
          )
        }

        let orderResult: { orderId: string; status: string }
        try {
          orderResult = await createOrder(shipping, size, body.designUrl)
        } catch (err) {
          console.error('Apliiq order creation failed:', err)
          return Response.json(
            {
              error:
                'Order fulfillment failed. Payment was verified. Contact support.',
            },
            { status: 500 },
          )
        }

        const settleRes = await fetch(`${FACILITATOR_URL}/settle`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            x402Version: paymentPayload.x402Version ?? 2,
            paymentPayload,
            paymentRequirements: x402Requirements,
          }),
        })

        const settleResult = (await settleRes.json()) as {
          success: boolean
          transaction?: string
          errorReason?: string
        }

        if (!settleResult.success) {
          console.error('Payment settlement failed:', settleResult.errorReason)
        }

        const responseBody = {
          order_id: orderResult.orderId,
          status: orderResult.status,
          tx_hash: settleResult.transaction || null,
          payment_method: 'x402',
          message: 'Your shirt is on the way.',
        }

        const paymentResponse = btoa(
          JSON.stringify({
            success: settleResult.success,
            transaction: settleResult.transaction,
          }),
        )

        return new Response(JSON.stringify(responseBody), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Payment-Response': paymentResponse,
          },
        })
      },
    },
  },
})
