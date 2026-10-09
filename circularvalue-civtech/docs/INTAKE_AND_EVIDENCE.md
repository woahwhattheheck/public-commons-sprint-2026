# Editable intake and retained evidence

**Needs expert review.** CircularValue provides decision-support calculations, not
investment advice, realized savings, accounting conclusions or environmental
certification. These tools reuse the existing compiler without changing its math,
confidence labels, stale-evidence rules or packet verification. MIT project terms
and existing contributor attribution apply; no additional dependency is needed.

## A working local example

From `circularvalue-civtech/`, using Python 3.10 or later on Linux:

```sh
PYTHONPATH=. python examples/intake_demo.py --out-dir /tmp/circularvalue-intake-demo
```

The directory must not already exist. The example creates **explicitly synthetic**
retained evidence, three editable CSV files, `case.json`, `packet.json`, a local
file mapping and `evidence-report.json`. It actually runs the compiler, checks the
CSV round-trip and packet, and hashes the retained files. Expected output includes
`retained evidence matched 2/2` and `HUMAN_REVIEW_HYPOTHESIS`: matching bytes do not
promote a hypothesis into an observation. There is no network or account access.

## Edit an existing case as tables

```sh
PYTHONPATH=. python -m circularvalue.intake export case.json --out-dir /tmp/my-tables
# Edit /tmp/my-tables/case.csv, evidence.csv, and levers.csv.
PYTHONPATH=. python -m circularvalue.intake import /tmp/my-tables --out revised-case.json
PYTHONPATH=. python -m circularvalue.cli compile revised-case.json --out revised-packet.json
PYTHONPATH=. python -m circularvalue.cli report revised-case.json --out revised-review.html
PYTHONPATH=. python -m circularvalue.cli verify revised-case.json revised-packet.json
```

`case.csv` has exactly one settings row. `evidence.csv` holds the evidence register;
`levers.csv` holds the annual value ranges and their evidence references. Headers
and their order are fixed. Preserve row order to preserve the source case hash.
Each import runs the existing compiler, including unknown/repeated evidence checks,
range ordering, confidence/category validation, date rules and monetary limits.

Import all columns as **text** when using a spreadsheet editor. Save as UTF-8 CSV
without automatic date, exponent or currency conversion. Integer fields use plain
ASCII integers: `1200`, `0` or `-1200`, never `1,200`, `12.00`, `1.2e3`, `+1200`,
`-0` or localized numerals. Values are always currency minor units; the tools do
not divide by 100 or assume that all currencies have two decimal places.

`evidenceIds` is a JSON string array inside one CSV cell, for example
`["baseline","retention"]`. A CSV editor handles the outer CSV quotes. This
representation preserves evidence IDs containing commas, semicolons or Unicode.

Text starting with a spreadsheet-formula marker, leading control whitespace, or
an apostrophe is exported with one protective leading apostrophe. Import removes
that one escape only when followed by another escape-worthy value. This is the
round-trip convention: `'=literal` becomes the literal `=literal`, while
`''ordinary` preserves the literal leading apostrophe in `'ordinary`. CSV quotation
alone is not the protection. Editors may transform CSV despite this convention;
review imported values and hashes before relying on them.

Inputs are bounded to 4 MiB per file, 10,000 rows per table and 64 KiB per field.
Malformed widths, duplicate or reordered headers, invalid numbers and malformed
CSV fail visibly. Files must be regular, non-symlink inputs. Output files and export
directories are create-only. A failed multi-file export may leave an incomplete
new directory for inspection; it is not announced as successful. Use a fresh
output directory when retrying. No existing file is overwritten.

## Check the retained bytes, not a remote locator

Create a JSON mapping with exact case evidence IDs as keys and slash-separated
relative paths as values:

```json
{"baseline":"baseline.txt","retention":"notes/retention.txt"}
```

```sh
PYTHONPATH=. python -m circularvalue.evidence_check revised-case.json mapping.json \
  --root /path/to/retained-evidence --out evidence-check.json
```

This command never fetches the case's `locator`. It opens only explicitly mapped
local files beneath the supplied root. POSIX descriptor-relative, no-follow opens
reject absolute paths, traversal, symbolic links and non-regular files. Unsupported
platforms fail visibly instead of silently weakening that boundary. The root is
chosen by the operator; this is not a sandbox for a hostile operating system.
Each evidence file is limited to 64 MiB and is streamed rather than loaded whole.
File size/metadata changes during reading are reported, not accepted as a match.

Every cited evidence ID appears in the report with one status: `matched`,
`mismatch`, `missing`, `unmapped`, `unsafe_or_unreadable`, `oversized`, or
`changed_during_read`. Unknown mapping IDs are errors. No mapping is inferred from
a locator. The result includes case and mapping digests, per-file hashes and a
report digest; raw evidence contents and local paths are not copied into the report.
These are local snapshot observations, not a promise that a file cannot change
later. Keep the case, mapping and evidence with the report for repeatability.

Exit **0** means every retained file matched; **1** means a report was written but
at least one file did not match or was unavailable; **2** means a configuration,
input or output error. A byte match does **not** authenticate a source, validate
its factual contents, establish freshness or change a modeled/hypothesis flag.
Private evidence should stay local; do not commit it to this public repository.

## Focused verification

```sh
PYTHONPATH=. python -m unittest discover -s tests -p test_intake_evidence.py -v
```

The six focused checks cover exact CSV/packet round-tripping, malformed tables and
lossy numbers, distinct evidence outcomes, path rejection, create-only files, and
real subprocess CLI execution. They use synthetic data and local temporary files.
