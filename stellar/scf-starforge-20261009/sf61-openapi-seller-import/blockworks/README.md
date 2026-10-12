# Messari to Blockworks migration workspace

**Migrations** is part of the original API merchant workspace. A saved project carries its provider descriptions, application requests, acquired responses, semantic mapping, result comparisons, merchant packages and release selection into a receiving team's workspace.

## Start and reopen

Follow the [API merchant workspace installation](../workspace/README.md#start), then launch that same workspace with a private project parent:

~~~sh
mkdir -m 700 /tmp/my-migration-projects
node stellar/scf-starforge-20261009/sf61-openapi-seller-import/workspace/server.mjs \
  --out-parent /tmp/my-migration-projects --port 0
~~~

Open the complete URL printed by the launcher and choose **Migrations**. Enter the operator responsible for saved changes, then create or reopen a project. Reuse this private parent to continue its source editions, captures, receiving runs and release selection.

The merchant workspace, contract revision desk, Postman intake and migration view share the original application. **Use in merchant setup** opens the selected retained provider description in the existing merchant configuration interface.

## Use the installed Node package

The same application and engines are available from the maintained `@tokenjunkielabs/starforge-merchant` source package. The [distribution guide](../../distribution/README.md) describes installation and the original `starforge openapi-workspace` command.

| Package subpath | Original API |
| --- | --- |
| `/seller/openapi/workspace` | `startWorkspace` opens the complete merchant browser application, including Migrations. |
| `/seller/openapi/blockworks` | `openMigrationApplication` opens the project, acquisition, mapping, release and handover services. |
| `/seller/openapi/blockworks/acquisition` | `openAcquisitions` retains and resumes the original provider request. |
| `/seller/openapi/blockworks/mapping` | `reviewMapping` and `compareMappedResults` use the selected original source populations. |
| `/seller/openapi/blockworks/customer` | `openCustomerReceiver` and `legacyCaptureSource` compose original receiving and retained response selection. |
| `/seller/openapi/blockworks/handover` | `openMigrationHandovers` and `restoreMigrationHandover` use the complete original closure. |

A Node owner can open an existing project and await all of its owned operations when closing:

~~~js
import {openMigrationApplication} from
  '@tokenjunkielabs/starforge-merchant/seller/openapi/blockworks';

const migration = await openMigrationApplication({parent: privateProjectParent});
try {
  const current = await migration.snapshot(existingProjectId);
  // Present the retained sources, acquisitions, packages and release state.
} finally {
  await migration.close();
}
~~~

The application methods use the same project revision, operator and request identity as the browser. Pass those current values for a mutation. Use the original workspace starter when a browser session is needed; the underlying application does not introduce another HTTP or payment interface.

## Retain the source and application inventory

Import the original Blockworks OpenAPI as **Blockworks OpenAPI**, the existing provider contract as **Legacy OpenAPI**, and the application's requests as an inventory. Keep the original source URL, retrieval time and reference when available. For a saved customer response, retain its recorded HTTP status, request, headers and paging metadata. File exports can retain an unknown HTTP status.

The inventory connects a stable request ID and provider path to the application feature that uses it. It can be entered through **Add a request** or imported as:

~~~json
{
  "schema": "stellar-forge.blockworks-inventory.v1",
  "requests": [
    {
      "id": "asset-list",
      "feature": "The application's asset selector",
      "family": "assets",
      "method": "GET",
      "path": "/metrics/v2/assets"
    }
  ]
}
~~~

Each retained source keeps its original bytes and a content identity. Browser intake decodes UTF-8 strictly and preserves an original byte-order mark. Selecting another provider source creates a project edition; the preceding editions remain available through **Edition history**.

## Review the provider's actual model and identity

Use the original [Blockworks provider description](https://docs.blockworks.com/api-reference/data-api/openapi.json) and returned catalog to select the operation. These family relationships identify the review to perform:

| Existing family | Blockworks selection | Identity decision |
| --- | --- | --- |
| Assets | `/query/tabular/assets` and the selected asset timeseries model | Retain the returned canonical asset identifier and the original application's identifier mapping. |
| Networks | `/query/tabular/blockchains` and the selected blockchain timeseries model | Retain the returned network identity and its relationship to the selected series. |
| Stablecoins | `/query/tabular/stablecoin-products` and the selected stablecoin timeseries model | Review product grouping and individual token identity separately. A product and one of its tokens have different meanings. |

Catalogs describe the available models and their access requirements. Supply the credential environment reference appropriate to the actual selected data model. The key itself stays in the launch environment. A catalog query's `publicOnly` selection describes the catalog population; model permission metadata remains part of the source review.

For timeseries, retain the actual returned point schema, its field order, time encoding, units, entity and granularity. The selected start is inclusive and the end is exclusive. The acquisition guide covers provider paging, response shapes and exact native request handling.

## Acquire, import and resume

In **Acquisition**, choose a stable acquisition ID, provider path, exact query parameters, data role and selection note. **Prepare request** retains the selection. **Prepare and acquire** executes the original native acquisition.

For example, discovery of the provider's timeseries models uses:

~~~text
GET /query/timeseries/catalog
{"publicOnly":true}
~~~

Lists retain their original pages and reported totals. Timeseries retain the selected window and the provider's actual point schema. The acquisition view keeps HTTP status, response headers, capture time, original bytes, source identity and completion state together.

Use **Pause** and **Run / resume** on the saved acquisition to continue the same request. The original implementation owns pending-response recovery, retry timing and duplicate capture handling.

**Import an existing native response** accepts the exact response file, original URL, HTTP status, capture time, headers and collector reference for a prepared request. It verifies that response against the selected native cursor. This is useful when a customer's existing collector has already fetched the data.

See [Acquisition and original response handling](ACQUISITION.md) for the programmatic interface and retained store.

## Map and compare the selected responses

In **Mapping**, select the exact baseline and candidate acquisition or imported response file. Imported files use an explicit layout selection. Common original Messari JSON layouts are:

| Original response | Layout selection |
| --- | --- |
| Asset list | `rowsPointer: "/data"` |
| Network or stablecoin list | `rowsPointer: "/data/data"` |
| Single timeseries | `pointsPointer: "/data/points"`, `pointSchemaPointer: "/metadata/pointSchemas"`, `descriptorKey: "slug"` |

Verify these pointers against the actual retained response. For a timeseries also select its original series key and entity. In a multi-series document, entry-relative pointers select each series while the point-schema pointer remains relative to the document root.

CSV uses the original delimiter and an explicit `csv.header` flag. A file without a header supplies its declared `csv.columns`. CSV text, empty fields, JSON nulls and absent fields retain their original distinctions.

Define:

- **Keys:** the entity, dimension and time fields used to align records.
- **Measures:** the original baseline and candidate selectors and an explicit `numeric` or `scalar` interpretation.
- **Units and dimensions:** the meanings carried by each selected value.
- **Conversions and tolerances:** the reviewed factor, offset, absolute tolerance and relative tolerance.
- **Time window:** the actual UTC interval to compare.
- **Decisions:** the reviewer, time, reference and reason for an accepted identity or meaning change.

Numeric comparison retains exact decimal values. Candidate conversion is `candidate × factor + offset`; tolerance is `absolute + relative × abs(baseline)`. Scalar comparison preserves primitive types and values, so the string `"0001"`, string `"1"` and number `1` remain distinct. Scalars use identity conversion, zero tolerance and no numeric unit.

**Save mapping**, **Review saved mapping**, then **Compare results**. The review binds the mapping to the actual source editions, captures, coverage and selected population. A whole-export declaration records an operator's actual complete export; native response totals remain the recorded provider totals.

### Inspect the complete result

**Results** shows the full retained population, including matched, changed and one-sided records. Search, status filters, measure selection and display paging change the view. Full comparison export retains every original comparison record.

Open a record's source details to inspect its original field values, calculations, identity decisions and capture location. **Open original capture** resolves the capture saved in that comparison and verifies its retained file identity. Later mapping edits do not redirect an earlier comparison to a different source.

Ordinary imported sources retain the project's 8 MiB source limit. Generated comparisons use a separate compressed store with a 128 MiB decoded limit and a 32 MiB stored limit. Reading or downloading a comparison verifies and returns the complete original JSON.

## Update the existing merchant and operate releases

Create or reopen the original merchant in the existing merchant setup interface. The saved baseline retains its public routes, backend configuration, commercial settings and request examples.

In **Release**:

1. Select that original saved merchant.
2. Review explicit operation mappings and settings against the retained replacement provider contract.
3. Export the reviewed merchant under a new package name.
4. Stage the package as a release.
5. Open its difference against the current selection.
6. Select the reviewed release and start its original runtime.
7. Stop the owned release or review and select a preceding release for rollback.

The original source-refresh and release implementations keep route identity and reviewed commercial settings with their actual provider binding. Review changed query serialization, response representation, authentication references and stablecoin product/token meaning as part of that update.

An unpaid route check exercises the original merchant's payment challenge. The receiving application handles an authorized paid operation through its existing offer review and runbook.

## Use the receiving application

**Receiving → Open receiving workspace** opens the original customer runbook application for this project. Its request intake, offer and budget review, run preparation, execution, recovery, saved downloads, accounting and backup remain available there.

After a response is saved, enter its original run ID, operation ID and actual response layout in **Use a saved receiving result**. **Retain verified response for mapping** reads the original saved resource, checks its identity, and retains that same body as a selectable comparison source.

Closing the receiving view retains its saved runs. Reopen it to continue an existing operation. See [Customer receiving and integration](CUSTOMER.md) for the original Node interface and resource lifecycle.

## Hand over and reopen the workspace

In **Handover**, enter a stable name, the receiving team and an operating note. Include the selected scope, required provider access, release selection and responsibilities that the receiving team needs.

The portable archive contains:

- The recorded project edition and its preceding history.
- Original retained sources, mappings and complete comparisons.
- Original acquisition exports and captured responses.
- The selected baseline and updated merchant packages.
- Immutable release files and the recorded release selection.

The handover retains the native acquisition export's actual paths and manifest identity. Selected original customer report exports can be included by the programmatic interface. Receiving credentials and private configuration stay with the operator.

Download the archive from the saved handover list. In the receiving team's original merchant workspace, use **Receive a handover**, choose a new workspace name and import the original archive. The binary upload supports the full 32 MiB compressed archive limit.

Import verifies the file set and reopens the original project, acquisition, merchant and release readers before publishing the received workspace. It then opens that workspace's complete merchant application at the recorded migration project. Its **Received workspaces** entry reopens the same imported workspace later.

The import opens the management interface. Provider acquisition, seller startup and receiving execution remain explicit operating actions. Previous handover archives are excluded from recursive packaging; their recorded history entries remain in the project.

## Original components

| Module | Responsibility |
| --- | --- |
| `application.mjs` / `routes.mjs` | Project orchestration and authenticated routes in the existing merchant workspace. |
| `project-store.mjs` | Private source retention, immutable project editions and complete compressed comparisons. |
| `provider.mjs` / `acquisition.mjs` / `capture-store.mjs` | Actual provider requests, native capture retention and recovery. |
| `mapping.mjs` / `comparison-view.mjs` | Source-bound semantic review, exact result comparison and complete record navigation. |
| `release-operations.mjs` | Original merchant source review, package export and SF82 release operation. |
| `customer.mjs` | Original receiving workspace adapter and verified saved response selection. |
| `handover.mjs` | Portable original file closure, native-reader verification and fresh workspace restore. |

The integration uses the original SF31, SF61, SF82 and SF88 implementations and the existing buyer runbook application.
