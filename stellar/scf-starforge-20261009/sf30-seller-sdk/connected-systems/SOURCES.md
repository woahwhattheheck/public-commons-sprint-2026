# Connected Systems source and compatibility record

This module implements a read-only JSON observation workflow against OGC API — Connected Systems. It retains original provider representations and passes reviewed observations to the existing SF30 dataset engine. The authored implementation is MIT-licensed; data-provider terms remain those recorded for each actual source.

## Primary standards

| Source | Role |
| --- | --- |
| [OGC API — Connected Systems Part 1, 23-001](https://docs.ogc.org/is/23-001/23-001.html) | Systems, procedures, deployments, sampling features and properties. |
| [OGC API — Connected Systems Part 2, 23-002](https://docs.ogc.org/is/23-002/23-002.html) | Datastream metadata, observation access and observation schemas. |
| [SWE Common Data Model, 24-014](https://docs.ogc.org/is/24-014/24-014.html) | Declared result fields, components, units, quality and nil-value definitions. |
| [Connected Systems developer guide, 23-053r1](https://docs.ogc.org/guides/23-053r1.pdf) | Publisher guidance and example client workflows. |
| [OGC developer portal](https://csapi.developer.ogc.org/) | Publisher-listed implementation and demonstration links. |

The original normative source review used [opengeospatial/ogcapi-connected-systems](https://github.com/opengeospatial/ogcapi-connected-systems) at commit `fb858be23aa03e2b824ec50b5a97ac2c2a1d3fec`, dated 2026-09-21. The published Part 1 and Part 2 standards identify version 1.0. The example OpenAPI document's own `info.version` is a separate artifact version and is not substituted for the published standard version.

These exact source blobs informed the adapter:

| Source definition | Git blob |
| --- | --- |
| Datastream | `bfc1f98cfd04b26b77221d108f061de3ceda5454` |
| Observation | `9f3e61fc04078fedac0612db60a84d4c6c64acda` |
| Observation schema | `59559287f9699bb112cf613257c6d965e39b0a8d` |
| Base stream | `5b2462dba62b62248382e4690f5540a6dc4d61f5` |
| Datastream schemas operation | `d111be6a16df86363596089d9b7ae3375b8507f5` |
| Datastream observations operation | `5dbce3d45e06a20832532aec1e8803e653cd779e` |
| Observation collection | `b92f166b3aa5df06bfef4a401bc14194da84c0d5` |
| SWE DataRecord | `b92d0b49877a78fb74e3d697b98c34081b547f7b` |
| SWE AbstractDataComponent | `944d6a1b6bf5b748f60a60135eea9492dba58905` |
| SWE AbstractSimpleComponent | `c772420d5c6ed429faae2e0d2213a8846abfe483` |
| Scalar observation-schema example | `f1da3dd85359b8299b846d55931d3f2d781642bc` |
| Scalar JSON Schema example | `c70feec9cf8fc42307d2c06005b14404a481141d` |

## Implemented profile

The acquisition path accepts JSON observation collections with their original item identifiers, datastream identities and result times. It retains result objects and result links as supplied. It follows the exact returned next links within the reviewed endpoint/origin boundary, preserving ordered query pairs and HTTP response bodies.

The source reader preserves JSON number tokens without binary floating-point conversion. It rejects duplicate object keys and non-finite number spellings. It distinguishes absent values from explicit nulls when the reviewed mapping uses presence-preserving JSON cells. Repeated and conflicting observation IDs remain in original order and are reported. Full source schemas, including unfamiliar nested fields, remain available even when the suggested tabular projection only includes supported scalar components.

The declared SWE/JSON schema is part of source and mapping identity. The before/after schema comparison detects structural changes during acquisition. It is not a transactional snapshot assertion about a changing provider. The recorded consistency model is sequential pages, and a page-limited window stays explicitly partial.

The operator's schema inspection supports declared SWE records/vectors and JSON Schema object properties. It is not a complete external JSON Schema resolver or a universal SWE binary decoder. Binary observations, WebSocket subscriptions, write-side system/task control and inferred conversions are outside this read-only JSON implementation.

## Original native engine

The implementation composes the maintained XML workspace and SF30 dataset engine. The source projection changes with this source family; query, snapshot, CSV loading, retained comparison and customer reconstruction remain the original implementations.

The selected source review at public sprint commit `6b99bc35655e97d274729e5edc6a672bb3edafac` retained:

| Maintained file | Git blob | Bytes |
| --- | --- | ---: |
| `xml/workspace.py` | `24c4fb7ccf08f6d350bcfb4eae6accc251a60a4e` | 36,232 |
| `xml/xml_source.py` | `8f02d9545ae2959f354cff555ddb0e8595f1b8e0` | 17,648 |
| `xml/native.mjs` | `b335d4148f82cc40b3d5bdb08891c0d6b98f67ac` | 1,629 |
| `dataset-handler.mjs` | `8da9ef8bddbc560aabe1a74f59c258e29f18d5a9` | 35,553 |
| `dataset-cli.mjs` | `95ed4f2db87385e6d8d8fd0d83f5ac566d93519b` | 9,159 |
| `dataset-refresh/versions.mjs` | `fe4261675844ca6e2ab89ad59fdc14fff9f1f8e3` | 35,627 |
| `dataset-refresh/service.mjs` | `d6373662efe5548c05a2585848b5aada1cc1785f` | 12,878 |
| `dataset-refresh/buyer-handoff.mjs` | `0cd8500dba422a826b54033580f74cb2237f5539` | 6,381 |

The native pipe reports the actual executing dataset-handler Git content hash. A receiving result records that runtime fact and the actual native snapshot rather than assuming that a later installed engine has unchanged bytes.

Merchant serving uses the existing SF30 seller and payment dependencies. Buyer setup and execution use the existing SF88 operator/account/approval lifecycle. MCP uses the original merchant host, retained-file reader and distribution application runtime. None of those paths are replaced by an approximate query, payment or private-state implementation.

## Public implementation discovery

Publisher links and the observed native response are recorded separately. A landing page or a search-index example does not prove that an observation endpoint is currently operational.

- The OGC developer portal lists OpenSensorHub at [the published demonstration landing](https://129-80-248-53.sslip.io/sensorhub/api) and the Go implementation at [its published landing](https://129-80-248-53.sslip.io/csapi-go-v2/).
- The [OpenSensorHub connection guide](https://github.com/opensensorhub/osh-docs/blob/master/docs/osh-connect/connected-systems.md) describes its public demonstration routes and JSON format selection.
- [52North's implementation page](https://52north.org/software/software-components/ogc-api-connected-systems/) describes its Connected Systems implementation and environmental applications. Its [published demonstration](https://csa.demo.52north.org/connected-systems?f=html) and [OpenAPI document](https://csa.demo.52north.org/openapi) were inspected as provider sources.
- The [52North implementation source](https://github.com/52North/connected-systems-pygeoapi) is an independent provider implementation. It is not vendored by this module.

Native discovery on 2026-10-12 obtained these complete responses before selecting an observation source:

| Native response | HTTP / bytes | SHA256 |
| --- | --- | --- |
| OpenSensorHub published landing, 19:03:42 UTC | 200 / 2,390 | `9ae8f4f1b7d630c75aa1796b877fb3cc746f9cde9bc8f7e206183ba50d46ef42` |
| OpenSensorHub conformance, 19:03:51 UTC | 200 / 2,565 | `e39ed0f2f90a0d27db23ccc79be0bc01a2d02cbaf70033fd6334718e10bf0747` |
| Canonical OS4 datastream collection with explicit JSON, 19:43:58 UTC | 500 / 57 | `a557f3385b68f66f2086e09fd56b846ad5549002980c9eac3a1b6d5f57b28358` |
| Published Go datastream route, 19:15:41 UTC | 500 / 34 | `de247f7330309a88aaa3138b436c8e5c01708d7cc1130c80493880df59830b9d` |
| Previously published Testbed 18 datastream ID, 19:43:51 UTC | 404 / 54 | `b77856c529b7dfda5ece7e90a74ef7a841584ce6c2604f769365133836d843c4` |
| 52North OpenAPI, 20:02:28 UTC | 200 / 136,845 | `1263bd677498a68d201faabf2609b3bd538f6e1ce9288b46811bc94df144323c` |
| 52North Connected Systems landing, 20:02:37 UTC | 200 / 4,917 | `631e87f470bfacadcf6bb3e63ca0f4d0d9d8fec9ad40f1200a6728727249360d` |
| Published GeoRobotix demo1 datastream collection, response Date 20:02:29 UTC | 502 / 332 | `8128514a9917b6dcdf20f7ee24d6b00a27b2a6aa0f971acb988f358f25ac4005` |

Times in this table are actual provider Date headers. The full intake records also retain local request/completion times and exact request/final URLs. The demo1 Date precedes its local request time; both facts are retained rather than rewriting the header.

The OS4 landing points to the canonical `os4csapi-osh.duckdns.org` resource URLs. Its observed collection error body is the provider's complete JSON internal-server-error response. The Go root and its advertised operations must be checked separately from the OSH implementation. The 52North landing advertises datastream/observation links while the returned OpenAPI document only lists Part 1 paths and a localhost server placeholder. These are actual publication differences, not reasons to silently invent a datastream, schema or observation.

Successful discovery is not an accepted observation capture. An accepted source carries its complete original datastream, schema before/after, observation pages, HTTP receipts, coverage outcome and recorded rights. The template files under `examples/` are configuration examples using `example.invalid`; they contain no captured provider data.

## Release acceptance record

Use the actual receiving outputs associated with a release to establish execution state. Source publication, syntax validation, an HTTP discovery response, native edition completion, browser completion and independent installed receiving are separate facts.

The maintained native receiving helper records original input identities, phases, complete native cursor traversal, merchant dataset export, exact project export, independent reconstructed rows and cold reopen. The browser owner consumes that same closed workspace and its explicit coverage choice. A failed stage retains its original progress and output identities; later completion is appended through that original operation.

At the source publication stage, an endpoint failure remains a preserved provider failure and is not substituted with a generated observation collection. Actual successful native/browser/installed result identities belong in the completed release's delivery receipt.

### Follow-through on the advertised 52°North resources

The same read-only diagnosis then followed the exact public resource paths. The
system response below is original SensorML metadata; it is not an observation
capture. The Part 2 request failures remain retained as failures.

| Exact request | HTTP | Bytes | SHA-256 |
|---|---:|---:|---|
| https://csa.demo.52north.org/datastreams?f=json&limit=3 | 500 | 265 | ae5163256b944013e27cbef0d2bcd33a6dacbb92463509f91d5f3df782142910 |
| https://csa.demo.52north.org/systems/YSI599503-00-1?f=application/sml%2Bjson | 200 | 255 | 84247959cacfe9599b84a451490c43e9b605652043f1fb319fa8754bbbd134d8 |
| https://os4csapi-osh.duckdns.org/sensorhub/api/systems?f=json&limit=1 | 500 | 57 | a557f3385b68f66f2086e09fd56b846ad5549002980c9eac3a1b6d5f57b28358 |

The exact response bodies and selected original HTTP headers are available in
[discovery-receipts.json](sources/discovery-receipts.json). The published
52°North [Part 2 route source](https://github.com/52North/connected-systems-pygeoapi/blob/main/connected-systems-api/routes/csa.py)
uses a separate observation provider through its API implementation. That source
is useful for diagnosis; it does not establish the deployed server's internal
error cause or its exact running revision. The source Git tree was
`6ad75aa7fbfc76517c8a24c21446471845007855`, route blob
`a1be9b8964c75a31f18012b53f3a00414c6ce10d`, and API blob
`1f79120772a9c240edb83cceacaed3a6e8da375d`.

## Original committed publisher reference

The product recipe receives unmodified original example files from [opengeospatial/ogcapi-connected-systems at `fb858be23aa03e2b824ec50b5a97ac2c2a1d3fec`](https://github.com/opengeospatial/ogcapi-connected-systems/tree/fb858be23aa03e2b824ec50b5a97ac2c2a1d3fec). These are illustrative publisher examples. They do not replace the retained actual error receipts from the public implementations, and they are not field observations.

| Original resource | Bytes | SHA256 |
| --- | ---: | --- |
| [api/part2/openapi/examples/datastreams/datastream-simple.json](https://github.com/opengeospatial/ogcapi-connected-systems/blob/fb858be23aa03e2b824ec50b5a97ac2c2a1d3fec/api/part2/openapi/examples/datastreams/datastream-simple.json) | 1238 | `75e43bcfa85af757f22f5ef3e248e8cdfead1cd44d16ecf896459c4c9b1e2000` |
| [api/part2/openapi/examples/observations/obs-simple.json](https://github.com/opengeospatial/ogcapi-connected-systems/blob/fb858be23aa03e2b824ec50b5a97ac2c2a1d3fec/api/part2/openapi/examples/observations/obs-simple.json) | 178 | `57aa8e6b29c4a054ec6bcce4dd6f6a0b16d9bb00263b5b04fe91f8dc65f17fba` |
| [api/part2/openapi/examples/schemas/observationSchema-scalar-json.json](https://github.com/opengeospatial/ogcapi-connected-systems/blob/fb858be23aa03e2b824ec50b5a97ac2c2a1d3fec/api/part2/openapi/examples/schemas/observationSchema-scalar-json.json) | 633 | `918c8541367b4b851768e72989314400a7f492aea3df44b4044d5cbf175476bf` |
| [api/part1/openapi/examples/systems/thermometer-sensor-sml.json](https://github.com/opengeospatial/ogcapi-connected-systems/blob/fb858be23aa03e2b824ec50b5a97ac2c2a1d3fec/api/part1/openapi/examples/systems/thermometer-sensor-sml.json) | 853 | `f27c4b096ad3de331a09cd2f082200bb03232f9560efa00fa911ef3821bfa54e` |
| [LICENSE](https://github.com/opengeospatial/ogcapi-connected-systems/blob/fb858be23aa03e2b824ec50b5a97ac2c2a1d3fec/LICENSE) | 4443 | `b3b9a76d230f057844d004c374406453d92f863caecaa42ccd9c7863e143fed1` |

The observation ID is `1h6pmb3ntfmogfppknk9aefpvs`, datastream ID `958tf25kjm2f6`, phenomenon/result time `2021-03-15T04:53:34Z`, and result `23.5`. The declared scalar quantity uses `Cel`. The recipe verifies all original HTTP response bodies against these committed resource identities and preserves the source's original labels, time interval and nil declarations.

The original 4,443-byte license is retained unchanged as `examples/ogc-connected-systems-LICENSE.txt`. Its permission and attribution requirements govern these examples; the authored consumer's MIT notice does not replace the publisher license. No OGC certification or endorsement is claimed. `delivery/publisher-example.py` selects the explicit single-observation mode so the original 178-byte object is never rewritten into a collection response.

### Actual publisher acquisition and schema URL correction

The original acquisition received the committed datastream body over HTTP at provider Date `Mon, 12 Oct 2026 20:38:13 GMT`: status 200, 1,238 bytes, SHA256 `75e43bcfa85af757f22f5ef3e248e8cdfead1cd44d16ecf896459c4c9b1e2000`. Its next schema request included the consumer's automatic `?obsFormat=application%2Fjson` parameter and failed at proxy CONNECT with `403 Forbidden`. No schema response status or body was received, so this transport failure is not represented as an HTTP 403 response from the publisher.

The exact original receipt and failed attempt are retained in [publisher-request-evidence.json](sources/publisher-request-evidence.json). The application now exposes explicit `schemaUrlPolicy: "exact"` for static schema resources, while keeping the existing live-service format-parameter default and prior query identities. The recipe retains the failed query/operation and links a distinct corrected acquisition within the same original reference operation. Its original native/receiving result determines completion; the URL-policy correction alone is not evidence of success.

### Completed original native receiving

The original `ogc-room-temperature-reference-v1` operation completed on 12 October 2026. Its [full native and publisher result](examples/ogc-room-temperature-native-result.json) retains the original failed request linkage, corrected exact-schema query, body-to-commit checks, source identity, native build and independent receiver result.

- Source: `2bdad5aeac5282f6750afd9e9d3b85d9b6e188464cbcf90f9190ba74224c2541`, 3916 bytes.
- Build: `c87829609aeeef2790ac7ac91d283b9e0a7590e628c6a747281c886199d66879`; snapshot: `682277ab88cf03fc229118faca289c61d1f19e05ca3c41403d72991460edb0e0`.
- Exact producer and receiver project: 6137 bytes, SHA256 `976fbe48b0264411d776bb76469bb9fc1e0fd13d6e175c9251f8f45736a19a1a`.
- Original ordered-row SHA256: `c03940247aa9d60d4dc2a324c009f06759f77dbd34417d2aa4edefdaf31c548f`.
- Scope: one original observation resource, one page, one row, exhausted within that explicitly selected resource.
- The publisher observation retains its exact source-byte SHA256 `57aa8e6b29c4a054ec6bcce4dd6f6a0b16d9bb00263b5b04fe91f8dc65f17fba`; native original-observation cells and the independent receiver's reopened cells were verified.

These native results do not imply browser completion, paid acquisition, a live field feed or acceptance of the separately failed demonstration services.

The original [source packet](examples/ogc-room-temperature.connected-systems) and [complete native project](examples/ogc-room-temperature.connected-systems.zip) are retained byte-for-byte with this source release. The project contains six members: manifest, original source packet, original mapping, data CSV, dataset metadata and expected native review. Its immutable original source is 3916 bytes; the complete project is 6137 bytes. Both exact artifact SHA256 values above were independently rechecked from the saved files before source publication.
