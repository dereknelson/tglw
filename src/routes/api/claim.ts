import { createFileRoute } from '@tanstack/react-router'
import { verifyClaim, markClaimed, isAlreadyClaimed } from '../../server/claim'
import { createOrder } from '../../server/apliiq'
import type { ShippingInfo } from '../../server/apliiq'
import type { Hex } from 'viem'

const VALID_SIZES = ['S', 'M', 'L', 'XL', '2XL']

export const Route = createFileRoute('/api/claim')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: {
          tx_hash?: string
          signature?: string
          size?: string
          shipping?: ShippingInfo
        }
        try {
          body = await request.json()
        } catch {
          return Response.json({ error: 'Invalid JSON' }, { status: 400 })
        }

        const { tx_hash, signature, size, shipping } = body
        if (!tx_hash || !signature || !size || !shipping) {
          return Response.json(
            { error: 'Missing required fields: tx_hash, signature, size, shipping' },
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
            { error: 'Missing shipping fields' },
            { status: 400 },
          )
        }

        const result = await verifyClaim(tx_hash as Hex, signature as Hex)
        if (!result.valid) {
          return Response.json({ error: result.error }, { status: 400 })
        }

        let orderResult: { orderId: string; status: string }
        try {
          orderResult = await createOrder(shipping, size)
        } catch (err) {
          console.error('Order creation failed after claim:', err)
          return Response.json(
            { error: 'Order fulfillment failed. Payment verified. Contact support.' },
            { status: 500 },
          )
        }

        markClaimed(tx_hash)

        return Response.json({
          order_id: orderResult.orderId,
          status: orderResult.status,
          tx_hash,
          payment_method: 'ens_claim',
          message: 'Your shirt is on the way.',
        })
      },

      GET: async ({ request }) => {
        const url = new URL(request.url)
        const tx = url.searchParams.get('tx')
        if (!tx) {
          return Response.json({ error: 'Missing tx param' }, { status: 400 })
        }
        return Response.json({ claimed: isAlreadyClaimed(tx) })
      },
    },
  },
})
