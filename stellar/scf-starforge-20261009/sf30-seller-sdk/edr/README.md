# Environmental Data Retrieval and CoverageJSON

This application turns an explicitly selected OGC API Environmental Data Retrieval (EDR) query into a retained native dataset, a browsable operator workspace, and an independently receivable project. It uses the maintained SF30 source, mapping, build, query, cursor, comparison and packet engine.

A query is a scientific selection: its geometry or location, parameter names, time or vertical interval, coordinate reference system, provider options and returned coverage matter. The application keeps the original request and every response beside the derived edition. It presents the returned coordinates, units, reference systems, calendar, range dimensions and source issues before the operator reviews a mapping.

## A complete customer workflow

1. Save the customer's selected endpoint and allowed origins. If its existing access needs an Authorization header, name a host environment variable; the workspace retains the variable name.
2. Browse the publisher's landing page, collection list and selected collection. Each browse operation retains one complete original response and its actual next link. The query menu comes from that collection's `data_queries`.
3. Save an explicit query, ordered parameter list, source rights and receiving limits. Review the original request before acquisition. The query URL must agree with the collection's advertised route.
4. Acquire the selected response chain and linked domain, range or tile documents. Each original GET, successful response, HTTP error and retry deadline belongs to the same retained operation. An interrupted acquisition continues that request.
5. Inspect coverage, returned coordinates, range order, missing cells, parameter metadata and source issues. Save a mapping bound to the endpoint, collection and exact CoverageJSON layout.
6. Build and query the native edition. Follow its native cursor to the end when checking a whole selection. A comparison uses two explicitly selected editions.
7. Export the exact project packet and dataset. A separate recipient imports the project, reconstructs the native build, runs the agreed query and reopens the same workspace. The dataset export includes its source-specific lineage.
8. Deliver source, configuration, notices, selection, reviewed mapping, receiving instructions and the actual accepted result. Assign ongoing provider access, retention, hosting and support to named owners.

For commissioning, the payer and technical and acceptance owners select one source, useful queries, permitted access, expected source window, retention and the receiving environment before execution. Provider waits and new output requirements must be accounted for in the agreed delivery. The original publisher demonstration below establishes a useful reproducible reference; customer acceptance belongs to the customer's own agreed selection.

## Original publisher reference

The retained example uses the pygeoapi demonstration's ICOADS collection. On 13 October 2026 the following original native HTTP requests completed:

| Resource | Actual response | SHA-256 |
| --- | --- | --- |
| Collection metadata | 200; 5,764 bytes | `9e234141986c61c5273543f1a23fb25f0bc078e9142ef04fda46791809ab23ad` |
| SST point series | 200; 2,885 bytes | `f97df145b4eac8e45323a8276dee1467f57c9bf23d24bd9c9eb9c6dc8976fd37` |
| SST and AIRT grid | 200; 4,714 bytes | `0b825c426849aabd94878f7e3bee708fc5b639d2694bae541b325f2f1b68a31e` |
| Unsupported parameter | 400; 118 bytes | `91b61e28595efe34c788834714d1b513f3439659590e6d32f2568d84ae297a85` |
| Conformance document | 200; 3,307 bytes | `5169d41df998168424c3145c098746330c679f8e9b14784cedd33cc2a3eafc6a` |

The original URLs, request headers, response headers, dates and complete raw bodies are retained in `delivery/publisher-responses.json`. Original response bodies are Base64 encoded so a source transfer preserves every byte. Their metadata records the actual Python urllib retrieval route.

Collection: [pygeoapi ICOADS metadata](https://demo.pygeoapi.io/master/collections/icoads-sst?f=json).
Original collection information: [NOAA ICOADS one-degree data](https://psl.noaa.gov/data/gridded/data.coads.1deg.html).

### Point selection

The original position request selects `POINT(150 0)`, parameter `SST`, and the interval `2000-01-01/2000-12-31`. The publisher returns a PointSeries with twelve time coordinates and twelve SST values at **x = 151.0, y = 1.0**. The application displays those returned coordinates alongside the requested point; it preserves the provider's spatial selection.

The original range uses `axisNames: ["t","y","x"]` and `shape: [12,1,1]`. Each value becomes one parameter cell. Original numeric tokens, such as `27.402271270751953`, are preserved in the default JSON-encoded native string column.

### Grid selection

The original cube request selects `bbox=149,-1,153,3`, parameters `SST,AIRT`, and `2000-01-01/2000-03-31`. It returns two ranges of shape `[3,3,3]`: **54 parameter cells across 27 domain positions**. Parameter-cell count is the receiving limit and native row count.

The regular x axis runs 149 to 153. The regular y axis runs **3 to -1**, retaining descending order. In each range the final axis x varies fastest. The application derives intermediate regular coordinates from the original start, stop and count using exact rational arithmetic.

### Time and provider errors

The returned Gregorian time strings contain fractional seconds and omit a zone. Inventory records the `gregorian-time-without-zone` source issue and keeps the strings and TemporalRS unchanged. The application does not append a zone or silently turn them into epoch timestamps.

The unsupported parameter request returned HTTP 400 with the publisher's code `InvalidParameterValue` and description `Invalid parameter-name`. This is retained provider evidence. It is available for an operator to diagnose the original selection; it is not treated as an empty successful dataset.

The complete one-response point and grid selections have no advertised next page. Their coverage scope is `selected-query-response`. That scope describes those exact selections, and does not assert receipt of the collection's entire history.

## Standard and service declarations

The current published EDR specification is version **1.2**, document **19-086r9**, published 8 September 2026. The inspected pygeoapi service itself advertises **EDR core 1.0** in its original conformance document. The application retains that service declaration independently of the current specification.

Primary references:

- [OGC EDR specification repository and published versions](https://github.com/opengeospatial/ogcapi-environmental-data-retrieval)
- [OGC CoverageJSON 1.0 Community Standard, 21-069r2](https://docs.ogc.org/cs/21-069r2/21-069r2.html)
- [Actual selected service conformance](https://demo.pygeoapi.io/master/conformance?f=json)

The supported input is an original CoverageJSON Coverage or CoverageCollection, with inline or linked domains and ranges. Supported ranges are NdArray and TiledNdArray; the operator selects one actual tile set. Primitive, tuple and polygon axes are supported. Custom axis encodings are reported as unsupported rather than guessed.

The source interpreter is deliberately explicit about unsupported or ambiguous input: malformed shapes, absent linked documents, multiple different next links, conflicting parameter definitions in collection and coverage scope, and selected routes absent from collection metadata fail before a derived native build. These failures preserve original source and request evidence for correction.

## Connection and query documents

A connection has `name`, `baseUrl`, optional `allowedOrigins`, and optional `authorizationEnv`. The base origin is always included. Every metadata, data, redirect, linked range and tile URL must remain within the selected origins. Authorization is attached only on the original base origin.

The complete query schema is `stellar-forge.edr-query.v1`:

```json
{
  "schema": "stellar-forge.edr-query.v1",
  "connectionId": "THE_ID_RETURNED_BY_SAVE_CONNECTION",
  "name": "ICOADS SST original 2000 point selection",
  "collectionUrl": "https://demo.pygeoapi.io/master/collections/icoads-sst?f=json",
  "queryType": "position",
  "queryUrl": "https://demo.pygeoapi.io/master/collections/icoads-sst/position",
  "params": [
    {"name": "coords", "value": "POINT(150 0)"},
    {"name": "parameter-name", "value": "SST"},
    {"name": "datetime", "value": "2000-01-01/2000-12-31"},
    {"name": "f", "value": "json"}
  ],
  "limits": {
    "maxPages": 16,
    "maxRows": 100000,
    "maxBytes": 67108864,
    "maxLinkedDocuments": 128
  },
  "tileSet": 0,
  "rights": {
    "license": null,
    "attribution": "pygeoapi demonstration / NOAA ICOADS",
    "usage": "Original public demonstration query; original publication and source terms retained for review.",
    "sourceUrl": "https://psl.noaa.gov/data/gridded/data.coads.1deg.html"
  }
}
```

The connection ID in this template is filled from the actual saved connection. Source license is left unknown because the inspected response did not establish an explicit license grant. A customer installation supplies the selected source's actual rights and retention instructions.

Query types are `position`, `radius`, `area`, `cube`, `trajectory`, `corridor`, `locations` and `items`; only a type actually advertised by the selected collection may run. A selected locations/items descendant retains its exact resource URL.

Query parameters are ordered strings. The application does not append format, pagination, CRS, time zone, resolution or provider-specific defaults. The example explicitly requests `f=json` because that is part of the original successful request. If a published query URL already has parameters, they remain unchanged when explicit additional parameters are appended.

The selected limits apply to the complete retained source:
- `maxPages`: original query responses, default 16, maximum 4,096;
- `maxRows`: parameter cells across all ranges, default 100,000, maximum 1,000,000;
- `maxBytes`: original successful metadata, coverage and linked-document bytes, default 64 MiB, bounded by the source carrier capacity;
- `maxLinkedDocuments`: selected domain, range and tile documents, default 128, maximum 4,096.

A response exceeding a selected value or byte limit is preserved as a provider document, and acquisition reports the limit failure. It does not silently truncate that response into a successful edition.

## Source interpretation and mapping

The original source ZIP contains a manifest, selected collection metadata, query pages and every linked document needed to interpret those pages. Optional originally captured landing and conformance documents may also be retained. Every member has an original response receipt with URL, status, length and SHA-256. The manifest accounts for every member. Receiving checks the complete paging chain and linked closure.

A native row represents one original parameter cell:
- original page, coverage position and range index;
- coverage ID if supplied;
- parameter name and complete original parameter metadata;
- named domain indices, exact returned coordinates and original bounds;
- original value, missing state and declared data type;
- original unit, reference systems and calendar.

The generated cell ID hashes the original page/coverage position, coverage ID, parameter, indices and exact coordinates. It is a receiving identity; it is not presented as a source observation identifier.

Default mapping binds the endpoint, collection ID and `coveragejson-layout-lexical-v1` schema identity. That identity contains the domain type, coordinate layout, reference systems, parameter definitions and range axis/data-type layout. Coordinate values and lengths may vary in a later edition while the reviewed layout remains the same.

The default native columns preserve cell ID, coverage ID, parameter, indices, coordinates, bounds, original value JSON, missing state, data type and unit, plus individual coordinate columns where available. Original JSON numbers remain lexical tokens through parsing and JSON encoding. A regular coordinate which cannot be represented by a finite decimal uses an explicit exact-rational object with numerator and denominator.

A reviewed mapping can choose a plain native integer or number column. That is an explicit conversion through the existing native type rules: integer values must fit the supported exact integer range, and native number columns use finite IEEE double precision. Structured tuples, polygons or rational coordinates require JSON encoding. Use `presence-json` when absent, null and present values must remain distinct.

`require-exhausted` is the default coverage policy. If acquisition stopped at its selected page bound, the operator can inspect the actual next link and explicitly choose `allow-partial`. The saved plan and receiving result retain that choice. Exhaustion always refers to the selected query response chain.

## Operations and continuity

Each browse or acquisition uses an explicit stable operation ID. The retained request binds the connection and resource, or the acquisition query and source label. The same ID cannot be reused for changed inputs. Every successful GET step can be resumed without making that request again. A complete retained response whose step record was interrupted is verified against its original request and receipt, then adopted before another GET. A provider 429 or 503 with a Retry-After value records a deadline; a continuation respects that original deadline.

Operation state, successful raw documents and actual failures remain in the original workspace. A completed acquisition returns its original source. Changing a selection creates a new saved query and operation; the original failed or partial request stays available for review.

The Activity view pages all eight collections: sources, plans, builds, comparisons, connections, queries, documents and operations. Its view SHA binds each page to the same retained inventory. If a view changes, restart explicitly from offset zero. Recent state summaries of documents and operations are capped, while their complete records remain available through the paged API.

## Native editions and independent receiving

The six-member project packet contains the original source, reviewed plan, native data.csv and dataset.json, native review and manifest. The packet bytes are deterministic and retained per build. A resumed download receives the exact same ZIP. Import reconstructs the build with the maintained native engine and verifies the original members.

The dataset directory contains data.csv, dataset.json and EDR lineage. The lineage binds source responses and rights, exact selection and coverage, source issues, mapping, build, native snapshot and the two native dataset files. Its create-only publication permits a continuation to fill missing exact files while preserving a completed export.

A recipient uses an independent workspace. Acceptance checks exact project bytes, source and plan identities, native build and snapshot, complete query traversal, exported data and cold reopen. Merchant configuration and buyer offer drafting are separate explicit product inputs. A public reference dataset does not supply payment terms, a seller account or a customer agreement.

## Operator, merchant and customer integration

The [provider client guide](PROVIDER_CLIENT.md) gives the complete configured-operator/MCP workflow, retained file receiving, seller and buyer commands, original native reference command and customer acceptance programme. It preserves explicit source rights and seller/payment selections.

## Source ownership and execution state

This application is additive under `sf30-seller-sdk/edr` and reuses the maintained XML source format / NativeEngine integration. It does not replace the existing ERDDAP, NetCDF, Connected Systems or SensorThings applications.

Original operation: `SCF-EDR-COVERAGEJSON-F1CB-20261013`.

The five original publisher HTTP responses are retained in full. The original native operation has completed both selected datasets: 12 point cells and 54 cube cells, complete cursor traversal, exact project and dataset exports, independent receiving and cold reopen. The publisher recipe preserves the initial extraction-array comparison receipt and separately verifies the native API's named-column row representation. The additional quarter-window acquisition, operator browser and installed receiving remain separate recorded phases; their results are reported only after those original operations finish.
