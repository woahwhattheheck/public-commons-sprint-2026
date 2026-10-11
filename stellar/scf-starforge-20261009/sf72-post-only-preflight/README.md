# SF72: POST-only browser preflight for genuine Stellar x402 merchant listings

SF70 deliberately avoids probing a POST-only x402 seller with GET. SF72 adds the missing **read-only POST browser-preflight** path without altering SF70 or falsely treating an MCP-only resource as an HTTP endpoint.

## Operator workflow

First generate a **genuine** original SF70 intake JSON with the existing CLI for an agreed seller resource, actual facilitator catalog, buyer origin, exact Stellar network and public recipient. Use --method POST and --out /private/original-sf70.json.

Then run:

    node stellar/scf-starforge-20261009/sf72-post-only-preflight/preflight.mjs --intake /private/original-sf70.json --out /private/sf72-report.json

The input file must be the unmodified original SF70 JSON, whose embedded SF52 complete catalog proves the **same resource** advertises **HTTP POST alone** (not GET, ambiguous HTTP, or MCP), with an indivisible paired network and recipient. Conflicting source scopes, incomplete pagination, mixed methods, wrong payTo, unknown types and MCP records return **INCONCLUSIVE** with no network activity. No independent inference of customer or seller consent is made.

Exactly one OPTIONS request, containing the buyer Origin, Access-Control-Request-Method: POST and Access-Control-Request-Headers: payment-signature,content-type, is allowed for a qualifying original snapshot. No GET, POST, signed request, payment, settlement, seller challenge retrieval or credentials. The actual OPTIONS status and selected browser CORS headers are assessed against browser rules.

- Exit 0: POST_PREFLIGHT_READY_CHALLENGE_UNKNOWN. The observed preflight permits browser JSON POST, **not** proof the paid challenge, signature, seller route or payment worked.
- Exit 2: PREFLIGHT_REMEDIATION. Actual OPTIONS response did not satisfy origin, POST method, payment-signature or content-type checks, or successful status.
- Exit 3: INCONCLUSIVE. Source did not prove an isolated POST route. No request sent.
- Exit 1: invalid input or transport error.

The optional --credentialed flag enforces specific origin and credentials-compatible CORS (no wildcard). The --allow-loopback flag admits literal local 127.0.0.1 HTTP acceptance servers only. Reports are create-only (0600) and include the SHA-256 digest of the original intake bytes; they never overwrite.

## Five-day merchant delivery acceptance

Obtain seller agreement on one actual POST route and buyer origin. Capture and preserve native original SF70 plus this SF72 preflight **before** any repair. If needed, configure the already merged SF69 seller CORS middleware before payment middleware and repeat the identical browser-origin OPTIONS request. Archive both original source snapshots and observations. Do not claim paid conversion, buyer adoption, KYC, charge, onchain settlement, or customer contract without a separate authorized checkout and commercial acceptance.

Original existing Oct 11 Muse/Vellar source observed a newly advertised POST listing, but **no seller authorization, public POST preflight or paid checkout** is asserted here. Its true current record belongs to the existing source owner. No hosted Actions workflow or new dependency. MIT.

One focused local Node original-shaped SF70 HTTP server check:

    node stellar/scf-starforge-20261009/sf72-post-only-preflight/acceptance.mjs
