#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { loadConfig, saveConfig } from './config.js'
import { discoverStore } from './tools/discover.js'
import { buy } from './tools/buy.js'

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    size: { type: 'string', short: 's' },
    name: { type: 'string' },
    address: { type: 'string' },
    city: { type: 'string' },
    state: { type: 'string' },
    zip: { type: 'string' },
    country: { type: 'string', default: 'US' },
    'stripe-key': { type: 'string' },
    'payment-method': { type: 'string' },
  },
})

const [command, ...args] = positionals

if (command === 'setup') {
  if (!values['stripe-key'] || !values.name || !values.address || !values.city || !values.state || !values.zip) {
    console.error('Usage: tglw-buy setup --stripe-key sk_test_... --name "Name" --address "123 St" --city LA --state CA --zip 90001')
    process.exit(1)
  }
  await saveConfig({
    stripeSecretKey: values['stripe-key'],
    paymentMethod: values['payment-method'] || 'pm_card_visa',
    shipping: {
      name: values.name,
      address1: values.address,
      city: values.city,
      state: values.state,
      zip: values.zip,
      country: values.country || 'US',
    },
  })
  console.log('Config saved.')
} else if (command === 'discover') {
  const url = args[0]
  if (!url) { console.error('Usage: tglw-buy discover <url>'); process.exit(1) }
  const result = await discoverStore(url)
  if (result.llmsTxt) console.log(result.llmsTxt)
  if (result.x402) console.log(JSON.stringify(result.x402, null, 2))
  if (!result.llmsTxt && !result.x402) console.log('No MPP metadata found.')
} else if (command === 'buy') {
  const url = args[0]
  if (!url || !values.size) {
    console.error('Usage: tglw-buy buy <url> --size M')
    process.exit(1)
  }
  const config = await loadConfig()
  const result = await buy({ store_url: url, size: values.size }, config)
  console.log(result)
} else {
  console.log(`tglw-buy — Agent buyer for MPP-enabled stores

Commands:
  setup     Configure payment method and shipping address
  discover  Read store metadata (llms.txt, x402.json)
  buy       Purchase a product from a store

Examples:
  tglw-buy setup --stripe-key sk_test_... --name "Derek" --address "123 Main St" --city LA --state CA --zip 90001
  tglw-buy discover https://tglw.com
  tglw-buy buy https://tglw.com --size M`)
}
