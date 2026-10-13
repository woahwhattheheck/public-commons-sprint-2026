# Native Arches SKOS context receiving

This additive module consumes the publisher's native RDF/XML exports and passes explicit derived context to the existing Arches review workspace. The source contract is Arches8.1.0 at2127517966462ea024ffb000b2e1fd46bf66d6dd; the selected customer's actual installed version remains a commissioning input.

## Original inputs

Retain BOTH the selected scheme/concept export and collection export. Native routes are /concepts/export/<scheme UUID> and /concepts/export/collections. Scheme labels carry original Value UUIDs inside JSON literals; collection exports carry membership and their own labels. A native *_concepts.json display-label map is supporting material and does not establish all of these identities.

Select the exact graph JSON export, literal collection UUIDs, and complete original files. The module uses explicit RDF types and edges, so the publisher fixture filenames do not determine their meaning. URI namespaces come from original files, not a hardcoded production host. Subject UUIDs must be explicit; the importer never generates a replacement from a label or URI.

## What is retained and checked

The parser loads all original subject definitions before resolving membership. It retains collection and concept URIs, direct collection membership, Value IDs/text/language, original semantic relations, full file names/bytes/SHA256 and unchanged RDF/XML. Nested collections resolve through observed member edges, with cycles, missing subjects, identity/type conflicts and ambiguous preferred Values reported before projection.

The derived documents use the existing explicit collection-context format. They identify themselves as derived, bind all original source hashes, retain original namespaces and include complete Value/concept membership lineage. Same-concept membership in multiple collections is preserved; competing Value ownership is rejected. Original language-tag case is retained.

Each selected graph concept node must name an included original collection. The existing source adapter checks full graph/node/group/publication structure. A blocked run retains originals and diagnostics but emits no ready collection files. A READY packet is the complete context input to the original Workspace import, not a target Arches import receipt.

## Receive a complete context

Install this file alongside the unchanged arches_source.py and arches_workspace.py from the maintained project. Use an owned fresh output directory:

python3 -B arches_native_skos.py --skos original/selected-scheme.xml --skos original/collections.xml --graph original/selected-graph.json --collection SELECTED_COLLECTION_UUID --output receiving/native-context

Repeat --skos, --graph and --collection for the complete selected scope. The default source bounds are64MiB per original context file and256MiB total. Native resource editions have their separately agreed source bounds. The file receiver verifies original inode/size/times after full read, refuses symlinks and retains original bytes before its final manifest. No network or platform mutation occurs.

The returned manifest_sha256 is the exact identity of the final NATIVE_CONTEXT.json and is required on later receiving. Exit0 means the selected native context is READY; exit2 retains a complete BLOCKED packet and concrete source findings. An interrupted directory without NATIVE_CONTEXT.json is incomplete; retain it and choose a distinct linked source edition. Existing outputs are never overwritten.

## Join the original staff workspace

Open the existing Workspace selected by the original owner and call:

receive_candidate(workspace, context_directory="receiving/native-context", source_paths=[...], source_format="business_data", scope_id=ORIGINAL_SCOPE, coverage="complete" or "partial", actor=ORIGINAL_ACTOR, operation_id=ORIGINAL_OPERATION, expected_revision=CURRENT_REVISION, expected_manifest_sha256=RETAINED_READY_MANIFEST_SHA256, parent_release=ORIGINAL_PARENT)

The wrapper verifies the pinned complete manifest and every saved member, re-resolves all original SKOS, compares the complete derived documents and reproduces the original graph/context digest, then calls the original Workspace.import_candidate. It passes original graph bytes and derived collection documents through their existing roles. The raw SKOS and native manifest travel through the legacy license_paths parameter as explicitly identified supporting source documents; that parameter makes no new licence interpretation. Existing notices can be supplied separately as notice_paths.

The same original streaming intake, SQLite commit, source/context identity, review, revision control, release, complete export and cold restore remain authoritative. All original XML and the derivation manifest must appear in the resulting source archive. Changed original context changes the derived source identity and remains reviewable even when a resource body is unchanged.

## Native resource variants and publications

This module solves the complete vocabulary-context input. Select the flat business_data.resources CLI export for the current receiver. Nested Tile.serialize-only variants require their own explicit complete child inspection before acceptance.

The current source adapter conservatively blocks disagreement between historical graph_publication_id and exporter-current publication_id. They are distinct native facts. Retain the actual historical graph for a historical instance; source records must never be rewritten to make those fields agree. The explicit native publication-policy integration is separate from this context receiver and must be selected before representing a historical instance as compatible.

## Original publisher receiving exercise

native_skos_receiving.py consumes the three unchanged publisher RDF/XML fixtures. It verifies the actual selected collection05659706-08a2-4342-87b9-98919ecdd8d0 resolves all three original Value→Concept identities, retains en-US/en-za spelling, and diagnoses the unrelated collection's missing concept labels. Its complete source files and expected identities are from the pinned publisher, with full licence and provenance.

The full customer course then uses the real selected graph/resources and native target: source→context→staff review→accepted native release→target import/readback→complete workspace export→cold reopen. Render and view actual desktop/narrow screens, operate important controls and inspect outgoing/reopened files. Use the current original product execution and save route; this module does not open a second project or contact.

## Sources

- https://github.com/archesproject/arches/blob/2127517966462ea024ffb000b2e1fd46bf66d6dd/arches/app/utils/skos.py
- https://github.com/archesproject/arches/blob/2127517966462ea024ffb000b2e1fd46bf66d6dd/arches/app/views/concept.py
- https://github.com/archesproject/arches/blob/2127517966462ea024ffb000b2e1fd46bf66d6dd/arches/app/models/concept.py
- https://github.com/archesproject/arches/tree/2127517966462ea024ffb000b2e1fd46bf66d6dd/tests/fixtures/data

SOURCE_MANIFEST.json records every included original publisher fixture and its exact byte identity.

Current receiving status: complete additive source and original fixtures retained; actual native execution must supply its own result.

## Original native exporter cohort

The publisher's actual resource_export_tests.py also selects the paired RDF files and resource_export_test.json, an unchanged4,894,163-byte graph with78nodes/23groups. Its two-resource/18-tile native truth uses the same graph/publication and resolves the selected collection in External Identifier Type and Description Type. Four additional original collection IDs remain absent from the small RDF pair. Keep that full cohort as original structural receiving and unresolved-context diagnostics; never relabel its nodes or manufacture membership to obtain READY. All original files and their identities remain in the source qualification carrier.
