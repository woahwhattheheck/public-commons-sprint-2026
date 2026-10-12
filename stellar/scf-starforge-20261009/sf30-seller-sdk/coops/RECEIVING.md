# Receive one original coastal source study

`receiving.mjs` exports `runCoopsOperatorJourney(initialPage, options)`. It operates the existing CO-OPS console through its real forms and original read/action APIs. It does not create a server, browser, provider, payment or replacement workspace.

The caller retains the existing managed process, browser profile, native admission record and private startup URL. Use the current source containing the retained draft, selection and preview effects.

## Exact callback contract

| Option | Required meaning |
| --- | --- |
| `workspaceUrl` | Actual current loopback console URL, including its legitimate private fragment when needed. The function removes that fragment from its durable outputs. |
| `outputDirectory` | One selected physical directory for this original operator operation. Reuse it on continuation. |
| `reviewEdition(packet)` | Independent review of the exact captured edition, full source package, source register and projected ledger. It must return the exact packet/source pins and an actual decision. |
| `restart(request)` | The original process owner's same-origin stop/reopen operation. Reuse `request.phaseKey` and the existing restart intent after interruption. Return the actual `{workspaceUrl, page?}`. |
| `operator` | Responsible receiving team; defaults to “Internal coastal source receiving.” |
| `capture` | Optional explicit source selection. Default: NOAA 9410230, January 1–7, 2025, water_level, metric, GMT, MLLW, six-minute interval. |
| `mappingFile` | Exact original mapping JSON path. Defaults to the published `examples/model-input-columns.json`; its byte identity is pinned in the first checkpoint. |
| `historical` | Optional selected historical window. Default: January 1, 2024–December 31, 2025, hourly_height, metric/GMT/MLLW. Pass `null` to omit this leg. |
| `operationTimeoutMs` / `captureTimeoutMs` | Original-operation and capture waiting limits; default 180 seconds and 30 minutes. Each wait reports progress and leaves the original state intact on failure. |
| `onProgress` | Optional callback receiving operation ID, phase and actual status. |
| `continuationNote` | Required when a concrete fix changes this module before an incomplete operation resumes. Prior source hashes and all original action IDs stay recorded. |

The source selection is frozen with the first checkpoint. A later call must use the same workspace origin, selected parameters and output directory. A completed call returns its original hash-verified result without resaving business work.

An interrupted issued request is reconciled through the same retained browser request and native operation ID before the continuation waits for completion. This covers an original request that had not reached reservation and a reserved operation that still needs its native continuation. Permanent native failures and unrelated pending requests remain explicit. Once a returned file has a retained complete-upload receipt, an already-issued comparison or receiving decision resumes from that receipt; the continuation does not restart chunk intake or replace a later draft.

For the optional multi-station study, exact review callbacks and the complete release/return/reopen sequence are documented in [STUDIES.md](STUDIES.md). The supplied [coastal receiving selection](examples/coastal-receiving-selection.json) enables that leg on the same original host.

An owner supplies these callbacks inside its existing controller:

```js
import {runCoopsOperatorJourney} from './coops/receiving.mjs';

const result = await runCoopsOperatorJourney(existingPage, {
  workspaceUrl: currentOriginalStartup.url,
  outputDirectory: selectedOperatorDirectory,
  operator: receivingTeam,
  reviewEdition: reviewActualCapturedPacket,
  restart: reopenSameOriginalWorkspace,
  onProgress: retainNativeProgress
});
```

The callback names in this example are supplied by that controller. They are not additional launchers.

## Independent review response

The reviewer receives:

- the exact native edition and its source SHA;
- the actual capture and original response register;
- a full package containing every retained accepted, unavailable and failed response;
- each original response byte count/SHA and source-observed time;
- the complete normalized observation ledger, written one page at a time;
- a limited sample for convenient inspection;
- exact filenames and SHA/byte receipts.

The returned decision must contain:

```json
{
  "packetSha256": "exact supplied review-packet hash",
  "editionId": "exact original edition ID",
  "sourceSha256": "exact edition source SHA-256",
  "status": "reviewed or follow_up",
  "reviewer": "actual responsible reviewer",
  "subject": "Source, datum and coverage review",
  "note": "actual substantive source findings",
  "performedAt": "actual review timestamp"
}
```

There is no default approval. The caller should persist the actual response before returning it. The function also retains that response before saving the original annotation, so a restarted controller reuses the accepted review.

For the default seven-day selection, 1,680 is the theoretical six-minute GMT grid. The actual source may contain fewer populated values, duplicate keys, conflicting duplicates, off-grid records or failed/unavailable requests. Review those separate native fields. Request completion is not a statement that every measurement is present.

Verified water-level `q=v` and preliminary `q=p` have different `f[0]` meanings. The former is an inferred-value flag; the latter is an excluded-sample count. Keep original `q`, `f`, sigma, value text and missing/null distinctions. No interpolation, datum conversion or project-boundary suitability is added by this workflow.

## Actual connected work

The function performs these existing staff operations:

1. Saves one distinct station profile. It retains an actually committed/lost HTTP response, enters a later unsaved note, reopens the same original workspace and replays the exact original operation. The saved ID returns to that same draft; the later note stays unsaved.
2. Reviews the original NOAA request plan and starts one native source capture. All observed counts and provider outcomes come from the resulting retained edition.
3. Opens original response evidence, downloads a response and the complete source package, writes the complete paged ledger, and invokes the independent reviewer.
4. Saves the actual review against that edition/source packet.
5. Imports the exact published JSON convention through the native file inspector, explicitly selects a distinct draft and saves its exact file evidence through the normal mapping editor. `water_level_m` is a receiving heading for the original metric value, with identity, time, datum, unit, quality and source columns preserved.
6. Downloads complete mapped CSV, JSON and JSONL, the readable source report, original source package and exact export receipts.
7. Receives its actual downloaded mapping convention as version 2 of the explicitly selected original target, makes one entered heading change, downloads both original input-file revisions and retains a new mapped export while preserving all earlier handoffs.
8. Imports that exact reviewed package through the native file-input form. The receiving edition has its own native identity while preserving original response bytes and source-observed times. It carries the earlier review as imported provenance.
9. Runs the original comparison and retains every comparison change entry. A byte-preserving import has no added, removed or changed values; any original ambiguous duplicate groups remain evidence.
10. Selects the exact saved version 2 mapping in the original dataset form, prepares that SF30 snapshot and reads its actual first/next cursor pages using the receiving headings. The receipt pins the original mapping file and ordered convention.
11. Saves a later version 3 convention through the normal mapping editor, then reads the earlier dataset again. Its original version 2 headings, source mapping, snapshot and query result remain unchanged.
12. Captures the explicitly selected historical study through serial bounded child captures and retains the complete streamed CSV/JSONL plus each child's actual source coverage.
13. Reopens the same origin again and checks the retained source editions, review, mapping, immutable exports, later draft and original dataset result at desktop and 390-pixel widths.

The default historical leg is two years of hourly heights. This is a selected receiving workload, not a claim that five years have already been captured. The application supports separately selected studies up to five calendar years, with annual-sized editions and provider-specific request chunks.

## Restart and uncertain outcomes

Keep the same positive listening port for this operator run. IndexedDB belongs to the browser origin; the stable native UUID does not make browser drafts move automatically to another port. The original owner may initially discover a free port, but must retain that actual port for both restarts.

`restart` receives `{phaseKey, workspaceId, baseURL, page, checkpointPath, prior}`. If its own process restart completed before its response was lost, it must reconcile that same restart intent and return the current legitimate startup URL. It must not create a second workspace or parallel service.

The module intercepts each real UI-issued action only to retain its exact original request and response. The native endpoint executes it. The deliberate lost-response phase forwards the original request once, confirms its actual reply, then drops that reply to exercise recovery. No alternate provider is substituted.

An interrupted action is reconciled through the original native operation record and the original browser pending request. The function never fabricates a replacement accepted request. A definitively failed/unreserved action stops with its original journal for concrete operator correction.

For a station save, archive or source-review save that was reserved before interruption, the native first write requires its original subject to remain unchanged. A newer staff decision produces a retained conflict; inspect the saved record and draft before issuing a new operation. A write already materialized before interruption replays its original result, preserving later changes and station history.

On restart, the native application marks interrupted running captures/studies as paused. Inspect that retained capture and use its existing Resume action when the underlying cause is resolved; keep the original capture ID. The journey does not silently refetch a failed period under a new capture identity.

## Output and completion

`coops-operator-checkpoint.json` preserves phases, exact issued requests, selected identity, restart keys, accepted review, source hashes and artifacts. It contains no bearer fragment. Keep it with the original browser profile and server workspace.

A successful call returns:

```js
{
  schema: 'stellar-forge.coops-operator-result.v1',
  status: 'PASS',
  operationId, workspaceId, resultPath, checkpointPath,
  selected, ids, reviewStatus, sourceCoverage,
  checks, artifacts, nativeOperations
}
```

`coops-operator-result.json` is written only after the connected work completes. All complete source/mapping/export files and their receipts remain beside it. Chrome's temporary download copy is removed only after the final file is retained and hash-verified.

An error leaves `status: "INCOMPLETE"` in the checkpoint, the exact phase and original inputs. It does not delete the workspace, discard a draft, replay completed captures or overwrite earlier exports.

## Scope of an actual result

The result demonstrates only its completed native operations. The independent review status and actual missing/quality coverage remain visible. No client model acceptance, project design certification, payment or buyer transaction is implied.

Original public contracts: [NOAA Data API](https://api.tidesandcurrents.noaa.gov/api/prod/), [response definitions](https://api.tidesandcurrents.noaa.gov/api/prod/responseHelp.html), [station metadata](https://api.tidesandcurrents.noaa.gov/mdapi/prod/).


## Original receiving host command

When the selected native runtime has admitted the one receiving operation, the
same source also supplies `receiving-host.mjs`. It binds the existing console
and `runCoopsOperatorJourney` to one persistent browser profile. Use the actual
Node, Playwright module file and Chrome executable already selected by the
runtime owner; the command installs no dependency and substitutes no provider.

```sh
node coops/receiving-host.mjs \
  --operation-id ORIGINAL_NATIVE_RECEIVING_ID \
  --workspace /selected/coastal-workspace \
  --output /selected/coastal-operator \
  --browser-profile /selected/coastal-browser \
  --playwright-module /selected/runtime/playwright/index.mjs \
  --chrome /selected/runtime/chrome \
  --operator "Responsible receiving team"
```

These runtime paths are placeholders for the owner's actual selected files.
Keep the three state directories separate and outside application source.
The original native admission remains responsible for measured memory/storage,
one controller and the complete imported source/dependency closure. This command
is not a replacement admission or a second browser queue.

The first actual listener port is retained in
`coops-receiving-host.json`. Every normal or interrupted continuation reopens
the original UUID and that same port, with the same persistent browser profile.
Native private-session renewal supplies the browser's legitimate current token;
it does not move or reset IndexedDB drafts. Restart phases retain their own
original intents, and a completed prior restart is reconciled from the current
same-origin listener.

When the actual source is ready, the host writes
`independent-source-review-request.json` and reports its path. The independent
reviewer reads that exact packet and original files, then atomically writes
`independent-source-review.json` using the response fields above. Both
`reviewed` and `follow_up` are explicit decisions; no response is generated
automatically. `--review-response` can select another original response path.
A timeout leaves the packet and operation available for the same continuation.

The default source selection remains the seven-day reference and declared
two-year hourly study. To select another supported window before the first run,
pass `--selection /selected/source-selection.json` with only `capture` and
`historical` keys (`historical: null` omits that leg). The normalized selection
and exact original mapping file remain pinned in the native journey. The
optional `--mapping-file` selects another real JSON convention.

A concrete source correction during an incomplete run requires
`--continuation-note`. The existing host record retains the earlier source
hashes, action identities, browser profile and restart history. It never
deletes application data or discards uncertain requests. A finished host returns
its original hash-verified result without repeating business operations.

On normal completion or an error, the host closes its own browser and original
console. The result and runtime-closure disposition are separate records:
a retained business result does not conceal a later closure/write failure.
`private/coops-session.json` is temporary, mode0600, and is removed only by
the run that wrote it. Do not include that private directory in a shared source
or receiving package. Complete public source, mapping, export and review
artifacts are identified by the original operator result.

## Reviewed study query handoff

When the declared study leg is selected, the same original journey also uses its exact released CSV in the native SF30 query. It retains the complete released rows and values, original study/review/mapping/source identities, downloadable native configuration/provenance, actual first/next cursor pages and an original-request replay after a committed response is lost. It then preserves that dataset through the later unreviewed working study and same-origin reopen. The two complete native metadata files are `Study_Native_Source_Manifest.json` and `Study_Native_Dataset_Config.json`; `Study_Native_Dataset_Receipt.json` and the actual native query files record the selected snapshot. The `released_study_native_dataset_and_query` phase and `ids.studyDataset` name the saved result. Native query capacity remains 250,000 rows / 256 MiB, so the operator must explicitly prepare/review a narrower complete study if a selected delivery exceeds that bound. The existing original publisher controls accept the resulting dataset with actual entered terms; this receiving result alone does not claim publisher activation or a buyer payment.
