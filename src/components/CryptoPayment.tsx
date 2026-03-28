import { useAccount, useWalletClient } from 'wagmi'
import { ConnectButton } from '@rainbow-me/rainbowkit'

interface CryptoPaymentProps {
  shipping: {
    name: string
    address1: string
    city: string
    state: string
    zip: string
    country: string
  }
  size: string
  designUrl?: string
  shippingValid: boolean
  status: 'idle' | 'paying' | 'success' | 'error'
  onStatusChange: (status: 'idle' | 'paying' | 'success' | 'error') => void
  onError: (error: string) => void
  onSuccess: (result: {
    order_id: string
    tx_hash: string | null
    payment_method: string
  }) => void
}

export default function CryptoPayment({
  shipping,
  size,
  designUrl,
  shippingValid,
  status,
  onStatusChange,
  onError,
  onSuccess,
}: CryptoPaymentProps) {
  const { isConnected } = useAccount()
  const { data: walletClient } = useWalletClient()

  async function handleCryptoCheckout() {
    if (!isConnected || !walletClient) return

    onStatusChange('paying')

    try {
      const [
        { wrapFetchWithPayment, x402Client },
        { ExactEvmScheme, toClientEvmSigner },
      ] = await Promise.all([import('@x402/fetch'), import('@x402/evm')])

      const signer = toClientEvmSigner(walletClient as any)
      const client = new x402Client().register(
        'eip155:8453',
        new ExactEvmScheme(signer),
      )

      const fetchWithPayment = wrapFetchWithPayment(fetch, client)

      const res = await fetchWithPayment('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shipping, size, designUrl }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || `Request failed: ${res.status}`)
      }

      const data = await res.json()
      onSuccess(data)
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Checkout failed')
    }
  }

  if (!isConnected) {
    return (
      <div className="flex justify-center">
        <ConnectButton />
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={handleCryptoCheckout}
      disabled={status === 'paying' || !shippingValid}
      className="w-full cursor-pointer rounded-full bg-[var(--accent)] px-8 py-3.5 text-sm font-semibold uppercase tracking-[0.15em] text-white transition hover:bg-[var(--accent-hover)] hover:scale-[1.02] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
    >
      {status === 'paying' ? 'Processing...' : 'Pay $25 USDC'}
    </button>
  )
}
