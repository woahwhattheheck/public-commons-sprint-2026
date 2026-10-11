# SF85 · Real merchant HTTP 402 capture → existing SF84 dual-rail inspector

**The operating gap:** SF84 can parse actual x402 v2 and Stellar MPP Charge/Session 402 response headers, but its input previously required a person to hand-assemble a raw-header JSON file. SF85 captures that original server response once, preserving repeated challenge headers as pairs and using SF84's already-shipped parser. This turns a merchant-approved URL into a private, source-bound technical intake without attempting any transfer or touching a wallet.

## One explicit HTTPS capture

With the merchant's permission, choose a public HTTPS resource that is expected to issue an unpaid 402 challenge. Review the exact **target URL**, method and **origin** before execution. Do not include access tokens, payment signatures or secrets in URLs; credential-looking query keys are rejected. Create an operator-private directory first (e.g. `mkdir -m 700 /private/scf85`) and run:

```sh
node stellar/scf-starforge-20261009/sf85-live-402-capture/capture.mjs \
  --url 'https://merchant.example/price?region=us' \
  --allow-origin 'https://merchant.example' \
  --method GET --timeout-ms 8000 \
  --out '/private/scf85/merchant-20261011.json'
```

The example domain is **not** a real capture; replace both URL and approved origin with a real, independently authorized merchant route. The program makes exactly **one** HTTPS GET or HEAD, accepts only public IPv4 DNS answers, pins that address to its TLS-verified original hostname, refuses redirects and nondefault ports, sends no credentials, reads no response body, and never retries or follows a 3xx. No localhost, private-network IP, RFC test ranges or mixed public/internal DNS. IPv6-only merchants require a different approved capture path; this restricted collector fails closed. Recognized credential-bearing URL query fields are rejected *before DNS/network access or writing a capture*, including normalized variants such as `apiKey`, `client_secret`, `access_token`, `refresh-token`, `SESSION_ID`, `x-signature`, signed-URL parameters, and JWT-shaped query values; ordinary public selectors such as `?region=us` still work. This is a defensive filter, **not** an exhaustive credential detector: operators must still avoid all secrets, signed links and private bearer material in the URL path and every query value, including parameters with harmless-looking names.

The original source JSON is written with mode `0600`, exclusive create (will not overwrite previous evidence), including UTC capture time, exact URL/method/status and only original `PAYMENT-REQUIRED` / `WWW-Authenticate` header fields. All raw challenge payloads stay in the operator's private file, **not** committed to GitHub or pasted into Slack. Stdout is a shortened SF84 result: byte SHA-256, 402 classification, protocol status, counts, review notes. A non-402 response is recorded truthfully rather than masquerading as a paid merchant. An unavailable route or invalid/oversized challenge fails without creating a source file.

For the complete existing diagnosis, run:

```sh
node stellar/scf-starforge-20261009/sf84-mpp-market-intake/inspect.mjs \
  '/private/scf85/merchant-20261011.json'
```

\n## Managed-cloud benchmark gateway, explicit opt-in\n\nIf a logged-in managed cloud runner maps an independently approved **public** merchant origin to its reserved 198.18.0.0/15 HTTPS gateway (for example, Muse's Oct 11 exact DNS result `198.18.126.99` for `x402.albylabs.com`), the default command will still refuse it. To attempt the **same original** capture over that runner's OS-managed transport, the operator may explicitly add `--egress-gateway-ip 198.18.126.99` to the exact command above. This is **not** an arbitrary IP override or general private-subnet permission: the opt-in address must be in 198.18/15, the runner's DNS must return exactly that *one* IPv4 answer for the original hostname, and HTTPS still verifies the original host's TLS certificate/SNI. No redirects, body reads, credentials, signing or additional requests. Mixed DNS answers, RFC1918/loopback targets, unapproved origins, and mismatched gateway addresses remain rejected.\n\nThis mode should be used only on an operator-approved managed cloud runner where the operator knows that particular DNS answer is its egress gateway; do not turn it on merely to bypass a real endpoint's private DNS answer. If the runner cannot actually establish the original hostname-verified TLS session via its gateway, the command fails without saving a capture. For the focused, offline transport-boundary check run `node stellar/scf-starforge-20261009/sf85-live-402-capture/gateway-acceptance.mjs`.\n
## Move to commercial acceptance

Use the actual source capture, original merchant authorization and owner acceptance process. x402 v2 merchant offers may proceed to the existing SF31/SF81 buyer and SF70/SF74/SF77 merchant support/workorder *only through those modules' actual constraints*. The same HTTP status **does not** mean the existing x402 buyer supports MPP; Charge/Session require a separate official Stellar MPP integration. A GET/HEAD challenge is not a POST/MCP paid-delivery result. Never combine price, recipient, asset, amount or resource fields from two protocol alternatives.

This acquisition is intentionally read-only, with no merchant settlement, no charge, no receipt, no grant submission, no quote, no customer acceptance and no deployed payment service. `capturedSha256` identifies local evidence bytes, not issuer authenticity. Only original permissioned source + a separately approved commercial proposal can convert a prospect into a pilot. Original intake: [SF84](../sf84-mpp-market-intake/README.md). Original merchant workorder: [SF77](../sf77-merchant-workorder/README.md).

**One important boundary:** Native Node's `rawHeaders` preserves repeated challenge fields as delivered to Node's HTTP parser, not the full TCP/TLS packet bytes. If independent signed wire custody is required, capture it separately on the merchant-approved host. This tool never reads a response body. No GitHub Actions or hosted CI are registered.