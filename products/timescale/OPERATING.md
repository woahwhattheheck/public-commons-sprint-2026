# Operate and receive a Timescale data product

Use this workflow to bring an existing TimescaleDB source through native
operations, complete source commissioning, reviewed dataset publication,
assigned follow-up work and complete customer handover. The browser, command line and merchant agent share the saved
project and its PostgreSQL publisher.

The complete operating path is available in this standalone product. Its source
is the maintained Timescale implementation, including the original native
demonstration, merchant/browser receiving and assigned-work continuation.

## 1. Select the installation and original source

Use Linux, Node.js 22.16 or newer, Git and util-linux `flock` for the installed
merchant product. The pinned Ubuntu native receiving command in section 7
requires Node.js 24 and Python 3.11 or newer. Keep the project, database
configuration, merchant directory and received customer files outside the Git
checkout. They must be on a local filesystem supporting locks, atomic rename
and fsync.

For an installed archive, use the original [runtime installer](../../stellar/scf-starforge-20261009/distribution/RUNTIME_INSTALL.md).
The Timescale contribution declares the PostgreSQL driver through its original
package manifest; the complete merchant also uses the original native Stellar,
MCP, GraphQL, schema and OpenAPI dependencies. Select the complete feature set
for this operating path when preparing the runtime:

~~~sh
starforge runtime-install prepare \
  --dir /srv/starforge/runtimes/timescale \
  --archive /srv/starforge/downloads/merchant.tgz \
  --sha256 ORIGINAL_ARCHIVE_SHA256 \
  --native --feature timescale --feature mcp \
  --feature graphql --feature schema --feature openapi --operator

starforge runtime-install install --dir /srv/starforge/runtimes/timescale
~~~

Use the archive and hash returned by the maintained builder. A fresh source
checkout can use the same original distribution CLI before installation:

~~~sh
node stellar/scf-starforge-20261009/distribution/cli.mjs registrations --source timescale
~~~

Replace `starforge` below with that absolute CLI path when working from source.
The registration includes the native, client and receiving commands, public
SDK exports, Timescale browser assets, merchant provider and Applications provider.

The selected native database must have TimescaleDB 2.30.2 on PostgreSQL 16, 17 or
18. A read declaration identifies the actual database and selected read role;
an optional maintenance declaration identifies the role used for reviewed
refresh and job changes. Both must resolve to that same database. Configure
TLS and credential environment references through the original
[PostgreSQL source declaration](../../stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/timescale/README.md).
Keep actual credentials in the host environment.

Prepare a private operating directory and initialize its project once:

~~~sh
umask 077
TIMESCALE_HOME="$HOME/timescale-operations"
mkdir -p "$TIMESCALE_HOME"

starforge dataset-timescale init \
  --directory "$TIMESCALE_HOME/project" \
  --source "$TIMESCALE_HOME/read-source.json" \
  --maintenance-source "$TIMESCALE_HOME/maintenance-source.json" \
  --target "$TIMESCALE_HOME/dataset" \
  --title "Usage operations"
~~~

Create the two source declarations before this command. For an existing saved
project, use its current directory and retained declarations directly.

## 2. Open the same project in Applications and the merchant agent

The [merchant setup guide](../../stellar-forge/mcp-merchant-operator/TIMESCALE_WORKSPACE.md)
contains the complete three-file configuration. Its publisher connection binds
the existing project as kind `timescale`; the Timescale connection points its
workspace alias to that publisher alias. The merchant configuration retains
both file references and the original release store.

After writing that guide's private `merchant-setup.json` with actual absolute
paths, initialize its original provider:

~~~sh
starforge merchant-providers init timescale-workspaces \
  --options "$TIMESCALE_HOME/merchant-setup.json"

starforge timescale-agent inspect \
  --config "$TIMESCALE_HOME/merchant/merchant-mcp.json" --workspace usage
~~~

Inspection returns the saved project identity and configuration binding.
Choose **Timescale merchant workspace** in installed Applications and select
that merchant configuration and alias. Save the reviewed input selection, then
use its existing Start, Open, Stop and reopen controls. The browser opens the
native operations above the original dataset publisher, including the commissioning and assigned-work desks.

The equivalent direct launch is:

~~~sh
starforge timescale-agent serve \
  --config "$TIMESCALE_HOME/merchant/merchant-mcp.json" \
  --workspace usage --port 0 --mcp-port 0 --token-env MCP_ACCESS_TOKEN
~~~

Supply the private token through the host environment before launch. The
startup record gives the actual browser and MCP URLs, persistent project UUID,
configuration binding and current process identities. Leave that host running
while using the browser or a client from another terminal. Reuse its one
publisher and scheduler; stop a separately opened project CLI before making the
merchant its owner.

## 3. Capture, operate and publish the selected aggregate

Start with a complete native source edition. The saved edition includes the
actual extension/server identity, hypertables, dimensions, continuous aggregate
definitions and columns, chunks, policies, job settings and available job
outcomes. Its table viewer supports search and complete paging; the original
JSON is downloadable.

Select an aggregate from that edition. Choose its actual time column and type,
explicit start and exclusive end, timezone and ordered publication columns.
These selections determine both the maintenance plan and the resulting
customer data.

1. Prepare the refresh with its source edition, definition and window. Inspect
   the complete saved plan before running it. The actual Timescale procedure
   determines which batching options are supported.
2. Run the saved plan with its original request UUID. Read that operation's
   result before continuing. Native batched refreshes preserve Timescale's own
   transaction semantics; a single atomic window uses the supported
   `bucketsPerBatch: 0` selection.
3. Compare the complete aggregate under the original saved plan. The read-only
   comparison preserves duplicate rows and exact native text and evaluates the
   complete selected result. A job timestamp alone does not establish coverage.
4. Prepare any job change against the actual retained job and database. Supply
   only intended changes, review its plan, then inspect the returned native
   operation.
5. Capture the after edition and compare it with the before edition. Review all
   changed fields and give each one an Accept, Remediate or Defer decision,
   responsible owner and reason.
6. Save the agreed aggregate projection and extract it through the original
   PostgreSQL publisher. Review the actual candidate and publish it using the
   original publisher review and version store.
7. Open the original buyer handoff and read the published snapshot. Preserve its
   exact row values, source run and publication identity with the handover.

The browser and Timescale MCP tools expose this same workflow, together with
assigned work, complete commissioning and retained reports. Merchant publisher
tools continue the extraction review, publication, buyer handoff and enabled
publication schedules.

For command and JSON input details, use the
[native operator guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/timescale/README.md)
and the [complete typed client](../../stellar-forge/mcp-merchant-operator/TIMESCALE_CLIENT.md).
Native decimals, counters and timestamps remain their original strings.

## 4. Carry the reviewed changes through assigned work

Open **Assigned work** and select an actual Remediate or Defer choice from a
saved complete comparison review. Enter the responsible operator, due date,
priority, intended work and acceptance condition. The work item retains that
review and the complete changed source.

The desk supports the entire continuing job:

| Work | Result kept with the original project |
| --- | --- |
| Assign and edit | Current owner, planned work and complete preceding revisions |
| Defer or resume | Explicit current state and the reason for the decision |
| Rebase to a later review | The same catalog item's new source selection and previous source history |
| Link a plan | The original refresh, job or publication plan and its exact digest |
| Observe an outcome | The existing native operation and its outcome at the recorded time |
| Assess a later edition | The actual later source, comparison and operator assessment |
| Resolve and reopen | The original resolution plus subsequent work history |
| Publish a report | Full JSON and printable HTML retained inside the workspace |

A linked operation is observed without reissuing its database command.
Resolution by current-state review records the operator's assessment of the
later catalog. Resolution by complete aggregate verification also requires the
matching original verification completed after that later edition, with its
actual plan and window.

The [assigned-work guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/timescale/REMEDIATION.md)
covers all seven command actions and complete source references. Agent clients
page an item's history, plans and observations using the same revision and
digest, so a revised item cannot silently produce a mixed history.

## 5. Keep the request and continue a lost response

Save each full request before dispatch. A mutation's UUID identifies the
original meaningful input and result. The current version protects a new
selection; recovering a known request retains its original UUID and input.

The installed client uses the actual MCP URL and persistent project UUID from
the host. With those values selected in the shell environment:

~~~sh
starforge timescale-client status \
  --url "$TIMESCALE_MCP_URL" --workspace usage \
  --workspace-id "$TIMESCALE_WORKSPACE_ID" --token-env MCP_ACCESS_TOKEN

starforge timescale-client remediation-command \
  --url "$TIMESCALE_MCP_URL" --workspace usage \
  --workspace-id "$TIMESCALE_WORKSPACE_ID" --token-env MCP_ACCESS_TOKEN \
  --input "$TIMESCALE_HOME/assigned-work-request.json" --wait-ms 600000
~~~

The optional wait reads the same accepted operation; it does not resubmit it.
After a lost response, inspect that operation by its original request ID. A
completed command returns its retained result even after later project work.
An unknown native dispatch remains attached to that original operation while
the operator inspects current database state and chooses the actual remaining
work.

The client provides complete typed edition, comparison, plan, job, refresh,
verification, publication, file, assigned-work and export methods. Request files
are private regular files. `--input-sha256` can also pin their complete bytes.

## 6. Receive the report and the whole customer project

Publish a report for the selected work item's actual revision and digest. The
original renderer retains `report.json`, `report.html` and their manifest under
the report request UUID. The printable report contains the source decisions,
linked plans, observed outcomes, resolution meaning and full revision metadata.

Inspect its original report manifest, then receive those completed files:

~~~sh
starforge timescale-client report-download \
  --url "$TIMESCALE_MCP_URL" --workspace usage \
  --workspace-id "$TIMESCALE_WORKSPACE_ID" --token-env MCP_ACCESS_TOKEN \
  --export "$REPORT_REQUEST_ID" \
  --expected-manifest-sha256 "$REPORT_MANIFEST_SHA256" \
  --directory "$TIMESCALE_HOME/received-report"
~~~

An interrupted transfer continues with the same command, directory and
manifest. Reopening the original host and endpoint lets the receiver continue
its retained prefix. A completed report read does not render a new report or
read the database again.

Export the complete project after its report is retained. The export includes
every original edition, plan, operation, comparison review, assigned-work
revision and report, together with the PostgreSQL publisher and referenced
dataset generations. Receive the complete file manifest through
`timescale-download receive` or `timescale-client download`.

Keep these two hashes distinct: the **download manifest** identifies the full
file transfer; the **native manifest** identifies the original portable project.
Use the native digest for `dataset-timescale inspect-package` and the original
receive request:

~~~json
{
  "requestId": "YOUR_NEW_RECEIVING_UUID",
  "packageDirectory": "/absolute/private/complete-downloaded-package",
  "expectedDigest": "ORIGINAL_NATIVE_MANIFEST_SHA256",
  "directory": "/absolute/private/received-timescale-project"
}
~~~

~~~sh
starforge dataset-timescale receive \
  --input "$TIMESCALE_HOME/receive-project.json"
~~~

Replace the illustrated values with the real retained selections. The original
receiver returns the relocated workspace and dataset target. Open that project
with the same source credential environment references. Its historical source
records keep their original paths, while the two current runtime bindings use
the received location. Open the work item, report and published buyer rows from
that received project before handing it to the customer engineer.

## 7. Operate the complete native demonstration

The demonstration uses six explicitly identified industrial usage readings in
one new private Timescale schema. It operates actual continuous aggregates,
late-arriving input, two native refreshes, full aggregate comparisons, job
scheduling, publication and complete customer receiving. The expected decimal
`9007199254740996.50` remains exact. This is the product's worked example.

With an already equipped database, run the original native driver using its
private source declaration:

~~~sh
starforge timescale-native-demo \
  --directory "$TIMESCALE_HOME/native" \
  --connection "$TIMESCALE_HOME/demo-source.json"
~~~

The actual database remains available for the following merchant/browser and
assigned-work continuations. Use their complete source commands from
[TIMESCALE_WORKSPACE.md](../../stellar-forge/mcp-merchant-operator/TIMESCALE_WORKSPACE.md)
and [TIMESCALE_CLIENT.md](../../stellar-forge/mcp-merchant-operator/TIMESCALE_CLIENT.md).
They consume that same `native-demo.json` and merchant configuration.

For an existing Ubuntu 24.04 x86_64 worker, the
[complete native setup](../../stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/timescale/UBUNTU_NATIVE.md)
runs all three programs in one PostgreSQL lifetime. It verifies the five
official PostgreSQL/Timescale archives, extracts the required fresh runtime,
reuses complete installed Node dependency roots and the existing Chromium, and
preserves a private database checkpoint. The runner validates its declared exact
Node dependencies, including Stellar SDK 16.3.1; provide the complete existing
dependency roots described in that guide. Select the exact Git commit of this
checkout and include:

~~~text
--remediation-receiver stellar-forge/mcp-merchant-operator/timescale-remediation-receiving.mjs
~~~

The complete journey retains the original before and after editions and
publication, operates assigned work against the actual changed job, captures
one later read-only edition, resolves and reopens the work, resumes the full
report across an owner restart, then receives and reopens the entire project.

Its results remain in `host.json`, `native-demo.json` and the two receiving
records. The native host checkpoint includes the database and generated
credentials and must stay in private operating custody. Source archives
contain the product code and guides. A completed native journey and a completed
checkpoint are recorded separately; use the returned original artifacts when
evaluating a run.

## 8. Commission the full source and hand it over

Open **Commissioning** on that same project to retain the complete original
intake, fill its actual source contract and acceptance criteria, and bind the
retained native edition, aggregate, time window and publication columns.
Import the complete baseline and observed JSON tables with exact native text
and null cells. Map every column or record an explicit omission reason, then
inspect every row of the full multiset comparison. Duplicate multiplicity and
large decimal values remain intact.

Record the original native operations and their actual outcomes, assess each
original criterion, and complete technical handover with either accepted
criteria or named open work. Reopen when the source or remaining work changes;
the full original revision history remains. The desk uses the existing
journal, publisher and native controls.

Publish the exact selected revision as complete JSON and printable HTML. The
JSON retains the original intake, all original source-file bodies, every
comparison and observed native outcome, and every full prior project revision.
The installed `timescale-client commissioning-report-download` resumes the
original two files and manifest after interruption or a host restart. Each
file must fit the original reader's 256,000,000-byte capacity. For larger
projects, the whole-project package retains every source and revision.

[COMMISSIONING.md](../../stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/timescale/COMMISSIONING.md)
contains the complete source format, browser workflow, original request
recovery, all command inputs, typed client and MCP interfaces. The same
`dataset-timescale` command exposes the commissioning operations, and the
existing client exposes `client.commissioning`. Existing Applications launch
configuration continues to open this full product.

The original native demonstration remains bound to its selected source commit
and request input. Later commissioning receiving adopts the updated product
source against that completed retained project with explicit lineage. It does
not rewrite the original run or repeat its native database operations.

## Source and operating references

- [Native source, refresh, job, publication and portable project](../../stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/timescale/README.md)
- [Complete source commissioning and acceptance](../../stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/timescale/COMMISSIONING.md)
- [Assigned work and full revision history](../../stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/timescale/REMEDIATION.md)
- [Merchant configuration, Applications and complete project download](../../stellar-forge/mcp-merchant-operator/TIMESCALE_WORKSPACE.md)
- [Typed client, reports and full desk receiving](../../stellar-forge/mcp-merchant-operator/TIMESCALE_CLIENT.md)
- [Original Ubuntu worker and complete private checkpoint](../../stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/timescale/UBUNTU_NATIVE.md)
- [Source-owned installed registration](../../stellar/scf-starforge-20261009/distribution/contributions/timescale.json)

The product preserves the original database, publisher, schedule, payment and
receiving implementations and the applicable dependency licenses. Select the
customer's actual source, access and vendor deployment terms when adapting the
worked example.
