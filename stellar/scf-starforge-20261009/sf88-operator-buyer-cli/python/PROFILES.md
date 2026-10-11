# Customer dataset profiles

The original analysis workspace now turns a received edition into a usable
column review: profile every imported row, inspect exact values and types,
compare editions, save analyst notes, and hand over a portable JSON or HTML
report. The same database retains the original source, mappings, financial
context, immutable row tables, saved SQL and job history.

## Open the existing customer workspace

Start the normal analysis workspace using its existing directory and source
configuration, then choose **Data profiles** in its navigation. This opens the
profile view on the same listener and capability. It does not open another
analysis process or acquire another product.

Select an imported edition, optionally choose specific columns, and run the
profile. Every row in that retained edition contributes. The default top-value
list contains twelve groups per column; change it up to fifty without changing
the complete counts, extrema or distribution calculation. The run deadline is
explicit and configurable, up to one day. Cancel operates on the same saved
job; an interrupted process retains its original job as interrupted.

The overview shows nulls, empty text, distinct non-null values, repeated
non-null rows and native storage classes. **Inspect** opens the original field
mapping, original JSON type declarations, typed ranges, text lengths and value
frequencies. The source panel retains the edition's original completion and
query scope: a complete profile of an intentionally partial acquisition is
still a profile of that partial acquisition, not of unseen provider records.

## Interpret the numbers

These are complete descriptive statistics, with explicit native type semantics:

- SQL NULL, empty text and nonempty whitespace-only text have separate counts.
- Integer `1`, real `1.0` and text `"1"` have separate frequency groups. The
  original importer stores JSON booleans as SQLite integers; their original
  JSON type declarations remain beside the profile.
- Numeric ranges use native integers and real values only. Numeric-looking
  text such as `"599.010000"` is never parsed, rounded or added. Large signed
  64-bit integers are returned as typed text so the browser preserves them.
- Distinct non-null values use the storage class plus the native value under
  BINARY comparison. Repeated non-null rows equal non-null rows minus that
  distinct count. Text ranges are lexicographic, not locale-aware or numeric.
- The top-value list is a frequency-ranked subset unless explicitly marked
  complete. All groups contribute to the counts, ranges and distribution
  digest. Long values have an explicitly abbreviated preview, full byte and
  character counts and a digest of their complete UTF-8 bytes.

A profile keeps one read transaction over the immutable edition. SQLite may
use temporary disk for grouping; the Python process streams grouped values
rather than retaining the whole dataset or full distinct-value dictionary.

## Save a review and investigate a field

Write the intended use and observations in the analyst review. Optional
per-column notes remain in that draft until **Save review**. The classification
is an analyst note, not a purchase permission or an execution policy. Revision
checks prevent one operator silently replacing another operator's saved review.
A repeated save with the same request ID and identical content returns that
original save.

The browser retains each outgoing profile request and review save in its
existing session before sending it. When a connection loses the reply, the
recovery panel retries that exact request ID and body. Reopening the same browser
session restores a pending review's edited notes; retrying confirms its original
revision instead of creating a duplicate. A changed selection or draft cannot
silently replace an unresolved request. **Forget retained browser requests**
explicitly discards only that local pending copy; any accepted operation remains
in the workspace history. The original workspace must be reopened at its same
origin for that browser session storage to remain available.

Under the column's complete-dictionary section, save a frequency query with a
new name. Open that recipe in the existing analysis workspace to inspect its
actual typed rows, refine SQL, save a report, or use the existing complete-query
export. This uses the original SQL reader and exporter. Its normal preview limit
is separate from the full profile and from a complete export.

Select two completed profiles to compare column counts, native types, ranges,
mappings and distribution digests. Both source editions remain visible in the
comparison. Different selected-column sets are reported as additions/removals;
they are not silently treated as identical scopes. For exact keyed record
changes, use the existing **Changes** workflow rather than inferring row-level
changes from column summaries.

## Command line on the same workspace

Use `--launch` while the original browser workspace is running. It reads that
workspace's existing private `analysis-launch.json` and uses its loopback HTTP
API directly, without inherited HTTP proxies or a second server:

```sh
python -m stellar_forge_buyer.profile_cli \
  --launch /private/customer/analysis/analysis-launch.json versions

python -m stellar_forge_buyer.profile_cli \
  --launch /private/customer/analysis/analysis-launch.json run \
  --version ORIGINAL_VERSION_SHA256 --id YOUR_32_HEX_JOB_ID

python -m stellar_forge_buyer.profile_cli \
  --launch /private/customer/analysis/analysis-launch.json export \
  --id YOUR_32_HEX_JOB_ID --format json --out /private/handoff/profile.json
```

`run` waits by default. With a live workspace, `--no-wait` returns the retained
job ID; `show --id ID` and `cancel --id ID` address that same job. Repeating an
identical job ID reads its existing result instead of launching another scan.
Choose a new ID for a deliberately new scan. `--column NAME` is repeatable;
`--top-values` and `--timeout` match the browser settings.

When the original browser process is closed, use `--workspace DIRECTORY`
instead of `--launch`. The command obtains the original workspace process lease,
runs or reads its work, and closes it normally. A live owner is not bypassed.
Use `history` and its `--before` continuation to read every retained page.

The `review` command accepts `--request FILE` containing `id`,
`profile_sha256`, `expected_revision`, `decision`, `note` and `column_notes`.
`frequency --id ID --column NAME` emits the complete original SQL recipe;
`compare --before ID --after ID --out NEW_FILE` retains the comparison.
Run `python -m stellar_forge_buyer.profile_cli --help` for all commands.

## Portable handover and offline use

Export **portable JSON** to retain the complete profile, selected source scope
and exact saved review. Export **readable report** for an ordinary browser or
print workflow. Both contain actual top values and analyst notes, so deliver
them only to the intended recipient. The report has no external scripts or
network dependencies. Output paths are create-only.

The JSON reader verifies its recorded content and review binding before use.
It requires neither the original database nor Node, merchant, signer or network:

```python
from stellar_forge_buyer.dataset_profiles import ProfileDocument

before = ProfileDocument.open("/received/previous-profile.json")
after = ProfileDocument.open("/received/current-profile.json")
for column in after.profile["columns"]:
    print(column["column"], column["storage_classes"], column["numeric_max"])
print(after.review)
comparison = before.compare(after)
print(comparison["row_delta"])
after.write("/received/reviewed-profile.html", format="html")
```

Equivalent offline commands are `inspect-file --file FILE` and
`compare-files --before FILE --after FILE --out NEW_FILE`. They do not require
`--launch` or `--workspace`.

## Application integration

An application that already owns `AnalysisWorkspace` starts
`workspace.start("profile", {"id": ID, "version_id": VERSION})`. Read the
original `workspace.job(ID)` until it completes; use
`workspace.profiles.document(ID)` for the retained document and
`workspace.profiles.save_review(ID, request)` for a revisioned review.
Close the original workspace normally. Its shared worker, process lease and
job history remain authoritative for import, query, profile and export work.

The package adds no runtime dependencies. The maintained whole Python package
selection includes the engine, UI and CLI alongside the existing customer
application. [Analysis workspace](WORKSPACE.md), [customer workflows](CUSTOMER_WORKFLOWS.md)
and [complete SQL exports](SQL_EXPORTS.md) describe the adjacent native workflows.
