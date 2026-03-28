const PRICE_USD = parseInt(process.env.TGLW_PRICE_USDC || '25', 10)

export const PRICE = {
  usd: PRICE_USD,
  cents: PRICE_USD * 100,
  usdc6: (PRICE_USD * 1_000_000).toString(),
  display: `$${PRICE_USD}`,
  displayUsdc: `$${PRICE_USD}.00 USDC`,
}
