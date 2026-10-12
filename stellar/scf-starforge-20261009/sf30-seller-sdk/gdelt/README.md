# GDELT article and event desk

GDELT article and event desk turns complete official GDELT 2.0 Events/Mentions or GKG 2.1 article updates into reviewed customer datasets. The operator keeps the original manifest response, every selected ZIP file, its decoded table and the exact field meanings. A saved review selects coverage and projection. The original Starforge merchant serves that immutable edition and its complete source files; the original buyer acquires, recovers and delivers the data. A recipient can reopen the received source review as a normal offline workspace.

The installed command is `starforge gdelt`. Applications registers **GDELT article and event desk** under its existing `gdelt-events` application ID. The merchant host registers **gdelt-workspaces** and its `merchant_gdelt_*` tools through the source-owned contribution at `distribution/contributions/gdelt-events.json`.

## Source and interpretation

The source contract is GDELT's [2.0 Event Database codebook](https://data.gdeltproject.org/documentation/GDELT-Event_Codebook-V2.0.pdf), its [data directory](https://www.gdeltproject.org/data.html), the [current update manifest](https://data.gdeltproject.org/gdeltv2/lastupdate.txt) and the [project's attribution terms](https://www.gdeltproject.org/about.html). GDELT permits commercial redistribution and asks users to acknowledge the project. Every capture, reviewed dictionary and published source set retains:

> Source: The GDELT Project — https://www.gdeltproject.org/

| Item | Retained meaning |
| --- | --- |
| Events | The original 61 headerless TSV fields, with source update and row ordinal. Event IDs, dates and codes retain source text. |
| Mentions | The original 16 fields and every original mention row. Repeated mentions remain separate. |
| Event timestamps | SQLDATE is the reported event date. DATEADDED identifies its Event update. |
| Mention timestamps | MentionTimeDate is the mention update; EventTimeDate identifies the original Event update. |
| Related mentions | Join GlobalEventID and EventTimeDate to an Event with the same ID and DATEADDED. A unique match carries retained event fields. Unrepresented and ambiguous relationships remain explicit. |
| Countries | Actor country codes use CAMEO. Geographic country codes use FIPS10-4. The application keeps these distinct. |
| Decimal values | Tone, Goldstein values, latitude, longitude and other decimal source values retain their exact text. The published dictionary describes their interpretation. |
| Counts and scores | Event counts and average tone are the initial Event update's values. Goldstein is an event-type score. Mention confidence describes extraction confidence. |
| Comparison | Added, removed and shared rows describe membership of selected source updates. |
| Source coverage | A chosen update or collection covers those retained files. Related mentions can reference events outside that collection. |

The application handles Events, Mentions, related-mentions and four GKG article views. An Events/Mentions capture retains the original paired ZIPs. A GKG capture retains the one original 27-field article ZIP from the same official manifest. Existing event operations and source identities keep their original representation. Article identifiers remain data cells; reading GKG does not fetch their source websites.

## Open the installed application

Use Node 20+ and Python 3.11+ from the existing runtime. The ZIP decoder uses Python's standard library. Source-file receiving imports the original bundled buyer/source-file modules. The native buyer and merchant use their existing installed dependencies and configuration.

Initialize a private project once:

```sh
starforge gdelt init --project /absolute/event-desk --title "Event desk"
starforge gdelt serve --project /absolute/event-desk \
  --python /absolute/installed-python \
  --connection-file /absolute/private/event-desk-startup.json
```

Open the private URL from the original startup JSON. The browser has five sections:

1. **Sources:** choose Events/Mentions or GKG articles, discover official updates, acquire the selected complete source family under one operation, import a complete retained capture and choose the collection.
2. **Review & compare:** select the table and exact projected fields, inspect source rows and field meanings, save a review and compare updates.
3. **Merchant:** choose the saved review and configured public terms, prepare its edition, inspect offers and start the routed merchant.
4. **Customer:** prepare explicit spending/page limits, run the original acquisition, recover it, deliver files and reopen the complete source review.
5. **History & handover:** inspect retained mutations, resume their exact request, record explicit abandonment or download a complete project.

The browser saves the exact request and operation ID before dispatch. Reload preserves the same draft and pending request. New-operation buttons preserve an unrelated pending purchase; History provides its exact continuation and explicit draft editing. Large complete imports that exceed browser session storage can use the CLI file path.

Applications accepts the initialized project, optional existing buyer configuration, facilitator, routed merchant port and selected Python executable. It checks the original project/buyer binding before launch and verifies the actual authenticated loopback startup. The original application terminal carries native buyer approval.

## Acquire and recover the exact source update

Discovery retains its full official response under a durable discovery ID. Select one returned UTC14 batch. The source acquires the manifest's exact file lengths and MD5 identities over HTTPS, checks complete response SHA256 and decodes each original ZIP member with CRC, size and UTF-8 validation.

```sh
starforge gdelt discover --project /absolute/event-desk \
  --out /absolute/private/current-discovery.json

starforge gdelt discovery --project /absolute/event-desk --id DISCOVERY_SHA

starforge gdelt capture --project /absolute/event-desk \
  --id capture-20261012-a --revision 1 \
  --batch RETURNED_UTC14 --discovery DISCOVERY_SHA

starforge gdelt show --project /absolute/event-desk
```

Use the actual returned discovery ID, batch and current revision. An optional `--manifest FILE` accepts the same complete discovery record or its manifest member. `discover --history` reads a bounded tail of the official update index, retains the exact HTTP range and selects only complete lines.

Repeat the same capture ID, revision and source selection after an interrupted response. The original acquisition retains the selected manifest and each completed ZIP response. A recovered complete file is verified and reused. A source Retry-After keeps its full provider duration/date; wait until that original retry time before continuing.

A complete capture can also travel through the installed file interface:

```sh
starforge gdelt source --project /absolute/event-desk \
  --capture CAPTURE_SHA --out /absolute/private/original-capture.json

starforge gdelt import --project /absolute/another-event-desk \
  --id import-original-a --revision CURRENT_REVISION \
  --source /absolute/private/original-capture.json
```

## Save a customer projection

The [event-policy example](examples/event-policy.json) provides a small useful projection. The [mention-policy example](examples/mention-policy.json) retains mention identity and event-match context.

```sh
starforge gdelt rows --project /absolute/event-desk \
  --captures CAPTURE_SHA,SECOND_CAPTURE_SHA \
  --policy /absolute/event-policy.json --offset 0 --limit 100

starforge gdelt review --project /absolute/event-desk \
  --id review-regional-events --revision CURRENT_REVISION \
  --captures CAPTURE_SHA,SECOND_CAPTURE_SHA \
  --policy /absolute/event-policy.json \
  --name "Regional event reporting" --note /absolute/review-note.txt

starforge gdelt compare --project /absolute/event-desk \
  --before CAPTURE_SHA --after SECOND_CAPTURE_SHA \
  --out /absolute/private/batch-comparison.json
```

Every projection keeps source_batch, source_row and GlobalEventID. Selection filters accept exact source text; they are applied while preparing the reviewed edition. Published filter/range/sort choices refer only to projected fields. The original dataset handler executes previews and customer requests with the same semantics. Row views page by offset; their response includes total/source row counts and the selected policy.

The saved review records its source capture IDs, ordered update coverage, note, exact field dictionary, selected row count and matched/unrepresented/ambiguous mention counts. Its ID binds the source collection and complete review definition. The merchant cannot silently replace it with a differently projected source.

## Publish and operate the original merchant

Supply the original public payment object used by your SF30 merchant. Keep the public HTTPS origin and route aligned with the existing router and local merchant port.

```sh
starforge gdelt publish --project /absolute/event-desk \
  --id publish-regional-events --revision CURRENT_REVISION \
  --review REVIEW_SHA --origin https://your-merchant.example \
  --path /gdelt --payment /absolute/private/payment.json

starforge gdelt publication --project /absolute/event-desk \
  --publication PUBLICATION_SHA

starforge gdelt merchant --project /absolute/event-desk \
  --publication PUBLICATION_SHA --merchant-port ROUTED_LOCAL_PORT \
  --facilitator https://your-original-facilitator.example

starforge gdelt preview --project /absolute/event-desk \
  --publication PUBLICATION_SHA --kind rows --query "limit=5"
```

The publication provides:

- **Rows:** the saved customer projection, immutable snapshot and published field dictionary.
- **Source files:** a complete chunk projection containing sources-manifest.json, source-set.json, review.json and gdelt-schema.json. Source-set.json retains every original manifest/ZIP/decoded table.
- **Advertised file responses:** complete small edition, CSV, dictionary and source files within the original single-asset budget.

The complete source-file dataset remains available when a source set exceeds the single-asset allowance. Its chunks use the original dataset/buyer delivery protocol. Source IDs, member lengths and SHA256, chunk order and snapshot all bind the delivered content.

Merchant serving reuses the original dataset versions, seller validation, route offers, native HTTP factory and configured facilitator. Source acquisition, project review and challenge-only serving are available without a buyer configuration. Add the original buyer configuration to the same workspace launch when executing paid acquisitions.

## Full customer acquisition, delivery and offline reopening

Prepare one original SF88 Dataset session with explicit limits. The original engine owns pagination, page intents, spending, accounting and recovery. The source-files product must acquire all fields and rows in original order.

```sh
starforge gdelt dataset-prepare --project /absolute/event-desk \
  --publication PUBLICATION_SHA --id source-files-customer-a \
  --kind sources --query "limit=4" \
  --max-pages 200 --max-total-atomic EXPLICIT_ATOMIC_LIMIT

starforge gdelt dataset-create --project /absolute/event-desk \
  --publication PUBLICATION_SHA --id source-files-customer-a \
  --buyer-config /absolute/private/original-buyer.json

starforge gdelt dataset-run --project /absolute/event-desk \
  --publication PUBLICATION_SHA --id source-files-customer-a \
  --buyer-config /absolute/private/original-buyer.json

starforge gdelt dataset-inspect --project /absolute/event-desk \
  --publication PUBLICATION_SHA --id source-files-customer-a \
  --buyer-config /absolute/private/original-buyer.json

starforge gdelt dataset-deliver --project /absolute/event-desk \
  --publication PUBLICATION_SHA --id source-files-customer-a \
  --buyer-config /absolute/private/original-buyer.json

starforge gdelt dataset-file --project /absolute/event-desk \
  --publication PUBLICATION_SHA --id source-files-customer-a \
  --file manifest.json --out /absolute/private/delivery-manifest.json

starforge gdelt dataset-receive --project /absolute/event-desk \
  --publication PUBLICATION_SHA --id source-files-customer-a \
  --buyer-config /absolute/private/original-buyer.json

starforge gdelt customer-reopen --project /absolute/event-desk \
  --publication PUBLICATION_SHA --id source-files-customer-a
```

Use `dataset-recover` with the same ID after interruption. `dataset-accounting` reads original page accounting; `dataset-finalize` continues the engine's original accounting finalization. `dataset-deliver` produces complete CSV, typed JSONL, review HTML, manifest and available published semantics. `dataset-file` verifies their original delivery hashes before returning bytes.

Source receiving uses the original SourceFiles contract. It verifies the entire acquired projection, each original member, the manifest's exact source-set/review binding and both original ZIP decodings. It then records the original receiving identity. Offline reopen checks that same manifest and every delivered member again before creating the customer project and reconstructing the original saved review. A changed review or dictionary cannot replace its delivered original silently.

In the browser, **Open received event desk** starts that normal received project and preserves the original customer's source/review history. Parent closure drains its child browser. The CLI supports explicit paths for an independently transported original delivery:

```sh
starforge gdelt source-receive --project /absolute/customer-sources \
  --source /absolute/private/original-delivery-report.json \
  --capture-manifest ORIGINAL_MANIFEST_SHA --source-set ORIGINAL_SOURCE_SET_SHA

starforge gdelt sources-open --project /absolute/customer-event-desk \
  --source /absolute/customer-sources --title "Received event desk"

starforge gdelt serve --project /absolute/customer-event-desk
```

Single-page or advertised-file acquisitions use `prepare`, `buy`, `recover` and `customer-file`. Continue a page using the preceding original response metadata, its next cursor and the same snapshot. The full Dataset interface carries this loop automatically.

## Native agents share the application

Start the original browser owner with `--connection-file`. Run `binding` with the same project/buyer/facilitator/port settings. Declare the actual returned project ID and binding hash in a private host configuration:

```json
{
  "schema": "stellar-forge.gdelt-workspace-host.v1",
  "workspaces": {
    "events": {
      "label": "Original event desk",
      "connectionFile": "/absolute/private/event-desk-startup.json",
      "projectId": "ORIGINAL_PROJECT_UUID",
      "expectedBindingSha256": "ORIGINAL_BINDING_SHA256",
      "inputs": {},
      "merchantProfiles": {}
    }
  }
}
```

Host inputs declare a complete capture or project file with label, path, kind and exact SHA256. Merchant profiles declare label, public HTTPS origin, route and the original payment object. Agents select those aliases. Source paths, private connections, executable selection and payment profiles stay in the host configuration.

Initialize the installed native merchant host:

```sh
starforge merchant-mcp init-provider gdelt-workspaces \
  --options /absolute/private/gdelt-native-setup.json
```

The setup JSON contains directory, connection and optional name; an existing original releaseStore can be selected. Initialization retains its intent and complete original release-store staging. Repeating the same setup recovers its published state and preserves previous partial attempts.

Use the merchant host's existing serve command with the returned merchant-mcp.json. The provider advertises:

| Tools | Complete workflow |
| --- | --- |
| workspaces / status / records / record | Current selected project, exact revision and paginated full original records. |
| discover / discovery / capture | Durable exact manifest selection and original paired-source acquisition/recovery. |
| input / import | Complete host-pinned source or project receiving. |
| query / review / select / publish | Fields, rows, comparisons, original dataset previews and complete reviewed merchant editions. |
| merchant / purchase / dataset | Original serving, single paid requests and full customer acquisition/delivery/receive/reopen. |
| file_read / file_release | Complete original files through SHA-bound retained chunks. |
| cancel | Cancel the exact running application action while preserving its original record. |

Every tool name begins `merchant_gdelt_`. Preserve expectedRevision across record pages. Preserve original operation/intent/dataset IDs after uncertain responses. A retained read is process-local; after restart, request the same selection with its complete expectedSha256 and byte offset. Files close on completion or explicit release. The provider uses direct authenticated loopback HTTP and drains its own clients/readers on closure. The original browser application remains its shared owner.

Node consumers can import `@tokenjunkielabs/starforge-merchant/merchant/gdelt/client` and use GdeltWorkspaceClient with one entry returned by readGdeltWorkspaceConfiguration. Its download method returns complete name/type/bytes after the application's original SHA256 check.

## Project handover and recovery

```sh
starforge gdelt export --project /absolute/event-desk \
  --out /absolute/private/complete-event-desk.json

starforge gdelt receive --project /absolute/received-event-desk \
  --source /absolute/private/complete-event-desk.json

starforge gdelt serve --project /absolute/received-event-desk
```

A project bundle includes the complete source captures, retained reviews, source-operation history and public merchant plans. The native buyer keeps its payer configuration, paid intent and accounting journals in the original buyer store. Transport the original buyer/runtime through its maintained customer receiving workflow when those operations need to move too.

Receiving verifies all original captures, review definitions and merchant snapshots. It records the complete source closure before publishing the normal project index. If the final receipt is lost, the same bundle can recover after the customer has already created later reviews or source operations: original history is checked and the current project index is preserved.

## Operating envelope

| Resource | Capacity |
| --- | --- |
| Official manifest response | 1 MiB; recent-history request uses a 256 KiB suffix range |
| Original ZIP | 24 MiB per Event or Mentions file |
| Decoded table | 64 MiB per file |
| Original capture | 192 MiB serialized maximum |
| Project sources | 32 distinct update captures and 256 MiB total |
| Merchant source set | 80 MiB complete original capture data |
| Rows | One million per selected table |
| Customer projected fields | Up to 64; original identity fields required |
| Original native query parameters | Up to 32 including immutable snapshot selection |
| Native page | Up to 900 KiB and the reviewed row limit |
| Original source-file chunks | 49,152 raw bytes per row, with complete member/chunk SHA256 |
| Retained project index | 8 MiB and up to 10,000 source operations |

Source/project changes use private, canonical paths and the original flock-backed locks. No source action replaces an existing immutable file with different bytes. Capacity or provider interruptions retain the original operation and source selection for continuation.

## Implementation map

- model.mjs + gkg.mjs: original field/code/date/decimal meanings, manifest/TSV parsing, article occurrence views, projection and comparison.
- source.mjs + zip_decode.py: official response custody, exact selected Events/Mentions or GKG ZIP acquisition and standard decoding.
- project.mjs: retained source/review/publication history and complete offline project receiving.
- merchant.mjs: original dataset version, seller offers, native serving, source-file projection and single-request binding.
- customer.mjs + source_receive.py: original SF88/SF100 acquisition, delivery, source receiving and offline review reconstruction.
- application.mjs + workspace.mjs + ui/: one operator/customer application and browser lifecycle.
- cli.mjs: the installed complete command surface.
- mcp-client.mjs + mcp.mjs + mcp-tools.mjs: borrowed agent operations and original retained-file reads.
- application-provider.mjs + merchant-provider.mjs + mcp-setup.mjs: installed Applications/native registration and original host setup.

## Complete native customer example

[The complete customer example](examples/native-customer-journey.mjs) runs the original source-to-customer workflow with the installed Starforge engines. It reads two official GDELT update pairs, retains an interrupted Event/Mentions acquisition and resumes the same source operation. It then prepares both reviews, compares the retained updates, publishes the original merchant editions, acquires rows and complete source files, and reopens the delivered review offline.

The example also transfers the complete project through the merchant MCP interface across a host restart. It receives that original project, creates a later customer review and repeats receiving to preserve the later revision. Its browser continuation captures the merchant's five sections and the received customer's desktop and mobile views.

Use the existing Node, Python, Playwright and Chromium installations, with the repository source and its installed merchant dependencies:

```sh
GDELT_NATIVE_SOURCE=/absolute/installed-starforge-source \
GDELT_NATIVE_CHROMIUM_EXECUTABLE=/absolute/installed-chromium \
node /absolute/installed-starforge-source/stellar/scf-starforge-20261009/sf30-seller-sdk/gdelt/examples/native-customer-journey.mjs \
  --directory /absolute/original-gdelt-customer \
  --python /absolute/installed-python
```

The payment services use the [original local protocol fixture](../stac/examples/gdelt-native-fixture-exports.mjs); the source responses come from the official GDELT service. The result records that execution mode alongside original source, review, publication and acquisition identities. Its private terminal wrapper admits only the planned original buyer reservations.

Keep the same customer directory when continuing this operation. The example retains each source request, step, original project, complete transferred bundle and customer receiving directory. A complete run writes `result.json` and the full `outputs/` files. An interrupted run retains `last-outcome.json` with the original stage and error. The complete output-file inventory contains each relative path, byte count and SHA256.

Closing the application attempts every owned customer window and merchant closure. Closing its browser also closes the original listener if another resource reports an error, then returns the first failure to the caller.

## GKG article research and customer delivery

The same project supports GKG 2.1 sources through the publisher's [complete GKG codebook](https://data.gdeltproject.org/documentation/GDELT-Global_Knowledge_Graph_Codebook-V2.1.pdf). Choose **GKG articles and entities** in Sources, or use **--format gkg** with the installed source commands. The existing default remains Events/Mentions.

A GKG capture retains its exact official manifest entry, original ZIP bytes and MD5/SHA256, the CRC-checked UTF-8 table and all 27 original cells for every record. Its schema is **stellar-forge.gdelt-gkg-capture.v1**; its codebook and source family participate in its content identity. A GKG acquisition binds **format: "gkg"** to its original operation. Repeating that operation resumes the same source selection.

A project can retain both source families. Each saved review selects one family and one original edition per update timestamp. Events/Mentions projections use event captures; article projections use GKG captures. Project export includes every retained family, original review and publication. Existing event bundles and customer editions reopen with their original identities.

### Select and inspect the original article update

~~~sh
starforge gdelt discover --project /absolute/article-desk --format gkg \
  --out /absolute/private/article-discovery.json

starforge gdelt capture --project /absolute/article-desk \
  --id article-source-20261012-a --revision CURRENT_REVISION \
  --format gkg --batch RETURNED_UTC14 --discovery RETURNED_DISCOVERY_SHA

starforge gdelt fields --project /absolute/article-desk --table articles
starforge gdelt fields --project /absolute/article-desk --table article-entities
~~~

Initialize the selected project once with the existing **init** command. Use the actual returned batch, discovery ID and current project revision. **discovery --id EXISTING_SHA --format gkg** derives the GKG selection from a retained official manifest without another source request. The browser uses this same read when changing source families. It retains a separate projection draft for each table.

GKG's record ID contains the original update timestamp and record sequence. A **T** sequence marker identifies the translated-record form. **DATE** is the original document publication timestamp and can be the explicit value **0** when unknown. Dates mentioned inside the document remain separate occurrences. **DocumentIdentifier** can be a URL or another source identifier, interpreted with **SourceCollectionIdentifier**. The exact pair produces **document_key**; records with that same pair keep their original record IDs and rows.

### Four article views

| Table | Customer rows | Required original identity |
| --- | --- | --- |
| articles | One row per GKG record, including all 27 raw source fields, exact document key, translated-record flag and parsed tone values. | source_batch, source_row, GKGRECORDID |
| article-entities | Each enhanced theme, person, organization, location and AllNames occurrence. | Record identity plus source_field, occurrence_index. |
| article-measures | Each original tone dimension and each present sparse GCAM entry. | Record identity plus source field and occurrence ordinal. |
| article-details | Each enhanced count, mentioned date, quotation and amount occurrence. | Record identity plus source field and occurrence ordinal. |

Every occurrence carries **raw_entry**, **parse_status** and its one-based ordinal in the original cell. Duplicate names, repeated entities and unrecognized entries remain represented. A trailing delimiter is treated as the original terminator; empty internal entries retain their own ordinal. The complete raw source field remains available in the article view and original capture.

Enhanced location rows retain Type, FullName, CountryCode, ADM1, ADM2, latitude, longitude, feature identifier and character offset. Geographic country codes use the GKG codebook's FIPS convention. Enhanced counts retain their original count, object and seven-field location block; that source block has no ADM2 field. Approximate source character offsets remain text.

Quoted text preserves everything after the first three original pipe separators. Amount objects can contain commas: the first and last separators select the numeric amount and offset while retaining the entire intervening object. Date resolution and zero date components remain exact source values. All media, original theme/person/organization lists, TranslationInfo and ExtrasXML remain raw article cells, including values that are not expanded into an occurrence view.

Tone values have explicit units in the customer schema. ToneScore is positive word percentage minus negative word percentage, measured in percentage points. PositiveScore, NegativeScore, Polarity, ActivityReferenceDensity and SelfGroupReferenceDensity are percentages. WordCount is a count. Values retain every original decimal digit. A malformed or partial tone field remains visible through its raw cell and parse status.

GCAM rows preserve the original **c<dictionary>.<dimension>** and **v<dictionary>.<dimension>** keys, values and source order. Count dimensions, dictionary scores, **wc** and **nwc** have separate measure kinds. Absent dimensions do not become invented zero rows. Consult GDELT's [GCAM master codebook](https://data.gdeltproject.org/documentation/GCAM-MASTERCODEBOOK.xlsx) for each dictionary's language, definitions and citations.

The article schema preserves decimal, offset, count and code values as text. Numeric range and sort operations on those fields therefore use lexical text order. Original physical row ordinals, occurrence ordinals and the translated-record flag use safe integers. Original empty nullable cells remain distinguishable in the retained raw table.

### Review and publish a useful customer dataset

Four complete policy files are shipped:

- [Article records](examples/gkg-article-policy.json)
- [Entity occurrences](examples/gkg-entity-policy.json)
- [Tone and GCAM measures](examples/gkg-measure-policy.json)
- [Counts, dates, quotations and amounts](examples/gkg-detail-policy.json)

Select fields, equality filters, sorts and exact accepted source values using the same policy contract as the event workspace. Preserve the required identity columns. Review coverage reports the actual article count, distinct document identifiers, translated-record count and records containing enhanced themes/locations.

~~~sh
starforge gdelt rows --project /absolute/article-desk \
  --captures ORIGINAL_CAPTURE_SHA \
  --policy /absolute/installed-gdelt/examples/gkg-entity-policy.json \
  --offset 0 --limit 100

starforge gdelt review --project /absolute/article-desk \
  --id article-entity-review --revision CURRENT_REVISION \
  --captures ORIGINAL_CAPTURE_SHA \
  --policy /absolute/installed-gdelt/examples/gkg-entity-policy.json \
  --name "Reviewed article entities"

starforge gdelt publish --project /absolute/article-desk \
  --id article-entity-publication --revision CURRENT_REVISION \
  --review RETURNED_REVIEW_SHA --origin https://data.example.com \
  --path /gdelt --payment /absolute/private/payment.json
~~~

The publication uses the existing immutable CSV dataset, original merchant offers and original payment configuration. The customer row product and complete source-file product have separate snapshots under that one edition. The shipped dictionary includes field meanings, original source order, approximate-offset interpretation, tone units and occurrence semantics. The full source-file dataset carries **source-set.json**, **gdelt-schema.json** and **review.json**, bound by the original **sources-manifest.json** and chunk identities.

The existing **dataset-prepare → dataset-create → dataset-run → dataset-deliver → dataset-receive → customer-reopen** workflow applies unchanged. Use the original acquisition's explicit page/row/spending limits and same ID for recovery. Offline receiving checks all three delivered files, the source-set identity, the homogeneous GKG capture/codebook binding, every original ZIP and decoded table, and the saved review. The recipient then opens the original article review through the normal application.

### Compare original article windows

**compare** accepts two retained GKG captures. It groups each window by the exact source-collection/document-identifier pair, retains every contributing GKG record and compares original metadata with multiplicity. GKG record ID and publication date are reported on the original records; they are excluded from the metadata multiset so a new source-window identifier alone does not fabricate a content change.

The output distinguishes documents seen only in one selected window, unchanged retained metadata and changed retained metadata. These statuses describe the selected source files. They do not establish article creation/deletion, new real-world events, entity affiliations or relationships between co-occurring names.

### Agent and installed application entry points

Existing **merchant_gdelt_discover**, **merchant_gdelt_discovery** and **merchant_gdelt_capture** accept optional **format: "gkg"**. The discovery tool can select GKG from an already retained manifest. Existing fields/rows/review/comparison/publication tools use the four article table names. The host input reader accepts the exact GKG capture schema under its existing **kind: "capture"** declaration and keeps the host-pinned file SHA256.

The same complete Applications entry, browser owner, merchant provider, native Dataset customer and file-chunk receiver serve the new views. Cancellation remains concurrent with the original active action, and host shutdown closes only its borrowed clients. Complete GKG source files are included by the existing distribution source tree; command and application IDs stay stable.

Limits remain 24 MiB per source ZIP, 64 MiB per original table, 262,144 characters per cell, up to 32 selected captures and one million projected rows. Expanded occurrence views enforce that row allowance independently. Source capture, review and receiving report the exact retained operation when a selected input exceeds its allowance.
