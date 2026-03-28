import { createFileRoute } from '@tanstack/react-router'
import { createOrder } from '../../server/apliiq'
import {
  getStripe,
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
        const startTime = Date.now()
        console.log('[checkout] POST /api/checkout started')

        let body: { shipping?: ShippingInfo; size?: string; designUrl?: string }
        try {
          body = await request.json()
        } catch {
          console.log('[checkout] 400 — invalid JSON body')
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

        // Check for MPP / SPT agent card payment
        const sptTokenHeader = request.headers.get('X-Shared-Payment-Token')

        console.log('[checkout] payment headers:', {
          hasStripe: !!stripePaymentIntentId,
          hasX402: !!paymentSignature,
          hasSPT: !!sptTokenHeader,
          size: body.size,
          hasDesignUrl: !!body.designUrl,
          shippingTo: `${body.shipping?.city}, ${body.shipping?.state}`,
        })

        // No payment header — return 402 with all accepted methods
        if (!stripePaymentIntentId && !paymentSignature && !sptTokenHeader) {
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
            console.log('[checkout] Stripe PaymentIntent created:', stripePaymentId)
          } catch (err) {
            console.error('[checkout] Failed to create Stripe PaymentIntent:', err)
          }

          const paymentRequired = Buffer.from(
            JSON.stringify({
              x402Version: 2,
              accepts: [x402Requirements],
            }),
          ).toString('base64')

          console.log('[checkout] 402 — returning payment options', {
            hasStripe: !!stripeClientSecret,
            ms: Date.now() - startTime,
          })
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
          console.log('[checkout:stripe] verifying payment intent:', stripePaymentIntentId)
          const verification = await verifyPaymentIntent(stripePaymentIntentId)

          if (!verification.verified) {
            console.log('[checkout:stripe] 402 — payment not confirmed')
            return Response.json(
              { error: 'Card payment not confirmed' },
              { status: 402 },
            )
          }

          console.log('[checkout:stripe] payment verified, creating Apliiq order')
          let orderResult: { orderId: string; status: string }
          try {
            orderResult = await createOrder(shipping, size, body.designUrl)
          } catch (err) {
            console.error('[checkout:stripe] Apliiq order creation failed:', err)
            return Response.json(
              {
                error:
                  'Order fulfillment failed. Payment was captured. Contact support.',
              },
              { status: 500 },
            )
          }

          console.log('[checkout:stripe] SUCCESS', {
            orderId: orderResult.orderId,
            ms: Date.now() - startTime,
          })
          return Response.json({
            order_id: orderResult.orderId,
            status: orderResult.status,
            payment_method: 'card',
            message: 'Your shirt is on the way.',
          })
        }

        // === MPP / SPT agent card payment path ===
        if (sptTokenHeader) {
          console.log('[checkout:spt] processing SPT payment')
          try {
            const pi = await getStripe().paymentIntents.create({
              amount: 3500,
              currency: 'usd',
              shared_payment_granted_token: sptTokenHeader,
              confirm: true,
              metadata: {
                shipping_name: shipping.name,
                shipping_address1: shipping.address1,
                shipping_city: shipping.city,
                shipping_state: shipping.state,
                shipping_zip: shipping.zip,
                shipping_country: shipping.country,
                size,
                ...(body.designUrl ? { designUrl: body.designUrl } : {}),
              },
            } as any)

            if (pi.status !== 'succeeded') {
              console.log('[checkout:spt] 402 — payment status:', pi.status)
              return Response.json(
                { error: 'SPT payment not confirmed', status: pi.status },
                { status: 402 },
              )
            }

            console.log('[checkout:spt] payment confirmed, creating Apliiq order')
            let orderResult: { orderId: string; status: string }
            try {
              orderResult = await createOrder(shipping, size, body.designUrl)
            } catch (err) {
              console.error('[checkout:spt] Apliiq order creation failed:', err)
              return Response.json(
                {
                  error:
                    'Order fulfillment failed. Payment was captured. Contact support.',
                },
                { status: 500 },
              )
            }

            console.log('[checkout:spt] SUCCESS', {
              orderId: orderResult.orderId,
              ms: Date.now() - startTime,
            })
            return Response.json({
              order_id: orderResult.orderId,
              status: orderResult.status,
              payment_method: 'spt',
              message: 'Your shirt is on the way.',
            })
          } catch (err) {
            console.error('[checkout:spt] SPT payment failed:', err)
            return Response.json(
              { error: 'SPT payment failed' },
              { status: 402 },
            )
          }
        }

        // === x402 crypto payment path ===
        console.log('[checkout:x402] processing x402 payment')
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

        console.log('[checkout:x402] verify result:', {
          isValid: verifyResult.isValid,
          reason: verifyResult.invalidReason,
        })

        if (!verifyResult.isValid) {
          return Response.json(
            {
              error: 'Payment verification failed',
              reason: verifyResult.invalidReason,
            },
            { status: 402 },
          )
        }

        console.log('[checkout:x402] payment verified, creating Apliiq order')
        let orderResult: { orderId: string; status: string }
        try {
          orderResult = await createOrder(shipping, size, body.designUrl)
        } catch (err) {
          console.error('[checkout:x402] Apliiq order creation failed:', err)
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

        console.log('[checkout:x402] settle result:', {
          success: settleResult.success,
          tx: settleResult.transaction,
        })

        if (!settleResult.success) {
          console.error('[checkout:x402] settlement failed:', settleResult.errorReason)
        }

        console.log('[checkout:x402] SUCCESS', {
          orderId: orderResult.orderId,
          tx: settleResult.transaction,
          ms: Date.now() - startTime,
        })

        const responseBody = {
          order_id: orderResult.orderId,
          status: orderResult.status,
          tx_hash: settleResult.transaction || null,
          payment_method: 'x402',
          message: 'Your shirt is on the way.',
        }

        const paymentResponse = Buffer.from(
          JSON.stringify({
            success: settleResult.success,
            transaction: settleResult.transaction,
          }),
        ).toString('base64')

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
