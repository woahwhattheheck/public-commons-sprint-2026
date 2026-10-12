# Operate the complete gRPC Contract upgrades workflow

This is the original `SCF-GRPC-CONTRACT-UPGRADE-20261012-6F7C` operation. It uses the merged merchant workspace, the original native gRPC implementation, and the original merchant agent/CLI receiving phase. It runs one intentional application RPC and makes no payment request.

The earlier reflection/server-streaming/browser continuation has its own retained operation and owner. These commands do not resume or replace it.

## Exact source

| Input | Selected identity |
| --- | --- |
| Complete product repository | `woahwhattheheck/public-commons-sprint-2026` |
| Product commit, including PR1798 and PR1814 | `375f29ce7210de14a9cbd13bd2641da1c4e78865` |
| Full product source | 7,443 regular files; 113,507,652 bytes |
| Whole operator journey Git blob | `63a2d71d294e9357f00fd27741aab080f5098691` |
| Original agent/CLI receiving phase | `c17e4bf4b06832bef5e428f8070320e327db59ca` |
| Original four-record receiver | `30b598250cb7720bb1e5b4eee7a39c1e61e700c1` |
| Complete maintained native host manifest, in Commons | `4410a170e653557bbd60c16282babf3db0ae15d4` |
| Referenced host source checkpoint, in Commons | `a2ddcdf51a3f2333279e8f686f223a49ee6183d6` |
| Maintained native runtime identity | `136c70426e445c3a4d03ed1ada7419383f11d4798f1c58f14a9f6aa2a96af737` |

The host manifest retains all 71 selected source and guide files, including the 34 modules reachable by the original native runtime. The checkpoint on `source/grpc-upgrade-native-host-20261012-6f7c` references all 71 exact blobs and modes under `operations/grpc-contract-upgrade-20261012-6f7c/runtime/host/`; its manifest is alongside them. This is a source-only preservation of the original selection. It comes from the original PR34151 carrier `95438367f05d5336cb6a1b6e5a6c8b81dc3a48b2`. That old carrier ends by inspecting another owner's record; use the exact host file selection, not its old operation tail.

The product source is already merged. Source parsing and independent implementation reviews have passed. A source checkout, installation or successful preview is not a completed operator run. The real run result is the retained `result.json` and native checkpoint described below.

## Prepare the selected files

Use an existing worker with Git access to the two original repositories and the existing shared native admission directories. Retain the operation root on that worker's persistent filesystem; the native operation record and completed checkpoint must outlive its private execution directory.

Fetch the two original source references into existing worker repositories. This does not change either checked-out working tree:

```bash
git -C "$SCF_CHECKOUT" fetch --no-tags origin \
  operation/grpc-contract-upgrade-20261012-6f7c
git -C "$COMMONS_CHECKOUT" fetch --no-tags origin \
  source/grpc-upgrade-native-host-20261012-6f7c
```

The SCF operation commit includes selected product `375f29ce7210de14a9cbd13bd2641da1c4e78865` as a parent and retains the reviewed helper, journey and caller. Use the exact operation commit supplied in its receiving handoff. Run `prepare.py` from that published `experiments/grpc-contract-upgrade-20261012-6f7c/` directory:

```bash
python3 -B prepare.py \
  --checkout "$SCF_CHECKOUT" \
  --root "$UPGRADE_ROOT" \
  --native-checkout "$COMMONS_CHECKOUT"
```

`SCF_CHECKOUT` supplies the exact selected product commit and journey blob as Git objects. `COMMONS_CHECKOUT` supplies the exact manifest and host file blobs. The helper produces:

- `source/`: the complete selected regular-file tree, with Git blob and mode verification.
- `payload/selection.json`: the exact source map; `patches` is empty because both product arms are already merged.
- `journey.mjs`: the exact reviewed driver.
- `operation-source.json`: the original operation, source commit, driver and selection digest.
- `native-host/` and its retained manifest when the optional native checkout is supplied.

Preparation never installs dependencies, imports the native host, starts the application, or creates a native operation. Repeat a completed preparation to verify its exact retained files. Use the helper's explicit `--resume` only for its own recorded incomplete source preparation; keep the same root and original Git selections. Preserve existing jobs, outputs and another owner's files.

The complete source needs approximately 150 MiB of allocated storage, plus the small retained runtime and preparation records. Select real worker capacity before copying it. The native placement later performs its own measured copy and admission.

## Use the maintained dependency installation

Set `NODE_EXECUTABLE` to the worker's existing Node 22.16+ executable. Use the complete original merchant archive and runtime installer from selected source `375f29`. The packer needs a real Git object repository: the helper's flat `source/` directory is not itself a checkout. Supply the same original `SCF_CHECKOUT` used above; run the selected tool code from `$UPGRADE_ROOT/source`.

```bash
PYTHON_EXECUTABLE="$(command -v python3)"
TOOLKIT="$UPGRADE_ROOT/source"
DISTRIBUTION="$TOOLKIT/stellar/scf-starforge-20261009/distribution"
PACKED_RELEASE="$UPGRADE_ROOT/merchant-release"
RUNTIME_DIRECTORY="$UPGRADE_ROOT/runtime"
PINS_FILE="$UPGRADE_ROOT/runtime-pins.json"

"$NODE_EXECUTABLE" "$DISTRIBUTION/build.mjs" \
  --repo "$SCF_CHECKOUT" \
  --ref 375f29ce7210de14a9cbd13bd2641da1c4e78865 \
  --out "$PACKED_RELEASE" \
  --python "$PYTHON_EXECUTABLE" > "$UPGRADE_ROOT/merchant-pack-receipt.json"
```

Read the original pack receipt's `archive` and `sha256` fields. They select the original merchant `.tgz`; a GitHub repository ZIP is a different input. The packer preserves its own interrupted output: use its `--status --out "$PACKED_RELEASE"` first and its original `--resume` for that same directory when required.

```bash
MERCHANT_ARCHIVE="$("$PYTHON_EXECUTABLE" -c \
  'import json,sys; print(json.load(open(sys.argv[1]))["archive"])' \
  "$UPGRADE_ROOT/merchant-pack-receipt.json")"
MERCHANT_SHA256="$("$PYTHON_EXECUTABLE" -c \
  'import json,sys; print(json.load(open(sys.argv[1]))["sha256"])' \
  "$UPGRADE_ROOT/merchant-pack-receipt.json")"
"$PYTHON_EXECUTABLE" -c \
  'import json,sys; open(sys.argv[1],"x").write(json.dumps({"@stellar/stellar-sdk":"16.3.1"})+"\n")' \
  "$PINS_FILE"

"$NODE_EXECUTABLE" "$DISTRIBUTION/runtime-install-cli.mjs" prepare \
  --dir "$RUNTIME_DIRECTORY" \
  --archive "$MERCHANT_ARCHIVE" --sha256 "$MERCHANT_SHA256" \
  --native --feature grpc --feature schema --feature mcp \
  --operator --pins "$PINS_FILE"
"$NODE_EXECUTABLE" "$DISTRIBUTION/runtime-install-cli.mjs" install \
  --dir "$RUNTIME_DIRECTORY"
"$NODE_EXECUTABLE" "$DISTRIBUTION/runtime-install-cli.mjs" inspect \
  --dir "$RUNTIME_DIRECTORY" --load --source \
  > "$UPGRADE_ROOT/runtime-inspection.json"

GRPC_NODE_MODULES="$RUNTIME_DIRECTORY/node_modules"
```

The pins file is create-only in this sequence. On a resumed bootstrap, retain and read its existing exact content rather than recreating it. The original installer exposes `resume --dir` and inspection of its existing installation; keep its first package, profile and lock. A complete existing READY runtime may instead be moved through the original `runtime-transfer` export/receive/install workflow, which retains its original lock and cached package tarballs. `install --adopt-existing` is for that complete retained closure, not a collection of unrelated scratch symlinks.

The selected feature profile has 11 top-level dependencies:

| Dependency | Exact version |
| --- | --- |
| `@x402/core`, `@x402/stellar`, `@x402/extensions`, `@x402/mcp` | `2.28.0` |
| `@stellar/stellar-sdk` | `16.3.1` |
| `@grpc/grpc-js` | `1.13.4` |
| `@grpc/proto-loader` | `0.8.1` |
| `protobufjs` | `7.6.6` |
| `re2js` | `2.8.6` |
| `@modelcontextprotocol/sdk` | `1.32.1` |
| `jose` | `6.2.12` |

The merchant agent receiving phase opens the original MCP merchant listener, so retain that feature. Installation uses the normal registry/cache through the maintained installer; its generated lock records the complete dependency closure. The original source stays under `$RUNTIME_DIRECTORY/package/source` and dependencies beside it in `node_modules`.

Use existing Node 22.16+, Python 3.11+, npm and `flock`. Point `PLAYWRIGHT_PACKAGE` at the existing Playwright package and `CHROMIUM_EXECUTABLE` at its existing executable. The original caller binds those existing browser resource paths; browser installation is separate from the operator journey. Keep the prepared source immutable: the original native placement makes its own source copy before the driver adds the dependency link.

## Preview and run through the original native runtime

Keep the following shell and the original foreground handoff in one worker command lifetime. Paths select the worker's existing resources; the source commit, reviewed driver, runtime identity, operation and placement IDs remain fixed by the caller.

```bash
upgrade_args=(
  --root "$UPGRADE_ROOT"
  --host "$UPGRADE_ROOT/native-host"
  --node "$NODE_EXECUTABLE"
  --node-modules "$GRPC_NODE_MODULES"
  --chrome "$CHROMIUM_EXECUTABLE"
  --playwright "$PLAYWRIGHT_PACKAGE"
  --private-root "$UPGRADE_PRIVATE_ROOT"
  --memory-reservations-root "$WORKER_MEMORY_RESERVATIONS"
  --disk-reservations-root "$WORKER_DISK_RESERVATIONS"
)
python3 -B launch.py preview "${upgrade_args[@]}"
python3 -B launch.py run "${upgrade_args[@]}"
```

`WORKER_MEMORY_RESERVATIONS` and `WORKER_DISK_RESERVATIONS` are that worker's existing shared admission directories, outside the invocation-private project. They must already exist. Do not create a competing reservation index for this operation. A new private-root path is prepared by the original placement module, which retains its source/input identities and filesystem observations.

The declaration is 1,344 MiB memory plus 256 MiB reserve: 1,024 MiB for the native application/browser processes, 192 MiB for the complete source copy on a memory-backed filesystem, and 128 MiB for private workspace/download/capture growth. The original placement separately adds measured source-copy bytes and inodes to disk admission. Persistent checkpoints have a 64 MiB allowance. These are declared resource allowances, not measured peaks.

The caller keeps the current invocation alive while the maintained placement completes predecessor/release work and while the original foreground supervisor owns execution. If the same operation already has a request, `run` returns its actual state instead of binding a second private namespace. Continue through the original retained session and supported native recovery.

## What the single journey operates

1. Verify every selected source path and Git blob, not just the files that happen to be present. Record the complete executed-source inventory.
2. Capture the original old and changed protobuf contracts. Compare exact field, method, presence, oneof and native JSON changes through the merged comparator.
3. Operate the original workspace and two browser windows: correct an invalid request, preserve unapplied edits, retain both ordered payment choices and reject an old review after another window changes the current revision.
4. Adopt the reviewed change through the original Save/generation check. Deliberately lose the successful HTTP reply, then recover that same retained outcome without another Save.
5. Make one intentional call to the real native gRPC service, prepare the original merchant package and browser-download all seven customer files. Stage the retained package through the original SF82 release machinery.
6. Invoke the original merchant agent/CLI receiving phase. It reviews the same saved adoption, preserves the first four-record observation across partial/repeated receiving, reopens the complete seven-file customer and uses the original full-result download protocol.
7. Close and reopen the original workspace, inspect the retained review/adoption and confirm that reopening did not increase its generation or dispatch another application call. Inspect the narrow browser layout and page errors.
8. Independently close the browser, workspace and native upstream. Record actual application calls even if an earlier phase fails. Capture the complete result and retained working state through the original checkpoint implementation before the private invocation exits.

The request and service fixture live in this original driver and are written into `inputs/`. They exercise the actual native protobuf and product implementations. They are an authored operator example, not a customer's private production service or a chain settlement.

## Retained result and continuation

Read the native operation through the same selected caller and root:

```bash
python3 -B launch.py status "${upgrade_args[@]}"
```

The original native request, state, logs and completion remain under `$UPGRADE_ROOT/jobs`. The driver synchronously captures:

- `result.json` and `executed-source.json`;
- original `inputs/` and complete retained `workspace/`;
- browser `downloads/` and `captures/`;
- the original agent/CLI `operator/` receiving records and files.

A successful checkpoint has state `complete` before the invocation exits. The driver then writes `checkpoint-receipt.json` and its final result for the original native artifact-retention path. Read the actual checkpoint through the maintained reader, inspect the final operation status and verify its exact artifact hashes.

A failed phase retains its primary error and independently attempts owned cleanup and a checkpoint. Read its actual operation, source and saved workspace before any continuation. Do not infer no application call from an earlier incomplete phase: the finalizer samples the real server's call count. Keep the first failed result and use the original review, adoption, workspace and preparation IDs.

Return the original record/worker identity, selected source, real result, closure outcomes, checkpoint receipt and artifact download to the existing gRPC claim thread. Include any actual import, runtime, UI or receiving failure so it can be corrected in the same product. Preserve the separate reflection/streaming operation and all earlier distribution archive pins.

## Product guides

- Merchant workflow: `stellar/scf-starforge-20261009/sf30-seller-sdk/grpc/UPGRADES.md`.
- Merchant agent/CLI and four-record transfer: `stellar-forge/mcp-merchant-operator/GRPC_UPGRADES.md`.
- Original native placement and checkpoint contracts: the selected host's `NATIVE_PLACEMENT.md` and `NATIVE_ARTIFACT_CHECKPOINTS.md`.

Both source-owned distribution contributions are already in merged375. The next original cumulative distribution cut can include them; this operating guide does not relabel an earlier installed archive.
