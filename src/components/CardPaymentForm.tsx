// src/components/CardPaymentForm.tsx
import { useState, useMemo } from 'react'
import {
  Elements,
  CardElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js'
import { loadStripe } from '@stripe/stripe-js'

interface CardPaymentFormProps {
  clientSecret: string
  publishableKey: string
  onSuccess: (paymentIntentId: string) => void
  onError: (error: string) => void
  disabled?: boolean
}

function CardForm({
  clientSecret,
  onSuccess,
  onError,
  disabled,
}: Omit<CardPaymentFormProps, 'publishableKey'>) {
  const stripe = useStripe()
  const elements = useElements()
  const [processing, setProcessing] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!stripe || !elements) return

    setProcessing(true)

    const result = await stripe.confirmCardPayment(clientSecret, {
      payment_method: { card: elements.getElement(CardElement)! },
    })

    if (result.error) {
      onError(result.error.message || 'Card payment failed')
      setProcessing(false)
    } else if (result.paymentIntent?.status === 'succeeded') {
      onSuccess(result.paymentIntent.id)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-3">
        <CardElement
          options={{
            style: {
              base: {
                fontSize: '14px',
                color: 'var(--ink)',
                '::placeholder': { color: 'var(--ink-muted)' },
              },
            },
          }}
        />
      </div>
      <button
        type="submit"
        disabled={!stripe || processing || disabled}
        className="mt-3 w-full cursor-pointer rounded-full bg-[var(--accent)] px-8 py-3.5 text-sm font-semibold uppercase tracking-[0.15em] text-white transition hover:bg-[var(--accent-hover)] hover:scale-[1.02] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {processing ? 'Processing...' : 'Pay $35'}
      </button>
    </form>
  )
}

export default function CardPaymentForm(props: CardPaymentFormProps) {
  const stripePromise = useMemo(
    () => loadStripe(props.publishableKey),
    [props.publishableKey],
  )

  return (
    <Elements stripe={stripePromise} options={{ clientSecret: props.clientSecret }}>
      <CardForm
        clientSecret={props.clientSecret}
        onSuccess={props.onSuccess}
        onError={props.onError}
        disabled={props.disabled}
      />
    </Elements>
  )
}
