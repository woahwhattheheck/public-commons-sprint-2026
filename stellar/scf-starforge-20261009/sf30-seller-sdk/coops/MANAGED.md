# Original Applications integration

Coastal source operations is registered as application `coops-coastal-sources` and command `coops-workspace` by the additive `distribution/contributions/coops.json` contribution.

It uses the installed merchant runtime and existing Applications source-input review, process control, startup observer and saved URL record. It does not introduce another launcher or browser.

## Staff inputs

| Field | Meaning |
| --- | --- |
| workspaceDirectory | Original private workspace; reopen existing work or create a selected missing leaf in an existing private parent. |
| inboxDirectory | Optional existing SF88 inbox for receipt inspection/receiving. |
| releaseRuntimeFile | Optional private JSON using original SF82 port/facilitator settings. |
| userAgent | Optional printable source identification, at most 512 characters. |
| Common Applications fields | Original port and process/runtime selections from the existing catalogue. |

Preparation records the selected directory, coastal source files and original store file. A saved workspace's immutable UUID is bound through `--expected-workspace-id`. Mutable capture/review content is not treated as a frozen launcher source file; normal staff work remains valid after reopen.

A selected runtime file is parsed as UTF-8 JSON and retained in source review. The original publisher normalizer is authoritative at startup. NOAA metadata never supplies a payment recipient or facilitator.

## Startup and receiving

The original process emits JSON with schema `stellar-forge.coops-workspace-startup.v1` and status `COOPS_READY`:

- exact selected workspace directory and UUID;
- original inbox/runtime paths;
- actual source directory and User-Agent;
- native PID;
- actual localhost URL with its private bearer fragment.

The Applications observer compares these values with its request, reads the native workspace identity and verifies loopback port/token format. It returns the original URL record while the existing owner retains process and stop/reopen control.

The merchant attachment may use this record through `applicationUrlFile`. It checks startup schema and UUID before calling the console. A rotated token/port is read from the updated host record; source/archive identity stays fixed.

## Source closure

The contribution declares the CLI, workspace, MCP client, public modules, browser manifest and source-owned Applications/merchant providers. The runtime packager follows existing imports to the original store, SF30 query code, publisher, receiver and retained-file implementation.

The application provider is `coops/application-provider.mjs` with implementation `coops/application.mjs`. Shared Applications branches and peer commands are unchanged. Merchant registration uses the existing distribution registry.

## Restart and incomplete work

Stop through the original Applications owner. The console closes active source requests, waits for writes, closes its original publishers and releases the native writer. On reopen, interrupted running/queued captures and studies become paused. Staff explicitly resume retained work.

After interruption, read the original operation ID. The same request reconciles against the journal before revision checks. Neither launcher nor merchant attachment invents a replacement operation.

The browser keeps drafts and exact requests in IndexedDB scoped to the workspace UUID, with no bearer token in durable state. Use the current legitimate startup URL after reopen. The page reconciles its pending operation while keeping later form edits.

## Receiving scope

Use the original source recipe, actual NOAA capture and existing staff controls. Source completion, observation coverage, review, release and customer receipt are separate outcomes; record each only after its native result exists.

The La Jolla recipe supplies public station/date/basis choices. It is not client data, a completed capture, an established project boundary, a paid customer or a finished analysis. Native payment setup and public release remain explicit owner decisions.

For longer studies, use the serial backfill and streamed export in [README.md](README.md). Keep the complete closed workspace in the host's original backup/recovery lifecycle. A source package exchanges selected evidence and does not replace publisher/staff-state backup.
