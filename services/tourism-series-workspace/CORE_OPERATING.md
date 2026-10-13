# Tourism series core and native CLI
This maintained package retains complete original files and source observations, applies explicit reviewed mappings, and produces qualified analyses, frozen reports and exact returned-file reconciliation. It does not invoke a tourism platform, implement cloud permissions or assert statistical confidence.

## Files and units
Use original binary files through importFile and original UTF-8 comma-separated files through importCsv. Every physical file has an explicit ID, representation, publisher/source location and complete byte identity. A factual transcription is labelled authored_transcription; it is never presented as the original PDF. Source and target CSV roles are explicit. Original headers, duplicate names, row ordering, empty cells and ragged rows remain intact.

The source CSV has the ordered fields in templates/observations.csv. Column mappings use zero-based numeric positions; a duplicate header is therefore still unambiguous. A mapping may instead provide an explicit constant. Leaving fields unmapped creates source findings. Source-local opaque identifiers are preserved literally.

Published values are exact signed ordinary decimals with up to80 whole and18 fractional digits. Multipliers1,1000 or1000000 are explicit source fields. Empty values for missing, suppressed and not_available remain null. They never become zero. Periods use actual ISO dates with half-open bounds [start,end). Keep the original displayed date/value labels in original_display and note.

Each immutable registry declares exact geography ancestry, source-backed disjoint partitions, metric units/currency/population/price basis, additivity, method editions, reviewed comparability, ratio pairs and component-total relationships. New definitions need a new registry ID; existing analyses retain their original edition. Addition never silently mixes currencies, populations, methods, overlaps or incompatible metric definitions.

## Native CLI
Use a current Node runtime on the original Linux or Windows host. Mutations take a kernel-held local IPC lease keyed to the canonical workspace path. A process exit releases that lease; a competing process fails to acquire it. There is no persistent lock file to delete, alternate controller or automatic provider dispatch. Read-only inspection and exports do not mutate the workspace.

Create a workspace with a fixed original identity and timestamp:
```sh
node cli.mjs init --workspace /ABS/workspace.json --id original-project --title "Original tourism source review" --at 2026-10-13T16:20:29Z
```

Save each intended operation in a complete JSON file:
```json
{
  "action": "importCsv",
  "input": {
    "operationId": "original-import-1",
    "expectedRevision": 0,
    "at": "2026-10-13T16:20:29Z",
    "id": "original-series-1",
    "role": "source",
    "filename": "actual-original.csv"
  }
}
```

Apply using the original full CSV:
```sh
node cli.mjs apply --workspace /ABS/workspace.json --request /ABS/import-request.json --file /ABS/actual-original.csv
```

For importFile the --file bytes supply content_base64; the saved request retains its explicit original filename and all metadata. For importCsv they supply text. Both also accept complete inline bytes/text in the saved request instead of --file. If a completed exact import is replayed after staging disappears, the CLI uses its already retained original bytes and the engine checks the complete original request. If staging still exists but differs, the request digest conflicts. Do not regenerate operation IDs on a lost reply.

Every other action uses the exact input documented in API.md: saveRegistry, saveMapping, saveCorrection, saveAnalysis, saveReport, prepareTarget and recordTargetReturn. Supply the actual current expectedRevision for a new operation; preserve the original expectedRevision for a completed replay. The engine checks an existing original operation before revision comparison. A reused ID with changed fields is rejected. All mutations publish one complete workspace atomically while holding the same lease.

Other native commands:
```sh
node cli.mjs inspect --workspace /ABS/workspace.json
node cli.mjs project --workspace /ABS/workspace.json --input /ABS/selection.json --out /ABS/projected.json
node cli.mjs analyze --workspace /ABS/workspace.json --input /ABS/analysis-selection.json --out /ABS/analysis.json
node cli.mjs report --workspace /ABS/workspace.json --report saved-report-id --out /ABS/report.html
node cli.mjs handover --workspace /ABS/workspace.json --out /ABS/complete-handover
node cli.mjs receive --workspace /ABS/independent/workspace.json --input /ABS/complete-handover/workspace.json
node cli.mjs template --out /ABS/blank-observations.csv
```

The selection JSON for project contains registryId and sourceIds. Analysis adds kind and ordered rowIds plus its explicit partition/dimension/pair/relationship. See API.md. All paths used by the CLI are absolute. Reports and handover members publish create-only: the same complete bytes are reused on restart; a differing edition requires a new output path. Existing independent receiving accepts only the same original history or a later saved descendant, preserving later edits.

## Meaning of the five calculations
A sum selects one declared additive dimension. Geography sums require distinct children of one declared partition, reject ancestor/descendant mixing, and identify complete coverage or a selected subset. Period sums require the same geography, nonoverlapping half-open periods and disclose gaps. Returned aggregate dimensions name the actual parent/member selection or complete period span.

A difference is second operand minus first. Percentage change divides that difference by the named first operand. The two operands must share metric/unit/currency/population/price basis and differ either by nonoverlapping period in one geography or by geography in one period. Unconfirmed method-edition comparability remains visible even when the exact published difference can be calculated.

Ratios use a declared numerator/denominator pair and output unit. Population or price-basis exceptions require explicit flags in that source-backed pair. Exact reduced fractions remain available; the displayed value rounds half away from zero to six decimal places. Zero denominators return an undefined result and a finding.

Reconciliation selects a named total followed by every declared component metric once. Scope/unit/currency/method/price basis must match; differing component populations require the declared relationship. It reports components minus total, keeps all original values, and treats any chosen tolerance as a reviewer choice. An observed residual does not modify source facts.

## Actual target template and returns
Import the actual authorized native CSV header/template as an original file. prepareTarget maps every actual column to a canonical source field, normalized_value, rowId or explicit literal. Key columns are explicit, complete and unique. Duplicate headings preserve their original positions. The engine freezes the complete template identity, source operands, mapping, prepared rows, exact CSV and SHA. Later source corrections do not rewrite that export.

Import the actual returned CSV with role target. recordTargetReturn names the original prepared plan and maps every prepared column to its actual returned position. It preserves all returned rows and extra native columns, reports missing/unexpected/duplicate keys and compares every mapped cell. A file comparison is not proof that a provider imported it. Actual platform execution and receipt interpretation remain with the authorized platform owner.

## Full exit and receiving
buildHandover and the CLI preserve every original byte, original/corrected CSV, full registry editions, mapping/correction history, frozen analyses and reports, target exports and actual returned files, complete workspace and operations. Original filenames are mapped to safe complete archive paths in MANIFEST.json. Keep the folder together so the readable report's original-file links work. Open workspace.json independently, make a new attributed edit and produce a successor; the original saved report/target remains available.

The browser build adds the complete maintained application, working HTML, unfinished-value recovery and full program source. Its operating guide owns actual desktop/mobile/print and attachment receiving. Workspace history is validated by reconstructing every ordered original request's effect, not merely accepting a supplied hash.

Validation ceilings:32MiB each original file/CSV;100,000 data rows/CSV;512columns;1,000,000characters/cell;128MiB pretty UTF-8 workspace. These are selection ceilings, not measured full-scale throughput. The browser recovery envelope also has its complete limit; its additional unfinished values must fit.

## Source exercise and actual rendered delivery
The complete real178-row source-derived selection was exercised with exact public report transcriptions: declared district partition, preserved published-total residual, method-qualified year comparison and exact ratio; immutable report, duplicated target headings, full returned-column matching, extra native fields, a new correction, original-operation replay, changed-request rejection and independent full JSON/handover reopening. This is a source execution result, not a native browser or production load claim.

Before presenting the actual application, report or any attachment, the responsible producer must open/run/render that exact version, LOOK at its real screen or screenshots and use the important controls at desktop1440 and mobile390 where relevant. Open the complete ZIP's usable contents, every applicable report/PDF page and the actual downloaded/reopened files. Capturing screenshots without viewing them, source review, schemas, HTTP200 or passing checks are not substitutes. Repair visible defects and continue the substantive delivery. Use the existing cloud/native programme; do not take over an owner-reserved local browser or create another controller.

Only reusable code belongs in this public repository. Customer data, contact/account state, source-only commercial briefings and original offer files remain in their existing private source case. Platform subscriptions, licensed datasets, resale/access rights, AI permissions and any vendor import/export agreement must be explicitly settled with their owner. This local original-source workbench grants none of those rights.
