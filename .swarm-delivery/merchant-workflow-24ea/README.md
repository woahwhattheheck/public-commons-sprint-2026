# Merchant Workflow and Recipes native receiving

This source selection runs the complete original two-workspace merchant workflow and reusable recipe receiving operation merged in PR 1998.

- Original operation: `ASTRA-24EA-MERCHANT-WORKFLOW-20261012`.
- Product source: `ce592daecb3865d0d2395764991ab8e276f2df5f`.
- Original entry: `stellar-forge/mcp-merchant-operator/receiving/workflow-recipes-journey.mjs`.
- Complete source selection: 497 exact Git blobs, including all 197 distribution JSON documents, the 71 registered provider declarations, the actual seller/client runtime and all five original console browser assets.
- Source packet SHA-256: `b7d01eb49ade2b2fee84e6f9afcf52992c48eda59ece387989bf04ac2af2982e` (3,216,944 UTF-8 bytes).
- Portable receiving helper SHA-256: `379c19bd9e10d308085ceb4730049f3a031664cd99491b440fa697b314734ff8`.

## Run on an existing Linux worker

Select the installed Node, Chromium, Playwright and application dependency paths on the worker. Keep the same persistent receiving directory on every continuation. The helper installs the exact original source into a separate writable work directory and places the Chromium profile there. Cases, native requests, completed phases, customer files and both workspace profiles remain in the persistent receiving directory.

```sh
python3 run-native.py \
  --source-packet source-map.json \
  --directory /absolute/persistent/merchant-workflow-receiver-24ea \
  --work-dir /absolute/writable/workflow-receiver-work \
  --node /absolute/installed/node \
  --chromium /absolute/installed/chromium \
  --playwright-module /absolute/installed/playwright/index.js \
  --node-modules /absolute/installed/node_modules
```

Adding `--inspect` reads the original baseline and recipe checkpoints, completed results and active owner without launching a child. It verifies the exact packet before reading the operation and does not require those executables to be available.

The helper uses one inherited flock on the original receiving directory. Runtime identity includes the host, boot ID, PID namespace and original process start time. Signals reach the owned native process group; an interrupted output consumer leaves private logs and completed native records intact. Original source files and runtime records are written atomically. If an invocation-local browser profile has disappeared, recovery replaces its dangling link only after matching the original saved runtime custody.

## Complete original flow

The baseline performs the original seven merchant calls: stage, activate, start, client export, manifest, stop and final status. It uses the actual merchant operator, two original console workspaces, persistent Chromium, original browser drafts, review and pause/resume, recovery after an accepted operation, and complete outbound and returned profiles. The existing completed baseline is reused after its full produced artifact hashes match.

The recipe continuation performs actual reusable recipe commissioning and binding to the selected original tool catalog. It retains the exact installation before losing a response, recovers the same installation, runs its eight original tool steps, creates the complete six-file native client, issues a later edition, receives the full profile into the second workspace and cold-reopens the completed work.

## Retained outputs

Read `workflow-native-run.json` and `workflow-recipes-native-run.json` for the original produced results. Their corresponding receiving checkpoint files preserve completed phases and the exact requests needed to continue. The helper additionally retains `native-active.json`, immutable native attempt records, `runtime-custody.json` and the native output log.

The packet does not contain access tokens or private customer state. The original receiving entry creates its local operation token in the chosen private directory. Keep that directory and its complete workspaces and artifacts with the receiving owner.
