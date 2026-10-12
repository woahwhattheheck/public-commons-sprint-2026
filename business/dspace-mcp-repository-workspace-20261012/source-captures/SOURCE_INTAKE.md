# DSpace source intake and metadata relationships

This directory contains the source acquisition command used by the retained repository operator. Run the commands below from the product root with Node 24. The collector uses the public DSpace API, preserves original response bytes, and follows the request contracts of the pinned [4Science DSpace MCP client](https://github.com/4Science/dspace-mcp/tree/ee503ba97910f592867c897c1fa938f9e029d03c).

## Capture the selected repository source

```sh
node source-captures/capture-native.mjs --output /absolute/dspace-source-capture
```

The default repository is `https://sandbox.dspace.org/server`. The selected collection is Publications 2, UUID `dd1240ae-d7dd-405c-bdc3-d6c960609433`. The command records the anonymous account status, all top-level communities and collections, the selected collection and parent, every page of its item search, each selected item's complete metadata and bundle catalogue, and the original files of two selected document records.

To use an already-built copy of the exact upstream client, add:

```sh
--client-module /absolute/vendor/dspace-mcp/dist/services/dspace-client.js
```

Each capture retains its actual page numbers, total counts, request URLs, HTTP status, content type, date header, body SHA-256 and byte length. `started_at` records the request start, `received_at` records the response arrival, and `body_completed_at` records completion of its captured body. `response_url` and `redirected` preserve any observed redirect. Every response body is saved before its JSON is interpreted. The collector permits GET requests to the selected DSpace API and refuses request credentials or cookies.

The output directory contains `manifest.json`, `responses/` and `files/`. The manifest preserves the upstream client identity and the original DSpace object graph. It reaches `COMPLETE` only after the selected pages and files have been received. A failed capture retains the completed response files, original error and manifest; source-count changes during pagination remain visible.

The initial retained source has 44 Publications 2 items across pages of 20, 20 and 4. The additional document items are `0bc64a68-f318-474e-b70c-1fa5e0eb6dbe` and `ab949daf-405c-4a84-8c4a-a7bd883fd7d2`. Their selected ORIGINAL, TEXT and LICENSE bundles contain six files totaling 105,321 bytes: two PDFs of 65,388 and 36,281 bytes, text files of 79 and 77 bytes, and two 1,748-byte licenses. The collector checks each received file against the size and checksum supplied by its native bitstream record. A later capture keeps its own observed totals.

## Assemble or import through the maintained CLI

The product's existing CLI resolves original manifest-relative paths, verifies file digests and sizes, and preserves the complete original manifest. Use that same implementation for the browser's single-file import:

```sh
node scripts/cli.mjs assemble-source --source /absolute/dspace-source-capture/manifest.json --output /absolute/dspace-native-source.json
```

Select the resulting JSON in the operator's source-import screen. It contains the exact response bodies and original file bytes in the `dspace-source-capture/v1` contract; source bytes remain available in the saved workspace and its full handover. The output path must be new.

The CLI can also import the original directory manifest directly:

```sh
node scripts/cli.mjs import-source --workspace /absolute/repository-workspace --source /absolute/dspace-source-capture/manifest.json --actor "Repository source operator" --operation-id dspace-source-intake-20261012
```

Reuse the same deliberate operation ID when recovering that import. The source selection and original files remain bound to their capture.

The separately retained public-reader bundles are usable before a native HTTP capture is available. Their original JSON is explicitly marked `provider-extracted-native-json`; HTTP status and per-request receipt time remain null because that reader did not expose them. Their source manifest, provider context and original body bytes are retained. Keep this distinction when exporting or comparing source editions.

## Read metadata as original value arrays

The selected 44-publication source contains 1,216 metadata values. Each native value preserves `value`, `language`, `authority`, `confidence` and `place`. The cohort includes 408 author values, of which 63 have a virtual relationship authority. An author field can therefore contain ordinary and generated values together.

For publication `0157eef4-2dc8-4ddd-8124-94cdabc15f6e`, the original author array includes:

```json
[
  {"value":"Schmidt, Marjanka K","language":null,"authority":null,"confidence":-1,"place":0},
  {"value":"Antoniou, Antonis","language":null,"authority":"virtual::1019","confidence":-1,"place":15}
]
```

These two displayed entries are an excerpt from the same 85-author native array. An edit preserves the complete original array and every unchanged value.

The exact corresponding relationship source is:

| Source field or link | Original value |
| --- | --- |
| Author authority | `virtual::1019` |
| `relation.isAuthorOfPublication` | `1b19bcc0-4f83-446d-95b7-ec0c806d1578`, authority `virtual::1019`, place 15 |
| Relationship 1019 left item | Publication `0157eef4-2dc8-4ddd-8124-94cdabc15f6e` |
| Relationship 1019 right item | Person `1b19bcc0-4f83-446d-95b7-ec0c806d1578` |
| Person `person.familyName` | `Antoniou` |
| Person `person.givenName` | `Antonis` |
| Person `person.jobTitle` | `Researcher` |

The retained `linked-person-source.json` supplies both the complete Person item and relationship 1019 response. The publication's `relation.isAuthorOfPublication.latestForDiscovery` and `dspace.relatedentity.type` entries retain the same original virtual authority.

Across all 44 publications there are 185 direct relationship entries: 63 author links, 51 organizational-unit links and 71 project links, pointing to 159 distinct target items. The `.latestForDiscovery` entries are additional generated discovery metadata and are not counted as separate direct relationships.

## Preserve generated values while editing the correct record

DSpace's [Configurable Entities documentation](https://wiki.lyrasis.org/spaces/DSDOC10x/pages/408944761/Configurable%2BEntities) defines relationship-derived metadata. The namespace `relation.*` is generated by that relationship system. The distinct `dc.relation.*` namespace is ordinary metadata. Other virtual field names are configured by the repository, so the value's `virtual::` authority is the useful source marker rather than a hard-coded author-field list. `dspace.entity.type` is stored entity metadata and should not be classified as virtual merely because its key begins with `dspace.`.

For the example above, changing the displayed generated author name means reviewing the linked Person's actual name fields. The operator preserves the publication's generated values and follows the retained linked-item identity. Ordinary author values in the same field remain ordinary editable values.

A relationship change has different native consequences from editing plain text. The current DSpace submission metadata patch implementation can delete a relationship when a previously present virtual entry is omitted from a replacement array. It also uses retained relationship positions for virtual ordering. Preserve the generated membership in ordinary metadata corrections; deliberate relationship changes require the appropriate relationship workflow and an explicit review of their impact.

Primary implementation references:

- [DSpace virtual-authority constant](https://github.com/DSpace/DSpace/blob/a5b0f0fc17ad5c7f8917eb89b9222f2c2d441aed/dspace-api/src/main/java/org/dspace/core/Constants.java).
- [DSpace submission metadata patch implementation](https://github.com/DSpace/DSpace/blob/a5b0f0fc17ad5c7f8917eb89b9222f2c2d441aed/dspace-server-webapp/src/main/java/org/dspace/app/rest/submit/factory/impl/ItemMetadataValueAddPatchOperation.java).
- [Native REST relationship contract](https://github.com/DSpace/RestContract/blob/main/relationships.md).
- [Original publication response](https://sandbox.dspace.org/server/api/core/items/0157eef4-2dc8-4ddd-8124-94cdabc15f6e), [Person response](https://sandbox.dspace.org/server/api/core/items/1b19bcc0-4f83-446d-95b7-ec0c806d1578), and [relationship response](https://sandbox.dspace.org/server/api/core/relationships/1019).

## Continue the native operating journey

The maintained `scripts/native-receiving.mjs` runs the complete original MCP journey on the official demo site using its own clearly labeled archive record and ordinary draft. Its `native-journey.json` and repository workspace retain the original operation prefix, source captures, exact uploads, review decisions, collection changes and recovery.

The [official DSpace demo page](https://dspace.org/demo/) and [DSpace 10 sandbox guide](https://wiki.lyrasis.org/spaces/DSPACE/pages/425331100/Try%2Bout%2BDSpace%2B10) publish the test-account roles and intended demonstration use. The archive/create/move journey uses the published Demo Site Administrator role, with its credential supplied only in the receiving process environment. Continue that same saved workspace after interruption; its original item and draft identities provide the receiving handover.
