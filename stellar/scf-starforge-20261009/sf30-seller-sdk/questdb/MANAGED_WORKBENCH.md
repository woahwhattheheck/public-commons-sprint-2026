# Continue the original QuestDB workbench through Applications

The installed Applications flow reopens the workbench produced by the complete [native source operation](README.md#complete-native-workbench-operation). It retains that workbench's saved source revision, two published execution editions, capture records, seller intent, payment choices and original buyer configuration.

The executable is [examples/managed-workbench.mjs](examples/managed-workbench.mjs). It uses the original Runtime Workspace and managed release APIs, the installed QuestDB application provider, the original HTTP client and the original MCP stdio transport. Its output is a retained operating case that another operator can reopen.

## Select the completed inputs

Use the original native operation's actual `journey-result.json` with `outcome: "PASS"`. The file binds the native source commit, original source bytes, publication ID, both run IDs, complete capture hashes and the actual paid retrieval of the older edition. The continuation reads those same original directories.

Select one **READY installation** containing the complete QuestDB product, Applications and the native payment runtime. Its saved package manifest, dependency lock, profile and source are verified by `inspectMerchantRuntime`; it must include `@x402/core`, `@x402/stellar` and `@x402/extensions` through that original profile.

The native data source and the installed receiver each retain their own source identity. The default expected native source is `342e328d0ef9b9ba41ecfb9a9171bf0c5393e6b1`, merged by [PR1968](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/1968). The selected installed release's source commit and all original QuestDB application file digests are recorded separately. If the receiving owner supplied a reviewed product-source SHA-256, pass `--product-source-sha256` to enforce it.

The original native operation must have closed its writer before this continuation starts. The Applications resource lease and QuestDB's own workbench lease enforce the original lifecycle. Keep the entire process tree within the receiving host's admitted operation and retain its physical runtime package paths for that operation's lifetime.

## Run the complete installed lifecycle

Use absolute paths. The new receiving directory is separate from the original workbench and the READY installation.

```sh
QUESTDB_READY=/absolute/original-ready-installation
QUESTDB_NATIVE_RESULT=/absolute/original-native-case/journey-result.json
QUESTDB_MANAGED_CASE=/absolute/private-managed-receiving
QUESTDB_PACKAGE_MANIFEST_SHA256=the_original_package_manifest_sha256

node "$QUESTDB_READY/package/source/stellar/scf-starforge-20261009/sf30-seller-sdk/questdb/examples/managed-workbench.mjs" \
  "$QUESTDB_MANAGED_CASE" \
  --native-result "$QUESTDB_NATIVE_RESULT" \
  --runtime "$QUESTDB_READY" \
  --manifest "$QUESTDB_PACKAGE_MANIFEST_SHA256"
```

The manifest value is the SHA-256 of the selected installation's original `package/manifest.json`, as returned by its original READY handoff. This command uses the already selected runtime.

The native case's endpoint variable is restored to its original endpoint. Existing inherited credentials remain environment references. If the original Applications setup uses a private environment file, pass its exact retained path with `--environment-file`; the original Applications validator and start review bind its bytes.

A small local HTTP development adapter supplies the native seller's supported-payment discovery during reopening. It keeps one retained port and identity across interrupted receiving attempts. The original native operation's paid outcome remains bound to its original buyer and source result.

### What the operator completes

1. **Inspect and attach the READY runtime.** Verify the original source manifest, lock and dependency profile, then attach it to one retained Runtime Workspace.
2. **Review and save the application.** Select `questdb-publisher`, bind the original initialized workbench and exact runtime, retain the reviewed inputs and save request ID.
3. **Adopt the original runtime.** The existing managed release writer prepares and adopts that installation. The application retains the original adoption request and release identity.
4. **Start and open.** Review the current source and buyer bindings, start through the original managed command worker, then consume its actual private startup URL and recorded source identity.
5. **Inspect the complete product.** Reopen both original publication runs, inspect their native NULL/empty text, integer text, timestamp text, DECIMAL text and Boolean values, and compare the original two payment choices and buyer files.
6. **Use the installed MCP transport.** Initialize its original stdio process, read the full tool catalogue, inspect the same workbench and older run, read an exact capture range and receive every file in the original sampled capture. The receiving client verifies the complete native capture before marking it complete.
7. **Receive the published files.** Stream both original candidates' CSV, dataset configuration and candidate manifest, plus the original buyer configuration. Each file is checked against its retained source bytes. Interrupted file downloads keep and verify their existing prefix.
8. **Stop and reopen.** Stop the exact managed operation, inspect its actual retained result, reopen the Applications store in a separate Node process, and start the same saved application in a second managed process. The original source, publications, captures and buyer identity are compared again before the second stop.

The first and second launch use separate reviewed run IDs under the same application. A source query or publication is not needed to perform this lifecycle.

## Join the browser in the same caller

The JavaScript API accepts an awaited `onOpen(context)` callback. It is called during both live managed launches, with `context.phase` equal to `first` or `reopen`.

```js
import { runQuestDbManagedJourney } from './examples/managed-workbench.mjs';

const result = await runQuestDbManagedJourney({
  directory: '/absolute/private-managed-receiving',
  nativeResultPath: '/absolute/original-native-case/journey-result.json',
  runtimeDirectory: '/absolute/original-ready-installation',
  expectedManifest: process.env.QUESTDB_PACKAGE_MANIFEST_SHA256,

  async onOpen(context) {
    // Await the receiving host's original browser operation here.
    await inspectOriginalBrowser({
      phase: context.phase,
      url: context.url,
      client: context.client,
      mcp: context.mcp,
      application: context.application,
      runtime: context.runtime,
      nativeResult: context.nativeResult,
      receivingDirectory: context.directory,
    });
  },
});
```

The callback receives the actual private workbench URL, original client, already initialized MCP process, original application/runtime/native result and the complete inspection result in `context.opened`. `context.mcp.request(method, params)` operates the original JSON-RPC session; `context.mcp.call(toolName, input)` invokes the original tools.

Await all browser work before returning. The receiving caller keeps its managed worker and discovery adapter alive until the callback finishes, then closes its MCP process and stops that original managed operation. Launch the browser within this same caller's process tree so its loopback connection reaches the actual workbench.

For the CLI, provide an existing browser module:

```sh
node "$QUESTDB_READY/package/source/stellar/scf-starforge-20261009/sf30-seller-sdk/questdb/examples/managed-workbench.mjs" \
  "$QUESTDB_MANAGED_CASE" \
  --native-result "$QUESTDB_NATIVE_RESULT" \
  --runtime "$QUESTDB_READY" \
  --manifest "$QUESTDB_PACKAGE_MANIFEST_SHA256" \
  --browser-module /absolute/original-questdb-browser.mjs
```

That module exports:

```js
export async function inspectQuestDbManagedApplication(context) {
  // Await the original browser operation using context.url.
}
```

The receiving callback observes the existing source, reports, capture inventory, dataset consoles, payment choices and buyer files. Source authoring, new captures or new publications are subsequent operations with their own reviewed inputs; this receiving case binds the original completed native result throughout.

## Retained outputs

| File or directory | Meaning |
| --- | --- |
| `selection.json` | Exact native result bytes, native source pin, workbench identity and complete selected runtime/product-source binding. |
| `workbench-before.json` | Original source revision, selected publication source, seller intent and buyer manifest identities. |
| `managed-progress.json` | Original save request, application ID, source-bound stage attempts, start reviews and completed stops. |
| `application-review.json` | Full original Applications review, including source input identities and original adoption selection. |
| `application-saved.json` | The original saved application and adoption dispatch result. |
| `application-adopted.json` | Actual managed home and selected release identity. |
| `applications/` | The original Runtime Workspace, Applications records, managed home, operation logs and original command results. |
| `first-connection.json`, `reopen-connection.json` | Actual private startup URLs and original operation IDs. Treat these as private access files. |
| `first-opened.json`, `reopen-opened.json` | Complete source/product/capture/MCP/receiving observations for each managed process. |
| `fresh-process-reopened.json` | Separate Node process's readback of the original application and workbench identities. |
| `<operation-id>-start-review.json` | The exact start review used by that original managed operation. |
| `<operation-id>-stopped.json` | Original worker/result/output after stopping that operation. |
| `first-mcp-process.json`, `reopen-mcp-process.json` | Actual original MCP process exit, request count and bounded diagnostics. |
| `receiving/sampled-capture/` | Complete original capture files plus the maintained receiver's original progress record. |
| `receiving/first/`, `receiving/second/` | Full original `data.csv`, `dataset.json` and `candidate.json`, each hash checked. |
| `receiving/original-buyer.json` | Exact original snapshot-pinned buyer configuration. |
| `attempts/<id>.json` | Immutable outcome of each actual receiving attempt. |
| `managed-result.json` | Latest complete outcome, original identities, lifecycle results and artifact paths. |

Private state and connection files use mode0600; private directories use0700. Runtime ownership remains with the original installer.

## Resume the original receiving case

Run the same command with the same directory and input identities. It reuses the saved review, application and adoption request. A delivered start response is recovered through the original request ID and operation history.

A still-running original managed process is reopened. An interrupted one is reconciled through the original Applications recovery method. A later start receives a new reviewed run ID only after the previous retained operation is terminal; its predecessor is recorded. Completed inspection and fresh-process stages stay retained.

Capture receiving resumes its original partial files. Candidate and buyer downloads validate the retained prefix against the complete original HTTP response before appending. A completed download is reopened by its byte length and SHA-256.

If the command returns an error, the actual attempt and original worker logs remain in this case. Correct that specific source/runtime/input issue, preserve its failed outcome and continue the same selected case. A completed receiving case returns its retained complete result when invoked again.
