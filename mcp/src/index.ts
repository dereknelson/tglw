#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { discoverStore, discoverSchema } from './tools/discover.js'
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

const transport = new StdioServerTransport()
await server.connect(transport)
