# SF-26 MCP marketplace binding

This adapter closes the gap between a seller-echoed x402 Bazaar MCP listing and
the tools an authenticated MCP server actually advertises. Before the accepted
SF-25 → SF-46 catalog path can publish an MCP record, it requires an MCP
capability snapshot whose resource URL, transport, tool name and exact nested
`inputSchema` match the listing.

Accepted discovery records receive a capability digest, protocol/server
identity, tool-schema digest and source pins. Ordinary HTTP records continue to
use SF-25 unchanged. The canonical catalog identity remains
`resource.url + input.toolName`, so multiple tools at one MCP endpoint stay
distinct.

The focused check consumes real owner-controlled tool metadata directly from
`hearthline-alexa-mcp/src/tools.mjs` and initialization capabilities from its
actual MCP server module. It does not invent a registry or call a remote tool.

```sh
node --check stellar-forge/mcp-marketplace/mcp-marketplace.mjs
node --test stellar-forge/mcp-marketplace/mcp-marketplace.test.mjs
```

Source pins:

- x402 Bazaar specification blob: `442708e76d5a129e0c1393471d8ed71e3604c94e`
- Hearthline tool metadata blob: `73c4aec69fef0f5864f266bb601ab6ed69aec666`
- Hearthline MCP server blob: `0c34a9c7809eb60f3fce16c1d4ce61d4b03a6d27`

## Boundaries

The snapshot is an authenticated-caller contract. This code does not establish
that an MCP server is online, verify OAuth or MCP session authentication,
execute a tool, verify Stellar signatures/finality, move funds, prove payment,
or establish SCF eligibility. Test settlement objects and URLs are fixtures.
