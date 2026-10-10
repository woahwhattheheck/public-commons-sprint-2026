# SF-22 integrated `/discovery/resources`

The existing PR451 handler now lists records in canonical catalog-key order,
instead of depending on insertion history. This makes official offset pagination
deterministic across equivalent process rebuilds.

The focused integration check runs the accepted product path end to end:

`PaymentPayload` → SF-25 validation → SF-46 atomic commit → PR451
`GET /discovery/resources`.

It covers the official `type`, `payTo`, `network`, `scheme`, `extensions`,
`limit`, and `offset` parameters; cross-rebuild ordering; empty ranges; invalid
pagination; the GET-only method fence; accepted correction; and retirement
removal from the live HTTP response.

```sh
node --test stellar-forge/discovery-resources/resources-api.test.mjs
```

All HTTP calls are loopback and all settlement inputs are explicit fixtures.
This is not a live Stellar resource census, real payment, seller identity proof,
or provider availability claim. Durable storage and multi-process synchronization
remain deployment work; the current accepted coordinator provides an atomic
in-process projection.
