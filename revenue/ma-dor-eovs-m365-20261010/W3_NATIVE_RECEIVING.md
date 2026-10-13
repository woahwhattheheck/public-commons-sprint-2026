# W3 original-source receiving and revised native handover

W3 message mapping and reconciliation run in the selected browser workbench. This receiver preserves its complete exported project, every original source/population and all packaged application/report files in the existing migration workbench. It uses the same SQLite Store, source.import operations, content-addressed objects and complete native delivery/receiving implementation.

No broker message is sent or replayed. An accepted source import is a custody receipt; it is not consumer acceptance, business application or a release decision. Those distinctions remain in the original W3 record.

## Complete application

The additive native profile is commons.migration-workbench-application/v7. It includes the current 59-file v6 application plus w3_receiving.py and this guide. All previous profiles, frozen in-progress captures and existing register, CRF, housing, property and case operations remain supported.

The profile change composes onto migration_portable.py Git blob 025a696e2d2fb7a3ed48b56b167e43d95ff45348. The existing Store and source-format implementations are unchanged. Apply the three complete source postimages to the matching current application; preserve later peer additions when the source has advanced. Do not replace a current application with the older 39-file reference packet.

Python 3.10 or later and the standard library are sufficient. Run commands from the maintained application directory. The original create/state/command/file/delivery-file commands in migration_cli.py remain available.

## Browser package contract

The exported file is complete UTF-8 JSON:

~~~json
{
  "schema": "commons.w3-integration-handover/v1",
  "manifest": {
    "record": {
      "path": "w3/workspace.json",
      "id": "original W3 project identity",
      "revision": 26,
      "sha256": "exact SHA-256 of the primary member bytes"
    },
    "files": [
      {"path": "w3/workspace.json", "bytes": 123, "sha256": "exact member SHA-256"}
    ]
  },
  "files": [
    {"path": "w3/workspace.json", "content": "complete original UTF-8 text", "bytes": 123, "sha256": "exact member SHA-256"}
  ]
}
~~~

The numbers and hashes above describe the shape, not an executable fixture. Use the actual exported package. Every member must appear exactly once in both inventories with its complete bytes and hash. UTF-8 is the default member encoding; a binary attachment may explicitly use encoding=base64 with content containing standard base64 and descriptors binding decoded bytes. Names must be NFC, relative, portable paths without traversal, symlinks, case collisions or file/directory collisions. The attachment basename is limited to the original Store's 240 characters. The package and decoded members are each bounded to 256 MiB and 4,096 members.

The primary body has schema commons.w3-integration-workbench/v1. It carries the original id/revision and complete scope_editions, sources, mappings, populations, rehearsals, decisions, releases and history arrays. The receiver verifies package and member identity and custody continuity. Open the project in its maintained browser model to run the full domain/history validation and review the original findings.

The receiver never parses and rewrites source/population text. The authored reference populations contain numeric lexemes 9007199254740993 and 12345678901234567890.123456789; both remain inside their exact original member bytes. When inspecting primary JSON for append-only continuity, decimal values are compared without binary floating-point coercion.

## Inspect before import

~~~sh
python -B w3_receiving.py inspect /absolute/path/W3_Handover.json
python -B migration_cli.py --workspace /absolute/path/native-workspace state
~~~

The first command returns the exact package SHA/bytes, selected W3 id/revision and full member inventory without changing a workspace. For a new original native workspace, use the existing command:

~~~sh
python -B migration_cli.py --workspace /absolute/path/native-workspace create --title "W3 source custody"
~~~

Use the actual current project revision from create/state. Keep authored reference material labelled local_reference.

~~~sh
python -B w3_receiving.py import /absolute/path/W3_Handover.json \
  --workspace /absolute/path/native-workspace \
  --operation-id w3-first-intake \
  --expected-revision ACTUAL_NATIVE_REVISION \
  --actor "original operator" \
  --scope-id "original selected W3 scope" \
  --identity-namespace "original W3 project namespace" \
  --capture-kind local_reference \
  --observed-at "2026-10-13T14:30:00Z" \
  --reason "Retain the selected complete reference edition"
~~~

Use the actual observation time with its offset. Customer exports use customer_export only when that is their real acquisition.

The result returns receipt_source_id, receipt_sha256, the actual native workspace identity, the exact original W3 record identity, every member source/operation ID, and all completed operation receipts. The complete bundle is retained as an attachment as well as each original member, so its original manifest is never lost.

## Retry, interruption and revised return

Retry the same import command with the same operation ID, exact package and context. Existing successful source imports return their original receipt and do not create new operations. A changed package, source context or actor under that ID is rejected. The native revision is required for a new request; an already accepted exact request retains the original Store retry behavior after later workspace edits.

For an interrupted original member operation, inspect its operation.get result through the original CLI. Retry the same import with --resume-reason "actual reason for continuing". This invokes the existing operation.resume path for that original operation and records the new operator/reason. It does not allocate another import ID or silently start a replacement.

To receive a later browser return, choose a new intake operation ID and supply:

~~~sh
python -B w3_receiving.py import /absolute/path/W3_Returned_Handover.json \
  --workspace /absolute/path/native-workspace \
  --operation-id w3-return-intake \
  --expected-revision ACTUAL_NATIVE_REVISION \
  --actor "original operator" \
  --scope-id "original selected W3 scope" \
  --identity-namespace "original W3 project namespace" \
  --capture-kind local_reference \
  --observed-at "2026-10-13T15:00:00Z" \
  --reason "Retain the reviewed later edition" \
  --previous-receipt-source-id ORIGINAL_RECEIPT_SOURCE_ID
~~~

The later record must retain the same W3 project identity. Changed primary bytes require a later revision. Every old collection and the complete history must be an unchanged ordered prefix of the new edition. Reordering or replacing an old edition is rejected even if someone recomputes new digests. Earlier complete package/member objects remain available under their original native source IDs. A later app/report presentation may have new bytes without replacing the original attachment.

## Open the retained browser files

~~~sh
python -B w3_receiving.py extract \
  --workspace /absolute/path/native-workspace \
  --receipt-source-id ACTUAL_RECEIPT_SOURCE_ID \
  --output /absolute/path/new-w3-browser
~~~

The command reconstructs all original members with the original relative names. Open the selected HTML member and use its ordinary project import to open w3/workspace.json. A private receiving-intent file binds the directory to that exact receipt/package. Retrying completes missing original files and verifies existing files; it does not overwrite edited originals or unrelated work. Save revised working records to a new file, then export a new complete handover from the browser.

## Complete editable native handover

~~~sh
python -B w3_receiving.py handover \
  --workspace /absolute/path/native-workspace \
  --operation-id w3-complete-native-handover \
  --expected-revision ACTUAL_NATIVE_REVISION \
  --actor "original operator" \
  --title "W3 complete source custody and editable native workspace" \
  --note "Selected original browser edition and all retained member bytes"
~~~

This calls the existing delivery.prepare operation. Its result includes the actual archive identity and relative_path inside the native workspace. The original migration_cli.py delivery-file command can copy the verified archive to another ordinary file.

~~~sh
python -B w3_receiving.py receive-native \
  /absolute/path/complete-native-delivery.zip \
  /absolute/path/new-cold-receiving
~~~

The original receiver validates the whole application, editable database, every original object and prior retained delivery, then opens the same native workspace identity. Use the application/ and workspace/ in that receiving directory. Repeating its original receive preserves later database edits.

## One focused complete course on the two actual browser editions

This command uses the actual first and later exported packages; it does not create artificial messages or another reconciliation result.

~~~sh
python -B w3_receiving.py course \
  /absolute/path/W3_First_Handover.json \
  /absolute/path/W3_Returned_Handover.json \
  --output /absolute/path/new-w3-native-course \
  --actor "original receiving operator" \
  --scope-id "original reviewed W3 scope" \
  --identity-namespace "original W3 project namespace" \
  --capture-kind local_reference \
  --observed-at "2026-10-13T14:30:00Z"
~~~

The course creates one native workspace, imports the complete first edition, checks an exact retry, prepares a complete native handover, cold-receives it, imports the later edition against the original receipt, verifies an old retry cannot replace the later return, prepares a second complete handover, cold-receives it, and verifies every retained byte from both editions. It materializes the returned browser package under returned-browser/ and writes COURSE.json only after all steps complete.

The two cold directories are restored copies of the same native workspace identity. The course uses the existing Store and source/portable operations throughout. Repeating the same course request can reuse completed native operations and resume materialization; an interrupted source operation still needs its explicit original-operation resume, as described above. Preserve any partial directory and the first actual exception.

A successful COURSE.json demonstrates source custody, operation continuity and cold reopening. Browser screenshots, actual deployed middleware behavior, independent business acceptance and customer delivery remain separate observed results.

## Current owner instruction for outgoing products

Retained from repository AGENTS.md blob46be323017be913780d0d2850b7658861744508d at main8211c201cfe79b171737c2f167c2b16268b237fe. This applies when the actual outgoing workbench and attachments are presented; the source-only native course is not a rendered-product result.

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

