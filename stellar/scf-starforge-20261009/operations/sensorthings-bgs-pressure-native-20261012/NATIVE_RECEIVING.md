# Receive the original BGS pressure source

The original operation is `SCF_SENSORTHINGS_BGS_PRESSURE_1B40_20261012`. Keep it in its assigned SensorThings workspace and receiving operator. The source is a separate historical BGS pressure window, not a second Hamburg edition.

## Exact inputs and source contracts

| Input | Identity |
| --- | --- |
| Native recording | `native-recording.json` |
| Complete bytes | `313277` |
| SHA-256 | `e04a3932da707a2a90a68fc87b97c4af72337c09ec5a23f7c072b933a1b855ac` |
| Native-consumable responses | 10 |
| Selected observation pages | 64 + 32 rows |
| Complete selected point count | 96 |
| Selected Datastream | Numeric SensorThings ID 1 |
| Source query | 1 June 2026 UTC, end excluded at 2 June 00:00 |
| Native transport | `stellar-forge.sensorthings-connector-responses.v1` |
| Selected receiver | `receive-bgs.mjs` / `receiveBgsPressure` |

The full source directory also retains four qualification-only responses and their complete receipts. They do not enter the ten-response native recording. Do not replace the exact native catalogue URL with a differently encoded but superficially equivalent query: the original recording binds literal request URLs and repeated-URL positions.

## Use the maintained native receiver

The source entry is `stellar/scf-starforge-20261009/sf30-seller-sdk/sensorthings/receive-bgs.mjs`. From the selected complete source checkout:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/sensorthings/receive-bgs.mjs \
  --workspace /absolute/original/bgs-sensorthings-workspace \
  --recording /absolute/source-package/native-recording.json
```

The normal distribution command is `sensorthings-receive-bgs` when this contribution is included in that exact installed release. Use the original maintained distribution builder and runtime configuration; do not edit a previously frozen installed package in place.

The source entry pins the whole original recording size and SHA. It opens the original `openSensorThingsWorkspace` with the retained `recordedTransport`. A fallback provider fetch throws an error. It runs these actual original actions with deterministic operation IDs:

1. `source.add`: original BGS service and retained source licence.
2. `catalog.capture`: exact three-row Datastream catalogue page.
3. `plan.create`: actual `/value/0` occurrence, checked as numeric stream ID 1; original two-page observation query; no HistoricalLocations acquisition.
4. `capture.start`: the existing native queue and complete source traversal.
5. Native summary and complete recording-closure checks.

The receiver requires 96 unique numeric observations, no duplicate/conflicting/unkeyed observation IDs and complete consumption of the selected ten responses. It returns the actual workspace, catalogue, plan, capture and source-edition IDs. Its default final state is `NATIVE_SOURCE_RECEIVED_REVIEW_PENDING`.

This is a receiving command for source already acquired. Its native timestamps are intake times, while the retained source response timestamps remain the actual connector receipt times. It never labels a successful source import as an independently verified measurement or a completed viewer deployment.

## Programmatic use in the existing application

Import the exact installed module or the corresponding source entry:

```js
import {receiveBgsPressure, BGS_PRESSURE_RECORDING}
  from '@tokenjunkielabs/starforge-merchant/sensorthings/receive-bgs';

const result = await receiveBgsPressure({
  directory: '/absolute/original/bgs-sensorthings-workspace',
  recordingFile: '/absolute/source-package/native-recording.json',
  resume: false,
  onProgress: event => process.stderr.write(JSON.stringify(event) + '\\n')
});
console.log(BGS_PRESSURE_RECORDING, result);
```

Optional `sourceInboxDirectory` and `buyerWorkspaceDirectory` bind the existing host-selected source receiving and buyer directories. They do not create a new merchant, substitute a different source or manufacture a buyer receipt. The function opens and closes its own original workspace and file-access objects.

The generic `sensorthings` CLI does not accept a made-up `--recording` option. Use this actual receiver or the published `recordedTransport` and original core API.

## Interrupted operation recovery

If the process was interrupted, reopen the **same path and recording** with `--resume`. The original operation IDs and source request/response receipts are reused. Completed actions are returned from their existing operation records.

An incomplete queue is resumed only with `retryFailed:false`. An actual retained failed request stops the driver and requires inspecting its saved source evidence. Do not use a new operation ID, consume the next same-URL response as a replacement, launch a second writer or start another acquisition just to make the status green.

The original transport reconstructs consumed response positions from retained native receipts. Its opening and closing reads of Datastream 1 remain distinct original occurrences even though their body hashes agree. Exact URL and occurrence binding also survives a native restart.

An incomplete original capture returns `INCOMPLETE_ORIGINAL_CAPTURE` with the current original queue facts and a retained receipt. The CLI exits with status 2 for that condition; it does not claim a complete source edition.

## Responsible source review and complete export

Read the actual returned edition and its original source warnings before preparing acceptance. The following is an input shape, not a completed review:

```json
{
  "schema": "stellar-forge.sensorthings-bgs-review.v1",
  "operationId": "SCF_SENSORTHINGS_BGS_PRESSURE_1B40_20261012",
  "editionId": "ACTUAL RETURNED NATIVE EDITION ID",
  "decision": "accept",
  "actor": "RESPONSIBLE RECEIVING OPERATOR",
  "note": "The complete original pressure query, unit, time and source quality evidence were reviewed. This is a historical point series; no sample validity interval, continuous coverage or independent calibration result is inferred.",
  "acknowledgeIssues": []
}
```

Bind `editionId` to the actual completed native source edition. Populate `acknowledgeIssues` only from the exact issue codes the operator actually reviewed. The original engine rejects acceptance if required source warnings or row issues are omitted.

Reopen the same command with `--review /absolute/operator/bgs-review.json`. It reuses the original completed intake, records the exact review, prepares the existing SF30 `observations` dataset and exports the complete source edition. It returns both file selections and their native byte/hash identities:

- Source transfer: `{kind:"transfer", id: ACTUAL_EXPORT_ID}`.
- Dataset: `{kind:"dataset", id: ACTUAL_DATASET_ID}`.

The full source archive includes the native edition, original source objects and original review evidence through the existing exporter. Its archive identity exists only after that actual export; the source Git manifest and recording SHA are not archive receipt IDs.

Use the maintained file-list/read and retained-download contracts for complete delivery. Keep the actual export ID, manifest SHA, expected bytes and selected original file identities. Reopen the same destination and original download checkpoint after interruption. The native per-read maximum is 192 KiB; a caller may select the existing 64 KiB default. Do not replace a complete archive with only its manifest.

## Join the original Helgoland operation

The BGS native edition can be selected by the original SensorThings analysis project after import. Use the **actual returned edition ID**, which is distinct from this source operation name and from the Functions V8 numerical-summary schema.

The selected stream is scalar `OM_Measurement`, unit `mbar`. It is eligible for the original viewer's numerical path once the retained analysis adapter checks the real source type. The original Thing/Location/FeatureOfInterest graph provides its map context, including the publisher's location qualification. The companion domain correction preserves the retained parent page on inline child relationships; it does not request new provider data or change source values.

Keep the BGS numerical diagram separate from the Hamburg categorical event lane. The released Helgoland numeric connector uses a numerical conversion; category strings must not be sent to it as measurements. A connecting line between these observed pressure points is a chart choice. No source validity period is supplied, and no unobserved start/end point is inserted.

39DA's existing viewer deployment/browser operation, 6966's analyst UI/publication operation and the original managed Desk own the downstream native journey. This package does not start another browser, create another analyst store or claim their native completion.

## Fresh receiving and durable handover

After actual source review/export and analyst publication, deliver the complete selected source archive plus the original analysis project/publication through their maintained receiving paths. Restore into a fresh destination using the original portable receiver, retain source and publication identities, and create any new receiving review as a new local decision. An imported prior acceptance remains historical evidence.

The selected source recording and all original qualification evidence remain in this Git package even after native intake. The same complete originals should remain reachable from the customer handover; a 32-file limit in another importer is a reason to use a complete original archive member, not to omit source evidence.

## Verification boundary

The full public source was actually acquired, each body was hash-bound to its complete connector download, and the 96-row source calculation ran in Functions V8. The new receiving entry passed a V8 syntax parse after removing module-only declarations for that parse. A native Node import, original source intake, dataset/export, original Helgoland diagram and fresh receiving have not run in this package.

Keep those pending execution stages explicit until their actual original operation returns its receipts. No runtime fixture or fabricated native edition is included.
