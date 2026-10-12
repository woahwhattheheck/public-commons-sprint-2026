# Original fleet operator receiving

This stage opens the published SF101 operator over the **completed original managed-fleet recovery case**. It uses that case’s encrypted snapshot, authenticated plaintext, receiving declaration, service account, native operation and deployment. It creates one private operator workspace under the case and adopts the native result through the browser, connected CLI and source-owned merchant provider.

The selected product is commit `8a31d674ccc626f9c47e0982e0e66c4e801bae73` (PR 2081). The receiving module verifies the exact published operator files and all ten source files recorded by the original journey. The module’s own bytes and selected runtime executables are also frozen in its receiving record.

## Use the original case

The existing journey is `SCF-MANAGED-FLEET-RECOVERY-RECEIVING-7A2F-20261012`, exposed by its original `runFleetRecoveryJourney` entry. Use that original entry and the actual case supplied by its owner; this receiver reads the authoritative `journey.json` under the selected case.

Its complete original entry is retained in this repository as [Git blob 76e306e88e1654c66afb2ec225853badeb64c3cf](https://api.github.com/repos/woahwhattheheck/public-commons-sprint-2026/git/blobs/76e306e88e1654c66afb2ec225853badeb64c3cf), 26,530 UTF-8 bytes, decoded by its owner as `recovery-journey.mjs`. The original entry records its checked engine source selection at `79c1da0def815f37e5c9a9d651117a6564d3de01`. This operator stage uses the complete published operator source at `8a31d674ccc626f9c47e0982e0e66c4e801bae73`, checks the same ten engine files, and reads the existing case after that original journey completes.

Before this stage, the original journey must have:

- Completed its two-merchant bootstrap, retained release change and customer export.
- Captured the stopped original fleet into its existing encrypted bundle.
- Preserved the original stopped source roots under its own case.
- Authenticated the existing plaintext restore, received the original paths and completed its native `receiving.json`.
- Finished the remainder of its original received-fleet checks and closed its runtime, writers and ports.

Run this stage under the **same nonroot Linux UID and GID** as the captured fleet. Keep the same original passphrase environment variable and Python executable. The variable name must satisfy the existing workspace profile grammar: an uppercase letter followed by 4–63 uppercase letters, digits or underscores. The passphrase must remain in that existing private environment; it is never copied into the host configuration, report, browser or merchant arguments.

The receiver requires an explicit `quiesced: true` acknowledgment. The original case controller owns the actual stop procedure. This receiver does not stop or start the managed fleet.

## One command

Install these two receiving files into the **same selected source tree** as the published operator and the original journey’s verified dependencies. Supply canonical absolute paths to the original source, completed case and existing installed runtimes.

```bash
node /ABS/SOURCE/stellar/scf-starforge-20261009/sf101-merchant-recovery/workspace/receiving/fleet-operator.mjs \
  --source /ABS/SOURCE \
  --case /ABS/ORIGINAL_CASE \
  --python /ABS/ORIGINAL_PYTHON \
  --chromium /ABS/INSTALLED_CHROMIUM \
  --playwright /ABS/INSTALLED_PLAYWRIGHT/index.mjs \
  --quiesced
```

The default private output directory is `ORIGINAL_CASE/operator-receiving`. An explicit `--directory` must select another private subdirectory of that same case. `--timeout-ms` defaults to 120000 and accepts 10000–300000. These are per-operation deadlines, not an overall cutoff for the complete workflow.

Run through the original equipped owner’s maintained foreground/native operation. Declare the installed source/runtime dependencies, the whole browser process tree, receiving-state growth and browser temporary storage. Keep the foreground wrapper alive for the operation and inspect that original record if transport is interrupted. This module does not submit a second fleet journey, create another compute request or modify the ChatGPT trigger list.

Use an existing installed Playwright module and Chromium executable. The browser runs headlessly, with a private persistent profile for each owned open and `--disable-dev-shm-usage`. Select the native job’s existing disk temporary directory through its normal environment and capacity declaration. Actual memory and disk requirements depend on that installed browser and the original case; the receiving owner must use the current measured declaration rather than treat a source-only estimate as an admission result.

## Callable stage for the original owner

```js
import { receiveFleetRecoveryOperator } from './stellar/scf-starforge-20261009/sf101-merchant-recovery/workspace/receiving/fleet-operator.mjs';

const result = await receiveFleetRecoveryOperator({
  sourceDirectory: originalJourney.input.source,
  caseDirectory: originalJourney.input.directory,
  python: originalJourney.input.python,
  chromiumPath: existingChromiumExecutable,
  playwrightModule: existingPlaywrightIndex,
  quiesced: true,
  timeoutMs: 120000
});
```

Call after the original journey has returned its COMPLETE record and its controller has closed the fleet. `directory` is optional and must stay inside that original case. The public function rejects unknown input fields.

The receiver reads `journey.json`, including the original `input`, `environment`, `source.verifiedFiles`, capture/preservation stages and `paths`. It then selects the exact original:

| Original record field | Operator use |
| --- | --- |
| `paths.encrypted` | Host-declared encrypted source |
| `paths.plaintext` | Existing authenticated restore |
| `paths.targetsFile` | Original receiving target declaration |
| `paths.receiveOperation` | Original native receiving journal |
| `paths.receivedBundle` | Prepared deployment in the original native result |
| `environment.uid`, `environment.gid` | Actual service identity |
| `input.passphraseEnv` | Existing passphrase variable name |
| `input.python` | Original Python runtime |

The host profile uses the **actual parents** of the encrypted and plaintext directories as its permitted bundle and restore roots. The operator workspace stays outside those source parents. The receiving module refuses an incompatible layout; it does not move source directories or broaden the original model’s path rules.

## What the workflow operates

### 1. Original native result and source binding

The receiver checks the original native `receiving.json` is COMPLETE, its saved result is `FLEET_RECEIVING_COMPLETE`, and its snapshot, source-plan digest, target file, operation directory, every root, service identity and deployment match the original journey.

It calls the original `inspectRestoredFleet` to authenticate that selected existing source. It verifies the original complete result and native review instead of producing another restore or deployment.

The profile ID is `original-fleet`. The host source and target IDs are `original-authenticated-restore` and `original-receiving-target`. The one workspace request is deterministically named `fleet-adoption-` followed by the first 24 characters of the original native operation ID. Its complete selection is frozen before any start.

### 2. The original listener and connected callers

The receiver launches the existing `workspace/cli.mjs serve` command with port 0, the private host configuration and the saved operator directory. It consumes the original `MERCHANT_RECOVERY_WORKSPACE_READY` line, then verifies the native private launch through `connection.mjs`.

The browser, CLI and source-owned merchant provider borrow that same listener. All returned connection identities must match its workspace ID, configuration digest, instance ID and source directory.

The complete connected CLI contract is exercised:

| Command | Actual selected behavior |
| --- | --- |
| `status` | Same saved workspace and host declarations |
| `bundles` | Original encrypted bundle and snapshot |
| `inventory` | Native `WORKSPACE_REMOTE_STORE_NOT_CONFIGURED` for this local profile |
| `requests` | Original retained local-request page, using limit 1 |
| `request` | Exact same fleet request and completed native result |
| `operations` | Original remote transfer-journal page |
| `operation` | Native `ENOENT` for this local request in the remote-journal namespace |
| `review` | Exact local source, target, native review and outer review hash |
| `start` | Same saved selection and outer review hash |
| `resume` | Same completed request and original result |
| `cancel` | Completed-request readback without changing its native result |

The remote inventory and remote-journal errors are the original local-profile outcomes. No object store configuration or fabricated transfer journal is added for this receiving stage.

Merchant calls go through the original registered `merchant-provider.mjs`, configuration reader and `MerchantRecoveryWorkspaces` client. The workflow calls the source-owned status, review, start, request and resume tools against the same listener. It retains the actual returned objects, including connection identity. This covers the catalog/client/listener integration; it does not claim a separate stdio or HTTP MCP framing run.

### 3. Full browser review and raw selection

The browser verifies the served index, script and stylesheet against the published file pins. It operates the real profile, source and target controls and preserves a raw incomplete operation ID and remote-source text across a reload. The saved text stays distinct from the valid selected request used for preparation.

The review checks every displayed original root, restored path and receiving destination. It checks every retained merchant slot, active/previous release value, generation/history count, snapshot, service identity, target, native journal and native operation. It also reads the full native review JSON displayed by the product.

The browser, CLI and merchant tool must agree on the **outer workspace** `reviewHash`. That hash is kept separate from the native engine’s `reviewSha256` and operation ID.

### 4. A real lost response and the same request

The browser starts the selected operation through the original `/api/start` route. The receiving driver allows the original HTTP request to reach the listener and retains its successful native response before deliberately withholding that response from the browser.

It records the actual browser `requestfailed` event. A planned interruption, an abandoned route or a saved response alone cannot be counted as a completed lost-response observation.

Afterward, both the original CLI and merchant tool read that exact request. The browser refreshes its retained progress and displays the original completed result. Subsequent CLI and merchant starts/resumes use the same selection and ID. They preserve the native receiving result, and completed replays preserve the actual workspace attempt count.

If the receiving process itself was interrupted, a later invocation first reads the same current request. Any unfinished workspace attempt is continued under that ID. Earlier unknown calls stay in the history. The frozen payload is reused; the driver does not infer failure from a lost acknowledgment or select a new destination.

### 5. Result, close and cold reopen

The browser opens the retained request details and the complete native result, including every original root, both merchants and their saved release links. Desktop and 390-pixel views are captured, with an actual document-width check.

Closing the merchant client drains only its own calls. The receiving stage proves the original CLI listener remains available afterward.

The driver then closes its browser and sends SIGINT to its owned original serve process. It waits for that original close and verifies retirement of the native launch. It starts the same saved workspace in a fresh process and verifies its unchanged workspace/configuration identity, new instance and current session.

Only the saved fleet-draft keys are carried to the fresh browser context. The old session token is not carried. The raw selection returns, current quiescence is unchecked, and no prior review is silently reused. The browser and connected callers reopen the same completed request and native result.

Finally the driver rechecks the encrypted manifest, target declaration, native receiving record, selected source and runtime bytes, then closes every owned resource before recording completion.

## Retained files and recovery

All receiving outputs are private and remain under the selected original case:

- `operation.json` freezes the original source, native result, input paths, runtimes, host profile and one request.
- `progress.json` retains stages, calls, launches, browser lifetimes, raw draft state, lost-response observations and any interruption.
- `host.json`, `selection.json` and `merchant-connection.json` are the actual original operator inputs.
- `workspace/` is the saved original SF101 operator state.
- `source/` and `observations/` retain original case/native observations and browser response bytes.
- `calls/` retains actual CLI stdout/stderr and merchant results.
- `launches/` retains private original serve stdout/stderr. These logs contain the temporary session URL and must remain private.
- `screenshots/` contains actual desktop/mobile captures.
- `browser-profiles/` and `browser-downloads/` belong to this receiving stage.
- `result.json` is written only after all stages and owned resource closes complete. It carries the original IDs, native result, stage/caller records and exact artifact hashes.

After interruption, rerun the identical arguments under the same original controller and native operation. Existing immutable receiving files must match. The original request is read before any further same-ID start or resume.

The receiver reconciles its retained launch/browser history against the service account’s actual process arguments and the original authenticated listener. If a matching listener or browser is still live, it stops with that ownership intact. Its original controller must close the existing lifetime before the same receiver continues. A disappeared prior process is recorded as an interrupted close, separately from an observed clean SIGINT or browser close.

An existing COMPLETE `result.json` is reopened by validating its original source/result/artifact bindings. It does not launch another browser or another listener. An interrupted final publication reuses its retained completion candidate after the same verification.

The process prints concise stage/result paths. Preserve the private files through the original case’s existing handover. This stage does not upload the case, expose its session URL, publish its private host paths or move existing native data into another carrier.

## Original source references

- Published complete operator: [PR 2081](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/2081), [commit 8a31d674](https://github.com/woahwhattheheck/public-commons-sprint-2026/commit/8a31d674ccc626f9c47e0982e0e66c4e801bae73).
- Original recovery engine, CLI and fleet documentation: `merchant-fleet-gateway/recovery.mjs`, `recovery-cli.mjs` and `RECOVERY.md`, selected by the actual original journey’s source manifest.
- Original workspace model, fleet adapter and operation guide: `workspace/model.mjs`, `fleet.mjs`, `GUIDE.md` and `FLEET_ADAPTER.md`.
- Original connected CLI, merchant catalog/client/provider and their full operation contract: `workspace/cli.mjs`, `merchant-catalog.mjs`, `merchant-client.mjs`, `merchant-provider.mjs` and `MCP.md`.

These source references describe the implemented workflow. The actual owner’s returned receiving record supplies the execution date, selected host, source hashes and observed result.
