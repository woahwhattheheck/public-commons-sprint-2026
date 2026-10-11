# SF85 · import original HTTP response headers from an operator machine

Use this path when the approved seller endpoint can be reached from an operator's existing logged-in workstation or browser environment, but the cloud VM's DNS/proxy cannot support SF85's original public-IP-pinned HTTPS collector.

This is an **alternate acquisition path**, not an alternate x402 parser, merchant simulator, payment client, or weaker version of the original live collector. It consumes a genuine HTTP response header dump captured by an authorized operator and feeds the unmodified SF84 dual-rail inspector. The original capture.mjs remains unchanged.

## 1. Capture one genuine unpaid response on the authorized network

Choose the merchant-approved **public HTTPS URL** and actual method. With that endpoint's operator's permission, run on their network-connected machine:

~~~sh
mkdir -p /private/scf85 && chmod 700 /private/scf85
curl --globoff --silent --show-error --max-time 8 \
  --request GET \
  --dump-header /private/scf85/merchant-original.headers \
  --output /dev/null \
  'https://merchant.example/price?region=us'
~~~

Replace the example domain with a real authorized endpoint. This example command is not evidence of a live capture. curl does not follow redirects unless explicitly instructed. Do not add credentials, cookies, signing material, tokens, auth headers, retry, redirect-following, or customer secrets. The merchant may return a non-402 response; retain it as such. For HEAD-only endpoints use a genuine HEAD request and import with --method HEAD. Keep the original headers private.

## 2. Import the original response without network access

Transfer the original header file through an approved private operator channel to a machine with the repository. Preserve the raw file. Use the original request's **exact** URL, origin and method:

~~~sh
node stellar/scf-starforge-20261009/sf85-live-402-capture/import-headers.mjs \
  --url 'https://merchant.example/price?region=us' \
  --allow-origin 'https://merchant.example' \
  --method GET \
  --headers-file '/private/scf85/merchant-original.headers' \
  --out '/private/scf85/merchant-source.json'
~~~

The importer reuses original SF85 target/origin/credential-query and absolute-output validation. It accepts curl's HTTP/1.0, HTTP/1.1, HTTP/2 and HTTP/3 status lines, optional proxy CONNECT/informational prelude, and repeated original PAYMENT-REQUIRED and WWW-Authenticate headers. It rejects folded/malformed headers, multiple final resource responses, truncated files, invalid UTF-8, and files over 64 KiB. Other server headers are not copied into the output. No socket is opened, no wallet or buyer is used, and no payment is made.

The output is a create-only 0600 source JSON in the original scf.sf85.capture.v1 family, compatible with SF84 and its downstream seller workorder workflow. It identifies the import provenance, original *header-file* SHA-256, byte count, and import time. The actual HTTP capture time and request method cannot be authenticated from a response header dump, so capture time is null and requestMethodSource is operator-declared. The resulting capturedSha256 hashes the JSON handoff, not the HTTP packet or issuer.

## 3. Continue through original merchant analysis

~~~sh
node stellar/scf-starforge-20261009/sf84-mpp-market-intake/inspect.mjs \
  '/private/scf85/merchant-source.json'
~~~

Use the original source JSON with existing SF70/SF74/SF77 merchant analysis and workorder flows. The original parser distinguishes x402 v2 versus MPP Charge/Session, preserves challenge multiplicity and reports malformed/ambiguous evidence. A 402 header alone is not a paid-delivery/chain receipt or a customer sale.

For merchant adoption, SF30's existing developer portal and upstream seller launcher provide the integrated API routes; SF88 handles the existing buyer-side operator calls. This import feature does not duplicate any of those components. The operator must independently establish that the saved header file truly came from the stated seller/URL/method and that the original merchant permitted capture. Keep original files out of GitHub, Slack, public demos and grant submission material.
