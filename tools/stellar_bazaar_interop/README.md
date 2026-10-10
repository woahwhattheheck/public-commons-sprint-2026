# Stellar x402 Bazaar: source-preserving interop census (SF-29)

An independent **read-only**, non-custodial protocol tool. Compare actual published Bazaar resource lists from multiple facilitator operators and decode the x402 `EXTENSION-RESPONSES` cataloging feedback without calling `/verify`, `/settle`, sending transactions, holding wallet keys, or relying on paid services.

This complements, **not replaces**, the canonical x402 Bazaar and Stellar settlement code. It does *not* claim that two untrusted providers reporting the same `payTo` proves seller ownership or that a listed price is current.

## Pinned upstream

- Specification: [x402 Foundation / Bazaar docs](https://github.com/x402-foundation/x402/blob/main/docs/extensions/bazaar.mdx), original Git blob `70057cd342e53a1b7527239ecf1dff490b3f657c` read October 9, 2026.
- Canonical definition: HTTP resource identity is the resource URI; MCP identity is `(resource, extensions.bazaar.info.input.toolName)` (not just the shared MCP endpoint).
- The standard response header is base64-encoded JSON under `bazaar.status`, with `success`, `processing`, `rejected`, and a human rejection reason.
- Some implementations respond with top-level `items`, others `resources`. This standalone census deliberately preserves each provider's original response instead of asserting stronger canonical conformance.

## Run from operator-provided original inputs

```
python3 bazaar_interop.py header 'eyJiYXphYXIiOnsic3RhdHVzIjoic3VjY2VzcyJ9fQ=='
python3 bazaar_interop.py census --snapshot path/to/original-list-response.json --output bazaar-report.json
```

For a real public remote Bazaar, from a networked operator environment (this tool does not fetch seller URLs or charge money):

```
python3 bazaar_interop.py census \
  --provider 'first=https://first.example.org' \
  --provider 'prefixed=https://api.example.org/platform/v2/x402' \
  --provider 'stellar=https://second.example.org/discovery/resources?network=stellar%3Atestnet' \
  --raw-dir raw-20261009 --page-size 100 --output bazaar-report.json
```

Replace these **example hostnames** with specific confirmed public facilitator HTTPS endpoints. A bare origin receives `/discovery/resources`; a safe provider base path receives that suffix; an exact path already ending in `/discovery/resources` is preserved. Bounded static query filters such as `network=stellar:testnet` are retained while the tool replaces any supplied `limit` and `offset` with its own pagination values. No hosted endpoint was probed when this initial code was authored. The tool preserves exact response bytes and SHA-256 in `--raw-dir`; it rejects redirections, userinfo, fragments, path traversal, non-default ports, non-public DNS, malformed JSON, and repeated pages rather than endlessly collecting an ignored `offset`. It deliberately does not auto-discover or invoke untrusted listing URLs.

`resources[*].terms_conflict` indicates conflicting `scheme`, `network`, `asset`, `payTo`, or `amount` for the same `(kind, resource, toolName)` across independent sources, **without** resolving or suppressing the observations. Original payment terms remain visible with raw snapshot SHA. Invalid records appear in `diagnostics`; they cannot be silently used to advertise payable services.

`last_updated_claimed` is simply the timestamp emitted by its facilitator; no independent freshness or ownership check is yet implemented. Price/ownership/protocol verdicts require separately observed seller 402 challenges and ledger receipts, as well as formal network authorization. Future canonical interop extensions should integrate with, not overwrite, existing catalog owners and grant engineering modules.

## Focused source fixture

`official_bazaar_resource.json` reproduces the canonical upstream **published** example resource verbatim (the spec's sample is on Base, not Stellar; it verifies wire-field handling only). This is **not** a live Stellar simulation or evidence of a deployed paywall. Run the one focused source check:

```
python3 focused_check.py
```

License: inherited from the parent repository's MIT License. No GitHub Actions, hosted runners, mainnet spend, outbound emails, SCF submission or third-party contract is needed.
