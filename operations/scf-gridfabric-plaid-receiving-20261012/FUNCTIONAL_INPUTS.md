# Complete GridFabric functional receiving inputs

This is a complete, deterministic **TokenJunkieLabs-authored functional dataset** for the original GridFabric/Plaid operator application. The files contain no readings from physical devices, vendor account, licensed Plaid schema, live VEN or VTN. The public examples retain their separate source and classification.

The source generator emits all 42 files declared in `functional-input-manifest.json`: the complete original/correction pair, row lineage, three complete expected report responses, four original comparison windows, reviewed local callback bindings, every callback body, public examples, and the complete receiving input. Every generated file has an exact byte length and SHA-256. The generator reopens matching existing files and stops if any existing file differs.

## Generate and operate the original application

From the complete repository-shaped source:

```sh
node operations/scf-gridfabric-plaid-receiving-20261012/generate-functional-input.mjs /absolute/private/gridfabric-input
node operations/scf-gridfabric-plaid-receiving-20261012/run-receiving.mjs /absolute/private/gridfabric-receiving.json
```

The second command is the original native receiving entrypoint owned by the application. Its configuration provides `sourceRoot`, `sourceCommit`, `outputDirectory` and `inputFile`; select the emitted absolute `gridfabric-functional-input.json`. Use its maintained guide for the actual Node SQLite/HTTP runtime and any already available browser paths. The generator opens no workspace, starts no server and performs no provider operation. The receiving entrypoint preserves one original native workspace, step journal and actual returned IDs.

The configured management/device addresses in this functional input are explicitly nonoperational loopback placeholders. No step calls `begin_management`, `begin_device_action`, or an HTTP dispatch action. The application retains the prepared management operation and queued device actions for inspection; a live connection and actual dispatch would be a separate reviewed operating decision.

### Programmatic generation

The source exports:

```js
createFunctionalFiles({
  hash,             // exact UTF-8 text -> {bytes, sha256}
  canonical,        // unchanged original model.canonical
  publicExamples,   // complete contracts/management-examples.json
  publicContract,   // complete contracts/plaid-public-contract.json
})
// -> {files: [{key, path, name, mime_type, bytes, sha256,
//              classification, content}], summary, input}
```

The CLI supplies Node's original SHA-256 and the retained application's `model.cjs`. A connected JavaScript host can evaluate the same pure exported function with those existing dependencies. Preserve the full `content` of every returned file; the summary and manifest are not substitutes for the source rows or complete expected responses.

## Portfolio and exact time semantics

| Property | Complete authored input |
|---|---|
| Devices | Eight explicit fictional devices |
| Range | 2026-08-01 00:00:00 UTC through 2026-09-01 00:00:00 UTC, end exclusive |
| Source intervals | 900 seconds, 2,976 intervals per device |
| Kinds | Interval-average real power, interval real energy, opaque status objects |
| Original records | 71,424: 23,808 for each kind |
| Correction records | 96: 32 for each kind |
| Original channels | All 24 device/kind channels |
| Corrected channels | Twelve channels for devices 1, 3, 5 and 7 |
| Source units | Devices 1–4: W/Wh; devices 5–8: kW/kWh; status remains an object |
| Output units | W, Wh and unchanged status |
| Report query bounds | Start 1785542400, end 1788219900, inclusive, granularity 900 |
| Full corrected reports | Three separate specifiers, eight rIds and 23,808 rows each |

Source timestamps are explicit epoch seconds in UTC. Power and energy mappings use interval-start labels; status mappings use exact instantaneous timestamp labels. An energy row is the exact energy in its quarter-hour, while a power row is the average power across that original interval. The source preserves the original decimal strings, including their zero suffixes. Original power/energy calculations use integer scaling; they do not reinterpret average power as an instantaneous sample or fill a missing observation with zero.

The original power formula is documented in each source's provenance. It has a distinct base per device, four daily load bands, an explicitly authored seven-day cycle and a twelve-quarter cycle. Interval energy equals the integer watt level divided by four. Those are declared construction rules for this functional dataset.

## Corrections and per-row lineage

The correction file is a separate immutable edition whose provenance names the complete original file SHA-256. Every correction row retains both `corrects_record_id` and the exact original record number. The lineage file supplies the source and correction JSON pointers, complete original row, complete corrected row, channel and interval.

The unchanged importer subsequently adds its real returned `source_id`, `source_row_id`, `original_record`, and complete `original_row`. Every original row already has a stable authored record ID. Report calculation records retain the actual selected original source-row IDs; no synthetic runtime identity is embedded in the fixture.

| Window | Device | UTC interval starts, inclusive | Per-row power change | Per-row energy change | Entire window energy change |
|---|---|---|---:|---:|---:|
| 1 | 01 | Aug 7, 10:00–11:45 | +120 W | +30 Wh | +240 Wh |
| 2 | 03 | Aug 14, 14:00–15:45 | −80 W | −20 Wh | −160 Wh |
| 3 | 05 | Aug 21, 05:00–06:45 | +240 W | +60 Wh | +480 Wh |
| 4 | 07 | Aug 28, 18:00–19:45 | −160 W | −40 Wh | −320 Wh |

Each window has eight quarter-hour rows for every kind. Power and energy change coherently. Each corresponding status object changes its explicitly authored mode and manual-override value and adds the correction-window identity. The final portfolio energy is 14,532,288 Wh, compared with 14,532,048 Wh in the complete original edition.

The corrected mapping lists `correction` before `original` only for devices actually present in the sparse correction. The other four devices retain the original-only mapping. The source IDs in the receiving input are references to the actual import results, resolved by the original receiver. No source without a matching device/channel is added to an entry.

## Exact original import and mapping contract

The mixed JSON source declares `rows_pointer: "/rows"`, row-relative JSON pointers for device, channel, kind, start, end, value, unit, quality and status, and `constants: {}`. The per-kind semantics are explicit:

```json
{
  "energy": "interval_energy",
  "power": "interval_average_power",
  "status": "status"
}
```

All 71,424 original rows and all 96 correction rows were passed through the unchanged source `model.sourceRecords` and `model.normalizeRow` before publication. Both sources have 100% valid rows and no duplicate device/channel/interval within an edition. This is a source-validation result, not a claim that a native workspace or installed application has completed.

The three full response files are complete expected results derived from the authored rows. They are not captured provider responses. The four original two-hour comparison reports each contain all three report families for one device and preserve the report-identifier grouping. The final three full queries each preserve their own specifier and eight rIds. The receiving entrypoint compares all seven original native response files structurally to their complete expected files and separately retains the actual output bytes and hashes.

## Callback and event receiving

The 51 declared steps use only the original native import, action and callback entrypoints. The source input contains 53 exact result checks. It exercises all sixteen documented callback types, including the empty-body heartbeat endpoint.

The event bodies are openly authored under a `functional` wrapper. A retained source document declares every JSON pointer, target category and response assumption. The first separate event is deliberately received before bindings and remains `UNPROJECTED_SCHEMA`. The following configuration binds the actual authored event source; it does not guess an unavailable licensed vendor wrapper.

The complete sequence retains:

- An explicit distribution with three events and its separate completion callback.
- Reviewed opt-in decisions for targeted and all-device events, and an opt-out for the third event.
- Exact category intersection: resource selectors plus the odd-device group select devices 1 and 3.
- Empty targets selecting all eight configured functional devices.
- Ramp-up and event-start callbacks, distinct interval identities, and unchanged authored signal objects.
- Duplicate interval/query callback bodies returning their original retained response without creating another application action.
- A higher event revision, an explicitly stale revision, an unavailable revision, and a conflicting definition for the same revision.
- Separate cancel, archive and complete callbacks. Cancel/archive do not synthesize END actions; only the original complete callback creates them.
- Opted-out interval handling, periodic report notices, registration notice, original error-body retention and the no-body heartbeat.

Status objects use `tjl.functional-device-status.v1` and remain unchanged in `wire.status`. The public repository does not provide the complete licensed telemetry-status object. The fixture demonstrates original-object custody and the application's report calculation; it does not assert that these authored keys satisfy a licensed Plaid installation schema.

## Public evidence remains separate

The public directory retains the exact already-published management/query examples and their original provenance. The management example records HTTP 200 with management `status: "OK"` and nested VTN code 452, “Invalid ID - invalid or inactive.” It remains explicitly classified as a published historical example. The native sequence only prepares that public management request; it does not create an actual response receipt or mark a VTN operation successful.

The small query-path example contains openly authored values at documented public paths, as its retained source already states. It is not labeled as an observed vendor request. The real full-range functional report files have their own independent authored classification and original-row lineage.

## Source and delivery boundaries

The functional generator, exact manifest and this guide are additive receiving-source leaves. They change no original core algorithm, native store, scheduler, lease, common distribution registry, or sender. The same original application receiver owns actual import/review/callback/report/export/cold-restore execution.

The public dataset contains only authored functional values and the retained public examples. It contains no mailbox receipt, account credential, internal execution directory, customer relationship history, physical-device identifier or private Utility input.
