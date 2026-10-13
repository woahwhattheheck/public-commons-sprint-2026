# Edited companion source editions

Open **Applications → Companion file sets** and select **Review edited source edition** on an existing working set. This reads every current regular file and directory, including additions, removals and empty directories. The comparison uses the exact original set that created this working folder. It does not rebase the folder onto a newer set.

Enter an edition name, inspect the paged complete comparison, and choose **Save reviewed source edition**. If any file changes before capture completes, review the complete current tree again. A retained interrupted request remains available in the browser and native history. **Retain pending request and review another edition** preserves that exact request while allowing the new review. The original working directory and all uploaded originals remain in place.

Open the saved edition as a normal source set. Choose its actual entry member or folder, prepare a separate editable working set, then use the original application review and save controls. If the former entry file was removed, explicitly choose the new entry. The application provider continues to validate its own input.

## CLI

The same commands are available through the installed Runtime CLI:

```sh
node cli.mjs input-set-review --workspace WORKSPACE --selection-request-id SELECTION_UUID --name "Revised source" --output review.json
node cli.mjs input-set-capture --workspace WORKSPACE --request-id CAPTURE_UUID --review review.json
node cli.mjs input-set-edition --workspace WORKSPACE --request-id CAPTURE_UUID
node cli.mjs input-set-edition-export --workspace WORKSPACE --request-id CAPTURE_UUID --output NEW_HANDOFF_DIRECTORY
node cli.mjs input-set-edition-receive --workspace RECEIVING_WORKSPACE --request-id RECEIVE_UUID --directory COMPLETE_HANDOFF_DIRECTORY
node cli.mjs input-set-edition-received --workspace RECEIVING_WORKSPACE --request-id RECEIVE_UUID
```

Use the same capture UUID and complete review JSON to continue an interrupted capture. A completed replay returns the originally captured edition even after later working edits. To capture different bytes, make a new review and use a new UUID.

The handoff directory contains `edition.json`, its completion record, and complete `parent/` and `current/` original-source exports. Each set retains its full relative paths, empty directories, manifest, original member bytes and completion record. Transfer the whole directory. Receiving validates both complete trees before admitting them, preserves the full original capture and source-workspace identity, and creates its own receiving request. Subsequent working selections belong to the receiving workspace. The original parent/current relation is retained; other earlier capture operations remain in their original workspace history.

The browser downloads the complete comparison, original capture/receive records and original files through the existing source shelf. The CLI supplies the full parent-and-current directory handoff. A complete Runtime workspace backup also retains every original upload, capture/receive request, working edit and source edition.

## Installed receiving continuation

Run the native continuation with the actual original edited working selection and the existing equipped browser:

```sh
node receiving/APPLICATION_INPUT_EDITIONS_RECEIVE.mjs \
  --operation NEW_PRIVATE_EDITION_RECEIVING_DIRECTORY \
  --workspace ORIGINAL_COMPANION_RECEIVING_WORKSPACE \
  --selection-request-id ORIGINAL_SELECTION_UUID \
  --chromium EXISTING_CHROME \
  --playwright-root EXISTING_NODE_MODULES
```

This reads the original selection and preserves its actual complete edited tree. It creates an isolated receiving workspace, uses browser review/capture/reopen and actual manifest download, runs the complete CLI parent/current export, independently receives both sets, prepares the current editable copy, and backs up/restores/reopens the capture workspace. The original workspace and selected working files are retained. Each invocation keeps its own output directory and images. Continue with the same operation directory and arguments after interruption.

Open the actual desktop and 320px screenshots, use the outgoing desk controls and downloaded source manifest, and inspect the complete exported parent/current folders. If a concrete error appears, repair the maintained source and continue the same native operation.

## Required product use

# Rendered product inspection policy

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
