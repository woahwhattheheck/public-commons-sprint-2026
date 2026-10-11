# OAuth-backed API merchants

The original SF30 upstream launcher can sell an existing API that authenticates with OAuth 2 client credentials. Configure the merchant's token endpoint and environment-variable **names** in the same `seller-upstreams.v1` file used by `upstream-serve.mjs`. Buyer payment verification, input/response contracts, durable POST operations, availability and settlement remain in their original implementations. No additional payment server or token daemon is needed.

## Configure and run

Start from `examples/upstreams-oauth.json`, which matches the `existingDataset` handler in `examples/upstream-service.json`. Replace the two `.example` origins, token path, backend path and scope with the merchant's actual registered values; retain the public seller route and payment configuration you already use. Provision `MERCHANT_CLIENT_ID` and `MERCHANT_CLIENT_SECRET` through your existing private environment/secret manager. Do not put their values, bearer tokens or callback URLs into JSON, Git, command arguments or operator logs.

From this directory, validate declarations without listening, obtaining a token or contacting the backend:

```sh
node upstream-serve.mjs --config examples/upstream-service.json \
  --upstreams examples/upstreams-oauth.json --check
```

Then start the original merchant:

```sh
node upstream-serve.mjs --config seller-service.json \
  --upstreams merchant-upstreams.json --port 8423 \
  --facilitator https://YOUR-EXISTING-FACILITATOR
```

The facilitator value above is a placeholder, not a supplied service. Omitting `--facilitator` deliberately retains the original challenge-only mode: unpaid HTTP 402 requests do not acquire a token or call the backend. The existing `operations/launch.mjs`, SF82 pilot and SF96 runtime still consume this same upstream JSON and returned session. This change does not add OAuth form fields to the SF61 OpenAPI editor; configure `oauth2` in the original private upstream JSON.

## Declaration

```json
"oauth2": {
  "tokenEndpoint": "https://identity.merchant.example/oauth/token",
  "clientIdEnv": "MERCHANT_CLIENT_ID",
  "clientSecretEnv": "MERCHANT_CLIENT_SECRET",
  "authMethod": "client_secret_basic",
  "scope": "dataset.read",
  "timeoutMs": 5000
}
```

`client_secret_basic` is the default; it form-encodes each credential before constructing Basic authentication. Set `client_secret_post` only for a provider configured to accept credentials in the form body. Requests use `grant_type=client_credentials`; there is no browser authorization, refresh-token grant, endpoint discovery or redirect following. These grant and authentication choices follow [RFC 6749 sections 2.3.1 and 4.4](https://www.rfc-editor.org/rfc/rfc6749.html#section-4.4). An optional `audience` is an explicitly configured provider extension, not inferred from a buyer request.

The endpoint must be canonical public HTTPS on port 443 without URL credentials, query or fragment. At connection time, every DNS answer must pass the existing SF31 public-address policy. The actual TLS socket uses the checked answer and original hostname verification. `--allow-loopback-upstream` enables **only** `http://127.0.0.1` development endpoints; it is not a private-network bypass for production.

`oauth2` owns `Authorization`. It cannot coexist with `headerEnv.authorization`, and buyer authorization/cookies are never forwarded. Other already supported server-owned header mappings may coexist. Token JSON must have a Bearer `token_type`, a valid bearer value, and a positive `expires_in`. An operator may explicitly set `defaultExpiresInSeconds` only when the provider documents an omitted expiry. Returned scopes, when present, must include the requested scopes. Tokens are sent in the authorization header as specified in [RFC 6750 section 2.1](https://www.rfc-editor.org/rfc/rfc6750.html#section-2.1).

| Option | Default | Behavior |
| --- | --- | --- |
| `timeoutMs` | 10000 | Token exchange deadline, 1–120000 ms. The binding's original deadline also covers credential wait and backend work together. |
| `refreshSkewMs` | 30000 | Early renewal margin; capped at 10% of the issued lifetime for short-lived tokens. |
| `failureCooldownMs` | 1000 | Shared retry suppression after a failed exchange; numeric provider Retry-After can extend it, at most 300000 ms. |
| `maxWaiters` | 256 | Maximum simultaneous waiters for one token exchange, configurable from 1 to 4096. |
| `defaultExpiresInSeconds` | None | Explicit provider-documented fallback only; otherwise missing expiry is rejected. |

Token bodies are limited to 64 KiB, response headers to 16 KiB, and bearer values to 8000 characters. Token endpoint response bodies, credential values and URLs are not returned in diagnostics.

## Renewal, rotation and replay

Identical normalized OAuth declarations share one lazy provider within an application. Concurrent calls wait for one exchange; idle applications perform no refresh or polling. Expiry uses monotonic elapsed time from the beginning of the exchange. A failed renewal does not authorize use of an old token. One caller's cancellation removes only that waiter; the last waiter aborts the underlying token request.

Embedding code may pass a mutable `env` object to `createUpstreamApplication(config, bindings, {env})`. The provider reads the referenced values on each invocation, retires a previous identity on change and rejects an in-flight token returned for a superseded identity. The CLI captures a launch-time environment snapshot: update the environment through the existing deployment/release process and restart the original merchant to rotate CLI credentials. No claim is made that changes in another shell mutate a running process.

An actual backend 401 invalidates only the exact bearer used by that attempt. A delayed 401 cannot invalidate a newer token. **The backend is never retried automatically**, including POST/PUT/PATCH/DELETE. The next independent request can obtain a replacement. A previously completed durable POST operation replays its recorded result without contacting either token endpoint or backend; original request-ticket and recovery rules remain unchanged.

## Read-cache composition

The existing opt-in GET/HEAD cache resolves OAuth **before** selecting cached content. Each source generation receives a fixed header snapshot. Its private identity includes the credential generation as well as the bearer, so even a secret rotation that produces the same bearer retires old application results. Missing credentials cannot retrieve previously cached content. Cached hits do not manufacture backend availability successes. Source response freshness, private/no-store directives and authenticated shared-cache restrictions remain governed by the original cache implementation.

Enable only for merchant results explicitly safe to share across buyers:

```json
"cache": { "shareAcrossBuyers": true, "ttlMs": 1000, "maxEntries": 128 }
```

This is not permission to cache buyer-specific results. Every buyer delivery still goes through the original payment lifecycle. Cache invalidation does not delete durable POST operations. Application shutdown drains original work and closes cache controllers, then clears token providers and closes original operation stores. A cache closing during renewal cancels its own waiter without cancelling another binding's shared renewal.

## Existing operator and release interfaces

`session.upstreamSnapshot()` and the original private operations endpoint expose a binding's `oauth2` state: `empty`, `refreshing`, `ready`, `cooldown` or `closed`; relative expiry/refresh/retry milliseconds; waiter counts; renewal/rotation/failure counts; and a sanitized `lastError`. They never expose client credentials, bearer values, endpoint URLs or private equality hashes. These are authentication diagnostics, not proof of payment or settlement.

`OAUTH_CREDENTIALS_UNAVAILABLE` means the referenced environment is missing or invalid. `OAUTH_TOKEN_REJECTED` means the provider rejected the request; check its registered authentication method, client, scope and audience. `OAUTH_SCOPE_INSUFFICIENT` or `OAUTH_EXPIRY_REQUIRED` requires correcting the provider contract. `OAUTH_DNS_REJECTED`, `OAUTH_UNAVAILABLE` and `OAUTH_TIMEOUT` distinguish transport policy/connection/deadline failures. `OAUTH_COOLDOWN` suppresses a repeat exchange until its reported delay ends. Errors before backend dispatch remain non-dispatched; uncertain mutations keep the original recovery semantics.

Release tooling can call pure `upstreamCredentialReferences(bindings)` from `upstream.mjs`. It returns sorted unique environment names for `headerEnv`, `oauth2.clientIdEnv`, `oauth2.clientSecretEnv` and `idempotency.keyEnv`, without reading their values, opening operation stores or making connections. Full configuration compilation remains a separate validation step. Low-level embeddings own `provider.close()`; composed applications use `application.close()` or the original returned session's `close()`.

Run `node oauth-journey.mjs` from this directory for one local acceptance using actual HTTP token/backend servers, the original seller challenge gate, original read cache and original durable operation store. It checks shared renewal, cancellation/deadlines, no automatic backend retry, 64-to-1 cached reads and POST replay across restart. It does not contact a provider account or perform a chain payment.
