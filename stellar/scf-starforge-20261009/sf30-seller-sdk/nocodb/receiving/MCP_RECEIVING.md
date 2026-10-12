# Receive the original NocoDB workspace through merchant MCP

This is the operator continuation for the complete NocoDB merchant receiving operation. It uses the original Film and Actor source workspaces, their saved native request records, both published Film editions, and the completed TESTNET delivery. The released merchant MCP serves the same source models and borrows their original publisher and scheduler. It also exposes the source model's original SF82 deployment controls and verified private packet reader.

The executable is `mcp-authoring-consumer.mjs` in this directory. The complete product configuration and tool guide is [NOCODB_WORKSPACES.md](../../../../../stellar-forge/mcp-merchant-operator/NOCODB_WORKSPACES.md).

## What this continuation completes

| Operator workflow | Original implementation used | Retained result |
| --- | --- | --- |
| Declare the existing Film and Actor workspaces and a reviewed source input | Merchant configuration reader, original NocoDB workspace identity and lease | Original workspace identities, source SHA256 and exact capture identity |
| Import the retained Film source, review its field union, save a draft, preview every captured row and save a reviewed version | NocoDB authoring model through authenticated MCP | Native import, draft, preview and version request UUIDs |
| Recover one deliberately withheld successful version reply | Original operation receipt and repeated completed version UUID | One saved version and its original receipt |
| Inspect both published Film editions and the Actor edition | Borrowed original publisher, cursor pagination and current target | All 1,000 Film rows in each original order; all 200 Actor rows |
| Read the earlier buyer configuration | Original publisher event-backed handoff | Exact retained SF88 configuration and original snapshot |
| Receive a private source packet across an actual MCP process restart | Original retained-file reader, whole-file SHA256 and original packet parser | Verified packet with the same original manifest, metadata, counts and pages |
| Prepare and receive the two original merchant packages | NocoDB deployment model, original dataset publisher and SF82 compiler | Both sets of five original package files |
| Activate, run, stop, compare and roll back those releases | Original SF82 release console and its exact instance/generation guards | Actual local merchant observations and HTTP 402 challenges |
| Reopen the final workspace and native release state | New original MCP process over the same stores | Selected source version, current published dataset, stopped merchant and native receipts |

The program makes no NocoDB provider request, creates no wallet, signs no transaction and invokes no payment. Its HTTP challenges establish the currently selected release and public terms. The earlier completed TESTNET result remains the authority for the four actual transfers and paid data delivery.

The Film source import uses the already retained complete packet through the original importer. It creates a local source-review record in the same workspace; it does not extract the provider again. The source review preserves the complete captured field/type union and existing projection. Both original published editions and their paid data artifacts stay unchanged.

## Run after the existing whole operation completes

Use the same host, operation ID and original receiving directory. The earlier result must have schema `stellar-forge.nocodb-testnet-receiving-result.v1`, state `PASS`, four completed TESTNET payments, complete Film/Actor receiving, and a stopped original Applications run.

The program reads the exact earlier result and its completed-file identities before opening a source owner. It checks the original core input, core intent, saved source files, published editions and paid-delivery artifacts. It compares those retained bytes again when the continuation ends.

The already assigned Hatch operation selected `ca7abac2245d2a053086222c90f34f8f527a8189` for its provider, authoring, publisher, TESTNET and Applications flow. Keep that running selection intact. This MCP continuation is a later invocation after that operation has returned its actual completed result. Its new source selection must contain the complete PR1723 MCP integration and this executable.

Do not manufacture a completed result, select an unrelated workspace, or point the script at the upstream fixture ZIP. The earlier provider summary's row counts and capture-directory name alone do not supply the native result or its files.

## Existing runtime and source selection

Use the maintained installed merchant runtime and its original `package/source` and `package/manifest.json` layout. The full original builder and installer supply all static imports, browser assets and support files. This program checks every file declared by the selected manifest before importing the native runtime inspector, then verifies that the actual installation identifies that same source root and manifest.

Select the current compatible source through the existing cumulative release or original source builder. The existing full NocoDB receiving profile uses:

```text
--native --feature mcp --operator
```

The original four explicit native pins remain:

```json
{
  "@x402/core": "2.28.0",
  "@x402/stellar": "2.28.0",
  "@x402/extensions": "2.28.0",
  "@stellar/stellar-sdk": "16.3.0"
}
```

The maintained MCP feature supplies its declared MCP dependencies. A source archive alone does not install those dependencies. Do not install them only under the SF88 component: sibling merchant and facilitator ESM imports need the original runtime ancestry.

For an original archive and a new prepared runtime, the maintained commands are:

```bash
node "$NOCODB_DIST/runtime-install-cli.mjs" prepare \
  --dir "$NOCODB_RUNTIME" \
  --archive "$NOCODB_ARCHIVE" \
  --sha256 "$NOCODB_ARCHIVE_SHA256" \
  --native --feature mcp --operator \
  --pins "$NOCODB_PINS"
node "$NOCODB_DIST/runtime-install-cli.mjs" install --dir "$NOCODB_RUNTIME"
node "$NOCODB_DIST/runtime-install-cli.mjs" inspect --dir "$NOCODB_RUNTIME" --load --source
```

Here `NOCODB_DIST` is the distribution directory from the actual selected original source; the archive path and SHA256 come from the original `distribution.json` receipt. If the same runtime preparation already exists, use its original `resume --dir "$NOCODB_RUNTIME"` path. Use an existing ready compatible runtime or the original maintained upgrade where one is already owned; this guide does not request another cumulative producer.

Node 24 or newer, an ordinary POSIX Python with `fcntl`, the already available Playwright module, and its existing Chromium executable are required. The continuation needs no new browser download. Supply the actual host paths returned by the existing operation.

## Prepare the exact private input

The input is private host configuration. It contains no NocoDB token, signing secret, account recovery material or private TLS key.

The following preparation reads actual retained files and derives their hashes. Replace the six positional arguments with the existing completed operation directory, compatible ready runtime, existing Playwright module, existing Chromium executable, Python executable and named reviewer. The script writes one create-only input alongside the original operation. A repeat requires identical bytes.

```bash
node --input-type=module - \
  "/absolute/original/completed-operation" \
  "/absolute/original/ready-runtime" \
  "/absolute/existing/playwright/index.mjs" \
  "/absolute/existing/chrome-headless-shell" \
  "/usr/bin/python3" \
  "Named operator" <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const [completed, runtime, browserModule, browserExecutable, python, reviewer] = process.argv.slice(2);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const resultFile = path.join(completed, 'result.json');
const resultBytes = fs.readFileSync(resultFile);
const result = JSON.parse(resultBytes);
if (result.schema !== 'stellar-forge.nocodb-testnet-receiving-result.v1' ||
    result.state !== 'PASS' || result.payment?.completedPayments !== 4 ||
    result.applications?.finalPhase !== 'STOPPED') {
  throw Error('Use the actual completed original NocoDB operation.');
}
const sourceRoot = path.join(runtime, 'package/source');
const manifestFile = path.join(runtime, 'package/manifest.json');
const driver = path.join(sourceRoot,
  'stellar/scf-starforge-20261009/sf30-seller-sdk/nocodb/receiving/mcp-authoring-consumer.mjs');
const input = {
  schema: 'stellar-forge.nocodb-mcp-receiving-input.v1',
  operationId: result.operationId,
  consumerSha256: digest(fs.readFileSync(driver)),
  completedOperation: {directory: completed, resultSha256: digest(resultBytes)},
  sourceRoot,
  sourceManifest: {file: manifestFile, sha256: digest(fs.readFileSync(manifestFile))},
  runtimeDirectory: runtime,
  browser: {module: browserModule, executable: browserExecutable},
  python,
  reviewer
};
const inputFile = path.join(completed, 'mcp-receiving-input.json');
const bytes = Buffer.from(JSON.stringify(input, null, 2) + '\n');
if (fs.existsSync(inputFile)) {
  if (!fs.readFileSync(inputFile).equals(bytes)) throw Error('Retained receiving input differs.');
} else {
  const fd = fs.openSync(inputFile, 'wx', 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  const dir = fs.openSync(completed, fs.constants.O_RDONLY);
  try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
}
console.log(JSON.stringify({inputFile, inputSha256: digest(bytes), driver}));
NODE
```

The executable independently checks absolute canonical paths, the original operation ID, source hashes, private file ownership and source-manifest membership. A copied customer download may carry the `.mjs.txt` suffix for transport; run the matching `.mjs` file from the actual selected source package.

## Execute the continuation

Use the exact driver and input printed by the preparation step:

```bash
node "/absolute/selected/package/source/stellar/scf-starforge-20261009/sf30-seller-sdk/nocodb/receiving/mcp-authoring-consumer.mjs" \
  --input "/absolute/original/completed-operation/mcp-receiving-input.json"
```

The normal entry invokes Python only to acquire the **existing** original `operation.lock`. It does not create a replacement lock or native queue. The inherited descriptor is passed to each real merchant MCP child, so a surviving original source writer continues to hold the same operation lease if its caller disappears.

The internal `--locked-input` mode is for that wrapper. Do not invoke it by inventing a descriptor environment variable.

The original CLI runs the MCP children:

```text
stellar-forge/mcp-merchant-operator/serve.mjs serve --config PRIVATE_CONFIG --port 0
```

The continuation generates an in-memory bearer token for each owned child and uses the existing `openMerchantFileClient` implementation for initialization and every authenticated tool call. It validates the real native listener announcement. The configuration points to the same existing Film/Actor source stores and original generic release/export stores.

The source model opens its own existing publisher. MCP access borrows that handle and scheduler through the reviewed native lifetime. It does not open an independent publisher against the same directory.

## Request and restart behavior

Before a mutation, the program durably saves the exact native arguments and request UUID. Completion is read from the original NocoDB operation record. A deliberately withheld successful version reply is resolved through that saved record, and a later process repeats the same completed VERSION request to confirm the same version identity.

The source packet is received into an owned private partial file. Each accepted prefix is fsynced and recorded with its SHA256 before the next chunk. At the first packet boundary, the original MCP process is stopped normally. A new original process opens the same source workspace and receives the remaining bytes using the original version, whole-file hash and offset, with a new reader ID. The original packet parser then checks its manifest and every captured member.

A partial file may contain bytes after its last durable receiving checkpoint if the caller stopped during a write. Only that owned unpublished tail is truncated. The verified prefix, complete file, original source members, and earlier operation outputs are retained.

SIGINT/SIGTERM stops new receiving work and drains the exact owned MCP process through the original CLI. This closes the original source model, publisher, scheduler, deployment console and owned merchant. The wrapper does not kill arbitrary PIDs, delete lock files, or claim that an unreturned child has exited. Its inherited operation descriptor stays with a surviving child.

For a caller interruption, inspect:

```text
mcp-authoring/intent.json
mcp-authoring/result.json
mcp-authoring/logs/
```

Then rerun the same command with the same private input. Completed stages and original request UUIDs are retained. Saved deployment commands are reconciled through original operation/resume before a following launch; that native recovery observes current SF82 state and never resubmits the uncertain command. A later needed launch uses the current console instance, selection generation and reviewed release digest, and records a new deliberate request after the prior owner is stopped.

The deployment flow saves each completed edition and rollback stage. An interrupted later stage does not require repeating an already completed paid receiving baseline or re-extracting the provider.

## Deployment scope

The source-owned deployment packages bind each original published run to its original saved source version and capture digest. They do not pretend that a later source-review version produced an earlier dataset. The program prepares and receives the five original files:

- `dataset.csv`
- `dataset.json`
- `seller.json`
- `source.json`
- `binding.json`

These are the original public projection and merchant-binding files. The raw private packet remains a separate private download.

The native release flow stages A and B, runs each on an actual loopback listener, reads its exact HTTP 402 requirement, stops the exact observed merchant instance, compares the releases, and rolls back to A through SF82. Each change uses the original console instance, native selection generation and inspected release digest. No payment authorization header is sent.

Final state is A selected in this source-owned release store and the merchant stopped. The original published dataset's current edition remains B, and both retained snapshots remain available. The earlier generic merchant release store and its paid result are preserved.

## Result and delivery

Successful completion writes:

```text
<original-operation>/mcp-authoring/result.json
```

Its schema is `stellar-forge.nocodb-mcp-receiving-result.v1`. It records the actual selected source and installed runtime identities, native request UUIDs, real child process lifecycle, source versions, complete projected-value hashes, buyer configuration identity, received package and packet hashes, original deployment observations, desktop/mobile screenshots, and final native state.

`PASS` requires the complete workflow and normal owner drain. The earlier provider/payment/customer result and declared original artifacts must still match their hashes. `NOT_COMPLETE` preserves the remaining original state and a concrete error code. A source publication, startup announcement or HTTP 402 response is not reported as completion of the earlier payment operation.

Return the actual result file and SHA256, the original capture and published snapshot identities, final source/version/release state, and the specific retained private artifacts needed by the original owner. Keep the complete private packet and original provider pages in authorized host custody. Public source and customer guides contain code, commands and public result identities; they contain no private Sheet/NocoDB credentials or signing material.

The original customer's case, correspondence, scope and receiving operation remain the same. This continuation adds the complete MCP operating workflow and its actual result to that existing delivery.
