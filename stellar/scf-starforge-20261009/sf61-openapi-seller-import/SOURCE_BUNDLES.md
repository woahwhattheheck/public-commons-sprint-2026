# Local OpenAPI source bundles

Prepare a merchant from an API description split across JSON and YAML files. The
source packet retains the entry document and every referenced source, including
original UTF-8 bytes, comments, byte-order marks and line endings. The existing
SF61 importer and API merchant workspace consume the packet directly.

## Capture the source project

Use the maintained merchant installation and its original `openapi` command:

```sh
starforge openapi source create \
  --root /absolute/api-project \
  --entry api/openapi.yaml \
  --out /absolute/private/station-source.json
```

`--entry` is relative to `--root`, or an absolute file within it. Relative `$ref`
paths resolve from the file containing each reference. A file may refer to its own
fragments, siblings, or parent directories within the selected root. Only files
reached through structural references are captured. Source paths containing
symlinks are rejected. The capture checks opened files and repeats the source
hash checks after traversing the graph.

The output file is published complete, create-only and mode 0600. Repeating the
same capture into the same completed output returns its existing identity.
Changed input requires a new output filename. Keep these packets in a private
project directory: API descriptions can contain private examples and operational
metadata. The source capture does not read unrelated files in the project.

For a source checkout, replace `starforge openapi source` with:

```sh
node stellar/scf-starforge-20261009/sf61-openapi-seller-import/cli.mjs source
```

JSON sources use Node's native parser. YAML uses the original SF61 dependency
`yaml@2.9.1`, with the same YAML 1.2, unique-key and alias rules as ordinary
single-file imports. `starforge doctor --feature openapi` checks that original
dependency group. Install the original group's dependencies for YAML projects.

## Use the original merchant workflow

The regular importer accepts the packet as its source:

```sh
starforge openapi \
  --spec /absolute/private/station-source.json \
  --config /absolute/private/selections.json \
  --out /absolute/private/compiled-station
```

Existing `--service-bindings` and `--upstream-bindings` options work unchanged.
Selections retain their explicit operation, server choice and ordered payment
options. Request metadata, declared response contracts and dynamic route
materialization use the existing compiler and runtime.

For browser authoring, start the original workspace:

```sh
starforge openapi-workspace --out-parent /absolute/private/merchant-projects
```

Upload `station-source.json` in **Load your API description**. Select and price
operations, validate the configuration, save a new package and use its existing
seller controls. The source packet stays intact in `original-openapi.json` inside
the saved package. Its existing merchant manifest binds the entire packet, and
reopening rebuilds the same source graph. Backend credentials continue to use the
original named environment bindings.

The existing `parseOpenApiSource(text)` result still exposes `document` and
`format`. Packets return `format: 'json'`, preserving the workspace's existing
source-file convention, plus an optional `sourceBundle` summary for callers that
want to display source provenance. This also lets existing source-refresh tools
consume retained split-file projects through their normal parser.

## Inspect, restore and revise

Inspect the exact retained sources and the reference graph:

```sh
starforge openapi source inspect --bundle /absolute/private/station-source.json
```

The summary includes root-relative filenames, format, byte count, SHA-256,
source-set identity, normalized document identity and reference edges. Each edge
records its referring file and JSON Pointer, original reference, target file and
pointer, semantic kind, and generated local reference. Example bodies and raw
source text remain in the packet rather than the summary.

Restore the original project into a new private directory:

```sh
starforge openapi source extract \
  --bundle /absolute/private/station-source.json \
  --out /absolute/private/restored-station
```

Original files appear under `restored-station/sources/`; the completed directory
also carries the same `source-bundle.json`. A repeated complete extraction checks
and reopens those files. It preserves edited destinations by reporting a mismatch
rather than overwriting them. An interrupted extraction without its completion
packet can be retained for inspection; extract into a fresh directory.

Edit the restored source files and capture a new packet to make a new source
revision. The old merchant package retains its original source identity. To hand
a self-contained API document to another tool, use:

```sh
starforge openapi source document \
  --bundle /absolute/private/station-source.json \
  --out /absolute/private/station-openapi.json
```

The document contains generated document-local references under
`x-stellar-source-targets`. Keep the original packet alongside it to retain source
bytes and source-to-target mapping.

## Reference semantics and limits

The adapter follows OpenAPI 3.0/3.1 structural `$ref` positions: path items,
parameters, request bodies, responses, headers, examples, callbacks, links,
security schemes and nested schemas. Local `operationRef` links are rebased too.
Schema property names and component names beginning `x-` remain ordinary names.
Free-form example values, schema examples/defaults/constants and extension
payloads remain literal data, including any `$ref` keys they contain. OpenAPI
3.0 reference siblings keep the original compiler's ignored-sibling semantics.

A work queue retains shared targets and cycles as references. The original
compiler applies its existing selected-operation and schema restrictions. The
bundle adapter rejects remote/absolute file references, escaping paths, malformed
pointers, named anchors, and schema resource/dynamic identifiers. External example
URLs and unrelated metadata URLs remain declarations; the adapter does not fetch
them. Generated output is for the existing SF61 compiler's supported API subset.

Limits match the original source path: 4 MiB total source text, 4 MiB serialized
packet and normalized document, 128 source files, 4,096 distinct reference targets,
50,000 JSON nodes and 48 structural levels. The original compiler's additional
expanded-schema and payment-header limits still apply. Packet opening validates
all embedded bytes and rebuilds the graph using only the embedded source map.

The implementation follows the document-structure and relative-reference sections
of the [OpenAPI 3.1 specification](https://spec.openapis.org/oas/v3.1.0.html#relative-references-in-uris)
and [OpenAPI 3.0 specification](https://spec.openapis.org/oas/v3.0.3.html#relative-references-in-urls).

## Native workflow exercise

```sh
node stellar/scf-starforge-20261009/sf61-openapi-seller-import/source-bundle-acceptance.mjs
```

The single exercise captures a six-file API, preserves BOM/CRLF and example data,
compiles ordered original offers, restores and reopens source, exercises rejected
source changes and path/reference cases, then uses the real original workspace
HTTP endpoints to save, launch, review, stop, reopen and restart a seller. The two
actual HTTP 402 responses retain the same original offer and dynamic path.
