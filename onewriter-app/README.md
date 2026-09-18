# OneWriter — deploy-ready collision control

Status: **SOURCE + POSTGRES PROOF / NOT DEPLOYED / NOT SUBMITTED**

OneWriter prevents a multi-agent business failure: two workers independently notice the same valuable organization and contact it seconds apart, often through different aliases. It turns the ownership decision into a database-serialized writer lease and retains evidence-bound transition receipts.

This app **never sends email, DMs, forms, or provider mutations**. The writer collision key is `organization × purpose × opportunity`. Domain and route remain normalized target/lease evidence, but neither partitions writer ownership. This is deliberately conservative: without a trusted server-held organization-ID/domain-alias registry, caller-selected root/subdomain or multi-domain aliases cannot mint parallel writers for the same organization lane.

## What is implemented

- browser Claim Desk, Live Lanes, Outcomes, Receipts, and receipt-derived Impact screens;
- authenticated Netlify serverless API at `/api/*`; every operational read/mutation requires an explicit Bearer capability;
- actor identity is derived from the server-held session registry and is not accepted from request JSON;
- separate roles gate state reads, claims, holds, provider-evidence recording, and human-evidence recording;
- Netlify Database/Postgres migration with one workspace identifier namespace for event/provider/human evidence ids;
- portable per-lane serialization using a lock-row transaction (`INSERT ... ON CONFLICT` + `SELECT ... FOR UPDATE`), including the absent-row race;
- bounded whole-transaction retry for PostgreSQL `40001` serialization failures and `40P01` deadlocks; every retry starts a new SERIALIZABLE transaction/snapshot and samples a fresh DB clock;
- retry exhaustion fails closed without writer authority, leaked identifier, or event receipt;
- server/database clock for lease expiry;
- one-shot `HUMAN_EVENT` reopen that retains the exact prior fence and restores it if the authorized lease expires unused;
- strict retained identifier admission: trimmed nonempty 1–240 text, no ASCII controls, no Unicode category-C codepoints, no non-category-C Default_Ignorable codepoints, and at least one visible base outside C/M/Z;
- collision identity for organization/purpose/opportunity is NFC-canonicalized, Unicode case-folded, and rejects category-C plus non-category-C Default_Ignorable codepoints before hashing; full normalized identity still retains the selected domain, but the collision projection intentionally omits domain and route so root/subdomain or legitimate multi-domain aliases cannot split writer ownership; transitional IDNA normalization still applies to retained target domains;
- immutable accepted-event and transition receipt digests with `external_send_authorized=false`;
- CI race proof against a real PostgreSQL 16 service plus deterministic injected serialization/deadlock failures;
- local fallback proof via Netlify's official `@netlify/database-dev` emulator;
- hostiles for unauthenticated state/mutation, caller actor injection, insufficient role, Unicode collision aliases (NFC-equivalent spellings and invisible controls), wrong-route/provider-holder outcomes, cross-type identifier reuse, hard DNR, and one-shot human-reopen refencing.

## Authentication contract

Set `ONEWRITER_SESSIONS_JSON` only in the trusted server environment. It is an array of token digests, trusted subjects, and roles; plaintext bearer tokens are never committed or stored in the registry.

Example shape:

```json
[
  {
    "token_sha256": "<64 lowercase hex characters>",
    "subject": "worker-alpha",
    "roles": ["state", "claim", "provider_evidence"]
  },
  {
    "token_sha256": "<different 64 lowercase hex characters>",
    "subject": "coordinator",
    "roles": ["state", "hold", "human_evidence"]
  }
]
```

Generate a random bearer token out of band and store only its SHA-256 digest in the environment registry. The browser keeps the entered plaintext token only in tab-scoped `sessionStorage` and sends it in the `Authorization: Bearer ...` header with `credentials:"omit"`; the app does not use ambient browser cookies for authentication.

Roles:
- `state`: read operational lanes/receipts/impact;
- `claim`: acquire writer leases;
- `hold`: record a manual HOLD when no live lease exists;
- `provider_evidence`: record `SENT`/`BOUNCE`; the authenticated subject must also be the current live lease holder;
- `human_evidence`: record a retained `HUMAN_EVENT` reopening a fenced lane.

`provider_receipt` and `human_evidence_id` are **recorder-attested retained identifiers**. This app does not independently query the external provider or human conversation, and it does not turn those identifiers into payment, contract, buyer-interest, or send authority.

## Run the proof locally

Requirements: Node 22+.

```bash
npm install
npm test
npm run typecheck
```

Without `ONEWRITER_TEST_DATABASE_URL`, DB integration tests use Netlify's official local Postgres-compatible emulator. CI supplies a real PostgreSQL 16 service through `ONEWRITER_TEST_DATABASE_URL`; the same integration suite then runs against PostgreSQL itself.

For a full local Netlify environment you can also run `netlify dev` and apply migrations with `netlify database migrations apply`.

## API

All supported routes require `Authorization: Bearer <token>`.

### `POST /api/claim`

Exact keys (there is deliberately no caller-controlled `actor`):

```json
{
  "event_id": "evt-001",
  "org": "Northstar Labs",
  "domain": "northstar.example",
  "route": "email:sales@northstar.example",
  "purpose": "initial outreach",
  "opportunity": "builder fest",
  "lease_seconds": 300,
  "reason": "single-writer ownership before external action"
}
```

The retained receipt actor is the authenticated session subject. The normalized domain is retained as the selected target domain; a competing domain alias cannot bypass the organization-level lease, and provider outcomes must match the domain and route selected by the live lease. Typed outcomes include `GRANTED`, `DENIED_ACTIVE_LEASE`, `GRANTED_STALE_RECOVERY`, `DENIED_HARD_DNR`, `DENIED_DEAD_ROUTE`, `DENIED_HOLD`, and `GRANTED_AFTER_HUMAN_EVENT`.

### `POST /api/event`

Kinds are `SENT`, `BOUNCE`, `HUMAN_EVENT`, and `HOLD`. `SENT`/`BOUNCE` require `provider_evidence`, the authenticated subject to be the current live holder, the exact leased route, and a unique retained provider receipt. `HUMAN_EVENT` requires `human_evidence` plus distinct retained human evidence and only reopens a fenced lane for one bounded lease attempt. `HOLD` requires `hold` and cannot revoke a live lease.

### `GET /api/state`

Requires `state`. Returns current lanes, recent append-only event receipts, receipt-derived impact counters, database server time, authenticated principal metadata, and the all-false authority ceiling. There is no unauthenticated operational projection.

## Deployment gate

The connected Netlify account has no existing OneWriter project. A production project/database has therefore **not** been created by this build. Deployment is a separate owner-authorized action.

Netlify Database production use consumes plan credits for compute/bandwidth. The app is intentionally proven before any remote project is created. No paid upgrade, auto-recharge, external provider send, contest submission, prize/payment claim, or revenue claim is authorized by this repository.

## Business-use evidence gate

Synthetic/demo activity is not business impact. A deployed build must be exercised on an actual coordination workflow before any impact claim is made. Acceptable evidence comes from authenticated retained receipts: claim attempts, grants, collisions prevented, duplicate touches blocked, stale recoveries, hard fences, dead routes, human reopens, and holds. Private buyer message content is not required or stored.
