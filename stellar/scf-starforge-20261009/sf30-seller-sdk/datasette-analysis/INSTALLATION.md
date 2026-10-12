# Installed Datasette customer Analysis

The **Datasette customer Analysis** application opens the complete customer workspace from the merchant runtime's existing Applications pane. It uses the installed original Python package with workbook support, the source release selected by that runtime, and the same Analysis database used by queries, reports, workbooks and whole-workspace receiving.

The source and publisher desk produces reviewed Datasette editions. This application receives that selected source, keeps its original fields and edition history, and prepares editable customer analysis. The operator's **Original Analysis** link opens saved queries, reports and workbook tools in the same process and database.

## Install and open

Start the existing runtime workspace:

~~~sh
starforge runtime-workspace serve --workspace /srv/starforge/operator --port 8465
~~~

Select the complete Datasette merchant runtime in the sidebar. Its original source release must include the Datasette publisher and customer Analysis contributions together.

1. Open **Python & workbooks**. Select a Python 3.11 or newer executable and the **workbooks** extra.
2. Use **Review source and interpreter**, **Resolve and retain exact wheels**, then **Install offline**. Keep the returned Python installation ID. The maintained original pyproject selects openpyxl 3.1.5.
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

Arguments after the separator are the existing cli.py interface: serve, status, prepare, rows, compare, export, call, request, download and receive. Add --connect for operations against an already running operator. Keep request IDs when recovering a submitted action. The Python SDK uses DatasetteOperatorClient.from_workspace(...) for that same connection. See [README.md](README.md) for complete action and download examples.

For a direct source checkout, the original command remains available:

~~~sh
/absolute/path/to/workbook-python \
  stellar/scf-starforge-20261009/sf30-seller-sdk/datasette-analysis/cli.py serve \
  --workspace /srv/starforge/customer/analysis \
  --operation-id ORIGINAL_32_HEX_ANALYSIS_OPERATION_ID \
  --checkout /absolute/path/to/complete/source \
  --node /absolute/path/to/node
~~~

## Receiving and reopening

The customer workspace travels through the original Analysis archive and restore_archive receiver. The operator's complete export includes the source editions, original retained response files, queries, reports, workbooks and saved operation state.

Use the receive command described in [README.md](README.md), select an absent receiving directory and preserve the archive's SHA-256 and receiving operation ID. Then open **Datasette customer Analysis** for the restored directory with its original Analysis operation ID. The original reports and workbook files remain downloadable, and saved queries remain editable.

For another host, receive the matching merchant source and Node runtime through the existing **Offline transfers** workflow. In **Python & workbooks**, export the exact wheel bundle, receive it on a compatible host and install it offline. Select that receiving installation for the restored customer application. [The original Python workspace guide](../../distribution/python-runtime/WORKSPACE.md) documents these controls and their existing CLI operations.

Each new workspace export gets a distinct generation. The same export request ID reuses its original archive; a fresh export after a customer edit snapshots the current original workspace. Download descriptors carry that export ID so earlier deliveries remain selectable. The --export-id download option and typed Python client accept the same generation.

## Source selection and integration

The additive declaration is distribution/contributions/datasette-analysis.json. Add **datasette-analysis** to the existing Datasette source selection's contributions array beside its source/publisher contribution. The declaration carries:

- The complete sf30-seller-sdk/datasette-analysis source, operator assets, typed Python client, example handovers and receiving launcher.
- The original sf88-operator-buyer-cli component, including the complete Python package, pyproject, package data and Node bridge files.
- The original distribution/python-runtime component.
- The source-owned Applications adapter and provider.
- The datasette-analysis native command and its Node export.

Keep the selected recipe's original distribution, merchant source, buyer, publisher and runtime dependencies. Source selection and contribution composition stay in the existing distribution engine. The **workbooks** extra belongs to the original Python installation; it is selected in **Python & workbooks**.

The application provider is additive. It registers through original provider discovery and uses the existing review/save/start/stop lifecycle. No shared Applications dispatcher, Python command catalog or installer engine needs a separate implementation.
