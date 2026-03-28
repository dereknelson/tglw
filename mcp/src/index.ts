#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { discoverStore, discoverSchema } from './tools/discover.js'

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

const transport = new StdioServerTransport()
await server.connect(transport)
