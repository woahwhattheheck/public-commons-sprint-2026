# Installed Datasette Analysis and source workflows

The **Datasette customer Analysis** application opens the complete customer workspace from the merchant runtime's existing Applications pane. It uses the installed original Python package with workbook support, the source release selected by that runtime, and the same Analysis database used by queries, reports, workbooks and whole-workspace receiving.

The source and publisher desk produces reviewed Datasette editions. This application receives that selected source, keeps its original fields and edition history, and prepares editable customer analysis. The operator's **Original Analysis** link opens saved queries, reports and workbook tools in the same process and database.

## Install and open

Start the existing runtime workspace:

~~~sh
starforge runtime-workspace serve --workspace /srv/starforge/operator --port 8465
~~~

Launch this Runtime workspace from the complete selected Datasette release,
then select its original merchant runtime in the sidebar. The source release
includes the publisher, customer Analysis, source workflow and supplier
contributions together. The Applications catalogue belongs to this running
operator's source; reopen the operator from an updated release to discover its
new source-owned entries.

1. Open **Python & workbooks**. Select a Python 3.11 or newer executable and the **workbooks** extra.
2. Use **Review source and interpreter**, **Resolve and retain exact wheels**, then **Install offline**. Keep the returned Python installation ID for this actual selected source. The maintained original pyproject selects openpyxl 3.1.5. The installed package includes the selected-view query/report/export implementation carried by the release; use the maintained Python source and installation controls when adopting a new release.
3. Open **Applications** and select **Datasette customer Analysis**. Choose that Python installation, the private Analysis database directory and its stable operation ID. Select the original Node executable when the runtime default is unsuitable.
4. Use the existing review, save, connect and start controls. **Open** takes you to the running Datasette operator.
5. Select the source handover, prepare the edition and inspect its rows and source review. Edit additional saved queries, reports and workbooks through **Original Analysis**.
6. Prepare a workspace export after customer edits. Download the chosen export generation and its manifest, together with the prepared reports and workbooks.

A new workspace uses an absent directory under an existing private parent. An existing workspace keeps its original directory and 32-character lowercase hexadecimal Analysis operation ID. Use the same ID when reopening a restored workspace. For a new operation, an ID can be generated once with:

~~~sh
python3 -c 'import uuid; print(uuid.uuid4().hex)'
~~~

The existing Applications resource lock is shared with the original **Analysis and workbook workspace** application. It coordinates access to the same database directory. The original Analysis process also owns its database lock.

## Application settings

The existing Applications review API accepts this application kind and settings:

~~~json
{
  "kind": "datasette-analysis",
  "settings": {
    "installationId": "ORIGINAL_64_HEX_PYTHON_INSTALLATION_ID",
    "databaseDirectory": "/srv/starforge/customer/analysis",
    "operationId": "ORIGINAL_32_HEX_ANALYSIS_OPERATION_ID",
    "nodeExecutable": "/absolute/path/to/node",
    "port": 0
  }
}
~~~

The surrounding review request uses the selected runtime ID and directory, label and existing application revision as documented by the original Applications API. An optional private environment JSON uses the same environment control as other original applications.

Review and start bind the retained Python installation, source manifest, lexical virtual-environment interpreter, Analysis source files and selected Node executable. Startup uses the original private launch records and authenticates to the live Analysis API before publishing the Open link. The existing managed worker retains the process, operation, log and stop controls.

## Installed command line

The source-owned command forwards to the same Python CLI:

~~~sh
starforge datasette-analysis \
  --runtime-workspace /srv/starforge/operator \
  --runtime-directory /srv/starforge/runtime \
  --runtime-id ORIGINAL_24_HEX_RUNTIME_ID \
  --installation-id ORIGINAL_64_HEX_PYTHON_INSTALLATION_ID \
  -- serve \
  --workspace /srv/starforge/customer/analysis \
  --operation-id ORIGINAL_32_HEX_ANALYSIS_OPERATION_ID \
  --node /absolute/path/to/node \
  --port 0
~~~

Use the original **Python & workbooks** inventory, or:

~~~sh
starforge runtime-workspace python-status \
  --workspace /srv/starforge/operator --runtime-id ORIGINAL_RUNTIME_ID
~~~

The command uses the selected installation's exact source root automatically. It keeps the virtual-environment executable path, including its venv selection.

Arguments after the separator select the existing cli.py interface: serve, status, prepare, rows, compare, export, call, request, download and receive. The workflow prefix selects the maintained workflow_cli.py interface for original requests, source/report execution, delivery and complete project receiving. Add --connect for operations against an already running operator. Keep request IDs when recovering a submitted action. The Python SDK uses DatasetteOperatorClient.from_workspace(...) for that same connection. See [README.md](README.md) for complete action and download examples.

For a direct source checkout, the original command remains available:

~~~sh
/absolute/path/to/workbook-python \
  stellar/scf-starforge-20261009/sf30-seller-sdk/datasette-analysis/cli.py serve \
  --workspace /srv/starforge/customer/analysis \
  --operation-id ORIGINAL_32_HEX_ANALYSIS_OPERATION_ID \
  --checkout /absolute/path/to/complete/source \
  --node /absolute/path/to/node
~~~

## Managed source workflow

Select **Applications → Datasette source workflow** for complete original
business requests, source editions, saved SQL/report sections, supplier review
and delivery. It uses this same installed Python environment and the original
workflow engine. The existing customer Analysis application remains the owner
of its native database.

Prepare the complete installed configuration before reviewing the application.
Use workflow configure with the original source files, native Analysis directory
and operation, complete source archive and selected supplier workspace.
The installed component includes the complete retained supplier review at
products/conapi/supplier-report/examples/published-pricing-intake.workspace.json;
select it with the matching original pricing and catalogue example.
The [source workflow guide](WORKFLOW.md) documents every configuration flag;
[the supplier receiving programme](WORKFLOW_RECEIVING.md) binds the complete
original paired CSV family and all six SQL sections.

| Application field | Exact selection |
| --- | --- |
| Installed Python environment | The retained 64-character Python installation ID with the workbooks extra |
| Original request workspace | Existing private workflow directory, received project directory, or absent directory inside a private parent |
| Installed source and report configuration | Complete JSON written by workflow configure; optional when inspecting and re-exporting a received project |
| Local port | 0 selects a free loopback port; retain an explicit port for a stable browser origin |
| Private environment JSON | Original host-only environment settings when the native services require them |

The existing Applications API review shape is:

~~~json
{
  "kind": "datasette-workflow",
  "settings": {
    "installationId": "ORIGINAL_64_HEX_PYTHON_INSTALLATION_ID",
    "workflowDirectory": "/srv/starforge/customer/workflow",
    "configurationFile": "/srv/starforge/customer/supplier-configuration.json",
    "port": 0
  }
}
~~~

Use the surrounding runtime ID, runtime directory, label and review/save
revision from the maintained Applications API. Review and Save bind the actual
configuration bytes, installed source manifest and Python executable. Start
uses that same installed wrapper and returns the original managed operation.
Open leads to the request/report/delivery workbench.

The workbench exposes the complete configured source aliases, original SQL
sections, selected report and required business parameters. A request with
period set to month, for example, runs that declared parameter through the
supplier profile's selected_period query while retaining its five other full
source and coverage sections. The native supplier revision, complete accepted
outputs and original input files travel with its result.

### Startup, readiness and reopening

The new entry shares the datasette-analysis provider. Its resource key belongs
to the workflow directory, while the original customer Analysis resource key
continues to belong to the Analysis directory. Start the configured customer
Analysis application before running source/report actions in the workbench.

The Python workflow listener writes source-workflow-launch.json privately in
its own workspace. The original managed observer checks its process ID,
workspace ID, port, exact configuration descriptor and authenticated live
/api/health response before exposing Open. The response includes the selected
Analysis operation and its actual readiness. The private capability stays in
the local URL fragment and the original managed launch record.

A received project can open without a configuration so its retained request,
reports, files and complete project export remain available. To continue
report work, reopen the restored native Analysis owner, configure the actual
receiving paths and select that configuration in the saved workflow
application. See [Receiving and reopening](#receiving-and-reopening) below.

Use the existing Stop control for this application. The workflow listener
closes its own socket and private launch record. Reopening the same workflow
directory keeps its original request database and history and produces a fresh
local capability. Reopen from the current Applications Open link. Configure
changes through the existing stop, review, save and start sequence so the
retained configuration matches the new run.

The same launch is available directly:

~~~sh
starforge datasette-analysis \
  --runtime-workspace /srv/starforge/operator \
  --runtime-directory /srv/starforge/runtime \
  --runtime-id ORIGINAL_24_HEX_RUNTIME_ID \
  --installation-id ORIGINAL_64_HEX_PYTHON_INSTALLATION_ID \
  -- workflow serve \
  --workspace /srv/starforge/customer/workflow \
  --configuration /srv/starforge/customer/supplier-configuration.json \
  --port 0
~~~

Omit --configuration for a received project inspection. For direct launches,
the original local URL is still printed and --open retains its browser-opening
behavior. A private listener lock prevents another workflow server from
opening the same request directory.

## Receiving and reopening

The customer workspace travels through the original Analysis archive and restore_archive receiver. The operator's complete export includes the source editions, original retained response files, queries, reports, workbooks and saved operation state.

Use the receive command described in [README.md](README.md), select an absent receiving directory and preserve the archive's SHA-256 and receiving operation ID. Then open **Datasette customer Analysis** for the restored directory with its original Analysis operation ID. The original reports and workbook files remain downloadable, and saved queries remain editable.

For another host, receive the matching merchant source and Node runtime through the existing **Offline transfers** workflow. In **Python & workbooks**, export the exact wheel bundle, receive it on a compatible host and install it offline. Select that receiving installation for the restored customer application. [The original Python workspace guide](../../distribution/python-runtime/WORKSPACE.md) documents these controls and their existing CLI operations.

Each new workspace export gets a distinct generation. The same export request ID reuses its original archive; a fresh export after a customer edit snapshots the current original workspace. Download descriptors carry that export ID so earlier deliveries remain selectable. The --export-id download option and typed Python client accept the same generation.

### Receive the complete request and supplier project

The complete workflow project includes its original business request/history,
all native Analysis output files and archive, complete built application source,
supplier package, coverage originals and outputs, and selected workflow/flow
source. Choose the complete workflow ZIP from Export project and its returned
SHA-256.

Use this installed command on the receiving host:

~~~sh
starforge datasette-analysis \
  --runtime-workspace /srv/starforge/receiving-operator \
  --runtime-directory /srv/starforge/receiving-runtime \
  --runtime-id RECEIVING_24_HEX_RUNTIME_ID \
  --installation-id RECEIVING_64_HEX_PYTHON_INSTALLATION_ID \
  -- workflow receive \
  --archive /srv/starforge/transfers/Complete_Supplier_Project.zip \
  --sha256 ORIGINAL_COMPLETE_PROJECT_SHA256 \
  --workspace /srv/starforge/received/workflow \
  --analysis-workspace /srv/starforge/received/analysis
~~~

Open **Datasette customer Analysis** for the restored Analysis directory with
its original operation ID, then **Datasette source workflow** for the received
workflow directory. The original supplier manifest and files retain their
basenames together under received/delivery/supplier. The complete native source,
report and workbook files remain under received/delivery. Launch the original
received supplier editor with:

~~~sh
node /srv/starforge/received/workflow/received/delivery/supplier/supplier-report-cli.mjs serve --port 8765
~~~

Open the printed localhost URL and adjacent workspace.json to continue the
native review. The complete original editor and CLI source travel in the
supplier manifest.

A new customer change uses a successor request and a configuration pinned to
the actual receiving files. The retained input review is
received/delivery/supplier/original-supplier-workspace.json. Its pricing,
catalogue and publisher metadata companions are coverage-pricing-source.csv,
coverage-catalogue-source.csv and coverage-publisher-metadata.json. Keep the
native review request and revision and link the new business request with
parentRequestId. The [full receiving programme](WORKFLOW_RECEIVING.md) contains
the exact complete configuration, native owner reopening and edited successor
sequence.

## Source selection and integration

The additive declaration is distribution/contributions/datasette-analysis.json. Add **datasette-analysis** to the existing Datasette source selection's contributions array beside its source/publisher contribution. The declaration carries:

- The complete sf30-seller-sdk/datasette-analysis source, operator assets, typed Python client, example handovers and receiving launcher.
- The original sf30-seller-sdk/datasette component, including the maintained edition reader, original captures and exact JSON scalar helpers.
- The original sf88-operator-buyer-cli component, including the complete Python package, pyproject, package data and Node bridge files.
- The original distribution/python-runtime component.
- The source-owned customer Analysis and source workflow Applications adapters and their shared original provider.
- The complete source workflow operator, native adapter, profiles, original paired CSV inputs and request/project receiver.
- The selected products/conapi/supplier-report component, including its maintained parser, review application, coverage and complete attachment helper.
- The datasette-analysis native command and its Node export.

The contribution also names the complete source dependencies outside those components for both customer import paths:

| Customer import | Original source dependencies |
|---|---|
| Reviewed native edition | datasette/editions.mjs, capture.mjs and json.mjs; postgres/publisher/files.mjs |
| Finalized delivered dataset | sf88/python/finalized-dataset-bridge.mjs and sf100-buyer-dataset-delivery/deliver.mjs; the original SF88 configuration and initialization |
| Original finalized configuration | sf31-buyer-client public-transport.mjs, request-body.mjs, response-file.mjs and response-stream.mjs; sf85-live-402-capture/proxy-connect.mjs and sf30-seller-sdk/multipart.mjs |

These eight outside-component support files are selected explicitly. The original finalized scanner and exact native-edition reader are therefore present in the same installed source archive as the Python application. Original row import, query, report, workbook and archive receiving continue through the maintained engines.

Keep the selected recipe's original distribution, merchant source, buyer, publisher and runtime dependencies. Source selection and contribution composition stay in the existing distribution engine. The **workbooks** extra belongs to the original Python installation; it is selected in **Python & workbooks**.

The application provider is additive. It registers through original provider discovery and uses the existing review/save/start/stop lifecycle. No shared Applications dispatcher, Python command catalog or installer engine needs a separate implementation.
