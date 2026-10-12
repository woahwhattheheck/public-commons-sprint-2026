# Haystack source and semantic operations

This workspace reads, reviews and delivers complete **Haystack JSON v4 grids**. The two native modules use Node builtins and preserve the supplied Haystack values. The operator workspace retains the original source bytes separately from every reviewed edition.

## Import and export contract

Use format **json-v4** for both parseGrid and encodeGrid. A v4 grid has the _kind discriminator "grid", a metadata dictionary, an ordered column list, and dictionary rows. The grid metadata version is **"3.0"**. This is the grid protocol version used in the current JSON v4 examples; it is not an instruction to decode the earlier JSON v3 string convention.

The supported shape is:

~~~json
{
  "_kind": "grid",
  "meta": {"ver": "3.0"},
  "cols": [
    {"name": "id", "meta": {"dis": "Original identifier"}},
    {"name": "site"}
  ],
  "rows": [
    {
      "id": {"_kind": "ref", "val": "example-site"},
      "site": {"_kind": "marker"}
    }
  ]
}
~~~

That small example illustrates the wire format. The complete original building input for the operating journey is fixture-charlie.json, obtained from Project Haystack's Charlie download. Its donor-provided metadata and every supplied row remain in that file.

The codec keeps:

- The order and complete contents of grid columns, their metadata, grid metadata and rows.
- Explicit null cells separately from absent row members.
- Ref identifiers and optional ref display strings as distinct fields.
- Number units, typed special numbers, date/time strings, explicit offsets and timezone names.
- Lists, nested dictionaries, nested grids, URI strings, symbols and vendor XStr values.
- Original members whose names fall outside the Haystack dict-name grammar. These members remain in the retained JSON tree and source download, while semantic indexing ignores them according to the JSON dictionary rule.

A column name must begin with an ASCII lowercase letter and continue with ASCII letters, digits or underscores. Column names must be unique. A valid row tag absent from the column list produces a review diagnostic; its value remains present. Accepted edits which introduce a tag must also introduce the corresponding column in the derived grid.

Typed values have the following forms:

| Value | JSON v4 representation |
| --- | --- |
| Null | null |
| Boolean | true or false |
| String | A JSON string |
| Ordinary unitless number | A finite JSON number |
| Number with a unit | {"_kind":"number","val":23.5,"unit":"°C"} |
| Special number | {"_kind":"number","val":"INF"}, "-INF", or "NaN" |
| Marker | {"_kind":"marker"} |
| Removal value | {"_kind":"remove"} |
| Not available | {"_kind":"na"} |
| Reference | {"_kind":"ref","val":"opaque-id","dis":"Optional display"} |
| Symbol | {"_kind":"symbol","val":"elec-meter"} |
| Date | {"_kind":"date","val":"2026-10-12"} |
| Time | {"_kind":"time","val":"14:30:00.125"} |
| Date and time | {"_kind":"dateTime","val":"2026-10-12T10:30:00-04:00","tz":"New_York"} |
| URI | {"_kind":"uri","val":"relative/or/absolute-reference"} |
| Coordinates | {"_kind":"coord","lat":37.54,"lng":-77.44} |
| Extended string | {"_kind":"xstr","type":"Color","val":"red"} |
| List | An ordered JSON array of values |
| Dictionary | A JSON object, optionally with "_kind":"dict" |
| Grid | The complete grid object shown above |

The current Kinds contract permits a unit on INF and -INF but discourages it; this codec retains it with a warning. A unit on NaN is rejected. This follows the current official Kinds documentation where its guidance differs from the older linked Hayson schema.

All Date, Time and DateTime components are checked as actual calendar/time fields. Timestamp text, fractional precision and explicit offsets are preserved instead of being converted through JavaScript Date. When a DateTime omits tz, Haystack's logical default is GMT; the optional member stays absent in the retained value. A timestamp without an explicit offset remains a literal timestamp with a diagnostic. Timezone names use the zoneinfo city-name convention, and the core performs no timezone conversion or alias substitution.

Numbers use the Haystack IEEE 754 representation. Integer-valued inputs outside JavaScript's exact integer range produce a diagnostic. The original numeric token remains in the retained source bytes. Negative zero is preserved by the codec's derived JSON serializer. The operator transport and storage must likewise preserve signed zero when carrying proposed edits.

## Original source identity

parseGrid accepts a UTF-8 string, Buffer or Uint8Array. It returns:

~~~js
{
  grid,                    // complete native JSON data tree
  diagnostics,             // findings from the original decode
  source: {
    sha256,                // SHA-256 of the complete supplied UTF-8 bytes
    bytes,                 // complete original byte count
    format: "json-v4",
    mediaType: "application/json",
    bom                    // whether original bytes contain a UTF-8 BOM
  }
}
~~~

A byte-order mark, whitespace, property order or escape spelling changes the source hash even when the parsed values are equivalent. The hash identifies the original file, not a normalized reconstruction. Keep the original bytes and their format with the source record. Verify their size and hash whenever reopening or receiving that record.

encodeGrid creates a derived JSON file from a complete validated grid. Its default is two-space indentation and a final newline; indent may be 0 through 8. This operation is appropriate for an accepted edited edition. Downloading an original file reads the retained original bytes directly.

Duplicate JSON member names are rejected before a later value can overwrite an earlier one. Invalid UTF-8, unpaired Unicode surrogates, nonfinite bare JSON numbers, malformed typed members, duplicate columns, invalid calendar fields and unsupported formats raise HaystackError with status 400, a stable code and a details.path JSON pointer where applicable. The codec limits value nesting to 128 levels. Undefined values, holes in arrays, cyclic objects, accessor properties and non-JSON objects are rejected by the in-process validation boundary.

validateGrid and validateValue return {valid:true, diagnostics} on structurally accepted input. They leave their input unchanged. Semantic findings do not delete rows or prevent the operator from reviewing a source. All diagnostic collections are complete.

## Source-local entity identity

analyzeGrids accepts the explicitly selected original grids:

~~~js
const analysis = analyzeGrids([
  {sourceId: originalSha256, grid}
]);
~~~

An empty array returns a valid empty analysis. Select each sourceId once.

Each original row has the durable key sourceId + ":" + zeroBasedRowIndex. Every record includes its complete tags, original sourceId and rowIndex, opaque ref id or null, display string, explicit marker roles, siteRef, equipRef, kind and unit. Additional fields retain all markers, outgoing relation IDs, diagnostic IDs and reference counts.

An entity ID is unique only within its source context. The index builds a separate identifier map for every sourceId. A ref is resolved when precisely one row in that source carries the matching typed id. It is ambiguous when several rows match, and unresolved when none does.

Every relation supplies:

~~~js
{
  id,
  sourceId,
  fromKey,
  tag,
  path,                    // complete original value path
  targetId,
  targetKeys,              // every matching key in this source
  state,                   // resolved, unresolved, or ambiguous
  crossSourceCandidateKeys,
  suppliedDisplay          // only when present in the ref
}
~~~

Matching identifiers in another selected source are retained as crossSourceCandidateKeys. They never become a resolved target merely because their text matches. Multiple targetKeys are retained together; the index chooses no arbitrary duplicate.

Refs in top-level row tags, lists and nested dictionaries are indexed with their exact value paths. The row's own id identifies the row and is excluded from its outgoing relationships. Nested grids remain complete independent values with their own recorded row/column counts and paths in analysis.nestedGrids. Their internal rows do not enter the outer grid's entity namespace.

## Semantic review

The index recognizes explicit site, equip, point, space, system, device, weatherStation and weather markers. It does not infer a marker from an identifier, display name, column heading or a string which resembles a legacy encoding.

Its diagnostics cover:

- Missing or incorrectly typed entity IDs, duplicate source-local IDs, marker-kind differences and display tag kinds.
- Required site/equipment or weather-station refs, unresolved and ambiguous refs, standard target-marker mismatches and cached ref display differences.
- Exactly one sensor/cmd/sp/synthetic point function, declared point kinds, unit and enumeration metadata, current/write-value kinds and literal unit differences.
- Numeric range kinds, unavailable bounds, differing supplied units and reversed same-unit bounds.
- Historized-point timezone and mode metadata, literal parent/point timezone differences, original status values and write-level metadata.
- Equipment/site inconsistencies, equipment containment cycles and space containment cycles.
- Haystack error-response metadata and codec-level findings in the effective grid.

Weather observations use the source-local weatherStationRef relationship rather than having site/equipment containment invented for them. Every role remains visible on the original row; weather observations which also carry point are included in both applicable role counts. Donor-provided metadata counts are retained separately in the original grid.

Unit comparisons are literal comparisons of supplied strings. No engineering units are converted. A range whose endpoint units differ is retained for review without comparing converted magnitudes. Timezone diagnostics compare literal source tags; they do not claim that two city names have equivalent historical offset rules.

A containment cycle is detected once with the complete set of member keys. Each member record links to that diagnostic. Cycle search follows only unambiguous, source-local containment links whose target carries the required role.

Diagnostic IDs derive deterministically from code, original source, row, tag and exact path. Reopening the same content yields the same IDs. A corrected effective value can remove its current finding while the original source still retains the findings observed at import. The operator layer presents these as current diagnostics and originalSourceDiagnostics respectively.

The complete analysis contains records, relations, diagnostics, counts, sources and nestedGrids. counts includes each role, relation state, diagnostic severity and source/record total. These complete arrays are suitable for the workspace's original revisioned paging and export boundaries.

## Compare source editions deliberately

For edits within one retained source, compare original sourceId/rowIndex keys and exact tag presence/value. A missing member differs from an explicit null.

When a system supplies a later export, its original bytes produce a new sourceId. Comparing the same textual ref across two different files requires an explicit operator-selected source pair. The workspace's sourcePairs[{beforeSourceId,afterSourceId}] records that choice. Within such a pair, use a unique typed ID in each source; duplicate or unidentified records retain their original row identities. Preserve both source files, their complete grid metadata and every reviewed edit with the saved editions.

Changing a display string, unit or tag does not rewrite the original source record. A reviewed edit carries its complete prior presence/value and proposed presence/value, so an intervening source/edit change can be detected before acceptance.

## Use the core directly

Run this from the complete product directory:

~~~sh
node --input-type=module <<'NODE'
import { readFile, writeFile } from 'node:fs/promises';
import { parseGrid, encodeGrid, valueKind } from './haystack-types.mjs';
import { analyzeGrids } from './haystack-index.mjs';

const original = await readFile('fixture-charlie.json');
const parsed = parseGrid(original, {format: 'json-v4'});
const analysis = analyzeGrids([{sourceId: parsed.source.sha256, grid: parsed.grid}]);

console.log(JSON.stringify({
  source: parsed.source,
  counts: analysis.counts,
  firstIdentifierKind: valueKind(parsed.grid.rows[0]?.id)
}, null, 2));

await writeFile('charlie-derived-v4.json',
  encodeGrid(parsed.grid, {format: 'json-v4', indent: 2}),
  {flag: 'wx'});
NODE
~~~

The complete operator guide describes native import, record/reference review, proposed changes, acceptance, source selection, editions, comparison and full editable application receiving. These two modules provide the same semantics to browser, CLI, HTTP, SDK and merchant operations.

## Compatibility and authoritative sources

JSON v3 and Zinc have different wire grammars. In JSON v3, values such as refs and markers use prefixed strings, and column metadata is placed differently. Zinc also has its own scalars, escaping, metadata and nested-grid grammar. The product advertises json-v4 explicitly and returns its supported format for another format selection. Obtain a real JSON v4 export from a source system when preparing a file for this workspace; changing a header or wrapping legacy values in a v4 grid does not convert their types.

The current upstream documentation was read on 2026-10-12. Project Haystack's public documentation identifies its version as 4.0.0 dated 2026-09-02. The complete original JSON and Kinds documentation files, with their hashes and pinned Git identities, are retained as source text in fixtures.json. Their code examples include historical illustration defects; the product's building journey uses the complete Charlie download.

Primary references:

- JSON: https://project-haystack.org/doc/docHaystack/Json
- Kinds and naming: https://project-haystack.org/doc/docHaystack/Kinds
- Sites: https://project-haystack.org/doc/docHaystack/Sites
- Equipment: https://project-haystack.org/doc/docHaystack/Equips
- Points: https://project-haystack.org/doc/docHaystack/Points
- Weather: https://project-haystack.org/doc/docHaystack/Weather
- Relationships: https://project-haystack.org/doc/docHaystack/Relationships
- Timezones: https://project-haystack.org/doc/docHaystack/TimeZones
- Zinc: https://project-haystack.org/doc/docHaystack/Zinc
- Original example: https://project-haystack.org/example/charlie
- Original JSON: https://project-haystack.org/example/download/charlie.json

The documentation's linked Hayson schema is a historical reference:
https://raw.githubusercontent.com/j2inn/hayson/master/hayson-json-schema.json .
The retrieved file is 11,581 bytes with SHA-256
4d20d511ed73706cfa6440725260eb3966e875676d90117c7e3e8c32a5a55742.
The current official JSON/Kinds text governs the supported null value, ignored dictionary names and infinity-unit rules where the linked schema differs.

The retained upstream documentation and example data are licensed under AFL3. HAYSTACK_LICENSE.txt is the complete original Project Haystack license, Git blob c43f496ad2490301945b951ff3d53c2e2832d00c, 10,289 bytes, SHA-256 f75c46802a91d13e060f6ea50390353ba44640a4d0709d0a4ba38a9d1c820aa0. The newly authored codec, index and operating text are part of the surrounding product under its LICENSE. Upstream source text and data retain their original attribution and license.
