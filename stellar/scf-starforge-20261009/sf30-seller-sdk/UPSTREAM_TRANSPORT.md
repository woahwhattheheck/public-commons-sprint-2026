# Configure merchant upstream egress

The merchant can select a named outbound transport in the original upstream JSON. The same SF30 HTTP handler still prepares the backend request, enforces its deadline and body limits, retains supplier accounting, and returns the original response. The selected Node Agent supplies the connection.

Use this when the merchant host reaches a fixed HTTPS API through an existing HTTP CONNECT proxy. The buyer still purchases the signed merchant offer through the original Stellar components.

## Declare one profile and select it

Add `transports` beside `bindings` in the existing file, then put its name in each binding that uses it:

```json
{
  "schema": "stellar-forge.seller-upstreams.v1",
  "transports": {
    "merchantEgress": {
      "mode": "environment-proxy",
      "proxyEnv": "MERCHANT_HTTPS_PROXY"
    }
  },
  "bindings": {
    "dataset": {
      "origin": "https://api.example.com",
      "path": "/v1/dataset",
      "method": "GET",
      "query": ["region"],
      "headerEnv": {"authorization": "MERCHANT_API_AUTH"},
      "responseMode": "json",
      "transport": "merchantEgress"
    }
  }
}
```

This is a configuration example. Replace the API origin, operation and environment names with the merchant's approved values. Keep the original handler name, method and route contract aligned with the seller configuration.

The profile contains an environment-variable **name**. Set that variable on the private merchant host using its existing deployment or secret configuration. Its value is the selected HTTP or HTTPS proxy URL, including proxy authentication only when that host requires it. The JSON, release review and snapshots retain the variable name; they do not expand the value.

A profile name has 1–64 letters, digits, underscores or hyphens, starting with a letter. Up to 16 profiles may be declared. Each declared profile must be used by a binding. A binding can select one profile. Unknown profiles and unused declarations are rejected during review.

A binding without `transport` keeps its original direct connection and public-address DNS check. An explicitly named direct profile is:

```json
{"mode": "direct"}
```

A direct profile has no `proxyEnv`. Select it through the same binding field when the intended direct route needs to appear in the retained review.

## Launch requirements

Environment proxy profiles require **Node 22.21 or later in the 22.x series, Node 24.5 or later, or Node 25+**. A selected profile fails clearly on older Node before a request starts. The existing direct configuration keeps the original runtime requirements.

The selected variable must contain a valid `http://` or `https://` proxy URL with a hostname, optional port and optional user information. Its path is the root path; query strings, fragments and control characters are rejected. Errors name the environment reference and never include its value.

Only the selected variable is passed to the per-profile Agent as `HTTPS_PROXY`. Other ambient `https_proxy`, `HTTP_PROXY`, `ALL_PROXY` and `NO_PROXY` settings do not override this explicit selection. There is no process-wide Agent replacement or environment mutation.

The upstream target remains the original fixed public HTTPS hostname on port 443. Redirects, request paths, query mappings, body handling, allowed headers and response validation stay with the original handler. HTTPS certificate and hostname checks remain enabled. The explicitly selected proxy resolves the target hostname and is trusted for that routing; the direct connection's local public-address DNS callback is not applied to the proxy's own hostname.

For an OAuth client-credentials binding, the token endpoint must also use HTTPS. The original token request uses that binding's selected Agent, preserves token validation and caching, and keeps its existing deadline. Bindings with different profiles have separate token-provider pools even if their other OAuth settings match.

## Check the original seller

Supply the private variables through the same environment used for the eventual merchant process, then use the original launcher:

```sh
node sf30-seller-sdk/upstream-serve.mjs \
  --config /private/merchant/seller.json \
  --upstreams /private/merchant/upstreams.json \
  --check
```

The check compiles the original seller offers and bindings, validates the selected host configuration, and reports `upstreamTransports` containing binding names and normalized profile references. It does not send a provider request or start a listener.

Launch with the same inputs and the existing facilitator configuration:

```sh
node sf30-seller-sdk/upstream-serve.mjs \
  --config /private/merchant/seller.json \
  --upstreams /private/merchant/upstreams.json \
  --facilitator https://facilitator.example
```

Use the merchant's actual authorized facilitator URL. Payment, verification and settlement remain with the original seller service and canonical components. A transport profile neither authorizes a purchase nor changes the offer.

## Retain, review and activate through SF82

The original release workflow accepts the complete upstream file:

```sh
node sf82-seller-pilot/release-cli.mjs stage \
  --store /private/merchant/releases --id api-egress-v1 \
  --spec /private/merchant/facade-openapi.json \
  --config /private/merchant/selections.json \
  --bindings /private/merchant/route-bindings.json \
  --upstreams /private/merchant/upstreams.json
node sf82-seller-pilot/release-cli.mjs inspect \
  --store /private/merchant/releases --id api-egress-v1
```

Staging keeps the exact upstream bytes in the original content-addressed release input. Its pure review validates the profile syntax and records the environment references without reading environment values or constructing a connection.

Each route's upstream review includes its selected normalized `transport`. Its configuration hash covers both that binding and the selected profile definition, so changing a profile's mode or environment reference under the same name is visible in the original release diff. Existing bindings with no profile keep their previous configuration hash.

Use the existing release console to compare the previous and proposed releases, activate the reviewed generation, run or restart the original merchant, and roll back when required:

```sh
node sf82-seller-pilot/release-cli.mjs diff \
  --store /private/merchant/releases --from api-egress-v1 --to api-egress-v2
node sf82-seller-pilot/release-cli.mjs console \
  --store /private/merchant/releases --port 8424
```

The console's upstream field review displays this same projection. Reopening the retained store verifies the original file hash and regenerates the profile review. A later edit to the input file does not alter an already staged release.

Proxy secret rotation follows the merchant's existing environment lifecycle. The new process captures the current private value at launch; the old process keeps its existing Agent until it drains. To change the environment reference or profile mode, stage and review a new release. The release retains configuration identity; it does not store historical proxy secrets.

## Use from an existing application

```js
import {
  createUpstreamHandlers,
  closeUpstreamHandlers,
} from './sf30-seller-sdk/upstream.mjs';

const handlers = createUpstreamHandlers(upstreamConfig, {
  env: merchantEnvironment,
});

// Give these original handlers to the existing seller service.
// Stop accepting seller requests and drain that service before:
await closeUpstreamHandlers(handlers);
```

For `createUpstreamApplication`, use its existing `close()`. The original launcher and release runtime already connect the seller's drain lifecycle to this close.

Selected handlers refuse new calls after close begins. Accepted buffered requests and original stream completion promises remain owned until completion; only then are token providers, cache/idempotency/supplier state and the selected Agents closed. SSE and NDJSON consumers must finish or close the original stream source, as required by the original streaming contract. Closing does not replay a request or create an automatic provider probe.

The factory creates one Agent per selected proxy profile and destroys only those Agents. Trusted applications that already pass their own Agent directly to the original low-level handler retain its existing ownership contract.

## References

- [Original upstream configuration](UPSTREAM.md)
- [Original OAuth client credentials](OAUTH.md)
- [Original SF82 release operator](../sf82-seller-pilot/RELEASES.md)
- [Node HTTP Agent proxy configuration](https://nodejs.org/api/http.html#new-agentoptions)
- [Node enterprise network configuration](https://nodejs.org/learn/http/enterprise-network-configuration)
