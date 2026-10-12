# Native Flowable process and decision operations and customer receiving

This source runs the original Flowable 8.0.0 REST application and the complete operator product. The live engine owns process execution, task assignment, migration validation, DMN evaluation and operating history.

## Original engine

The selected original engine is Flowable 8.0.0, source commit 0779d68e5a3385b74d8acb8bc37901ff54513249. The original release ZIP is 101,332,703 bytes with SHA-256 d0f9ad0b7b2170881d66928178cf31c66084f1d6e3ffe6237afb32d8e9f4ad1d. Its self-contained application is wars/flowable-rest.war. The launcher executes this member with Java17 or later and a private H2 file database.

Original sources:

- https://github.com/flowable/flowable-engine/releases/tag/flowable-8.0.0
- https://github.com/flowable/flowable-engine/tree/0779d68e5a3385b74d8acb8bc37901ff54513249
- https://github.com/adoptium/api.adoptium.net/blob/main/docs/cookbook.adoc
- https://adoptium.net/installation/ci-scripts/

The launcher reuses an installed Java17+ executable. If needed, it resolves one original Temurin21 JRE from Adoptium's publisher metadata, saves that exact selection, checks the publisher's artifact digest, and reuses the selected bytes when resumed. Playwright and Chromium likewise reuse the existing installed runtime; an absent runtime is acquired under the private native operation directory with its original package metadata and selected files retained.

## Whole original journey

The native journey deploys three complete BPMN process families: grant review, customer onboarding and vendor approval. Each has two original release versions. All first versions have intake and review work; the second version adds a final task after review.

The journey starts real processes with business keys and native typed variables, including a long integer that exceeds JavaScript's exact numeric range. It exercises claim, release of a claim, delegation, resolution and completion through the workspace. Flowable validates two original ProcessInstanceMigrationDocument bodies and migrates the selected running processes from their first to their second definition versions. One process retains its original version. The operator browser completes the final task of the migrated vendor process.

One accepted process-start reply is deliberately interrupted after its original engine response has been retained. The workspace is closed and reopened. The original saved dispatch is repeated locally with the same request UUID, then its actual native outcome is read. The journey checks that the original business key identifies one process and that the native start request was sent once.

Complete engine portfolios retain deployments, definitions, running processes, current tasks and original process, task, activity and variable history. Original BPMN resources and native replies are downloaded from immutable source references. The complete workspace is exported, reopened, received by a separate workspace and reopened there. A second complete export carries the later original history into that receiving workspace. The installed product hook then opens the same received data through its CLI, typed client, Applications provider and MCP surface on the same original engine.

The operator source has a neutral industrial layout. The native browser records the overview, definitions, migrations and actual task completion.

## Native decision editions and operating history

The same original REST application exposes the DMN service at
`/flowable-rest/dmn-api`. The launcher waits for the actual native decision
endpoint and saves a separate `dmnConnection` beside the original process
connection. Both use the same private engine and its host-owned credentials.

The decision programme deploys the six complete resources in
[the native decision catalog](fixtures/decisions/decision-catalog.json).
It runs all four authored business cases against each edition:

| Native family | Input | First edition | Second edition |
| --- | --- | --- | --- |
| Grant eligibility | Exact decimal `10000.1250` and integer `922337203685477580612345` | Specialist review | Standard review |
| Grant eligibility | Exact decimal `50.2500` and the same large integer | Standard review | Standard review |
| Vendor review | Screening score 75 | Routine review | Enhanced review |
| Onboarding | Contractor, remote true | Contractor onboarding | Remote onboarding |

These are editable demonstration rules with their original XML and native
Flowable results. The actual browser then prepares, reviews and evaluates
the second grant edition, opens its native execution audit, and retains
screenshots of the decision portfolio, evaluation and audit.

The complete decision capture includes all native definition versions,
deployment resources, execution records and original audit bytes. The
installed continuation evaluates the current native rule through the typed
SDK, installed CLI and authenticated MCP connection, using the same saved
connection and original body. Its final complete export is received through
the original MCP file stream, adopted and cold reopened with every process
and decision revision.

The native journey reports its original engine mutations and retained
responses. A completed decision result contains all eight versioned case
evaluations, the actual browser operation, source hashes, historic audit
downloads and the installed continuation. The selected contribution
publishes the full native DMN contract and source catalogue beside the
operator's [decision guide](../../../../products/flowable-merchant/DECISIONS.md).

## Run with the complete original source

Use an existing Linux worker with the complete source and Node24 or later:

~~~sh
python3 stellar/scf-starforge-20261009/sf30-seller-sdk/flowable/flowable-native-host.py \
  --source-root /absolute/original/source \
  --source-revision ACTUAL_INSTALLED_COMMIT \
  --runtime-directory /absolute/private/flowable-runtime \
  --directory /absolute/private/flowable-native-operation \
  --operation FLOWABLE-PROCESS-OPERATIONS-D76C-20261012
~~~

The runtime directory is the READY maintained runtime-install result for the same flowable-merchant release, prepared with --feature mcp --operator. The launcher inspects the complete original package, source, selected dependencies and recorded lock before running the journey from runtimeDirectory/package/source. Applications preparation and merchant MCP therefore use the installed product and its actual dependencies.

Optional original runtime selections are --node, --java, --playwright-module and --chromium. The default engine heap is 768MiB and the default CPU count is two; --java-heap-mib and --native-cpus select the available host allocation.

The native directory owns the engine configuration, credentials, H2 database, process identities, package selections, source revision and saved journey. Continue that directory with its original input after an interruption. A kernel lease excludes a second native owner. Process identity includes its Linux boot ID and start time; cleanup closes only the original process groups owned by this operation.

The host keeps its mode-0600 application-environment.private.json outside the journey handover. The installed journey receives only that path and uses the maintained Applications environment reader. The installed product, Applications owner and merchant configuration directories live beside that private file, so their original listener credentials and URL records remain with the native host. The complete customer downloads, receiving receipts and browser images remain in the journey handover. The workspace and its complete customer export retain environment variable names.

## Receive source and build the original selected product

receive-source-release.py consumes one complete commons.flowable-build-source.v1 JSON packet containing the original signed Git commit capture, complete tree and selected full source members. Every member carries its original Git object ID, bytes, SHA-256 and Base64 content. The original tree retains each blob entry's native size metadata, including when its other metadata is compacted for transfer.

The receiver reconstructs the original Git objects with the maintained git-object-receiving.py, builds the flowable-merchant selection using the maintained distribution builder, inspects the whole selected product archive, and creates an editable complete-source ZIP plus a separate commons.flowable-source-release.v1 manifest.

~~~sh
python3 receive-source-release.py \
  --packet /absolute/complete-flowable-source.json \
  --directory /absolute/private/flowable-source-receiving \
  --native-directory /absolute/private/flowable-native-operation
~~~

source-release-result.json identifies the complete source ZIP, source manifest, selected release and original distribution receipt. With --native-directory, the same invocation prepares, installs and inspects the original selected runtime, continues the native launcher, and joins its completed workspace export to the source, installed runtime and selected release. Interrupted dependency installation resumes in the retained runtime; interrupted archive preparation uses the maintained installer's original recovery workflow, preserving the earlier directory.

## Complete receiving outputs

The native programme resumes interrupted portfolio captures and preparation with their original frozen inputs. After a pre-dispatch interruption, it retains the refreshed prepared revision and saves a dispatch input for that review. When a native request was already dispatched, continuation uses its original saved input and native readback. The installed SDK, CLI and MCP hooks likewise reopen current preparation records instead of caching an interrupted result. Interrupted readback can continue with the same reconciliation request.

A completed original native run produces delivery.json, journey/journey.json, native-receiving-manifest.json and flowable-complete-native-receiving.zip. The completed scope is complete-native-process-history-and-cold-receiving. The archive contains the closed original journey workspaces, source downloads, two full workspace exports, native operation reports, installed product receiving results and browser images.

The source receiver's final nativeWorkspace identifies the later complete NDJSON export, its exact saved export and receiving records, and the original journey step complete-native-process-history-export-and-cold-receiving. These paths and exact bytes are the inputs to the original company case receiving workflow.
