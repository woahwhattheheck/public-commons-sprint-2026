# CIIM metadata receiving with Proteus

This application receives a reviewed OAI-PMH capture through the original **Proteus 3.0.0** XML converter and transformation engine. It produces a complete metadata handback, a searchable printable review, and a resumable operation whose source records, mapping specifications, engine artifacts, and native results remain linked.

It supports the original `oai_datacite` wrapper with DataCite kernel-4 metadata and `oai_dc` with all fifteen Dublin Core elements. The receiving target carries the institution's selected processing profile, authorities, and environment separately from the original record's identity and state.

## Run a captured edition

Run from the repository checkout that contains the maintained OAI source reader and its Python XML parser. Use an existing Java 17 or later installation and the exact Proteus artifact manifest supplied with the worked case. The original repository's Node dependency installation is reused.

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/ciim-receiving/cli.mjs transform \
  --source /absolute/capture-package/source.json \
  --runtime /absolute/proteus-runtime/runtime.json \
  --out /absolute/receiving/edition-01 \
  --operation institution-edition-01
```

The source package is the maintained OAI publisher export: `source.json` identifies `capture/capture.json`, whose inventory includes the original XML pages, current observations, requests, lineage, dataset configuration, and native dataset. The receiving application uses `readOaiSourceFile(sourceFile, {loadDataset:false})` from the adjacent OAI module to check the entire retained input.

The output directory must be private. The application creates a new directory with mode 0700, retains result files with mode 0600, and obtains the maintained publisher's filesystem lease for the complete operation.

Run the **same command, operation ID, source, runtime, mapping code, and receiving target** to continue an interrupted operation. A completed page is reopened only after its original request, source page, native conversion, mapped records, generated profiles, and runtime binding have passed their retained hashes. A changed edition or deliberately changed mapping uses a new output directory and operation ID, preserving the earlier operation.

Explicit source locations can be supplied when the original modules are maintained in another checkout:

```sh
node /checkout/ciim-receiving/cli.mjs transform \
  --source /captures/source.json \
  --oai-source-module /checkout/oai-pmh/source.mjs \
  --oai-python-directory /checkout/oai-pmh \
  --runtime /runtime/runtime.json \
  --out /receiving/edition-01 \
  --operation institution-edition-01
```

### Selected receiving configuration

An optional UTF-8 JSON file passed through `--receiving-target` records the actual institutional selection. The complete value is retained in the operation and handback; reopening requires the same value.

```json
{
  "documented_input": "OAI harvester plus reviewed Proteus transform",
  "processing_profile": null,
  "institutional_authorities": null,
  "receiving_environment": null
}
```

Replace these values with the selected institutional configuration when it is available. Record identity continues to come from the original OAI repository and header. The application does not reinterpret a processing-profile choice as a withdrawal or restoration.

### Existing Rosetta environment

The documented native endpoint accepts a POST body containing `spec`, `input`, and `config`. An already selected endpoint can be used instead of the Java artifact manifest:

```sh
node cli.mjs transform \
  --source /captures/source.json \
  --endpoint https://selected-rosetta.example/proteus/transform \
  --endpoint-runtime /selected-environment.json \
  --receiving-target /institutional-selection.json \
  --out /receiving/edition-01 \
  --operation institution-edition-01
```

The endpoint runtime file records `kind: "rosetta-proteus-endpoint"`, the exact `endpoint` URL, and a nonempty `reference` to the selected installed environment. Additional installed-version details may be included. An existing endpoint's request headers can be read from `--endpoint-headers-file`. Transport follows the selected URL without redirects and retains the actual response body or the native error response.

## Review and handback

Open `review.html` from the completed receiving directory. It contains the complete edition, filter controls, expandable original metadata, source references, property counts, retained issues, and links to the full JSONL export and manifest. It can be printed or shared with the accompanying files.

| Output | Purpose |
| --- | --- |
| `manifest.json` | Complete source edition, inventory, receiving selection, mapping and runtime identities, counts, issues, and member hashes. |
| `records.jsonl.gz` | Every current record in the original edition order. One complete mapped record per UTF-8 JSON line. |
| `review.html` | Full searchable, expandable, printable operator review. |
| `operation.json` | Bound operation and page checkpoints used by the same-command continuation. |
| `native-pages/*.json.gz` | Actual Proteus XML conversion bytes for each original OAI page. |
| `mapped-pages/*.jsonl.gz` | Complete retained transformed records belonging to each original request. |
| `profiles/*.json` | Exact generated specifications, named by their SHA-256. |
| `config.json` and `xml-to-json.spec.json` | Explicit native configuration and XML conversion specification. |
| `failure.json` | The latest incomplete-operation error, retained inside the operation's writer lease. A completed continuation removes this file. |

Compressed member descriptors contain both stored and uncompressed byte lengths and SHA-256 values. Every mapped property retains its original native node. The original XML bytes remain in the input capture's declared inventory.

### Record identity and state

The identity is the pair **original repository ID and original OAI identifier**. Identifiers, dates, numbers represented in XML, name identifiers, language tags, and rights strings retain their original lexical values.

| Original observation | Receiving result |
| --- | --- |
| Active header with metadata | Retain every original metadata resource and mapped property. |
| Explicit header `status="deleted"` | Retain the original header, observation, date, and source provenance; emit an empty resources array. |
| Record absent from a selection | No inferred deletion. The selected edition remains the source of the operation. |
| Later explicit active observation | Retain the new active observation as the source of restoration. |

The source repository's declared deletion policy is checked. Duplicate current identifiers, duplicate observation IDs, changed request/page bindings, and current-edition count discrepancies produce actionable errors.

## Metadata mapping

A mapped XML element has `attributes`, `content`, `mixed`, and `original` fields. Structured elements add named child groups. Repeated groups remain arrays, including explicit empty arrays.

The original namespace-aware parser supplies exact lexical tag spellings to the profile. Before selecting any metadata, the controller checks the native conversion against the original expanded-name tree: attributes, repeated children, text and whitespace, and the order of mixed text and elements. A familiar local name in another namespace cannot silently become a DataCite or Dublin Core property.

### DataCite

The profile exposes the full twenty-group kernel-4 mapping with DataCite 4.5 field requirements retained as source review advisories. Original wrapper schema versions and datacentre symbols accompany the record.

| DataCite group | Output field | Structured details retained |
| --- | --- | --- |
| 1. Identifier | `identifiers` | Identifier text and `identifierType`. |
| 2. Creator | `creators` | Names, given and family names, name identifiers, affiliations, and their attributes. |
| 3. Title | `titles` | Every title, title type, and language attribute. |
| 4. Publisher | `publishers` | Publisher identifiers, identifier schemes, scheme URI, and language. |
| 5. Publication year | `publicationYears` | Original lexical year. |
| 6. Subject | `subjects` | Schemes, value URIs, classification codes, and language. |
| 7. Contributor | `contributors` | Contributor type plus the same complete person structure. |
| 8. Date | `dates` | Date type, date information, and original precision. |
| 9. Language | `languages` | Original language value. |
| 10. Resource type | `resourceTypes` | General type and original type text. |
| 11. Alternate identifier | `alternateIdentifiers` | Identifier type and value. |
| 12. Related identifier | `relatedIdentifiers` | Identifier and relation types, related metadata scheme, scheme URI/type, and resource type. |
| 13. Size | `sizes` | Every original size string. |
| 14. Format | `formats` | Every original format string. |
| 15. Version | `versions` | Original version string. |
| 16. Rights | `rights` | Rights URI, identifier, identifier scheme, scheme URI, and language. |
| 17. Description | `descriptions` | Description type, language, and ordered mixed content. |
| 18. Geolocation | `geoLocations` | Places, point coordinates, bounding boxes, polygon points, and interior points. |
| 19. Funding reference | `fundingReferences` | Funder names/identifiers and award numbers/titles with all original attributes. |
| 20. Related item | `relatedItems` | Related item type/relation, identifier, creators, titles, year, volume, issue, number, pages, publisher, edition, and contributors. |

Required top-level cardinalities and required attributes become source issues with the original record, observation, and page identity. They do not replace missing values. Nested data is compared against the complete original property tree.

### Dublin Core

The Dublin Core profile retains all fifteen elements as ordered arrays:

| Original DC element | Output field |
| --- | --- |
| `dc:title` | `titles` |
| `dc:creator` | `creators` |
| `dc:subject` | `subjects` |
| `dc:description` | `descriptions` |
| `dc:publisher` | `publishers` |
| `dc:contributor` | `contributors` |
| `dc:date` | `dates` |
| `dc:type` | `types` |
| `dc:format` | `formats` |
| `dc:identifier` | `identifiers` |
| `dc:source` | `sources` |
| `dc:language` | `languages` |
| `dc:relation` | `relations` |
| `dc:coverage` | `coverages` |
| `dc:rights` | `rights` |

The title advisory follows the agreed CIIM source intake. OAI `about` nodes are retained independently as `sourceAbout`, preserving source-feed provenance and metadata licensing alongside the work's own `dc:rights`.

## Native configuration and artifacts

`runtime.mjs` verifies every declared JAR's byte length and SHA-256 before starting the original engine. The manifest pins `com.k-int.proteus:proteus-core:3.0.0`, the actual original class names, complete classpath, artifact provenance, and configuration. The runtime binding also records the runner hash and Java version/vendor/VM returned by the live process.

The runner calls `ComponentSpec.loadFile`, builds the original `Config` and `Context`, and evaluates each request through `context.inputMapper(new Input(input)).getComponent()`. The runner retains the original `com.k_int.proteus.serialization.ProteusMapper`, including its native specification property and enum conventions, and enables strict duplicate-key handling plus exact integer and decimal reads on that mapper. Its actual class is recorded and verified in the runtime execution binding. Native output is transported as the exact ObjectMapper response bytes with its byte length and hash.

The selected configuration is explicit:

```json
{
  "path_not_found_to_null": true,
  "path_parse_exception_to_null": false,
  "unbox_singletons": false,
  "empty_reads_to_null": false,
  "http_client": "disallowed",
  "enable_file_read": false,
  "enable_file_write": false,
  "enable_file_delete": false
}
```

The original accumulator is `Accumulators.first()`. JSON uses duplicate-key detection, big integers, and big decimals. XML conversion uses ordered `node_array` mixed content with string trimming, empty-element filtering, and blank mixed-string filtering explicitly disabled.

Original Proteus 3.0.0 returns null for some empty `for_each` and `flatten` results. The specifications use its native `fallback` with a literal empty array. The controller then verifies every actual source property and count.

The Java source launcher uses the existing Java compiler module. Default heap is 128 MiB; `--heap-mib`, `--timeout-ms`, `--java`, and `--python` select existing runtime settings. The default native response and retained-member limit is 256 MiB. Operations process one original page at a time and retain the complete result.

## Module API

| Module | Exports and responsibility |
| --- | --- |
| `profile.mjs` | `CONFIG`, `XML_SPEC`, `buildProfile(tagNames)`, full DataCite field catalog and nested layout. |
| `dc-profile.mjs` | `buildDcProfile(tagNames)`, full Dublin Core field catalog and source namespaces. |
| `runtime.mjs` | `openJavaTransform(options)` and `createEndpointTransform(options)`. Each transform returns native bytes and its original runtime binding. |
| `capture.mjs` | `transformCapture(options)`, `createPageReader(options)`, original/native mapping checks, and complete operation retention. |
| `page-source.py` | Original OAI parser adapter, observation identity/hash reproduction, and exact namespace spelling retention. |
| `ProteusBatch.java` | Sequential adapter around the selected original Proteus engine. |
| `report.mjs` | `renderReport({manifest, records})` produces the complete portable HTML review. |
| `cli.mjs` | Profile export and complete capture transform/continuation commands. |

`transformCapture` accepts `sourceFile`, `oaiSourceModule`, `pageReader`, `transform`, `directory`, `operationId`, optional `receiving`, and `onProgress`. It returns `{manifest, records, directory}`. Progress stages include `record-mapped`, `page-reopened`, and `complete`.

Export reference specifications without a source operation:

```sh
node cli.mjs specs --out /absolute/specifications
```

The actual transformation generates and retains the exact namespace-bound specification for each original record shape.

## Reopen the complete worked case

The accompanying `CIIM-Proteus-native-receiving-case.zip` retains the three original editions, original runtime manifest and JARs, page outputs, complete mapped records, and review pages. Unpack it and run the example from this maintained checkout:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/ciim-receiving/examples/ciim_20261012.mjs \
  --case /absolute/unpacked-case/case
```

The example binds the original 231-record DataCite edition, the 168-active-plus-one-deleted Dublin Core edition, and the restored 169-record edition to their original capture hashes. It verifies the complete retained runtime, runs or reopens their receiving operations, compares the same original deleted/restored identifier, and reopens the completed DataCite page results. It retains the complete `NATIVE-RESULT.json` and reports each source's output hashes.

Use `--sources-only` to read and verify the three original captured editions without starting Java. `--runtime`, `--oai-source-module`, and `--oai-python-directory` select the existing exact artifact manifest or original source-reader locations when they live outside this checkout. The published generic `cli.mjs transform` command remains the entry point for other institutional editions.

## Source references

- [Proteus component reference](https://docs.proteus.k-int.com/component-reference/)
- [Proteus getting started and native transformation endpoint](https://docs.proteus.k-int.com/)
- [Original Proteus source, selected tag proteus-3.0.0](https://gitlab.com/knowledge-integration/ciim/proteus/-/tree/proteus-3.0.0)
- [DataCite metadata schema 4.5](https://schema.datacite.org/meta/kernel-4.5/)
- [Dublin Core metadata element set](https://www.dublincore.org/specifications/dublin-core/dces/)
- [OAI-PMH protocol](https://www.openarchives.org/OAI/openarchivesprotocol.html)

Actual artifact URLs, checksums, original captures, and native edition results accompany the worked case. Institutional commercial terms and contact history stay with the original case owner.
