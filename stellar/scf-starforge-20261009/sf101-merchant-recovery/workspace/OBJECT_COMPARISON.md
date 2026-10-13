# Compare two original Object backups

The standalone Object comparison authenticates two complete encrypted backup editions of the same original session. It retains both original records, full verification results, a complete member union and differences in session/configuration/checkpoint history. The existing restore workflow remains a separate reviewed action.

## Host selection

Use the original SF101 workspace configuration and add two entries to its existing `objectSessions` array. Each entry selects an original backup directory under the profile's approved bundle roots, the same canonical session directory and state root, and the same actual session ID. Both need `"verify"` in `kinds`. A declaration may pin `expectedRecordSha256`; if present the caller must use exactly that record.

```json
{
  "id": "before-edition",
  "label": "Before maintenance",
  "directory": "/srv/object-state/session",
  "stateRoot": "/srv/object-state",
  "include": [],
  "bundle": "/srv/backups/before",
  "sessionId": "ACTUAL_ORIGINAL_SESSION_ID",
  "kinds": ["verify"],
  "expectedRecordSha256": "ACTUAL_64_HEX_RECORD_SHA256"
}
```

Create an equivalent `after-edition` declaration pointing to the second actual bundle and its actual record hash. The example placeholders must be replaced with native identities. The profile supplies its original `passEnv`; browser and MCP parameters cannot supply paths, environment names or passphrase values. Direct SDK callers can select distinct environment names for the two editions.

A comparison permits original definition/configuration hashes to differ and reports those changes. It requires the same actual session ID, session directory and canonical state root. It never substitutes an edition from another source to create a plausible diff.

## Browser workflow

Open the existing recovery workspace. In **Compare Object backups**, select the before and after declarations and both exact record hashes. Review the selection under one stable request ID. Confirm that exact review and choose **Authenticate and compare**.

The original workspace records the request before native dispatch. Both native verifications authenticate every encrypted member through the maintained recovery engine. The resulting card distinguishes a clean completed comparison from process failure, cancellation, partial verification and artifact publication failure.

The card offers the complete native JSON, HTML report and Markdown report. Downloads verify the original byte count and SHA-256 in the browser. HTML is downloaded as a standalone file; untrusted source labels are not injected into the operator page. Every inventory member remains in the saved payload; indexed comparisons refer to those full original records.

Reviewing a selection prepares only the queue input. `authenticated:true` is returned only after both complete native verifications and their same-source checks. Reading a saved result or report does not rerun authentication against today's files.

## Reopen and interruption

Read the same profile/request ID after a missing start response. A repeated start returns that original request. An unfinished attempt requires explicit continuation with the saved review hash and the observed attempt number. An older attempt selection returns the current request rather than dispatching again. Source authentication is read-only, but retained failed outcomes and partial completed sides are kept as immutable artifacts.

Changing a profile, declaration or record clears the browser confirmation. Comparison does not delete, restore, acquire or pay for any Object state. Select a desired edition through the separate existing `object-restore` review when restoration is actually intended.

## CLI and MCP

A private selection file contains:

```json
{
  "profileId": "original",
  "action": "object-compare",
  "id": "comparison-maintenance-1",
  "beforeObjectSessionId": "before-edition",
  "afterObjectSessionId": "after-edition",
  "beforeExpectedRecordSha256": "ACTUAL_BEFORE_64_HEX",
  "afterExpectedRecordSha256": "ACTUAL_AFTER_64_HEX"
}
```

Use existing `workspace review --selection ABS_JSON`, then `workspace start --selection ABS_JSON --expected-review-hash HASH`. Read `workspace request --profile original --id comparison-maintenance-1`. The same existing `resume` command accepts `--expected-review-hash HASH --after-attempt N` for an explicit interrupted continuation.

Read a complete artifact with:

```text
workspace comparison-artifact --config ABS_HOST_CONFIG --directory ABS_WORKSPACE
  --profile original --id comparison-maintenance-1
  --kind result --sha256 EXACT_RETURNED_ARTIFACT_SHA256
```

The result envelope contains `text`, exact original `bytes`, `sha256` and `mediaType`. `kind` is `result`, `html` or `markdown`. Preserve the returned complete text when saving outside the application; the envelope itself has a different hash.

MCP uses existing `merchant_recovery_review/start/request/resume/cancel` and the new `merchant_recovery_comparison_artifact`. The comparison selection has the same fields as above. Artifact reads require workspace alias, profile, original request ID, kind and exact returned artifact digest. Model-facing requests never include native paths or passphrase environment values.

## Direct native SDK

```js
import {ObjectSessionRecovery} from './node/index.mjs';
const recovery = new ObjectSessionRecovery({runtimeDirectory: absoluteSf88Runtime});
const result = await recovery.compare({
  before: {bundle: beforeBundle, expectedRecordSha256: beforeRecord,
           passphraseEnv: 'BEFORE_BACKUP_PASSWORD'},
  after: {bundle: afterBundle, expectedRecordSha256: afterRecord,
          passphraseEnv: 'AFTER_BACKUP_PASSWORD'},
  signal
});
```

The result exposes `native`, `process`, `completionReported` and `ok`. `ObjectSessionComparisonError.result` preserves failed completion facts and any completed partial side. The runtime owns cancellation and waits for the original child to close before cleaning its private logs.

Native Object CLI:

```text
node object-cli.mjs session-backup-compare
  --before-bundle ABS_BEFORE --before-expect SHA256
  --after-bundle ABS_AFTER --after-expect SHA256
  --before-pass-env BEFORE_BACKUP_PASSWORD
  --after-pass-env AFTER_BACKUP_PASSWORD
```

Optional `--result-file ABS_NEW_PRIVATE_JSON` writes the whole result to a new private file. The SDK uses this original native result-file channel so complete records do not inherit the smaller stdout/log budget.

## Size and custody

The comparison retains complete authenticated metadata, not decrypted secret file contents. Both full record inventories remain present; member union indices avoid repeating large maps. The native result channel permits up to255 MiB; the complete SDK result artifact permits256 MiB including process facts. Oversized results are rejected explicitly, never truncated into a successful comparison. Normal queue records retain compact summaries and artifact identities within their existing2 MiB bound. Explicit artifact transport supports the full UTF-8 envelope separately from ordinary list replies.

The comparison does not contain the encrypted backup bytes. Preserve the original backup directories or use the existing complete encrypted-bundle export/receive product for portable ciphertext custody. Keep passphrases separate from all comparison and transfer artifacts.

## Source and execution status

The comparison extends the maintained Object recovery engine, existing workspace queue, original SDK process lifetime and browser/MCP/CLI surfaces. Pure source checks and native execution are separate evidence. A saved comparison is authenticated only when its actual native result reports both verifications complete with a clean subprocess outcome.

## Carry the original comparison into Support

A host profile with an existing `casesDirectory` can capture its saved `object-compare` request through the existing Support panel or `workspace support-review` selection. Use the original request ID, review hash and observed attempt, an existing case revision, observation slot and stable transfer ID. Review and save retain the complete original request, every referenced JSON/HTML/Markdown artifact across all attempts and the ordered local history. Prepared, partial, failed and complete observations remain distinct.

The Support capture uses **OBJECT_COMPARISON** and preserves both external bundle identities. It does not rerun native verification, decrypt a backup, attach encrypted bytes or claim that a saved authentication result describes the current path contents. Its complete three-file transport is capped at 64 MiB including base64 wrappers, within the existing 192 MiB case runtime. A larger native artifact is rejected without dropping any history; keep its full original comparison downloads and native delivery.

The existing Support handoff and complete case-source export carry every retained capture and case revision through the maintained independent receiver. See [Recovery and comparison operations in an existing Support case](RECOVERY_SUPPORT.md) for exact commands, limits, same-request continuation and rendered-browser acceptance.

## Include both encrypted editions in the handover

A saved clean completed comparison can now select `sourceSide: "before"` or `"after"` for an original `object-bundle-export` request. Each export freezes the same complete request/artifact cohort and independently authenticates its selected bundle. Read the exact pair after both finish, then attach it to the saved comparison Support case through one original SF49 delivery containing both complete archive files.

The pair requires the same source request bytes, review, attempt and native comparison, including both original record hashes. It cannot combine unrelated backups. Cases without commissioning terms retain the complete standalone export/receive path; binary case attachment uses only the existing commissioned source-delivery service. See [Portable Object recovery bundles](RECOVERY_BUNDLES.md#carry-both-encrypted-editions-from-one-comparison) for complete commands, interruption recovery, limits and independent receiving. Comparison evidence remains unchanged, and authentication/restore custody stays explicit.
