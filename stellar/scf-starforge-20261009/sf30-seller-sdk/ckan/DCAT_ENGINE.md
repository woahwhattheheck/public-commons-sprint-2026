# DCAT migration engine

The catalog workspace uses this engine to review a complete metadata edition, preserve the original converter result, compare published editions, and validate an edited candidate before the application records acceptance or selects a release.

The engine is a callable Python module and a JSON process interface. The maintained Node application owns source files, saved reviews, revisions, acceptance, cutover, rollback and whole-workspace handover. Conversion and review do not publish to a catalog endpoint.

## Original source and installation

The adjacent [vendor/gsa-dcat-us](vendor/gsa-dcat-us/) directory retains the complete original GSA source selection at commit [4996591483b52f4ccc0cb72c42e4ec3fe59a4b06](https://github.com/GSA/dcat-us/tree/4996591483b52f4ccc0cb72c42e4ec3fe59a4b06/jsonschema):

- The unchanged converter and transforms.
- All 26 DCAT-US 3.0 schemas and all five retained 1.1 schemas.
- The original Python project, dependency lock, README and CC0 license.

The engine checks the exact 37 source files against [source-manifest.json](vendor/gsa-dcat-us/source-manifest.json) before importing the converter. That manifest is itself pinned in the engine. A complete installed package carries these files together.

The original package requires Python **3.13 or newer, below 4.0**. Create its environment using the original Poetry project and lock. From this directory:

~~~sh
cd vendor/gsa-dcat-us/jsonschema
poetry env use python3.13
poetry install --only main --no-interaction
export SCF_DCAT_PYTHON="$(poetry env info --executable)"
"$SCF_DCAT_PYTHON" -B ../../../dcat_migration.py --check-runtime
~~~

Set the resulting absolute executable path as **SCF_DCAT_PYTHON** in the application's existing managed environment file or host environment. The Node adapter launches that executable with shell execution disabled. Its fallback executable name is python3.13.

The original [README](vendor/gsa-dcat-us/jsonschema/README.md) describes Poetry installation and environment setup. Preserve [poetry.lock](vendor/gsa-dcat-us/jsonschema/poetry.lock) when assembling dependencies for an offline host; transfer the complete dependency selection for that host's Python ABI and platform. The engine performs no package installation or source download.

The runtime check reports Python and installed dependency versions, their matches against the retained lock, the original source commit, and the actual registered format checkers. The selected schema closure uses date, date-time, IRI and URI checks. In particular, retain the original jsonschema format dependencies, including the locked rfc3987 package; an absent IRI checker must not silently turn an invalid series identifier into a valid result.

## Review modes

A source profile is either auto, 1.1 or 3.0. Automatic selection uses the catalog's actual conformsTo declaration. An unrecognized declaration needs an explicit selection, which remains part of the saved review.

For a 1.1 edition, the engine invokes the original converter. The converter owns its field transformations and legacy isPartOf-to-series construction. The wrapper preserves existing datasetSeries objects and invokes the same original converter for applicable nested catalog scopes, instead of allowing the original root-level function to discard an existing series collection. A nested catalog that already declares 3.0 is preserved unless normalization was explicitly selected.

For a 3.0 edition, the default is exact-byte preservation and direct schema validation. An optional normalize_v3 request applies the original legacy-field transformations to direct datasets in applicable catalog scopes. Existing series and their members retain their original metadata. The review records every transformed catalog and preserved structure.

An uploaded candidate is reviewed as the exact intended 3.0 output. The original source and normal converter output remain separately retained, and operator_changes describes the additional edits. This supports correcting a schema exception without changing the GSA converter.

## Process interface

The application sends one JSON object on standard input:

~~~json
{
  "source_base64": "<original catalog bytes>",
  "source_profile": "auto",
  "comparison_base64": "<optional published edition bytes>",
  "comparison_profile": "auto",
  "candidate_base64": "<optional edited candidate bytes>",
  "identity_mappings": [],
  "normalize_v3": false
}
~~~

Only source_base64 is required. Omit optional byte fields when unused. File paths and original-source configuration are provided by the application process, rather than by an HTTP request.

The process writes one JSON result. Exit statuses are:

| Status | Meaning |
| --- | --- |
| 0 | A complete review has a schema-valid, conserved candidate; the application can record the operator's acceptance. |
| 2 | A complete review contains candidate or conservation corrections to resolve. |
| 3 | The request, original source, interpreter or dependency configuration needs correction; the result uses migration-error.v1. |
| 4 | An unexpected engine error occurred; the structured error retains its type and message. |

Parse the returned JSON for every status. A converter's zero exit status is not used as a validation decision. The engine calls the original validate_catalog function directly, preserves its exception, and gathers full structured errors from the same original validator, registry and format checker.

The callable API is:

~~~python
review_catalog(
    source_bytes,
    source_profile="auto",
    comparison_bytes=None,
    comparison_profile="auto",
    candidate_bytes=None,
    identity_mappings=None,
    normalize_v3=False,
    original_root=None,
    runtime_profile="original",
)
~~~

The keyword arguments after source_bytes are keyword-only. original_root is a trusted local application setting and defaults to the adjacent vendor directory.

New reviews carry numeric_comparison: exact-decimal.v1. Their inventory, typed identity mappings, field comparisons and displayed validation identifiers use exact decimal values parsed from each retained document. The unchanged GSA converter and validator still receive their original Python JSON model, and automatic candidate bytes use the original converter serialization. If that converter rounds a source decimal, the review exposes the actual before and after values. Existing saved report files, intrinsic review hashes and releases stay unchanged.

Equivalent JSON numeric spellings, such as 1e0 and 1, keep the same exact numeric identity after browser or agent serialization. Strings and booleans remain distinct from numbers, and signed zero retains its original sign. Decimal output keeps a decimal or exponent token for raw and Python readers.

The callable result can contain Python Decimal values. Serialize the complete result with encode_review(result), then encode that returned JSON text as UTF-8 when saving a report. This preserves decimal numbers as JSON numbers through the original Node, browser, CLI and Merchant readers. The process interface performs this serialization itself.

## Result contract

The main schema is migration-review.v1.

| Field | Content |
| --- | --- |
| source, candidate, comparison | Exact byte counts, SHA-256 digests, encodings, selected profiles and observed declarations. |
| candidate_base64 | Exact candidate bytes for storage and download. |
| candidate_text | Decoded text for inspection. Preserve candidate_base64 for byte-identical release and rollback. |
| conversion | Original messages and conversion error, plus transformed catalog and preserved-structure paths. |
| converter_output | The original automatic result's digest and size; also its complete bytes and text when an edited candidate was supplied. |
| validation | Independent source, candidate and comparison outcomes, original exceptions, full error contexts, and per-record validation. |
| conservation | Complete record matching, counts, missing/added entries, duplicates, unresolved identities and original parent relationships. |
| field_changes | Before/after values at exact JSON pointers for every compared record's owned metadata, including nested distributions and references. |
| catalog_changes | Changes to catalog metadata and collection declarations. |
| comparison_changes | Source-to-published-edition comparison, with a separate candidate_to_comparison result. |
| operator_changes | Original automatic candidate to uploaded edited-candidate comparison. |
| source_inventory, candidate_inventory, comparison_inventory | Every catalog scope, member identity, record location and retained identity fingerprint. |
| can_receive | The exact candidate satisfies the original schema and record conservation. |
| requires_review | Changes or exceptions need operator attention. |
| review_sha256 | Digest binding the complete result, inputs, candidate, mappings, options and actual runtime. |

Each validation object has valid, state, schema_id, errors, exception and records. Error entries retain path, schema_path, validator, message and nested context. Catalog-level errors and per-record errors are separate views of the same source validation and should not be summed as independent failures.

Each field change has source_path, target_path, identifier, path, source_pointer, target_pointer, kind, before_present, after_present and classification. before and after retain the actual values when present. A removed field is distinguished from a field whose value is null.

Mapping rows in conservation.mappings expose source_path, target_path, source_identifier, target_identifier, source_role, target_role, source_catalog_path, target_catalog_path, via, changed, relocated and field_change_count.

comparison_changes is null or an object with source_sha256, comparison_sha256, conservation, field_changes, catalog_changes and candidate_to_comparison. The outer comparison describes changes between two original editions. It must not be presented as converter output.

## Identifiers, series and exact corrections

Catalog membership includes direct datasets, dataset series identities, and each series member. A legacy parent promoted to DatasetSeries is matched using its @id; its original identifier value and path remain in the source side of the mapping. A dataset moved into seriesMember is retained as the same member rather than counted as deleted.

Nested Catalog.catalog and Catalog.hasPart have separate catalog scopes. Inline Dataset references such as first, last, source, hasPart and version links remain owned metadata. They are fully diffed and schema-validated without being counted again as catalog members.

DCAT-US 3.0 permits structured Identifier objects. The inventory preserves their complete JSON, using an actual @id or a notation with its scheme metadata for matching. Empty or otherwise unresolved objects can be schema-valid while still lacking a usable identity for conservation.

When an intended correction changes an identifier, supply an explicit mapping:

~~~json
{
  "source_path": "/dataset/7",
  "target_path": "/datasetSeries/0",
  "source_identifier": "legacy-parent-id",
  "target_identifier": "https://catalog.example/series/legacy-parent-id"
}
~~~

Both identifier values must exactly match those editions, including their JSON types. A structured Identifier must remain a JSON object in this request. Display labels and normalized keys are not replacements for that typed value. Each source and target path can be mapped only once.

For example, an original parent string promoted to series.@id can fail the 3.0 IRI format requirement. The review exposes that exact error. The operator can upload a corrected candidate with an intended IRI and bind that change to the original parent through the mapping above. The engine does not invent replacement identifiers.

Every original isPartOf or seriesMember relationship is checked through the same record mapping. Removed, ambiguous or changed relationships remain explicit review items even when the candidate is structurally valid.

## Edition custody, cutover and rollback

The application saves the original upload, optional comparison edition, automatic converter result, optional edited candidate, exact mapping request and complete review together. It uses candidate_base64 for the released file, preserving its digest even when the original encoding contains a BOM or differs from UTF-8.

Acceptance binds the saved source revision, selected candidate digest and review_sha256. Changing any input, correction, mapping or normalization choice creates another review. The application's existing release selection performs cutover against that accepted edition, and rollback selects the retained earlier release.

The engine never edits the retained source bytes. It returns complete derived results so the original workspace package can carry the source editions, review, corrections and release history together.

## Explicit Python 3.12 execution

The default `original` profile retains the upstream Python 3.13 requirement. The host may explicitly select `--runtime-profile portable-python312`, or pass `runtime_profile="portable-python312"` to the Python API, for actual Python 3.12. This profile retains every original source, dependency, schema, format and conservation check, and records its own interpreter declaration in native review metadata. The Node application selects this flag from `SCF_DCAT_RUNTIME_PROFILE=portable-python312` in its original host environment. Set `SCF_DCAT_PYTHON` to the prepared interpreter as well. See the adjacent [PORTABLE_RUNTIME.md](PORTABLE_RUNTIME.md) and exact lock-derived `portable-runtime-requirements.txt` for complete installation instructions and the retained original catalog operation.
