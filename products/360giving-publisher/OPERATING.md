# Operate and receive the complete 360Giving publisher

This guide takes the original publisher product from a committed source selection
to an installed saved workspace, agent operation, complete customer files and
independent receiving. The source-owned selection is `publisher-360giving`.
Its original application kind is `publisher-360giving`; its contribution is
`ndjson-360giving` and its merchant provider is `publisher-360giving`.

Use the original retained operation directory when continuing work. The selected
source commit, package, runtime, publisher identity, named decisions and customer
exports are recorded by their existing owners.

## 1. Build the selected source

Use a repository containing the complete selected source commit. The maintained
builder reads the original recipe and complete contributions, includes their
component and support files, resolves original module imports and writes the
package and source manifest.

```sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/source/repository.git \
  --ref FULL_SOURCE_COMMIT \
  --selection publisher-360giving \
  --out /absolute/publisher-release \
  --offline
```

The result identifies the actual archive path, complete SHA-256, original source
commit, selected recipe, file inventory and package sizes. Keep those returned
values with the original release. The source selection is part of the package
version and the distribution input records.

Continue a partial or completed build with its existing output:

```sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/source/repository.git \
  --out /absolute/publisher-release --resume
```

The saved source commit and selection govern that continuation. A following
source version uses a new build output. The original builder preserves the
previous release and reuses a completed matching package.

The product recipe selects the complete `ndjson-360giving` and
`merchant-provider-tools` contributions. It retains all original publisher
examples, official schemas and attribution; the complete Python/native support
files; original Applications assets and operator host; both typed clients;
merchant setup/runtime/catalog; and all receiving programs. Static imports and
explicit dynamic support paths remain part of the maintained builder.

## 2. Prepare the runtime and Python

Use the original runtime installer with the returned archive and SHA-256:

```sh
node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs prepare \
  --dir /absolute/publisher-runtime \
  --archive /absolute/publisher-release/ORIGINAL_ARCHIVE.tgz \
  --sha256 ORIGINAL_ARCHIVE_SHA256 \
  --feature mcp --operator

node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs install \
  --dir /absolute/publisher-runtime

node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs inspect \
  --dir /absolute/publisher-runtime --load --source
```

The retained profile selects the MCP feature and existing operator host. The
MCP dependency comes from the maintained distribution declaration. Installation
records the resolved lock, checks the package source and verifies READY state.
Use the original installer's offline or existing-dependency adoption options
when that complete dependency tree is already available.

Python is selected separately by the publisher. Use Python 3.11 or newer with
the requirements shipped in the installed
`sf30-seller-sdk/ndjson/360giving/requirements.txt`:
`jsonschema>=4.23,<5` and `referencing>=0.35,<1`.
Retain the actual environment that contains these dependencies. Applications
records its executable, interpreter identity and the original schema module
with the publisher's source binding.

The native dataset uses the installed Node executable. On the operator host,
use the original Linux/flock environment supported by Applications. The shared
runtime guide gives the supported Node version and host preparation:
[RUNTIME_INSTALL.md](../../stellar/scf-starforge-20261009/distribution/RUNTIME_INSTALL.md).

The installed package's source is under
`/absolute/publisher-runtime/package/source/`. Run its original distribution
CLI directly when the package executable has not been added to the shell path:

```sh
node /absolute/publisher-runtime/package/source/stellar/scf-starforge-20261009/distribution/cli.mjs \
  registrations --source ndjson-360giving
```

The examples below use `starforge` for that same installed CLI. Its help lists
the selected product's commands and their original modules.

## 3. Select or initialize the publisher

Keep the customer publisher directory outside the installed source. To initialize
a new private workspace:

```sh
starforge dataset-360giving-workspace \
  --python /absolute/publisher-python/bin/python \
  --workspace /absolute/private/publisher init
```

An existing publisher can be selected directly. In the original Runtime
workspace, attach the READY runtime. In **Applications**, choose **360Giving
publisher workspace**, enter the private publisher directory and existing
Python executable, review and save the application, connect its runtime release,
then review Start and start it.

The private console opens the saved publisher. Applications writes
`applications/APP_ID/360giving-connection.json` inside that manager.
Retain this connection-file path for clients; the saved application replaces
its port and bearer fragment on a later start while preserving the selected
publisher identity.

Use the connected command for an open application:

```sh
starforge dataset-360giving-workspace \
  --python /absolute/publisher-python/bin/python \
  --connection /absolute/manager/applications/APP_ID/360giving-connection.json \
  state
```

The direct Node SDK also takes this connection file and an optional expected
publisher UUID. It authenticates the current native launch before operations
and pins the original workspace. Applications continues to own the publisher
process and its accepted work when a client closes.

## 4. Intake, review and build original sources

For each fund, retain its complete original package, matching registry record,
source URL and acquisition record. When the HTTP response has an encoded
transport representation, retain that original transport as well.

The connected CLI uploads these exact files and saves one original intake:

```sh
starforge dataset-360giving-workspace \
  --python /absolute/publisher-python/bin/python \
  --connection /absolute/manager/applications/APP_ID/360giving-connection.json \
  intake --dataset fund-key --label "Publisher fund" \
  --source-url https://publisher.example/grants.json \
  --source /absolute/intake/original-grants.json \
  --registry /absolute/intake/registry.json \
  --capture /absolute/intake/capture.json \
  --request fund-original-intake
```

Replace the example source URL and paths with the actual original publisher
files. Add `--transport /absolute/intake/original-response.bin` when that source
has a retained transport file.

Use the returned edition ID in the browser or connected `review --edition ID`.
The source editor displays official schema findings, the complete original
grant records and the proposed registry metadata selections. Save a named
review document with the actual reviewer and explicit choices. Keep original
financial values unless the named reviewer explicitly changes them.

```sh
starforge dataset-360giving-workspace \
  --python /absolute/publisher-python/bin/python \
  --connection /absolute/manager/applications/APP_ID/360giving-connection.json \
  decisions --edition EDITION_SHA256 \
  --file /absolute/reviews/fund-decisions.json --request fund-reviewed-decisions

starforge dataset-360giving-workspace \
  --python /absolute/publisher-python/bin/python \
  --connection /absolute/manager/applications/APP_ID/360giving-connection.json \
  candidate --edition EDITION_SHA256 --decision DECISION_SHA256 \
  --request fund-reviewed-candidate

starforge dataset-360giving-workspace \
  --python /absolute/publisher-python/bin/python \
  --connection /absolute/manager/applications/APP_ID/360giving-connection.json \
  build --edition EDITION_SHA256 --candidate CANDIDATE_SHA256 \
  --request fund-reviewed-build
```

A build without `--candidate` selects the original edition. Original and
candidate builds remain separate immutable selections. Use the exact returned
IDs in every later query, comparison and export.

The Node SDK and merchant tools carry native JSON numbers as their original
strings. This includes financial decimals, large integers and exponent spelling,
as well as protocol counters. Convert only a known counter after validating
its range. The source and named review preserve the complete original values.

## 5. Query and compare complete editions

Use `native-state --dataset fund-key` to inspect the original builds and
comparisons. Query one selected build:

```sh
starforge dataset-360giving-workspace \
  --python /absolute/publisher-python/bin/python \
  --connection /absolute/manager/applications/APP_ID/360giving-connection.json \
  query --dataset fund-key --build BUILD_SHA256 --params '{"limit":"250"}'
```

Read the native response status before consuming rows. Follow
`response.body.page.nextCursor` with the same dataset, build, filters and page
limit until it is null. The original complete row count belongs to the selected
build. A filtered query retains its own returned total.

A comparison selects two native build IDs:

```sh
starforge dataset-360giving-workspace \
  --python /absolute/publisher-python/bin/python \
  --connection /absolute/manager/applications/APP_ID/360giving-connection.json \
  compare --dataset fund-key --before ORIGINAL_BUILD_SHA256 \
  --after FOLLOWING_BUILD_SHA256 --request fund-edition-comparison
```

Use `changes` with the returned comparison ID and follow every `nextOffset`.
For complete delivery use `changes-file`:

```sh
starforge dataset-360giving-workspace \
  --python /absolute/publisher-python/bin/python \
  --connection /absolute/manager/applications/APP_ID/360giving-connection.json \
  changes-file --dataset fund-key --comparison COMPARISON_SHA256 \
  --out /absolute/customer/complete-changes.jsonl
```

The command verifies the complete original comparison SHA-256. The merchant
also retains this complete file for resumed customer download.

## 6. Connect the merchant and agents

Declare a private host configuration with stable publisher aliases, saved
Applications connection files and complete source/handoff file handles. The
configuration schema is
`stellar-forge.360giving-merchant-connection.v1`.

Each workspace declaration selects its original `connectionFile`, optional
`expectedWorkspaceId`, label and file handles. A file handle has an original
host `path`, one kind (`source`, `registry`, `capture`, `transport`,
`decisions` or `handoff`) and an optional complete SHA-256. Remote calls use
the alias and handle. The full configuration example and typed calls are in
[360GIVING.md](../../stellar-forge/mcp-merchant-operator/360GIVING.md).

Save a private setup JSON with `directory`, `connection` and optional `name`
and original `releaseStore`, then initialize:

```sh
starforge merchant-providers init publisher-360giving \
  --options /absolute/private/publisher-setup.json
```

The setup creates the original merchant configuration and export storage.
Repeating the same setup reopens it. Start the existing merchant server with
that configuration and its selected bearer-token environment. The guide shows
the exact `startMerchantMcp` invocation and orderly `close` ownership.

The complete tool families cover workspace inventory, review and upload;
intake, decisions, candidate and build; query, compare and changes; original
request/resume; complete export and changes export; retained manifest/file
delivery; and receiving into another configured publisher.

A paged inventory returns a snapshot. Repeat it as `expectedSnapshot` on
following pages. The typed client scopes its calls and file checkpoints to one
workspace alias. The direct SDK and merchant reach the same saved native request.

Choose an original request ID before each mutation. On a lost response, read
that ID. If it is complete, use its retained result. If interrupted, explicitly
resume it. Repeating an unchanged selection preserves its original admission;
changed selections remain native conflicts. Merchant replay preserves the exact
saved SDK input when the only differences are documented optional defaults.

## 7. Export, receive and continue customer work

Select an original edition and, for reviewed work, the exact decision and
candidate:

```sh
starforge dataset-360giving-workspace \
  --python /absolute/publisher-python/bin/python \
  --connection /absolute/manager/applications/APP_ID/360giving-connection.json \
  export --edition EDITION_SHA256 --decision DECISION_SHA256 \
  --candidate CANDIDATE_SHA256 --request fund-complete-handoff \
  --out /absolute/customer/fund-complete-handoff.zip
```

The complete ZIP contains the selected publisher edition, original source and
registry/capture, named review and candidate, available original/candidate native
build packets, complete comparison files and portable publisher source. Retain
the archive together with its returned whole-file byte count and SHA-256.

The receiving publisher uses the same connected command with
`receive --file /absolute/customer/fund-complete-handoff.zip --request fund-receive`.
Initialize that independent private publisher first, then open it through its
own saved Application. Reuse the receiving ID on continuation. The receiver can
review the original source and named decisions, reopen native builds and create
following work.

For an agent delivery, call merchant export with the original native export ID.
When it is complete, repeat that same export selection to retain its file
delivery. `download360GivingExport` reads the original canonical manifest,
streams the complete ZIP, saves durable verified prefixes and publishes the
complete file. Continue with the same directory, alias, endpoint and export ID
after interruption.

A receiver can select either the retained export from another configured alias
or a declared complete handoff file. Both use the native receiver with the same
original archive bytes. Retained exports remain readable while the source
publisher is stopped.

## 8. Run complete installed receiving

Use an existing complete publisher workspace and a new private receiving
directory. Its parent must exist. Save a private input JSON:

```json
{
  "schema": "stellar-forge.360giving-agent-receiving-input.v1",
  "runtimeDirectory": "/absolute/publisher-runtime",
  "sourceWorkspace": "/absolute/private/publisher",
  "pythonExecutable": "/absolute/publisher-python/bin/python",
  "directory": "/absolute/private/complete-agent-receiving",
  "label": "360Giving complete publisher receiving",
  "timeoutMs": 240000,
  "pollMs": 500,
  "queryPageSize": 250
}
```

```sh
chmod 600 /absolute/private/agent-receiving-input.json
starforge dataset-360giving-agent-receiving \
  --input /absolute/private/agent-receiving-input.json
```

The command opens the original manager for this receiving operation, attaches
the READY runtime and saves source/receiver applications. It exports every
saved edition and each review/candidate selection, reads every native query
cursor and comparison page, and retains complete content observations.

Both clients reach the original saved requests. Every handoff and comparison
file is retained through the merchant. One complete handoff download resumes
its durable prefix after the actual merchant listener closes and reopens at the
same endpoint. With the source stopped, the receiver consumes the same handoffs
through both declared-file and retained-export paths.

Source and receiver each cold-reopen through their original Applications.
The driver compares complete publisher metadata, all native builds and ordered
rows, original comparisons and complete changes files. It writes the final
result after closing the recorded publisher runs and original manager.

| Retained output | Use |
| --- | --- |
| `receiving-journal.json` | Original receiving input, stage state, application/save/run IDs and source export selections |
| `applications/` | The original manager and both saved publishers |
| `exports/` | Every complete managed handoff ZIP |
| `observations/` | All source/receiver metadata, full native row files and changes before/after cold reopening |
| `publisher-received/` | Independently usable received publisher |
| `agent/agent-journal.json` | Original merchant endpoint, declared handles, retained deliveries and interrupted download state |
| `agent/` | Complete typed-client/merchant observations and customer download files |
| `managed-publisher-result.json` | Original managed receiving result |
| `agent-publisher-result.json` | Joined client, merchant, full-file and independent receiving result |

Continue with the same input and directory. The original journal binds the
selected runtime, source workspace, Python, label, page size and connected
workflow. Wait/poll settings can be adjusted during continuation. Applications
reconciles interrupted runs; the publisher retains accepted request inputs;
complete matching files are verified and reused.

For the included historical SCVO examples, the original saved-workspace command
runs both entire retained funds:

```sh
starforge dataset-360giving-workspace \
  --python /absolute/publisher-python/bin/python \
  example --out /absolute/private/scvo-complete \
  --reviewer "Actual reviewing operator"
```

It uses the original five- and seven-grant source packages and their matching
registry/capture records. Its result identifies
`/absolute/private/scvo-complete/publisher-workspace`, which can then be used
as the source for the installed agent receiving input. Set `queryPageSize: 2`
for that small original dataset to exercise all cursor pages. An already
completed example retains its original directory, reviewer and request IDs.

## 9. Reopen and adopt following source

Stop publishers through their saved Applications before changing the selected
runtime or publisher directory. Keep the publisher and customer files outside
the installation. A new source edition is built and installed as its own
original release; Applications reviews that release with the existing saved
workspace before starting it.

The launch binding records the original publisher UUID, private workspace
marker, Python/Node executable identities, schema dependency and complete
selected source hashes. It accepts the exact shared JSON parser carried by the
typed SDK while retaining compatibility with the earlier publisher source's
original required files. A client already using one publisher keeps that
workspace guard across its own operation.

The full operational details remain in the original
[Applications guide](../../stellar/scf-starforge-20261009/distribution/runtime-workspace/360GIVING_APPLICATIONS.md)
and [typed agent guide](../../stellar-forge/mcp-merchant-operator/360GIVING.md).
