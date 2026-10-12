# Managed Support and Grant native receiving

The receiving operation runs the maintained distribution producer and runtime installer, then operates the original managed Applications, SF74 case desk, SF93 incident store, SF47 Operations and Completion interfaces. Its public source includes the executable launcher and all four native drivers.

The operation ID is `SCF-MERCHANT-SUPPORT-APPLICATIONS-24EAD3-20261012`. Keep the same private receiving directory when continuing that operation.

## Run on an equipped Linux host

Use an existing checkout or the original hydrated bare Git cache containing the selected commit and its distribution component blobs. The launcher uses local Git reads with lazy fetching disabled; it does not install a source checkout or change a GitHub account.

Provide the actual Node, Chromium and installed Playwright locations from that host. The original operator runtime uses Linux `flock`, Node's built-in SQLite and the existing Python runtime. This selected distribution profile is `native:false, features:[], operator:true`; its external dependency selection is empty.

```sh
python3 operations/merchant-support-native/receive.py \
  --repository /srv/commons/source.git \
  --source-commit SELECTED_40_CHARACTER_COMMIT \
  --directory /srv/private/support-receiving \
  --work /srv/work/support-receiving \
  --node /usr/bin/node \
  --chromium /opt/chromium/chrome \
  --playwright-module /opt/playwright/node_modules/playwright/index.js
```

Replace the example paths with existing host paths. The private receiving directory holds the actual cases, incident state, source captures, handoff, grant workspaces, checkpoints, reports and screenshots. The work root holds reproducible package source, the installed runtime, browser scratch and npm cache. Choose a writable work filesystem with enough real memory and disk capacity for the producer and browser.

The launcher writes each source edition under `WORK/source-COMMIT`. It extracts the four drivers and the original top-level distribution builder from the selected Git objects. It then invokes `run-native.mjs` with a complete, retained `selection.json`.

The original wrapper performs these steps:

1. Build the exact distribution with `buildDistribution`, reusing its retained build state.
2. Prepare and run the original `prepareRuntimeInstall` and `installRuntime` operations.
3. Read the installed source identity and require the original installer to report `READY`.
4. Run `native-journey.mjs`.
5. Continue that saved Support handoff through `grant-receiving.mjs` and `grant-completion-native.mjs`.

npm writes go to the operation's own real `WORK/source-COMMIT/npm-cache-owned` directory. A shared cache seed or writable global npm cache is unnecessary for this selected profile.

## What the original operation does

The managed Support journey reviews and saves the installed source selection in Applications, starts the original SF74 listener and verifies its actual instance/configuration identity. It operates an original SF30 seller and its operations endpoint, captures an SF93 incident and recovery, uses the original notification queue, prepares a case from retained before/after captures, saves that case, and performs managed Stop and reopen. The actual handoff buffer, saved case, incident state and capture files remain in the private receiving directory.

The same saved handoff enters SF47 Operations through its native preview and receive transaction. The grant continuation retains the original case, source attachment, deployment association, command receipts, archive and receiving copy. Completion uses the explicit WALKTHROUGH case with its six retained cost packages and calendar anchor. It operates payment corrections, the three 90-calendar-day clocks, assignments, completion preparation, original form/extension records and final payment, then reopens the complete original case. The agent/MCP receiving phase uses the original managed providers, accepted request replays and frozen completion ZIPs.

The browser, HTTP, CLI and MCP portions share the same retained case and native engines. The four driver source files define the exact operated journey for the selected commit.

## Continue the same operation

Rerun the same command with the same `--directory`, `--work` and source commit. The original producer and installer inspect their existing state. A saved Support handoff and its case/incident IDs are reused by the original Grant continuation; its Completion phase journal and frozen archives remain in place.

The launcher retains a process lease and the current child PID/start identity, qualified by its actual host, boot and PID namespace. A second launcher for the same receiving directory cannot dispatch another active child. Interrupted calls retain the original private output and logs. The wrapper and native driver return their actual exit status; `native-active.json` reaches `COMPLETE` only after the original native result is complete.

A later corrected source commit must descend from the receiving request's retained source commit. The launcher records that source change and uses a distinct work edition while keeping the same private case/output directory. This lets a source correction use the already saved Support/Grant checkpoint.

To prepare the complete source and installed runtime before a shared browser interval becomes available, add `--prepare-only`. This still runs the actual producer and installer. The active record ends at `PREPARED` and names `WORK/source-COMMIT/journey-selection.json`. Run the original command again without that flag to continue through the same installed source.

## Read the retained operation

| Retained path under the private receiving directory | Meaning |
| --- | --- |
| `native-receiving-request.json` | Original operation ID and selected source history |
| `native-selection.json` | Actual repository, work, source, browser and module selection |
| `native-active.json` | Current original controller, child identity, phase, source and exit result |
| `native-run.log` | Current original producer, installer and native stdout/stderr |
| `native-attempts/` | Earlier retained run logs |
| `native-build.json` | Original distribution result |
| `native-wrapper-result.json` | A wrapper failure when one occurred; read its source/time with the current active record |
| `native-result.json` | Original Support receiving result and exact case, incident, handoff and custody paths |
| `native-live/` | Actual private Support case and incident stores written during the journey |

The original Grant and Completion drivers add their own result, checkpoint, original/received workspace and complete archive paths to the operation. Follow those returned paths when preserving or handing over the result. Keep the raw handoff, case stores, command journals and complete archives together so the next operator receives the same work.

The launcher itself is portable source. Its absolute runtime and customer paths are supplied by the operator and retained privately during execution.
