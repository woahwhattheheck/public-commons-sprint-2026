# SF-25 PaymentPayload auto-catalog adapter

This module implements the x402 Bazaar zero-registration path: after a trusted
facilitator hook reports an authenticated settlement, it extracts the v2
`PaymentPayload.resource`, `accepted`, and `extensions.bazaar` fields, validates
`info` against the supplied Draft 2020-12 schema, binds the echoed terms to the
settlement facts, and calls the merged SF-46 atomic catalog coordinator.

Source pins:

- `x402-foundation/x402@7f2b2f1f77fa5317615735e3378a6fad41cccb4e`
- `specs/extensions/bazaar.md` blob `442708e76d5a129e0c1393471d8ed71e3604c94e`
- TypeScript facilitator extractor blob `083013ee19544e182c2e3185d7853309c34b9d9c`

Run the focused checks:

```sh
node --test stellar-forge/payment-auto-catalog/auto-catalog.test.mjs \
  stellar-forge/product-integration/atomic-catalog.test.mjs
```

The dependency-free validator supports the bounded structural subset used by
the canonical HTTP/MCP examples: local JSON Pointer `$ref`, `$defs`, object and
array structure, required/properties/additionalProperties, primitive types,
const/enum, allOf/anyOf/oneOf, and basic length/range limits. External refs and
unknown assertion keywords fail closed rather than causing network or file
resolution. Broader Draft 2020-12 schemas must use the pinned upstream Ajv
validator before calling this adapter; unsupported schemas are soft-dropped.

## Trust boundary

The adapter does not verify signatures, Soroban authorization, transaction
finality, or the receipt hash itself. `settlement` is a typed handoff from the
canonical facilitator after those checks. A test fixture saying `settled` is
software behavior evidence only—not a real payment or network receipt. No
unauthenticated registration endpoint is exposed.
