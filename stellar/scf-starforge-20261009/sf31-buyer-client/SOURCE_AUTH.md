# Authenticated upstream sources

This capability connects the existing SF31 HTTPS transport to an operator's assigned upstream Bearer credential. Its initial consumer is the original STAC catalog and asset provider used by the eoAPI onboarding workspace. The original STAC Auth Proxy remains responsible for validating the token and enforcing its configured route, scope and record policy.

Public source requests continue to use the original unauthenticated transport. Payment authorization stays with the existing buyer and approval lifecycle. Configuring source access does not create an account, acquire a token, change provider permissions, approve a payment, or enable another origin.

## Configure the private source runtime

The application operator supplies explicit bindings to the server process. Keep this configuration with the installed operator's private runtime, separate from catalog records, selected editions, customer source archives and portable policy packages.

```js
import { createSourceBearerAuth } from './source-auth.mjs';

const sourceAuth = createSourceBearerAuth({
  bindings: [{
    origin: 'https://stac.your-approved-domain.example',
    tokenEnv: 'CUSTOMER_STAC_BEARER'
  }],
  timeoutMs: 30_000
});
```

Replace the example origin with the customer's actual reviewed HTTPS origin and configure the named environment value through the existing private deployment mechanism. No secret value belongs in the JSON configuration, command-line arguments, work logs or source code. The origin must be exact: HTTPS, a public-style DNS hostname, port 443, no credentials, path, query, fragment or trailing slash. The transport still verifies the actual current DNS answers at connection time, or uses the separately approved original explicit CONNECT profile.

The binding selects exactly one credential source. An environment binding reads only that named variable. For existing assigned credential custody, use a reference and the original resolver:

```js
const sourceAuth = createSourceBearerAuth({
  bindings: [{
    origin: configuredSourceOrigin,
    credentialRef: assignedPrivateCredentialReference
  }],
  resolveCredential: async (reference, {url, origin, method, signal}) =>
    existingCredentialClient.resolve(reference, {url, origin, method, signal})
});
```

The reference is an opaque operator-selected custody identifier, with 1–512 characters drawn from letters, numbers, period, underscore, colon, slash, at-sign and hyphen, beginning with a letter or number. It is not a token value. The callback returns the actual native Bearer token string. This module does not acquire, refresh, exchange or broaden credentials on its own; the existing configured resolver may manage its assigned token lifecycle.

At most 64 exact origins can be configured; duplicates are rejected. Values are read afresh for each outgoing request, so replacing an environment token or rotating the resolver's assigned credential affects the next dispatch. Tokens are never cached in source records. Use distinct credential references for origins with different audience or access requirements.

## Join the existing source adapter

The two returned methods supply separate pieces of the maintained adapter's request path:

```js
import { createPublicHttpsFetch } from './public-transport.mjs';

const fetches = new Map();
function fetchFor(url) {
  const origin = new URL(url).origin;
  if (!fetches.has(origin)) {
    fetches.set(origin, createPublicHttpsFetch({
      timeoutMs: 120_000,
      sourceAuthorization: sourceAuth.authorizationForOrigin(origin)
      // Add the original trustedProxy profile here when explicitly configured
      // for this same source origin. Its existing fields are unchanged.
    }));
  }
  return fetches.get(origin);
}

async function sourceRequest(selected, signal) {
  // The existing adapter retains selected request metadata before this point.
  const privateHeaders = await sourceAuth.requestHeaders({
    url: selected.url, method: selected.method ?? 'GET', signal
  });
  const headers = new Headers(selected.headers);
  for (const [name, value] of Object.entries(privateHeaders))
    headers.set(name, value);
  return fetchFor(selected.url)(selected.url, {
    method: selected.method ?? 'GET',
    redirect: 'manual', headers, signal,
    ...(selected.body === undefined ? {} : {body: JSON.stringify(selected.body)})
  });
}
```

The STAC onboarding owner supplies these methods to its original requestHeaders and per-origin transport seams. Keep its existing captureJson, downloadAsset, workspace, merchant and 8910's receiving methods; no alternate acquisition engine is needed. The original request metadata is retained before private headers are added. Never add the merged headers or the private binding configuration to that retained request, error record or export.

Before calling requestHeaders, preserve the original adapter's URL, pagination, asset review and source allow-list checks. Before opening any socket, the SF31 instance checks its exact source origin, supported method/body, framing, DNS and TLS. A source-enabled transport refuses any different origin even for an otherwise unauthenticated request. Its own exact CONNECT proxy origin, if configured, must agree with the source origin.

A source link does not grant credential authority. For an unbound origin, requestHeaders returns an empty object and authorizationForOrigin returns null. That asset or request may use the unchanged public transport. A private asset hosted at another origin needs its own explicit operator binding and assigned token. The same catalog credential is never forwarded automatically.

## Request behavior and recovery

Only Bearer source Authorization is permitted by this capability. Scheme matching is case-insensitive; the token itself is used exactly, without trimming, decoding or JSON coercion. The supported native token form follows the Bearer token alphabet and is limited to 16 KiB. Duplicate/comma-joined Authorization values, whitespace-bearing values and other authentication schemes fail before dispatch.

The original transport returns redirects; it never follows them. A caller must review and select any new destination through its original workflow. Each resulting request resolves its own origin binding. Neither a redirect nor a pagination or asset link can expand the approved origins.

There is one original HTTP request per fetch invocation, with no automatic reconnect, retry, credential exchange or response-status retry. An actual 401 and its WWW-Authenticate header remain the provider's response. Correct the assigned token or deployment in the original operator workflow before a deliberate new read; a 403 can represent scope or record/route policy denial and does not authorize a broader token. Existing source request/response status and retained source version remain the restart authority.

For STAC Auth Proxy specifically, the current original middleware reads Authorization: Bearer, verifies RS256 against its configured discovery/JWKS source and uses ALLOWED_JWT_AUDIENCES. It does not pass an explicit issuer argument in the inspected validation call; this transport does not claim to add server-side issuer validation. Keep the provider's actual deployment/version and approved OIDC configuration in the separate policy workflow. Multiple required route scopes are ANDed, and record rules may apply to searches, individual resources and transactions.

Credential resolution has its own 1–300,000 ms deadline, default 30,000 ms, and uses the caller's AbortSignal when supplied. Its resolver receives a combined cancellation/deadline signal. Every resolver exception is reduced to a stable credential-free error; no provider error message, cause or returned value is copied into the public error. The transport's separately configured deadline then covers DNS, TLS, response and downstream body consumption. These are per-stage deadlines, not a claimed single wall-clock budget.

On workspace shutdown, call sourceAuth.close() alongside the original request cancellation and transport/body cleanup. close prevents new credential lookup and aborts pending resolutions. It does not independently cancel a response stream whose token has already been returned; the owning request/response lifecycle continues to own that stream.

```js
try {
  await runOriginalSourceWorkflow();
} finally {
  sourceAuth.close();
  await closeOriginalWorkspaceAndRequests();
}
```

A newly opened operator runtime reinstalls its explicit private bindings. A portable catalog/source/policy package contains no token or credential reference configuration and cannot turn on authenticated access at the receiver. The receiving operator configures its own assigned private references, then reopens the same retained source/selection workflow. Already acquired permitted files remain usable through the existing offline receiving contract.

## Stable failure codes

| Code | Operator meaning |
| --- | --- |
| SOURCE_AUTH_BINDINGS_REQUIRED | Configure 1–64 explicit source bindings. |
| SOURCE_AUTH_DUPLICATE_ORIGIN | Choose one credential source for each exact origin. |
| SOURCE_AUTH_CREDENTIAL_RESOLVER_REQUIRED | The selected custody reference needs its original resolver. |
| SOURCE_AUTH_CREDENTIAL_UNAVAILABLE | The named environment value or resolver result is absent. |
| SOURCE_AUTH_CREDENTIAL_INVALID | The assigned value is not a supported native Bearer token. |
| SOURCE_AUTH_CREDENTIAL_RESOLUTION_FAILED | The private resolver failed; inspect its own private operational channel. |
| SOURCE_AUTH_RESOLUTION_TIMEOUT | Credential resolution exceeded its configured deadline. |
| SOURCE_AUTH_ABORTED / SOURCE_AUTH_CLOSED | The operation or source runtime was closed. |
| SOURCE_AUTHORIZATION_ORIGIN_MISMATCH | The request does not match this source-enabled transport. |
| SOURCE_AUTHORIZATION_PROXY_ORIGIN_MISMATCH | Source and explicit proxy profiles target different origins. |
| SOURCE_AND_PAYMENT_AUTHORIZATION_CONFLICT | Keep the source transport and original payment transport distinct. |
| FORBIDDEN_TRANSPORT_HEADER | A supplied header violates the original transport or selected auth scheme. |

Original public transport errors and response-body handling remain documented in PUBLIC_TRANSPORT.md. Source ownership, licenses and collection permissions remain in the original source and policy review.

## Source references

- STAC Auth Proxy configuration: https://developmentseed.org/stac-auth-proxy/user-guide/configuration/
- Original authentication middleware: https://developmentseed.org/stac-auth-proxy/reference/stac_auth_proxy/middleware/EnforceAuthMiddleware/
- Route authorization: https://developmentseed.org/stac-auth-proxy/user-guide/route-level-auth/
- Record authorization: https://developmentseed.org/stac-auth-proxy/user-guide/record-level-auth/
- Bearer token request syntax, RFC 6750 §2.1: https://www.rfc-editor.org/rfc/rfc6750#section-2.1

MIT, consistent with the original SF31 transport.
