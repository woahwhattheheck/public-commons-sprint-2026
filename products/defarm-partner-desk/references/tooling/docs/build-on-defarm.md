# Build on DeFarm

This guide is for developers who want to build their own applications on top of
the DeFarm platform. It walks through the full lifecycle of a verifiable item,
from creation to selective disclosure, using either the CLI, the SDK directly,
or the miniapp framework.

## Stack at a glance

```
                              gateway.defarm.net
                                    │
       ┌────────────────────────────┼────────────────────────────┐
       │                            │                            │
       ▼                            ▼                            ▼
  @defarm/cli              @defarm/sdk                  @defarm/miniapp
  (terminal)               (your code)                  (your app)
```

- **`@defarm/cli`** — terminal first; best for ops, ad-hoc data work, demos.
- **`@defarm/sdk`** — typed HTTP client; best for backend services that want
  full control of the surface.
- **`@defarm/miniapp`** — opinionated framework on top of the SDK, focused on
  the most common application shapes (tokenization, marketplace, viewer,
  certifier dashboard).

## 1. Get a workspace API key

Sign up at <https://defarm.net>, create a partner workspace, then issue an
ingestion API key from `/app/partner/api-keys`. Keys are scoped to the
workspace and authorize:

- `POST /v1/partner/ingestions` (upload data)
- `GET` reads on items, events, circuits and receipts for the workspace
- `POST /api/disclosures` for items the workspace owns

Set the key in your environment:

```bash
export DEFARM_API_KEY="defarm_xxxxxxxxxxxx"
export DEFARM_GATEWAY="https://gateway.defarm.net"  # optional
```

## 2. Create a verifiable item

A DFID is the platform's verifiable identifier. To create a BEEF item with
SISBOV (the Brazilian federal cattle identifier), use the ingestion endpoint:

```bash
defarm auth api-key --key "$DEFARM_API_KEY"
defarm items new --value-chain BEEF --country BR --year 2026 \
  --circuit-id "$DEFARM_CIRCUIT_ID" \
  --metadata '{"sisbov":"105500497533895","breed":"Nelore","weight_kg":480}' --json
```

The backend will reject the row if SISBOV is missing or malformed and tell you
what's wrong. This is a feature: regulators trust the platform precisely
because canonical identifiers are enforced at the door.

## 3. Add typed events

Events describe what happens to the item: weighing, vaccination, movement.

```bash
defarm events add --event-type item_movement \
  --item-id <ITEM_ID> --circuit-id "$DEFARM_CIRCUIT_ID" \
  --payload '{"from_lot":"Lote A","to_lot":"Lote B","gta_number":"GTA-2026-001"}'
```

`item_movement` requires `gta_number` because Brazilian cattle movement is
regulated through GTAs. Other typed events have similar validation rules
documented in OpenAPI.

## 4. Anchor on Stellar mainnet

Anchoring happens automatically through the adapter pipeline once an item is
created. The IPCM contract on Stellar mainnet receives the canonical hash and
a separate Soroban contract mints an NFT. You don't need to call anything —
look it up later:

```bash
defarm receipts list --circuit-id "$DEFARM_CIRCUIT_ID"
```

Each anchor produces a receipt with a `proof_hash` that anyone can verify
against the on-chain transaction. There are currently 3,336+ anchors and
805+ NFT mints in production.

## 5. Disclose selectively

When you need to share item data with a third party, create a disclosure
rather than handing over the raw record. Presets control what fields are
exposed:

| Preset | Audience | Typical fields disclosed |
| --- | --- | --- |
| `finance_basic` | Banks, investors | country, value_chain, year, weight_kg |
| `audit_basic` | Certifiers, auditors | weight_kg only |
| `public_basic` | Anyone | country, value_chain, year |

```bash
defarm disclosures create --item-id <ITEM_ID> \
  --preset finance_basic --audience bank_partner --json
```

The response carries a `proof_hash` and a receipt id. The receiver verifies
provenance by re-deriving the hash from the disclosed payload and matching it
against the receipt.

Selective disclosure is the *explicit* path. Every ordinary read is already
provenance-scoped and masks sensitive identifiers automatically — see
[Reading item data](./reading-item-data.md) for what a read returns, how
conflicts resolve, and how `private` / `shared` / `public` differ.

## 6. Build a miniapp

If your application is bigger than a script, use `@defarm/miniapp`:

```bash
npm install @defarm/miniapp
```

```ts
import { DefarmMiniapp } from "@defarm/miniapp";

const app = new DefarmMiniapp({ apiKey: process.env.DEFARM_API_KEY });

const items = await app.items.list({ circuitId: process.env.DEFARM_CIRCUIT_ID });
const disclosure = await app.disclosures.forBank(items[0].id);
console.log(disclosure.proof_hash);
```

The framework includes helpers for the most common patterns:

- `app.items.createBeefWithSisbov(...)` — short-form item creation with
  identifier enforcement.
- `app.events.recordMovement(...)` — GTA-aware movement event.
- `app.disclosures.forBank / forAuditor / forPublic` — preset-aware
  disclosure creation.
- `app.sdk` — full SDK escape hatch when the helpers don't fit.

## Reference examples

- [`tooling/defarm-miniapp/examples/tokenization`](../packages/miniapp/examples/tokenization/README.md)
- [`tooling/defarm-miniapp/examples/marketplace`](../packages/miniapp/examples/marketplace/README.md)

## Where to read more

- API contract: <https://defarm.net/openapi.yaml>
- Public docs site: <https://docs.defarm.net>
- Swagger UI for partner endpoints: <https://docs.defarm.net/swagger-partner.html>
- Postman collection: <https://docs.defarm.net/postman-partner-collection.json>
