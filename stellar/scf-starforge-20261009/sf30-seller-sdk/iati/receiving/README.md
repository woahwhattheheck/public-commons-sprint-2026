# IATI operator receiving through an installed runtime

This is the complete second stage of one IATI customer workflow. The caller first
retains actual public publisher XML, builds native activity/transaction/budget
editions and saved portfolio revisions, verifies reference counts and exact
financial groups, and **closes that original core workspace**. This callable then
opens the same saved workspace through the original installed Applications
controller.

Import runIatiOperatorReceiving from the adjacent operator.mjs:

    await runIatiOperatorReceiving({
      directory, outputDirectory, sourceRoot, runtimeDirectory, operationId,
      actor: { id, label },
      expected: {
        portfolioId, revision, definitionSha256, counts, financialGroups,
        comparison: { id, beforeRevision, afterRevision, pairs }
      },
      pythonExecutable, chromiumExecutable, playwrightModule
    });

browser.mjs is the complete browser stage. requirements.json records the direct
source, runtime and retained-output contract.

## One actual installation and one native owner

runtimeDirectory is required. It must be a **real READY installation** produced
by the original distribution builder, source selection, runtime preparation,
installation and inspection. The selected profile is
{native:false,features:[],operator:true}, with zero npm dependencies. The receiver
uses the original inspectMerchantRuntime, verifies its source/profile/lock
binding, then checks all 33 critical installed source files against sourceRoot.

Do not synthesize installation descriptors, package locks, profile identifiers
or source manifests. The original installed-source stage owns preparation and
returns the actual installation directory and complete installed source root.

The receiver imports the original RuntimeWorkspace model and server from that
installation. Its complete package must include dynamic Applications providers,
managed command workers and original public UI assets. The 33 critical files are
an additional selection check, not a substitute for the complete package
manifest.

The same installation includes the IATI contribution and dataset-iati command,
all IATI Python/server/client/public files, the original XML parser/workspace and
native bridge, original Dataset engine, and these existing MCP components:

- MerchantSourceWorkspaces and its source-workspace tool catalog;
- the original retained-file reader and metadata contract;
- the original authenticated mcp-paid-agent/http-tools transport and failure contract;
- the existing merchant-fleet-gateway/state-lease.

No general merchant payment server, SDK signer, wallet, facilitator, or payer is
started. The parent remains the sole native scheduler owner. The original
Applications controller creates its normal managed workers inside that admitted
workflow; include those processes in the whole-operation resource declaration.

## Inputs

| Input | Exact meaning |
| --- | --- |
| directory | Absolute real private directory of the closed, core-created IATI workspace. |
| outputDirectory | One new or retained private receiving directory beside the source workspace. |
| sourceRoot | Complete selected repository source matching the actual READY installation. The installed stage may supply its verified source root here. |
| runtimeDirectory | Actual original READY installation containing IATI and the complete Applications controller. |
| operationId | Stable identifier for this receiving. Repeat it with the same output directory. |
| actor | Actual operator ID and display label. The label becomes the named reviewer; the full identity remains in the receiving selection. |
| expected | Actual portfolio/revision/definition/count/group results from the preceding core stage. |
| pythonExecutable | Absolute existing Python 3.11+ executable selected for the native operator. |
| chromiumExecutable | Absolute existing Chromium or headless-shell executable. No browser download occurs. |
| playwrightModule | Absolute module entry returned by the existing environment's require.resolve('playwright'). |

expected.comparison is optional. Pass the core's complete comparison ID and
before/after revisions, including explicit publisher pairs when used. The UI
repeats that exact comparison. If omitted, the receiver compares the core
revision with its single review-only revision.

Financial values remain strings. The complete group objects retain reporting
organisation, hierarchy, currency, financial type, value date and original
budget period/status. The callback compares full native objects without Number
arithmetic.

The receive result deliberately keeps original portfolio history separate from
receivingBuilds. The latter describes the actual local engine and SQLite index
identities. The receiver verifies stable portfolio/row identity without requiring
independently created SQLite bytes to equal the source index.

## Complete procedure

1. Under the original state lease, retain the source marker/inode, named actor,
   expected portfolio, callback/browser bodies, critical source hashes, runtime
   installation/profile/lock/source manifest and actual interpreter paths.

2. Create the original RuntimeWorkspace inside the private receiving output.
   Its authenticated HTTP API attaches the READY runtime, reviews and saves an
   IATI Application, completes the original managed adoption, reviews a start
   and starts the native command. Wait for its original observer to verify the
   live /api/launch identity before accepting Open.

3. Open the real Applications UI and follow its verified Open link. Read the
   selected portfolio and save one named review-only revision. Retain the exact
   browser request before permitting its POST. Replay that request through the
   original client, reopen the browser, and verify the same review and complete
   prior history.

4. Query an actual native edition through the browser, IATI client and MCP.
   Compare exact returned row strings and original page envelopes. Repeat the
   saved portfolio comparison, open original native changes and download the
   full native report and portfolio archives.

5. Inspect all six IATI views at 1360×940 and 390×844. Compare visible financial
   table cells with the full report, including reporting organisation and
   hierarchy. Page-width overflow, required-asset failures and script errors
   prevent completion. Browser images remain private receiving scratch for the
   operator's own visual inspection.

6. Use the existing authenticated single-response MCP transport and original
   source-workspace adapter. Retain full report and portfolio exports through
   its native exporter. Download one actual portfolio range, sync its saved
   bytes, release the reader and close that MCP instance. Open a new original
   descriptor and resume the same retained export SHA at the committed byte
   offset. Verify the complete returned file against native byte count and hash.

7. Close the source browser/client and use Applications Stop. Only after the
   original model closes, reopen the source serially through the real CLI:
   read the report, replay its exact named-review request, and export the
   portfolio twice to one destination. The original atomic exporter must retain
   the same full file and return reused:true on that repeated destination.

8. Initialize exactly one detached recipient with the original CLI. Save and
   start its second actual Application. Receive the full retained packet through
   the original client, then import that same retained source export through MCP.
   Verify all history, stable portfolio identity, native rows and separate local
   receiving build identities.

9. Repeat receiving in the recipient UI and inspect its original report/history.
   Stop that Application, repeat the packet through the CLI, and start the same
   saved Application again. Verify the reopened portfolio at both viewports.
   Both actual Applications finally Stop before result.json is sealed.

Independent ZIP container bytes can differ because the original nested native
dataset packet retains its export-time metadata. Every returned archive is
hashed in full and received through its own native manifest. Only the
same-output retry is required to retain the identical container bytes; the
original exporter performs the complete replay check.

## Results and original custody

The returned result.json has state COMPLETE and retains actual runtime identity,
named operator, source and received portfolio revisions, exact final groups,
source and receiving native counts, separate rebuilt index identities, original
Applications IDs/releases/run outcomes, whole-file hashes and browser views.

Additional originals remain beside it:

- selection.json and progress.json;
- review-request.json, retained before the first browser save;
- downloads/mcp-portfolio.zip and downloads/mcp-report.zip;
- downloads/client-report.zip and downloads/cli-portfolio.zip;
- separately named full browser downloads;
- every CLI request, attempt, original stdout JSON, stderr and result;
- the complete original RuntimeWorkspace, Applications reviews, managed
  releases, command requests, output and Stop records;
- the single received-workspace;
- private desktop/mobile images under views/.

completed-workflow.json is the unsealed completed work. result.json is published
only after original clients, MCP reads, browser contexts, Applications and HTTP
servers finish cleanup. Failure and cleanup receipts remain retained if that
final step cannot finish.

Connection files and managed worker output may contain private loopback
capabilities. Keep those originals private. Product report/portfolio archives
contain their declared source/report members, not host connection tokens or
browser images.

## Retrying the same operation

Repeat the same callable, output directory, actor and source selection. Before
borrowing another workspace, it reconciles its own prior Applications through
their original Stop. Original save requests and actual managed records remain
intact. A receiving continuation uses a new retained start for the same saved
Application only after its preceding start has ended.

A completed source-browser stage is reused after checking the retained
portfolio and full downloads. Partial native downloads continue at their
committed byte offset and must verify the original final hash. All receiving
metadata is published from complete fsynced private temporaries under the held
lease, so an interrupted metadata write cannot select a partial JSON document.

Measure the actual source and packet sizes when declaring disk growth. Include
one complete managed source release, one received native workspace, selected
whole ZIPs, original command records and browser scratch. The original
Applications controller, one IATI Python/native Node operator and browser
execute sequentially. Do not add another scheduler request, payer, parallel
workspace copy, or reduced existing resource declaration.

This procedure fetches no new publisher fixture and installs no Node, Python,
Playwright, Chromium, npm dependency or SDK. Use the existing equipped runtime
and the original installed-source stage inside the parent's one admitted job.
