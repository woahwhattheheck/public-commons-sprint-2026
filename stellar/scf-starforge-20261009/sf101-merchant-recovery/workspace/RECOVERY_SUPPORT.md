# Recovery and comparison operations in an existing Support case

The SF101 workspace can capture one saved standalone Object recovery or backup-comparison request into an existing SF74 Support case. It preserves the byte-exact request, its original reviewed selection, every referenced immutable native evidence file or comparison artifact, and the ordered evidence history. The operator chooses the existing case revision and its before or after observation slot.

This is a saved recovery observation. Opening it does not acquire buyer data, inspect current Object state, dispatch a recovery command, evaluate a payment, or send a notification. A failed or interrupted native result remains a failed or interrupted result in Support. The interface shows the actual SF101 attempt count separately from unique evidence files and ordered evidence-history entries.

## Host configuration

Add the optional Support paths to the existing recovery profile. The host selects these paths; browser, CLI attachment, and MCP tool arguments only select profile, original request, case, revision, slot, and transfer IDs.

~~~json
{
  "casesDirectory": "/srv/starforge/private/merchant-cases",
  "caseSourceDirectory": "/srv/starforge/private/case-source-delivery"
}
~~~

These are additional fields inside an existing profile, not a complete replacement configuration. Retain its existing Object declarations, original operations directory, bundle roots and passphrase environment name. The case directory must already exist, be private and canonical, and contain the original Support cases. Its path must not overlap recovery controls or the selected Object source or bundle. The optional source-delivery directory must be the existing original service directory for genuine attached SF49 source editions.

A profile without casesDirectory keeps all existing recovery behavior and does not show the new Support panel. Cases without native source attachments can export without caseSourceDirectory. If a saved case references a native source edition, full export requires the actual original delivery directory and complete native bundle; it does not skip missing attachments.

Launch the existing workspace in the usual way:

~~~sh
starforge merchant-recovery-remote workspace serve \
  --config /srv/starforge/private/recovery-host.json \
  --directory /srv/starforge/private/recovery-workspace
~~~

All following CLI commands attach to that original verified listener. They do not open a second recovery owner.

## Browser workflow

1. In **Send recovery evidence to Support**, choose a saved original Object recovery or backup-comparison request. The list shows its saved phase and actual attempt count. A request actively running in this workspace cannot be captured.
2. Choose an existing Support case and its current revision. The refresh and paging controls use the original case store.
3. Choose **Before** or **After**. A populated slot is replaced only in a new case revision; earlier observations remain in the case’s original history.
4. Choose a stable lowercase transfer ID and select **Review complete capture**. The producer freezes the complete original selection and request before publishing the review.
5. Inspect the request digest, evidence inventory, actual native session, original case revision, slot and external backup identity. Confirm that exact displayed review.
6. Select **Save reviewed case**. The original case store compares the selected revision and saves through its existing writer. A concurrent case edit produces the original case conflict instead of replacing that edit.
7. Open the retained transfer again, download its complete Support handoff, or export the whole original case and history. Support’s existing runtime viewer recognizes **RECOVERY_OPERATION** and **OBJECT_COMPARISON** separately and displays native results and evidence without inventing HTTP traffic counters.

Refreshing the form or selecting another request, case, slot or transfer invalidates its confirmation. A completed frozen review remains a record of its original capture time even when the source request later advances. Use a new transfer ID for a new capture.

The before/after comparison requires the same workspace, profile, request, review and native declaration before interpreting the records as one operation. A later observation must retain the earlier evidence set and original creation identity. Independent operations and different observation kinds remain separate.


## Capture a saved backup comparison

Select the original `object-compare` request in the same panel and use the same eight-field Support selection shown above. Set `id`, `expectedReviewHash` and `afterAttempt` from that actual saved comparison; use its current original case revision and a new transfer ID. The producer reads the saved comparison, not the current encrypted bundle paths, and does not run the comparison again.

The frozen review identifies both host-declared Object selections, their expected record digests, the common session, and the complete artifact inventory. The case capture contains these three exact files:

| File | Complete contents |
| --- | --- |
| comparison-observation.json | Original request identity, selected pair, capture identity and exact artifact inventory |
| comparison-request.json | Byte-exact original request, review, phase, attempts, results, errors and ordered local artifact history |
| comparison-artifacts.ndjson | Every unique referenced JSON result, HTML report and Markdown report, with original media type, byte count, SHA-256 and base64 bytes |

Artifact selection closes over the terminal result, the retained local last result and every entry of the ordered local evidence history. Repeated references remain ordered in the original request; the inventory stores each unique body once. An unstarted prepared request has an empty inventory and a newline-only artifact file. Incomplete comparisons retain every completed authenticated side, original failure and available report. A failed identity check remains visible with its original result bytes.

The Support viewer shows **OBJECT_COMPARISON**, each original native comparison outcome, the unique artifact inventory and the ordered saved history. Its original-file controls let the receiving operator download each full artifact by its exact identity. It does not execute a captured HTML report inside the case interface. A saved clean authenticated result describes the original comparison run; importing or opening this capture does not authenticate the current files at either saved bundle path.

To capture progress, save the earlier request into **Before**, explicitly continue that original comparison through its existing workspace workflow, then capture its later saved attempt into **After** under a new transfer ID. The Support comparison requires the same original workspace, profile, request and review, and retention of the earlier artifact set and history. These slots compare two observations of the same request; they are distinct from that request's own before/after backup pair.

### Complete size limits and encrypted custody

The entire three-file comparison cohort is limited to **64 MiB**, including the exact request, observation metadata and base64 NDJSON wrappers. The existing complete Support runtime, containing both observation slots, remains limited to **192 MiB**. The native comparison adapter can legitimately retain a larger artifact under its separate 256 MiB artifact limit. Such a result cannot fit this Support transport: preparation rejects it explicitly before reading the oversized artifact. No report, earlier attempt or evidence body is omitted, summarized away or truncated to make it fit. Preserve the complete original comparison downloads and its existing native delivery in that case.

Both bundle descriptors remain `EXTERNAL_NATIVE_BUNDLE`. Their paths and record digests are retained identities, not included encrypted bytes. The single-backup attachment command is not applicable to a comparison transfer and rejects it explicitly. The paired continuation below attaches both original editions through one separate native source delivery. Existing genuine case source editions remain independently exportable through their original inventory; this capture does not create an attachment or authorize a restore.

The same **Save reviewed case**, full handoff, whole-case export and independent receiving commands below apply to comparison transfers. The case package preserves the complete original request and all artifact bytes in every retained revision. On the independent installed receiver, open the received case, select its comparison observation, inspect partial or complete status and ordered history, and download the original JSON/HTML/Markdown artifacts for hash comparison with the sender.

## Exact CLI and MCP selections

List existing cases and read the source request:

~~~sh
starforge merchant-recovery-remote workspace support-cases \
  --config /srv/starforge/private/recovery-host.json \
  --directory /srv/starforge/private/recovery-workspace \
  --profile original

starforge merchant-recovery-remote workspace request \
  --config /srv/starforge/private/recovery-host.json \
  --directory /srv/starforge/private/recovery-workspace \
  --profile original --id object-restore-01
~~~

Create a private selection file using the actual returned IDs, hashes and attempt count:

~~~json
{
  "profileId": "original",
  "id": "object-restore-01",
  "transferId": "object-restore-support-01",
  "caseId": "00000000-0000-4000-8000-000000000001",
  "expectedRevision": "ACTUAL_64_HEX_CASE_REVISION",
  "slot": "after",
  "expectedReviewHash": "ACTUAL_ORIGINAL_REQUEST_REVIEW_HASH",
  "afterAttempt": 1
}
~~~

The example UUID, hashes and attempt count are placeholders. The current original request and case supply them.

~~~sh
starforge merchant-recovery-remote workspace support-review \
  --config /srv/starforge/private/recovery-host.json \
  --directory /srv/starforge/private/recovery-workspace \
  --selection /srv/starforge/private/support-selection.json

starforge merchant-recovery-remote workspace support-save \
  --config /srv/starforge/private/recovery-host.json \
  --directory /srv/starforge/private/recovery-workspace \
  --profile original --transfer-id object-restore-support-01 \
  --expected-support-review ACTUAL_REVIEW_SHA256

starforge merchant-recovery-remote workspace support-transfer \
  --config /srv/starforge/private/recovery-host.json \
  --directory /srv/starforge/private/recovery-workspace \
  --profile original --transfer-id object-restore-support-01
~~~

The agent tools use the same listener and schema:

| Tool | Input beyond the configured workspace alias |
| --- | --- |
| merchant_recovery_support_cases | profileId; optional q, offset, limit |
| merchant_recovery_support_transfers | profileId |
| merchant_recovery_support_transfer | profileId, transferId |
| merchant_recovery_support_review | selection with all eight fields shown above |
| merchant_recovery_support_save | profileId, transferId, expectedReviewSha256 |
| merchant_recovery_support_handoff | profileId, transferId |
| merchant_recovery_support_export | profileId, transferId, expectedReviewSha256 |
| merchant_recovery_support_package | profileId, transferId |

The handoff read returns complete content, byte length, SHA-256 and the original case ID/revision. The browser verifies its complete byte/hash identity before downloading it. The whole package is exported to the original private transfer directory and is inspected by the existing source-package engine.

## Interrupted preparation or save

Each transfer stores its original selection, exact request, content-addressed evidence or comparison artifacts, capture time, original workspace/metadata, full new runtime support text and final review under the existing workspace’s support-transfers directory. The review is published only after all source bytes are retained. Missing or oversized evidence is an error; the producer never truncates it.

If preparation stops before review publication, **Open original transfer** returns its complete frozen selection. Continuing uses that selection and any already-retained original bytes. It cannot silently substitute a later request attempt. If the original source required for the selected capture is no longer available, preserve that transfer and select a new ID for a newly reviewed capture.

Before the case writer is invoked, the exact save selection is retained. A lost save response does not trigger automatic resubmission. Read the same transfer first. On an explicit same-transfer save, the producer follows the original immutable case history and matches the prepared workspace, normalized metadata, complete support text and selected previous revision. If that original save exists behind later edits, its result is returned and the current case head is preserved. A genuinely conflicting case head remains a conflict.

The transfer list reads small immutable review/result metadata and labels saved rows **SAVED_RECORDED**. It does not repeatedly decode every large source capture or claim that each case was freshly reopened. Opening a transfer, saving, downloading or exporting performs the complete source and native case checks. Unreadable retained records are shown as unreadable, not as absent work.

Closing the workspace rejects new work, aborts owned in-progress export stages, drains the complete producer and original source-service operations, and releases its original writer only after that cleanup. A case save already executing remains owned through its returned outcome.

## Complete handover and independent reopening

The downloadable merchant-support.json uses the existing Support handoff schema. It preserves the exact workspace and runtime support strings, including all original request/evidence or comparison artifact bytes in the selected captures.

For the selected case plus its complete original history, use the whole export:

~~~sh
starforge merchant-recovery-remote workspace support-export \
  --config /srv/starforge/private/recovery-host.json \
  --directory /srv/starforge/private/recovery-workspace \
  --profile original --transfer-id object-restore-support-01 \
  --expected-support-review ACTUAL_REVIEW_SHA256
~~~

The result identifies the complete private package directory and manifest SHA-256. Transfer all manifest-declared files and case-source-package.json together. The existing exporter preserves the selected case revision, every captured original case revision, exact request/evidence captures, readable Support report and any actual attached native SF49 source archives. Its generation time and original selection stay fixed across same-package continuation.

Receive on an independent installed application through the maintained Support workflow:

~~~sh
starforge merchant-implementation inspect-package \
  --from /srv/starforge/private/incoming/recovery-support-01 \
  --sha256 ACTUAL_COMPLETE_MANIFEST_SHA256

starforge merchant-implementation receive-package \
  --from /srv/starforge/private/incoming/recovery-support-01 \
  --sha256 ACTUAL_COMPLETE_MANIFEST_SHA256 \
  --out /srv/starforge/private/receiving/recovery-support-01 \
  --cases-dir /srv/starforge/private/received-cases \
  --source-dir /srv/starforge/private/received-sources \
  --request-id receive-recovery-support-01 \
  --actor "Receiving operator"
~~~

Use the actual sender manifest, original receiving ID and the receiver’s private directories. The maintained receiver verifies the complete inventory, imports through the original Support downloader/reopener, preserves the original case history, and records a local receiving case identity. Repeating that same receiving request reopens its retained result while preserving later local case edits. See the adjacent SF74 [complete source-package guide](../../sf74-merchant-support-console/CASE_SOURCE_PACKAGE.md) for the full original transfer and receiving contract.

### Encrypted backup custody

The three text files are recovery-observation.json, recovery-request.json and recovery-evidence.ndjson. Their native bundle descriptor is explicitly EXTERNAL_NATIVE_BUNDLE. A retained path or record digest is not evidence that encrypted files are present in the Support package.

The original encrypted bundle must travel through its actual native backup/source-delivery custody. It is included in a full case-source package only when that case genuinely references a native SF49 source edition whose declared inventory contains those bytes; the existing exporter then requires and verifies that complete archive. This integration does not manufacture a source edition, buyer event, payment, commissioned workorder, restore result or secret. A receiving operator uses the original recovery engine, actual encrypted bytes and owner-authorized secret for any later restore.

## Attach both original encrypted comparison editions

Use [Carry both encrypted editions from one comparison](RECOVERY_BUNDLES.md#carry-both-encrypted-editions-from-one-comparison) for the complete browser, CLI and independent receiving workflow. Export before and after from the same clean completed comparison request, review, attempt and full artifact cohort. Review the resulting pair hash, then use `bundle-pair-attach` with that hash, this saved Support review and the exact current case revision.

The existing SF49 service saves two complete encrypted archives in one original source delivery and one case attachment event. `bundle-attachment` and `bundle-case-export` select that original attachment with `pairSha256` (CLI `--pair-sha256`), instead of a single archive hash. The case export selects the actual attached revision and preserves later case edits. A lost reply reopens the same native attachment request; it does not create a second workorder or upload the pair again after an attachment has been recorded.

The original comparison observation keeps its truthful `EXTERNAL_NATIVE_BUNDLE` descriptors. Actual included bytes are established separately by the attached SF49 source inventory and whole case-source manifest. The independent receiver must preserve and inspect both original files, reopen the original comparison evidence, and use each archive’s exact native record and transport digest for a later explicit backup receive. No passphrase is included.

## Source packaging

Install the full maintained application. The new workspace/recovery-support.mjs imports the original case store, runtime parser, pure recovery-runtime.mjs and comparison-runtime.mjs consumers, source package engine and source-delivery factory. The browser asset registry includes recovery-support-desk.mjs. An explicit source-selection exporter must follow these literal imports and include all referenced backend modules, the original comparison validator/report module and the browser asset; copying only model.mjs or the desk is incomplete.

Existing managed snapshot, transfer, fleet, publisher, standalone recovery and Support source-edition flows remain selected through their original engines and identities.

## Installed receiving and browser acceptance

Source checks and HTTP responses establish different facts from a viewed product. After installing the complete selected source on an accepting host, use an existing original comparison and Support case to complete review, save, both edition exports, the single paired attachment, full case export and independent receive. Preserve the request/case/transfer identities and inspect both the original and received case.

View the actual application at desktop and narrow widths. Check a prepared request, a retained partial failure and a clean completed result when those original observations are available; check both observation slots, the full artifact download controls, long paths/digests, empty history, conflict/readback behavior and keyboard focus. The producing operator must view the rendered result and correct clipping, broken controls or misleading status before calling the browser delivery complete. A source-only exercise or an HTTP response is not rendered-browser evidence. Record actual execution and visual results separately; this guide does not claim that an installation or customer run occurred.

## Rendered product inspection — owner instruction, 2026-10-13

This applies to every current, future, resumed and delegated worker, across providers and local or cloud runtimes. Bryce's standing rule is: “that includes all attachments and this does not become review theatre or test theatre you need to literally observe the actual thing the way a user would see and use it”.

Before presenting a client/prospect-facing application, website, dashboard, demo, report, presentation, export or any attachment, the producing peer must open/run/render the exact outgoing version, LOOK at it and normally use it as the recipient would. View the actual screenshots you capture. Inspect the actual presentation/screenshare width and relevant narrow/mobile width, important user controls, populated/empty/loading/error states, downloads and reopened exports. Open the usable contents of ZIPs/projects and every applicable report/PDF page. Source review, schemas, HTTP 200, DOM counts, tests, checklists and another worker's approval cannot substitute for observing and using the actual product.

Fix broken, unstyled, cramped, clipped, overflowing or unreadable output within the authorized work before presenting it. Use plain industrial software design: readable tables, clear hierarchy, consistent typography and spacing, restrained controls, useful labels and responsive layouts. Preserve real workflows, source data and computations. Inspection must lead directly to repairs and continued delivery; it must not replace implementation/integration or become repeated checking. Keep validation focused on the actual remaining risk. Do not run broad test sweeps, repeat accepted checks, build a verification product or create review bureaucracy or an approval queue.

For video and audio, Bryce directs: “also add that if u make a video use voice gen tts not robot voices, use generative stuff we have models, use them”. Use available high-quality generative voice/TTS and useful generative media, with natural professional delivery. Actually watch/listen to the final outgoing export, including pacing, pronunciation, timing and audio alignment. Preserve existing spending, voice and attribution controls.

Include this complete instruction in delegated assignments and the active owner-controlled provider/project/cloud policy, boot, build and receiving guidance those workers actually read. Reuse already updated copies and return exact updated paths/version in the original policy thread with the next substantive result. Delivery of source does not establish that every runtime loaded it. Preserve all other owner controls and original operation identities; leave historical records and third-party/vendor policies intact. This instruction creates no restarts, watchers, credential gate or new release permission and does not revive owner-stopped work. When a runtime is unavailable, join the existing equipped receiver with the complete exact version and opening steps, review its actual rendered result, and continue independent implementation while it runs.

Owner instruction and coordinated propagation: https://tokenjunkielabs.slack.com/archives/C0BU51F1PL3/p1791881496221999
Canonical attachment/media clarification: https://tokenjunkielabs.slack.com/archives/C0BU51F1PL3/p1791885532614949
