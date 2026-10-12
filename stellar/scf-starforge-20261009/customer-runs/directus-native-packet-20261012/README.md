# Original Directus native customer and browser receiving packet

This packet continues SCF-DIRECTUS-CONTENT-DATA-A238-20261012. It is source preparation for the already assigned native operation.

## Exact source

Product and SDK foundation: `2ea0387d56922c34feaa7ed92d9d1a961832a665` in `woahwhattheheck/public-commons-sprint-2026`.
The packet contains all 21 Directus files and the original distribution contribution and Applications provider: 23 UTF-8 source files, 416,568 content bytes. Each member has its original Git blob, byte count and SHA256.

`source-packet.json`: 430796 bytes; SHA256 `1f5e326cce37cdfab0e2e4e2a8beb056ee7ffee541adb950c6cb093da10d78c4`.
The packet is accepted directly by the existing `sf30-seller-sdk/directus/native-setup.py` controller, Git blob `268b754215a0f12634cdf99d6654be90a4abad43`.

Acquire the pristine `stellar/scf-starforge-20261009/` source tree from this exact Git commit using the existing public repository checkout and ordinary Git source operations. Reuse the original `distribution/git-source.mjs` reader to verify committed file bytes when the checkout is partial. Its `openGitSource({repository, ref, offline})` returns the exact commit, tree and verified `readFiles()` result. Retain the selected commit and source inventory with the native output. The controller copies that complete SDK source into its owned runtime and records every executed foundation file.

Use that current source tree as `--sdk-source`. Use the existing installed SDK's surrounding `node_modules` only as the dependency donor. Passing an older SDK source tree would omit the current SF88 portable-session and SF100 semantic receiver implementations. The packet's original product commit must remain unchanged.

## One complete native invocation

Resolve these paths from the existing equipped worker, then call the original controller once:

```text
python3 -B CURRENT_SOURCE/sf30-seller-sdk/directus/native-setup.py
  --project ORIGINAL_PRIVATE_PROJECT
  --sources SOURCE_PACKET_DIRECTORY/source-packet.json
  --operation-id SCF-DIRECTUS-CONTENT-DATA-A238-20261012
  --runtime-root ORIGINAL_OWNED_RUNTIME
  --sdk-source CURRENT_SOURCE
  --node-modules EXISTING_SDK_NODE_MODULES
  --node EXISTING_NODE
  --npm EXISTING_NPM
  --playwright EXISTING_PLAYWRIGHT_MODULE
  --chromium EXISTING_CHROMIUM_EXECUTABLE
```

The project directory must already exist and be private. Preserve the same resolved paths on continuation: the controller takes the original project lock and binds the source packet, donor, dependency root and runtime paths in `native-intent.json`. Inspect that original intent, progress, result and active process before retrying. A completed matching result is reused after artifact hashes are checked.

The controller acquires official Directus 12.5.0 / API 40.0.0, creates its own SQLite database and versioning-enabled collection with at least three actual rows, and retains credentials only in its private runtime. It then executes the complete original native customer and browser drivers and closes its child services. Node, Python, Playwright and Chromium remain the equipped worker's existing runtimes; no alternative scheduler or controller is needed.

## Required actual return

Return the original controller's `NATIVE_RESULT.json`, `native-progress.json`, logs and `receipts/execution-source.json`, together with their hashes and resolved runtime versions. Include the customer and browser results, SQLite project exports, received projects, original SF88 session archives and wire observations, and all screenshots.

The actual journey must cover native capture and schema/query pagination; draft create/save/compare/promote/readback; immutable before/after editions; original SF30 publisher and SF88 buyer acquisition with refresh; SF100 delivery; complete project export and receiving; received publisher activation and source change; relocated acquired-session receiving/delivery and repeat receiving of the original archive without losing later progress; and the actual operator at desktop and 390px width.

A prepared source packet or a queued worker is not a completed customer outcome. Retain any actual failure with the original operation and artifacts, and repair its cause before continuation.
