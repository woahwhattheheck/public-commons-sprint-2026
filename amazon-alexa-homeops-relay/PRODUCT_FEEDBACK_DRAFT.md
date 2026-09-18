# Product feedback / friction log draft

Review against the live submission form before use. These notes reflect building the current source carrier; they are not a statement that an Alexa production account or private preview environment was exercised.

## Tools used

### Model Context Protocol 2025-11-25

Used as the actual Alexa+ integration surface: Streamable HTTP server, initialize lifecycle, tool discovery/calls, and stateful session handling.

### What worked well

- The hackathon rule page states the Alexa+ protocol floor and transport plainly: MCP 2025-11-25+ over Streamable HTTP.
- Versioned MCP documentation makes it possible to target the competition's exact protocol era rather than “latest” by accident.
- The tool model is a good fit for separating household evidence operations from side-effect requests.

### What needs work

- The live MCP ecosystem has moved to a newer 2026 protocol era, while the competition explicitly accepts/pins the 2025-11-25 handshake era. Search results and “latest” SDK docs can therefore lead a builder to a materially different lifecycle unless version-specific docs are made very prominent.
- Stateful Streamable HTTP details are split across lifecycle, transport, and SDK documentation. A single competition-linked “minimum compliant Alexa+ MCP server” wire example would reduce ambiguity.
- The distinction between “server may assign a session ID” and “client must echo it if assigned” is easy to blur. A normative checklist beside the hackathon starter materials would help.

## Friction-log entry 1

**Task attempted:** Implement the hackathon's exact MCP 2025-11-25 Streamable HTTP floor.

**Steps:** Read current MCP docs, compared the current/latest era with 2025-11-25 behavior, implemented initialize → initialized → session-bound tools, added hostile protocol tests.

**Expected:** “Use current MCP docs” would map directly to the competition requirement.

**Actual:** Current docs prominently include the newer 2026 stateless era, whose wire lifecycle differs from the competition's 2025-11-25 minimum.

**Severity:** Important.

**Workaround:** Pin all implementation decisions to the explicit `2025-11-25` version and test the handshake/session path.

**Suggestion:** Link directly from the Alexa+ hackathon resource page to a version-pinned 2025-11-25 Streamable HTTP minimal server plus an explicit note that newer MCP versions use a different lifecycle.

## Friction-log entry 2

**Task attempted:** Keep agentic household work useful without hiding real-world authority.

**Expected:** A standard pattern for “proposal is okay; external action still needs explicit human/provider authority.”

**Actual:** MCP tool invocation and domain authorization are separate concerns, so an application must define that boundary itself.

**Severity:** Nice-to-have.

**Workaround:** HomeOps Relay makes side-effect requests a separate tool, requires an exact approved plan, replay-protects the request ID, and always sets `execution_authorized=false`.

**Suggestion:** Add Alexa+ hackathon examples that distinguish an MCP tool being callable from a downstream real-world action being authorized.
