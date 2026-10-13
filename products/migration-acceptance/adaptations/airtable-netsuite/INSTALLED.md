# Installed Airtable / NetSuite migration workflow

This complete add-on uses the existing Migration Acceptance Workbench, its original native dlt/DuckDB engine, request history and independent receiving. The public distribution now includes the complete provider capture, editable mapping review, ordinary-file browser build, native intake and source handover. This software contains authored reference data; actual tenant inputs, credentials, customer scope and commercial documents stay in their separately selected private custody.

## Select the complete installation

Use the existing `migration-acceptance` distribution selection from one exact public repository commit, following [the product operating guide](../../OPERATING.md). That selection includes the full workbench, this complete directory, the original Applications provider, customer-agent interface, Installation profile and current Grant workspace closure. Keep its build receipt and both source manifests. Copying this directory alone is insufficient.

The original dispatcher starts each command as its own maintained Node process, forwards its arguments unchanged and propagates termination signals. It neither imports an alternate writer nor starts provider work during registration.

| Installed command | Original source entry |
| --- | --- |
| `starforge migration-provider-capture` | `capture-providers.mjs` |
| `starforge migration-provider-prepare` | `prepare-provider.mjs` |
| `starforge migration-provider-review` | `build-review.mjs` |
| `starforge migration-provider-receive` | `receive.mjs` |

Use actual private absolute paths in the course below. Paths shown describe the selected inputs and outputs; they are not existing customer directories.

## Retain original provider inputs

Review [SOURCE-CONTRACT.md](SOURCE-CONTRACT.md), [MAPPING.md](MAPPING.md), `configuration.template.json` and `mapping.template.json` before selecting provider accounts. Follow [README.md](README.md) for the original supported authentication environment and exact provider configuration. Do not put credentials in source, mapping files, project downloads or exported software.

```sh
starforge migration-provider-capture \
  /absolute/private/configuration.json \
  /absolute/private/capture

starforge migration-provider-prepare \
  /absolute/private/capture/capture.json \
  /absolute/private/mapping.json \
  /absolute/private/prepared
```

Capture is read-only and retains exact response bodies, page identities, schema observations, independent SuiteQL results and the original operation. Collection occurs over an observed interval; it is not a transactional cross-provider snapshot. Missing observations are not deletion authority. Retry the same retained capture directory and operation after a transient interruption; inspect the original state and keep any conflicting response.

Preparation preserves exact decimal/BIGINT/null/missing semantics, source record identities, linked-record ordinals, complete populations and independently supplied expected data. It does not infer mappings from display labels. Optional `--previous` selects a complete prior capture for the original population comparison. Optional `--source-ids` accepts actual existing source IDs; never invent them from filenames.

## Review and preserve the editable project

```sh
starforge migration-provider-review \
  /absolute/private/provider-review.html
```

Open that exact file in the existing operator browser. The builder verifies the complete add-on roster and original workbench browser dependencies before embedding them. It retains the full editable source, operating guide and explicitly authored reference project in the outgoing file. Download those files and use them as part of the handover.

Alternatively serve the installed `products/migration-acceptance/` directory with the existing local source host and open `adaptations/airtable-netsuite/`. Both routes use the same review modules. Native database work remains in the original Workspace.

Load a complete capture and mapping, inspect all selected tables and source rows, then save attributed mapping editions. Preview a changed mapping before approving that exact capture and mapping for native compilation. Preserve invalid/incomplete text through **Save unfinished working copy** and reopen it through the existing project control. Saving a project or approving a mapping is not a measured native result or provider acceptance.

The reference project is an authored three-table example with an intentional balance discrepancy. Keep that finding; it is not customer data and must not be relabelled as a completed customer migration.

## Continue the original native operation and independently receive it

Use the existing application owner. If that owner currently serves the same workspace, coordinate its normal close before the standalone receiving command opens the original writer.

```sh
starforge migration-provider-receive \
  --project /absolute/private/reviewed-project.json \
  --directory /absolute/private/original-workspace \
  --receiving-directory /absolute/private/independent-receiving \
  --runtime-ready /absolute/private/runtime-ready.json \
  --operation ORIGINAL_STABLE_OPERATION \
  --actor ORIGINAL_OPERATOR_ID
```

The command retains original response, review, projection and expected files through `source.retain`; keeps complete request bodies before dispatch; compiles the approved mapping; runs original native load/verification, whole-population parity and business acceptance; exports the full findings and project; independently receives that archive; and cold-reopens the copied original application. The exact source roster contains both this add-on and the installed public workbench edition.

Use the same operation and exact arguments to reconcile a lost response. The receiving journal and original Workspace request ledger remain the authority. `--native-project` selects an existing native project. Use `--resume` only for the original ended native attempt after inspecting its retained failure. A changed source or mapping is a deliberately selected later operation, retaining the prior history.

`--select-local` is explicit: it selects the accepted local DuckDB consumer only when original parity and business acceptance permit it. It does not mutate Airtable or NetSuite. Without it, the complete received case remains available for review. Keep required findings distinct from reviewable exceptions, and retain each actual reviewer and reason.

The copied editable source remains independently usable. Reopen the original project, unfinished working file, complete prepared files, full native report and received source on the selected receiving host; verify its actual runtime before continuing. An installed source bundle or successful source reconstruction does not establish completed native or rendered receiving.

## Source lineage and complete export

[PUBLIC_ADOPTION.json](PUBLIC_ADOPTION.json) identifies the exact upstream reusable software edition, original add-on manifest and unchanged workbench manifest. The public copy adds this installed course and registration while preserving the original operational modules. The full add-on `SOURCE_MANIFEST.json` records the actual exported edition, including this guide and its provenance. Original tenant captures, private proposal and business correspondence are not part of this software roster.

A customer project can contain sensitive retained source. Exporting complete source/history does not authorize public publication of the customer's archive. Keep that handover in the destination chosen for the original work.

## Producing peer and receiving owner

Operate the complete course on the exact outgoing version: empty/invalid source intake; full capture and mapping selection; invalid mapping recovery; attributed edition and approval; complete table inspection; source/project/unfinished-working downloads and reopen; original native intake/load/parity/acceptance; full archive and extracted source receiving; cold application reopen. Check the actual desktop and narrow presentation. Continue the existing owner; no additional controller or browser session is created by this adoption.

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
