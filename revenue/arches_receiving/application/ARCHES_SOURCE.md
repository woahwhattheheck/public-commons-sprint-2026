# Arches source receiving contract

This Python standard-library module is the source intake arm of the Arches Receiving Workspace. The application retains SQLite candidate, review, approval, release and delivery ownership. The source adapter reads original files and returns identities and diagnostics.

## Original publisher contract

The selected publisher is flaxandteal/alizarin, source tree efd216a13c2cb9916aced96f42dd3c7bdb651941. The included publisher-source/COHORT.json pins every distributed resource, graph, collection and license by original path, commit, Git blob and SHA-256. The observed client and schema contracts are described in publisher-source/SOURCE_QUALIFICATION.md with their original Git identities.

The actual business-data fixture wraps each resource in resourceinstance plus tiles. Its resource ID and graph ID live inside resourceinstance. The public schema additionally requires outer fields that this fixture does not contain. The adapter follows the observed client and fixture contract and preserves original aliases; it does not add invented fields to make the fixture satisfy the other schema.

The original collection distinguishes a concept UUID from each preferred-label UUID. A concept-list tile selects a LABEL UUID. For example label e3a6493e-5df4-4ad4-a699-ade7ccf01917 means Reading within concept 70415d03-b11b-48a6-b989-933d788ffc88 in collection cfe3d404-7461-433a-a6fd-05697d5ad0ca. The adapter returns all three identities and original locale/text. A concept UUID supplied in that label position is a blocking diagnostic.

The current fixture's third tile 5f95bf95-3682-4bd5-957d-ee643389f117 declares resource owner 460c69bb-bccc-4f71-b276-edaac6ff6ee5, while the enclosing resource is d2368123-9628-49a2-b3dd-78ac6ee3e911. Both original identities remain in the record. TILE_RESOURCE_MISMATCH prevents approval while allowing retention for human review.

## Complete intake

    from pathlib import Path
    from arches_source import (
        inspect_context, iter_resources, inspect_resource,
        canonical_json, loads_json, hash_file,
    )

    context = inspect_context(graph_paths, collection_paths)
    with iter_resources(source_path, source_format="business_data") as stream:
        for original in stream:
            result = inspect_resource(original, context)
            staging_database.insert(
                result["graph_id"], result["resource_id"],
                result["resource_sha256"], canonical_json(result["record"]),
                canonical_json(result["issues"]), result["blocking"],
            )
        receipt = stream.receipt
        if receipt is None:
            raise RuntimeError("Original source has not reached verified EOF")
    # Commit the staged candidate only after every selected source reaches EOF.
    # Reject duplicate (graph_id, resource_id) across selected files in the
    # application's existing receiving transaction.

Use source_format="resource" only for an explicitly selected single Starches resource object. Use source_format="native_json" for the native Arches flat business_data.resources export and pass that same explicit format to inspect_resource. The format is never guessed. Unknown identifiers or member shapes remain diagnostic; a wrong envelope, malformed JSON, duplicate JSON keys, invalid UTF-8, truncated input, trailing content, changed file or oversized resource raises SourceError.

The stream holds one resource plus a 64 KiB input buffer. Its default per-resource maximum is 16 MiB and JSON depth limit is 128. Unselected envelope members are scanned and syntax checked. The array itself is not loaded into memory. Context files are separately bounded to 64 MiB each because their graphs and vocabulary indexes are reused across the whole receiving.

ResourceStream is an iterator and a context manager. receipt is None until the complete original document has been consumed, its trailing syntax validated, and the opened file's device/inode/size/mtime/ctime and selected path identity checked again. Early close leaves receipt unset. The complete receipt contains schema, bytes, raw sha256, resources and source_format. hash_file(path) separately streams a stable regular file and returns {bytes,sha256}.

Copy the exact publisher files into the application's existing immutable source store before inspection. Retain that manifest alongside the candidate. A caller may read a file selected from any location, but the adapter rejects symlinks/nonregular inputs and source replacement during reading. No source is rewritten or downloaded by this module.

## Exact JSON and geometry

loads_json uses int and Decimal for JSON numbers. canonical_json emits finite exact JSON numeric values, sorted object keys, compact separators and escaped Unicode; it does not normalize text, locale case, array order or publisher fields. Equivalent numeric values (1, 1.0, 1e0) have one canonical identity. Negative zero canonicalizes to zero. This is the documented commons.exact-json.v1 format, not an assertion of RFC 8785 compatibility.

Use canonical_json for original resource storage, hashes, snapshots and exports. Reopen those original records with loads_json. Do not pass records through float conversion or an ordinary json.dumps default that turns Decimal into strings. Existing operational metadata can continue using the application's ordinary JSON routines.

Exact raw-source SHA is separate from resource_sha256. Raw identity changes when whitespace changes; resource identity does not. The original record object is returned unchanged. The adapter includes original geometry values in bindings/geometries, checks GeoJSON structure, and never transforms, rounds or reprojects coordinates. Geometry validation is structural; it does not prove topology or change declared coordinate systems.

## Context and result shapes

inspect_context returns a reusable dictionary:

- schema and canonicalization.
- digest and identical context_sha256.
- source_manifest entries: kind, path, name, bytes, exact sha256, canonical_sha256 and original IDs.
- documents with each full original graph/collection record and its source SHA.
- graphs indexed by original graph ID, including original record, publication_id, nodes and nodegroups.
- collections indexed by original ID, including complete original record/concepts and label-ID bindings.
- issues and blocking.

The context digest binds exact selected source identities plus their canonical identities and IDs; runtime file paths do not enter it. Conflicting definitions with the same original UUID are retained and marked as errors. Graph/node/group/publication relationships, nodegroup ancestry and vocabulary label bindings are checked once. Context issues are carried into each resource result so an invalid selected definition cannot disappear from approval decisions.

inspect_resource returns schema, canonicalization, resource_id, graph_id, publication_id, context_sha256, resource_sha256, unchanged record, multilingual labels, tiles_count, bindings, geometries, issues and blocking.

Each issue has a stable code, severity, JSON-pointer-like path, readable message and details. Error severity blocks approval. Missing optional labels/publication IDs, unknown specialty value validators and unoverlaid provisional edits are warnings. Structural ownership, graph/publication mismatch, unknown nodes or vocabulary, parent cycles and declared cardinality conflicts are errors. Resource field aliases are compared but never rewritten.

labels retains original locale descriptor objects. Each string binding retains all original language objects, including blank values, direction and case-sensitive keys such as en-US and en-us. No fallback language is silently chosen. Node aliases are retained on bindings without replacing node UUIDs.

Source inspection does not resolve external resource references, execute JavaScript, fetch attachments, merge provisional edits or alter customer data. The surrounding review workflow decides whether to reject a candidate and keep its prior approved source/context.

## Explicit native Arches JSON publication contract

Select `native_json` only for the original flat `business_data.resources` exporter documented in Arches 8.1.0 at commit `2127517966462ea024ffb000b2e1fd46bf66d6dd`. The original `business_data` and `resource` formats keep their existing Starches publication-alias interpretation. The same native envelope is parsed to full EOF; raw bytes, original record keys, exact numeric values and stream receipts remain unchanged.

Native Arches retains two different facts:

| Original field | Source meaning | Receiving requirement |
| --- | --- | --- |
| `resourceinstance.graph_publication_id` | The graph publication saved with that resource instance. | Required UUID; it must equal the selected original graph's `publication.publicationid`. |
| `resourceinstance.publication_id` | The current publication of the resource's graph when the native exporter ran. | The field must be present. Its value is a UUID or null, retained separately from the saved instance edition. |
| `graph[].publication.publicationid` | The publication described by the selected graph export. | Required UUID for native receiving, with the original graph binding already checked by `inspect_context`. |

The native exporter adds its current `publication_id` after serializing the stored resource instance. Exporting by graph selects resources in the current graph publication; exporting explicitly named resource IDs does not apply that filter. Consequently a historical resource can retain a saved publication different from the exporter's current one. Their disagreement is a review warning in the explicitly selected native contract. A graph that matches only the exporter's current publication is insufficient for that historical instance and produces a blocking mismatch.

Never relabel a resource publication, rewrite a graph's publication object, invent a missing historical graph or substitute the current graph merely to make receiving pass. The caller supplies the actual original graph edition and its complete selected vocabulary context. Multiple different definitions for the same graph UUID in one context remain a blocking conflict; receive separate graph editions as separate selected context snapshots.

```python
context = inspect_context(graph_paths, collection_paths)
with iter_resources(resource_path, source_format="native_json") as stream:
    for record in stream:
        result = inspect_resource(record, context, source_format="native_json")
        # Retain the unchanged result["record"] and all actual diagnostics.
        # Only the original staff workflow can approve a non-blocking record.
    if stream.receipt is None:
        raise RuntimeError("The complete original native envelope was not received")
```

A selected native resource must have its original `resourceinstance` plus flat `tiles` wrapper. Nonempty nested `tile.tiles` content is retained with a blocking `RESOURCE_NATIVE_NESTED_TILES_UNSUPPORTED` diagnostic because this format does not inspect a nested Tile.serialize variant. Missing or invalid saved instance publication, absent exporter publication field, missing selected graph publication and a mismatched graph edition also block approval. A null exporter-current publication is a warning: it does not replace the saved instance publication or eliminate the selected graph requirement.

The native result additionally returns `source_format: "native_json"` and `publication`:

```json
{
  "schema": "commons.arches-native-json-publication.v1",
  "instance_graph_publication_id": "ORIGINAL_SAVED_PUBLICATION_UUID",
  "exporter_current_publication_id": "ORIGINAL_EXPORTER_CURRENT_UUID_OR_NULL",
  "exporter_current_field_present": true,
  "selected_graph_publication_id": "ORIGINAL_SELECTED_GRAPH_PUBLICATION_UUID",
  "selected_instance_matches": true,
  "instance_is_exporter_current": false
}
```

These are descriptive placeholders, not fixture values. The two equality fields are null when their required identifiers are unavailable. The existing result's `publication_id` is the validated saved instance publication in this format. The original record, record SHA and document-only context digest are not rewritten. Original geometry, node, tile, parent, cardinality, multilingual and Value-to-concept diagnostics still apply.

### Workspace, release and restored receiving

The existing workspace must pass the selected source format through both the stream and inspector. Its import request retains that format as part of the original operation identity. Native interpretation is also bound into the workspace's meaning identity, so selecting a different interpretation for unchanged graph/resource bytes remains a reviewable meaning change. The existing Starches context hashes remain unchanged.

Each accepted release resource retains its original `context_snapshot`. Its grouped downstream envelope declares `source_format: "native_json"` for a native snapshot, or `business_data` for a Starches snapshot. A release containing both interpretations carries their per-file declarations; a consumer must not apply one inferred global format. An individually downloaded raw resource wrapper retains its original JSON and requires `inspect_resource(..., source_format="native_json")` when its selected context says native. The native streaming receiver consumes its grouped business-data envelope.

Complete workspace export and cold restoration retain the selected source format, original source files, both publication fields, graph edition, review decisions and original operation history. No target Arches API is called by this adapter.

### What the original native fixtures establish

The publisher's `resource_export_tests.py` imports the exact scheme/collection RDF pair and complete `resource_export_test.json` graph before round-tripping `resource_export_business_data_truth.json`. The original graph is `ab74af76-fa0e-11e6-9e3e-026d961c88e6`; both original resources save and export publication `f546e4de-aa0d-11ec-99a5-8e0f431ffc6d`. The graph has 78 nodes and 23 nodegroups; both resources retain nine tiles. This actual cohort establishes the current-publication equality case and the genuine ownership/node/group relationships.

The graph declares 14 vocabulary collections. The small retained RDF pair resolves four populated cells in collection `05659706-08a2-4342-87b9-98919ecdd8d0`; eight other populated cells declare four collections that pair does not supply. Those unresolved meanings remain blocking diagnostics. This is not a complete native customer context, a fabricated historical-publication example, or a target import result. A genuine historical receiving result requires its own original resource and matching graph evidence.

Pinned original sources:

- [Native resource exporter](https://github.com/archesproject/arches/blob/2127517966462ea024ffb000b2e1fd46bf66d6dd/arches/app/utils/data_management/resources/formats/archesfile.py)
- [Graph versus explicit-resource export selection](https://github.com/archesproject/arches/blob/2127517966462ea024ffb000b2e1fd46bf66d6dd/arches/app/utils/data_management/resources/formats/format.py)
- [Native graph export and publication object](https://github.com/archesproject/arches/blob/2127517966462ea024ffb000b2e1fd46bf66d6dd/arches/app/utils/data_management/resource_graphs/exporter.py)
- [Publisher exporter receiving course](https://github.com/archesproject/arches/blob/2127517966462ea024ffb000b2e1fd46bf66d6dd/tests/exporter/resource_export_tests.py)
- [Unchanged full native graph](https://github.com/archesproject/arches/blob/2127517966462ea024ffb000b2e1fd46bf66d6dd/tests/fixtures/resource_graphs/resource_export_test.json)
- [Unchanged two-resource truth](https://github.com/archesproject/arches/blob/2127517966462ea024ffb000b2e1fd46bf66d6dd/tests/fixtures/data/json/resource_export_business_data_truth.json)

## Receiving evidence

The included immutable publisher cohort supplies the original resource editions, graph, collection and license. The original 18-file application completed its actual staff HTTP review, release export and whole-workspace cold restoration on 2026-10-13. It retained the later foreign-owned tile finding and the original Reading Value-to-concept binding through the review workflow.

The current public source includes later offline CSV review, the styled browser receiving course, public-source receiving and native SKOS context integration. Those additions have focused source review; their complete combined native/browser course remains pending the original equipped execution. The responsible producer must run the current source, inspect the actual screens and files, and retain that edition's receiving result before presenting the outgoing product as ready.
