# Explicit merchant proxy transport

SF88 can use the operator's explicitly selected HTTP CONNECT proxy when a
managed host provides HTTPS egress through that proxy. This is the original
SF31 HTTPS request, carried by the original SF85 single-use tunnel helper.
SF81 approval, SF36 reservations, the native signer, the payment retry, and SF82
outcomes retain their existing authority.

The default remains direct public HTTPS with checked and pinned OS DNS. The
buyer does not discover or select a proxy automatically. The operator must
choose a fixed endpoint or explicitly name one environment variable; merchant
offers, catalogs, and request headers never make that choice.

## Initialize a private workspace

From the repository root, select the proxy source and pass the existing
offline-reviewed operation to the original initializer:

```sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/cli.mjs \
  --init-workspace \
  --config /absolute/review.json \
  --dir /absolute/new-workspace \
  --actor operator-id --service seller-id \
  --payer G... --python /usr/bin/python3 \
  --rpc https://soroban-rpc.testnet.stellar.gateway.fm \
  --https-proxy-env HTTPS_PROXY
```

Use the actual payer and the operator's chosen proxy environment name. For a
stable endpoint, use `--https-proxy http://127.0.0.1:8080` instead. Managed clouds
may assign a new local proxy port to every command, so a saved workspace must
name the supplied variable rather than persist one command's temporary port.
The initializer derives the allowed origin from `operation.url`, validates the profile before
creating the workspace, and saves it in both the private operator config and
the workspace manifest. The existing `--rpc` option controls the native signer
RPC separately; the merchant proxy setting does not replace SDK RPC transport.

For an existing trusted input, the equivalent optional top-level field is:

```json
{
  "buyerTransport": {
    "mode": "explicit-connect",
    "origin": "https://merchant.example",
    "proxyEnv": "HTTPS_PROXY"
  }
}
```

The origin must be a canonical HTTPS origin on port 443, with a public-looking
DNS hostname and no path, trailing slash, query, fragment, or credentials. It
must exactly match the operation's origin. Proxy URLs allow HTTP host and port
only; credentials, additional paths, queries, and fragments are refused. Use
exactly one of `proxyEnv` and `proxyUrl`. A named variable is resolved only at
execution; missing, malformed, or credential-bearing values fail before the
inbox attempt marker. Review shows the selected name, never its value.
Diagnostics can validate that value locally without printing it or connecting.
Do not combine a source profile with either initializer proxy flag.

Review the same private workspace, then select one original operation:

```sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/cli.mjs \
  --review-workspace --dir /absolute/new-workspace

node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/cli.mjs \
  --execute-workspace --dir /absolute/new-workspace
```

Execution still requires the configured native wallet environment or trusted
provider and the original terminal approval. Review and diagnostics show the
validated transport without opening wallet secrets or making network calls.

## Durable inbox

Enqueue the generated `operator.json` directly using the existing inbox CLI.
The original immutable config snapshot includes `buyerTransport`; no separate
transport file or regenerated payment config is needed.

```sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/queue-cli.mjs \
  enqueue --root /absolute/inbox --config /absolute/new-workspace/operator.json

node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/queue-cli.mjs \
  execute --root /absolute/inbox --intent stable-id \
  --workspace /absolute/new-workspace
```

Workspace selection compares the original queued transport with the selected
workspace in addition to the existing operator, payer, signer, and budget
bindings. A mismatch leaves the request queued and creates no attempt marker.
Changing the workspace's profile after initialization is also rejected. Default
workspaces and requests continue to use the original direct transport.

## Connection behavior

Each SF31 fetch uses one new CONNECT tunnel to the pinned merchant origin. The
explicit proxy resolves that hostname when local DNS is unavailable. This
mode therefore trusts the selected proxy for DNS resolution and routing; it
does not claim to have inspected remote DNS answers. No synthetic local IP or
overlay address is supplied. IP literals and private hostname forms remain
refused, and another origin is rejected before opening a connection.

TLS remains end-to-end to the original merchant hostname with CA and hostname
verification, SNI, and a TLS 1.2 minimum. The original HTTP method, exact resource
path, headers, request body, response stream, identity encoding, body deadline,
abort behavior, and response writer remain in SF31. The proxy sees the CONNECT
authority; application headers and payment payload stay inside TLS. Redirects,
implicit proxy selection, credential forwarding to the proxy, connection
reuse, and automatic operation replay are not enabled.

Embedding code can pass the same validated profile through the existing
trusted factory seam:

```js
const fetchImpl = createPublicHttpsFetch({trustedProxy: profile});
const buyer = new OperatorApprovedBuyer({operator, fetchImpl});
```

Merchant data must never populate this trusted configuration automatically.
