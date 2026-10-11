# SF96: original seller pilot + operations + private handoff

A merchant-first operator path that **composes the existing source**, rather than building another payment implementation:

- **SF82** compiles one selected OpenAPI API into the original SF61 offer/service artifacts, checks their immutable manifest, starts or resumes the original SF30 seller.
- **SF30 operations** observes that exact live seller session with the original dashboard, histogram and read-only Prometheus endpoint. No duplicate seller, requests, ledger, counters or payment path.
- **SF93** captures a deliberate, create-only, owner-private support case from the same two local listeners for the existing SF49 merchant team.

Node 22+, complete public sprint checkout. No npm install, hosted GitHub Actions, browser service, external payment or project-specific account is required for **challenge-only** operation. Payment-capable execution still requires the original trusted operator-owned facilitator, handlers and native packages. Starting the pilot is not a transaction or a grant award.

## One operator flow

```sh
# Run once from the repository root. Choose a private path, never a public git directory.
mkdir -p -m 700 /tmp/scf96-private-support
node stellar/scf-starforge-20261009/sf96-seller-pilot-ops/pilot-ops.mjs start \
  --ops-port 0 --support-parent /tmp/scf96-private-support -- \
  --spec stellar/scf-starforge-20261009/sf61-openapi-seller-import/openapi.example.json \
  --config stellar/scf-starforge-20261009/sf61-openapi-seller-import/service-selections.example.json \
  --bindings stellar/scf-starforge-20261009/sf61-openapi-seller-import/service-bindings.example.json \
  --out /tmp/scf96-unique-seller --port 0
```

The original SF82 seller prints its verified readiness, HTTP URL and route list. The SF96 line prints the **same** seller origin, its separate operations origin, exact mode and a ready-to-copy private `captureCommand`. Open `operationsDashboard` locally; make the actual *unpaid* call shown in SF82's README and inspect the 402 and request counters. The example selection contains deliberately nonpayable terms and does not execute an application handler in challenge-only mode.

In a second shell, paste the **actual** `captureCommand` printed by the first one. For example (replace ports with those from the live process):

```sh
node stellar/scf-starforge-20261009/sf96-seller-pilot-ops/pilot-ops.mjs capture \
  --seller http://127.0.0.1:8423 --ops http://127.0.0.1:8424 \
  --support-parent /tmp/scf96-private-support
```

This invokes **original SF93** without touching a payable route. Every invocation creates a fresh `seller-TIMESTAMP-UUID` case with original `bundle.json`, `operator-brief.md`, `metrics.prom`, and `manifest.json` under the private parent. The parent must already exist, be a real (non-symlink) directory and not be group/world accessible. SF93 enforces that both origins are explicit `127.0.0.1` HTTP listeners. The same capture command may be rerun after the merchant fixes an issue; no support case is overwritten. Captures should be reviewed privately before sharing with the merchant owner. Full offers, credentials and customer request data are not copied into SF93 output.

Press Ctrl-C in the first shell to stop **both** source-native listeners. To resume exactly the same compiled seller later (no recompile or changed terms):

```sh
node stellar/scf-starforge-20261009/sf96-seller-pilot-ops/pilot-ops.mjs start \
  --ops-port 0 --support-parent /tmp/scf96-private-support -- \
  --resume /tmp/scf96-unique-seller
```

For a production merchant, forward native SF82 runtime flags after `--`, such as trusted `--handlers`, `--facilitator`, and `--allow-local-facilitator` where supported. The original SF82 saves/resumes its own settings, validates its compiled manifest and preserves ownership of the seller process; our CLI neither edits its artifacts nor accepts secrets. `--ops-port 0` asks the original operations listener for a free port, so always use the **new** printed address when capturing after restart.

## Existing HTTP API backend

For a merchant with an existing GET, HEAD or JSON POST backend, forward original
SF82 `--upstreams BINDINGS_JSON` in place of `--handlers`. No JavaScript wrapper
is needed. Start the original local dataset backend from the
[SF82 upstream walkthrough](../sf82-seller-pilot/README.md#connect-an-existing-http-api),
then run this complete operations flow from the repository root:

```sh
P=stellar/scf-starforge-20261009/sf82-seller-pilot
mkdir -p -m 700 /tmp/scf-upstream-support
node stellar/scf-starforge-20261009/sf96-seller-pilot-ops/pilot-ops.mjs start \
  --ops-port 0 --support-parent /tmp/scf-upstream-support -- \
  --spec "$P/examples/upstream-openapi.json" \
  --config "$P/examples/upstream-selections.json" \
  --bindings "$P/examples/upstream-route-bindings.json" \
  --upstreams "$P/examples/upstreams.json" --allow-loopback-upstream \
  --out /tmp/scf-upstream-pilot --port 0
```

Request the printed seller's `/api/dataset?region=north` route to observe a real
unpaid 402 in the same session's operations dashboard. The backend is not called
in challenge-only mode. SF82 saves the original binding bytes privately and
resolves environment credential values freshly at launch. Stop both listeners
with Ctrl-C and use this native resume path without the original input files:

```sh
node stellar/scf-starforge-20261009/sf96-seller-pilot-ops/pilot-ops.mjs start \
  --ops-port 0 --support-parent /tmp/scf-upstream-support -- \
  --resume /tmp/scf-upstream-pilot
```

Deliberate backend changes use `--upstreams` again; public merchant bindings can
clear saved loopback permission with `--disallow-loopback-upstream`. Production
payment still uses the original SF30 facilitator and packages. All existing
support capture commands work with this same upstream-backed session.

## Scope and interpretation

All start arguments after `--` go unchanged into SF82's original CLI. SF82 remains responsible for seller readiness, manifest verification, trusted handler invocation, and payment mode. SF30 remains responsible for live route attribution and latency. SF93 remains responsible for private support output, source hashes and safe capture limits. This module composes their native calls and closes listeners if attaching operations fails. No remote service, persistent daemon, customer-facing dashboard deployment, wallet, settlement adapter, retries or new backend exists here.

The operations dashboard's HTTP 2xx/402 counts **do not** establish customer receipt, unique buyers, on-chain settlement or revenue. For a paid pilot, use the original SF36/SF82/SF86 independent buyer/chain evidence before making payment claims. The existing SF49 commercial owner retains customer contact, support case release and scope decisions. This source is an integration tool, not a declaration that a merchant was onboarded or that the SCF #46 interest form was submitted.

This module can be exercised against the original SF61 example in a local Node 22+ full checkout without hosted CI. For native real-merchant execution, keep the existing Muse operator/merchant authority and actual source config; do not replace native challenge or settlement with invented responses.
