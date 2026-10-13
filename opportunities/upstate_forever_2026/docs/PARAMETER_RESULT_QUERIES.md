# Read large saved parameter-study results

Open **Parameter studies → Open study → Results and downloads**. The result table reads the selected original result JSON in pages of 100 rows. Filter by reporting area or pollutant, use Previous/Next, or enter an original filtered row number in Go to result row.

The range table has its own Previous ranges / Next ranges controls. These are the exact saved minimum/maximum records over completed cases with matching spatial support. Paging does not recalculate a range or substitute the visible result page for the complete compared cohort.

The displayed source SHA256 identifies the retained scientific summary. If another completed summary is published while this view is open, the next read returns the new identity and starts both pagers at zero. Any now-unavailable filter is cleared. The current study's original run, parameter selections and completed-case history remain intact.

## First read and continued reads

The first result read builds a derivative SQLite index under:

    experiments/<study-id>/result-queries/<source-query-id>.sqlite

It streams the original UTF-8 JSON, validates the complete file against the retained byte count and SHA256, and records only row byte spans, original filter identities and row hashes. It does not make a second copy of the scientific matrix.

Later pages seek directly into the same original result file. Every returned row's body hash and area/pollutant identity must match the indexed span. File replacement, in-place changes and a changed saved result descriptor invalidate the observation.

The first build takes the original study lock and a derivative index lock. If the study is currently publishing results, reopen the table after that operation. A completed index can be read while a later calculation runs; a concurrent summary replacement requires a fresh page read.

A build checkpoints completed JSON values in batches. After interruption, the next request resumes from its saved parser position. It rereads the already-consumed byte prefix to finish the original whole-file hash, then continues parsing and indexing the remaining values. It never reruns a model or changes a scientific result.

The derivative is published only after the entire original JSON matches its retained source descriptor. A temporary partial index is not a completed result. The full scientific file and all original downloads remain authoritative.

## Transfer and reopen

The ordinary complete Workspace inventory retains the optional index and any partial checkpoint along with the scientific result. On a restored host, changed file identity causes a one-time complete original-byte verification before the saved byte spans are reused. If there is no index, the reader creates it from the original JSON.

The index format is versioned independently of the original model result. Updating this reader creates a separate derivative identity; original reports, JSON, CSV and GIS downloads keep their established paths and contents.

## API

The existing endpoint remains:

    GET /api/parameter-studies/results?workspace=...&id=...

Existing area_id, pollutant, offset and limit retain their meaning. New optional fields:

| Field | Meaning |
|---|---|
| range_offset | Original filtered range offset, starting at zero. |
| range_limit | Number of ranges, 1–1000. Omission retains the earlier complete matching-range response. |
| expected_artifact_sha256 | Previously displayed result identity. A changed edition resets both offsets and returns edition_changed=true. |

Response additions include total_ranges, filtered_ranges, range_offset, range_limit, artifact_bytes, query_edition and effective area_id/pollutant. saved_study_state/progress come from the current bound execution checkpoint; completed_cases/total_cases and scientific quantities remain from the selected original result edition.

Result reads validate the saved study specification and its original checkpoint, then read the retained result descriptor. They do not reopen every native run merely to page an existing scientific summary. The full study inspection and Native case console retain their original live-run semantics.

## Original receiving

At the existing equipped application's safe source boundary, use the actual saved study ID whose original results.json already exists:

    from model.workspace import Workspace
    from model.parameter_result_query import DEFAULT_RESULTS

    workspace = Workspace(actual_workspace)
    first = DEFAULT_RESULTS.read(workspace, actual_study_id, limit=100, range_limit=100)
    following = DEFAULT_RESULTS.read(
        workspace, actual_study_id, offset=100, limit=100,
        range_limit=100, expected_artifact_sha256=first["artifact_sha256"])

Compare returned rows to the corresponding original JSON slices using the actual retained file. Reopen the same study in the current operator, page its rows and ranges, then use the unchanged original full-result downloads. This reads the existing native cohort and starts no new scientific calculation.
