# Original SF30 merchant fleet gateway | single-host multi-merchant operations

**Purpose:** Run two to 32 independently configured **original SF30** Stellar x402 sellers behind one local ingress and one operator-managed HTTPS reverse proxy. Each merchant keeps its own original service config, route declarations, x402 facilitator choice, settlement semantics, pay-to account, operations and delivery outbox. The gateway does **not** create a payment scheme, reuse a merchant credential, share seller ports, authorize payments, simulate on-chain activity or mark transactions settled. It is a product for operators onboarding several paid merchants without duplicating an HTTPS ingress host per merchant.

**Relationship to existing project work:** Complements SF30 original seller, SF49 paid merchant program and the separate SF99 **single** merchant Caddy/systemd deployment. It does not modify those source files. Preserve original SF98 settlement webhook path/status and challenge/receipt headers byte-for-byte. The existing original SF30 server still listens on 127.0.0.1 and builds Bazaar offers from each trusted HTTPS publicOrigin.

## Operator deployment from the actual public repository

1. Create distinct original SF30 seller configs for merchant A and merchant B, each using an actual operator-controlled **HTTPS** publicOrigin such as https://alpha.example.com and https://bravo.example.com. Real merchant payment details must come from each customer's authorized records. The original example's UNVERIFIED_DEMO_* values are NOT payable and are not production payment evidence.
2. Run a separate **original** seller process per tenant; the example ports are 8423 and 8424, both on **127.0.0.1**. Use original SF30 native facilitator integration only with verified operator-approved keys/assets and the original SDK, never this gateway as a verification layer.
3. Copy examples/fleet.json into a private operator manifest and set each sellerConfig (absolute or relative to the manifest) to the actual seller JSON. Set unique original port and matching exact lowercase DNS host. Make the operator manifest private. No wallet keys go in this manifest.
4. Launch this original-source gateway from the public repository root with Node.js 22+:

    node stellar/scf-starforge-20261009/merchant-fleet-gateway/cli.mjs --manifest /srv/scf/fleet.json --port 8400 --admin-port 8401

   The gateway probes **actual running** SF30 /_seller/health AND /_seller/offers for each tenant before it binds. The original compiler supplies the complete expected offers: resource, input schema and payment options are compared with the original running seller, together with route identity, admission/input-validation flags and readiness. File merchants retain the original asset MIME/digest/name and byte limits without copying their file bytes into the gateway. Nothing starts if a tenant is down at boot.
5. Put your own **operator-managed HTTPS** Caddy reverse proxy in front. This example only forwards public merchant hosts to the loopback front ingress:

    alpha.example.com, bravo.example.com {
        reverse_proxy 127.0.0.1:8400
    }

   Resolve both DNS hostnames to the actual TLS proxy you operate. **Never** expose gateway's 8400/8401 or the original SF30 ports on a public interface. Caddy or equivalent must terminate HTTPS and preserve the original Host authority. Treat local access to the router as trusted operator access. The gateway sets X-Forwarded-Proto to https for each original seller and ignores untrusted request forwarding identities.
6. Observe **private** local fleet counters: `curl http://127.0.0.1:8401/_fleet/health` for the static invocation above, or `control.mjs status --state ...` for the durable invocation below. The public ingress never serves this endpoint or original /_seller/* docs/offers/health. Merchant buyers access only configured original route methods/paths, including required original payment response headers.
7. Manage seller processes with their existing original operator. Use the live rollout below to change fleet configuration without restarting the shared gateway. Run a changed seller on a different original loopback port, activate its checked configuration, then wait for the prior generation to drain before retiring that seller. Do not reassign an active seller's port or copy payment settings between merchants.

## Live merchant rollout on Linux

This is a continuation of the same gateway and its private admin listener. It adds a complete prepare → activate → drain → restart/rollback workflow. It does not install software releases, launch seller processes, change Caddy/systemd configuration, or replace the original SF82/SF96 seller operator. The static command above remains available without durable control.

### Start and inspect the current selection

Use a dedicated private state directory. The gateway creates it with mode 0700 when absent and refuses an existing directory with group/other access. Durable files use mode 0600. Supply `--manifest` on the first start:

```sh
node stellar/scf-starforge-20261009/merchant-fleet-gateway/cli.mjs \
  --manifest /srv/scf/fleet.json --state /srv/scf/fleet-state \
  --port 8400 --admin-port 8401

node stellar/scf-starforge-20261009/merchant-fleet-gateway/control.mjs \
  status --state /srv/scf/fleet-state
```

Startup validates every current original seller and prints public/private addresses, the capability-file path, current revision and merchant identities. It never prints the capability. `control.mjs` reads the private file and sends its capability and current process instance in headers to the literal 127.0.0.1 admin endpoint. With durable control enabled, health and mutation endpoints require those headers; arbitrary browser origins and public ingress cannot use them. There is no additional dashboard or public management endpoint.

State ownership uses the Linux `flock` utility and a kernel lock on a private file. A short acquisition helper receives a duplicate of the gateway’s own open file description; successful helper exit leaves that description locked in the gateway process. The gateway retains its descriptor until shutdown; process exit also releases it. Linux deployments need `flock` from util-linux on PATH. Never unlink or replace `lease.lock` while a gateway could be using the state. A second gateway cannot own the same state concurrently. `owner.json` records the gateway's actual PID, process birth, host, instance and lock-holder PID; it is an observation record, not permission to signal or take over someone else's process. No seller credentials or seller process handles are acquired.

### Prepare a merchant change

Keep the current original seller running. Start the changed original SF30 configuration on a different loopback port, using that merchant's existing launcher and exact publicOrigin, authorization policy, upstream references and payment terms. Copy the fleet manifest, change that merchant's sellerConfig/upstreamPort, and retain the other tenants. Then prepare against the revision shown by status:

```sh
node stellar/scf-starforge-20261009/merchant-fleet-gateway/control.mjs \
  prepare --state /srv/scf/fleet-state \
  --manifest /srv/scf/fleet-next.json --expect 1
```

Preparation reads the original seller configs and compiler, validates the manifest and port ownership, and compares changed sellers' actual health and complete original offers. It rejects a changed seller configuration on a port that still belongs to the published or draining prior configuration. Limits-only changes can reuse a seller port because the original native configuration is unchanged. Unchanged merchants retain their existing routing; their availability is not used to block another merchant's live preparation. A failure leaves the current revision and routing in place.

The returned candidate identifies its exact base revision, changed/added/removed authorities, merchant modes, limits, route counts, source digest and expiry. Its merchant `routeDetails` expose each original compiled route's ID, method, public URL, optional dynamic template/MIME, and complete ordered `paymentChoices`. Amounts remain the original atomic-unit strings; scheme, network, asset, recipient, timeout and any other original public payment fields retain their exact values. Compare serving and prepared terms in the operator workspace before activation. Current and retired merchant summaries use the same public view, so a draining request's original generation remains distinguishable from the new terms.

`routeDetailsState: "COMPLETE"` means the merchant's entire route list is present. Public route details have a shared 256 KiB budget within the control client's existing 1 MiB response limit, with current and prepared merchants first, then draining and older generations. A complete merchant list that exceeds the remaining budget is omitted with `routeDetailsState: "STATUS_LIMIT"`; no partial route or payment choice is shown. Inspect that original seller's private `http://127.0.0.1:PORT/_seller/offers` from the operator host for its full public offers. This projection uses only compiled public offers; source paths, handler names, admission configuration and environment references remain in private retained configuration.

Preparation stores an immutable private copy of the complete manifest and complete parsed seller configs. It keeps handler/admission names, imported offers and authorization declarations, original environment-variable references and other configuration fields. The original reader resolves responseFile and responseAsset paths before retention. Secret values belong in the original seller's environment; the gateway does not load them. This snapshot is gateway routing/configuration state; retain application code, asset data and original seller deployment separately.

There is one current candidate, valid for 15 minutes. A subsequent successful prepare replaces it; a failed prepare leaves the prior candidate intact. Preparing does not expose the new merchant or change any payment route.

### Activate and let existing requests finish

Use the candidate ID returned by preparation:

```sh
node stellar/scf-starforge-20261009/merchant-fleet-gateway/control.mjs \
  activate --state /srv/scf/fleet-state \
  --candidate CANDIDATE_ID --expect 1

node stellar/scf-starforge-20261009/merchant-fleet-gateway/control.mjs \
  status --state /srv/scf/fleet-state
```

Activation reopens and hash-checks the retained source, checks changed original endpoints again, and requires the same candidate/current revision. It atomically persists the next selection and synchronously switches the gateway's route table. The revision becomes 2. Source edits after prepare cannot change the selected snapshot. Competing mutations, stale revisions and expired candidates return explicit errors.

Each already admitted request keeps the exact tenant object, seller port and limits captured before body collection and forwarding. That includes an upload whose body has not yet arrived. New admissions use the new generation. Capacity is shared by merchant authority across current and retiring generations, so an update cannot double the merchant's configured accepted-request budget. A lower new limit can temporarily refuse new work with 503 while older work finishes. Other merchants continue independently.

Status shows current counters, total active requests for each authority, and prior generations as `DRAINING` or `DRAINED`. Keep an original seller instance running until every generation using that port is drained. There is no payment retry, request replay, forced seller termination or transfer of an in-flight request to a replacement process. A direct operator restart or modification of an old backend can still interrupt its requests; the gateway does not control that process.

### Compose an owned original seller release

An in-process original release operator can call
`gateway.withRetiredPort(port, expectedRevision, () => originalSession.close())`
after it verifies that it owns that exact original SF82 session. The gateway
validates the integer port and current revision, rejects any use by the current
fleet, prepared candidate or admitted work in a retired generation, and holds
the same mutation guard while the original close callback completes. Other
merchant requests keep serving; another control client cannot activate that
port between the drain check and the close. The callback closes the caller's
original session handle and must not wait for another gateway mutation.

This is a native JavaScript interface; HTTP control continues exposing only
status, prepare, activate and rollback. The gateway receives no process ID,
command or seller credential. Gateway shutdown waits for an outstanding native
operation and both HTTP listeners before releasing its state lease. The
release operator retains its own release mapping and starts the selected
original seller again before requesting a later rollback to that port.

### Restart from retained state and roll back

Graceful SIGINT/SIGTERM stops new gateway admissions and closes the public/admin listeners after admitted work finishes, then releases the state lease. Start the gateway with the same state directory:

```sh
node stellar/scf-starforge-20261009/merchant-fleet-gateway/cli.mjs \
  --state /srv/scf/fleet-state --port 8400 --admin-port 8401
```

The active retained snapshot is authoritative, even if the original manifest was edited or removed. An optional `--manifest` is only a bootstrap input for an empty state; it never overrides an existing selection. Current original sellers still have to be running and match at boot. Process restart retains configuration, not interrupted network requests or an unactivated candidate.

To restore the prior selection, keep its original sellers available and use the current revision:

```sh
node stellar/scf-starforge-20261009/merchant-fleet-gateway/control.mjs \
  rollback --state /srv/scf/fleet-state --expect 2
```

Rollback checks the retained configuration and actual changed original endpoints through the same path, then activates it as revision 3. It never rewinds the revision counter or replays a purchase. `--revision 1` selects a specific entry displayed in status history; without it, rollback selects the immediately prior entry. If that original seller is unavailable or has drifted, rollback fails while the current fleet continues serving.

### Snapshot retention and operator recovery

The state retains the active selection, up to 16 prior activation records, the current prepared candidate and every generation with admitted work still draining. Automatic collection runs on startup, successful prepare/activation and final drain. Superseded candidate snapshots and unreferenced historical snapshots are removed only from the dedicated snapshot directory after their own metadata identifies them as fleet snapshots. External response files, seller code, environment files and arbitrary folders are never collected.

`storage.state` reports `CURRENT`, `CLEANUP_REQUIRED` for a filesystem cleanup failure, or `UNMANAGED_ENTRIES` for entries the collector deliberately leaves alone. A cleanup failure does not misreport an already activated revision as unsuccessful. Correct the private directory's filesystem/access problem; the next successful operation retries collection. Inspect unexpected entries locally before removing them. Do not delete active/history/prepared/draining snapshots while the gateway owns the state. Keep old seller deployments available for the rollback period your operation needs; gateway snapshots do not recreate them.

## Reliability and identity

- Each original SF30 seller already binds loopback. Fleet also binds only 127.0.0.1 on separate public/admin ports; up to 32 canonical HTTPS DNS authorities, different original upstream ports, no wildcard or unknown Host routing and no arbitrary user-selected upstream destination.
- Only explicitly configured routes accepted by the original SF30 compiler and original path matcher can be forwarded: GET/HEAD/DELETE and JSON POST/PUT/PATCH, including supported imported dynamic paths and native static-path precedence. It retains the original file-asset offer/admission metadata. The gateway does not proxy SF30 admin, status, docs, original offers, or fleet control publicly. It rejects unknown hosts (421), unpublished routes (404), unsupported methods (405), oversize request bodies (413), and saturated merchants (503 + Retry-After).
- Merchant-specific in-flight caps, request and response byte limits, and upstream timeouts prevent one overloaded tenant's traffic from exhausting another tenant's accepted slots. There is no queue or automatic replay of a payment/signature/settlement. The proxy never manufactures x402 headers or changes the body of native 402/200 responses.
- Original seller/proxy use the customer's own exact publicOrigin, preserving the native Bazaar route identity, Stellar exact asset/amount/network/payTo terms and PAYMENTS headers. HTTP 204/205/304 are kept bodyless. No synthetic payment confirmation or unapproved real settlement is generated.
- Operator must terminate real HTTPS and monitor ingress and original seller processes, configure capacity, consent, data retention, firewall and proxy trust according to the deployment environment. This product does not add public DDoS defenses, billing, wallet custody, or a customer agreement. Do not count a local challenge-only HTTP 402 as collected revenue.
- If an original tenant fails **after** boot, its requests return explicit upstream failure (502). The existing seller operator can restore that exact instance or use a checked live rollout to select a different original process. Other merchants retain their current routing. No native payment is retried by the gateway.

## Real original-source acceptance (run in a full repository checkout)

    node stellar/scf-starforge-20261009/merchant-fleet-gateway/acceptance.mjs

This boots **two actual ORIGINAL SF30** challenge-only seller services with separate configured HTTPS publicOrigin and distinct original atomic unit amounts, then sends original GET /dataset through the live fleet gateway. It compares the actual returned HTTP 402 bodies and PAYMENT-REQUIRED headers byte-for-byte to each directly queried original seller, checks tenant isolation, denies public operator paths/unknown origins and inspects loopback-only fleet status. This is a source-native operating-flow rehearsal; it does **not** perform on-chain settlement or assert an invented paid merchant receipt. For real paid operation, use the original x402 facilitator and existing SF82/SF86/SF98 transfer/receipt tools with customer-authorized testnet accounts.

No npm dependencies are added here and no hosted GitHub Actions or repository-wide suites are required. SF30 original dependencies must already be present from the full repository. 

The separate complete live-rollout journey runs on Linux:

```sh
node stellar/scf-starforge-20261009/merchant-fleet-gateway/rollout-acceptance.mjs
```

It starts three actual original SF30 seller services: Alpha's prior and changed configurations and an independent Bravo file merchant. Through the original CLI and actual control/public HTTP listeners it rejects a wrong payment amount, replaces and collects a superseded candidate, activates while a partially uploaded POST is admitted, preserves that original POST's exact 402, enforces the shared authority capacity and leaves Bravo's original asset offer unchanged. It admits the newly published native PUT route, closes/restarts from retained state after original input files are removed, and rolls back to the retained prior configuration. The original admission name and resolved response-file reference survive retention. Every challenge body and PAYMENT-REQUIRED header is compared with the corresponding original seller. No facilitator, chain call, signed payment, paid delivery or Actions execution is involved. The original two-merchant acceptance above is a separate existing baseline; it does not need to be rerun for this journey.

## Operator handoff to existing SF49/SCF #46 founder

Input needed to activate: two participating merchant principals, their exact source configurations and Stellar receiving accounts, two running original seller processes, TLS/DNS control and facilitator connectivity. Output delivered by code: one exact-authority local ingress, independent seller routing, bounded resource use, source-native 402 receipt/header passthrough, isolated private operator counters, and a repeatable multi-merchant acceptance command. This materially enables a multi-seller x402 demonstration without depending on fee estimates, fabricated paid volume or premature grant claims.
