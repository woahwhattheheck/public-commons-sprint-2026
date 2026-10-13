# Measurements: incorporate returned review work

Version 1.0.1. This extends the existing Measurements 1.2 large-file and original
MeasurementWorkspace workflows. It does not introduce another measurement store,
model scheduler, scientific calculator or HTTP controller.

## The useful handoff

A scientist sends an editable source edition to a reviewer and continues working.
The reviewer returns a complete native edition. This component compares the exact
sent baseline, returned edition and current scientist edition. It preserves
independent current edits, shows genuine overlapping changes, and incorporates
explicitly selected returned changes into a **new, independently editable native
project**. The existing sender, return and current projects stay intact.

The complete source records, files, native domain, review history and current-only
originals travel with the new result. Every incorporation uses the original
`MeasurementWorkspace.review` and `MeasurementWorkspace.mapping` methods. The
native review remains responsible for eligibility, limits, units, source-version
choices and station-to-reach support.

## Open and operate

Use the original Measurements application with Node 22.16 or newer and its
existing Python archive helper. No package download or hosted compute is needed.
The separately supplied PDF printer uses ReportLab; it is optional and is not a
prerequisite to comparison, the offline desk or native incorporation.

Export each edition through the existing large-file export command. Preserve the
exact complete `project.zip` that was sent as the baseline. When the reviewer
returns their edition, export the scientist's current edition as well. For a
project with a bound native scientific domain, keep the original native export's
`--native-workspace` option so its domain travels with the source.

```sh
node measurement_workspace/engine/returned_review_cli.mjs plan \
  --baseline sent/project.zip \
  --returned returned/project.zip \
  --current current/project.zip \
  --output returned-comparison \
  --title "Returned observation review"
```

Open `returned-comparison/review.html`. It is self-contained, grayscale and usable
without network access. It includes every changed group, its baseline/returned/
current review, proposed returned delta, original identities and source archive
links. Search and disposition filters page the complete changed population;
CSV, exact JSON Lines and SQLite retain the same complete comparison.

Choose **Keep current** or **Use returned changes** for overlapping groups. The
latter applies the returned delta, not an entire replacement of the group.
Independent current reviews of another source version remain current. Enter the
incorporating reviewer and rationale, then save the complete decisions file.
Saved decisions can be reopened against this same original comparison. A later
file-open supersedes an older pending read; intervening reviewer, rationale or
group-choice edits are preserved rather than replaced by that pending file.

```sh
node measurement_workspace/engine/returned_review_cli.mjs apply \
  --plan returned-comparison \
  --decisions returned-review-decisions.json \
  --output incorporated-project
```

The result contains an editable `measurements/` native workspace, complete
`edition/project.zip`, all-record CSV, calibration JSON/CSV and accepted/excluded
JSON Lines. Use the existing application against that workspace, or receive
`edition/project.zip` with the original large-file receiver. Edit the resulting
project and export again normally. The component's decisions, comparison and
native action history travel inside `returned-review-history/` in future native
archives. Original input archives remain in the companion comparison directory;
the complete handoff should carry that directory alongside the resulting project.

For a command-only workflow:

```sh
node measurement_workspace/engine/returned_review_cli.mjs template \
  --plan returned-comparison --output choices.json
node measurement_workspace/engine/returned_review_cli.mjs inspect \
  --plan returned-comparison
python source_tools/print_measurement_return.py \
  --plan returned-comparison --result incorporated-project \
  --output Returned_Review_Brief.pdf
```

## Scientific and concurrency behavior

The comparison matches original native logical measurement groups and their exact
source-version identities. It compares review state, reviewer, rationale and the
effective selected source. Historical `selectVersion` flags and review timestamps
remain provenance; time alone does not manufacture a conflict. Source values,
raw source fields and native interpretation fingerprints are never rewritten.

A returned review of the same field that the scientist changed differently is an
overlapping change. The offline desk shows both branches and the exact proposed
result. An equivalent returned decision is already current and needs no native
rewrite. Current-only originals and unchanged current decisions are retained.

New returned originals are listed with their full native archive. They are not
silently merged into an unrelated current interpretation. Receive those original
sources through the existing source/collection workflow, preserve the existing
current reviews, export a new current edition, and compare again. The same rule
applies to an assignment that names a different native domain. These are native
source requirements, not a new permission or publication policy.

An included non-detect remains censored; an unassigned station stays unassigned.
A review cannot turn an annual modeled nitrogen/phosphorus/sediment stream load
into an observed concentration. Reviewer names are recorded user-entered names,
not authenticated signatures. Explicit incorporation records both original
reviewer decisions and the incorporating reviewer's rationale.

## Process interruption and storage

The three input archives are copied and identified by their complete bytes and
SHA-256. Each is opened through the original full-source receiver. The comparison
uses a disk-backed SQLite index and original logical-key queries rather than
loading all three populations into JavaScript arrays. Completed comparison
captures are discarded because their complete input archives and comparison
already retain the information; this avoids three unnecessary permanent project
copies. A failed comparison rebuilds only its own disposable captures.

Incorporation writes a private, current-derived receiving directory. Its retained
native action sequence has exact before/after group identities. On restart, the
same operation reads the original native event prefix and revision to distinguish
committed edits from work still pending. It does not replay a committed edit.
Independent changes to the intermediate receiving stage are retained and reported
rather than overwritten. Repeating a completed operation returns the existing
result and preserves later independent recipient edits.

Every native write is still the original atomic method. No long transaction is
held around the complete archive operation, no monkey-patched writer is installed,
and no scientific job is restarted. Full original archives are sizeable by design;
the CLI's SQLite working set is separate from the optional browser's changed-row
view. Keep enough disk for three compressed inputs, temporary native receiving,
and the one complete output.

## Source installation and complete receiving

```sh
python install_measurement_returned_reviews.py \
  --application /path/to/original/application \
  --source-root /path/to/this/complete/source --check
python install_measurement_returned_reviews.py \
  --application /path/to/original/application \
  --source-root /path/to/this/complete/source
```

The installer creates only this component's source leaves and its source
inventory. It preserves the advancing Measurements 1.2 + source-bound Chemistry
composition, original wrappers, native engine and scientific application. It
refuses to silently replace another changed version of this component. Exact
repeat installs are reusable, interrupted partial installs converge, and syntax/
import failure rolls back only the new files from this installation.

The original application-component composer discovers
`integration/component_fragments/measurement-returned-reviews.json`; it declares
the existing `measurement-large-files` dependency and keeps these complete source
files with the original application's selected-component receiving. It does not
make this component a replacement for the full geospatial application.

## Operated examples

`verification/returned_review_journey.mjs` consumes the retained original
five-station review package and operates receiving, exact-source comparison,
explicit native review/selection choices, complete export, cold receiving and
later independent editing. The reported measurements are original; its review
choices are clearly labelled internal workflow demonstrations. The unchanged
original observation package remains the opening scientific source.

`verification/returned_review_capacity.mjs` continues a completed original
`large_file_capacity.mjs` workload, compares the entire native population, creates
thousands of ordinary review actions, terminates the actual native incorporation
process, resumes its committed event prefix, exports the complete result and
cold-receives every original record. The workload is explicitly authored software
capacity data, kept separate from observed chemistry.

```sh
node verification/returned_review_journey.mjs ORIGINAL_REVIEW NEW_OUTPUT
node verification/large_file_capacity.mjs 350000 NEW_CAPACITY_OUTPUT
node verification/returned_review_capacity.mjs NEW_CAPACITY_OUTPUT NEW_RETURN_OUTPUT
```

The complete outgoing application/attachment inspection and original sprint
instructions remain in the existing `CURRENT_OWNER_DIRECTION.md`. This work is
additive to the existing regional native model execution and its original
scientific/reporting/utility scopes.
