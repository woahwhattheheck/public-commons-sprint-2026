# Operate the complete gRPC request-stream workflow

Operation: SCF-GRPC-REQUEST-STREAM-20261012-9B23.

This continuation receives the merged client-streaming and bidirectional product through its original native service, merchant workspace, agent tools, browser editor, CLI and customer files. Six original application calls cover the successful, empty, non-OK and cancelled paths. Each call retains its own native UUID, input, output and actual server observation.

## Selected source and existing execution owner

| Input | Identity |
| --- | --- |
| Repository | woahwhattheheck/public-commons-sprint-2026 |
| Merged request-stream product | PR1872, f37188e8426dc34e8d317693328fd30f65e58737 |
| Complete selected product and receiving driver | 4a766644d2c89e498d741cf9f5a1097695c37453 |
| Complete source | 7,800 regular files; 128,913,424 bytes |
| Reviewed journey Git blob | 2c04cbbf175241a9f1c0204af60480c9af987399 |
| Journey bytes | 39,887 |
| Maintained native host manifest in Commons | 4410a170e653557bbd60c16282babf3db0ae15d4 |
| Referenced complete host source | a2ddcdf51a3f2333279e8f686f223a49ee6183d6 |
| Maintained runtime identity | 136c70426e445c3a4d03ed1ada7419383f11d4798f1c58f14a9f6aa2a96af737 |

The operating branch is operation/grpc-request-streams-20261012-9b23. Its selected product commit contains the merged product plus this full journey and the example's decoded-payload counter and durable service-observation hook. The prepare and launch files pin those exact source identities.

Use the accepted equipped worker and its existing native admission directories. Coordinate its position in the original queue in the [native controller thread](https://tokenjunkielabs.slack.com/archives/C0C1F274SGH/p1791742555271459), then return results to the [original gRPC product thread](https://tokenjunkielabs.slack.com/archives/C0BTB4SUCP9/p1791762658249419). This operation has its own request-stream ID; the original contract-upgrade operation keeps its already selected source and receiving identity.

## Prepare the selected source from the worker's Git objects

Set SCF_CHECKOUT and COMMONS_CHECKOUT to the worker's existing repositories. Set REQUEST_STREAM_ROOT to a private retained directory on its persistent filesystem, whose parent already exists. Keep this directory for the operation's source, native records and checkpoints.

Fetch the two referenced branches into those existing object stores:

~~~bash
git -C "$SCF_CHECKOUT" fetch --no-tags origin \
  operation/grpc-request-streams-20261012-9b23
GRPC_OPERATING_COMMIT="$(git -C "$SCF_CHECKOUT" rev-parse FETCH_HEAD)"
git -C "$COMMONS_CHECKOUT" fetch --no-tags origin \
  source/grpc-upgrade-native-host-20261012-6f7c
export SCF_CHECKOUT COMMONS_CHECKOUT REQUEST_STREAM_ROOT GRPC_OPERATING_COMMIT
~~~

The source handoff supplies the exact operating commit. Inspect GRPC_OPERATING_COMMIT against that handoff and retain it. Extract its two helpers using the existing Git object store:

~~~bash
python3 -B - <<'PY'
import os, pathlib, subprocess
root = pathlib.Path(os.environ["REQUEST_STREAM_ROOT"])
root.mkdir(mode=0o700, exist_ok=True)
prefix = "experiments/grpc-request-streams-20261012-9b23/"
for name in ("prepare.py", "launch.py"):
    content = subprocess.check_output(["git", "-C", os.environ["SCF_CHECKOUT"],
        "show", os.environ["GRPC_OPERATING_COMMIT"] + ":" + prefix + name])
    target = root / name
    if target.exists():
        if target.read_bytes() != content:
            raise RuntimeError("Retain the existing selected helper: " + str(target))
    else:
        with target.open("xb") as output:
            output.write(content)
        target.chmod(0o700)
PY
python3 -B "$REQUEST_STREAM_ROOT/prepare.py" \
  --checkout "$SCF_CHECKOUT" --root "$REQUEST_STREAM_ROOT" \
  --native-checkout "$COMMONS_CHECKOUT"
~~~

The original materializer creates the complete source, payload/selection.json, journey.mjs, operation-source.json, and all 71 selected native-host source and guide files. The host manifest covers the original 34 runtime modules. Every file, mode, size and Git object is verified before the final source receipt is published.

Repeated complete preparation verifies those exact retained bytes. For its own interrupted source selection, repeat the same command with --resume; the original ownership marker and partial files keep that continuation tied to the first source. The source tree requires about 150 MiB of allocated storage plus the small native host. The later private execution copy has separate measured admission.

## Select the installed runtime

Use the existing complete native merchant dependency closure on the equipped worker. The required versions are the same as the original gRPC operating installation:

| Package | Version |
| --- | --- |
| @x402/core, @x402/stellar, @x402/extensions, @x402/mcp | 2.28.0 |
| @stellar/stellar-sdk | 16.3.1 |
| @grpc/grpc-js | 1.13.4 |
| @grpc/proto-loader | 0.8.1 |
| protobufjs | 7.6.6 |
| re2js | 2.8.6 |
| @modelcontextprotocol/sdk | 1.32.1 |
| jose | 6.2.12 |

Set NODE_EXECUTABLE to Node 22.16+, GRPC_NODE_MODULES to that complete installed directory, CHROMIUM_EXECUTABLE to the worker's existing Chromium, and PLAYWRIGHT_PACKAGE to its existing Playwright package. Python 3.11+, Git and flock are used by the maintained source/native tooling.

The existing runtime-transfer export/receive/install path can receive the complete locked merchant runtime onto the selected worker. If an installation is actually needed, use the original [runtime preparation and installation procedure](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/d234e2ed463b8dfa8a17654cedf7667c05f3dec9/experiments/grpc-contract-upgrade-20261012-6f7c/OPERATE.md#use-the-maintained-dependency-installation), with this operation's selected source commit and receiving root. Keep the original installer record and dependency lock with the installation.

## Preview and execute in one worker invocation

Set REQUEST_STREAM_PRIVATE_ROOT to this operation's invocation-private execution directory. WORKER_MEMORY_RESERVATIONS and WORKER_DISK_RESERVATIONS select the worker's existing shared admission directories.

The following function keeps all bindings explicit. Keep the native foreground handoff alive through completion in the same worker invocation.

~~~bash
run_request_stream() {
  python3 -B "$REQUEST_STREAM_ROOT/launch.py" "$1" \
    --root "$REQUEST_STREAM_ROOT" \
    --host "$REQUEST_STREAM_ROOT/native-host" \
    --node "$NODE_EXECUTABLE" --node-modules "$GRPC_NODE_MODULES" \
    --chrome "$CHROMIUM_EXECUTABLE" --playwright "$PLAYWRIGHT_PACKAGE" \
    --private-root "$REQUEST_STREAM_PRIVATE_ROOT" \
    --memory-reservations-root "$WORKER_MEMORY_RESERVATIONS" \
    --disk-reservations-root "$WORKER_DISK_RESERVATIONS"
}
run_request_stream preview
run_request_stream run
~~~

The declaration is 1,344 MiB of memory and a 256 MiB reserve: 1,024 MiB for native application/browser processes, 192 MiB for the complete source copy on a memory-backed filesystem, and 128 MiB for private workspace/download/capture growth. Persistent checkpoints have a 64 MiB allowance. The original placement also measures copy bytes and inodes. These are declared allowances; the actual native status carries the observed execution.

If the same operation already has request.json, the caller returns that original state and record. Continue the retained operation through its maintained native controller. Source preparation, application state and receiving outputs remain attached to their original identities.

## The single native customer journey

1. **Source and typed request.** Verify every selected source blob. Capture the original protobuf contract. Preview 128 messages containing maps, optional fields, oneofs, base64 bytes and 64-bit decimal values through native validation, MCP and CLI. Validate the configured channel.

2. **Upload and same-ID recovery.** Send 128 actual native messages through Upload. Observe real Writable backpressure, half-close and terminal status. Reopen the same native UUID and its retained result.

3. **Bidirectional and terminal variants.** Send 128 messages through Exchange and receive the exact retained NDJSON repeatedly. Operate empty Upload and Exchange, a deliberate non-OK native response with its durable prefix, and cancellation after actual input progress. Together these are the six original application calls.

4. **Original terminal recovery.** Retain the exact original attempt/output in private create-only backup files and a hashed phase journal before either controlled failure. Recover stale failure metadata through the original reader. Confirm a changed terminal output is rejected. Restore the original bytes. A resumed phase first restores those retained originals; the same UUID remains authoritative.

5. **Industrial sequence editor.** Import the 128-message request through the original browser. Page 20 messages at a time, edit message 21, duplicate/move/remove it, validate, and download the edited JSON. Save desktop 1440×1050 and narrow 390×844 captures with actual layout and page-error observations.

6. **Merchant and customer receiving.** Prepare the original merchant, export and repeatedly receive all seven customer files, then use the generated SDK to form its request. Exercise the original 402 payment preview and 400 native validation response through the running merchant.

7. **Request-policy upgrade and releases.** Review a one-message candidate policy against the original examples, correct those examples, adopt through the retained review, receive the candidate customer files, and operate original SF82 stage/activate/rollback with observed generations. A resumed adoption explicitly selects its retained adopted revision.

8. **Offline original receiving.** Close the merchant/workspace, inspect the original attempt through CLI, and receive the same NDJSON hash. Close the upstream and record all resource closure outcomes. Capture the complete working state through the original native checkpoint implementation.

Each successful service entry waits for operator/native-calls.json to be fsynced before processing application input. Its observation is bound to the already-checkpointed original UUID and session. Final call accounting reads this durable journal, including service entries whose client reply was interrupted.

## Original files and returned result

The complete seven-file customer receiving layout is:

- methods.json
- openapi.json
- client/seller-client.mjs
- client/seller-client.d.mts
- client/seller-openapi.json
- client/package.json
- client/README.md

The original transfer/ directory retains the common download protocol separately from the usable client/ files, so repeated receiving uses the same manifest and native paths.

Run the same caller's status action to inspect the original request:

~~~bash
run_request_stream status
~~~

The driver preserves result.json, executed-source.json, inputs/, workspace/, downloads/, captures/ and operator/ through the existing checkpoint implementation. The private operator directory includes the durable server-call observations, first-output recovery backups/journal, original CLI outputs and MCP configuration. A complete checkpoint is recorded before the private invocation exits; checkpoint-receipt.json accompanies the final result.

Return the exact operation and worker record, selected source, all eight phase outcomes, six retained native UUIDs, actual service observations, resource closure outcomes, customer/source hashes, desktop/narrow captures and complete checkpoint/download into the original gRPC thread. The customer and operator outputs keep their original source and request identities throughout receiving.

Product guide: [REQUEST_STREAMS.md](../../stellar/scf-starforge-20261009/sf30-seller-sdk/grpc/REQUEST_STREAMS.md). The selected host's NATIVE_PLACEMENT.md and NATIVE_ARTIFACT_CHECKPOINTS.md describe the maintained execution and checkpoint contracts.
