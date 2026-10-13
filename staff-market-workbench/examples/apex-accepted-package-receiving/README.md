# Receive the original accepted Apex case

This example consumes the original complete six-export archive:

- File: apex-accepted-placement-exports.zip
- Complete length: **119,254 bytes**
- SHA-256: d2700b5d31a78da61d5fbf7f94c5e62cae9d677cdd40f69a3eb08bc954c67d7a
- Original workspace provenance: workspace-64a7a33c16294ea490bc1a630753c9b3
- Original application: PR1791, commit 1b69ab4dd5e91eecb554367dba3e40fd48bbec50
- Original company/operator thread: https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791774555464879

**original-case.json** retains all six exact member hashes and the original document selection. The method contains 27 grades, the role edition 47 roles and the selected workforce 19 rows. The three already accepted scenarios are immediate, phased and deferred implementation. Their original calculations and reviews are received intact.

The original full Apex workspace database was not part of this six-export archive. The receiver creates an explicit receiving workspace while retaining the original workspace ID as source provenance. It preserves the original document IDs, content hashes, review bodies and source relationships.

## Execute the native receiving journey

From the complete maintained staff-market-workbench application:

~~~bash
python3 -B classification/receive_accepted.py \
  --package /absolute/path/apex-accepted-placement-exports.zip \
  --expected-source-sha256 d2700b5d31a78da61d5fbf7f94c5e62cae9d677cdd40f69a3eb08bc954c67d7a \
  --expected-source-bytes 119254 \
  --expected-case examples/apex-accepted-package-receiving/original-case.json \
  --workspace /absolute/path/apex-received-workspace \
  --output /absolute/path/apex-receiving-operation \
  --operation-id APEX-ACCEPTED-PACKAGE-RECEIVING-20261013-F11 \
  --actor "F11 original Apex receiving" \
  --source-ref https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791774555464879 \
  --origin-workspace-id workspace-64a7a33c16294ea490bc1a630753c9b3 \
  --require-original-export-bytes
~~~

The full run performs native preview → receiving → same-operation replay → complete original-document/member/accepted-export readback → native backup → restore → exact reopened comparisons. It retains the original requests and first responses before progressing. Run the same command after interruption; the native saved operations and source inputs are reused.

The final output includes:

- **RECEIVING-SELECTION.json**, the actual receiving workspace identity and original scenario/document selections.
- **RESULT.json**, the complete native results, exact source/export identities and reopened comparisons.
- **received-workspace-backup.zip**, the native portable case with original source bytes, documents, reviews and local receiving history.
- **source/**, the complete unchanged original input.
- **requests/** and **responses/**, the exact original native mutations and explicit replay.
- **receiving-readback/** and **restored-readback/**, complete original documents, individual original members and all six current accepted exports.

To open the received case:

~~~bash
python3 -B cli.py --workspace /absolute/path/apex-received-workspace serve --host 127.0.0.1 --port 0
~~~

Use **Classification → Receive accepted package → Received packages** to reopen the native receipt. Its original-document links use the preserved IDs. The same original classification views provide all source rows, accepted exports, explicit new drafts and subsequent reviews.

To open its saved backup elsewhere:

~~~bash
python3 -B cli.py --workspace /absolute/path/reopened-apex restore \
  --package /absolute/path/received-workspace-backup.zip
python3 -B cli.py --workspace /absolute/path/reopened-apex serve --host 127.0.0.1 --port 0
~~~

The original FSU→Apex browser operator owns the subsequent UI continuation. It selects the actual receiving workspace from RECEIVING-SELECTION.json, preserving the original scenario IDs. This receiving helper creates no browser or duplicate scenario calculation.

# Owner-directed rendered-product inspection

Source: direct owner instruction of October 13, 2026. Repository copy version: `2026-10-13.1`.
Scope: owner-controlled work across providers, local and cloud runtimes, and current and future workers. Existing owner controls remain in force.

Before calling a client/prospect-facing app, website, dashboard, demo, report, presentation or export ready, the producing worker must open/run/render the exact outgoing version, LOOK at the rendered screen or its real screenshots, and operate the important user controls. Check the actual screenshare width and narrow/mobile width where relevant, populated/empty/loading/error states, downloads/exports and reopening. Capturing screenshots without viewing them is insufficient. Fix ugly, broken, unstyled, cramped, clipped, overflowing or unreadable output within the authorized work before presenting it. Code review, DOM counts, HTTP200, unit checks or another worker's approval do not replace seeing the actual product.

The Ecosystem product requires plain industrial design: readable tables, clear hierarchy, consistent typography/spacing, restrained controls, useful labels and responsive layouts. Keep the real workflows/data/computation. Reviews must lead directly to repairs and must not replace implementation/integration or become endless rechecking. The existing focused-validation policy remains; do not run broad suites or build a verification product.

Persist this instruction in the active owner-controlled instruction surfaces actually read by the relevant workers: global/project AGENTS/CLAUDE/GEMINI/rules, provider-specific boot instructions, source mirrors, cloud repository copies and current build/receiving guides. Include this instruction in every delegated child assignment, including assignments to another provider or runtime. Maintainers update their own consumed files and return exact paths, source/version and readback. A coordination acknowledgment alone is not propagation. Do not alter historical evidence or third-party/vendor policies. No forced restarts, new watchers or revival of owner-stopped work.

Inspect the actual completed scientific screens, reports, source pages and downloadable HTML in the real operator. Prior empty-Workspace screenshots are not completed-workspace acceptance. Preserve current engineering owners; other coordinators receive propagation rather than duplicate implementation. Continue native source/runtime/archive joins rather than diverting everyone to cosmetic review. This instruction does not extend or restart the Ecosystem sprint: the existing cutoff is October 13, 2026 at 10:00 a.m. America/Kentucky/Louisville, 14:00 UTC.

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
