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

Use source_format="resource" only for an explicitly selected single resource object. The format is never guessed. Unknown identifiers or member shapes remain diagnostic; a wrong envelope, malformed JSON, duplicate JSON keys, invalid UTF-8, truncated input, trailing content, changed file or oversized resource raises SourceError.

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

## Receiving evidence

The included immutable publisher cohort supplies the original resource editions, graph, collection and license. The original 18-file application completed its actual staff HTTP review, release export and whole-workspace cold restoration on 2026-10-13. It retained the later foreign-owned tile finding and the original Reading Value-to-concept binding through the review workflow.

The current public source includes later offline CSV review, the styled browser receiving course, public-source receiving and native SKOS context integration. Those additions have focused source review; their complete combined native/browser course remains pending the original equipped execution. The responsible producer must run the current source, inspect the actual screens and files, and retain that edition's receiving result before presenting the outgoing product as ready.
