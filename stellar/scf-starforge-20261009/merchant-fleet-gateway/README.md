# Original SF30 merchant fleet gateway | single-host multi-merchant operations

**Purpose:** Run two to 32 independently configured **original SF30** Stellar x402 sellers behind one local ingress and one operator-managed HTTPS reverse proxy. Each merchant keeps its own original service config, route declarations, x402 facilitator choice, settlement semantics, pay-to account, operations and delivery outbox. The gateway does **not** create a payment scheme, reuse a merchant credential, share seller ports, authorize payments, simulate on-chain activity or mark transactions settled. It is a product for operators onboarding several paid merchants without duplicating an HTTPS ingress host per merchant.

**Relationship to existing project work:** Complements SF30 original seller, SF49 paid merchant program and the separate SF99 **single** merchant Caddy/systemd deployment. It does not modify those source files. Preserve original SF98 settlement webhook path/status and challenge/receipt headers byte-for-byte. The existing original SF30 server still listens on 127.0.0.1 and builds Bazaar offers from each trusted HTTPS publicOrigin.

## Operator deployment from the actual public repository

1. Create distinct original SF30 seller configs for merchant A and merchant B, each using an actual operator-controlled **HTTPS** publicOrigin such as https://alpha.example.com and https://bravo.example.com. Real merchant payment details must come from each customer's authorized records. The original example's UNVERIFIED_DEMO_* values are NOT payable and are not production payment evidence.
2. Run a separate **original** seller process per tenant; the example ports are 8423 and 8424, both on **127.0.0.1**. Use original SF30 native facilitator integration only with verified operator-approved keys/assets and the original SDK, never this gateway as a verification layer.
3. Copy examples/fleet.json into a private operator manifest and set each sellerConfig (absolute or relative to the manifest) to the actual seller JSON. Set unique original port and matching exact lowercase DNS host. Make the operator manifest private. No wallet keys go in this manifest.
4. Launch this original-source gateway from the public repository root with Node.js 22+:

    node stellar/scf-starforge-20261009/merchant-fleet-gateway/cli.mjs --manifest /srv/scf/fleet.json --port 8400 --admin-port 8401

   The gateway probes **actual running** SF30 /_seller/health AND /_seller/offers for each tenant before it binds. It refuses a route, identity, method or host that differs from the signed-off original configs. Nothing starts if a tenant is down at boot.
5. Put your own **operator-managed HTTPS** Caddy reverse proxy in front. This example only forwards public merchant hosts to the loopback front ingress:

    alpha.example.com, bravo.example.com {
        reverse_proxy 127.0.0.1:8400
    }

   Resolve both DNS hostnames to the actual TLS proxy you operate. **Never** expose gateway's 8400/8401 or the original SF30 ports on a public interface. Caddy or equivalent must terminate HTTPS and preserve the original Host authority. Treat local access to the router as trusted operator access. The gateway sets X-Forwarded-Proto to https for each original seller and ignores untrusted request forwarding identities.
6. Observe **private** local fleet counters: curl http://127.0.0.1:8401/_fleet/health . The public ingress never serves this endpoint or original /_seller/* docs/offers/health. Merchant buyers access only exact configured route methods/paths, including required original payment response headers.
7. Manage lifecycle with your existing original seller and proxy service operator; stop or restart **tenant instances independently**, then restart the gateway after config or route changes to re-probe each original seller. Do not silently reassign one merchant's port to another or copy payment settings between tenants.

## Reliability and identity

- Each original SF30 seller already binds loopback. Fleet also binds only 127.0.0.1 on separate public/admin ports; up to 32 canonical HTTPS DNS authorities, different original upstream ports, no wildcard or unknown Host routing and no arbitrary user-selected upstream destination.
- Only explicitly configured original GET/HEAD/POST route methods and fixed paths can be forwarded. The gateway does not proxy SF30 admin, status, docs, original offers, or fleet control publicly. It rejects unknown hosts (421), unpublished routes (404), unsupported methods (405), oversize request bodies (413), and saturated merchants (503 + Retry-After).
- Merchant-specific in-flight caps, request and response byte limits, and upstream timeouts prevent one overloaded tenant's traffic from exhausting another tenant's accepted slots. There is no queue or automatic replay of a payment/signature/settlement. The proxy never manufactures x402 headers or changes the body of native 402/200 responses.
- Original seller/proxy use the customer's own exact publicOrigin, preserving the native Bazaar route identity, Stellar exact asset/amount/network/payTo terms and PAYMENTS headers. HTTP 204/205/304 are kept bodyless. No synthetic payment confirmation or unapproved real settlement is generated.
- Operator must terminate real HTTPS and monitor ingress and original seller processes, configure capacity, consent, data retention, firewall and proxy trust according to the deployment environment. This product does not add public DDoS defenses, billing, wallet custody, or a customer agreement. Do not count a local challenge-only HTTP 402 as collected revenue.
- If an original tenant fails **after** boot, the gateway returns explicit upstream failure (502); restart and recapture genuine operator status rather than retrying native payments or pretending a successful delivery.

## Real original-source acceptance (run in a full repository checkout)

    node stellar/scf-starforge-20261009/merchant-fleet-gateway/acceptance.mjs

This boots **two actual ORIGINAL SF30** challenge-only seller services with separate configured HTTPS publicOrigin and distinct original atomic unit amounts, then sends original GET /dataset through the live fleet gateway. It compares the actual returned HTTP 402 bodies and PAYMENT-REQUIRED headers byte-for-byte to each directly queried original seller, checks tenant isolation, denies public operator paths/unknown origins and inspects loopback-only fleet status. This is a source-native operating-flow rehearsal; it does **not** perform on-chain settlement or assert an invented paid merchant receipt. For real paid operation, use the original x402 facilitator and existing SF82/SF86/SF98 transfer/receipt tools with customer-authorized testnet accounts.

No npm dependencies are added here and no hosted GitHub Actions or repository-wide suites are required. SF30 original dependencies must already be present from the full repository. This is not an SCF grant award, contract, customer acceptance or a deployed public host.

## Operator handoff to existing SF49/SCF #46 founder

Input needed to activate: two merchant principals opting into a pilot, two approved source configs/actual per-seller Stellar receiving accounts, two original seller processes, TLS DNS/control, facilitator connectivity and explicit operator deployment approval. Output delivered by code: one exact-authority local ingress, independent seller routing, bounded resource use, source-native 402 receipt/header passthrough, isolated private operator counters, and a repeatable multi-merchant acceptance command. This materially enables a multi-seller x402 demonstration without depending on fee estimates, fabricated paid volume or premature grant claims.
