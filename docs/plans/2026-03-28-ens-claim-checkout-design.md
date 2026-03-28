# ENS Claim Checkout Design

## Overview

Pay-then-claim checkout via computa.eth. Send $25 USDC to computa.eth on Base, then claim your order by signing a message proving you're the sender.

## Flow

1. User sends $25 USDC to computa.eth on Base
2. User visits /claim or agent POSTs to /api/claim
3. Connects wallet → frontend scans recent USDC transfers to computa.eth
4. User enters shipping + size, signs: "Claiming TGLW order for tx 0x{hash}"
5. Backend verifies signature matches tx sender, tx is $25 USDC to computa.eth, tx not claimed
6. Order fulfilled

## ENS Text Records (computa.eth)

```
tglw.product = "Lift Weights Touch Grass Tee"
tglw.price = "25"
tglw.token = "USDC"
tglw.network = "base"
tglw.sizes = "S,M,L,XL,2XL"
tglw.claim = "https://tglw.com/api/claim"
```

## API

### POST /api/claim

```json
{
  "tx_hash": "0x...",
  "signature": "0x...",
  "size": "M",
  "shipping": { "name", "address1", "city", "state", "zip", "country" }
}
```

Verification: fetch tx → confirm USDC transfer to computa.eth for >= $25 → recover signer from signature → confirm signer === tx sender → check not already claimed → create order.

### GET /api/claim/check?tx=0x...

Returns whether a tx has been claimed.

### GET /api/cron/check-payments

Vercel cron (every 60s). Queries USDC Transfer events to computa.eth. Alerts via Slack if unclaimed > 10 min.

## Price

Configurable via TGLW_PRICE_USDC env var, defaults to 25. Update across checkout, storefront, x402.json, llms.txt.

## Frontend /claim Page

1. Connect wallet (RainbowKit)
2. Query Base RPC for user's recent USDC transfers to computa.eth
3. Show unclaimed $25 txs
4. Size + shipping form + sign message
5. POST /api/claim
6. Success screen
