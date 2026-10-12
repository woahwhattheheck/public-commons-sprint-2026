# Receive the original repository agent and grant workflows

This driver operates the maintained Starforge distribution builder, runtime installer, repository client, managed Applications browser and original grant receiver. It uses one installed source package for the three complete workflows. It retains the original repository operation `f47a-dspace-agent-20261012` and the grant receiver's existing business request IDs.

## Inputs and runtime

Use an existing Linux worker with Node 24 or later, Python 3.12 or later, Git, npm, a working Chromium executable and an installed Playwright module. Reuse the worker's installed components and existing Git objects.

The worker receives these inputs through their existing authorized routes:

- The original complete DSpace delivery ZIP, or the original complete SQLite project with its SHA256.
- A private directory containing the unchanged `prepare-installed-receiving.py`, `mcp-journey.mjs` and `drop-original-response.mjs` supplied by the original grant owner.
- The original grant delivery ZIP.
- The immutable public source commit selected in the original work order.

The driver checks the delivered ZIP and private receiver hashes before starting. With `--project-delivery`, it reads the complete `Repository_Workspace.sqlite3` from that archive and preserves its exact bytes. It also records the existing customer delivery manifests for the original receiving handoff.

## Run the existing operation

Use the same private, persistent directory throughout the run and its continuation:

```sh
python3 installed-receiving.py \
  --ref EXACT_MAINTAINED_SOURCE_COMMIT \
  --directory /absolute/private/f47a-dspace-agent-20261012/run \
  --project-delivery /absolute/inputs/original-dspace-delivery.zip \
  --sf47-receivers /absolute/private/original-grant-receivers \
  --sf47-original-delivery /absolute/inputs/original-grant-delivery.zip \
  --browser-executable /absolute/installed/chromium \
  --playwright-module /absolute/installed/playwright/index.mjs
```

The `--node`, `--python` and `--npm` options can select actual existing executables; otherwise the driver resolves them from PATH. `--npm-cache` selects an existing writable cache.

An optional `--cache-repository /absolute/existing/repository` borrows its Git object database through the new operation's local alternates file. The original repository's refs, configuration and checkout are unchanged. Alternatively, `--cache-archive` accepts the original retained `source.git` cache tarball. `--delta` can reuse already acquired source files only when they match the selected commit's Git blob identities.

For a direct SQLite input use `--project-file /absolute/original.sqlite3 --project-sha256 EXACT_SHA256` instead of `--project-delivery`.

## What the command operates

1. Retain the exact source/input selection in `OPERATION.json`, reuse original Git objects, and call the selected source's `distribution/build.mjs`.
2. Call the original `prepareRuntimeInstall`, `installRuntime` and `inspectRuntimeInstall` APIs with one Node-based operator profile. Verify the exact manifest, source commit, lockfile and installed public imports.
3. Run the installed `dspace/native/agent-consumer.mjs`: complete source receiving, retained metadata and editions, named reviews, typed client and original MCP operations, interrupted complete-file transfer, reply recovery, project/instance binding and saved reopen.
4. Run the installed `dspace/native/managed-receiving.mjs` against that same READY runtime and the agent's complete exported project: two managed operators, three browser tabs, original query/download/receive operations, cookie isolation, stale project protection and Stop/reopen.
5. Prepare and run the original private grant receiver against the same READY package. Its original case, purchases, quoted delivery forecast, saved requests and response-loss recovery remain in the original grant workflow.

The driver retains stdout, stderr, the current owned process identity and all original runtime/workspace journals. It invokes no hosted CI or remote repository mutations.

## Results and receiving

`delivery/DELIVERY_RESULT.json` records the exact source and final artifact hashes. Full completion is `state: "PASS"`.

The repository delivery ZIP contains the exact source TGZ, installed manifest and profile, original repository project, full client/MCP result, managed browser artifacts and operating guides. The package contains one copy of the TGZ.

The separate grant receiving ZIP contains the original grant exports and its source/result records. Keep that file with the original private grant case. It references the same package manifest without duplicating the source archive.

The grant result uses `complete: true`, `completedAt`, and no `error` or `shutdownErrors`. It does not have a `state: "PASS"` property. If the repository flows complete while that original grant continuation needs attention, the outer result is `DSPACE_PASS_SF47_RETAINED`, and the grant's complete private receiving directory is retained.

Return to the original work order:

- The worker and actual native job/process identity, source commit and installed manifest SHA256.
- `delivery/DELIVERY_RESULT.json`, the complete repository ZIP, and the separately routed private grant ZIP.
- `delivery/ORIGINAL_CUSTOMER_INDEX.json` when the original package was supplied.
- Any actual failed phase and its original stdout/stderr/journal.

## Continue an interrupted operation

Keep the original directory and inspect `delivery/INTERRUPTED_RECEIVING.json`, `CURRENT_PROCESS.json`, `progress.json`, and the three native receiving directories. The outer invocation holds a lock only for its own process. Product stores retain their original leases and request journals.

The driver reuses a completed source build and completed native results when the selected source and input hashes match. The repository receivers continue their own recorded phases and requests. A populated incomplete grant receiving root is preserved for its original owner's continuation; the driver does not replay the whole grant journey over it.

On a concrete source defect, return the actual phase and retained selection to the source owner before selecting a corrected source. Preserve the accepted operation IDs and existing workspace. Leave the retained source cache and READY runtime available for that original continuation.
