# Arches Receiving Workspace

Receive original resource editions, review changes with their graph and vocabulary meanings, and return an accepted portable release. The application combines a streaming source adapter, indexed SQLite workspace, staff browser, offline CSV review, release export and complete workspace restoration.

## Run the staff application

Python 3.10 or newer and its standard library are sufficient for the application. From this directory:

```sh
python3 -B application/arches_app.py serve --workspace /absolute/path/to/owned-workspace
```

The ready line supplies the local URL and private staff-token filename. Enter that token and a staff name in the browser. The default listener is 127.0.0.1. Retain deployment authentication through the operator's existing infrastructure.

[Operating guide](application/OPERATING_GUIDE.md) covers first receiving, complete versus partial scope, review decisions, releases and restoration. [Source contract](application/ARCHES_SOURCE.md) specifies the explicit business_data and direct-resource formats.

## Receive and deliver

A source edition retains the unchanged resource files, graph definitions, vocabulary collections and notices. The parser reaches full EOF before a candidate enters the authoritative SQLite transaction. Review decisions bind the original record and context identities. Accepted records retain the context from which they were selected; rejecting a later change preserves the earlier accepted record and its meanings.

The staff UI exports an identity-bound CSV review sheet. An offline reviewer fills decisions and reasons; the application previews the entire file before applying it through the same revision and operation controls. A lost response can be recovered using the original request.

Release downloads contain the selected original records, context files and decision history. Complete workspace downloads contain the database backup, original source files, review history and all application modules. Restore into a new empty directory using the operating guide.

## Included original receiving inputs

The Alizarin cohort includes two immutable editions of one publisher resource. The newer edition adds a tile owned by a different resource. The real workflow approves the original resource, displays the later ownership problem, retains a reviewer rejection and reopens the exported release and workspace.

```sh
python3 -B application/operate.py --cohort publisher-source --output /absolute/path/to/owned-receiving
```

This programme operates the original HTTP application and writes its actual result and complete project archive. A receiving directory belongs to that operation.

The explicit native_json format keeps the resource's stored graph publication separate from the exporter's current publication and requires the selected original graph to match the stored edition. The staff UI exposes this choice, and releases preserve the chosen interpretation for each selected resource/context group, including a mixture retained after rejected changes.

The separate native Arches vocabulary receiver consumes both scheme/concept SKOS and collection-membership SKOS. It preserves Value UUIDs separately from concept UUIDs, original URI subjects and language spelling. Later receiving pins the complete saved manifest, re-resolves originals and verifies the derived context before calling the existing workspace importer.

```sh
python3 -B application/native_skos_receiving.py --fixtures publisher-native-source
```

[Native SKOS guide](application/NATIVE_SKOS_RECEIVING.md) describes full graph/context selection and the original publisher exercise. Its fixture pair establishes three real Value-to-concept mappings; it does not supply a complete customer graph or a target import.

[Public source receiving](application/PUBLIC_SOURCE_RECEIVING.md) explains the additive Starches/Pagefind receiver for an explicitly selected live public resource and its complete graph vocabulary. It preserves source notices and partial coverage.

## Browser receiving and current status

The original 18-file application completed its source, HTTP staff review, release export and cold restoration course on 13 October 2026. This publication includes later offline CSV review, the current styled browser, a complete browser driver, public-source receiving and native SKOS context integration. The complete current edition still needs its actual combined native/browser course.

[Browser receiving](application/BROWSER_RECEIVING.md) uses an explicitly supplied, already installed Playwright/Chromium runtime. It exercises the real controls at 1440 and 390 pixels, including loading/error states, review replay, downloads and cold restoration. Run it against a fresh owned workspace after the HTTP course. The producer must open and actually view the resulting screens and files before presenting an outgoing product as ready. A source review or screenshot capture alone is insufficient.

## Source and licenses

The application uses the repository's MIT license, copied into application/LICENSE.txt so portable workspace exports retain it. Original publisher fixtures keep their unchanged accompanying AGPL version 3 texts and author fields. See [notices](application/NOTICE.md), [source manifest](SOURCE_MANIFEST.json), and [publisher qualification](publisher-source/SOURCE_QUALIFICATION.md).

No build workflow or hosted CI is required. The source receivers use local original files or an explicitly selected public source; the staff application has no sales, mailbox or customer-account integration.
