# Original NC ambient source intake

This compiler receives the exact downloads listed in an existing `upstate.nc-ambient-original-capture/v1` manifest. It performs source intake only. The existing scientific owner retains profile joins, constituent/identifier interpretation and analysis.

## Receive the full original capture

Use the actual existing Linux Python and original downloaded directory:

~~~sh
"$PYTHON" -B "$APPLICATION/source_tools/receive_nc_ambient_sources.py" \
  --source-directory "$ORIGINAL_DOWNLOAD_DIRECTORY" \
  --capture "$ORIGINAL_CAPTURE_JSON" \
  --output "$NEW_RECEIVED_SOURCE_DIRECTORY"
~~~

The source directory and receiving output must be separate. The output must not already exist. The compiler uses Python standard-library modules only; it does not fetch URLs or install packages. Each manifest entry supplies `id`, `filename`, `expected_bytes`, `profile` and `site`, with optional `sha256`, `public_uri`, `encoding` and original descriptive fields. The complete original capture JSON is copied without reformatting. Internal source-location references remain in that same authorized receiving artifact; public code contains no source-account references.

The default CSV codec is UTF-8 with optional BOM. If an original source declares another encoding, supply that exact entry's `encoding` or the explicit `--encoding` argument. A decoding failure returns the actual exception; no fallback silently changes original text.

## Retained source and parsed records

The complete receiving directory contains:

- `capture.json`: the exact input manifest bytes.
- `originals/ENTRY_ID/ORIGINAL_FILENAME`: every unchanged original CSV or ZIP, with verified expected byte count and optional declared SHA256.
- `originals/ENTRY_ID/members/ORIGINAL_MEMBER_NAME`: every original regular ZIP member, with its archive order, name, compressed size, CRC and observed content hash. Original directories remain inventoried.
- `profiles/ENTRY_ID/0000.json` and later numbered JSON files: one complete parsed view for each original CSV body or CSV archive member.
- `inventory.json`: all source, member, profile and output identities and complete row/column counts.

Each parsed table uses `upstate.original-csv-records/v1`. `columns` preserves the ordered original header strings, including repeated names. Each `rows` entry records zero-based `record_index`, a pointer into this parsed view, the consumed physical CSV line range and `values` as an ordered array of raw decoded strings. Empty fields, null-like literals, scientific notation, leading zeros, dates, identifiers and species strings remain strings. Rows with a different field count remain present and are counted explicitly.

Quoted CSV syntax is decoded by the standard CSV reader; original punctuation, quoting, line endings and BOM remain recoverable from the retained exact original body. The source binding includes original download identity, profile/site/public URI and, for ZIP data, the exact original member identity. The modern WQX3 profiles and separate legacy WQX2.2 limit exports retain their own entries. The compiler does not claim equivalence or join their records.

## Publication and failure behavior

All files are written into one fresh sibling staging directory. The original CSV views stream record by record; the whole dataset is not expanded into a Python list. Linux `renameat2(RENAME_NOREPLACE)` publishes the completed directory atomically and refuses an existing output. The source originals stay untouched. A failed copy, hash, ZIP CRC, decode, parse or publication removes this attempt's staging directory and returns the original error. Correct that concrete source/runtime issue and select the same still-absent output or a new output for the next explicit attempt.

The printed result names the actual output/inventory and source-byte, table and row totals. Inspect the returned inventory in the existing analysis operation and continue the source owner's original normalization/report course. This compiler produces no human-facing report or model result.
