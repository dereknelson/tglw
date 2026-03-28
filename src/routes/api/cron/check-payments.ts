import { createFileRoute } from '@tanstack/react-router'
import { createPublicClient, http, parseAbiItem } from 'viem'
import { base } from 'viem/chains'
import { isAlreadyClaimed } from '../../../server/claim'
import { PRICE } from '../../../server/price'

const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const
const COMPUTA_ADDRESS = '0x08379e7d313a0781612c9624741b38a263f499f6' as const
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL || ''

const client = createPublicClient({
  chain: base,
  transport: http(),
})

async function sendSlackAlert(message: string) {
  if (!SLACK_WEBHOOK_URL) {
    console.log('[cron] No SLACK_WEBHOOK_URL, skipping alert:', message)
    return
  }
  await fetch(SLACK_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: message }),
  })
}

export const Route = createFileRoute('/api/cron/check-payments')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const authHeader = request.headers.get('authorization')
        const cronSecret = process.env.CRON_SECRET
        if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }

        try {
          const currentBlock = await client.getBlockNumber()
          const fromBlock = currentBlock - 150n

          const logs = await client.getLogs({
            address: USDC_BASE,
            event: parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)'),
            args: { to: COMPUTA_ADDRESS },
            fromBlock,
            toBlock: 'latest',
          })

          let unclaimed = 0
          for (const log of logs) {
            const value = BigInt(log.data)
            if (value < BigInt(PRICE.usdc6)) continue

            const txHash = log.transactionHash!
            if (isAlreadyClaimed(txHash)) continue

            unclaimed++
            const sender = '0x' + log.topics[1]?.slice(26)
            const amount = Number(value) / 1_000_000

            await sendSlackAlert(
              `Unclaimed TGLW payment: ${sender} sent $${amount} USDC to computa.eth\nTx: https://basescan.org/tx/${txHash}\nClaim: https://tglw.com/claim`,
            )
          }

          return Response.json({
            checked: logs.length,
            unclaimed,
            block: currentBlock.toString(),
          })
        } catch (err) {
          console.error('[cron] check-payments failed:', err)
          return Response.json({ error: 'Check failed' }, { status: 500 })
        }
      },
    },
  },
})
