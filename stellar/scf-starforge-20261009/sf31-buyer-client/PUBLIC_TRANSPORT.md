# SF31 public HTTPS deployment entrypoint

This adds an operational Node 22+ transport to the **existing** SF31 buyer. It closes the documented resolve/connect gap: a seller-controlled public hostname cannot pass a name-only check and then connect to a private DNS answer. No package install, wallet, new signer, payment controller, hosted service, or GitHub Action is required.

## Use the existing buyer with the new transport

```js
import { createPublicBuyer } from './public-buyer.mjs';
const buyer = createPublicBuyer({timeoutMs: 30_000});
const page = await buyer.discover({origin: process.env.APPROVED_CATALOG_ORIGIN});
// buyer.call(...) keeps SF31's existing expect, approve, sign and intentId API.
// Choose the actual advertised HTTP method and obtain genuine operator consent.
```

Use the factory instead of `new X402BuyerClient()` in your production bootstrap. This is an additive entrypoint: the original buyer constructor and every existing caller are **not silently migrated**. Existing loopback development callers remain unchanged. The factory accepts only `timeoutMs` (1–300,000 milliseconds); it does not expose local-network, socket, certificate, proxy, or resolver overrides.

## What the transport actually does

Each unsigned request, each discovery page, and the one independently approved signed retry gets a fresh all-address OS DNS lookup. Every returned address must pass the same conservative public-unicast policy; a mixed public/private answer fails before any socket. The selected address is copied into a connection-specific lookup callback. That callback never consults DNS again. `agent:false`, fixed address family, and disabled family autoselection prevent pool reuse or a second-address fallback. There is no automatic HTTP retry.

The original hostname remains the HTTP Host and TLS SNI/certificate identity. TLS verification is explicitly enabled, with Node's original `checkServerIdentity` and TLS 1.2 minimum. This transport implements the fetch subset SF31 consumes, not the full browser Fetch API. It supports HTTPS **port 443 only**, replayable string/Uint8Array bodies up to 16 MiB, original response status and payment headers, aborts, and a streaming body with a 64 KiB queue budget. Caller overrides of Host, cookies, framing, proxy or encoding headers are rejected. Authentication is rejected by default; the existing explicit Payment capability and the separate exact-origin source Bearer capability are documented below. `PAYMENT-SIGNATURE` is preserved for SF31's approved retry; passing it to the lower-level transport directly does not itself establish permission to spend.

The deadline covers DNS, connection and incomplete response transfer. Cancellation of the Web response body destroys its Node input stream/socket. Consume or cancel returned bodies. Discovery still uses SF31's existing **256 KiB actual-byte limit**, including its early Content-Length fence. No delivered response is automatically read into an unbounded buffer by this transport. Identity encoding is requested; compressed responses from servers ignoring that request fail explicitly with `UNSUPPORTED_CONTENT_ENCODING` rather than yielding differently decoded bytes. Redirects are returned, never followed; SF31 then applies its existing redirect-denial semantics.

## Address policy and operational limits

IPv4 rejects private, loopback, link-local/metadata, shared carrier space, documentation, benchmarking, multicast, reserved and selected special-purpose ranges. IPv6 accepts only `2000::/3`, excluding the broad `2001::/23` protocol block, documentation prefixes and 6to4. Mapped IPv4, NAT64, scoped addresses, ULA, link-local and multicast are therefore excluded. This deliberately also rejects some globally reachable **special-purpose exceptions** (for example `192.0.0.9`); it is not a complete implementation of IANA's globally-reachable column. Revisit the source range policy as allocations change.

The selected public address need not be reachable, and public-IP status is not proof of seller ownership or payment finality. The operating system, CA store, resolver and network route configuration remain trusted. Networks that internally route globally numbered addresses still need an egress firewall or an approved-service allowlist. No application module can establish that arbitrary public endpoints are honest merchants. There are no configurable proxies and no direct secret/certificate logging. The low-level `createPublicHttpsFetch` constructor has explicitly trusted `lookup` and `requestImpl` injection seams used only by the focused local test; do not expose these as request input. The production buyer factory intentionally hides them.

Errors have stable `code` values including `NONPUBLIC_DNS_ANSWER`, `UNSAFE_RESOURCE_HOST`, `PUBLIC_HTTPS_TIMEOUT`, `PUBLIC_HTTPS_PORT_REQUIRED`, `FORBIDDEN_TRANSPORT_HEADER` and `UNSUPPORTED_CONTENT_ENCODING`. SF31 wraps transport failures in its existing `BuyerError` and preserves the underlying error as `cause`. A failure on the signed leg remains `PAYMENT_OUTCOME_UNKNOWN` with `paymentSent:true`, conservatively; never automatically pay again based on a transport error.

## Focused source-native execution

```sh
node --test stellar/scf-starforge-20261009/sf31-buyer-client/test/public-transport.test.mjs
```

This runs **two grouped tests**, not a repository-wide suite. Node 22 and the standard OpenSSL executable are sufficient. The test creates a temporary self-signed test certificate, starts a real loopback HTTPS server, checks the production pin/options, and uses a trusted socket-remapping seam to exercise the unchanged SF31 buyer without connecting to a public IP. It verifies native `items` discovery, the unsigned/approved single-retry POST and identical body, original pending-receipt interpretation, Host/SNI preservation, rejection of a mismatched TLS hostname before HTTP, private/mixed DNS rejection before any connection, redirect non-following, byte-cap cancellation, stalled DNS/body deadlines and explicit body cancellation. No private test key is committed; temporary keys are removed.

The local buyer copy executed on 2026-10-11 matched original Git blob `ebf100349c30cb722151c5c93a94869ddcd286d6` byte-for-byte. Two tests passed on Node 22.16.0 in the ChatGPT Linux container. The supplied payment envelope and DNS answers are **local integration fixtures**, not a real signature, Stellar transaction, merchant acceptance or provider capture. Live acceptance uses the production factory with default OS DNS/TLS against the existing approved Vellar/Periplo discovery origins; compare native resources, payment alternatives and pagination with the same source capture. No seller or paid route is required for that read-only acceptance.

## Primary references

- Node HTTPS request / TLS options: https://nodejs.org/docs/latest-v22.x/api/https.html#httpsrequestoptions-callback
- Node TLS certificate identity: https://nodejs.org/docs/latest-v22.x/api/tls.html#tlscheckserveridentityhostname-cert
- Node BlockList and custom lookup: https://nodejs.org/docs/latest-v22.x/api/net.html
- IANA IPv4 special-purpose registry: https://www.iana.org/assignments/iana-ipv4-special-registry
- IANA IPv6 special-purpose registry: https://www.iana.org/assignments/iana-ipv6-special-registry
- IANA IPv6 unicast allocation registry: https://www.iana.org/assignments/ipv6-unicast-address-assignments

MIT, matching the original SF31 source. No workflow files, paid runs, grant submission or customer contact are part of this change.

## Operator-configured source authentication

The separate [source-auth workflow](SOURCE_AUTH.md) lets an upstream source adapter use an assigned Bearer credential at one exact approved HTTPS origin. It is configured by the operator in the private runtime; no catalog link, purchased request, source response or portable edition can enable it. The original public factory remains unauthenticated by default. Source authentication and payment authorization cannot be enabled in one transport instance.

Use createPublicHttpsFetch({sourceAuthorization:{origin,scheme:'Bearer'}}) only alongside the operator-owned source credential resolver described in that guide. The instance refuses every different origin before dispatch, never follows redirects, and preserves the original DNS/TLS/body/timeout checks. An unbound asset origin uses the original unauthenticated transport or its own independently assigned source binding.
