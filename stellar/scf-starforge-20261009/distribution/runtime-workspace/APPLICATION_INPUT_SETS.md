# Companion source sets for Applications

A source set keeps an entry file and its companion data, configuration, scripts or documents together. Each original file is retained by the existing resumable input library. A separate whole-set manifest retains every relative path and file hash. A working selection copies those files into one editable directory inside the same Runtime workspace.

For example, an entry under `model/network.inp` keeps a sibling `model/patterns.csv` and a relative `../telemetry/readings.csv` at their original positions. The application provider continues to parse its own inputs and report its normal review results.

## Browser workflow

1. Open **Applications → Companion file sets**.
2. Choose one complete source folder, or select all companion files from one folder. Enter a source set name and choose **Save complete source set**.
3. Open the intended application path setting with **Use saved file**. Choose the saved source set and its actual entry file, or **Whole working folder** when the setting expects a directory.
4. Choose **Prepare working set for this setting**. The resulting path enters the existing application form.
5. Use the normal **Review application** and **Save application** controls. The provider reads the working files directly.
6. Reopen **Retained working sets** to reuse that same selection. **Inspect complete retained selection** downloads its manifest and current identity of every original member.

Original-file downloads and the source manifest are available in the opened set. The CLI exports the complete set in one directory. Runtime's ordinary workspace backup retains every original, request, working file, added application output and application revision.

The browser retains a preparation request before sending it. After a lost response, **Continue working-set selection** resumes that exact request. A saved working set is reused without replacing its edits. A different member, target setting or independent editable copy uses a new request ID.

Browser file selection exposes files, so empty directories require CLI directory intake. The browser can subsequently select and reuse that complete CLI-retained set.

## CLI workflow

These commands use the existing Runtime CLI and workspace.

```sh
node distribution/runtime-workspace/cli.mjs input-set-import \
  --workspace /private/runtime-workspace \
  --directory /private/original-source \
  --name "Customer source"

node distribution/runtime-workspace/cli.mjs input-set-status \
  --workspace /private/runtime-workspace --set-id SET_SHA256

node distribution/runtime-workspace/cli.mjs input-set-prepare \
  --workspace /private/runtime-workspace \
  --set-id SET_SHA256 --request-id ORIGINAL_UUID \
  --kind APPLICATION_KIND --field PATH_SETTING \
  --member model/network.inp

node distribution/runtime-workspace/cli.mjs input-set-export \
  --workspace /private/runtime-workspace \
  --set-id SET_SHA256 --output /private/exported-source
```

Omit `--member` to select the whole working directory. File and directory intent is explicit; the normal provider review verifies that the chosen setting accepts it.

The export contains `input-set.json`, a complete `originals/` tree, and `complete.json`. The export preserves source bytes and paths; edited working files remain in the workspace. Re-import `originals/` with the original name to obtain the same set identity. Repeating an export verifies existing original members and completes a matching interrupted prefix.

The CLI preserves every actual regular source file, including hidden files, and empty directories. It reads complete original bytes before admitting the manifest, then verifies source observations and each uploaded chunk. No extension filter or filename shortening is applied.

## Source and recovery contract

A set supports up to 1,024 files, 4,096 directories, 16 MiB per file and 64 MiB total. Uploads use the existing 1 MiB chunks. Larger sources remain available through the established host path workflow.

Paths must already use NFC, relative forward-slash form and portable components. Case is retained. Escaping paths, symbolic links, duplicate members, case collisions, file/directory collisions, reserved device components, control characters and components exceeding the filesystem byte limit are rejected before materialization. Missing source companions must be supplied as their complete original files.

The original manifest is retained before per-file upload initialization. Inspection is read-only. The exact upload identity is shared with the ordinary input library. Preparation retains its target, request ID, whole manifest and working paths before copying files. An interrupted matching prefix is checked before continuation; changed files in an unfinished prefix produce a visible conflict. A completed working directory preserves application edits and additions. Independent preparation requests produce separate working directories.

A normal workspace backup includes both input-library storage and the whole companion-set tree. Runtime's established cold restore reopens at the original workspace path, retaining saved application references and native edit paths.

## Native receiving course

`receiving/APPLICATION_INPUT_SETS_RECEIVE.mjs` executes one retained original source-set, browser Applications and backup/restore course. Supply a complete existing companion directory whose chosen member is an actual Grant scenario accepted by the installed Grant provider, the existing ready Runtime, and existing Node/Chromium/Playwright installations:

```sh
node distribution/runtime-workspace/receiving/APPLICATION_INPUT_SETS_RECEIVE.mjs \
  --operation /private/companion-receiving \
  --directory /private/original-grant-source \
  --member scenarios/customer.json \
  --runtime /private/ready-runtime \
  --chromium /usr/bin/chromium \
  --playwright-root /private/node_modules
```

The course retains the full original folder, begins and reopens a partial upload, completes the same source set, prepares one working selection, edits that selected member without replacing companions, reviews/saves the actual application, and captures desktop and 320-pixel browser output. It then re-imports/exports through the CLI and backs up/restores the same isolated workspace at its original path. Every restored original, working member and saved application revision is compared with its retained identity.

A receiving journal, unique invocation outputs and the original UUIDs permit continuation with the same arguments. The original workspace is retained beside the restored one after archive inspection; other workspaces are not moved. Source-set handling applies to all existing path settings. This course uses the maintained Grant provider's concrete save/connect flow; domain-specific EPANET, Jisc or other native execution stays with the corresponding application.


## Complete archive download and browser receiving

Open a READY source set and choose **Download complete source-set ZIP**. This
downloads its complete original manifest, completion record and every original
file under `originals/`, including zero-byte files and empty directories. It
streams the original file bytes; edited working copies remain separate.

On the receiving Runtime, open **Applications → Companion file sets → Or receive
a complete Runtime source-set ZIP**. Select the whole downloaded file. The
browser reads the entire original inventory and checks every file and chunk
before exposing **Save complete source set**. The review displays its original
set ID, name, origin workspace, file count and directory count. The name stays
with the reviewed manifest.

Choose **Save complete source set** to receive it through the existing resumable
file library. After interruption, reselect the same ZIP and repeat that action;
the content-derived original set ID and acknowledged upload chunks are reused.
An invalid incoming archive leaves the prior complete source selection intact.
Opening another source while a transfer finishes retains both selections.

Choose the intended Application setting, prepare a separate working set, then
use its normal **Review application** and **Save application**. Receiving
original files changes no saved Application, working copy or run. The original
workspace ID shown in the review describes the source; the receiving workspace
owns its normal local upload and working-selection records.

The ZIP uses ordinary uncompressed ZIP members and can be extracted by standard
archive tools. The receiving control accepts unchanged complete ZIPs emitted by
this Runtime profile. For another ZIP format, extract it with its normal tool
and choose the complete source folder through the existing intake. Source sets
still allow 1,024 files, 4,096 directories, 16 MiB per file and 64 MiB of original
content. The complete archive allowance is 96 MiB, including paths and metadata.
No files are omitted to fit. Paths and case collisions use the original source
normalizer.

### Native archive commands and API

~~~sh
starforge runtime-workspace input-set-archive-export \
  --workspace /private/runtime-workspace --set-id ORIGINAL_SET_SHA256 \
  --output /private/new-complete-source.zip

starforge runtime-workspace input-set-archive-inspect \
  --workspace /private/receiving-workspace --archive /private/original-complete-source.zip

starforge runtime-workspace input-set-archive-receive \
  --workspace /private/receiving-workspace --archive /private/original-complete-source.zip \
  --set-id ORIGINAL_SET_SHA256
~~~

Inspect is read-only. Receive validates every original byte before its first
set initialization, then uses the original missing-chunk protocol. Export
publishes a complete fsynced private file exclusively; an existing destination
remains intact. Retrying a receive returns the same content-derived source set.

The original model adds `applicationInputSetArchiveDownload({setId})`, returning
the complete stream, exact byte count, filename, original set manifest and
explicit `close()`. Destroy the stream and call close in a finally block.
The existing same-origin authenticated POST
`/api/application-input-sets/archive-download` prepares one 60-second, single-use
download URL. Receiving in the browser uses the same existing begin/chunk/
complete routes, with the complete manifest retained before member uploads.
The package export `@tokenjunkielabs/starforge-merchant/runtime-workspace/input-set-archives`
carries the typed native archive functions.

### Continue the original equipped course

The same `receiving/APPLICATION_INPUT_SETS_RECEIVE.mjs` adds an archive phase
after the original full backup/restore and history. It downloads the exact
restored original set, independently reads/extracts the ordinary ZIP with
Python's standard library, receives it in the existing control workspace
through the real browser, prepares a separate working selection, cold-reopens
and exports it again. The original source/edited working copy/Application and
all earlier checkpoints stay retained. The original browser and native owner
continues this same operation with its existing arguments.

Inspect the actual archive and every original member with their appropriate
recipient tools, including the actual Grant scenario and companion documents,
in addition to the original desktop/narrow browser course. The archive phase
returns the real screenshots, full downloaded ZIP and extracted original tree.
Producing peers open and LOOK at these outputs and operate the important
controls before presenting the product; source execution is separate from
that actual native and rendered receiving.

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
