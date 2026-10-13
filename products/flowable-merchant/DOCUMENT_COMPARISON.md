# Selected document migration acceptance

The existing Flowable workspace's Document panel now compares complete, explicitly selected source and target Alfresco document versions. It retains their original capture bodies, exact node/version identities, full content bytes, field mappings and human dispositions. This is an acceptance companion to the migration operator's existing engine. It reads the selected versions and does not migrate, overwrite, delete or repair repository content.

## Open the operator

Open the existing private workspace, choose Document intake, then use **Compare selected document versions**. The authored comparison opens six complete pairs: one exact match, a content difference, a mapped-title difference, an uncaptured target, an exact large-integer difference and a metadata type mismatch. The eleven complete capture members are editable reference data, not observed customer results.

Open a complete comparison-source.json or reopen comparison-delivery.json. The source editor shows only the selected pairs and field mapping; all complete capture members remain retained. Compare before reviewing. Each pair keeps its original content and metadata observations, and has an explicit Unreviewed / Accept observed match / Accept documented exception / Reject disposition. A missing target cannot become an accepted match or documented observed exception. An accepted discrepancy requires a reason; it does not change or hide the observed mismatch.

The browser holds the working source in memory for the current workspace. Download the full source before closing it. Changing workspaces clears the previous context. Reopening the complete receiving package restores the original sources and recorded dispositions after independently recalculating every observation.

## Select actual source and target versions

Use one explicit mapping row per source and target version. Both identities have repositoryId, repositoryBaseUrl, nodeId and versionId. The source and target may have different node IDs and version labels. A version may not silently participate in multiple pairs; select a deliberate separate cohort if that business mapping is required. The same exact four-part identity cannot be compared to itself.

The capture plan contains the repository base URLs and credential environment-variable names, plus the complete selected mapping. The example hostnames are intentionally invalid. Replace them with the customer's actual authorized Alfresco REST v1 base URLs, selected version identifiers, and corresponding capture member names. Credential values stay in the operator's environment.

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/flowable/workspace/capture-document-comparison.mjs --plan ACTUAL_CAPTURE_PLAN.json --out OWNED_COHORT_DIRECTORY
```

The maintained capture adapter reads current node metadata, version-history pages, selected version metadata, the full selected historical content, then selected metadata again. The content response must be full HTTP200 with no Content-Range. It never falls back to current live content. The account needs read permission for the selected node, its history and content. Preserve original401/403/404 or inaccessible-version failures and ask the repository owner to resolve them.

An unchanged before/after metadata body is an observed consistency check, not an atomic snapshot or server-attested content hash. Alfresco supports version deletion and versionability changes; another actor can modify the environment between reads. History uses offset pages, so captures reject repeated version labels, inconsistent totals and incomplete coverage. A coherent observed sequence still is not a transactional history snapshot. Changing live-node content does not by itself invalidate a selected historical version.

The exact original plan is retained before requests. Completed selected captures are immutable and reused on same-directory continuation. A failed read preserves its full failed attempt. Continue the same plan/output to receive remaining sources; use a separately named cohort/edition for an intentional recapture. The original file lease covers the entire read lifetime. The completion receipt is written after the lease closes.

## Field and content rules

The content comparison uses complete captured byte length and SHA-256. A transformed document remains a byte discrepancy even if the change was intended; the reviewer can record the justified exception. No text conversion, OCR equivalence, page-count inference or hidden normalization is applied.

Each selected metadata rule names a source and target JSON pointer under /version or /content. Supported types are string, boolean, number and string-set. String-set explicitly compares unique strings without their order. Other comparisons preserve their selected types and values. Required missing fields, optional absence on both sides, mismatched types and unknown captures remain separate observations.

Original numeric metadata is compared with the native lossless coefficient/exponent representation. For example,9007199254740992 differs from9007199254740993 even though binary floating-point conversion can collapse them. Decimal notation10 and1e1 compare equal. Numeric values must also be finite in the ordinary JSON projection; use explicit source string fields when a repository stores larger arbitrary-precision values as text. No numeric value is reserialized into the native repository.

Displayed scalar strings and selected string sets are bounded to2 KiB, numeric display values to4 KiB, and the complete report to8 MiB. A field exceeding its report bound remains an explicit type/value-review issue while its full original source remains retained.

Limits are50 pairs,100 full capture members,40 mapped fields and64 MiB complete source. Each underlying capture keeps its original16 MiB packet/4 MiB content limits. Split larger selections into explicit named cohorts. These limits and the selected sample mean the report cannot be presented as an exhaustive migration or repository acceptance certificate.

## Complete downloads and independent receiving

The operator supplies a readable HTML report, selected-pair CSV, full-field CSV, complete source JSON and complete receiving JSON. CSV formula-like text has an apostrophe prefix for ordinary spreadsheet safety; the complete JSON sources retain the exact original values. The HTML has plain readable tables, exact source identity and full per-pair observations. Open the HTML and CSV in the actual recipient's viewers.

Create the complete outputs from a retained source, optionally adding an explicit review file:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/flowable/workspace/document-comparison-cli.mjs --source comparison-source.json --out OWNED_OUTPUT_DIRECTORY
```

Independently receive and reopen the complete delivery without any repository credentials:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/flowable/workspace/document-comparison-cli.mjs --delivery comparison-delivery.json --out NEW_RECEIVING_DIRECTORY
```

The receiver validates every complete member, recalculates all rows from the original captures and mapping, verifies the exact saved report, checks any manual dispositions, writes the full outputs immutably, then reopens them and compares the complete HTML/CSV/JSON results. It preserves source and report identity rather than claiming that a reviewer signature is a native repository attestation. The original customer commercial case receives these actual files through its existing product-download path.

## Producing-seat inspection

Use the actual outgoing installed edition. Open the authored six-pair cohort and a permitted customer-selected capture, inspect wide and narrow layouts, expand full source observations, edit a mapping and preview its result, record valid and invalid dispositions, download every file, open the HTML/CSVs/JSON normally, then reopen the complete receiving package. Inspect the empty, loading and relevant error states, switched-workspace context and changed-draft export guards. Repair any actual clipped/overflowing or unusable control in the same product.

The pure reference composition checked the original parsers and full source/report/delivery reproduction. Native capture, browser rendering and ordinary attachment viewing are separate execution results and must be performed by the existing equipped producer before a customer-ready claim.

<!-- bryce-rendered-product-inspection:begin -->
## Standing lab rule: inspect the rendered product before presenting it

Bryce's direct owner instruction, October 13, 2026. This applies to every current and future lab peer, provider, model, harness, local session, cloud session, and delegated or child worker.

Before calling a client/prospect-facing app, site, dashboard, demo, report, presentation, or export ready, or putting it before a client/prospect, the responsible producing peer MUST open/run/render the exact outgoing version and visually LOOK at the actual result. Inspect at the actual screenshare/presentation width and at narrow/mobile widths where relevant. Operate critical controls; inspect applicable loaded, empty, loading, and error states; exercise downloads/exports and reopen the delivered files. Capture real screenshots or rendered page images and actually VIEW them. Capturing without viewing does not satisfy this rule.

This includes ALL attachments. Literally observe the actual thing the way a user or recipient would see and use it: open and view downloaded HTML, every relevant PDF/report page, slides, spreadsheets, maps, images, video/audio, archives and project attachments in their normal recipient-facing viewer or application; play audiovisual media and inspect the usable contents of archives/projects. Metadata, schemas, source text, and a browser link do not substitute for opening the attachment and using the delivered result normally.

Fix ugly, cramped, broken, unstyled, clipped, overflowing, or unreadable results within the authorized task before presenting them. Favor simple industrial/plain presentation, consistent spacing and typography, readable tables, and working controls. Do not add decorative template slop. Source review, unit tests, HTTP 200, DOM counts, a reviewer/model approval, or an evidence form do not substitute for looking at and operating the real outgoing product.

This is focused internal product validation, never permission to build or submit a proof, test, or verification product, run broad suites, or repeatedly recheck an unchanged accepted version. Building and integrating the actual deliverable remains the main work; do not substitute endless reviews for delivery. Retain an exact-version visual receipt in the handoff: source/head or artifact hash, URL/file, viewport sizes, screenshots actually viewed, controls/states/export files exercised, fixes, and any precise unresolved gap. A changed outgoing version needs inspection of the affected result.

Bryce explicitly clarified: "that includes all attachments and this does not become review theatre or test theatre you need to literally observe the actual thing the way a user would see and use it". A checklist, screenshot folder, receipt, passing test, or parallel review bureaucracy is not the requirement or a substitute for actual observation and normal use. Perform focused fixes and keep shipping the main work; create no review or approval gate.

Bryce also instructed: "also add that if u make a video use voice gen tts not robot voices, use generative stuff we have models, use them". For video/media narration, use available high-quality generative voice/TTS and applicable generative visual/media capabilities when helpful, with natural professional delivery instead of robotic default voices. Actually play/listen/watch the final exported attachment and inspect clarity, pronunciation, pacing, timing, and audio alignment. Reviewing a text script does not substitute for experiencing the final video/audio. This adds no paid-service purchase or real-person voice-cloning authorization; preserve lab attribution and third-party copyright/license controls.

Pass this rule to child/delegated workers and persist it in owner-controlled provider/project/cloud instruction copies. Record delivery and readback coverage; never claim every running session loaded it without evidence. This rule creates no hooks, watchers, restarts, approval queue, credential restrictions, or new publication authority. Preserve all existing owner rules, including no llama.cpp, no private GitHub repositories or Actions, focused validation, attribution, incident communication, personal meeting approval, contact holds, demo pauses, bounty restrictions, and owner cutoffs.

Canonical local policy: `C:/Users/lucys/.commons/rendered-product-inspection-policy.md` and `.json`. Portable repository copy: `docs/policies/rendered-product-inspection-policy.md` and `.json` when present. Only Bryce can change this standing rule.
<!-- bryce-rendered-product-inspection:end -->
