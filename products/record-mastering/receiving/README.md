# Receive the installed Record Mastering workspace

Run one complete operator example through the original distribution, Applications host, browser and Merchant MCP, then reopen both the live application and an exported customer workspace.

The programme retains its requests and results across interruption. It calls the maintained product and native client interfaces; the decision engine remains in `sf30-seller-sdk/record-mastering`.

## Select the original runtime and source

Copy `preparation.example.json` to a private directory and replace its absolute paths with the actual selected source, Git object checkout, build destination, runtime destination, receiving directory and retained browser executables. Pin the source commit that provides the complete `record-mastering-workspace` product.

Use the Node version required by the selected public distribution (the standalone native engine requires Node 22.16 or later), Python 3.11 or later, npm and flock. The installed browser exercise uses the selected Playwright and Chromium paths. Reuse an existing compatible runtime dependency graph or the original installer's explicitly selected cache/network mode.

```bash
node prepare-installed.mjs --request /absolute/private/preparation-request.json
```

The original build uses the `record-mastering-workspace` distribution selection and verifies source against the supplied Git object database. The complete source directory is used to load the maintained builder and installer. A copied source directory is not a substitute for the selected upstream Git identity.

Preparation writes its request and every build/install stage before proceeding. It reuses the original builder's resume mode and the native runtime inspector. A partially prepared runtime is preserved and recovered into a separately named directory. Once the selected runtime is READY, the result identifies `receiving-case.json`.

Optional preparation inputs:

- `retainedDependencies: {"directory": "/absolute/original-runtime", "lockSha256": "64_HEX_DIGEST"}` selects the complete original package-lock.json and node_modules. The native runtime inspector decides whether they satisfy the selected profile.
- `npmCache` and `nodeHeaders` select actual retained directories understood by the original installer.
- `offline` is explicit; the installer never silently changes the selected mode.

## Run the complete receiving case

```bash
node installed-receiving.mjs --case /absolute/private/preparation/receiving-case.json
```

The programme creates a clearly titled workspace from the original committed CRM and billing example CSVs. It retains a stable operation identity and uses the original native public API to review matching, merge records, choose values, activate corrections and prepare customer deliveries.

It then:

1. Prepares the private product with the complete native Merchant configuration, original release-store resume and Applications review/save/connect.
2. Starts the saved application through its original managed owner.
3. Opens the desktop and 390px browser, saves a working note and checks the native retained value.
4. Uses all eight original Merchant tools to inspect source input, import and review a refresh, activate it and prepare a new customer delivery.
5. Retrieves both the editable workspace and customer dataset in exact chunks, checking each chunk and complete archive digest.
6. Receives the original workspace into an independent Merchant alias, edits that receiver and preserves sender state.
7. Makes later sender work and replays the earlier export request, retaining the original selected archive.
8. Stops and cold-starts the same saved application, reopens its browser and Merchant state, and independently opens the exported customer workspace at its selected revision.
9. Closes the managed application and writes the complete RESULT.json.

The original product's operating guide is `../OPERATING.md`. Customer datasets and editable workspaces are distinct native artifacts; both remain in this case's private downloads directory.

## Continue after an interruption

Use the same original JSON file and command. Each programme takes a native process lease and records namespace-aware process identity. Inspect that retained owner and its outcome before starting a continuation.

Preparation state is `preparation.json`. A missing-source result retains the original `sourceCommit` and exact `missingObjects` list; acquire those objects into the same repository and resume the unchanged request. A retained dependency failure also keeps the native `inspection` result. A saved application `EXITED` or `LAUNCH_FAILED` result is returned immediately with its original operation identity. Receiving state is `receiving.json`, with complete action inputs and results in `steps/`. Application IDs, accepted operation IDs and URLs are retained in the original ready records. Completed steps are reused; interrupted steps retain their original input and dispatch identity. The original Applications owner handles recovery and stop. Public connection preparation waits for both the retained release and `connectionReady` before Start.

Each Start retains its exact selected native request before dispatch. Closure distinguishes a request that was never dispatched from an uncertain dispatch: an uncertain existing native request is reconciled with the same application, review and operation IDs. Positive closure requires the original cancellation or the completed original-command result; an inactive, pending or interrupted observation does not release receiving ownership. A failed launch is closed only when the managed owner explicitly confirms that its child and observer are closed. The immutable `application-<slot>-closed.json` receipt retains that evidence.

If interruption closed a run before its normal receiving stop step, continuation keeps all original business actions and starts a separately retained `first-resume-00001` or `reopen-resume-00001` attempt. Completed normal stages keep their original result. Browser, Merchant clients, transport, native client and original application close are attempted independently; a failing close retains the same receiving lease until each actual owner ends. SIGINT and SIGTERM stop new steps and enter this same closeout.

An interrupted export resumes its prepared original request and complete snapshot bytes before checking later workspace revision. It never regenerates an earlier export from later work. Failed native service or Merchant provider closure can retry the same owner; the source does not mark closure complete before the actual handle closes.

The programme deliberately requires exact original request bytes on reopen. Change a case only through an explicit separately retained selection after reconciling its original operations. Preserve the private workspace, runtime, download files and step records together.

Internal desktop/mobile screenshots are for operator inspection. The final RESULT.json records the selected source, original workspace binding, managed run IDs, customer archive identities, received alias and completed stages.

## Validation status

The preparation, receiving and lifetime modules have passed JavaScript parsing. Exact source functions were exercised for unentered and uncertain dispatch, original cancellation, confirmed failed-launch closure, rejected inactive pending output, closure replay and preserved resume slots. The native cleanup/export methods were exercised separately for failure retention and replay after a later revision. These are source-level checks. The complete installed receiving operation is retained separately; its final RESULT.json is the completion record.
