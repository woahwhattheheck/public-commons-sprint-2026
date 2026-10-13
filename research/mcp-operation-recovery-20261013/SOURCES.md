# Primary source register

Source edition: October 13, 2026. This register separates the published service/protocol contract from the original support procedure in the article.

| Primary source | Contract used in the article |
| --- | --- |
| [TeselaGen MCP documentation](https://www.teselagen.com/documentation/mcp) | Markdown responses; additive writes; possible partial application records following a multi-step timeout; the documented application inspection instruction; deployment/plan/backend context. |
| [MCP tools 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/server/tools) | Protocol errors and tool-execution errors; text and optional structured result content; `isError`. |
| [MCP transports 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) | Disconnect does not imply cancellation; optional stream resumability; last-event identifiers belong to protocol delivery. |
| [MCP authorization 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization) | HTTP authorization-header use, resource-bound tokens and authorization recovery. |

The seven-step support workflow and editable support record are original editorial recommendations. The article does not invent a provider idempotency key, transaction-status endpoint, rollback API or execution result. Illustrative closure text is identified as an example.

## Maintaining this edition

On an actual client engagement, select the deployment and release first. Check its maintained operation definitions and supported client recovery behavior, then replace the generic record with the customer’s existing ticket and application links. Keep approved sensitive inputs in their original authorized systems.
