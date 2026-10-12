# Original Study Source Refresh operation

This is the complete retained-source, mapping, comparison, review, delivery and receiving operation for Study Source Refresh at `33e15a25627d5a21d5f7436bcb790225b08a4714`. It uses the maintained original Census ACS, BLS LAUS/QCEW and HUD release readers. It preserves both native Census releases, source units, MOEs, suppression states and acquisition protocol. The input declarations identify retained public source files; no merchant or new collection is started by this operation.

## One original process

Materialize the product and its original dependency closure from the pinned Git tree into a source directory. The operator verifies each present source file against source-index.json before copying it into its task-private work directory. The existing source closure at `/dev/shm/study-refresh-4bf5/source` already passed the full Python application import and all three original Node provider imports.

Use the maintained Commons native operator with operation ID `STUDY-SOURCE-REFRESH-NATIVE-4BF5-20261012`. Reserve 512 MiB for process residency, 640 MiB for task-private temporary storage and 12 MiB for shared result artifacts; memory-storage is additional, with the original clean-cache policy and 256 MiB reserve. Use the caller's existing current host runtime and native foreground continuation. Inspect an existing record before resuming an uncertain dispatch.

The original command is:

```sh
python3 run-native.py \
  --source /dev/shm/study-refresh-4bf5/source \
  --out /dev/shm/study-refresh-4bf5/check \
  --work /dev/study-refresh-native-4bf5-20261012 \
  --inputs inputs.example.json \
  --node "$CODEX_PRIMARY_RUNTIME_NODE" \
  --node-modules "$CODEX_PRIMARY_RUNTIME_NODE_MODULES"
```

Keep `run-native.py`, `native-case.py`, `browser.mjs` and `source-index.json` together. The native process owns its private execution directory for its whole lifetime. Adjust the four original input paths in a private inputs file if an existing equipped receiver holds the same bytes at another location. Source providers verify their native capture identities on intake.

## Connected behavior and returned artifacts

The operation imports both ACS releases and the retained BLS capture, creates one HUD source declaration through the original HUD release builder, freezes explicit geography and unit mappings, distinguishes same-period comparisons from successive-release comparisons, saves review decisions, inspects original provider rows and exports the complete packet.

It imports that packet into an existing empty workspace, repeats receipt without duplicating source events, and receives/reopens it in a fresh workspace. The complete archive is preserved before browser work. The browser opens the actual receiving operator, reads source inventories and rows, reopens frozen mappings and reviews, saves a receiving review, verifies the retained incoming package and downloads its complete ZIP. Authentication and origin checks use the actual HTTP server.

The shared output contains `native-result.json`, `materialized-source.json`, `Study_Source_Refresh_Original_Packet.zip`, browser results and three screenshots. Original manifests and source files remain inside the packet. A failure retains its phase and exact error in native-result.json; continue the concrete source operation after resolving it.

The existing SF100 data-room archive from the original completed Census operation is a separate receiving input. Use the application's `receive-scan` command with its actual saved scan JSON and original session/pages/output files to exercise the native acquisition return. Keep the saved scan unchanged and use the native receiving paths it references.
