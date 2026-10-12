# Superset report and customer workspace

Use one installed product to select an authenticated Superset report, review its exact source and meaning, publish a native Stellar merchant, receive the complete buyer result and hand the working project to another operator.

The source workspace, original versioned publisher, SF88 buyer acquisition and SF100 customer delivery remain the existing implementation. The selected product includes its browser, command line, managed Applications integration, operating sources and original session-transfer dependencies.

## Build and install the selected product

Use Linux, Node 24 or later, Python 3.11 or later, Git, npm and util-linux `flock`. Keep the installation, operator workspaces and private runtime configuration in separate owned directories. An existing Superset 6.1.0 service supplies the report; its account and native authorization remain the source's access control.

From the complete selected source checkout, use the original distribution builder:

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/merchant-source --ref FULL_SELECTED_COMMIT \
  --selection superset-report --out /absolute/private/superset-package
~~~

Keep the returned archive, SHA-256 and complete manifest together. The original build record binds the selection recipe, resolved source commit, whole registered application, dependencies and browser assets. Resume an interrupted build with that same output directory and selection.

Install the exact archive through the maintained runtime installer. These commands use the actual archive filename and digest returned by the build:

~~~sh
starforge runtime-install prepare \
  --dir /absolute/private/runtimes/superset-report \
  --archive /absolute/private/downloads/superset-report.tgz \
  --sha256 ORIGINAL_ARCHIVE_SHA256 \
  --native --feature schema --feature openapi --feature mcp --operator
starforge runtime-install install \
  --dir /absolute/private/runtimes/superset-report
starforge runtime-install inspect \
  --dir /absolute/private/runtimes/superset-report --load --source
~~~

Before an installed `starforge` command is available, use
`node /absolute/merchant-source/stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs`
for the same installer. Existing runtime installation, dependency selection and recovery are described in the included `source/stellar/scf-starforge-20261009/distribution/RUNTIME_INSTALL.md`.

The source installation can also expose the selected command directly:

~~~sh
npm install --ignore-scripts --no-audit --no-fund /absolute/private/downloads/superset-report.tgz
npx --no-install starforge doctor
~~~

The selected package has the `starforge` executable. Its original provider command remains `superset`; the application server is `superset-workspace`.

### Open the original application

Run through the installed runtime:

~~~sh
starforge runtime-install run \
  --dir /absolute/private/runtimes/superset-report -- \
  superset-workspace --directory /absolute/private/report-operator --port 0
~~~

Open the returned numeric loopback URL. The original private launch file and browser cookie identify this operator. Retain that operator directory when reopening.

For managed Applications, attach the same installation to the existing Runtime workspace:

~~~sh
starforge runtime-workspace init \
  --workspace /absolute/private/runtime-workspace
starforge runtime-workspace attach \
  --workspace /absolute/private/runtime-workspace \
  --runtime /absolute/private/runtimes/superset-report \
  --label 'Superset report and customer'
starforge runtime-workspace serve \
  --workspace /absolute/private/runtime-workspace --port 0
~~~

Choose **Superset chart data** in **Applications**, select the private operator and report workspace, then use the original Start/Open, Stop and Reopen controls. Set the declared source credential environment variables in that host's runtime configuration. The original manager verifies the selected installed source and authenticated application launch.

### Included customer and operating interfaces

| Installed interface | Complete work |
| --- | --- |
| `starforge superset-workspace` | Source, report selection, reviews, comparisons, merchant, buyer, full project export and receiving in the original browser |
| `starforge superset` | The same retained project operations and original buyer commands; `--connect` uses the current checked private launch record |
| Original SF88 buyer and typed Node client | Page acquisition, approval and budget, native outcomes, recovery and original session portability |
| Original SF100 delivery | Complete customer files and original acquisition/lineage inspection |
| Runtime workspace and native facilitator | Exact source installation, managed launch, native configured settlement and graceful lifecycle |

The selected source also includes the original developer clients and complete Python receiving package. Their original installation and dependency declarations remain beside their source. The full report operation below uses the same native modules as the complete toolkit.

Capture a saved Superset chart under its native account, select and review the exact query result, compare later editions, and publish the approved report through Starforge's existing dataset merchant. The same workspace prepares the original SF88 buyer, receives its completed SF100 data room, and transfers the complete source, review and customer history in one SQLite file.

The browser is grayscale, uses the original host's private workspace and exposes the source-to-delivery sequence directly. Linux, Node 24 and util-linux flock are required. The Superset protocol implementation follows the official [Apache Superset 6.1.0 source](https://github.com/apache/superset/tree/c83fb2bb1dcfac41ac51bcebd82471f4a7180d18). Use the existing installed Starforge runtime and its dependencies.

## Open the installed application

In managed **Applications**, choose **Superset chart data**, select a private operator directory, optionally select an existing report workspace, and start it. The manager verifies the exact installed source selection and the running operator's authenticated launch record.

The direct installed command uses the same server:

~~~sh
starforge superset-workspace --directory /private/report-workspace --port 0
~~~

The one-line startup record contains its numeric loopback URL. Open that URL. A unique HttpOnly SameSite cookie keeps this local workspace distinct from other managed applications. The private operator-launch.json also supports the original authenticated connection reader; its token is excluded from the startup announcement.

With a source checkout, the equivalent entry is:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/superset/server.mjs \
  --directory /private/report-workspace
~~~

Use --workspace /private/existing-report-workspace when an operator directory and the existing data workspace are separate. The process owns both directories until its native captures and merchant services finish closing. SIGINT and SIGTERM follow that same drain path.

## 1. Connect to the original Superset source

Set credentials on the host before starting the workspace. Register the source URL, authentication method and environment variable names in **Sources**. Supported native methods are:

| Method | Registered fields | Host values |
| --- | --- | --- |
| Bearer | mode: bearer, tokenEnv | Existing native access token |
| Database or LDAP login | mode: login, usernameEnv, passwordEnv, provider: db or ldap | Existing account credentials |
| Session | mode: session, cookieEnv | Existing native Cookie header value |

The source definition contains variable names. Login payloads, authorization headers and session cookie values stay in the running process. Ordinary authenticated reads establish the native Flask session and the Superset async JWT cookie before requesting an asynchronous result.

Use the authenticated chart or dashboard inventory, or supply a known chart ID. **Capture original result** reads:

1. The complete native chart metadata and saved query_context/params.
2. GET /api/v1/chart/{id}/data/?format=json&type=full, retaining every result query.
3. The chart metadata again, checking that the saved query and data source remained the same.

A force refresh asks the original Superset cache to run again. Saved filters, SQL, row limits, offsets, role permissions and native access checks remain with Superset. The capture records the original principal, original response bytes, saved request context, native result status, cache and queried times, resolved time bounds, and all applied/rejected filters.

With GLOBAL_ASYNC_QUERIES enabled on the actual deployment, the same capture follows its original channel/job through /api/v1/async_event/. It advances the exact event cursor and selects the corresponding native job. Only a same-origin result URL inside the configured Superset base path is accepted. It retains both native cookies throughout. The implementation uses the 6.1 event protocol.

Default operational limits are 60 seconds per request, 180 seconds per async capture, 64 MiB per response and 256 MiB across retained capture responses. Source options can explicitly choose requestTimeoutMs, asyncTimeoutMs, pollMs, maxResponseBytes and maxCaptureBytes within their declared maximums. A limit ends the attempt with its original progress retained. Remote HTTP deployments require allowHttp: true; loopback development URLs are supported directly.

## 2. Select the report and review its meaning

**Captured queries** displays every native result query separately. Select its ordinal, then select up to 32 fields and an optional explicit unique row key. The entire original capture remains attached when only one query is published.

FULL JSON results use native row dictionaries and ordered colnames/coltypes. Native rowcount describes the returned processed query result. Saved limits and offsets remain visible; it is not treated as the total unfiltered source table. Failed query outcomes remain retained alongside successful queries. A selected query must be successful and have the original row shape. POST_PROCESSED column/index maps are a different protocol shape and are not silently converted.

Each published source field becomes adjacent value and state columns. State is value, null or missing. This preserves empty strings, zero, false, trailing whitespace and absent properties.

| Original values in one selected field | Dataset representation |
| --- | --- |
| Native booleans | Nullable boolean plus state |
| Safe integer JSON tokens | Nullable integer plus state |
| Numeric tokens that round-trip exactly through the original engine | Nullable number plus state |
| Other numeric tokens | Original numeric token as text plus state |
| Strings, including empty and whitespace strings | String plus state |
| Mixed or structured JSON | Exact JSON text plus state |

The original JSON number spelling is read before JavaScript numeric conversion. Native column definitions, the original authenticated principal identity, saved query identity and explicit key meaning are included in stellar-forge.superset-semantics.v1. The original dataset engine binds the physical data and this meaning to its native snapshot.

Open **Editions & review** to query the projected dataset through that engine. Record a named review of the exact edition SHA, decision, distribution basis and review note. Merchant preparation uses the latest approved review of that edition. Earlier reviews stay retained.

## 3. Compare and publish another edition

Capture the same saved chart again after the source changes. Select the same query ordinal, fields and row key, then open **Comparison**.

The comparison retains every changed, added and removed row, including before/after values and their presence states. Explicit keys match original row identity. Without a key, the view explicitly compares native result positions. The browser paginates the complete retained difference; its download includes all changes.

In **Merchant**, choose the approved edition, public HTTPS origin, fixed route and original public payment terms. Preparation calls the existing SF30 compiler and SF82 dataset package path. It retains the source capture, exact response bodies, immutable edition, review and native dataset configuration with the merchant.

Start the original versioned service. Its current snapshot and revision are visible. To publish another reviewed edition to that service, choose its existing version store during preparation and retain the original route, payment terms and field contract. **Publish this prepared edition** sends the actual displayed snapshot and revision to the original writer's guarded refresh. A recovered already-current result stays attached to the same operation.

The existing seller and buyer APIs perform their original payment admission, budget, signing, settlement and recovery operations. The source adapter owns no separate payment engine. The server accepts an optional private --runtime JSON file with the original SF82 runtime keys: port, facilitator and allowLocalFacilitator. Use that configured native facilitator for NATIVE_X402 operation.

The module also exposes the original supervised release workflow through stageSupersetRelease, activateSupersetRelease, rollbackSupersetRelease and runSupersetRelease. These delegate to the existing SF82 release store and preserve its actual lifecycle.

## 4. Receive the complete original buyer result

In **Buyer & receiving**, load the actual running merchant offer for the selected snapshot and first-page query. Review its network, asset, atomic amount, recipient and offer SHA. Select a native payment alternative and a unique buyer intent ID, then prepare the original SF88 configuration.

The browser displays three commands bound to that buyer's actual directory. Set the desired total atomic budget in the first command. Run initialization, then the original acquisition from the terminal while the workspace remains open. The original command retains each page's approval, budget, settlement and recovery state:

~~~sh
starforge superset buyer --help
starforge superset buyer status --session /private/report-workspace/buyers/BUYER_ID/session
starforge superset buyer recover --session /private/report-workspace/buyers/BUYER_ID/session
~~~

Use **Read original acquisition status** and then **Receive completed customer output**. Receiving verifies every original page belongs to the approved resource and snapshot, and calls the existing SF100 data-room exporter. It retains the original session, pages, complete outputs and lineage. Source captures are an explicit option in the customer delivery.

**Verify and reopen delivery** reconstructs those exact retained members and reads them through the original delivery inspector. CSV, JSONL, derived SQLite and the original acquisition files retain their actual exporter identities.

## 5. Transfer or reopen the workspace

**Download complete workspace** produces one private SQLite database containing original response bodies, source definitions, immutable editions, named reviews, comparisons, merchant and publication records, each initialized original version store and its complete retained generations, buyer configurations, complete initialized original SF88 acquisitions (including failed attempts, wire/evidence files and page history), completed delivery members and every operation's retained progress.

The export is identified by the exact complete database bytes. Failed or interrupted capture attempts are included even when they did not advance the selected edition revision. Original buyer session capture uses the existing SF88 run and wire locks plus its portable-session API. Each new project export selects a fresh frozen acquisition snapshot. Complete session ZIP bytes are retained in 4 MiB database chunks with an additional whole-archive SHA256, so large acquisitions do not require one large in-memory ZIP buffer. This transfer uses the installed Python 3.10+ standard library alongside Node.

~~~sh
chmod 600 /path/to/superset-export.sqlite3
starforge superset receive \
  --file /path/to/superset-export.sqlite3 \
  --directory /private/received-report
starforge superset-workspace --directory /private/received-report
~~~

Receiving checks the original schema and every compressed blob/record digest, binds reviews and buyer/delivery identities, regenerates the source projection, verifies every native dataset snapshot and reopens completed customer outputs. The original workspace ID, records and history are preserved. A repeated import of the same exact file into the same receiving directory reopens that existing workspace.

The receiver checks each frozen native session definition against the original prepared request, payment terms and selected snapshot, while preserving the actual acquisition configuration digest and logical source paths. It restores through the original SF88 archive receiver at the new buyer directory. Existing status, recovery and delivery commands resolve that directory through SF88's explicit storage mapping; browser commands point at the receiving workspace. A completed acquisition reopens without another page request. An unfinished acquisition keeps its original state and continues only through its original compatible buyer, approval and ledger selection. See [the original session transfer guide](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/d5034d824d23ce12026488744f2406c256f46a31/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/DATASET_SESSION_PORTABILITY.md).

Retained source replay, edition queries, comparison, reviews and customer output inspection work offline. Set the named environment variables to make another live native capture. A restored merchant package is rebound to its receiving host's local version-store directory. The project carries the original native state, current selection, revision, retention settings, source binding and every referenced CSV/configuration/manifest generation. Export selects a consistent state while the original writer runs; receiving validates a private staged copy through the original version engine with collection disabled, then publishes it at the receiving location. Starting the merchant resumes that retained store through the same original package/release engine. Original retention deadlines and publication outcomes remain attached to their native generations.

If receiving stops after one version store has been published, repeat the original project receive. Its saved source receipt identifies that completed store, and the original version engine opens its current valid state while preserving subsequent refreshes, retention changes and additional merchant groups. Stores that still require their first publication are reconstructed from the complete original archive. Even if the received project has since been exported again, repeating receive reads the custody manifest from the exact original SQLite archive named in its receiving receipt. The receiving result records both the current native state identity and its original captured state identity. The acquired-session completion marker is bound to the exact incoming project archive, so re-exporting a received workspace and then receiving the same earlier archive preserves later session and publisher activity. The new export itself can be received into another customer directory with those advanced versions and original acquired pages intact.

## Command and integration API

Run starforge superset --help for the installed CLI. All mutation inputs carry a stable operationId and the displayed expectedRevision. Commands can operate on a closed workspace directly, or use --connect to call the current native operator through its checked private launch record.

For example, a private capture request file contains:

~~~json
{
  "operationId": "monthly-report-2026-10",
  "expectedRevision": 1,
  "sourceId": "source-native-report",
  "chartId": 12,
  "label": "October report",
  "force": true
}
~~~

~~~sh
starforge superset capture --directory /private/report-workspace \
  --input /private/capture-request.json --connect
starforge superset operation --directory /private/report-workspace \
  --id monthly-report-2026-10 --connect
~~~

The running operator immediately records QUEUED before returning HTTP 202. Status advances through RUNNING to COMPLETED, FAILED, INTERRUPTED or CANCELLED. Reusing an ID with changed input is rejected. An uncertain browser response can be reconciled by that original ID. Explicit retry: true resumes the same failed/interrupted request when its reviewed workspace revision still matches. New reviewed work uses a new ID and current revision.

| Module | Native callable |
| --- | --- |
| client.mjs | SupersetClient, sourceOptions |
| source.mjs | readCapture, buildEdition, compareEditions |
| workspace.mjs | openSupersetWorkspace, receiveSupersetWorkspace; dispatch, query, exportDataset, exportFile, close |
| native-custody.mjs | captureSupersetVersionStores, validateSupersetVersionStores, restoreSupersetVersionStores |
| merchant.mjs | prepareSupersetMerchant, readSupersetMerchant, initializeSupersetVersions, startSupersetMerchant, publishSupersetMerchant, supersetMerchantStatus; original supervised release adapters |
| customer.mjs | reviewSupersetBuyer, prepareSupersetBuyer, receiveSupersetBuyer, inspectSupersetDelivery, runSupersetBuyer |
| session-custody.mjs | captureSupersetBuyerSessions, validateSupersetBuyerSessions, restoreSupersetBuyerSessions; original SF88 archives retained as bounded chunks |
| server.mjs | startSupersetWorkspaceServer / startSupersetOperator |
| launch.mjs | inspectSupersetOperatorSelection, verifySupersetOperatorSourceSelection, readSupersetOperatorLaunch |

The complete browser and command paths share one private SQLite workspace and the original kernel-owned file lease. They retain native source and payment outcomes in their corresponding original engines.

## Run the complete native receiving programme

The included `source/stellar/scf-starforge-20261009/sf30-seller-sdk/superset/examples/native-customer.mjs` runs the full original source-to-customer workflow. Use its [complete original source and input guide](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/ff750ca7dd1f8d9917484d907dbf2e5bf7253d42/stellar/scf-starforge-20261009/sf30-seller-sdk/superset/examples/README.md) with an existing Python 3.11 or 3.12 environment containing `apache-superset==6.1.0`, Redis 5 or later and the selected host's existing Playwright/Chromium runtime.

It loads the two exact public Census workbooks into one owned native Superset datasource, executes its actual two-query async chart through Redis/Celery, compares the original sixteen-row editions, completes the baseline's four-page acquisition while publishing its successor, receives the original SF100 output, and operates the browser at desktop and 390 pixels. The continuation receives the full project, opens the original acquisition at its mapped location, delivers those saved pages, advances the publisher, re-exports, reopens the same original handover and receives the advanced project in a further directory.

Keep the programme's operation ID, source inputs, selected runtime and private output directory through continuation. Its phase journal reuses completed work and original publication intent. The local example uses the existing free HTTP dataset route; the actual response and payment status are recorded with the result. Customer-paid use follows the selected merchant's original payment configuration and buyer approval.

The complete public implementation and independent source reviews are delivered. The original `SCF-SUPERSET-CUSTOMER-A238-20261012` native operation retains execution custody for the installed report example. Its completed result, original source records, screenshots and receiving file belong with that same retained operation. Use the resulting native report when recording an operated customer outcome.

## Commissioning and maintainer handover

Name the commissioning payer, source owner, merchant, buyer and receiving engineer in the original customer workorder. Select the actual saved report, its authorized account, reporting window, complete expected output, receiving application and the later change that makes a new edition useful. Review source distribution rights with the edition before publication.

At handover, the second engineer opens the original complete project, inspects both source editions and the acquired baseline, delivers its complete saved output, starts the retained publisher and applies one reviewed source or version change. Reopening the original incoming file preserves that receiving engineer's later state. Keep source and customer approvals, original financial outcomes, complete output and measured receiving effort in the same workorder and Operations case.
