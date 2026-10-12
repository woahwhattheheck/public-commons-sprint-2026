# Continue the original RisingWave workbench through Applications

The installed Applications workflow reopens the complete workbench produced by
[the native source operation](README.md#source-native-receiving).
It retains the source revisions, native capture manifests, both published
editions, complete differences, original buyer configuration, seller intent
and recurring policy.

The executable is [examples/managed-workbench.mjs](examples/managed-workbench.mjs).
It uses the selected installation's original Runtime Workspace, application
provider, managed release, workbench client and MCP transport. The complete
receiving case can be closed and reopened with the same inputs.

## Select the completed native case and installed runtime

Start with the actual native operator's journey-result.json whose outcome is
PASS. That result binds its product commit, the RisingWave protocol commit,
original source documents, native database identity, source declaration,
capture files, publication runs, older-edition buyer and final workbench reopen.

Keep its original directory intact. The native operator must finish and release
its workbench before Applications adopts that workbench. Its awaited onOpen
callback is available for browser work inside the native caller. Applications
continues from the completed result afterward.

Select a READY installation containing the whole RisingWave product and
original native payment runtime. The inspector checks its package manifest,
source, dependency lock and execution profile. Its selected dependencies include
pg, @x402/core, @x402/stellar and @x402/extensions. The RisingWave source selection
pins pg 8.16.3. Use Node 22.16 or later.

Three different identities have specific roles:

| Identity | Meaning |
| --- | --- |
| Native product commit | The full 40-character commit passed to the original native operation. Supply the same value as --native-source-pin. |
| RisingWave protocol commit | 45baf6460ea942e4ff57a5aa057d5b8db7f3b563, the native v3.1.0 implementation selected by this source. Core capture manifests retain this pin. |
| Installed source manifest | The SHA-256 of the READY installation's original package/manifest.json. Its source commit and product-file digest are recorded separately. |

If the accepting runtime handoff supplies a product-source SHA-256, pass it as
--product-source-sha256. The inspector then checks the original complete source
inventory against that value.

### Retain the original credentials and database

Use the native case's existing connectionStringEnv and optional caFileEnv
references. The installed command needs those values through its inherited
environment or its original private Applications environment file.

An environment file is a JSON object mapping environment names to string
values. Use an absolute path, a private regular file with mode0600, and its
original owner. The original Applications parser reads and validates this
file. The receiver retains its path, SHA-256 and required variable names.
Before adopting the workbench and before every new managed start, it rechecks
the same file and opens a short native connection to verify the original
host, port, database, user and TLS policy.

Keep the original native RisingWave server available through the entire
receiving lifecycle. A local selected server uses the original loopback
connection policy saved in its source. The enabled scheduler belongs to that
same database and original publication.

## Run the complete installed lifecycle

Use absolute paths for the completed native case, selected installation and
new receiving directory. The receiving directory is separate from the
original workbench and runtime.

~~~sh
RISINGWAVE_READY=/absolute/original-ready-installation
RISINGWAVE_NATIVE_RESULT=/absolute/original-native-case/journey-result.json
RISINGWAVE_MANAGED_CASE=/absolute/private-managed-receiving
RISINGWAVE_PACKAGE_MANIFEST_SHA256=the_original_package_manifest_sha256
RISINGWAVE_NATIVE_SOURCE_COMMIT=the_original_40_character_product_commit

node "$RISINGWAVE_READY/package/source/stellar/scf-starforge-20261009/sf30-seller-sdk/risingwave/examples/managed-workbench.mjs" \
  "$RISINGWAVE_MANAGED_CASE" \
  --native-result "$RISINGWAVE_NATIVE_RESULT" \
  --runtime "$RISINGWAVE_READY" \
  --manifest "$RISINGWAVE_PACKAGE_MANIFEST_SHA256" \
  --native-source-pin "$RISINGWAVE_NATIVE_SOURCE_COMMIT"
~~~

For a retained Applications environment file, append:

~~~sh
--environment-file /absolute/original-private-environment.json
~~~

The command uses the already selected runtime. Keep its physical package,
dependency files and managed release available throughout the receiving
operation. Launch it under the accepting host's original operation owner.

The lifecycle performs these actions:

1. **Read the complete native case.** Check the original source input bytes,
   source declaration, database reference, both native captures, complete
   comparison, original buyer and fresh-process native reopen.
2. **Inspect and attach the READY runtime.** Retain its actual manifest, source
   commit, profile, lock and installation identity in one Runtime Workspace.
3. **Review, save and adopt the application.** Select risingwave-publisher and
   the original workbench. Keep the original save request, adoption request,
   managed home and release identity.
4. **Start the managed application.** Validate the original live database,
   save a start review and request ID, and consume the actual private startup
   URL produced by the managed command.
5. **Inspect both retained editions.** Verify the two original published runs,
   row totals, native NULL and empty text, exact integer/decimal/timestamp text,
   original document text, original payment choices and buyer configuration.
6. **Receive complete source editions through MCP.** Initialize the installed
   stdio process and its dynamic 32-tool catalogue, inspect the original
   workbench, read an exact capture range and receive all seven files for each
   original complete capture.
7. **Receive every difference.** Download the complete added, removed and
   changed NDJSON streams and their manifest. The before/after workbench IDs
   and underlying NDJSON hashes bind the selected editions.
8. **Receive the merchant files.** Download each published edition's data.csv,
   dataset.json and candidate.json, plus the original snapshot-pinned buyer
   configuration. Compare their complete lengths and SHA-256 values.
9. **Stop and reopen.** Stop the exact managed command, inspect its retained
   output and result, close the Applications model, and reopen the same
   application in a separate Node process.
10. **Open the second managed process.** Start the same saved application
    with a new reviewed run ID, repeat complete inspection and receiving,
    compare retained identities, and stop that exact second operation.

The native workbench capture ID and core capture ID are distinct. Each
workbench record is matched to its native manifest ID and complete file
hashes. The receiver checks the final source revision observed by the native
fresh-process reopen while preserving the original report revision used to
produce the captures.

The recurring policy remains enabled. Its policy ID and complete policy data
stay bound to the original case. The original scheduler may process an overdue
occurrence while the workbench is open; its actual history, current expected
snapshot and control revision remain visible. The receiver uses those current
values and retains the original policy.

A small retained loopback development adapter supplies the native seller's
supported-payment discovery for this lifecycle. The original paid result
remains attached to the native case, buyer intent and first published edition.

## Include the browser in the same live caller

The complete included callback is
[examples/browser-workbench.mjs](examples/browser-workbench.mjs). It opens the
same saved application during both managed launches. It visits the source and
payment terms, every saved report and typed mapping, both original subscription
reviews, both complete editions, complete differences, both published runs,
the original customer offer, and the saved source and merchant downloads.

Select the existing browser runtime in the caller's environment:

~~~sh
export RISINGWAVE_PLAYWRIGHT_MODULE=/absolute/existing-playwright/index.mjs
export RISINGWAVE_CHROMIUM_EXECUTABLE=/absolute/existing-chromium/chrome
~~~

Both paths are absolute. The Playwright setting is optional when the installed
package already resolves playwright. The Chromium setting is optional when that
Playwright installation already selects the intended browser. These variables
must be inherited by the managed caller alongside its original database
environment file. The callback uses that existing runtime.

Append the included callback to the managed command:

~~~sh
--browser-module "$RISINGWAVE_READY/package/source/stellar/scf-starforge-20261009/sf30-seller-sdk/risingwave/examples/browser-workbench.mjs"
~~~

The callback compares the full browser download stream with each already
received original: fourteen capture files, four complete difference files and
the saved source and merchant declarations. It expands both original published
run panels and the exact offer in the visible interface. It checks complete
row totals, preserved NULL and empty text, precise value representations, the
two original payment choices and the same publication and recurring policy.

Each live phase produces seven desktop views at 1440 by 960 and three views at
390 by 844, together with the browser version, original application/run
selection, file hashes and actual browser outcomes. The complete received data
remain in the original receiving directories. Browser temporary downloads are
removed after their complete bytes have been checked. Screenshots and the
per-attempt result live under browser/<phase>/<attempt>/.

The callback awaits the live browser operation, verifies the saved source and
merchant hashes, and closes its own browser before Applications proceeds to
stop or reopen. The native database, application, MCP process and supported
payment adapter remain under the original managed caller.

### Use the included callback through JavaScript

The JavaScript API accepts an awaited onOpen callback. It runs during both
managed launches, with phase equal to first or reopen.

~~~js
import { runRisingWaveManagedJourney } from './examples/managed-workbench.mjs';
import { inspectRisingWaveManagedApplication } from './examples/browser-workbench.mjs';

const result = await runRisingWaveManagedJourney({
  directory: '/absolute/private-managed-receiving',
  nativeResultPath: '/absolute/original-native-case/journey-result.json',
  runtimeDirectory: '/absolute/original-ready-installation',
  expectedManifest: process.env.RISINGWAVE_PACKAGE_MANIFEST_SHA256,
  expectedNativeSourcePin: process.env.RISINGWAVE_NATIVE_SOURCE_COMMIT,
  environmentFile: '/absolute/original-private-environment.json',

  onOpen: inspectRisingWaveManagedApplication,
});
~~~

The callback receives the actual private workbench URL, original client,
initialized MCP process, selected runtime and native result, and the complete
inspection result in opened. context.mcp.request(method, params) uses the same
JSON-RPC session; context.mcp.call(toolName, input) invokes its original tools.

Await browser work before returning. Keep the browser in the same receiving
caller's process tree so loopback reaches the actual managed service. The
caller keeps that service, MCP session and discovery adapter alive until the
callback finishes, then closes the MCP process and stops the selected managed
operation.

Inspect the saved source and report editor, original subscription requests,
both capture manifests, complete difference download controls, publication
history, recurring policy, payment choices and original buyer file. The
receiving callback observes this retained case. Subsequent source authoring
and publication use their own saved revisions and operation identities.

A separately maintained CLI browser module may also be selected by its
absolute path:

~~~sh
--browser-module /absolute/original-risingwave-browser.mjs
~~~

That module exports the awaited receiving callback:

~~~js
export async function inspectRisingWaveManagedApplication(context) {
  await inspectOriginalBrowser({ url: context.url, phase: context.phase });
}
~~~

## Retained operating files

| File or directory | Contents |
| --- | --- |
| selection.json | Exact native-result bytes, product pin, original workbench and complete runtime/product-source binding; environment path, digest and required names. |
| workbench-before.json | Source revisions, publication source, seller intent and original buyer manifest identities. |
| managed-progress.json | Original save/application IDs, stage attempts, native endpoint checks, start reviews and completed stops. |
| application-review.json | Full original Applications review and adoption selection. |
| application-saved.json | Original saved application and adoption dispatch result. |
| application-adopted.json | Actual managed home and retained release identity. |
| applications/ | Original Runtime Workspace, application records, managed home, operation logs and command results. |
| first-connection.json and reopen-connection.json | Actual private startup URLs and original operation IDs. |
| first-opened.json and reopen-opened.json | Complete product, capture, comparison, scheduler, MCP and receiving inspection from each managed process. |
| fresh-process-reopened.json | Separate Node process's readback of the same application and workbench. |
| <operation-id>-start-review.json | Exact review used by that original managed start. |
| <operation-id>-stopped.json | Original command's actual terminal result and retained output. |
| first-mcp-process.json and reopen-mcp-process.json | MCP process exit, request count and diagnostic output. |
| receiving/first-capture/ and receiving/second-capture/ | All seven original native capture files, each fully received and reopened. |
| receiving/complete-differences/ | Complete added, removed and changed streams, their manifest and original receiving progress. |
| receiving/first/ and receiving/second/ | Full data.csv, dataset.json and candidate.json for each published run. |
| receiving/original-buyer.json | Exact original snapshot-pinned buyer configuration. |
| browser/<phase>/<attempt>/ | Original browser selection, ten complete screenshots, download identities and browser-result.json for that live phase. |
| attempts/<id>.json | Immutable outcome of each actual receiving attempt. |
| managed-result.json | Latest complete outcome, source identities, original lifecycle results and output paths. |

Private state and connection files use mode0600; private directories use
mode0700. Keep the entire original case together when handing its ownership
to another accepting host.

## Continue an interrupted receiving operation

Run the same command with the same directory and original inputs. It reuses
the saved review, application, managed release and adoption selection.
Lost start responses are reconciled through the original request and actual
operation history.

An active original managed command is reopened. An interrupted command is
reconciled through the original Applications recovery operation. A later
start receives a new reviewed run ID after its predecessor is terminal.
The predecessor and actual terminal outcome remain in managed-progress.json.
Completed inspection and fresh-process stages remain retained.

Capture and comparison receiving use the maintained client's original partial
files and full-byte checks. Candidate and buyer downloads validate the
retained prefix against the original response before appending. A completed
file reopens by its exact length and SHA-256.

The command records the actual failed attempt and original worker logs if
execution stops. Correct the specific input, runtime, source or capacity
problem and continue the same selected receiving case. The final outcome is
saved before releasing its case lease. Reopening a completed receiving case
returns that retained result.

## Related operating guides

- [Complete product installation and operation](../../../../products/risingwave/OPERATING.md)
- [Native source, subscription protocol and complete native journey](README.md)
- [Browser, client, CLI and MCP workbench](WORKBENCH.md)
- [Original Runtime Workspace and Applications](../../distribution/runtime-workspace/README.md)
