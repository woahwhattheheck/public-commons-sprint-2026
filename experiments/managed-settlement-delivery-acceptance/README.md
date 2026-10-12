# Managed settlement delivery receiving

This single original receiving operation uses the public Python merchant example, native x402 SDK, original SF82 fleet stores, SF98 destination engine, SF101 fulfillment receiver and merchant accounting workspace.

Run from one selected product source after installing its original production runtime through the maintained merchant distribution. The source root uses the original native production profile with the mcp, schema and openapi features: x4022.28.0, Stellar SDK16.3.1, MCP SDK1.32.1, jose6.2.12, re2js2.8.6 and yaml2.9.1. Reuse a matching installed profile. SF98_DELIVERY_NODE_MODULES selects the existing Playwright module directory. Preserve the same output directory on continuation.

```sh
SF98_DELIVERY_SOURCE=/absolute/selected/source \
SF98_DELIVERY_OUTPUT=/private/managed-delivery-receiving \
SF98_DELIVERY_PYTHON=/absolute/python3 \
SF98_DELIVERY_NODE_MODULES=/absolute/existing/node_modules \
SF98_DELIVERY_CHROMIUM=/absolute/existing/chromium \
node experiments/managed-settlement-delivery-acceptance/journey.mjs all
```

The selected merged product is 5b8272877502a2d7831a9bdf58121a5b0fa6b8cb. It retains the complete managed delivery merge05aa019b6c0e79c5812947a779fae0230e48600c, the current source-owned fleet provider and the original customer cleanup retry. The operation ID is SCF-MANAGED-SF98-DELIVERY-E49D-20261012. The driver generates its own private signing and claim values in its output directory.

The fixture follows the original fleet contract with two separately declared Python merchants, four blue/green release stores and eight selected loopback ports. The primary merchant exercises the complete delivery lifecycle; the second merchant retains its own source and verifies that the primary merchant’s events remain isolated. Source relocation covers all three original input packages.

The native phase serves and settles original Python requests with the existing local facilitator fixture, journals the original SF98 events, and sends signed bytes through the original sender. Its transport adapter follows the original7E23 loopback receiving pattern, with HTTPS destination identities retained in the original configuration. It verifies independent accounting retry, actual SF101 file fulfillment, original accounting capture replay, upgrade, retirement and rollback.

The next phases open the actual fleet and destination applications, recover a committed transfer after a lost browser response, download and inspect its original archive, receive it through the original destination CLI, then reopen the same stores through authenticated MCP and the foreground fleet command API. Source relocation uses each retained input's exact file hashes. The completed transfer remains readable when the closed live journal is temporarily unavailable.

Browser and native handles close between phases. The original SDK and local-facilitator responses are identified in the retained receipt. The receipt also retains original source hashes, exact output hashes, screenshots, state milestones and process closure. The three individual phase arguments are native, browser and mcp; all executes them sequentially and reuses completed milestones.
