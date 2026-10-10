# Stellar x402 Bazaar discovery prototype

This is a public, read-only discovery library written in Node.js 22 or later. It is an experimental component, not a deployed Stellar payment facilitator or grant application.

The two HTTP routes are GET /discovery/resources and GET /discovery/search. A trusted integration can insert catalog records with BazaarCatalog.insertValidated after independently validating settlement, seller identity and metadata against the authoritative x402 specification. This library does not perform those validations.

Run the focused local checks with `node --test test/catalog.test.mjs`. The package has no external runtime dependencies. Six tests cover filtering, search pagination, HTTP responses, route normalization, MCP identity and metadata handling.

The source and tests are licensed MIT. No GitHub Actions workflows are included.
