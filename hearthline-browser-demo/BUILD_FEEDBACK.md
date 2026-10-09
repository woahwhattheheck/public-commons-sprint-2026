# Build feedback — observed during the 2026-10-09 delivery

These are implementation observations, not fabricated user interviews or a claim of live Alexa/AWS testing.

## What worked

The original dependency-free Node MCP server could run in a constrained cloud container without npm runtime installation. The existing tool schemas and structured content were sufficient to implement a browser client without modifying orchestration or storage. A live HTTP integration run rejected an unapproved operation, created one local reminder, restarted the actual server process and returned the identical stored receipt with the outbox count unchanged at one.

## Friction and resolution

1. The existing browser simulator uses synthetic state and is not a client of the live MCP server. A video of it alone would not establish MCP transport/restart behavior. The new separate host calls the production server and exposes actual process/counter evidence.
2. MCP needs `initialize`, then `notifications/initialized`, followed by the negotiated session and protocol headers. The browser now performs that lifecycle and reports its seven discovered tools.
3. A command can receive HTTP success while its MCP tool result has `isError: true`. The client distinguishes tool rejection from transport failure and treats the deliberate pre-approval rejection as a verified boundary, not successful execution.
4. The delivery container had no GitHub DNS resolution. One public, read-only Actions source bundle supplied all 60 tracked files with a pinned revision and per-file Git-blob/SHA-256 manifest; the native artifact connector delivered the archive successfully. This replaces many repetitive per-file API reads.
5. Local Chromium denied loopback navigation with `ERR_BLOCKED_BY_ADMINISTRATOR`. No browser policy was disabled. The ordinary public GitHub runner provides the independent capture environment; recording status is established by its real workflow result and artifact, not assumed here.
6. The private-token connector hit GitHub's user rate limit. A native app read succeeded; implementation continued on the already acquired local source without repeated polling of the exhausted token.

## Product feedback

Keep operation identity and plan-hash binding in the interface, but present the human decision separately from execution. Users should be able to see that approval itself does not buy, send or book anything. A reconnect/restart indicator plus unchanged receipt/effect counters makes recovery behavior inspectable. A dedicated browser client would be useful again for integration debugging and judge demonstrations; it is not a substitute for Alexa device integration, authorized real provider verification, or user research.

No gated Alexa developer preview, AWS SDK or paid cloud model was exercised during these observations. Do not convert this document into feedback claiming those products were tested.
