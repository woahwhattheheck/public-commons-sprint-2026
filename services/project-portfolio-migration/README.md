# Project Portfolio Migration

A local operator and native schedule workspace for retained Microsoft Project
portfolios. Keep each original MPP, MPT or MSPDI file, its enterprise companions,
the reviewed target mappings, the actual target responses and the received
editable project together.

The maintained **MPXJ 16.10.0** engine reads the source and writes MSPDI XML.
The application retains an exact typed capture alongside MPXJ's original JSON
export. Native date, calendar, cost, duration, timephased and dependency
semantics remain owned by that engine.

## Install and open

Use Python 3.12 or later and a Java runtime supported by the pinned MPXJ
distribution. Install the exact Python dependencies from this directory:

~~~sh
python -m pip install -r requirements.txt
python -m portfolio runtime
~~~

The runtime command records the actual MPXJ version, Python distribution
versions, JVM vendor/version and every installed JAR's SHA-256 and size. An
already running JVM is reused. A JVM loaded with a different MPXJ version must
be restarted with the selected installed distribution.

The complete browser and target operation tools live under `operator/`.
That directory contains the `portfolio_target` Python package plus separate
entrypoints, so it does not shadow Python's built-in `operator` module.
The core Python API is `from portfolio import PortfolioWorkspace, NativeMPXJ`.

Keep the workspace in a private directory. It contains original source data,
full review history and target responses. The operator guide describes opening
the browser and selecting its existing local authorization and target account.

## Start from retained original files

Microsoft's published Project Online lifecycle ends on September 30, 2026.
A retained export is sufficient to start this product; a surviving Project
Online service endpoint is not part of source intake.

~~~sh
python -m portfolio --workspace /path/to/portfolio intake \
  --request original-portfolio-20261012 \
  --source /path/to/export/Engineering.mpp \
  --label "Engineering — retained source"
~~~

Use the returned full `id` for subsequent operations. `sha256` identifies the
complete captured model. `source_ids` identify the retained original artifact
bytes. Original files are never edited.

The default input profile is:

~~~json
{
  "format": "auto",
  "raw_timephased": true,
  "ignore_errors": false,
  "microsoft_compatible": true,
  "charset": null,
  "source_timezone": null,
  "source_locale": null
}
~~~

`format` accepts `auto`, `mpp`, `mpt` or `mspdi`. The original file signature
distinguishes MPP from XML after its bytes are retained under a content hash.
Source timezone and locale values are explicit provenance; the application
does not change the JVM's process-wide timezone or reinterpret MPXJ local dates.
Select an actual charset for an MSPDI source when its native input requires it.

MPP intake selects raw timephased values, presentation data and complete project
properties. Protected MPP input respects the native password protection.
A Python caller can provide a private `mpp_password_provider(path)` to
`NativeMPXJ`; the returned password is used for that native read and is not
written to the input profile, model or operation request.

MSPDI parsing defaults to reporting parse failures. If an explicit source
profile enables `ignore_errors`, the captured model includes the native
ignored-error list for review.

### Enterprise companion sources

Pass an array of complete source descriptors through `--companions`:

~~~json
[
  {
    "path": "/path/to/export/enterprise-task-fields.csv",
    "label": "Enterprise task fields",
    "format": "csv",
    "role": "enterprise_fields",
    "encoding": "utf-8-sig",
    "delimiter": ","
  },
  {
    "path": "/path/to/export/lookup-tables.json",
    "label": "Enterprise lookup tables",
    "format": "json",
    "role": "lookup_tables",
    "json_pointer": "/tables"
  }
]
~~~

CSV, TSV, JSON and JSONL companions retain their original bytes and every source
record. CSV column keys use their original ordinal (`column:0`, `column:1`, ...)
so duplicate header labels remain distinguishable. JSON numeric lexemes retain
their original text. Blank cells, absent cells and explicit nulls remain
distinct. Arbitrary binaries are retained as complete attachments.

Each capture contains source row keys and original column keys. A mapping
selects those keys, the exact native family, and a native `key`, `uid` or `guid`
identity. No source number, locale or duration unit is inferred from a label.


### Select a particular companion capture

One original file can supply several captured views: for example, different
roles or JSON pointers within an enterprise export. Read the selected edition's
`companion_captures` array to select its exact view. Each descriptor includes
`capture_id`, its original ordinal, source ID, label, role, format, full input
profile, profile hash, original column keys and row count.

A companion mapping may include the returned `capture_id` alongside its
`source_id`:

~~~json
{
  "source_id": "ORIGINAL_SOURCE_SHA256",
  "capture_id": "CAPTURE_ID_FROM_THIS_EDITION",
  "family": "tasks",
  "identity": {"kind": "uid", "column": "column:0"},
  "columns": [{"column": "column:1", "field": "TEXT1", "type": "string"}]
}
~~~

A source ID alone continues to select a file with one capture. When several
captures share its bytes, the mapping response supplies their descriptors for
an explicit choice. Source-cell links retain the chosen capture ID, ordinal
and profile hash. These selectors are derived beside the captured model;
reading an older edition preserves its original model and content hash.


## What a captured edition contains

| Content | Retained representation |
| --- | --- |
| Original project and companion files | Complete bytes with SHA-256 and size |
| Tasks, resources, assignments and project properties | Declared and user-defined MPXJ fields, exact typed values and pre-getter cached values |
| Native identity | Original UID/GUID, hierarchy and assignment links |
| Durations and work | Original numeric value, native TimeUnit and elapsed-unit flag |
| Dates and times | Native local ISO values without timezone conversion |
| Money, percentages and numeric fields | Original native decimal text and Java number type |
| Resource costs | Every native cost rate table, rate and effective range |
| Calendars | Original UIDs, parent calendars, complete weekday hours, exceptions, recurrence and working weeks |
| Dependencies | Native predecessor/successor, relation type, lag, notes and driving flag |
| Timephased values | Raw native work/cost amounts, ranges and original baseline fields |
| Rich notes and binaries | Native representations where exposed, original formats and original source bytes |
| MPXJ JSON | Unmodified UTF-8 output, parsed content, byte hash and size |
| Native findings | Exact field/source path and original native error or structured-value type |

MPXJ's JSON writer rounds numeric values, omits some zero/false values and
filters calendars for a project. The typed native capture supplements those
representations. Its complete original source remains attached throughout the
workflow. The application does not implement another scheduling engine.

## Review and correct an original edition

A review records a target profile, explicit mappings, handling decisions and
native corrections. It does not mutate the source edition.

~~~sh
python -m portfolio --workspace /path/to/portfolio review \
  --edition FULL_SOURCE_EDITION_SHA256 \
  --target mspdi \
  --corrections /path/to/review/corrections.json
~~~

Every correction selects an existing original entity and its exact typed
preimage:

~~~json
[
  {
    "family": "tasks",
    "key": "task:42",
    "field": "NAME",
    "before": {"type": "string", "value": "Original reviewed task"},
    "after": {"type": "string", "value": "Corrected reviewed task"}
  }
]
~~~

The example key and value are illustrative. Use values returned by your actual
edition. Supported families are `project`, `tasks`, `resources` and `assignments`.
Choose a declared native enum field or a uniquely identified original
user-defined field from the edition's `field_catalogue`.

Identity, hierarchy, project-link and dependency fields are retained for
matching. Correct their actual source or use the target operation workflow
when a native structural change is needed. The scalar correction API does not
silently rewrite those links.

An explicit `after: null` requests a clear. A getter that immediately
recalculates that field is reported with its actual native value. Date, duration,
rate, number and enum corrections are passed to native Java types; ordinary
strings cannot masquerade as a native date or duration.

### Map companion fields explicitly

The `mappings.companions` array can produce native corrections from original
enterprise source records:

~~~json
{
  "companions": [
    {
      "source_id": "FULL_ORIGINAL_COMPANION_SHA256",
      "family": "tasks",
      "identity": {"column": "column:0", "kind": "uid"},
      "columns": [
        {"column": "column:1", "field": "TEXT1", "type": "string"},
        {"column": "column:2", "field": "FIXED_COST", "type": "number", "decimal_separator": "."}
      ]
    }
  ]
}
~~~

Select the actual source keys and declared native fields from your capture.
Each mapped cell retains its source row, source column, native target field,
before value and after value in `companion_links`.

Number mappings accept explicitly selected decimal/grouping separators.
Durations and rates additionally require the native `units` name. Boolean
mappings accept explicit `true_values` and `false_values`. Date/time cells use
native ISO text. `clear_blank: true` is an explicit clear; a short CSV record
with no such column never creates an implicit clear.

Two source cells cannot target the same native field within one review.
Unmatched or repeated entity identities become concrete review findings.

### Complete target handling decisions

A target review includes source findings and supported-route feature findings.
Only findings marked `requires_decision: true` require a handling decision
before `apply_review`. Ordinary native capture findings remain visible.

Pass decisions keyed by the full finding ID from that original review:

~~~json
{
  "FULL_FINDING_SHA256": {
    "action": "retain_source",
    "note": "Deliver these enterprise lookup tables in the complete receiving workspace."
  }
}
~~~

Actions are `retain_source`, `mapped`, `accept_target_behavior`,
`exclude_from_target` or `resolve`. Each decision requires a concrete note.
The resulting review stores all original findings, mappings and decisions.

~~~sh
python -m portfolio --workspace /path/to/portfolio apply \
  --request reviewed-correction-20261012 \
  --review FULL_REVIEW_SHA256
~~~

The native engine applies the reviewed values to an instance reopened from the
original source recipe. The result is a separate corrected edition. The
original file, original model, review and complete before/after comparison stay
available.

## Native output and complete comparison

~~~sh
python -m portfolio --workspace /path/to/portfolio export-mspdi \
  --request native-export-20261012 \
  --edition FULL_REVIEWED_EDITION_SHA256
~~~

Default output controls are:

~~~json
{
  "write_timephased": true,
  "microsoft_compatible": true,
  "save_version": "Project2016"
}
~~~

MPXJ writes the selected native MSPDI file, then reads that actual output again
with parse errors enabled. The result includes the output artifact path/hash,
native readback edition and complete original-to-readback comparison.
Keep this comparison with the target's own import exception report.

The output path is resolved under the current workspace's immutable object
directory. It remains correct when that workspace is independently received
on a different path. The original operation stores artifact identity rather
than depending on its former host's absolute file path.

The native writer supports MSPDI output. MPP remains an input format. A
Planner file-import route that requires MPP must use the actual supported
Microsoft application conversion step and retain its resulting original file
and exception report.

~~~sh
python -m portfolio --workspace /path/to/portfolio compare \
  FULL_SOURCE_EDITION_SHA256 FULL_TARGET_EDITION_SHA256 \
  --identity-map /path/to/review/native-identities.json \
  --strict-identity
~~~

An identity map uses exact original row keys within each family:

~~~json
{
  "tasks": {"task:42": "task:7"},
  "resources": {"resource:6": "resource:12"}
}
~~~

The ordinary file comparison first uses explicit mappings and unique GUIDs,
then compatible original UIDs. Conflicting nonempty GUIDs do not silently
align through a repeated numeric UID. Missing and duplicate identities remain
unmatched unless explicitly resolved.

Use `strict_identity=True` for cross-system native captures. Only explicit
mappings and unique GUIDs match rows in that mode. Recreated target integer IDs
and coincident row positions never stand in for original entity identity.
Project properties are compared as the single project property collection.

Comparison retains all changed typed values, calendar/rate/timephased
structures and added/removed entity rows. It also compares the complete field
catalogue and every retained native definition, lookup, code, currency, unit,
contour and layout collection. These appear in `definition_changes` with their
original JSON Pointer paths and full before/after values. `definition_sources`
identifies each field catalogue, native JSON and selected collection content.
The original JSON entity arrays already covered by typed entity comparisons
are excluded from this separate definition section.

Full getter caches and original JSON remain in the source models for inspection.
Companion changes are retained separately from changes to the native project
file. A field alias, type, lookup or layout change therefore stays visible even
when the existing task and resource values are unchanged.

### Native target capture

The operator can read an actual selected Project Operations environment through
MPXJ's maintained `MsPlannerReader`. It captures the returned native
`ProjectFile` while holding the same processwide reentrant native lock.

`capture_native` retains that complete original typed model, its reader/target
provenance, native MSPDI backing bytes and a complete comparison against the
native reopen of those bytes. Conversion changes stay visible when the
captured project is reopened later. The original native account selection and
target operation receipts belong to the operator's retained record.

## Target route distinctions

Microsoft's MPP import creates a new project and documents a limit of ten
custom fields plus feature omissions including resources, baselines,
cross-project links, deadlines, formulas, manual/inactive/recurring tasks and
subprojects. Review the actual returned project and its original exception
report. Select a different supported route when the preserved source feature
requires it.

The documented Project Operations scheduling APIs require a licensed
Microsoft Project **user**. Application/system/integration users do not provide
that documented scheduling route. The operator retains the selected native
metadata and API version, project/team identities, original OperationSet IDs,
per-operation details and uncertainty.

Scheduling OperationSets allow up to 200 operations and ten open sets. Project
and team creation occur immediately outside an OperationSet. The complete
operator workflow uses those actual scheduling actions and their native
receipts; its guide describes continuation, pause, correction and acceptance.

## Deliver and reopen the entire project

~~~sh
python -m portfolio --workspace /path/to/portfolio archive \
  --output /path/to/delivery/portfolio-workspace.zip

python -m portfolio receive \
  --archive /path/to/delivery/portfolio-workspace.zip \
  --destination /path/to/received/portfolio
~~~

Save the archive outside the active workspace. It contains a native SQLite
snapshot, every immutable source/model/output artifact, original operations,
reviews, comparisons and the operator's completed JSON/object history.
The per-file manifest retains exact sizes and SHA-256s.

Receiving checks all original members and writes a resumable receiving record.
An interrupted receive continues only with its same original archive. A
received file that was edited is preserved as an edited working copy; receive
another archive into its own destination.

The operator drains its mutations while calling the workspace exporter.
Transient native locks are excluded; saved operator pause intent and all
business artifacts stay in the delivery. Workspace and operation locks cover
local mutations, and the native engine lock remains reentrant.

Repeated original request IDs return their retained results. A different
payload cannot reuse an already recorded request ID. The CLI `operation`
command opens the original request, result and retained errors.

## Native receiving run

`native_receiving.py` consumes five unchanged fixtures from MPXJ commit
`7ef9e72813d33378c55ec6ceb148cc831ed22033`. It verifies each original Git blob
identity/size, records actual SHA-256s, runs source intake and native output,
applies a task correction, reads the actual native output, archives the whole
workspace and independently receives and reopens it.

~~~sh
python native_receiving.py \
  --upstream /path/to/mpxj \
  --directory /path/to/original-native-receiving
~~~

Use the same receiving directory to resume or reopen that operation. The full
result contains actual native runtime information, original fixture identities,
complete comparisons, corrected editions and receiving output. The joined
operator receiving flow adds real browser operation, retained local-response
recovery, acceptance and desktop/narrow views to this same source workspace.

## Original sources and distribution

- [MPXJ 16.10.0 release](https://github.com/joniles/mpxj/releases/tag/v16.10.0)
- [Pinned maintained source](https://github.com/joniles/mpxj/tree/7ef9e72813d33378c55ec6ceb148cc831ed22033)
- [MPP reader](https://github.com/joniles/mpxj/blob/7ef9e72813d33378c55ec6ceb148cc831ed22033/src/main/java/org/mpxj/mpp/MPPReader.java)
- [MSPDI writer](https://github.com/joniles/mpxj/blob/7ef9e72813d33378c55ec6ceb148cc831ed22033/src/main/java/org/mpxj/mspdi/MSPDIWriter.java)
- [Native JSON writer](https://github.com/joniles/mpxj/blob/7ef9e72813d33378c55ec6ceb148cc831ed22033/src/main/java/org/mpxj/json/JsonWriter.java)
- [Project Online lifecycle](https://learn.microsoft.com/en-us/lifecycle/products/project-online)
- [Microsoft Project file import](https://support.microsoft.com/en-us/office/move-your-project-from-project-desktop-to-project-for-the-web-143ab391-002e-451a-aedb-3b6fa1f6ab8b)
- [Project Operations scheduling API](https://learn.microsoft.com/en-us/dynamics365/project-operations/project-management/schedule-api-preview)

The unchanged upstream license and Python package metadata are retained under
`third_party/mpxj/`. The original LICENSE text is LGPL 2.1; the original Python
package metadata says LGPL-2.0-or-later. Both original declarations are
preserved. MPXJ and JPype are installed as the named upstream distributions;
the application owns its workspace/operator layer and calls the maintained
native engine.


## Portfolio archive and reporting

The migration desk includes an Archive tab for retaining a reviewed cohort of complete project editions. Each business project has one selected edition and an explicit project key. The [archive operating guide](archive/README.md) covers cohort selection, native field columns, companion data, reporting measures, SQL, publishing and receiving into a fresh workspace.

A publication includes the complete native source closure, relational SQLite database, all table CSVs, data dictionary, exact measure contributions and totals, Power Query, Azure SQL script, printable report and portable archive. Cost measures retain their native currency or an explicit project declaration. Work measures retain their original units and elapsed-time flag. Select project properties, leaf tasks or assignments as the measure grain so the report does not add summary and detail values together.

The saved review identifies the complete projected rows before publication. A receiving desk restores the source editions and recomputes the same relational rows and measure totals before committing the received cohort. Query exports use the original completed database and preserve all returned rows. The [native archive receiving phase](archive/native/README.md) continues the existing equipped Portfolio operation through the actual browser, full delivery, fresh receiving and cold reopen.
