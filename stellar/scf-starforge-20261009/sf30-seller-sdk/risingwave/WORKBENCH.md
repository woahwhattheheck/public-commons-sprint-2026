# RisingWave workbench interfaces

The workbench is one private operating workspace shared by its original
browser, CLI and MCP clients. Use the complete
[product operating guide](../../../../products/risingwave/OPERATING.md)
for installation, source setup, report authoring, publication and receiving.
The [native source guide](README.md) describes the actual subscription protocol
and the full native receiving operator.

## Start and reconnect

~~~sh
node workspace/server.mjs \
  --state /absolute/private/risingwave-workbench \
  --source /absolute/private/source.json
~~~

The foreground process prints a private JSON launch record containing
risingwaveWorkspace. It binds a random loopback port and a bearer fragment.
Use its complete URL in a browser on that host. Reopen with the same state
directory and omit the import flags. Save source and merchant changes through
the existing revision controls.

CLI and MCP attach to that running owner:

~~~sh
node workspace/cli.mjs status --connection /absolute/private/launch.json
node workspace/mcp.mjs --connection /absolute/private/launch.json
~~~

RISINGWAVE_WORKSPACE_URL is the equivalent environment reference for the full
private URL. Keep one foreground workbench owner; its kernel lock protects the
saved operating state. The dedicated MCP client can close independently.

## Client operations

Import createRisingWaveWorkbenchClient from workspace/client.mjs. The client
uses the original private server API and returns its original records.

| Work | Client methods |
| --- | --- |
| Source revisions | state, revision, save |
| Native authoring | discover, compileReport, preview |
| Subscription operation | subscriptionInspect, subscriptionPrepare, subscriptionCreate, subscriptions, subscriptionRecord |
| Complete editions | capture, captures, captureRecord, cancelCapture, resumeCapture, recoverCapture |
| Source receiving | captureChunk, receiveCapture |
| Complete differences | compareCaptures, comparisons, comparisonRecord, comparisonChunk, receiveComparison |
| Original publisher | createPublication, publication, publicationCommand, run |
| Seller and customer | seller, buyerOffer, prepareBuyer |

~~~js
import { createRisingWaveWorkbenchClient } from './workspace/client.mjs';

const client = await createRisingWaveWorkbenchClient({
  connectionFile: '/absolute/private/launch.json',
});

const state = await client.state();
const capture = await client.capture({
  expectedRevision: state.revision,
  query: 'projects_report',
  input: { minimum: 0 },
  captureId: 'capture-projects-first-edition',
  mode: 'auto',
  onGap: 'error',
  extraction: {
    maxRows: 1000000,
    maxBytes: 268435456,
    maxRowBytes: 1048576,
    batchSize: 1000,
    timeoutSeconds: 1,
    maxDurationMs: 300000,
  },
});

const original = await client.captureRecord(capture.id);
~~~

The example selects an already saved report. A capture request returns its
original ID and current state; read captureRecord to follow completion.
COMPLETE includes its native manifest and every file identity. cancelCapture
awaits termination of the named local task. resumeCapture continues the same
retained native request. recoverCapture adopts an already complete native file
set after a lost final response.

## Original capture identity

A retained workbench capture records:

- Capture ID, source revision and exact saved source SHA-256.
- Report name and normalized typed input.
- Requested mode, retention-gap choice and full extraction budgets.
- The resolved prior complete capture and its manifest SHA-256.
- Native progress, resumed attempts, terminal state and all complete files.

The supplied captureId must start with capture- and obey the item identifier
grammar. Reuse it only for the same original selection. The source engine
retains its own request and checkpoint inside that capture directory. Workbench
resume does not rewrite that native request.

Initial snapshot recovery retains the earlier interrupted FULL attempt.
Incremental recovery uses the last complete durable epoch, the exact original
source identity and inclusive replay bookkeeping. Source scalar conversion
occurs after native text reception, preserving exact large identifiers and
temporal values.

## Full comparison identity

~~~js
const difference = await client.compareCaptures({
  comparisonId: 'comparison-projects-first-second',
  before: 'capture-projects-first-edition',
  after: 'capture-projects-second-edition',
  keys: ['id'],
  sampleLimit: 100,
});

await client.receiveComparison({
  comparisonId: difference.id,
  directory: '/absolute/private/received-differences',
});
~~~

Both inputs must be complete editions. Omitted keys select the original
before report's declared key. The comparator rejects missing, NULL or duplicate
key values. It uses SQLite to index every original row and writes every added,
removed and changed record into separate NDJSON streams.

The manifest contains the before/after source and file identities, keyed
selection, full row counts, request hash, file descriptors and limited display
examples. A sample count applies to examples only; aggregate sample bytes are
limited to 1 MiB. Full files remain available even when no large example fits
inside that display budget.

A repeated comparisonId with the same original request reopens the complete
comparison. A different request under that ID is rejected. The private
comparison directory retains its request and processing state; an interrupted
uncompleted comparison can be recalculated under the same selection. Saved
complete comparisons are listed independently of the current capture page.

## Complete file receiving

A capture exposes json, ndjson, csv, events, checkpoint, state and manifest.
A comparison exposes added, removed, changed and manifest. The server maps
these fixed keys to original retained filenames and verifies their full hashes.

captureChunk and comparisonChunk take an optional offset and limit. Each
range returns original file identity, full byte length and SHA-256, actual byte
count, base64 content and nextOffset. Continue until nextOffset is null. The
maximum range is 196,608 bytes.

receiveCapture and receiveComparison apply those ranges to a private receiving
directory. They retain the exact original selection, continue existing partial
files, verify complete hashes, atomically retain the completed files, and
reopen the capture or comparison. A completed receiving result keeps the
original counts and source identity.

## Original publisher and scheduler

createPublication binds a saved report, exact merchant choices and resource
path. An optional stable publicationId retains the original product operation.
The original publisher console URL and retained status are returned through
publication.

publicationCommand forwards the selected product to its existing publisher
or scheduler. It retains their native run, review, plan, policy and target
identities:

| Action | Principal input |
| --- | --- |
| source | Empty object |
| plan | plan |
| plan/save | The complete reviewed native source/dataset/extraction plan |
| extract / extract/start | plan |
| cancel / recover | id |
| review | Original candidate id, reviewer, note and target review fields |
| publish | id, reviewId |
| schedule/status | Original scheduler page options |
| schedule/save | Reference run, plan digest, reviewed target, policy and scheduler revision |
| schedule/enable | Scheduler revision, expectedSnapshot, expectedRevision |
| schedule/pause | Scheduler revision |
| schedule/run | Scheduler revision and original requestId |
| schedule/continue | Scheduler revision |

extract and schedule/run wait for their original completion. extract/start
returns the original publisher run ID for progress inspection. The shared
publisher browser contains the exact current review and scheduler forms; it
is the same engine used by these actions.

The source inspector exposes extraction.defaults, supported modes and
onGap choices. Source-query maxRows/maxBytes remain preview limits. The
publisher's complete extraction uses its separately saved source-wide budgets.
timeoutMs is accepted as the original publisher alias for maxDurationMs;
explicit values for both must agree.

Dataset plans retain nullEncoding:unquoted-empty. The canonical encoder emits
NULL as unquoted empty and actual empty text as quoted empty. The original
dataset loader preserves that distinction. Native exact text types default to
dataset string; requested numeric conversion must remain exact.

## MCP

workspace/tools.mjs declares the 32 tools and their complete input schemas.
workspace/mcp.mjs runs the original maintained stdio transport over the same
workbench client. Saved source and merchant revisions, subscriptions, captures,
comparisons and publisher records remain owned by the workbench.

Use source/file tools for complete original data. Inline display samples and
page limits are navigation controls. Receiving tools write the entire selected
capture or comparison, including every complete file.

## Applications

application-provider.mjs registers RisingWave source and dataset publishers
with the original Runtime Workspace. managed-application.mjs binds the READY
native installation and its source files to the exact initialized workbench.

The saved application retains workspace creation identity, revisions, source
hashes, merchant terms, publication paths, runtime requirements and environment
reference names. Its original review/save/connect/start/open/stop/reopen
sequence controls ownership. The source binding includes native capture,
event-log recovery, comparison and browser modules.

Use the existing runtime environment editor for database values and private CA
paths. A separately launched workbench must close before Applications acquires
that same directory.

## Operating state

The private root retains workspace.json plus revisions, subscriptions, samples,
captures, comparisons and publications. Each product keeps its original
publisher, version store, scheduler and customer files. Follow those original
records after an interrupted process or response.

Stop the owner before backing up the full private workspace. Keep the complete
source release and installed runtime used by that workspace with its backup.
The selected distribution and operating guide preserve the original source and
package identities for installation, receiving and later upgrades.

## Continue the complete native case through Applications

Use [MANAGED_WORKBENCH.md](MANAGED_WORKBENCH.md) and its complete installed operator
to adopt the original finished native workbench, receive both complete captures and
all differences through MCP, inspect both published editions and original buyer,
stop, and reopen the same saved application in a second managed process.
