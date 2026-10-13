# Standalone Object sessions in the SF101 recovery workspace

The existing SF101 workspace can inspect a host-declared standalone Object
session, create its encrypted backup, authenticate that backup, and restore or
reopen its original canonical state. These actions use the original
`ObjectSessionRecovery` SDK and the same workspace request queue as merchant
capture, publisher/fleet preparation and remote recovery.

This workflow preserves the Object session's definition, configuration history,
evidence, assemblies, native lease history and original zero-payment state.
It does not acquire data, make a payment, recreate a missing source, relocate a
session, or start its execution after restore. The underlying engine checks
which free sessions are eligible. The browser reports its actual native result.

## Declare the original source

Keep the existing host configuration schema and required profile fields from
[GUIDE.md](GUIDE.md). Add `objectSessions` to the relevant profile:

```json
"objectSessions": [
  {
    "id": "original-events",
    "label": "Original free events session",
    "directory": "/srv/object-state/sessions/events",
    "stateRoot": "/srv/object-state",
    "include": [
      "/srv/object-state/policy.json",
      "/srv/object-state/signers"
    ],
    "bundle": "/private/backups/events-original",
    "sessionId": "THE-ACTUAL-RETAINED-SESSION-ID",
    "kinds": ["snapshot", "verify", "restore"]
  }
]
```

Replace every path and the session ID with the actual source. `include` lists
the source's existing native inputs; the native inspector determines the complete
required coverage. The session directory and included paths belong beneath
`stateRoot`. The fixed encrypted `bundle` must be a child of the profile's
declared `bundleRoots` or `downloadRoot`. Keep source and bundle outside the
workspace and every profile's operation journals. Existing canonical private
path checks apply.

A declaration restricted to `verify` and/or `restore` must also contain
`expectedRecordSha256`, the exact original record returned by its completed
backup. A declaration permitting snapshot can obtain that hash from its actual
native result. An optional declared record hash is enforced, not a hint. Each
declaration selects one fixed bundle; add a new trusted declaration if another
backup destination is required.

The existing profile's `passEnv` names its passphrase environment variable.
Provision its value through the original host secret facility before serving.
The browser, CLI selection JSON and MCP arguments never accept a passphrase,
arbitrary runtime, source path or restore path.

Start the existing listener with the same state directory:

```sh
starforge merchant-recovery-remote workspace serve \
  --config /private/recovery/workspace.json \
  --directory /private/recovery/operator --port 8481
```

Use its printed local capability URL. The **Standalone Object recovery** panel
appears only for profiles with declared sessions. Existing merchant and remote
panels remain available.

## Inspect, review and create a backup

1. Select the original declared session and **Create encrypted Object backup**.
   Keep the generated request ID, or enter the intended stable original ID.
2. Choose **Inspect current source**. Read its actual session/configuration
   identities and full native evidence when needed.
3. Stop the source writers through their original application procedure.
   Confirm the displayed quiescence acknowledgement and keep those writers
   stopped while the backup runs.
4. Choose **Review selection**. Read the exact source, backup, original request
   and native review identity; confirm that review.
5. Choose **Start reviewed request**. The workspace saves that request before
   invoking the original native command. Read the request until its native
   completion is retained.

Inspection is a fresh observation. A prepared review is retained with the exact
native evidence it produced. Start loads that saved review and passes its native
`expectedReviewSha256` to the original snapshot command; it does not replace
the reviewed observation with another one. A changed source causes the native
selection check to fail. Prepare a new explicit review if the source changed.

The native backup obtains its original Object BACKUP lease, authenticates the
complete capture, and releases its owned work after child cleanup. A completed
request displays the actual record hash, process outcome, publication errors,
native reopen errors and cleanup errors separately. An accepted HTTP request or
a process exit alone is not a completed backup.

## Authenticate and restore or reopen

Use **New review: verify this backup** from a completed request, or choose
**Verify Object backup** and enter the exact original record SHA-256. The native
engine authenticates that record and complete encrypted contents.

For **Restore or reopen original Object state**, select the same exact record.
Review the original canonical state root and session identity. Restore performs
another authentication before the original SDK restore call. The native engine
publishes to its permitted absent/empty destination, or reopens the same marked
backup while preserving later native state. It refuses a populated unrelated or
unmarked destination. The workspace never removes the live source to make a
restore possible; an operator must use the source's actual recovery procedure.

The result reports `executionStarted:false` for the native restore. Reopening
the same backup does not rewind later assemblies or invoke another acquisition.

## Continue after a lost response or interruption

Keep the same workspace directory, host declaration, bundle, request ID and
passphrase environment. Read the original request first. Its complete saved
review, attempted native evidence and error remain available.

**Reopen exact request** loads that record. Confirm the displayed saved selection
and current attempt before choosing **Continue selected attempt**. Snapshot
continuation requires a fresh quiescence acknowledgement. It uses the original
saved review and native operation semantics, not a replacement request.

The continuation binds all three values:

- Original profile and request ID.
- Exact outer `expectedReviewHash`.
- The `afterAttempt` number just read from the original request.

An older `afterAttempt` returns the newer retained request without dispatching
again. A completed request also returns its retained outcome. Repeating Start
for an existing Object request only reads its original record, including an
interrupted or PREPARED request; continuation is explicit.

Browser refresh retains only selection fields in session storage. Confirmation,
quiescence and a prepared review are not silently restored. Source/declaration
changes clear the selected confirmation. A failed response is never automatically
retried. Stop asks the owned execution to abort and drain; native publication may
already have completed, so read the final native facts before another action.

## CLI and MCP through the same listener

Read the declared source:

```sh
starforge merchant-recovery-remote workspace object-session \
  --config /private/recovery/workspace.json --directory /private/recovery/operator \
  --profile merchant-a --object-session original-events
```

A complete private snapshot selection is:

```json
{
  "profileId": "merchant-a",
  "action": "object-snapshot",
  "id": "original-events-backup-01",
  "objectSessionId": "original-events",
  "quiesced": true
}
```

Review and start this unchanged file with the existing `review` and `start`
commands and returned outer `--expected-review-hash`. For verification or
restore, change the action to `object-verify` or `object-restore`, use a new
explicit request ID, replace `quiesced` with `expectedRecordSha256`, and review
that complete selection.

Read and explicitly continue an interrupted snapshot:

```sh
starforge merchant-recovery-remote workspace request \
  --config /private/recovery/workspace.json --directory /private/recovery/operator \
  --profile merchant-a --id original-events-backup-01

starforge merchant-recovery-remote workspace resume \
  --config /private/recovery/workspace.json --directory /private/recovery/operator \
  --profile merchant-a --id original-events-backup-01 \
  --expected-review-hash RETURNED_OUTER_REVIEW_HASH --after-attempt 1 --quiesced
```

Use the actual observed attempt, not the example's number. Omit `--quiesced`
for Object verification/restore continuations. Read complete native evidence with
`workspace object-evidence --sha256 RETURNED_EVIDENCE_SHA256` and the same
configuration/directory.

The connected merchant client exposes `merchant_recovery_object_session` and
`merchant_recovery_object_evidence`. Its original review/start tools accept all
three Object actions. `merchant_recovery_resume` accepts the exact review hash,
observed attempt and snapshot quiescence fields. Workspace aliases remain
host-declared and every call verifies the existing listener's native identity.

## Retain the complete workspace

Preserve the full workspace directory, including requests, `object-reviews`
and `object-session-evidence`; retain the original host configuration and
encrypted bundle alongside the original source lineage. Evidence files are
immutable, content-addressed complete native JSON within a 16 MiB per-file
limit. Request summaries retain the evidence hashes and compact result facts.
Read-only workspace mode can read saved state/evidence but does not create new
inspection or review evidence.

A later host move must use the original engine's supported canonical restore
requirements. Do not fabricate old device/inode identities, session metadata or
payment history. The operator shows the actual current native state and the
original saved request outcome as separate records.

## Compare authenticated backup editions

Use [Object backup comparison](./OBJECT_COMPARISON.md) to authenticate two exact records from this original session, retain their complete inventories and review every change before selecting the separate restore action. It uses the same host declarations and saved request queue; comparison never restores or acquires state.
