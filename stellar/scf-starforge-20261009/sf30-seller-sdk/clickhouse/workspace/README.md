# ClickHouse merchant operator workspace

Create and operate a merchant from the original [ClickHouse source and merchant plan](../README.md). The local browser joins private source selection, named-query authoring, native schema review, complete payment terms, retained merchant preparation, the original seller and operations, and generated customer downloads.

The workspace uses the existing ClickHouse HTTP source, scalar binder, merchant-plan compiler, preparer and seller lifecycle. Its saved revisions and folders can be reopened after the browser or launching terminal closes.

## Start the operator

Use the same Node runtime and optional native payment dependencies as the existing merchant installation. Linux's standard flock utility holds the original shared state lease. The standard tar utility creates the customer archive. There is no ClickHouse JavaScript driver or frontend build step.

Choose a private state directory outside the source checkout and outside every public web root. Newly created state directories use mode 0700; an existing directory must already have private permissions.

Set the three environment variables named by your source declaration in the launching terminal. For the supplied source example:

    export CLICKHOUSE_MERCHANT_URL='https://clickhouse.example/'
    export CLICKHOUSE_MERCHANT_USER='merchant_reader'
    read -rs -p 'ClickHouse password: ' CLICKHOUSE_MERCHANT_PASSWORD
    export CLICKHOUSE_MERCHANT_PASSWORD

Start with existing source and plan files:

    node stellar/scf-starforge-20261009/sf30-seller-sdk/clickhouse/workspace/server.mjs \
      --state /srv/private/clickhouse-workspace \
      --source /srv/private/source.json \
      --plan /srv/private/merchant-plan.json

Alternatively, start with only the state directory and select both JSON files in the browser:

    node stellar/scf-starforge-20261009/sf30-seller-sdk/clickhouse/workspace/server.mjs \
      --state /srv/private/clickhouse-workspace

Open the complete private URL printed by the command, including its fragment. The workspace listens on loopback; its source files and API require that private capability. Keep the launching terminal running while operating a merchant.

The original source account should have SELECT permission only on the data intended for sale. The adapter's SELECT wrapper and query limits complement those database permissions. HTTPS is the normal source transport. The explicit “Allow a loopback HTTP ClickHouse source” setting supports the original local development mode.

The browser receives the source's environment variable names, SQL and private probe values. Actual endpoint, account and password values stay in the server process; they are never returned by the workspace API or included in a customer download. Environment values are taken from the launching process. Restart the workspace with the same state directory after changing those values.

## 1. Select, author and save a revision

The **Source & offers** screen accepts the original source and merchant-plan schemas. Loading a file changes the current browser draft. **Save revision** validates both documents together through the native source reader and merchant-plan compiler and retains them as one immutable revision.

Use the connection fields to choose the database, environment references and native query budgets. Each named query has a private SELECT statement, typed parameter declarations, explicit output columns, a private preflight probe and result/deadline limits. Parameters use the original $name placeholders. The adapter supplies their native ClickHouse types and values separately.

The typed parameter JSON is the full existing contract. It supports string, integer, number, boolean and exact decimal declarations, their original bounds, enums, defaults and nullability. Decimal parameters require precision and scale. The **Native review** screen displays each compiled native type and every scalar constraint after a real preflight.

Public routes select one of these approved named queries. Set the route's HTTP method, path, service description, explicit public request example and descriptions for all public parameters. New routes start with an empty public example: private probe values are not copied into an offer. Supply an intentional public example before saving.

Each payment option preserves its complete scheme, network, asset, payTo, exact amount string, timeout and extra terms. The option list is ordered, and the up/down controls change the offered order. Amount fields never pass through a JavaScript number. A route can supply its own complete option array instead of inheriting the shared array; both are displayed in the compiled review.

The **Complete native documents** section supports direct source and plan JSON editing. Apply those documents to the form before saving. The original server-side compiler remains authoritative for all fields and validation.

Saved history retains the source and plan together. Opening an earlier revision selects it without changing a running merchant. Edits become a new revision when saved. An unchanged source/plan pair reuses its existing revision and label. Concurrent browser windows compare the editor's adopted revision before a save or selection; an inventory refresh cannot advance that editor base. Refresh and reopen when another window has moved saved work.

## 2. Review the real source and prepare

Choose **Review native source** after saving. The original adapter opens the selected ClickHouse account, reads the native server version and performs its zero-row preflight for every named query. The workspace displays actual native result types, compiled parameter types and the configured scan, memory and deadline budgets.

The review is retained with the exact source/plan revision. A private preview takes explicit typed input values and executes the selected approved query using the same source adapter. Results preserve exact non-null ClickHouse text and JSON null. The original row cap and truncation indicator remain visible; a preview is a single-request snapshot.

Review every compiled route and every complete payment option. Acknowledging that review and choosing **Prepare merchant** invokes the original offline preparer. It creates:

| Retained merchant member | Purpose |
| --- | --- |
| source.json | Private approved SQL, probes, environment references and route bindings |
| merchant-plan.json | The reviewed public route and payment declarations |
| service.json / bindings.json | Original compiled seller configuration |
| openapi.json | Original public API description |
| client/ | Original generated JavaScript client, declarations and customer guide |

The containing workspace record keeps the selected revision, native review and exact prepared files together. The native merchant folder is published only after preparation completes. Its full path is shown in **Prepared merchants**.

Repeated preparation of the same revision and review returns the retained merchant. If the process ended during offline preparation, the screen identifies that unfinished preparation and offers **Resume preparation**. That action rebuilds only its unpublished private copy from the same retained inputs, then publishes the complete folder. If publication already completed, it validates that same folder and finishes removing the consumed preparation intent. It does not perform a customer request or settlement.

If native result types change after review, a private preview or merchant start reports that change. Review the saved revision again and prepare a new merchant from that new review. After updating the installed SDK, the same fresh preparation path also creates outputs with the current compiler.

## 3. Operate the original merchant

Open a retained merchant to inspect its complete terms. **Start merchant** verifies its retained files, performs the original fresh native preflight and opens the existing SF30 seller and operations interfaces. A workspace owns one active merchant at a time.

The screen exposes the original customer API, OpenAPI, operations, availability and availability controls. Those URLs belong to the running original merchant. **Stop merchant** waits for its existing drain lifecycle, closes its operations and ClickHouse source, and keeps the prepared folder available.

The workspace binds its actual loopback origin to the original operations listener's navigation interface. An explicit click opens the original HTML page with only that origin as the referrer; the private URL fragment is excluded. Operations API and export reads retain the original same-origin policy.

Without a facilitator, the original seller runs in CHALLENGE_ONLY mode and responds with HTTP 402. To operate the existing paid path, start the workspace with the original native payment dependencies and facilitator:

    node stellar/scf-starforge-20261009/sf30-seller-sdk/clickhouse/workspace/server.mjs \
      --state /srv/private/clickhouse-workspace \
      --facilitator https://facilitator.example \
      --seller-port 8423 \
      --operations-port 8424

The original HTTPFacilitatorClient and native seller factory handle the payment path, including the existing Stellar scheme. Payment accounts, assets and networks are the explicit terms from the reviewed plan. The workspace does not substitute its own verifier, signer, settlement semantics or payment policy.

The original explicit local facilitator mode is available with both --facilitator and --allow-local-facilitator. Native ports default to dynamically allocated loopback ports; --seller-port and --operations-port select fixed ports. --port selects the operator browser port, default 8443. --max-in-flight and --drain-grace-ms pass through to this direct seller lifecycle.

## 4. Publish, upgrade and roll back

**Publish and roll back retained releases** connects the selected prepared folder
to the existing SF82 merchant release store. Enter a release ID and label, then
choose **Stage selected merchant**. The original release adapter verifies and
retains the source, full typed input/payment contract, customer files and this
workspace's saved native result-column types. Repeating an identical stage
reopens the same release; different source or runtime needs a new ID.

Choose **Open release controls** and follow the private console link. The
original release console compares routes, complete payment alternatives, named
query contracts and limits. **Select this release** records the original
generation-checked selection. **Start selected** opens it; **Restart selected**
drains the running original seller before starting the selected version. The
running instance exposes its original customer API, live OpenAPI, operations and
availability controls. **Select previous release** followed by **Restart selected**
serves a retained version again.

The release store is `STATE/merchant-releases`. It remains usable when a former
prepared input folder moves. Downloads beside each retained release use that
verified private copy and the original six-file customer archive. The release
console owns retained child launches; stop a direct workspace merchant before
opening it, and close the console before returning to direct starts. **Close
controls and drain seller** closes its original owned processes while preserving
all releases and selection history.

The release runtime inherits the original CLI's seller port and facilitator.
Its child uses the original ClickHouse command's capacity of 64 and 60-second
drain grace. The source's separate query/scan/concurrency limits remain unchanged.
ClickHouse data stays live: rollback restores a service definition, not database
history. Every launch performs the original actual preflight; a changed native
column type fails before the retained workspace release opens a listener.

Use [Retained ClickHouse merchant releases](../../../sf82-seller-pilot/CLICKHOUSE_RELEASES.md)
for the complete console, CLI, existing MCP, customer-delivery and recovery flow.

## Deliver the customer client

**Download customer client** returns a gzip tar archive containing exactly the original public OpenAPI plus the five generated client files. **Download OpenAPI** returns the same public description separately. The browser checks the completed download bytes before saving.

The customer archive contains no private source declaration, SQL, probes, merchant plan file or credentials. The public OpenAPI deliberately includes the reviewed public examples and payment information. Check those public fields during offer review.

Extract the archive into a customer application and follow its generated client/README.md. It uses the existing buyer runtime and original response/result behavior described in the [installed ClickHouse merchant/customer guide](../../../distribution/README.md#prepare-and-operate-a-clickhouse-merchant). The workspace's customer API link opens the same merchant's original developer portal.

## Reopen and retain work

Close the browser whenever needed; the process and active merchant continue in the launching terminal. Reopening the same private URL restores saved work. Unsaved form edits live only in the open page.

Ctrl-C or SIGTERM in the launching terminal drains the original merchant before releasing the state lease. Later, run the same workspace command with --state and without --source/--plan to reopen its current revision, reviews and merchant history. Restarting does not automatically start a merchant or repeat a private preview. A last-run entry from an interrupted previous session is shown as historical context.

Only one workspace process can own a state directory. The reused native flock lease releases when its owning file description closes or its process exits; it has no stale-PID deletion or manual unlock race. Stop the owning workspace before opening that same state directory elsewhere.

Keep the entire private state directory for backup or migration. Its revisions/ directory contains immutable source/plan pairs and their retained native reviews; prepared/ contains the original complete merchant folders and original availability state; staging/ contains unpublished offline preparation work; merchant-releases/ contains the original immutable SF82 releases, selection history and retained per-release availability. Complete merchant folders remain usable with the existing clickhouse/start.mjs --directory command after the workspace has stopped.

## Programmatic composition

model.mjs exports createClickHouseWorkspace. server.mjs exports startClickHouseWorkspace and main. The model accepts stateDirectory, optional initial sourceFile/planFile, the existing nativeFactory, native seller ports/lifecycle options and an environment object. An embedding with a custom nativeFactory supplies releaseRuntime with the explicit original facilitator/port options when it wants retained child launches; the normal CLI derives these values from its existing options. The host-only environment also reaches the original release child without being stored or returned to the browser.

The server's loopback capability API exposes state, saved revision selection, save, native review, private preview, prepare, retained release inspection, run, stop and customer export. It also stages a selected prepared merchant through the original release store and opens/closes the original release console. State changes use the original atomic file helper and one process-owned native lease. Browser mutations carry explicit revision, review, release or run identity; they do not submit arbitrary source paths, credential values, shell commands or replacement payment behavior.
