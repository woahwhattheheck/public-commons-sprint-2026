# Receive a real public Starches source edition

This receiver feeds the existing Arches review application. It retains one original public resource, its actual graph and the controlled-vocabulary collections that graph declares. The original adapter still diagnoses resource/tile ownership, graph publication, language and vocabulary identity. The staff workspace still owns review, release and portable receiving.

The programme is application/receive_public_starches.py. It uses Python's standard library and no external account or API key. It can receive directly from a public HTTPS origin or consume exact original responses already retained through the connected public-source route.

## Actual observed source

The observed public viewer is https://nihed-coral-quickview.flaxandteal.co.uk/ . Its original published files establish the source routes below.

On 13 October 2026 the unchanged flatbush.json was read in full: 1,048,850 bytes, SHA-256 ee98397c4c02f679b60cc2045326586783252e982165579ab7ad3cad7626ffe7, 57,444 spatial-reference entries. Its first actual Pagefind document hash is en_55e7fc2. The unchanged fragment /pagefind/fragment/en_55e7fc2.pf_fragment has been received and retained as a 7,287-byte gzip file. Its resource UUID still requires decoding the original fragment.

The actual deployed Pagefind runtime decompresses this fragment, removes the pagefind_dcd signature and reads its JSON. That document's meta.slug supplies the resource UUID; its url supplies the public presentation location. A count in pagefind-entry.json is search metadata, not an independently verified count of unique complete Arches resources.

The observed graph registry has three public models: Heritage Asset (076f9381-7b00-11e9-8d6b-80000b44d1d9), Maritime Vessel (49bac32e-5464-11e9-a6e2-000d3ab1e588) and Registry (3a6ce8b9-0357-4a72-b9a9-d8fdced04360). Graph names are localized objects. Select the original language key with --graph-language (en for this source); retain spaces, spelling and all original graph bytes. The published Starches asset source uses these exact routes:

- /definitions/business_data/RESOURCE_UUID.json
- /definitions/graphs/_all.json
- /definitions/graphs/resource_models/ORIGINAL_GRAPH_NAME.json
- /definitions/reference_data/collections/COLLECTION_UUID.json

The programme follows the selected resource's graph_id and that graph's concept/concept-list config.rdmCollection values. It does not recursively crawl linked people, organizations or neighboring assets.

## Preserve original attribution and notices

The retained deployed homepage includes an Open Government Licence v3.0 notice with the qualification “except where otherwise stated”, a Crown copyright link, and a separate NISRA Data Zones (2021) map-data attribution. The complete original homepage is retained in the existing source page and source carrier; the notice's linked licence is https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/ . These observed data/site notices are separate from the Starches code licence.

Use optional --notice-path / to retain that original homepage in this same source edition. Repeat the option for another explicitly selected same-origin notice path, up to sixteen. Each complete response is retained under sources/notices/, covered by the original response byte budgets and SHA checks, and listed in the edition and rights.original_notice_files. Reopened completed editions verify those files like the selected resource and graph. With --response-map --offline, the original notice responses use the same exact-byte receiving contract; a missing notice leaves the same operation at NEEDS_SOURCE with its actual URL.

The receiver preserves the complete notice bytes and their original URL/response provenance. It leaves rights.license_assertion unset and licenses empty; the staff commissioning workflow can read the original notice and any resource-specific exceptions. The public viewer's FAQ describes its individual assets as self-contained static JSON in Arches resource format: https://nihed-coral-quickview.flaxandteal.co.uk/faq/ .

## Receive from the public origin

Choose the source envelope explicitly after inspecting its original response. Both resource and business_data are the formats already supported by the existing adapter.

For a direct resource envelope:

    python3 -B application/receive_public_starches.py \
      --origin https://nihed-coral-quickview.flaxandteal.co.uk \
      --document-hash en_55e7fc2 \
      --source-format resource \
      --graph-language en \
      --edition heroni-public \
      --notice-path / \
      --output /OWN/PERSISTENT/heroni-source-edition

Use --source-format business_data if the actual original response is a business_data.resources envelope. The receiver requires exactly one selected resource from that single-resource URL, preserving its envelope unchanged. If a caller already has an actual public resource UUID, --resource-id can replace --document-hash. Do not infer an asset UUID from graph IDs, FGB bitmasks or example fixtures.

The receiver uses a nonblocking file lock on its own output directory. An interrupted run resumes that same source selection, verifies every settled file's actual bytes and digest, and requests only the remaining documents. It never overwrites a settled original response. A genuinely new source edition uses a new output directory.

Default byte budgets are 32 MiB per original response and 128 MiB for the complete selected original file set; the decompressed Pagefind payload has the same per-file bound. Adjust these declared limits when an actual selected graph or collection requires it. Network timeout defaults to 30 seconds per request. Responses redirected outside the selected HTTPS origin are rejected.

## Reuse exact retained responses

When direct public HTTPS is unavailable, the existing connected source route can retrieve the original URLs. Save those unchanged bodies and describe them in a private response map:

    {
      "schema": "commons.starches-original-responses.v1",
      "responses": [
        {
          "url": "https://nihed-coral-quickview.flaxandteal.co.uk/pagefind/fragment/en_55e7fc2.pf_fragment",
          "path": "inputs/NI_Heritage_Pagefind_en_55e7fc2.gz",
          "bytes": 7287,
          "sha256": "ACTUAL_SHA256_OF_THE_RETAINED_COMPRESSED_BYTES",
          "observed_at": "ACTUAL_RETRIEVAL_TIME",
          "receipt": {
            "kind": "original_connected_public_source",
            "reference": "EXACT_RETAINED_SOURCE_REFERENCE"
          }
        }
      ]
    }

Paths are relative to the response map unless absolute. sha256 and bytes must be the actual unchanged body identity. The receiver does not turn transport-provider metadata into upstream HTTP headers: http and observed_at remain absent/null when the original receipt does not establish them. Keep signed transport URLs and credentials out of the map.

Append --response-map /OWN/responses.json --offline to the same command. A missing body returns exit 2, state NEEDS_SOURCE and the exact next original URL. Previously received bodies and their identities remain settled. Add that original response to the same map and repeat the unchanged command. Without --offline, unmapped URLs use direct public HTTPS.

The response map is transport input. Its revision can grow as remaining bodies arrive; the logical source selection and settled source hashes stay unchanged.

## Bring the resulting edition into the existing application

A successful receive emits COHORT.json in the same files/editions shape as the original publisher cohort. Each files member binds an original relative path, URL, byte count, SHA-256 and actual receiving observation. The named edition exposes resources, graphs, collections, licenses, source_format, source_url and selected resource/graph IDs. derived_files separately names the decoded Pagefind document; it is not represented as an original publisher byte stream.

This is a selected one-resource edition. The original workspace names this coverage="partial"; import it using that value and a source scope for that observed public resource. A different resource selection must not imply removal of the rest of the publisher's register.

Use the existing application's upload/import workflow, or its original Workspace API:

    from arches_workspace import Workspace
    import json
    from pathlib import Path
    import uuid

    source = Path("/OWN/PERSISTENT/heroni-source-edition")
    cohort = json.loads((source / "COHORT.json").read_text())
    edition = cohort["editions"]["heroni-public"]
    workspace = Workspace("/OWN/PERSISTENT/arches-review")
    current = workspace.status()
    result = workspace.import_candidate(
        source_paths=[source / p for p in edition["resources"]],
        graph_paths=[source / p for p in edition["graphs"]],
        collection_paths=[source / p for p in edition["collections"]],
        license_paths=[source / p for p in dict.fromkeys([
            *edition["licenses"], *edition.get("original_notice_files", [])
        ])],
        source_format=edition["source_format"],
        scope_id="heroni-public:" + edition["resource_id"],
        coverage="partial",
        parent_release=None,
        actor="Named staff reviewer",
        operation_id=str(uuid.uuid4()),
        expected_revision=current["revision"],
    )

Retain the returned original snapshot/operation. Inspect its actual diagnostics and staff review before using the existing release action. The existing license_paths input retains complete original license/attribution documents as raw supporting sources; the example includes the observed notice pages there so the original workspace export and cold receive carry their exact bytes. Their inclusion is a source-retention choice, not a new data-license assertion.

Before presenting the live edition or its release to a customer, its producing owner opens the exact populated original application and actual outgoing reports/exports, views the rendered desktop and narrow/mobile output where relevant, operates the important source/review/release/download controls, and reopens the received delivery. Preserve those actual images for direct inspection and repair broken or unreadable output in the same product. Keep the existing plain industrial design and focused native journey; source review or screenshot capture alone does not complete that rendered-product receiving step. The publisher fixture commissioning programme operate.py specifically exercises the before/after fixture decisions; do not relabel that successful fixture run as a run of this separate live source edition.

## Rights, provenance and completion

Public availability does not establish a license for reuse. The receiver asserts no asset-data license and does not attach the Alizarin code license to these heritage records. licenses starts empty; staff can retain the actual source notice and selected-use terms through the existing commissioning workflow. All original metadata, descriptors, multilingual labels and source attributions remain in the raw resource and context files.

Completion requires the selected resource plus its declared graph and vocabulary files. source-receiving.json preserves the same selection, settled source identities and actual errors. COHORT.json is written only after that file set is received. A completed rerun verifies original files and the original cohort digest, then returns them without new acquisition. Keep the entire directory with the customer source edition and existing portable workspace delivery.
