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
