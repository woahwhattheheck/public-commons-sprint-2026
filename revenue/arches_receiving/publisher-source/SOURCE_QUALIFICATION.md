# Alizarin two-edition source qualification

## Original source selection

The complete receiving cohort uses unchanged publisher fixtures from `flaxandteal/alizarin`. The before resource is pinned to commit `ddb5594127fb106af74574bf7e0df660cb95961f`; the after resource is pinned by the retained original resource history to `e3e0187e151adc87a4eb0b69dd2f4b07277f359f` and independently retained as Git blob `79272c3246739ccb29bc494e022628170336113d`. The current repository tree `efd216a13c2cb9916aced96f42dd3c7bdb651941` is a tree identity, not a commit.

The graph and controlled vocabulary were fetched at the before commit. Their complete bytes also exactly match the observed publisher tree efd216a13c2cb9916aced96f42dd3c7bdb651941, including the immutable Git blob identities retained in COHORT.json. LICENSE.txt was independently retrieved from both named resource commits and is byte-identical. COHORT.json retains original paths, source URLs, exact byte counts, SHA-256 hashes, Git blobs, and the before/after file selection. Source bytes remain separate from the receiver's canonical JSON record and context identities.

These are publisher fixtures used to commission the receiving application. A live HERoNI resource has not been substituted for them.

## Exact observed difference

The enclosing resource is `d2368123-9628-49a2-b3dd-78ac6ee3e911`, graph `07883c9e-b25c-11e9-975a-a4d18cec433a`, graph publication `bcaac244-1158-11ef-a6e2-0242ac170006`. Before and after have the same complete resourceinstance object and the same two original tiles.

The newer resource adds tile `5f95bf95-3682-4bd5-957d-ee643389f117`. Its `resourceinstance_id` is `460c69bb-bccc-4f71-b276-edaac6ff6ee5`, which differs from the enclosing resource. The review should retain the complete original tile and report that ownership mismatch. It must not silently replace its owner or admit that tile into the accepted resource.

The new tile's nodegroup `ae2039a4-7070-11ee-bb7a-0242ac140008` is the graph's Permissions group. Its action node `7cb692b2-7072-11ee-bb7a-0242ac140008` declares `concept-list` and collection `cfe3d404-7461-433a-a6fd-05697d5ad0ca`. The stored list contains label UUID `e3a6493e-5df4-4ad4-a699-ade7ccf01917`. That label resolves to English “Reading”, concept UUID `70415d03-b11b-48a6-b989-933d788ffc88`. A label identifier and a concept identifier must remain distinct. This correct vocabulary resolution does not cure the separate tile ownership error.

## Graph and language meaning

The selected graph contains 23 nodes and 11 nodegroups. Every original before-edition tile belongs to the selected resource; all four stored data node IDs exist in the selected graph and belong to their tile's nodegroup. The resource's publication_id and graph_publication_id both match the graph publication.

Name node `127095f5-c05e-11e9-bb57-a4d18cec433a` belongs to Basic Info. Description node `32dba023-c05e-11e9-aa88-a4d18cec433a` belongs to Statement. Both are graph datatype `string`, while their actual tile values are language-keyed objects whose entries retain `direction` and `value`. Preserve all ten keys, including distinct `en-US` and `en-us`; preserve empty strings and the Irish text. The Basic Info image/file-list and source/resource-instance-list nodes are present as JSON null. Null presence is different from an absent node.

The collection has four concepts (Reading, Writing, Deleting, Executing), each with a separate English preferred-label UUID. Its own collection-level preferred label uses the empty locale key and the collection UUID as text. Preserve that source object rather than inventing a collection title.

## Publisher format compatibility

The actual publisher client `js/client.ts`, Git blob `4cb80ca1485c15b940daad8cb6ef9c2c7b7f4f77`, exposes two relevant receiving formats. Static file getResource reads `business_data.resources` and selects the nested resourceinstance UUID. Static HTTP getResource gives the parsed direct resource to createStaticResource. The receiving application therefore chooses `source_format=business_data` explicitly for this cohort; it must not infer a different format after a failed parse.

The separately retained publisher businessData JSON Schema, Git blob `3aeb6c22926bd672a6550daeea518264f4188f6d`, requires outer resourceid and graph_id fields which these actual fixtures do not contain. The current concept-list array also falls outside that schema's narrow tile data oneOf. Preserve the schema as publisher source and the actual fixture as publisher data; do not add missing identifiers or describe the fixture as passing that schema. The implemented receiver follows the observed explicit envelope and validates the resourceinstance/tile/graph relationships.

## Complete receiving sequence

1. Verify every COHORT.json source file's exact bytes and SHA-256. Open the original graph and collection once.
2. Stream the before resource through the explicit business_data parser to full EOF. Retain the raw file identity and canonical record/context identity. Review and accept its complete two-tile resource.
3. Stream the after resource from its unchanged original file. Show the actual added tile, Reading label/concept binding, and foreign owner. Record the reviewer's rejection with the specific ownership reason.
4. Publish the accepted older resource and unchanged selected graph, collection, and license. Keep both source editions and the rejection history in the workspace.
5. Export the whole workspace. Receive into a new private directory and reopen the release, original source files, reviewed difference, and accepted baseline through the ordinary application.

The application and source adapter owners run this sequence once through their composed native product. This cohort supplies the original inputs and source meanings for that operation.

## Source links

- [Before resource](https://github.com/flaxandteal/alizarin/blob/ddb5594127fb106af74574bf7e0df660cb95961f/tests/definitions/resources/d2368123-9628-49a2-b3dd-78ac6ee3e911.json)
- [After resource](https://github.com/flaxandteal/alizarin/blob/e3e0187e151adc87a4eb0b69dd2f4b07277f359f/tests/definitions/resources/d2368123-9628-49a2-b3dd-78ac6ee3e911.json)
- [Original graph](https://github.com/flaxandteal/alizarin/blob/ddb5594127fb106af74574bf7e0df660cb95961f/tests/definitions/models/07883c9e-b25c-11e9-975a-a4d18cec433a.json)
- [Original collection](https://github.com/flaxandteal/alizarin/blob/ddb5594127fb106af74574bf7e0df660cb95961f/tests/definitions/collections/cfe3d404-7461-433a-a6fd-05697d5ad0ca.json)
- [Original complete license](https://github.com/flaxandteal/alizarin/blob/ddb5594127fb106af74574bf7e0df660cb95961f/LICENSE.txt)
