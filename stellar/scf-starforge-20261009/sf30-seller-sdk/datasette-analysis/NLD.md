# Retained Datasette → native NLD operations

This addition commissions a complete selected Datasette edition through the
original NLD SQL flow and returns the result to the existing Datasette customer
Analysis application. It uses the same Analysis database, source documents,
saved queries, reports, workbooks, operator queue and portable archive engine.

The native target in this release is an owned local SQLite reference database.
The source is a complete saved Analysis version. An operator reviews the key,
field mapping, units and source-time interpretation before preparing a project.
There is no publisher request, package installation, customer-database connection
or external sender in these modules.

## Source and execution status

The WRI geothermal edition already has a completed original Datasette capture
and source/workspace receiving programme. Its four retained responses contain
189 rows, 22 countries and 26 ordered columns. The source review identified
189 distinct nonblank `gppd_idnr` values; the provider declares no primary key.
The provider's `rowid` remains an edition-local locator.

That original completion does not establish an NLD execution. This addition's
source is authored and its native source check/whole NLD receiving operation
must be reported from their actual returned results. The original entered
Analysis workspace UUID, operation ID and imported edition ID are required;
they are not replaced by the Datasette source-edition hash.

The retained source is in
[`../datasette/sources/wri-geothermal-20261012/`](../datasette/sources/wri-geothermal-20261012/).
The complete source archive is `wri-geothermal.sfds.gz`, 59,792 bytes,
SHA-256 `53f2486406d61f18c9e1c9ceaac659c265bbad7afe2fe54b1a17f43307cb0ca0`.
Its source edition is
`ee34942e0c4c090d4e5cab66eeb51dda49c5cf8852f86d9dfa299913b4115616`.
The original Analysis handover pins the complete 11,569-byte source manifest at
`fc63d12116d42e77f4a8364d5c3091a5aa29b4ad1348a338eae17e8881eaef56`.
Use those already retained files through the original source intake.

WRI is the publisher, the host is Simon Willison's Datasette deployment, and
the source is licensed CC BY 4.0. The capture window is October 12, 2026,
14:31:08–14:41:57 UTC. Capacity values are historical MW; generation values
are GWh attached to their original years. Estimated generation remains a
separate source field. The retrieval window is not a plant-update watermark.

## Open the same application

Use the original installed `datasette-analysis` command or
[`cli.py serve`](cli.py) to reopen the existing customer's Analysis workspace.
The maintained application serves `/datasette` and the full Analysis application
at `/` on one private listener. Its original capability and workspace identity
apply to the NLD view as well. The new view is **NLD operations**.

Keep an existing browser/server open for connected CLI work. Use `--connect`
to send commands to that original operator. For a direct command, first stop
that operator and select the same saved workspace and operation ID.

The application presents the full workflow:

1. Select a complete original source edition and either a new reviewed project
   or an existing project with the same mapping and native target.
2. Review every selected field, its target alias and the ordered business keys.
   Review the unit, source-time basis and note before enabling a known subtotal.
   Download the complete specification from this form if the CLI or receiving
   programme will continue it.
3. Select the retained definition, native execution strategy, operator and
   reason. Inspect its actual UID and original activity entry after acceptance.
4. Read all original projection, target-review and frozen target rows through
   normal paging. Download the original workbook, workbook handover, HTML,
   JSON and complete CSV report.
5. Export the complete workspace. Receive it through the original archive
   receiver, materialize the same retained NLD project and continue deliberate
   edits or backfills in the received workspace.

The UI loads mappings from the selected edition's actual columns. It does not
assume a fixed 26-column alias list. The complete original row is retained even
when the reviewed native mapping selects fewer columns.

## Identity, values and meaning

| Identity or field | Meaning |
| --- | --- |
| Analysis workspace UUID | Original database/workspace identity; preserved by the original archive receiver. |
| Datasette operation ID | Existing 32-character lowercase hexadecimal customer operation. |
| Imported edition ID | Original complete Analysis edition, 64 hexadecimal characters. |
| NLD project ID | Reviewed mapping and local native target, 32 hexadecimal characters. |
| Definition ID | Complete generated native project and exact frozen input, 64 hexadecimal characters. |
| Native run ID | Original NLD execution UID, 32 hexadecimal characters; never an automatic retry token. |
| Operator request ID | Original queued action and exact body, 32 hexadecimal characters. |
| Export ID | One original workspace archive generation and its frozen NLD checkpoint. |

A business key hashes the explicitly reviewed ordered source keys together with
their kinds and canonical values. Null, absent or unsupported compound keys
are rejected, as are duplicate business keys and the original row locator.
Numeric keys use exact decimal canonicalization; a numeric key and a text key
are different identities.

A processing key hashes the mapping meaning, business key, exact selected
values, original kinds and presence. This gives the native `by_key` state a
content identity. An unchanged row in a later captured edition can reuse its
completed content key. A changed selected value becomes a new content key.
The source edition, imported version, original ordinal and full original row
remain separate lineage fields. Unselected source-value changes do not become
selected-value changes.

The reference target stores numeric spellings as TEXT. It carries
`_sf_types`, `_sf_presence` and `_sf_original_values` with every row.
Absent, null, blank and present values remain distinct. The original imported
numeric tokens must be available; an already rounded binary float is rejected.
Exact arithmetic accepts a bounded finite decimal representation and never
converts a source value to SQLite REAL.

A new mapping, key order, namespace or native table requires a new project ID.
A later source edition with the same meaning creates a new definition in the
same project. Captured-at timestamps are not promoted to update timestamps.
Rows outside the current selection are counted separately and remain in the
target. Absence from a later selection does not authorize deletion.

## Reviewed specification

The schema is `stellar-forge.datasette-nld.v1/specification`. Save the complete
form result; do not replace it with a page of data or an inferred header list.

| Field | Requirement |
| --- | --- |
| `name`, `namespace` | Explicit local names, letter followed by up to 47 letters, digits or underscores. The target `name` must not be `retained_input` in any case; that table is reserved for the original staging input. |
| `title` | Human-readable project title. |
| `keys` | Ordered list of actual source aliases, all included in the mapping. |
| `mapping` | Ordered objects with `source`, `target`, optional `description`, `unit`, `time_basis`. |
| `reviewer`, `note` | The actual review decision and its author. |
| `measures` | Optional known subtotals: `target`, `unit`, `time_basis`, `note`, optional boolean `nonnegative`. |

For the WRI edition, the retained key review supports `gppd_idnr`.
The complete reference profile is
[examples/wri-geothermal-20261012/nld-specification.json](examples/wri-geothermal-20261012/nld-specification.json).
It maps all 25 nonlocator fields one-to-one using the retained original schema,
keeps the full original row including rowid as provenance, and separately
labels the historical measures. Its reviewer is this source integration review,
not a claimed customer approval. Inspect the actual imported aliases before
using or revising this mapping. Keep capacity,
each generation year, estimated generation and the reported source/reference
fields distinct. A subtotal is the sum of the known qualifying values in the
selected rows, with the number of usable and unusable values shown separately.
It is not a complete-world population estimate.

## Pinned native runtime

The native source contract is in [NLD_SOURCE_CONTRACT.json](NLD_SOURCE_CONTRACT.json).
The selected publisher source is
[`nexuslab-data/nld-core` at `15db818176ce0c2ed825b2be4bb1714273b14f85`](https://github.com/nexuslab-data/nld-core/tree/15db818176ce0c2ed825b2be4bb1714273b14f85),
version `0.1.2a5`, with its Apache-2.0 declaration. Its published Python range
is `>=3.12,<3.14`. Select an already installed Python 3.12 or 3.13 environment
with the publisher's declared dependencies and `pyarrow`, which the original
local state backend imports even for JSON files.

The worker verifies the installed version and the exact bytes of all 16 declared
integration modules before dispatch. It records the actual Python executable,
Python version and installed dependency versions. A matching package name alone
does not satisfy this check. No command installs or upgrades that runtime.

Each definition retains its own complete native project:

- `nld_project.yml`, original-compatible namespace/connection declarations;
- reviewed target and retained-input Structures;
- the native flow declaration and complete `SELECT … WHERE true` SQL;
- exact `source.json` projection;
- `nld_task.py`, `nld_contract.py`, `nld_worker.py`;
- `project-manifest.json`, binding every member by byte length and SHA-256.

JSON syntax is used inside the YAML files and consumed by the original loader.
The flow is a subclass of the original SQLFlowTask, with native `UPSERT`,
`by_key`, immediate key-state persistence and the original LocalJSON backend.
A small adapter stages the exact selected input in its owned reference database.
All native target and state connection paths are checked before opening them.

The explicit `WHERE true` retains SQLite's documented INSERT…SELECT UPSERT
disambiguation. See
[SQLite's parsing-ambiguity explanation](https://www.sqlite.org/lang_upsert.html#parsing_ambiguity).
The source review also established that upstream SQLite statements commit
individually. An upstream overwrite/delete-insert failure can follow a
committed deletion; this addition selects UPSERT and always reads the actual
result instead of claiming transaction-wide rollback.

## Execute and recover

| Strategy | Original native behavior selected here |
| --- | --- |
| FULL | Explicitly process all current retained input keys. |
| DELTA | Let the original by-key manager select unfinished/new content keys. |
| BACKFILL | Process an explicit retained-key list or an explicit limit. |
| BACKFILL_DELTA | Use the original combined backfill/delta behavior with that explicit selection. |

FULL and DELTA reject a key list or limit. The two backfill modes require one
explicit selection mechanism. An empty selection returns before the native
target-write hooks. The adapter may refresh its input staging table, so this
is specifically **no native target write**, not a claim of zero database writes.

Use one original operator request and native UID for an uncertain attempt.
The worker takes its existing project lock, freezes the request, records a
dispatch before invoking the original flow and retains the native return or
exception. The supplier's `task_uuid` binds identity; it does not suppress
a second execution by itself.

On reopen:

- An intact completed receipt returns its original files without another
  native lifecycle.
- A dispatched operation with no returned result reads the exact UID's
  retained terminal history, including a terminal failed result. No history
  list limit or empty steps list is treated as proof of absence.
- If no unambiguous terminal result exists, the operation stays unresolved.
  Preserve the same UID and original files. A new UID cannot bypass it.
- A terminal failure freezes the full actual target, source comparison,
  SQLite backup, native state, original return/error and member identities.
  A later separately reviewed UID may run only after that failed state has
  been retained completely. The failed UID itself is never re-executed.

Invocation logs are outside the worker's immutable run closure because its
final stdout is written after completion. The later project checkpoint retains
the complete closed invocation logs as well. A process-creation failure is an
invocation outcome, not a native NLD completion.

The main native run files are `intent.json`, `runtime.json`,
`dispatch.json`, `native-selection.json`, `native-return.json` or
`native-error.json`, `target-review.json`, `target-rows.json`,
`target-rows.csv`, the SQLite backup, native state and `completed.json`.
Failed results use `failed-target-review.json`, `failed-target-rows.json`
and `failed-receipt.json`. CSV blanks are a presentation; JSON plus the
retained kind/presence fields remain authoritative.

## CLI and original API

Use the existing installed source path for `nld_cli.py`. The placeholders below
must be replaced by IDs returned from the same original operation.

~~~sh
python3 nld_cli.py status --workspace /absolute/original-analysis \
  --operation-id ORIGINAL_OPERATION --connect

python3 nld_cli.py prepare --workspace /absolute/original-analysis \
  --operation-id ORIGINAL_OPERATION --connect --request-id ORIGINAL_PREPARE_REQUEST \
  --project-id REVIEWED_PROJECT --edition-id ORIGINAL_IMPORTED_EDITION \
  --specification /absolute/reviewed-specification.json

python3 nld_cli.py run --workspace /absolute/original-analysis \
  --operation-id ORIGINAL_OPERATION --connect --request-id ORIGINAL_RUN_REQUEST \
  --project-id REVIEWED_PROJECT --definition-id RETURNED_DEFINITION \
  --run-id ORIGINAL_NATIVE_UID --strategy FULL --operator "Actual operator" \
  --note "Full retained source under the saved mapping" \
  --python /absolute/existing-nld-environment/bin/python

python3 nld_cli.py request --workspace /absolute/original-analysis \
  --operation-id ORIGINAL_OPERATION --connect --id ORIGINAL_RUN_REQUEST --resume

python3 nld_cli.py rows --workspace /absolute/original-analysis \
  --operation-id ORIGINAL_OPERATION --connect --project-id REVIEWED_PROJECT \
  --run-id ORIGINAL_NATIVE_UID --kind review --offset 0 --limit 100

python3 nld_cli.py pack --workspace /absolute/original-analysis \
  --operation-id ORIGINAL_OPERATION --connect --request-id ORIGINAL_EXPORT_ID \
  --project-id REVIEWED_PROJECT
~~~

Keep the entire original action body and its request ID. `--no-wait` returns
the accepted connected request; client waiting does not own the server's work.
`report` continues the saved original query/report/workbook jobs if only that
production was interrupted. `download` selects the original file name, exact
export ID when relevant, expected SHA-256 and a new destination.

The original `cli.py call` also accepts the NLD actions. The maintained installed
launcher additionally routes `-- nld COMMAND …` to `nld_cli.py` and
`-- nld-receive …` to `nld_receiving.py`, using the same selected Analysis
Python installation and complete source binding. Its inspection verifies all
22 required application/runtime/contract files, including the NLD leaves.
The separate `--nld-python` or run `--python` chooses the already installed
publisher-compatible native environment; it does not replace the Analysis runtime.

The Python class and HTTP bindings are:

| Action / read | Payload or query |
| --- | --- |
| `nld.status` | Optional `project_id`. |
| `nld.rows` | `project_id`, optional `definition_id`/`run_id`, `kind` source/review/target, `offset`, `limit` 1–500. |
| `nld.prepare` | `project_id`, `edition_id`, complete `specification`. |
| `nld.execute` | `project_id`, `definition_id`, `run_id`, `strategy`, `operator`, `note`, optional `python`, `keys` or `limit`. |
| `nld.report` | `project_id`, `run_id`. |
| `nld.pack` | `project_id`, original `export_id`, optional local `destination`. The HTTP operator binds export_id to its request ID. |
| `nld.restore` | `project_id`, optional retained `checkpoint_id`. |

Mutations use the original
`POST /api/datasette/requests` envelope
`{request_id, action, body}`. Original request read/resume routes are unchanged.
Read routes are `GET /api/datasette/nld/status` and
`GET /api/datasette/nld/rows`; downloads use the original file route.
The supplied typed Python client exposes `nld_status` and `nld_rows`.
There is no separate listener, token system, request journal or database.

## Reports, complete delivery and editable receiving

The result report separates complete-source matching from the number of keys
processed in a particular native run. Matching, missing, different and
outside-selection populations have explicit denominators. Missing native
metrics stay null. Known decimal sums, extrema, source years, units, nulls,
blanks and unsupported values remain available in the report and workbook.
A zero-key DELTA may retain a fully matching target while processing no keys.

Every checkpoint contains the complete native project, exact definitions,
selected originals, actual target SQLite backup, native state/history,
original return/error receipts and closed logs. It is registered through the
original portable ResponseDocument contract. Failed file prefixes are retained;
the checkpoint never substitutes a partial file for a complete original.

One export ID freezes one checkpoint and original workspace archive. Reopening
that ID validates and reuses its original checkpoint even after later work.
If the project changed before the original archive completed, the adapter
requires either the actual completed original archive job or a new export ID;
it never pairs a fresh checkpoint with an older archive. A received archive
retains earlier export evidence even when the original archive file is held
separately; use a new export ID for a new received-workspace delivery.

The original ResponseDocument member limit is 32 MiB. The complete NLD project
archive must fit that limit; expanded closure is checked at 512 MiB. A larger
project requires an explicitly supported larger original transfer, not omitted
history or truncated logs. Original run-file JSON readers also enforce their
declared bounded limits.

Receive the complete workspace through the original
`stellar_forge_buyer.workspace_archive_receive.restore_archive`.
Reopen the same workspace UUID and Datasette operation. Then run `nld.restore`
to materialize the complete project from its retained original document.
Before first materialization, the selected checkpoint must contain the current
complete definition history, current selection and every retained run record,
including prepared, failed and unresolved runs. The adapter checks immutable
requests, original dispatch/return/error identities, retained invocation logs,
terminal receipts and all their recorded member hashes. An older checkpoint
that omits later activity is rejected before a destination or restore intent is
created. The selected archive's every member is checked before publication.
An existing edited project is preserved rather than overwritten by an older
archive.
Original project credentials are not supplied: only local reference path
bindings are reconstructed for each native invocation.

## Whole native receiving programme

[`nld_receiving.py`](nld_receiving.py) is the complete original-operation
programme, not a second provider capture. Use it only in the existing owner's
selected stopped Analysis workspace with its real imported edition and reviewed
specification. It opens the original operator, then closes it between the
original and received-workspace stages.

~~~sh
python3 nld_receiving.py \
  --workspace /absolute/original-analysis \
  --workspace-id ACTUAL_ANALYSIS_UUID \
  --operation-id ORIGINAL_DATASETTE_OPERATION \
  --edition-id ACTUAL_IMPORTED_EDITION \
  --programme-id RETAINED_PROGRAMME_ID \
  --specification /absolute/reviewed-specification.json \
  --nld-python /absolute/existing-nld-environment/bin/python \
  --destination /absolute/nld-customer-delivery \
  --operator "Actual receiving operator" \
  --note "Retained WRI source commissioning and received-project continuation" \
  --expected-rows 189 --backfill-count 3 \
  --checkout /absolute/selected-source --node /absolute/node
~~~

The programme freezes its exact source files, runtime choices, input identities,
operator and destination before acting. It performs a full selected flow,
checks every actual target row, runs the same-content DELTA, retains the zero-key
result, downloads the complete five-file report/workbook package and exports
the whole Analysis workspace.

It then closes the original operator, restores the archive, reopens the same
original UUID/operation, checks source/UID/report/workbook identity, and performs
an explicitly selected backfill in that editable received project. The exact
same request is replayed only to verify its existing completion. A second
complete archive is independently restored and its three original native UIDs,
source rows, target and revised report are checked.

The durable entry receipt is `nld-receiving.json`. Outputs include
`source-projection-rows.json`, `full-native-target-rows.json`,
`unchanged-delta-target-rows.json`, `revision-two-native-target-rows.json`,
complete `original-products/`, `received-products/`,
`revision-two-products/`, both delivery folders and both editable receiving
workspaces. All actual result files retain lengths and SHA-256 identities.

Continue an interrupted programme using its unchanged full command with
`--resume`. A completed receipt verifies all saved outputs and returns them
without reopening a workspace or re-executing a native flow. No completed
native state should be inferred from the existence of this programme or guide.

## Source ownership and publication

This is an additive maintained Analysis workflow. The existing Datasette
source owner retains the original WRI acquisition and its native source
operation. Existing commercial/contact ownership remains separate from the
reusable software. This source does not establish a paid engagement, tenant
migration or customer production deployment.

Primary retained contracts:

- [Pinned NLD SQLFlowTask](https://github.com/nexuslab-data/nld-core/blob/15db818176ce0c2ed825b2be4bb1714273b14f85/core/nld/flow/sql/sql_flow_task.py)
- [Pinned NLD flow executor](https://github.com/nexuslab-data/nld-core/blob/15db818176ce0c2ed825b2be4bb1714273b14f85/core/nld/flow/task/data_flow_executor.py)
- [Pinned NLD project metadata](https://github.com/nexuslab-data/nld-core/blob/15db818176ce0c2ed825b2be4bb1714273b14f85/pyproject.toml)
- [Original Datasette customer Analysis guide](README.md)
- [Complete WRI source/attribution guide](../datasette/sources/wri-geothermal-20261012/README.md)
