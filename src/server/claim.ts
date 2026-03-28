import { createPublicClient, http, recoverAddress, hashMessage, type Hex } from 'viem'
import { base } from 'viem/chains'
import { PRICE } from './price'

const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const
const COMPUTA_ADDRESS = '0x08379e7d313a0781612c9624741b38a263f499f6' as const

const client = createPublicClient({
  chain: base,
  transport: http(),
})

const claimedTxs = new Set<string>()

export function isAlreadyClaimed(txHash: string): boolean {
  return claimedTxs.has(txHash.toLowerCase())
}

export function markClaimed(txHash: string): void {
  claimedTxs.add(txHash.toLowerCase())
}

export interface TxVerification {
  valid: boolean
  sender: string | null
  error?: string
}

export async function verifyUsdcTransfer(txHash: Hex): Promise<TxVerification> {
  try {
    const receipt = await client.getTransactionReceipt({ hash: txHash })

    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== USDC_BASE.toLowerCase()) continue
      if (!log.topics[1] || !log.topics[2]) continue

      const from = ('0x' + log.topics[1].slice(26)) as Hex
      const to = ('0x' + log.topics[2].slice(26)) as Hex
      const value = BigInt(log.data)

      if (
        to.toLowerCase() === COMPUTA_ADDRESS.toLowerCase() &&
        value >= BigInt(PRICE.usdc6)
      ) {
        return { valid: true, sender: from.toLowerCase() }
      }
    }

    return { valid: false, sender: null, error: 'No matching USDC transfer found in tx' }
  } catch (err) {
    return { valid: false, sender: null, error: `Failed to fetch tx: ${(err as Error).message}` }
  }
}

export async function verifyClaim(
  txHash: Hex,
  signature: Hex,
): Promise<{ valid: boolean; error?: string }> {
  if (isAlreadyClaimed(txHash)) {
    return { valid: false, error: 'This transaction has already been claimed' }
  }

  const txResult = await verifyUsdcTransfer(txHash)
  if (!txResult.valid) {
    return { valid: false, error: txResult.error }
  }

  const message = `Claiming TGLW order for tx ${txHash}`

  try {
    const recoveredAddress = await recoverAddress({
      hash: hashMessage(message),
      signature,
    })

    if (recoveredAddress.toLowerCase() !== txResult.sender) {
      return { valid: false, error: 'Signature does not match tx sender' }
    }
  } catch {
    return { valid: false, error: 'Invalid signature' }
  }

  return { valid: true }
}
