# DSpace repository datasets

Turn a retained DSpace repository capture into an explicitly selected dataset, review the exact edition, publish it through the original Starforge merchant, and receive its complete customer output.

The source operator keeps full native metadata arrays, record UUIDs, language, authority, confidence and placement. The merchant and customer modules use the existing SF30 dataset engine, SF82 publisher, SF88 buyer and SF100 delivery workspace.

## Open the operator

Use the maintained Starforge installation on Linux with Node 24 and the native `flock` utility.

~~~sh
starforge dspace-workspace \
  --directory /private/repository-operator \
  --workspace /private/repository-datasets
~~~

The source entry has the same options:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/dspace/server.mjs \
  --directory /private/repository-operator \
  --workspace /private/repository-datasets \
  --port 0
~~~

Open the returned local URL. The operator serves its HTML, JavaScript and styles locally and uses the original private SQLite workspace. It supports desktop and mobile browsers. The host process selects the private directories; browser requests select saved records.

The first opening stores the original workspace in the operator's project registry. Later openings recover the selected original or received project. `--workspace` supplies the first workspace for a new operator registry.

## Complete operating workflow

1. **Import sources.** Select the complete `dspace-source-capture/v1` JSON exported by the maintained repository workspace or native source collector. The original body digests are checked before the source is retained. Source inventory reports the captured records, collection pagination, request count and source SHA256.
2. **Select records.** Inspect original metadata and choose the displayed record versions. Collection selection follows the original captured collection. Additional linked entities can be selected from another source. Each selected UUID has one explicit source SHA and object digest.
3. **Choose the dataset.** Select the native metadata fields, row form, attribution and intended distribution basis. Saving retains a complete immutable edition and its native SF30 dataset snapshot.
4. **Review the exact edition.** A named review binds its decision and notes to the edition SHA256. Select the latest approved edition for the merchant. A later request for changes becomes the current review.
5. **Inspect native pages and comparisons.** Dataset preview uses the existing SF30 cursor query. Compare complete editions in the same row form. Download the full CSV, edition and comparison from the operator.
6. **Deliver or continue.** Export the entire project to transfer source captures, editions, reviews, comparisons, recorded publications and original operations. Receive it into the operator, then continue with the same record and request identities.

The browser keeps an outstanding mutation or receiving file in IndexedDB before sending it. A lost response leaves that original request available through **Retry saved request**. A new operation uses the current revision. A saved operation with unchanged inputs returns its original result; changing those inputs under the same request ID returns a conflict.

## Original source contract

The source is a complete UTF-8 JSON file with this envelope:

~~~json
{
  "schema": "dspace-source-capture/v1",
  "name": "Repository source",
  "base_url": "https://repository.example/server",
  "recorded_at": "2026-10-12T00:00:00Z",
  "scope": {
    "uuid": "the-original-collection-uuid"
  },
  "requests": [],
  "files": []
}
~~~

Supply actual original requests and captured bytes. Each request records its original URL, method, observed status or null, original timestamps when available, and one or both exact body forms:

- `body_text` contains original UTF-8 response bytes.
- `body_base64` contains original binary or UTF-8 response bytes.
- `body_bytes` and `body_sha256`, when present, must match those bytes.
- When both forms are present, their decoded bytes must agree.
- A declared JSON response must decode as complete UTF-8 JSON.
- Binary responses remain in the original capture. Applicable JSON responses supply native DSpace item objects.
- Native assets in `files[].content_b64` retain their original bytes and recorded length/digest.
- Request errors and unknown HTTP facts retain their original values.

The original captured file is retained verbatim and is downloadable. The analyzed record inventory keeps each distinct original object version under its UUID and canonical object SHA256. Full request bodies remain in the retained source.

Collection completeness is derived from the observed native page numbers, total pages, total elements and distinct captured UUIDs. A declaration of completeness alone does not fill a missing page.

The supported maximum source file is 256 MiB. Source traversal and the native dataset engine retain their own explicit structural and row limits.

The maintained repository workspace and source collector are in [the complete 4Science implementation](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/1508). The dataset modules consume its source format independently. Original provider/source attribution remains in the captured source.

## Dataset forms

| Form | Customer row | Native values |
| --- | --- | --- |
| `items` | One selected repository item | `metadata_json` contains the complete selected field arrays and their native value objects. |
| `metadata-values` | One selected metadata value | `value_json` preserves its native value; `properties_json` preserves the full value object, including language, authority, confidence and placement. |

Both forms include the item UUID, item name, source capture SHA256 and original repository item URL. The metadata-value form also includes field and ordinal. The item form includes entity type and selected metadata count.

The selection records every source ID, UUID and object digest. An edition also retains its chosen fields, attribution/distribution basis, prior edition when supplied, complete customer records, CSV/configuration bytes and the native dataset snapshot.

Changing the displayed dataset name or any native dataset policy produces the snapshot defined by the existing dataset engine. Customer queries and the versioned publisher use that native identity.

### Native queries

Use the original SF30 scalar string parameters. Examples:

~~~json
{"limit":"20"}
~~~

~~~json
{"limit":"20","where_item_uuid":"0157eef4-2dc8-4ddd-8124-94cdabc15f6e"}
~~~

~~~json
{"limit":"20","sort":"-metadata_count"}
~~~

The metadata-value form supports `where_field`, ordinal ranges and field/ordinal sorts. Follow `body.page.nextCursor` from a native API result. Supply it as `cursor` with the same selection and filter parameters. The browser follows that cursor directly.

### Complete comparisons

Comparison uses UUID as the item-row identity and UUID/field/ordinal as the metadata-value identity. It retains every added, removed and changed row, including full before/after values.

Changes to the source SHA or repository URL have their own complete provenance comparison. They do not turn unchanged record contents into content changes. The comparison also retains both selected-field lists and distribution bases.

The browser pages large comparisons. Its download always contains the complete comparison.

## Publisher and customer

[Merchant and customer operations](MERCHANT.md) provides the complete installed commands and original SF82/SF88/SF100 receiving workflow.

An approved export consists of:

| File | Contents |
| --- | --- |
| `data.csv` | Complete selected native dataset rows. |
| `dataset.json` | Original SF30 dataset configuration. |
| `dspace-lineage.json` | Exact edition, review, snapshot, selection, metadata fields, source identities and file digests. |

The publisher requires the latest review of the exact edition to be approved. Explicit merchant review selection must agree with the exported lineage.

The full source capture can include records outside the selected customer dataset. Merchant source closure retains those original captures. Customer receiving explicitly selects whether it should include them alongside the purchased selection and lineage.

## Embedded workspace API

~~~js
import {
  openDspaceWorkspace,
  receiveDspaceWorkspace
} from './workspace.mjs';

const workspace = await openDspaceWorkspace({
  directory: '/private/repository-datasets'
});

try {
  const state = workspace.state();
  const output = await workspace.exportDataset(
    state.selected_edition_id,
    '/private/approved-repository-dataset'
  );
  console.log(output.snapshot, output.datasetPath, output.lineagePath);
} finally {
  await workspace.close();
}
~~~

| Method | Purpose |
| --- | --- |
| `state()` | Original workspace ID, revision, selected edition/review and saved inventories. |
| `read(kind,id,{offset,limit})` | Complete record envelope with paginated items, rows or changes. |
| `operation(id)` | Original request inputs, digest and committed result. |
| `dispatch(action,input)` | Import, save edition, review, select, compare or record native publication. |
| `query(editionId,query)` | Original dataset-engine response for the retained snapshot. |
| `exportDataset(editionId,directory)` | Approved CSV/configuration/lineage handover. |
| `exportFile(kind,id)` | Complete source, edition, dataset, configuration, comparison or project file. |
| `close()` | Drain accepted work and release the original workspace lease. |

Mutation input includes `operationId`, `expectedRevision` and `actor`. Edition review also includes `editionId`, `editionSha256`, `decision` and `comment`.

The complete project receiver uses original files:

~~~js
const received = await receiveDspaceWorkspace({
  file: '/private/transfer/DSpace_Repository_Datasets.sqlite3',
  directory: '/private/received-repository'
});
try {
  console.log(received.state());
} finally {
  await received.close();
}
~~~

Receiving reads the supplied SQLite file as data, verifies its format and all original file/record/request digests, reconstructs the known schema, and reproduces the saved projections from retained source. It publishes the validated database atomically.

An interrupted receive continues from its original private receiving state. Repeating a completed receive with the same archive reopens the same workspace, including later edits. A different original workspace at the destination remains a conflict. Export files are also published atomically, so interrupted writes can be retried.

## Native operating example

The original October 12 repository source used for the complete receiving exercise contains:

| Source | Actual captured coverage |
| --- | --- |
| DSpace Publications 2 collection `dd1240ae-d7dd-405c-bdc3-d6c960609433` | All 44 publications across pages 0, 1 and 2. |
| Original public-reader capture | 49 distinct native items, including linked/out-of-collection objects. |
| Separately retained Person capture | Original linked researcher `1b19bcc0-4f83-446d-95b7-ec0c806d1578`. |
| Explicit complete demonstration selection | The 44 collection records plus that one Person: 45 rows, 1,230 metadata values. |

The first publication retains all 85 author values, including the original `virtual::1019` authority and placement for the linked Person. Removing `dc.description` in a second complete projection changes 42 of the 45 item rows. The original core operating run read every native cursor page, exported the exact approved dataset, received the complete project, replayed its original request, and reopened the saved native workspace.

The original capture's complete bytes remain the source of those counts. Its stated distribution basis is the internal public-sandbox engineering demonstration recorded in the named review.

The complete browser journey saved and reviewed the 45-record edition, followed all three native query pages (20, 20 and 5 rows), downloaded the full dataset and comparison, and transferred the complete 520,192-byte project. It recovered the original receiving request after its response was lost and reopened the same received project at revision 11 after a host restart. The desktop and 390-pixel mobile layouts were exercised in that journey.

The merchant/customer journey prepared the reviewed edition through SF82 and began the original SF88 buyer. After the first two pages, it published a 44-record successor through SF30, then completed all seven pages of the buyer's original 45-record snapshot. It recovered the original customer result, assembled the complete customer data room, and reopened both the current and retained dataset versions.
