# Development friction log

These are engineering observations encountered while building Hearthline. They are notes for later product feedback, not claims that a submission was made.

## MCP package-generation split

**Task:** identify the current recommended Node server packages and MCP Apps helper packages.

**Observed:** current MCP Apps docs describe split `@modelcontextprotocol/server`, `node`, and `express` packages for v2, while some quickstart snippets still show the older `@modelcontextprotocol/sdk/server/mcp.js` import shape. The protocol docs themselves are clear, but moving between examples can require careful version checking.

**Workaround:** Hearthline currently implements the small protocol surface it needs directly against the published 2025-11-25 wire specification, with conformance tests around headers, lifecycle, tools, resources, and errors.

**Suggestion:** put a prominent "package generation" badge on every runnable server snippet and cross-link the matching package major.

## Two protocol versions in one project

**Task:** add an MCP App to an MCP 2025-11-25 server.

**Observed:** the server transport protocol and MCP Apps iframe protocol have separate version identifiers. Hearthline uses MCP `2025-11-25` on HTTP and MCP Apps `2026-01-26` inside the embedded UI. This is correct but easy to misread as a version mismatch.

**Workaround:** constants and tests make the distinction explicit.

**Suggestion:** Alexa+ hackathon guidance could call out the distinction with one end-to-end diagram.

## Streamable HTTP GET behavior

**Task:** implement the smallest conformant remote transport without unnecessary SSE complexity.

**Observed:** Streamable HTTP uses one MCP endpoint for POST and GET, but a server that does not provide a standalone SSE stream may return HTTP 405 to GET. That nuance is easy to miss if "Streamable HTTP" is interpreted as "SSE required."

**Workaround:** Hearthline has a dedicated regression test for the allowed 405 behavior and uses ordinary JSON responses to POST requests.
