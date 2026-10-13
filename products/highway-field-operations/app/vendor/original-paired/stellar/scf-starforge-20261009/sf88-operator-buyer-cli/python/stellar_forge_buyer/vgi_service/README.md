# Purchased-result VGI service

This component turns complete original DuckDB query exports into an authenticated VGI catalog. The operator reviews the source export and batch size, publishes immutable Arrow batches in the original warehouse, selects a table head and opens the native Query.Farm listener. A receiving application can continue its original scan after the listener restarts or the warehouse is restored.

The complete product uses the existing buyer workspace, Python wheel cohort, Applications configuration, private launch record and managed process lifecycle. The operator interface is deliberately plain: Catalog, Review and publish, Access, Run service, and History and recovery.

## Install in the maintained product

Use the complete merchant distribution containing this component. Open its existing runtime workspace:

    starforge vgi-results serve --workspace /srv/starforge/operator --port 8465

The vgi-results alias enters the original runtime-workspace command; its workspace argument is the runtime operator directory. Select the retained merchant runtime in that workspace.

1. Open **Python and workbooks**. Select a Python 3.13 or newer executable and the **DuckDB** and **Purchased-result VGI** extras.
2. **Review source and interpreter**, then **Resolve and retain exact wheels**. The original wheel engine records the source files, release identity, build closure, selected dependency wheels and hashes.
3. **Install offline** from that retained candidate. Select the resulting environment.
4. Under **Original customer commands**, select **Purchased-result VGI workspace**. Prepare its original arguments, for example:
   
       ["--workspace","/srv/starforge/customer/warehouse","workspace","--port","0"]
   
5. Choose **Configure in Applications**. Review the original warehouse directory, installed environment and private operator port. Optional query-export and handoff roots are private sibling directories.
6. Select the private environment JSON containing the native VGI authentication configuration. Its bytes remain pinned by the original Applications review.
7. Save and start the application. **Open** uses the actual child-owned duckdb-launch.json URL. The original managed operation retains its installation/source fingerprints, stdout, process identity, stop and recovery controls.

The Python selection requires these released packages:

| Package | Selected version |
| --- | --- |
| vgi-python with http and oauth extras | 0.43.1 |
| vgi-rpc with http and oauth extras | 0.51.0 |
| duckdb | 1.5.6 |
| waitress | 3.0.2 |

The original wheel lock captures their full resolved dependency closure. The native service also reads selected installed vendor source hashes before starting. runtime-selection.json records the reviewed release commits and exact source files.

A Python wheel cohort can be exported and received through the existing **Python and workbooks** pane. The receiver verifies the original complete lock, wheels and application source, then installs them into its retained private environment. The original merchant source/runtime profile travels through its existing handoff.

## Use the private operator

### Prepare or select a complete result

Open **Review and publish**. Choose an existing complete query export, or choose a saved original query and **Prepare complete query export**. That action uses the original saved SQL revision, exact current view editions, native export operation and request ID.

The source remains in the original result.parquet, result.csv, request.json, execution.json, manifest.json and any source dictionary members. Review verifies all retained file descriptors, source/query/view identities, actual Parquet schema, row counts and row-group sizes. Every member is verified again before publication commits.

Choose **Rows per input batch**, from 1 to 4096. This is an explicit part of the reviewed selection. The writer may split a batch further to keep each serialized IPC payload at or below 4 MiB. It rejects an individual value that cannot fit that limit.

Select a table name, then **Review exact export**. Read the original query types, published Arrow types, encodings and source meaning. **Publish retained result** writes the publication, complete ordered batches, table head, original request result and history together in the warehouse transaction.

The exact original export encoding is preserved. For example, an existing HUGEINT export represented as DECIMAL(38,0) retains that representation and its original column-encoding metadata. JSON source values remain their original Arrow values.

### Select editions

**Catalog** lists each table's current head and all retained publications. **Open edition** shows its original source, exact schema, batch sequence and review hash. **Select this retained edition** changes the head using its expected current revision.

An existing alias keeps one Arrow schema. Publish an incompatible schema under a new table name. Retiring an alias makes its next authenticated read unavailable, including retained continuation requests.

The running listener pins the selected catalog heads. Stop and start it after publishing or selecting a new head. Old immutable scanners remain registered while their aliases are active, so an existing native continuation token still resolves its original publication after that restart.

### Configure access

**Access** sets the catalog name, label and allowed authenticated principals. Principal names are exact provider identities; one name appears on each line. The request retains the service revision displayed when the draft was opened.

The native SDK resolves its existing bearer/JWT and proxy-proof configuration from the server process environment. A private Applications environment file can contain the supported VGI_BEARER_TOKENS setting, whose format is token=principal pairs separated by commas. Generate and retain the actual token in the operator's private credential workflow. The browser needs the principal name, not that token.

For JWTs, use the original VGI_JWT_ISSUER and VGI_JWT_AUDIENCE settings, with optional VGI_JWT_JWKS_URI. The selected package includes the vendor's oauth dependencies. Existing VGI_PROXY_PROOF_* settings retain their native gate and identity-bearer composition. See the vendor authentication reference linked below.

The service applies its current allowlist after the SDK's full authentication chain. Each batch also checks the current principal and table state. A changed allowlist takes effect at the next request; the listener's catalog snapshot does not freeze access.

**Allow local standard-input clients** is a separate explicit choice for the host's original VGI standard-input transport.

### Start and stop

**Run service** shows the installed Python/packages/source checks, current original listener receipt, selected catalog revision and actual address. Select an exact numeric IPv4 or IPv6 address and a port; port 0 chooses an available port.

**Start service** retains the request before publishing readiness. The listener is Query.Farm's original WSGI application, served by Waitress with its native Arrow tuning. The service's lifetime lock belongs to the actual listener.

**Stop original listener** closes the original listener, request dispatcher and remaining private socket map before releasing that lock. A second operator observing an external owner uses that original foreground or Applications operation to stop it.

Applications **Stop** interrupts the original VGI workspace command. Its original buyer HTTP server, VGI listener and warehouse handles close through their normal owners. Reopen the saved Applications configuration to use the same warehouse and installed environment. A changed authentication environment is selected by restarting the original operator process.

## Native SQL and receiving clients

The vendor's SQL client connects to the running VGI endpoint:

    INSTALL vgi FROM community;
    LOAD vgi;
    ATTACH 'purchased' (
        TYPE vgi,
        LOCATION 'http://127.0.0.1:8080/',
        bearer_token 'YOUR_PRIVATE_TOKEN'
    );
    SELECT * FROM purchased.results.purchased_events;

Use the actual recorded listener address and reviewed table name. The service exposes its exact retained Arrow schema. The SQL engine evaluates projection, filtering and sampling above the complete scan because this worker advertises those pushdowns as disabled.

Run SQL in a receiving client connection. The original warehouse's query engine keeps its existing restricted external-access settings.

The Python SDK has an explicit continuation API:

    from vgi.client import Client
    import os

    address = "http://127.0.0.1:8080/"
    token = os.environ["RESULT_SERVICE_TOKEN"]
    function_name = "sf_result_" + publication_id

    with Client.from_http(address, bearer_token=token) as client:
        scan = client.table_scan_resumable(
            function_name=function_name, schema_path=["results"])
        batch, resume_token = scan.next()
        scan.close()

    # Reopen a client after a listener restart, retaining this exact token.
    with Client.from_http(address, bearer_token=token) as client:
        scan = client.table_scan_continue(resume_token=resume_token)
        batch, resume_token = scan.next()
        scan.close()

The publication's native function name is included in the running catalog descriptor. The SDK owns the authenticated Arrow transport, schema and signed continuation token. The warehouse retains the original signing key across backup and reopening.

A listener uses one process. The SDK's process-local SQLite protocol storage is explicit; this scanner's durable source batches, publication history, cursor identity and signing key remain in the original warehouse and native tokens.

## Direct installed command

The complete wheel declares stellar-forge-vgi-results. The equivalent module is stellar_forge_buyer.vgi_service.cli.

    VENV_PYTHON -m stellar_forge_buyer.vgi_service.cli runtime

    VENV_PYTHON -m stellar_forge_buyer.vgi_service.cli \
      --workspace /srv/starforge/customer/warehouse \
      workspace --port 0

The workspace command prints one compact LISTENING announcement. Its address omits the private capability; private_launch points to the original duckdb-launch.json containing the complete URL.

Read and review through the same installed command:

    VENV_PYTHON -m stellar_forge_buyer.vgi_service.cli \
      --workspace /srv/starforge/customer/warehouse state

    VENV_PYTHON -m stellar_forge_buyer.vgi_service.cli \
      --workspace /srv/starforge/customer/warehouse \
      review ORIGINAL_EXPORT_SHA256 --batch-rows 4096

configure, publish and activate accept explicit original 32-character hexadecimal request IDs and expected revisions. Run --help on the selected subcommand for its complete field names. Retain an accepted request ID and body if a reply is interrupted.

The http command runs the native listener in foreground, and stdio runs the vendor's original Arrow protocol on stdin/stdout. Standard-input operation requires the explicit local access choice. Normal logs and errors use stderr.

A receiver can provide --export-locations with a private JSON object mapping an original export ID to its verified relocated member directory. This trusted placement selection changes neither the retained sf_exports record nor the review identity. It is used only to review/publish the exact original files. Published batches reopen directly from the warehouse.

## Recovery and handover

**History and recovery** lists retained browser requests, original buyer operations, service changes and warehouse handoffs. Interrupted replies retain the exact body and request ID. **Continue same request** reuses that request. The backend returns a committed result before applying another mutation.

A complete reply retires its browser request entry. A later deliberate operation receives a new ID. Current configuration drafts are scoped to the original workspace; changing the workspace does not silently reuse another workspace's draft.

**Create original warehouse handoff** uses DuckDBWorkspace.backup. Its exact warehouse snapshot contains the service's publication records, BLOB batches, access configuration, history and signing key. The original handoff descriptor and member downloads stay in the buyer's retained export index.

On the receiving host, follow the original DuckDB handoff verification/reopen procedure against the exact warehouse.duckdb member and original handoff metadata. Open the restored warehouse with DuckDBWorkspace, then VgiService; the service identity must match. The original source-meaning and retained query-export members travel beside the backup when source review or another publication is required.

The original C271 operating input available for the integrated receiving is a complete 32-row source-meaning package: seven original Svenska kraftnät source pages, retained warehouse, typed query result, CSV/Parquet and dictionary. An explicit 16-row review yields a useful second original batch for restart and head-change continuation. The receiving report records its actual executed result and selected runtime separately.

## Source layout

| Source | Role |
| --- | --- |
| model.py | Original-warehouse catalog, immutable batches, current policy and original request transactions |
| worker.py | Native Query.Farm catalog/scanner and its authenticated Arrow state |
| runtime.py | Selected vendor source checks and original listener lifetime |
| operator.py | Optional routes and static UI on the original private buyer server |
| cli.py | Installed foreground and receiving entrypoint |
| public/ | Industrial operator interface |
| original duckdb_http.py | Optional VGI route/static/lifecycle join |
| distribution/python-runtime/ | Existing wheel/Applications selection and private launch binding |

Vendor references:

- https://query.farm/vgi/data-as-a-service/
- https://query.farm/vgi/
- https://github.com/Query-farm/vgi-python/tree/bf8b0b3902e1ff165ac413e4a216801f03ed8693
- https://github.com/Query-farm/vgi-rpc-python/tree/ca89b6d9c0d793cf8d708103d9cd1abf5f808271

This application source retains the original Stellar Forge license. Vendor packages retain their separate licenses and notices; see SOURCE_NOTICES.md.
