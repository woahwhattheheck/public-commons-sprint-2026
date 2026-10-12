# Receive a semantic dataset and use it in the native agent workspace

This workflow receives an already finalized SF100 dataset, keeps its original files and dictionary together, and uses the existing Python analysis service for typed import, SQL, reports and editable workbooks. A received room is a source the host selected. Its original payment status and source format remain part of every analytical handoff.

## Register the original room

Use the native workspace CLI from the selected complete source tree:

~~~bash
node stellar-forge/mcp-paid-agent/native-workspace-cli.mjs datasets-receive \
  --dir /absolute/private/native-workspace \
  --id svk-capacity-retained \
  --room /absolute/private/customer-delivery
~~~

The room must already be finalized by the original SF100 engine. The host receiver runs the original scan and DatasetDelivery receiver, verifies the contiguous native archives, typed rows, manifest and output files, and saves an immutable registration under the selected native workspace. The same ID and same original input can be reopened. Changing its source requires a different receiving ID.

When the room also belongs to an already COMPLETE SF88 acquisition, add --session /absolute/private/original-session. The receiver reopens that original acquisition and requires a resumed finalized delivery with zero appended pages. Without --session the format is SF100_SCAN and session is null. Receiving a direct room does not create an SF88 session, configuration, payment attempt or settlement.

Only the host supplies filesystem paths. Agent requests address the saved acquisitionId. A received ID supports read/status/history/rows/files/meaning and analytical attachment. It cannot prepare, execute, cancel, recover or finalize another owner's acquisition.

## Review rows, source identity and meaning

The existing dataset-status, dataset-rows and dataset-read actions work with the receiving ID. dataset-semantics adds bounded dictionary review:

- dictionarySection: columns, virtual-columns, issues or table.
- offset and limit select dictionary items; maxBytes bounds the returned preview.
- The response keeps the original semantic SHA, definition SHA, capture-manifest SHA, selected fields and exact dictionary-file identity.
- If an original item exceeds the preview budget, its offset and the exact file action remain available. Read semantics.json through dataset-read in at most 64 KiB pieces.

A semantic delivery has the original fifth file, semantics.json, alongside dataset.jsonl, dataset.csv, review.html and manifest.json. The manifest owns this file list. Existing four-file deliveries remain valid. An older saved delivery record whose pinned original manifest already contains semantics can expose that exact fifth file without rewriting the record.

The shared source receiver recognizes stellar-forge.ckan-semantics.v1 and stellar-forge.odata-semantics.v1 explicitly. The original SF100 engine validates the producer-specific source binding and the complete page contract. CKAN keeps x-ckan-semantics-sha256; OData uses x-dataset-semantics-sha256. Both retain the original semantics query pin, snapshot, file digest and page continuity. The native host accepts only those known schema versions and binds the original dictionary to its pinned manifest.

For OData, source retains provider odata4, protocol version, service/schema URLs, entity container/set/type and original CSDL/capture digests. Each reviewed value field has its explicit reciprocal state field. The state records value, null or missing; preserve it when an analyst needs source presence. sourceDefinition retains the CSDL type and facets, while projectedDefinition describes the physical customer field. Exact numeric text and JSON text stay in their declared encodings. A reviewed SQL alias changes the destination name while the original published field and its source definition remain in the same dictionary.

The [shared Python semantic receiving guide](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python/SEMANTICS.md) includes the original OData Orders receiving invocation, complete query/report/workbook continuation, physical state mapping and unchanged helper API. Use the same host-only datasets-receive, retained ID and analytical attach/import path for either producer.

The dictionary describes the published dataset; its column list can be broader than the selected query projection. Selected fields must occur in that dictionary. Units, timezone interpretation, codes, primary keys, virtual columns and issues come from the original dictionary. A delivery without a dictionary returns available: false; the receiver does not invent one.

For an original new SF88 dataset preparation, the existing selected query can also carry the original semantics SHA. That pins the query to the published dictionary through the original acquisition engine. This receiving workflow does not itself acquire another page.

## Attach to the original analysis service

Run the existing service with its global arguments before serve:

~~~bash
PYTHONPATH=/absolute/source/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python \
python3 -B -m stellar_forge_buyer.analysis_workspace \
  --database /absolute/private/analysis-database \
  --checkout /absolute/source \
  --node /absolute/node \
  serve --port 0
~~~

Register that service through the existing analysis-register host command as described in [ANALYSIS.md](ANALYSIS.md). Keep its returned workspace identity and private capability with the host.

Use analysis operation attach-dataset with the saved acquisition_id, the intended source name and expected source revision. The native host resolves the original completed receiving record. A direct SF100 room uses the authenticated /api/native-finalized-dataset-source route; an SF88 acquisition keeps its existing route. Both use the same persistent source aliases and revision check.

The finalized-source request is exactly:

~~~json
{
  "name": "svk_observations",
  "expected_revision": 0,
  "room": "/absolute/private/customer-delivery",
  "session": null,
  "expected_native": {
    "sourceFormat": "SF100_SCAN",
    "sourceBindingSha256": "original-receiver-binding",
    "manifestSha256": "original-manifest-sha256"
  }
}
~~~

This body is constructed by the host from the retained source. The two digest values above represent the original 64-character SHA-256 values, not values an agent should infer.

Start the existing import job with the saved source name/revision and explicit column mapping. For example, the original SVK mapping can retain observation_id as the SQL column observation_key. The same DatasetDatabase imports every original row, retains precise numeric text and binds the semantic source-to-SQL mapping to the returned version. Replaying the same original source and mapping returns the same edition identity.

## Use the retained dictionary from SQL, reports and workbooks

The analysis operation semantics reads the original semantic record for version_id. Its sections include columns, virtual-columns, issues, table and mapping. The mapping section shows the original source column and its analytical SQL column.

semantic-compare accepts before_version_id and after_version_id. It returns the original engine's definition_changed, capture_changed and mapping_changed flags and a paged original column comparison. These flags describe dictionary and source-binding changes; they do not claim that the underlying records changed.

semantics-file returns the original bytes in bounded pieces and verifies the retained dictionary's full size and SHA-256. Its small immutable cache is scoped to the live analysis workspace, listener and capability. Reopening or receiving another workspace does not reuse another service's cache.

Use the original saved query engine and returned version/view identity. A useful SVK overview groups observations by the declared price and volume units:

~~~sql
SELECT bidding_zone, product, direction, price_unit, volume_unit,
       COUNT(*) AS observations
FROM svk_observations
GROUP BY bidding_zone, product, direction, price_unit, volume_unit
ORDER BY bidding_zone, product, direction, price_unit, volume_unit
~~~

Confirm the named view through the original view activation/revision flow before using that query. Keeping price_unit and volume_unit in the grouping avoids silently combining incompatible measurements. The meaning of each value remains the dictionary's meaning.

[ANALYSIS.md](ANALYSIS.md) covers the existing saved queries, bounded previews, complete JSONL/CSV/SQLite exports and report review/publication. [WORKBOOKS.md](WORKBOOKS.md) covers the original editable typed workbook, complete source sheets, retained definitions, refresh and offline customer receiving. These operations continue to use the same SQL edition and exact dictionary. Receiving does not add a second query, reporting, spreadsheet or archive engine.

## Reopen and hand the work to a customer

Keep the completed import version and source revision with the saved query, report or workbook. Use the existing full output operations for a complete delivery; a paged dictionary or row preview is only a preview.

The original database backup preserves imported rows, exact dictionary bytes, SQL mappings, query/report/workbook state and history. The original workspace archive and customer receiver retain the payloads that their manifest declares. Use those original operations and check their returned source/output identities before handing off an archive.

External native room and host registration paths remain separate custody requirements for a new import or re-preview. Keep the original finalized room and registered host workspace if that continuation is required. Reopening a database does not fabricate those external inputs. Existing producer paths in result records remain provenance; receiving file readers use the selected receiving database and original validated job/file identities.

Stop the current analysis listener and native workspace through their original lifecycle before another owner opens the same workspace. Reopen the retained receiving ID, edition and customer output; no additional acquisition or payment is required.
