# GDELT event desk

GDELT event desk turns complete official GDELT 2.0 Events and Mentions updates into reviewed customer datasets. The operator keeps the original manifest response, both ZIP files, their decoded tables and the exact field meanings. A saved review selects coverage and projection. The original Starforge merchant serves that immutable edition and its complete source files; the original buyer acquires, recovers and delivers the data. A recipient can reopen the received source review as a normal offline event desk.

The installed command is `starforge gdelt`. Applications registers **GDELT event desk**. The merchant host registers **gdelt-workspaces** and its `merchant_gdelt_*` tools through the source-owned contribution at `distribution/contributions/gdelt-events.json`.

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

The application handles Events, Mentions and related-mentions tables. It preserves GKG manifest entries as part of the original manifest while selecting the complete Event/Mentions pair. It reads the public source files and retained metadata; source article identifiers remain data cells.

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

1. **Sources:** discover official updates, acquire both files under one operation, import a complete retained capture and choose the collection.
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

- model.mjs: original field/code/date/decimal meanings, manifest/TSV parsing, projection and comparison.
- source.mjs + zip_decode.py: official response custody, paired ZIP acquisition and standard decoding.
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
