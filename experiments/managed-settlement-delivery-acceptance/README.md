# Managed settlement delivery receiving

This single original receiving operation uses the public Python merchant example, native x402 SDK, original SF82 fleet stores, SF98 destination engine, SF101 fulfillment receiver and merchant accounting workspace.

Run from one selected product source after installing its original production runtime through the maintained merchant distribution. Preserve the same output directory on continuation.

```sh
SF98_DELIVERY_SOURCE=/absolute/selected/source \
SF98_DELIVERY_OUTPUT=/private/managed-delivery-receiving \
SF98_DELIVERY_PYTHON=/absolute/python3 \
SF98_DELIVERY_NODE_MODULES=/absolute/existing/node_modules \
SF98_DELIVERY_CHROMIUM=/absolute/existing/chromium \
node experiments/managed-settlement-delivery-acceptance/journey.mjs all
```

The selected product is b37adf4292b0a424fe14da153ae88e5815a492f1. The operation ID is SCF-MANAGED-SF98-DELIVERY-E49D-20261012. The driver generates its own private signing and claim values in its output directory; the published source includes no account credentials or customer input.

The native phase serves and settles original Python requests with the existing local facilitator fixture, journals the original SF98 events, and sends signed bytes through the original sender. Its transport adapter follows the original7E23 loopback receiving pattern, with HTTPS destination identities retained in the original configuration. It verifies independent accounting retry, actual SF101 file fulfillment, original accounting capture replay, upgrade, retirement and rollback.

The next phases open the actual fleet and destination applications, recover a committed transfer after a lost browser response, download and inspect its original archive, receive it through the original destination CLI, then reopen the same stores through authenticated MCP and the foreground fleet command API. Source relocation uses each retained input's exact file hashes. The completed transfer remains readable when the closed live journal is temporarily unavailable.

Browser and native handles close between phases. The original SDK and local-facilitator responses are identified in the retained receipt. The receipt also retains original source hashes, exact output hashes, screenshots, state milestones and process closure. The three individual phase arguments are native, browser and mcp; all executes them sequentially and reuses completed milestones.
