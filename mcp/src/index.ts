#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { discoverStore, discoverSchema } from './tools/discover.js'
import { buy } from './tools/buy.js'
import { loadConfig, saveConfig } from './config.js'

const server = new McpServer({
  name: 'tglw-buy',
  version: '0.1.0',
})

server.tool(
  'discover_store',
  'Discover products and payment info from an MPP-enabled store. Reads llms.txt and .well-known/x402.json.',
  discoverSchema,
  async ({ url }) => {
    const result = await discoverStore(url)

    if (!result.llmsTxt && !result.x402) {
      return {
        content: [{ type: 'text', text: `No MPP metadata found at ${url}. This store may not support agent purchases.` }],
      }
    }

    let text = ''
    if (result.llmsTxt) text += `## llms.txt\n\n${result.llmsTxt}\n\n`
    if (result.x402) text += `## x402.json\n\n${JSON.stringify(result.x402, null, 2)}`

    return { content: [{ type: 'text', text }] }
  },
)

server.tool(
  'setup_payment',
  'Configure payment method and default shipping address for purchases. Run this once before buying.',
  {
    stripe_secret_key: z.string().describe('Your Stripe secret key (sk_test_...)'),
    payment_method: z.string().optional().describe('Stripe payment method ID. Defaults to pm_card_visa for testing.'),
    name: z.string().describe('Shipping name'),
    address1: z.string().describe('Street address'),
    city: z.string().describe('City'),
    state: z.string().describe('State/province'),
    zip: z.string().describe('ZIP/postal code'),
    country: z.string().describe('Country (ISO 2-letter, e.g. US)'),
  },
  async (params) => {
    const config = await loadConfig()
    config.stripeSecretKey = params.stripe_secret_key
    config.paymentMethod = params.payment_method || 'pm_card_visa'
    config.shipping = {
      name: params.name,
      address1: params.address1,
      city: params.city,
      state: params.state,
      zip: params.zip,
      country: params.country,
    }
    await saveConfig(config)

    return {
      content: [{ type: 'text', text: `Payment configured. Using payment method: ${config.paymentMethod}. Default shipping to ${params.name}, ${params.city}, ${params.state}.` }],
    }
  },
)

server.tool(
  'buy',
  'Buy a product from an MPP-enabled store using Stripe SPT. Requires setup_payment to be run first.',
  {
    store_url: z.string().url().describe('Base URL of the store'),
    product_id: z.string().optional().describe('Product ID from x402.json. Defaults to first product.'),
    size: z.string().describe('Size (e.g. S, M, L, XL, 2XL)'),
    shipping_name: z.string().optional().describe('Override default shipping name'),
    shipping_address1: z.string().optional().describe('Override default street address'),
    shipping_city: z.string().optional().describe('Override default city'),
    shipping_state: z.string().optional().describe('Override default state'),
    shipping_zip: z.string().optional().describe('Override default ZIP'),
    shipping_country: z.string().optional().describe('Override default country'),
  },
  async (params) => {
    const config = await loadConfig()
    try {
      const result = await buy(params, config)
      return { content: [{ type: 'text', text: `Order placed!\n\n${result}` }] }
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Purchase failed: ${(err as Error).message}` }],
        isError: true,
      }
    }
  },
)

const transport = new StdioServerTransport()
await server.connect(transport)
