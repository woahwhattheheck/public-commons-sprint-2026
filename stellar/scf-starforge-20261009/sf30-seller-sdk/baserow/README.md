# Baserow source and merchant workflow

Turn an existing Baserow table or shared grid into a reviewed, versioned data product. Keep the original field identities, source observations and file attachments with the operator, then use the existing dataset publisher, seller lifecycle and buyer receiving applications.

The [Baserow operator workspace](workspace/README.md) supplies the source-authoring and merchant front door. The commands below expose the same functions for an operator or agent. Public exports and customer use follow the operator's selected source rights and merchant terms.

## Operator journey

1. **Discover the source.** Read original field IDs, types, options and public-view metadata. Choose fields, source filters, ordering, null policy and attachment storage origins.
2. **Retain the complete source.** Capture every selected page and original file. Keep the metadata, original response bodies and hashes in a private directory, then freeze that exact capture.
3. **Review and publish.** Inspect the candidate's actual rows and query contract in the original publisher. Record the review and initialize or update the selected dataset version.
4. **Prepare the merchant.** Bind the published candidate to the actual origin, route and payment terms. The original seller console manages the retained release, readiness, activation, rollback and client handoff.
5. **Receive and reopen.** The original buyer reads the selected snapshot, approves its actual offer and saves the response. The attachment handoff carries the original files and their row/field references. Continue through the same retained publisher, release or buyer workspace.

Use Node 24 on Linux with util-linux flock. Private operator directories use mode 0700 and their regular files use 0600. The standalone publisher chooses a free loopback port and prints its private browser URL.

## Entry points

| Installed command | Source entry | Purpose |
| --- | --- | --- |
| baserow-source | cli.mjs | Discover, capture, inspect, import, freeze and export original files |
| baserow-publisher | publisher/cli.mjs | Original browser/CLI extraction, review, versions, schedules and buyer handoff |
| baserow-deployment | deployment-cli.mjs | Published candidate to merchant package and seller console |

From a checkout, invoke each file with Node. [index.mjs](index.mjs) exports the source, capture, publisher and deployment APIs for trusted adapters. These guides describe the shared controls:

- [Publisher](../postgres/publisher/README.md) and [retained schedules](../postgres/publisher/SCHEDULES.md).
- [Seller lifecycle](../../sf82-seller-pilot/README.md).
- [Buyer request collections](../../sf88-operator-buyer-cli/collections/README.md).
- [Complete buyer dataset receiving](../../sf100-buyer-dataset-delivery/README.md).

## 1. Select the original source

A declaration binds one source selection and one or more explicit query projections. The identifiers below demonstrate the declaration format; use IDs returned by discovery for the selected source.

Start a public-grid declaration with its original slug and empty queries:

~~~json
{
  "schema": "stellar-forge.baserow-source.v1",
  "server": "https://api.baserow.io",
  "kind": "public-grid",
  "slug": "ORIGINAL_SHARED_GRID_SLUG",
  "orderBy": [],
  "connection": {
    "kind": "rest",
    "pageSize": 100,
    "requestIntervalMs": 250,
    "timeoutMs": 600000
  },
  "attachments": { "mode": "metadata" },
  "queries": {}
}
~~~

~~~sh
node cli.mjs discover --source /private/project/source-draft.json
~~~

Discovery returns each field's original ID, row key, name, type and metadata, plus the original public view. A protected shared view can reference an already issued public-view authorization token through **connection.publicTokenEnv**.

A private table uses **kind: table**, its numeric **tableId**, an optional numeric **viewId**, and **connection.tokenEnv**:

~~~json
{
  "schema": "stellar-forge.baserow-source.v1",
  "server": "https://api.baserow.io",
  "kind": "table",
  "tableId": 123,
  "viewId": 456,
  "orderBy": [],
  "connection": {
    "kind": "rest",
    "tokenEnv": "BASEROW_READ_TOKEN",
    "pageSize": 100
  },
  "attachments": { "mode": "metadata" },
  "queries": {}
}
~~~

BASEROW_READ_TOKEN names the host's existing database token. Only its environment reference enters a retained plan. Database read permission supports the original fields and rows endpoints. Private view configuration endpoints use JWT authentication; this adapter carries the selected native view_id in the row request and uses the supported fields endpoint.

The API server can differ from the public website and can include a fixed reverse-proxy prefix. HTTPS is normal. Local loopback HTTP works for an existing local instance; a non-loopback HTTP server requires an explicit **connection.allowHttp: true**.

### Native routes and selection

| Operation | Shared public grid | Authorized table/view |
| --- | --- | --- |
| Metadata | /api/database/views/{slug}/public/info/ | /api/database/fields/table/{tableId}/, with optional view |
| Rows | /api/database/views/grid/{slug}/public/rows/ | /api/database/rows/table/{tableId}/ |
| Projection | include_fields=field_1,field_2 | include=field_1,field_2 |
| Selection | Original saved public filters plus explicit reviewed parameters | Optional view_id plus explicit reviewed parameters |
| Pagination used here | page and size | page and size |
| Credentials | Optional Baserow-View-Authorization | Authorization: Token … |

Public metadata deliberately replaces table, database and workspace IDs with zero. The original public slug remains the source identity.

**orderBy** contains objects such as **{ "field": 123, "direction": "asc" }**. Baserow adds its original order and id tie breakers. Public-view saved sortings are returned separately by discovery. Select them explicitly when that is the desired ordering; the original public handler applies explicit ordering when order_by is supplied.

**filters** accepts the original grouped filter_type, filters and nested groups structure, using numeric native field IDs. **search** is an optional original search string. Pagination follows the actual returned next URL while retaining the server, route, field set, filters, ordering and consecutive page numbers.

## 2. Choose values and files

Replace the empty queries object with the reviewed field projection:

~~~json
{
  "catalog": {
    "columns": {
      "record_id": {
        "source": "$recordId",
        "type": "string",
        "encoding": "identity-text"
      },
      "name": {
        "source": "field_101",
        "providerType": "text",
        "type": "string",
        "nullable": false
      },
      "price": {
        "source": "field_102",
        "providerType": "number",
        "type": "string",
        "nullable": true,
        "empty": "null"
      },
      "related": {
        "source": "field_103",
        "providerType": "link_row",
        "type": "string",
        "encoding": "json-text",
        "nullable": true
      },
      "files": {
        "source": "field_104",
        "providerType": "file",
        "type": "string",
        "encoding": "attachments",
        "nullable": true
      }
    }
  }
}
~~~

Select original field_N keys and their observed provider types. Display names can change or repeat without changing a field identity. The special $recordId and $order sources expose the original row ID and decimal ordering value.

| Encoding | Value and dataset type |
| --- | --- |
| native | Original string or boolean; explicitly reviewed safe Integer/Number value |
| identity-text | Original row ID or order as Text |
| number-text | Exact original JSON number token as Text |
| decimal-number | Explicit conversion of a decimal string when its value is exactly representable |
| json-text | Complete structured JSON as Text, including exact numeric tokens |
| select-value | The original single-select value string |
| attachments | Original file name, storage name, MIME type, source URL, received bytes and SHA-256 |

Baserow decimal strings stay strings by default. A numeric conversion that loses precision fails with BASEROW_NUMBER_PRECISION_LOSS. Related-row fields retain every original id, display value and decimal order because requests omit limit_linked_items. Multi-selects, formula/lookup objects and other structured fields can use explicit JSON text.

Null is separate from an empty string. A nullable dataset column uses an empty CSV cell for null. Select **"empty": "null"** to map source empty strings to that policy, or a non-nullable Text column to preserve empty strings. Original pages retain the source values.

To retain full original files, set the attachments object to:

~~~json
{
  "mode": "retain",
  "allowedOrigins": ["https://ORIGINAL-STORAGE-HOST"],
  "maxFileBytes": 33554432,
  "maxFiles": 10000
}
~~~

Use the observed origins of original file URLs. Each file is fetched from the returned url, including its existing query parameters. API credentials stay on the selected API route. File downloads and permitted storage redirects use the reviewed storage origins without those credentials. The capture retains the original URL, response information, size, hash and every row/field/index reference. Thumbnails remain metadata; the received payload is the original file.

Metadata mode retains original file metadata in the row pages. Retain mode completes after every selected original file has been received and its size matches the source metadata.

## 3. Capture, freeze and reopen

~~~sh
node cli.mjs capture --source /private/project/source.json --out /private/project/capture-001
node cli.mjs freeze --source /private/project/source.json --capture /private/project/capture-001/capture.json --out /private/project/frozen-source.json
node cli.mjs inspect --source /private/project/frozen-source.json
~~~

The capture contains opening metadata, all row pages, a closing first-page observation, closing metadata and selected file bodies. Completion requires stable schema, consistent per-page counts, unique original row IDs, full row coverage and unchanged first-page row order. Every retained payload has its original response descriptor, byte count and SHA-256.

This is an observed paginated read of a live service. The capture records atomicSourceSnapshot as false and its actual start/end times. Changes affecting the checked schema, counts or initial row order stop completion while preserving received files and the error. Size, row, page and time limits keep partial results out of publication. Rate-limit failures retain the actual status, request ID and retry information for the operator.

Import a complete source or export its original file handoff:

~~~sh
node cli.mjs import --source /private/project/source.json --capture /private/received/capture.json --out /private/project/imported-capture
node cli.mjs attachments --capture /private/project/capture-001/capture.json --out /private/project/customer-files
~~~

The file handoff contains original binary files and attachments.json, binding each hash to its original capture and row references. Import and reopen recheck all retained payloads and the selected source.

## 4. Review and publish

Open the original browser workflow:

~~~sh
node publisher/cli.mjs serve --workspace /private/project/publisher --create --source /private/project/frozen-source.json --state /private/project/dataset
~~~

Choose the named query, dataset types, filters, sorts, extraction limits and row ordering. Inspect the actual candidate, record its review and publish to the chosen version store. The terminal and browser share the same original publisher; stop the browser before opening that workspace from another process.

The corresponding terminal path is:

~~~sh
node publisher/cli.mjs init --workspace /private/project/publisher --source /private/project/frozen-source.json --state /private/project/dataset
node publisher/cli.mjs template --workspace /private/project/publisher --query catalog --out /private/project/plan.json
node publisher/cli.mjs save --workspace /private/project/publisher --input /private/project/plan.json
node publisher/cli.mjs extract --workspace /private/project/publisher --plan 1
node publisher/cli.mjs inspect --workspace /private/project/publisher --run ORIGINAL_RUN_ID
node publisher/cli.mjs review --workspace /private/project/publisher --run ORIGINAL_RUN_ID --reviewer OPERATOR --note REVIEW_NOTE --initialize
node publisher/cli.mjs publish --workspace /private/project/publisher --run ORIGINAL_RUN_ID --review ORIGINAL_REVIEW_ID
~~~

Edit the generated plan to the source's actual types and desired query contract before saving. Its source hash binds that review to the exact private declaration. A frozen plan receives its own complete capture copy. The original workspace retains extraction candidates, reviews and publication history.

For an existing live target, review its actual expected snapshot and revision. Use the original recover action and retained run ID after restart. The shared schedule guide describes recurring extraction, explicit publication policy and target reconciliation.

## 5. Prepare the merchant and customer handoff

Create the private terms file from the operator's actual origin, path and payment configuration:

~~~sh
node deployment-cli.mjs review --publisher /private/project/publisher --run ORIGINAL_RUN_ID --terms /private/project/merchant-terms.json
node deployment-cli.mjs prepare --publisher /private/project/publisher --run ORIGINAL_RUN_ID --terms /private/project/merchant-terms.json --review REVIEW_SHA256 --out /private/project/merchant-package
node deployment-cli.mjs inspect --package /private/project/merchant-package
node deployment-cli.mjs stage --package /private/project/merchant-package --store /private/project/releases --id catalog-v1 --source PACKAGE_SOURCE_SHA256
node deployment-cli.mjs console --store /private/project/releases --client-exports /private/project/clients
~~~

Preparation reopens the original capture and published candidate, verifies the selected review and terms, and creates the original five-file dataset package. The release binds the actual host-local version store and baseline snapshot. Identical package requests recover the same bytes; the original release ID remains bound to its source and runtime.

The original console starts and activates the release and prepares the client handoff. The merchant route serves the selected dataset's JSON pages, including reviewed structured fields and attachment descriptors. The retained attachment export supplies the original-file handoff for the customer packet.

For a running seller, the publisher buyer action reads its current offer for the selected snapshot. The original buyer configuration, request collections and dataset receiving applications retain that offer, per-request approval, saved response and reopenable job. The existing engine handles later pages and transaction recovery.

## Original public-source journey

[examples/public-catalog.mjs](examples/public-catalog.mjs) runs against Baserow's own [public software catalog](https://baserow.io/public/grid/4si6SNrY_T9_ENsCPjjSr2LDynTxbDh7OkvLkQorPY8). It discovers the current original field IDs/types, explicitly selects the public sortings, retains every page and original file, publishes a private reviewed dataset, reopens the publication, and exports and rechecks the same file bytes.

~~~sh
node examples/public-catalog.mjs --out /private/native/baserow-catalog --source-ref EXACT_CHECKOUT_SHA
~~~

The example uses the storage origin observed in the actual public catalog. Supply repeated --attachment-origin values for any newly observed original storage origins. Reuse an already received complete source with --capture ORIGINAL_CAPTURE.json. Supply --terms ORIGINAL_PRIVATE_MERCHANT_TERMS.json to also prepare and stage the original merchant package; --runtime carries its existing runtime configuration.

The directory retains native-result.json, the original source capture, publisher, version store, customer preview and original customer files. The result records the actual row/page/file counts, source and CSV hashes, snapshot, retained run ID and reopen result, including the phases completed by that invocation.

## Maintained primary contracts

Routes and native serializers were read from the original Baserow source at commit **ae95e512e1675db6cb1b73e8ac2266b9369b4061**:

- [Public grid endpoint](https://github.com/baserow/baserow/blob/ae95e512e1675db6cb1b73e8ac2266b9369b4061/backend/src/baserow/contrib/database/api/views/grid/views.py) and [public view handler](https://github.com/baserow/baserow/blob/ae95e512e1675db6cb1b73e8ac2266b9369b4061/backend/src/baserow/contrib/database/views/handler.py).
- [Public metadata serializers](https://github.com/baserow/baserow/blob/ae95e512e1675db6cb1b73e8ac2266b9369b4061/backend/src/baserow/contrib/database/api/views/serializers.py).
- [Authorized fields](https://github.com/baserow/baserow/blob/ae95e512e1675db6cb1b73e8ac2266b9369b4061/backend/src/baserow/contrib/database/api/fields/views.py) and [authorized rows](https://github.com/baserow/baserow/blob/ae95e512e1675db6cb1b73e8ac2266b9369b4061/backend/src/baserow/contrib/database/api/rows/views.py).
- [Structured values and file serializer](https://github.com/baserow/baserow/blob/ae95e512e1675db6cb1b73e8ac2266b9369b4061/backend/src/baserow/contrib/database/api/fields/serializers.py) and [native ordering](https://github.com/baserow/baserow/blob/ae95e512e1675db6cb1b73e8ac2266b9369b4061/backend/src/baserow/contrib/database/table/models.py).
