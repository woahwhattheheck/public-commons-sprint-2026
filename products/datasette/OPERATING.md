# Operate Datasette source editions

Use one private original workspace for the browser, CLI and agent connection. The source capture, immutable editions, publisher plans and dataset target belong to that workspace. The connection file points clients to its current local listener.

## Create, open and manage the application

Create the workspace with the original command, then open its printed URL:

~~~sh
starforge datasette serve \
  --directory /absolute/private/datasette-workspace --create \
  --connection-file /absolute/private/datasette-workspace/connection.json \
  --port 0
~~~

Normal reopening uses the same directory without changing the workspace declaration. To keep the browser's saved operation history available after restart, select and retain one explicit local port, such as 53173, in both the datasette serve --port command and the managed application's Local port field. Browser storage belongs to the listener origin; port 0 may choose a different origin on each start. The connection file and native workspace retain their original identities when the port changes. CLI reads through the live connection avoid opening another owner:

~~~sh
starforge datasette status \
  --url-file /absolute/private/datasette-workspace/connection.json

starforge datasette operations \
  --url-file /absolute/private/datasette-workspace/connection.json
~~~

In Runtime workspace, attach the installed READY runtime and select **Applications → Datasette source and dataset publisher**.

| Application field | Original input |
| --- | --- |
| Original Datasette workspace | The existing private directory created by the Datasette command |
| Private connection file | The original listener record; defaults to connection.json inside that workspace |
| Local port | 0 chooses an available loopback port |
| Private environment JSON | Existing host environment settings used by the original native services |

Review and save the application, then Start and Open. The source-owned launcher reuses the original Datasette CLI after checking the reviewed immutable workspace declaration. A restart updates the same connection file. Changing the directory or declaration requires a current application review.

The **Datasette customer Analysis** application is included beside the publisher. Select it when continuing the received edition into the original customer database, saved queries, reports and workbook.

## Capture a source

Enter the exact JSON endpoint, including the desired filters, page size and source options. Choose Table or Read-only query and retain the original database/table or query name.

The supported response is a JSON object containing rows, with declared columns or an explicitly retained column declaration. When pages omit their columns field, enter **Ordered original column names** as a JSON array in the exact returned order. **Use WRI geothermal source** supplies its verified 26 positions. Reusing a retained selection keeps its original column order and source options. The native parser accepts row arrays and row objects. The source's opaque next_url or HTTP Link continuation is followed as supplied, including its real request/response metadata. Additional origins must be deliberately listed in the selection.

Use **Capture complete source** to retain a new capture. The original operation UUID is stored before the browser sends the request. A subsequent source refresh creates a distinct capture. **Resume original capture** uses that capture's original UUID and selection.

The browser's attribution fields carry the selected source title, organization, original URL, license and about URL. Keep the actual publisher metadata with the source. Private source acquisition can also arrive as original complete HTTP page records through the maintained source.adopt operation.

The full capture is available through the same operation API:

~~~json
{
  "operationId": "RETAINED_CAPTURE_UUID",
  "selection": {
    "url": "https://datasette.io/global-power-plants/global-power-plants.json?primary_fuel=Geothermal&_shape=arrays&_size=50",
    "kind": "table",
    "database": "global-power-plants",
    "table": "global-power-plants",
    "continuation": "auto",
    "approvedOrigins": ["https://datasette.io"],
    "columns": ["rowid","country","country_long","name","gppd_idnr","capacity_mw","latitude","longitude","primary_fuel","other_fuel1","other_fuel2","other_fuel3","commissioning_year","owner","source","url","geolocation_source","wepp_id","year_of_capacity_data","generation_gwh_2013","generation_gwh_2014","generation_gwh_2015","generation_gwh_2016","generation_gwh_2017","generation_data_source","estimated_generation_gwh"],
    "metadata": {
      "title": "Global Power Plant Database",
      "source": "World Resources Institute",
      "source_url": "http://www.wri.org/publication/global-power-plant-database",
      "license": "CC Attribution 4.0 License",
      "license_url": "https://creativecommons.org/licenses/by/4.0/",
      "about_url": "https://github.com/simonw/global-power-plants-datasette"
    }
  }
}
~~~

Save the complete object privately, replacing the operation identifier with one actual UUID, and run:

~~~sh
starforge datasette \
  --url-file /absolute/private/datasette-workspace/connection.json \
  --operation source.capture --input-file /absolute/private/capture.json
~~~

Read a completed capture with source.inspect and its operationId. Rows use explicit cell types and exact source text. Original numeric tokens do not pass through browser floating-point conversion.

## Review fields and source identity

Open a completed capture. **Original source rows** shows the retained values and source types with paged navigation. **Original HTTP pages and retained files** exposes response metadata and exact original body downloads. The source observation window uses the retained retrieval bounds when exact request start/end times are unavailable. Each page displays its known HTTP status or original file-import provider receipt.

Each published field has an original column, safe published name, type, representation and nullability:

| Representation | Preserved meaning |
| --- | --- |
| Source value | The original scalar value, or the underlying value of a Datasette labeled value |
| Exact JSON text | Exact strings, numeric tokens, null and structured values encoded as source JSON text |
| Source label | The explicitly selected label of a labeled source value |

Published names begin with a letter and contain up to 48 letters, digits or underscores. Choose distinct names. Exact JSON text uses a non-nullable string, preserving null as the JSON token and a blank string as its quoted JSON representation. A source with both null and blank values receives an appropriate explicit representation.

The suggested projection comes from every retained source row. Large integers, decimal values that cannot round-trip through the native numeric type, mixed types and structured values retain exact text where required.

Select an original cross-edition business key when one exists. The full review reports null, blank and duplicate keys. A rowid is a locator in its database edition; it does not establish business identity between editions.

Use **Review complete source**, inspect the results, then supply a stable edition identifier and useful name. **Save reviewed source edition** retains the complete capture and exact review together. A saved edition's source and review are immutable.

## Compare editions

Choose two retained editions. The comparison uses the reviewed source key when the complete key is compatible and unique. Otherwise it compares the complete source rows.

The result separately shows changed row values, added/removed rows, column/schema changes, field projection changes, source selection, source metadata, source version and row ordering. Original HTTP body identity is distinct from unchanged source values. Use **Save complete comparison** to retain the entire original difference result.

## Publish the dataset

Select a named source edition for the publisher. The browser sends the observed current selection hash with that change. Replaying a saved selection request returns its original outcome.

Enter a plan title and query name. The default query is data. Source input, dataset configuration and extraction configuration are editable in the plan's detailed section; an empty dataset configuration uses the original native defaults. All reviewed columns remain in the dataset while the advertised filters, sorts and numeric ranges fit the original query contract.

**Save source-bound plan** retains the original edition, projection, source hash and native plan. Select that saved plan and **Extract selected plan**. The original extraction UUID identifies the resulting candidate across interruptions.

Open the run, inspect its exact candidate and query preview, and **Read current dataset target**. For a first publication, select initialization of the empty target. For a refresh, start the original dataset seller against that same target and read its actual snapshot and revision.

Record the reviewer and substantive publication note. The native review binds the exact candidate and current target. **Publish reviewed candidate** uses that saved review identifier. The original version store returns the published snapshot and revision. The browser follows the saved run state: PUBLISHED identifies a completed publication; READY after a publication attempt displays its recorded refusal, and PUBLICATION_UNKNOWN remains available for reconciliation.

If a response ends during extraction or publication, **Reconcile original run** reopens that same run. The retained plan, candidate, publication review and native dataset store determine its outcome.

## Release and customer handoff

Choose the original published run. In **Complete merchant release**, enter the actual public origin, dataset route and original seller payment configuration. The optional output directory selects the prepared release location.

**Prepare complete release** gathers the original dataset, source edition, HTTP pages, plan, extraction and publication review. **Stage in merchant release store** uses the original SF82 release writer and selected runtime configuration. The returned release directory and identifier are inputs to the maintained releases command and release console.

~~~sh
starforge releases --help
~~~

For a live buyer handoff, the workspace must retain the original seller endpoint and resource binding. Read the offer for the selected run and query, choose one actual offered payment option, and supply the original customer intent identifier. **Prepare buyer configuration** retains and downloads that configuration through the original buyer handoff implementation.

Continue the published dataset in the installed buyer and customer Analysis applications. Their original query, report, workbook, database and receiving operations remain part of the complete installed selection.


## Prepare an editable customer analysis

The installed product supplies two applications around the same reviewed source: the Datasette source/publisher workspace and **Datasette customer Analysis**. The customer's Analysis directory is a separate original analytical workspace. Source publication keeps its native publisher history; customer edits, saved SQL, reports and workbook jobs are retained in the Analysis database.

Select Node 24 for the Datasette native source and edition reader. In the Runtime workspace's **Python & workbooks** view, select Python 3.11 or newer and the original **workbooks** extra, resolve and retain the exact wheels, then install offline. The original Python package selects openpyxl 3.1.5. Retain the resulting Python installation ID and select it in **Applications → Datasette customer Analysis**, together with the customer directory and one stable 32-character lowercase hexadecimal operation ID.

The [complete installed customer guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/datasette-analysis/INSTALLATION.md) gives the managed application fields and native installed command. The [customer operator and typed Python client](../../stellar/scf-starforge-20261009/sf30-seller-sdk/datasette-analysis/README.md) use the same running Analysis workspace.

### Receive the publisher's named edition

Read the named edition through editions.inspect or editions.list and retain its returned editionFile and editionSha256. For a source on another host, receive its complete original source package first. Every page, capture, review and original edition member must remain beside that edition file.

Save this handover as a private JSON file, using those exact returned values:

~~~json
{
  "schema": "stellar-forge.datasette-analysis-handover.v1",
  "delivery": {
    "kind": "native-edition",
    "edition": "/absolute/private/datasette-workspace/editions/ORIGINAL_EDITION_ID/edition.json",
    "sha256": "ORIGINAL_EDITION_SHA256"
  }
}
~~~

Open **Datasette customer Analysis**, enter the absolute handover path and prepare it with a short Analysis name, such as geothermal. A JSON file can use paths relative to its own directory; pasted JSON uses absolute host paths. The original edition reader checks the declared hash and every source member, consumes the reviewed published projection and imports the complete result through the maintained Analysis engine.

The customer's edition screen keeps the original source column names, reviewed projection, source observation window and edition identity. Original HTTP responses, source review and exact scalar spellings remain downloadable with the imported analytical version. A later capture or deliberate revised projection becomes a separate prepared edition.

### Continue the retained WRI source

The installed source includes the original compressed source edition:

stellar/scf-starforge-20261009/sf30-seller-sdk/datasette/sources/wri-geothermal-20261012/wri-geothermal.sfds.gz

Its complete archive SHA-256 is:

53f2486406d61f18c9e1c9ceaac659c265bbad7afe2fe54b1a17f43307cb0ca0

Use the sourceRoot reported by the original runtime inspection to locate that file. Save the following private source.receive input with its actual absolute archive path:

~~~json
{
  "archiveFile": "/absolute/installed-source/stellar/scf-starforge-20261009/sf30-seller-sdk/datasette/sources/wri-geothermal-20261012/wri-geothermal.sfds.gz",
  "sha256": "53f2486406d61f18c9e1c9ceaac659c265bbad7afe2fe54b1a17f43307cb0ca0",
  "id": "wri-geothermal"
}
~~~

For the running source workspace, receive it through its original owner:

~~~sh
starforge datasette \
  --url-file /absolute/private/datasette-workspace/connection.json \
  --operation source.receive --input-file /absolute/private/receive-wri.json

starforge datasette \
  --url-file /absolute/private/datasette-workspace/connection.json \
  --operation editions.inspect \
  --input '{"id":"wri-geothermal","offset":0,"limit":250}'
~~~

Use that returned editionFile and editionSha256 in the customer handover. The retained edition contains 189 records, 25 physical source fields plus the rowid locator in 26 returned positions, four original response pages and 22 countries. Its disclosed capacity totals 12,563.55 MW; 65 records are for the USA. Capacity and generation observations retain their historical years, and 110 records have no stated capacity-data year. The original WRI attribution and CC Attribution 4.0 metadata accompany the complete source.

This same workflow accepts a different complete named edition. Keep its actual row count, key review, projection, numeric representation and source years. The current HTTP capture action produces a new observation from the endpoint's current data; the committed package reopens its retained original edition.

### Edit, deliver and reopen the customer's work

Inspect the prepared edition's complete rows and saved reports. Use **Original Analysis** to open the maintained query, report and workbook tools in the same process. Save and run a useful customer query, such as a selection by country, and retain its native result and report.

A workspace export snapshots the current customer database, source editions, query results, reports and workbook files. Prepare a fresh export after customer changes. Each newly submitted export has its own export_id; continuing the same request reuses that original archive generation. The export's file descriptors identify which complete archive and manifest to download.

On the receiving host, use the original customer receive command with the full archive, returned SHA-256 and a stable receiving-operation ID, choosing an absent private destination. Reopen **Datasette customer Analysis** against the received directory with the original customer Analysis operation ID and a compatible installed Python/workbooks environment. The saved queries and workbook remain editable, and further exports carry subsequent customer work.

The [original receive and reopen procedure](../../stellar/scf-starforge-20261009/sf30-seller-sdk/datasette-analysis/README.md#receive-and-reopen-the-original-workspace) includes exact CLI inputs. The source/publisher ZIP and the customer's Analysis ZIP keep their respective original archive engines and stores; deliver each workspace the receiving engineer is continuing.

## Agent and typed-client access

Create a private original connection file:

~~~json
{
  "schema": "stellar-forge.datasette-workspace-connection.v1",
  "workspaces": {
    "energy": {
      "label": "Energy source editions",
      "urlFile": "/absolute/private/datasette-workspace/connection.json",
      "expectedWorkspaceId": "ORIGINAL_WORKSPACE_UUID"
    }
  }
}
~~~

The existing merchant host's datasetteWorkspaceConnection input points to that file. Its installed provider resolves datasetteWorkspaces and exposes the same original health, status, operation, retained-file and complete receiving workflows.

Start with merchant_datasette_workspaces, merchant_datasette_health and merchant_datasette_operations. Domain calls select the configured workspace alias and complete operation input. Keep the original request/capture/run/review identifiers when continuing a write.

The installed datasette-mcp command and typed merchant client cover complete remote source/whole-workspace exports and receiving. See the [full original merchant guide](../../stellar-forge/mcp-merchant-operator/DATASETTE_WORKSPACES.md) for exact calls and private host configuration.

Direct application clients import ./seller/datasette/client from the selected package. They connect using the original URL and expectedWorkspaceId. The same API provides status(), operations(), dispatch(), uploadStatus() and uploadChunk().

## Continue after interruption

**Activity** retains publisher history and saved browser operations. **Read current outcome** checks the original native request, capture, run or received edition. **Continue original input** sends that saved input with its original identifier.

Source selection, plan, candidate review and buyer preparation retain requestId values. Capture, extraction, edition, export, archive and upload operations also retain their original domain identifiers. The browser does not silently replay a failed write.

For an interrupted upload, **Read current outcome** reopens its original upload UUID and verified prefix. Select the same archive when bytes remain to upload. Once all bytes are retained, **Continue original input** completes or reopens receiving from that saved archive without requiring the file to be selected again. The archive SHA, path and receiving destination remain in one browser operation until receiving completes. The source edition receiver reopens the reviewed edition; the source/publisher workspace receiver restores its own ZIP and original directory. Customer Analysis archives continue through the separate original Analysis receiver. See [Installation and receiving](RECEIVING.md).

Stop through Applications or the foreground command's normal signal handling. Reopen the same original directory and private connection file to continue retained work.
