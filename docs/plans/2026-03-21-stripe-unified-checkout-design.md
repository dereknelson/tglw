# Unified Checkout: Stripe x402 + Card Payments

## Problem

TGLW collects $35 USDC via x402 on Base, then creates Apliiq print-on-demand orders. Apliiq charges a credit card on file per fulfillment. Currently there's no fiat revenue path, and USDC revenue requires manual offramping to fund the Apliiq card.

## Solution

Migrate x402 to Stripe's facilitator and add Stripe card payments. Both payment paths settle into a single Stripe account as USD, which funds the bank account behind the Apliiq card-on-file.

## Architecture

```
POST /api/checkout (no payment header)
  │
  ▼
402 Payment Required
  accepts:
    - x402: USDC on Base (eip155:8453)
    - x402: USDC on Tempo (eip155:TEMPO_CHAIN_ID)
    - stripe: USD card payment ($35.00)
  │
  ▼
Client picks a method, pays, retries with payment header
  │
  ▼
Server verifies payment → createOrder(apliiq)
```

### Buyer Scenarios

| Buyer | Method | Flow |
|-------|--------|------|
| Human with wallet | x402 | Browser wallet signs USDC tx via Stripe x402 facilitator |
| Human with card | Stripe Elements | Embedded card form, creates PaymentIntent, sends as payment header |
| Agent with wallet | x402 | Agent's x402 client handles 402 automatically |
| Agent with card | MPP + SPT | Agent presents Shared Payment Token (pre-authorized Stripe card token) |

### Revenue Flow

```
x402 USDC ──→ Stripe x402 facilitator ──→ Stripe balance (USD)
Card payment ──→ Stripe PaymentIntent ───→ Stripe balance (USD)
                                                  │
                                                  ▼
                                          Stripe payout → Bank account
                                                  │
                                                  ▼
                                          Apliiq card-on-file charges against bank
```

## Server Changes

### `/api/checkout.ts` — Unified 402 Endpoint

The existing endpoint expands to:

1. **402 response** advertises multiple payment schemes:
   ```json
   {
     "x402Version": 2,
     "accepts": [
       {
         "scheme": "exact",
         "network": "eip155:8453",
         "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
         "amount": "35000000",
         "payTo": "<STRIPE_X402_DEPOSIT_ADDRESS>",
         "maxTimeoutSeconds": 300,
         "description": "TGLW Black Tee — $35 USDC on Base"
       },
       {
         "scheme": "exact",
         "network": "eip155:<TEMPO_CHAIN_ID>",
         "asset": "<USDC_TEMPO_ADDRESS>",
         "amount": "35000000",
         "payTo": "<STRIPE_X402_DEPOSIT_ADDRESS>",
         "maxTimeoutSeconds": 300,
         "description": "TGLW Black Tee — $35 USDC on Tempo"
       },
       {
         "scheme": "stripe",
         "currency": "usd",
         "amount": 3500,
         "description": "TGLW Black Tee — $35.00"
       }
     ]
   }
   ```

2. **Payment verification** inspects the payment header to determine scheme:
   - x402 payment header → verify + settle via Stripe x402 facilitator
   - Stripe PaymentIntent ID header → verify via `stripe.paymentIntents.retrieve()`, confirm status is `succeeded`
   - MPP SPT header → verify via Stripe MPP verification

3. **On success** → `createOrder(shipping, size, designUrl)` → return order confirmation

### `/api/checkout/webhook.ts` — Safety Net

Handles `checkout.session.completed` and `payment_intent.succeeded` events as a fallback for cases where the client disconnects after payment but before receiving the order confirmation.

- Verifies Stripe webhook signature
- Extracts shipping/size/designUrl from PaymentIntent metadata
- Creates Apliiq order if not already created (idempotency via PaymentIntent ID)

## Client Changes

### `CheckoutForm.tsx`

After size + shipping fields, shows two payment buttons:

```
┌─────────────────────────────┐
│  Size: [S] [M] [L] [XL]    │
│  Shipping: ...              │
│                             │
│  ┌───────────────────────┐  │
│  │    Pay $35 USDC       │  │  ← wallet flow (existing, updated)
│  └───────────────────────┘  │
│                             │
│  ┌───────────────────────┐  │
│  │    Pay $35 Card       │  │  ← Stripe Elements
│  └───────────────────────┘  │
│                             │
│  $35 · Powered by x402      │
└─────────────────────────────┘
```

- **"Pay $35 USDC"**: Existing wallet flow. Updated to use Stripe's x402 facilitator and register Tempo chain alongside Base.
- **"Pay $35 Card"**: Expands to show `CardPaymentForm` (Stripe Elements). On submit: creates PaymentIntent via `/api/checkout` 402 negotiation, confirms with card details, retries `/api/checkout` with the confirmed PaymentIntent ID as payment header.

### `CardPaymentForm.tsx` (new)

Thin wrapper around Stripe Elements `<CardElement>`:
- Receives `clientSecret` from the 402 response's Stripe scheme
- Confirms payment via `stripe.confirmCardPayment(clientSecret)`
- Returns the PaymentIntent ID to `CheckoutForm` for the retry request

### `WalletProvider.tsx`

No changes needed — Stripe Elements provider (`<Elements>`) gets added alongside the existing Wagmi/RainbowKit providers in the app root.

## New Dependencies

- `stripe` — server SDK for PaymentIntents, webhook verification
- `@stripe/stripe-js` — client loader
- `@stripe/react-stripe-js` — React Elements components

## New Environment Variables

| Variable | Purpose |
|----------|---------|
| `STRIPE_SECRET_KEY` | Server-side Stripe API key |
| `STRIPE_PUBLISHABLE_KEY` | Client-side Stripe key (safe to expose) |
| `STRIPE_WEBHOOK_SECRET` | Webhook signature verification |

## Apliiq Billing

No changes to Apliiq integration. Orders are created via the existing `createOrder()` function. Apliiq charges the merchant's card-on-file automatically. The Stripe revenue (from both crypto and card payments) funds the bank account behind that card.

## Migration from Current x402

1. Replace `x402.org/facilitator` with Stripe's x402 facilitator endpoints
2. Update `PAY_TO` address to Stripe-provided deposit address
3. Add Tempo chain support (USDC contract: `0x20c000000000000000000000b9537d11c60e8b50`)
4. Keep Base chain support alongside Tempo

## Prerequisites

- Stripe account with machine payments enabled (email `machine-payments@stripe.com`)
- "Stablecoins and Crypto" payment method approved in Stripe Dashboard
- API version: `2026-03-04.preview`
- Apliiq card-on-file set up at `apliiq.com/verified/paymethods`, linked to bank account receiving Stripe payouts
