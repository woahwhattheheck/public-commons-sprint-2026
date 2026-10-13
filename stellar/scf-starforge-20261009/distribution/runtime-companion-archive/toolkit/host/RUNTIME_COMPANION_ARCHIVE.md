# Verified application archives in the Runtime Companion

The archive-source receiver now has a consumer for an existing Runtime workspace. It retains the complete original source packet in **Files**, imports the packet's selected files and directories into **Companion file sets**, and retains an association containing both original identities. It downloads every retained file again and closes and reopens the original Runtime model before publishing a complete receiving result.

Use this when a delivered ZIP has already been collected through the maintained JavaScript/Python source collectors. A source-set ZIP alone preserves selected files; the complete application-source packet additionally preserves the original ZIP bytes, selected member root, dependency findings, negative Python search observations, executable identities, and the original collector/tool bodies. Those original bytes remain available through Files and the complete export.

This is an additive host consumer. It calls the existing Runtime input library, source-set engine, kernel operation lease, archive exporter and working-selection API. There is no second Runtime store, file upload protocol, source collector, ZIP codec or application controller. Receiving does not create a Runtime workspace, save an application, install dependencies or start a native application. The normal application provider remains responsible for its existing Review/Save/Start actions.

## Required originals

Keep the complete toolkit beside this guide, including the original archive receiver and its two unchanged source collectors. Use a supported Node with the original Runtime installation's dependencies and the existing absolute Python executable.

The selected Runtime source directory is the real directory containing:

- model.mjs
- application-inputs.mjs
- application-input-set-sources.mjs
- application-input-set-archives.mjs
- public/application-input-set-format.mjs
- storage.mjs

For an existing maintained source checkout, this is stellar/scf-starforge-20261009/distribution/runtime-workspace. For an installed distribution, select that same directory under its original package/source tree. It must be the trusted maintained Runtime source, separate from the received application and workspace data. The bridge never imports executable code from the received ZIP or source packet. Every command requires this source path explicitly; packet or result metadata is not executable-source authority.

The bridge records and rechecks the complete bodies of these six Runtime entry modules. This is an API-edition binding, not a substitute for the Runtime installation's own full package/source verification. Keep the same trusted source edition available when resuming this operation. The installed product and its normal dependency closure remain required.

Choose an existing Runtime workspace and its actual UUID. Opening it is read-only; a mismatched UUID fails before any upload. Do not create another workspace to make a missing original ledger appear present. The bridge's private receiving directory and export directory must be outside the workspace and trusted source.

## Original limits, before upload

The complete original input file must fit the Runtime Files limit of **16 MiB**. The existing archive-source collector can produce a gzip packet; its exact compressed bytes are retained without recompression. The decoded packet remains bounded at 256 MiB, and the original packet's ZIP/selection limits still apply.

The selected Companion set uses the original limits: **1,024 files, 4,096 directories, 16 MiB per file, 64 MiB total**, with the original 1 MiB upload chunks and original portable-path rules. Empty directories are retained. A complete association must also fit the original Files limit.

The whole source manifest and association size are checked before the first Runtime upload. An unsupported input is refused intact. Do not truncate members, split an archive to bypass the limits, rename paths, or drop dependency observations. Larger complete products continue through their existing host-path receiving course.

Executable bits remain in the original packet and are checked by the original archive/source receiver. Companion working copies are the existing private editable data copies; the bridge does not change their mode policy or claim they are an executable installation.

## Receive into the existing workspace

First complete the original collect operation described in APPLICATION_ARCHIVE_SOURCE.md. Keep its complete output file and independently retained SHA-256.

Use the original native host owner and the same authorized receiving lifetime. The following path values are examples; select actual existing paths and preserve them on retry.

```sh
node /trusted/toolkit/host/runtime_companion_archive.cjs receive \
  --input /private/source/application-source.json.gz \
  --sha256 ORIGINAL_INPUT_SHA256 \
  --directory /private/receiving/application-companion \
  --runtime-source /trusted/merchant/stellar/scf-starforge-20261009/distribution/runtime-workspace \
  --workspace /private/existing-runtime-workspace \
  --workspace-id EXISTING_WORKSPACE_UUID \
  --name "Reviewed application source" \
  --python /absolute/existing/python3 \
  --node /absolute/existing/node
```

The command:

1. Checks the exact input, complete original archive/source binding, Runtime limits, trusted entry source and selected workspace UUID.
2. Retains the same input and intention, then takes the Runtime's original kernel lease for this receiving directory. A concurrent caller receives the original operation-running refusal.
3. Calls the unchanged original archive receiver, including native collector inspection and all original parser-owner drain checks.
4. Confirms the received source directory exactly matches the intended original Companion manifest.
5. Retains the complete input file through the existing Files begin/chunk/complete protocol and downloads all bytes for comparison.
6. Retains the selected source set through the existing directory intake, including its original upload IDs and missing-chunk resume.
7. Downloads every source member, retains and downloads the complete association in Files, closes the Runtime model, reopens it and repeats the original byte and association checks.
8. Publishes complete.json only after those operations and model close succeed.

The association names the actual workspace UUID, source-set ID, complete packet upload ID, archive/source identities, selected members with original modes, original dependency coverage, and six Runtime entry identities. It is an ordinary retained file. Runtime's existing workspace backup carries the packet, association, set and future working selections.

The underlying receiver retains all parser invocation/stdout/stderr and original CLOSED receipts. An interrupted or forced parser without confirmed drain remains unconfirmed; no following parser is launched until that original owner is reconciled. Do not fabricate a close receipt, delete an attempt, or select a new receiving directory to bypass it.

## Reopen and review originals

```sh
node /trusted/toolkit/host/runtime_companion_archive.cjs review \
  --directory /private/receiving/application-companion \
  --runtime-source /trusted/merchant/stellar/scf-starforge-20261009/distribution/runtime-workspace \
  --workspace /private/existing-runtime-workspace \
  --workspace-id EXISTING_WORKSPACE_UUID
```

Review reads the complete retained association and packet through the original Files API, rechecks the full archive/source binding, reconstructs the exact source-set manifest and downloads every set member. It performs no workspace mutation. It reports VERIFIED only for that current original readback; it does not report that the application ran or its user interface was inspected.

Open the existing Runtime browser and use **Applications → Companion file sets**. Find the retained set by its original name/ID and open the whole source manifest. In **Files**, open the retained application-source packet and association by their actual upload IDs. The browser uses its existing controls and complete original download actions.

## Explicit working-copy preparation

Choose the original application kind and one of its declared path settings. Use a retained UUID for this exact set/setting/member selection. Omit --member for the whole directory.

```sh
node /trusted/toolkit/host/runtime_companion_archive.cjs prepare \
  --directory /private/receiving/application-companion \
  --runtime-source /trusted/merchant/stellar/scf-starforge-20261009/distribution/runtime-workspace \
  --workspace /private/existing-runtime-workspace \
  --workspace-id EXISTING_WORKSPACE_UUID \
  --request-id ORIGINAL_PREPARATION_UUID \
  --kind ORIGINAL_APPLICATION_KIND \
  --field ORIGINAL_PATH_SETTING \
  --member path/to/original-entry-file
```

The bridge retains the exact selection before the original prepare call. A lost response is resumed with the same UUID and inputs. The original Runtime API owns the working directory and preserves edits once preparation completes. A changed set, member, kind or field cannot reuse that UUID.

In the browser, open the intended application path setting with **Use saved file**, find the preparation under **Retained working sets**, then choose **Use current working set**. Continue through the normal **Review application** control. Application Save and Start remain their original separate explicit actions. Reopening an edited working copy does not replace its edits with original files.

## Complete export and independent receiving

```sh
node /trusted/toolkit/host/runtime_companion_archive.cjs export \
  --directory /private/receiving/application-companion \
  --runtime-source /trusted/merchant/stellar/scf-starforge-20261009/distribution/runtime-workspace \
  --workspace /private/existing-runtime-workspace \
  --workspace-id EXISTING_WORKSPACE_UUID \
  --output /private/exported-application-companion
```

The export contains:

| File | Complete original content |
| --- | --- |
| original-source.json.gz or original-source.json | Exact original input bytes downloaded from Runtime Files, including the unchanged original ZIP and complete mixed-source packet |
| association.json | Exact retained association from Runtime Files |
| companion-source-set.zip | The existing Runtime archive exporter’s whole source set, including its normalized manifest and empty directories |
| intent.json and complete.json | The original export selection and actual complete file identities |

The existing archive inspector reopens the complete Companion ZIP and verifies its origin workspace, set identity, manifest and full member bytes before completion. A matching interrupted export can be resumed; existing different files are not overwritten.

For a second, explicitly selected existing Runtime workspace, run receive on the exported original-source file with its retained SHA-256, that workspace's actual UUID and a separate receiving directory. This reruns the original collector inspection and creates the same normalized source-set identity when the original set name is kept, while retaining the second workspace’s actual identity. The earlier origin association stays in the export; it is not rewritten as a new origin. Working copies and application Save/Start are separate in each workspace.

To move only the original selected source set, the existing Runtime input-set-archive-inspect and input-set-archive-receive commands still accept companion-source-set.zip. Keep the complete source packet and association alongside it when dependency/archive provenance is required.

## Recovery and ownership

Receiving intention, complete input, source manifest, Runtime source edition and workspace UUID are immutable within one receiving directory. Retry the same command and input. Upload retries reuse the original content-derived IDs and received chunks. Already completed source-set members are not retransmitted. The complete association has a stable original upload identity.

The bridge closes all original download handles and the original Runtime model. Close failures remain errors, including after data was saved; they do not turn into a false complete result. A later retry reads the same originals before completing. The same Runtime kernel operation lease spans the original parser, uploads, readback and final result. The original parser's separate CLOSED evidence remains required even if a parent process died and released its kernel lease.

Do not treat an absent native worker or a source-only review as a successful receiving. This source edition has been inspected with the actual maintained source/parser; its filesystem receiving, Runtime interaction and rendered browser course still require the existing actual native owner. No hosted CI, new browser controller, new budget setter or duplicate native engine is requested.

## Exact outgoing product opening

The producing owner must use an isolated authorized cloud/browser context for this course. **From October 13, 2026, 16:00 UTC, Bryce’s local Codex in-app browser is reserved exclusively for him until he explicitly releases it. Do not navigate, capture, resize or test that local browser.** This restriction does not stop existing isolated cloud receiving owners.

Open the exact toolkit archive and its complete guide in the normal recipient view. On the existing Runtime browser, inspect a populated Companion set at desktop/screenshare width and a narrow/mobile width, inspect its complete manifest, download the original packet and association, and reopen the exported archive. Exercise a visible unsupported-input error without altering the original selected set. Observe loading/empty states where the current real workflow exposes them.

Prepare one existing path setting using the same retained request, reopen that working selection, and use the normal provider review. Preserve the actual original application/data and active owners. Inspect the downloaded source, packet, archive contents and every included recipient-facing attachment. Capture screenshots and actually view them. Return exact source/ZIP hashes, workspace and request IDs, viewports, viewed images, controls/exports/reopening and concrete fixes. No source/parser check is a substitute for this actual use. Native or rendering unavailable remains an explicit unfinished receiving step.

## Current owner instructions

# Owner-directed rendered-product inspection

Source: direct owner instruction of October 13, 2026. Repository copy version: `2026-10-13.1`.
Scope: owner-controlled work across providers, local and cloud runtimes, and current and future workers. Existing owner controls remain in force.

Before calling a client/prospect-facing app, website, dashboard, demo, report, presentation or export ready, the producing worker must open/run/render the exact outgoing version, LOOK at the rendered screen or its real screenshots, and operate the important user controls. Check the actual screenshare width and narrow/mobile width where relevant, populated/empty/loading/error states, downloads/exports and reopening. Capturing screenshots without viewing them is insufficient. Fix ugly, broken, unstyled, cramped, clipped, overflowing or unreadable output within the authorized work before presenting it. Code review, DOM counts, HTTP200, unit checks or another worker's approval do not replace seeing the actual product.

The Ecosystem product requires plain industrial design: readable tables, clear hierarchy, consistent typography/spacing, restrained controls, useful labels and responsive layouts. Keep the real workflows/data/computation. Reviews must lead directly to repairs and must not replace implementation/integration or become endless rechecking. The existing focused-validation policy remains; do not run broad suites or build a verification product.

Persist this instruction in the active owner-controlled instruction surfaces actually read by the relevant workers: global/project AGENTS/CLAUDE/GEMINI/rules, provider-specific boot instructions, source mirrors, cloud repository copies and current build/receiving guides. Include this instruction in every delegated child assignment, including assignments to another provider or runtime. Maintainers update their own consumed files and return exact paths, source/version and readback. A coordination acknowledgment alone is not propagation. Do not alter historical evidence or third-party/vendor policies. No forced restarts, new watchers or revival of owner-stopped work.

Inspect the actual completed scientific screens, reports, source pages and downloadable HTML in the real operator. Prior empty-Workspace screenshots are not completed-workspace acceptance. Preserve current engineering owners; other coordinators receive propagation rather than duplicate implementation. Continue native source/runtime/archive joins rather than diverting everyone to cosmetic review. For Ecosystem Sciences, read `opportunities/upstate_forever_2026/CURRENT_OWNER_DIRECTION.md` version `2026-10-13.4`. Bryce's direct instruction at October 13, 2026, 10:46 a.m. Eastern renewed the existing work toward his call and superseded the earlier 10 a.m. cutoff. Preserve active workers, completed scientific outputs and all other standing controls while finishing and integrating the actual application.

Source assembly and standalone application handoffs retain the application-level instruction copies with their current guides. This file records an owner-requested product delivery requirement; it does not change provider safeguards, repository access controls, or existing authorization boundaries.


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
