# Swarm Claim Recovery Ledger

A standard-library Python utility for preventing duplicate work when agents, chat sessions, containers, or provider connections disappear mid-operation.

It keeps one durable SQLite ledger of **coordination metadata**:

- claim ownership and generation
- heartbeats tied to real work
- durable checkpoints containing references and hashes, not payloads
- completed, blocked, and released state
- stale-work classifications
- rejected/conflicting event anomalies
- guarded recovery packets and compare-and-swap takeovers
- a static, plain industrial HTML operator desk

The scanner never steals work. A stale classification means: read the provider result and the original coordination thread, then resume or take over only when that readback confirms inactivity.

## Quick start

Python 3.10+ is sufficient; there are no third-party runtime dependencies.

```bash
cd tools/swarm_claim_recovery_20261015

python claim_recovery.py --db private/claims.sqlite3 init
python claim_recovery.py --db private/claims.sqlite3 ingest \
  --input examples/generic-events.jsonl
python claim_recovery.py --db private/claims.sqlite3 scan
python claim_recovery.py --db private/claims.sqlite3 render \
  --output out/claim-recovery-desk.html
```

The generated HTML is self-contained and has no network dependency.

## Source layout

- `claim_recovery.py` — stable executable entry point
- `claim_recovery_core.py` — event schema, normalization, reference and checkpoint safety
- `claim_recovery_schema.py` — SQLite schema, WAL/durability settings and anomaly storage
- `claim_recovery_reduce_claim.py` — claim and guarded takeover transition rules
- `claim_recovery_reduce_owner.py` — owner-only heartbeat/checkpoint/block/release/complete rules
- `claim_recovery_reducer.py` — deterministic event replay into current operation state
- `claim_recovery_store.py` — idempotent ingest, lookup and stale-work classification
- `claim_recovery_format.py` — atomic files plus text/CSV output
- `claim_recovery_view.py` — self-contained industrial HTML operator desk
- `claim_recovery_resume.py` — bounded recovery packet generation
- `claim_recovery_commands.py` — complete command implementations
- `claim_recovery_cli.py` — parser and process boundary
- `examples/generic-events.jsonl` — content-free restart and idempotency example

The modules remain ordinary sibling files, so copying this directory to a recovery host is sufficient; no package installation is required.

## Operating flow

### 1. Claim one whole operation

```bash
python claim_recovery.py --db private/claims.sqlite3 claim \
  --operation PRODUCT-PORTABILITY-20261015 \
  --actor seat-42 \
  --source-ref thread:1792117826.582189 \
  --summary "Complete portable build, actual opening, and customer handoff" \
  --lease-minutes 90
```

A second actor cannot silently replace a live owner. Conflicting claim events remain in the audit log without changing current state.

### 2. Retain a meaningful checkpoint

```bash
python claim_recovery.py --db private/claims.sqlite3 checkpoint \
  --operation PRODUCT-PORTABILITY-20261015 \
  --actor seat-42 \
  --ref drive:file-id \
  --ref git:branch-or-commit \
  --sha256 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
  --bytes 741852963 \
  --summary "Complete source and first operable build retained"
```

Checkpoint metadata is bounded and deliberately rejects payload-like keys such as `body`, `content`, `credential`, `payload`, `secret`, and `token`. Signed or credential-bearing URL query parameters are also rejected. Store stable references, hashes, sizes, heads, and concise recovery notes.

### 3. Scan current ownership

```bash
python claim_recovery.py --db private/claims.sqlite3 scan \
  --watch-minutes 30 \
  --recovery-minutes 90 \
  --abandoned-minutes 240
```

Classifications:

| Class | Meaning |
|---|---|
| `active` | Fresh owner activity. Continue current ownership. |
| `watch` | Quiet long enough to inspect, but not a takeover candidate. |
| `recovery_candidate` | Read the provider result and original thread; resume only if inactive. |
| `abandoned` | Guarded takeover may be appropriate after provider readback. |
| `blocked` | A concrete blocker is recorded; resolve it or explicitly recover the operation. |
| `complete` / `released` | Terminal state. Completed operations are immutable; released work can be claimed as a new generation. |

For shell integration, `scan --exit-if-actionable` exits `3` when recovery, abandonment, blockage, or an event anomaly exists. This is an observability primitive, not a scheduler.

### 4. Generate a complete recovery packet

```bash
python claim_recovery.py --db private/claims.sqlite3 resume \
  --operation PRODUCT-PORTABILITY-20261015 \
  --output private/PRODUCT-PORTABILITY-20261015.resume.json
```

The packet contains current generation, owner, status, classification, last durable checkpoint, the last twenty metadata events, anomalies, and the exact expected generation for a guarded takeover.

### 5. Take over only after provider readback

```bash
python claim_recovery.py --db private/claims.sqlite3 takeover \
  --operation PRODUCT-PORTABILITY-20261015 \
  --actor recovery-seat \
  --expected-generation 1 \
  --reason "Original provider and coordination thread read back inactive"
```

The command rejects:

- an incorrect expected generation
- a still-live lease
- a completed operation
- a released operation that should be acquired with ordinary `claim`
- a takeover without a reason

A successful takeover advances the generation and preserves the last durable checkpoint.

## Event stream

`ingest` accepts newline-delimited JSON. Blank lines and `#` comments are ignored. Ingestion is atomic, deterministic, and idempotent by `event_id`.

```json
{"event_id":"provider:channel:message","operation_id":"EXAMPLE-WORK","kind":"claim","actor":"worker-a","occurred_at":"2026-10-15T20:00:00Z","lease_minutes":90,"source_ref":"thread:example","summary":"Complete the whole operation"}
{"event_id":"provider:channel:checkpoint","operation_id":"EXAMPLE-WORK","kind":"checkpoint","actor":"worker-a","occurred_at":"2026-10-15T20:45:00Z","source_ref":"thread:example","summary":"Complete source retained","checkpoint":{"refs":["store:source"],"sha256":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef","bytes":123456}}
```

Supported event kinds are `claim`, `takeover`, `heartbeat`, `checkpoint`, `block`, `release`, and `complete`.

### Required fields

- `operation_id`: stable identifier containing letters, numbers, `.`, `_`, `:`, `/`, or `-`
- `kind`: one supported event kind
- `actor`: current worker or seat identifier
- `occurred_at`: ISO-8601 timestamp with UTC offset or `Z`

### Useful optional fields

- `event_id`: provider message ID or another immutable ID; otherwise derived from canonical event content
- `generation`: ownership generation
- `expected_generation`: required for takeover events
- `lease_minutes`: 5 through 10,080
- `source_ref`: stable coordination/source reference
- `summary`: concise current state
- `reason`: required for takeovers and useful for blocks/releases
- `checkpoint`: bounded JSON metadata containing references, hashes, sizes, heads, stages, or commands

If the same `event_id` arrives with identical content, it is a no-op. If it arrives with different content, the whole ingestion transaction fails.

## Commands

```text
init        Initialize the SQLite ledger.
ingest      Ingest JSONL events idempotently.
claim       Claim a new/released operation or renew the current owner.
takeover    Advance ownership generation after lease expiry and provider readback.
heartbeat   Record current-owner activity.
checkpoint  Record durable recovery references.
block       Record a concrete blocker.
release     Release an operation without marking it complete.
complete    Mark the current generation complete.
scan        Classify and export the current operation desk as table, JSON, or CSV.
audit       List rejected/conflicting events as table, JSON, or CSV.
resume      Emit a complete recovery packet for one operation.
render      Write the self-contained HTML operator desk atomically.
```

Every mutating command uses `BEGIN IMMEDIATE`, SQLite WAL mode, full synchronization, a ten-second busy timeout, deterministic state rebuilds, and atomic output replacement.

## Focused operated course

The maintained source was exercised end to end with one complete recovery course:

- first JSONL ingestion inserted four events
- repeated ingestion produced four idempotent duplicates and no state change
- a conflicting actor claim was retained as `CONFLICTING_CLAIM` while the original owner remained intact
- a takeover at 30 minutes was rejected against the 90-minute live lease
- a guarded takeover after lease expiry advanced generation `1 -> 2`
- the new owner retained the original source/build checkpoint and completed the operation
- JSON scan and resume packet were reopened and checked
- the HTML desk was rendered and visually inspected at 1440px and a forced 390px responsive layout

No live customer, prospect, email, or commercial payload belongs in this repository path. Live provider event files, databases, rendered desks, and recovery packets stay under ignored `private/` or `out/` directories.
