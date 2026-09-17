# OneWriter — deploy-ready collision control

Status: **SOURCE + LOCAL-POSTGRES PROOF / NOT DEPLOYED / NOT SUBMITTED**

OneWriter prevents a multi-agent business failure: two workers independently notice the same valuable organization and contact it seconds apart, often through different aliases. It turns the ownership decision into a database-serialized writer lease and retains evidence-bound transition receipts.

This app **never sends email, DMs, forms, or provider mutations**. The collision key is `organization × domain × purpose × opportunity`; route is normalized lease metadata and cannot be used to bypass a live writer lease.

## What is implemented

- browser Claim Desk, Live Lanes, Outcomes, Receipts, and receipt-derived Impact screens;
- Netlify modern serverless function API at `/api/*`;
- Netlify Database/Postgres migration with one workspace identifier namespace for event/provider/human evidence ids;
- portable per-lane serialization using a lock-row transaction (`INSERT ... ON CONFLICT` + `SELECT ... FOR UPDATE`), including the absent-row race;
- server/database clock for lease expiry;
- one-shot `HUMAN_EVENT` reopen that retains the exact prior fence and restores it if the authorized lease expires unused;
- strict retained identifier admission: trimmed nonempty 1–240 text, no ASCII controls, no Unicode category-C codepoints, no non-category-C Default_Ignorable codepoints, and at least one visible base outside C/M/Z;
- Unicode case-folding for organization/purpose/opportunity/route and IDNA transitional normalization for organization domains;
- immutable accepted-event and transition receipt digests with `external_send_authorized=false`;
- a real local-Postgres integration test that launches two concurrent clients against the same organization lane using **different routes** and proves only one live lease is granted;
- hostile tests for wrong-route outcomes, cross-type identifier reuse, hard DNR, and one-shot human-reopen refencing.

## Run the proof locally

Requirements: Node 22+.

```bash
npm install
npm test
npm run typecheck
```

`npm test` uses Netlify's official `@netlify/database-dev` in-memory Postgres-compatible emulator. It does not need a remote site or production database.

For a full local Netlify environment you can also run:

```bash
netlify dev
```

and apply migrations with:

```bash
netlify database migrations apply
```

## API

### `POST /api/claim`

Exact keys:

```json
{
  "event_id": "evt-001",
  "actor": "worker-alpha",
  "org": "Northstar Labs",
  "domain": "northstar.example",
  "route": "email:sales@northstar.example",
  "purpose": "initial outreach",
  "opportunity": "builder fest",
  "lease_seconds": 300,
  "reason": "single-writer ownership before external action"
}
```

Typed outcomes include `GRANTED`, `DENIED_ACTIVE_LEASE`, `GRANTED_STALE_RECOVERY`, `DENIED_HARD_DNR`, `DENIED_DEAD_ROUTE`, `DENIED_HOLD`, and `GRANTED_AFTER_HUMAN_EVENT`.

### `POST /api/event`

Kinds are `SENT`, `BOUNCE`, `HUMAN_EVENT`, and `HOLD`. `SENT`/`BOUNCE` require the current live holder, the exact leased route, and a unique retained provider receipt. `HUMAN_EVENT` requires distinct retained human evidence and only reopens a fenced lane for one bounded lease attempt. `HOLD` cannot revoke a live lease.

### `GET /api/state`

Returns current lanes, recent append-only event receipts, receipt-derived impact counters, database server time, and the all-false authority ceiling.

## Deployment gate

The connected Netlify account has no existing OneWriter project. A production project/database has therefore **not** been created by this build. Deployment is a separate owner-authorized action.

Netlify Database production use consumes plan credits for compute/bandwidth. The app is intentionally proven against the free local emulator before any remote project is created. No paid upgrade, auto-recharge, external provider send, contest submission, prize/payment claim, or revenue claim is authorized by this repository.

## Business-use evidence gate

Synthetic/demo activity is not business impact. A deployed build must be exercised on an actual coordination workflow before any impact claim is made. Acceptable evidence comes from retained receipts: claim attempts, grants, collisions prevented, duplicate touches blocked, stale recoveries, hard fences, dead routes, human reopens, and holds. Private buyer message content is not required or stored.
