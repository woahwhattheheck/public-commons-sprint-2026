# Conversion workspace

Use this local browser workspace to map real source and target exports, stage a
conversion trial, inspect its complete reconciliation result, correct the
inputs, and deliver a reviewed replay package. It operates the original
[retained service](../service/README.md) and
[comparison engine](../README.md). Bundles, jobs, reports and reviews stay in
the selected private customer directory.

The default [SCAP profile](../profiles/scap-rfp-2027/README.md) supplies nine
conversion cohorts. A profile gives the operator starting fields and review
scenarios; the selected export headers and agreed conversion scope determine
the actual comparison.

## Start and reopen

Use Linux, Node.js 22 or newer, and the `flock` and `tar` executables in `PATH`.
Keep the complete repository checkout: the service uses the existing native
worker lease and captures the original engine when it stages a bundle. The
workspace has no npm dependencies.

Run from the repository root, choosing a private customer directory outside
the checkout. Its parent must exist. The service creates a new root with mode
`0700`; an existing root must already be private and owned by the operating
system account running the workspace.

```sh
umask 077
node revenue/erp-conversion-assurance/scap-workspace/cli.mjs \
  --directory /absolute/private/scap-conversion \
  --port 8470
```

Open the complete `workspace` URL printed in the startup JSON. It has a local
address and a private access fragment. Keep that URL with the operator. The
server binds to `127.0.0.1`; `--port 0` selects an available port. A new launcher
session prints a new access URL.

To reopen, run the same command with the same `--directory`. The workspace
reads the original saved bundles, job states, reports and reviewer events.
Closing the browser or stopping the browser host leaves the retained worker's
jobs available; reconnect to inspect their current state. Use the workspace's
explicit cancellation operation when a job should stop.

### Another conversion profile

Supply a JSON profile for another implementation, including the Columbus
conversion workflow, through the same host:

```sh
node revenue/erp-conversion-assurance/scap-workspace/cli.mjs \
  --directory /absolute/private/columbus-conversion \
  --profile /absolute/private/columbus/workspace-profile.json \
  --port 8471
```

The JSON uses the same shape as `SCAP_PROFILE`: `id`, `title`, `source`,
`cohorts` and `scenarios`. `source` identifies the official HTTPS URL, label and
sections. Each cohort supplies `id`, `title`, `purpose`, `keys`, `attributes`,
`amounts` and `groupBy`; each amount has `name`, integer `scale` and exact
decimal-string `tolerance`. Scenarios have an `id`, `title` and optional list
of cohort IDs. Grouping fields must be a subset of the cohort's keys.

Profile, cohort and scenario IDs start with a letter and contain letters,
digits, underscores or hyphens, up to 80 characters. Logical field names use
letters, digits and underscores. Profiles can contain up to 40 cohorts and
40 scenarios and must fit within 256 KiB. The selected profile snapshot is
saved inside each staged mapping. Reopening a bundle or correcting it uses
that saved profile, so later changes to the launcher profile leave the
original trial interpretable.

## 1. Define the trial's scope

Start with the appropriate cohort and name the dataset. Record the source and
target systems, historical period, conversion owner, coverage, excluded
history, required resources and timeline. Conversion owner and coverage are
required. Describe the actual export grain: for example, one journal line or
one employee/pay-run/allocation line.

The default cohorts provide these starting points:

| Cohort | Suggested comparison |
|---|---|
| Account structure | Fund/grant/account keys; account name, type and status |
| Ledger history | Journal-line identity, debit/credit amounts and posting date |
| Supplier records | Vendor identity, name and status |
| Customer and funding records | Party identity, name, classification and status |
| Staff records | Employee identity, department, position and status |
| Payroll history | Employee/pay-run/pay-line identity and gross, withheld and net amounts |
| Labor distributions | Employee/run/allocation and funding dimensions; earnings and hours |
| Asset register | Asset and funding identity, cost/depreciation/book value and selected text |
| Award and program structure | Fund/grant/program identity, name, award dates and status |

Adjust the suggested fields to the agreed exports. A payroll register and its
labor distributions usually have different record grains. Keep each trial at
its declared grain so register totals are counted once in that comparison.
For an optional dimension with empty identifiers, choose a stable available
record key and compare the dimension as an attribute when its original text
values should be preserved.

## 2. Load the source and target CSVs

Choose both complete exports for a new trial. The workspace reads their actual
UTF-8 CSV headers, including quoted headers and an optional UTF-8 byte order
mark. Header names must be unique and nonempty after trimming; the first CSV
record must fit within 64 KiB. Select the corresponding source and target
header for every logical comparison field.

Files are checked against the customer's saved input limit. Staging copies
their exact bytes into the retained service. Each bundle contains source,
target, mapping and the current original engine; all four participate in its
content identity. The original files can then be managed independently of
that retained bundle.

The **retained inputs** view opens a previously staged bundle, its complete
mapping and its original profile. That supports continuing a staged trial
before it has a job and preparing a correction from a completed run.

## 3. Select keys, text and exact amounts

Every selected field needs a logical name and a real header on both sides.
Field names are distinct across the three types. A mapping supports up to 100
selected fields.

| Field type | Meaning and comparison behavior |
|---|---|
| Key | One or more fields identifying a record. Key values must be nonempty; leading/trailing whitespace is trimmed and Unicode is normalized to NFC before matching. The complete key must be unique on each side. |
| Text attribute | A selected non-key field compared exactly after Unicode NFC normalization. Case, spaces and blank values remain significant. Dates and classification codes can use this type when their exact exported text matters. |
| Amount | A declared fixed-scale decimal compared with integer arithmetic. Scale is 0–8 and tolerance is a nonnegative decimal string with no more fractional digits than the scale. |

Master data can use keys alone or keys plus attributes, with `amounts: []`.
For financial fields, set the agreed scale and tolerance explicitly. For
example, a currency amount at scale 2 with tolerance `0.00` requires exact
cents; hours at scale 4 with tolerance `0.0000` retain four decimal places.
The comparator rejects values that do not fit the declared decimal format.

Select grouping on key fields when the trial needs continuity by fund, grant,
period or another declared dimension. Group checks compare record counts and
selected amount totals. They also work for key-only master cohorts, where
group record counts remain meaningful. Overall totals, individual records,
duplicates and groups all contribute to the result.

## 4. Map renamed composite keys

Enable a source-key crosswalk when approved source identifiers changed during
conversion. Select an ordered, unique subset of the reconciliation keys and
enter explicit source and target tuples in that same order. A composite
fund/grant mapping is retained as:

```json
{
  "keys": ["fund", "grant"],
  "rows": [
    {"source": ["OLD-FUND", "OLD-GRANT"], "target": ["NEW-FUND", "NEW-GRANT"]},
    {"source": ["GENERAL", "OPERATING"], "target": ["GENERAL", "OPERATING"]}
  ]
}
```

The example shows the shape; supply the approved tuples from the actual
conversion. Every distinct selected source tuple in the input needs a mapping,
including unchanged tuples through explicit identity rows. An enabled
crosswalk with a missing tuple makes the original job fail input validation.
Duplicate normalized source tuples are rejected when staging. Each tuple must
have exactly one nonempty string per selected key.

The engine translates those source key components before matching and
grouping. Target keys remain as exported. Different source tuples can be
mapped to the same target tuple, but the complete translated record key still
undergoes duplicate detection. A collision is reported in the comparison and
requires review. The report also records configured mapping rows, source rows
mapped and source rows whose selected key components changed.

The workspace allows up to 10,000 crosswalk rows; the complete mapping,
profile and scope must also fit the service's 256 KiB spec limit.

## 5. Stage, then start an explicit job

Review the scope, files, field mapping and crosswalk, then stage the bundle.
Staging retains the trial and returns its content identity. Choose an explicit
job ID to start the original comparison against that bundle.

Job IDs contain 1–96 letters, digits, dots, underscores or hyphens and start
with a letter or digit. Use a stable name such as `scap-payroll-trial-001`.
Submitting the same job ID and bundle reopens the existing job. That ID paired
with a different bundle returns `JOB_INPUT_CONFLICT`; use a new job ID for a
corrected trial. Each private customer root serializes its own jobs through
the original worker lease.

In **Runs & review**, open the selected job to follow its retained state and then its
report. Record and group discrepancies are paginated from the complete
verified report. Record filters select its actual finding kinds. The report
view keeps the original amounts, counts, totals and comparison status.

| Finding | How to investigate |
|---|---|
| Missing in target | Locate the reported `source_record` and check the selected target scope and key mapping. |
| Unexpected in target | Locate `target_record` and check whether that record belongs in the selected trial. |
| Duplicate key | Use `side` and `record` to inspect the repeated full key, including any crosswalk collision. |
| Amount delta | Open the identified source/target records and amount field; the reported difference is target minus source. |
| Attribute delta | Inspect the named text field at the identified source/target records using the declared exact-text semantics. |
| Group difference | Inspect the selected group dimensions, row counts and exact amount deltas. |

Record positions identify logical CSV data records after the header; quoted
multiline fields can make them differ from physical text-file line numbers.
The retained exports provide the original values, while report identifiers
use the customer's HMAC key.

## Correct the trial and record acceptance

Open the run's correction workflow. Keep either retained input or replace it
with a corrected complete export, amend the mapping or crosswalk as needed,
and supply the required correction reason. Stage the correction and run it
with a new job ID.

The revised mapping retains the previous bundle, the selected previous job,
an incremented revision and the correction reason. Replacement inputs are
copied; omitted inputs reuse the verified original bytes. A revision captures
the current original engine, while the earlier bundle keeps its own engine.
Both jobs remain available for the reviewer to compare.

For a completed report, enter the actual reviewer name and select
`accepted` or `changes_requested`. Record comments and the relevant profile
scenario observations as `passed`, `failed` or `not_applicable`, with notes.
These observations can describe the corresponding activity in the receiving
ERP, including its conversion trial or agreed UAT scenario.

Each save creates a new immutable reviewer event bound to the job's exact
report SHA-256. A later decision preserves earlier decisions. A stale report
digest requires reopening the completed report before saving. Reviewer names
are limited to 200 characters; comments to 3,000 and individual observation
notes to 1,000. The complete encoded review note must fit within 4,000
characters. Keep each review concise or record another version.

Comparison and review remain separate recorded facts: a reviewer can document
accepted exceptions with an `accepted` decision while the original discrepancy
report retains `FAIL`. Use the scenario observations and comment to explain
the decision and the actual UAT activity performed.

## Deliver and replay the private package

Download the completed run's private `.tar.gz` handoff from **Runs & review**. The
workspace calls the original `exportReplay` operation, packages its verified
directory with `tar`, streams the archive, and removes its temporary copy.
The archive expands to `reconciliation-JOB_ID/`.

| Included content | Purpose |
|---|---|
| `source.csv`, `target.csv`, `spec.json`, `engine.mjs` | Exact inputs, mapping/profile/scope and engine used by this job |
| `bundle.json`, `request.json`, `state.json`, `service.json` | Original content pins, request, completed result and saved limits |
| `report.json` | Original report bytes and identity |
| `reviews/` | The immutable reviewer events captured by this export |
| `hmac.key` | Customer key needed to reproduce record and group identifiers |
| `export.json` | File hashes and sizes, job/report/engine identity, creation and review-capture timestamps |
| `replay.mjs`, `README.txt` | Standalone replay program and instructions |

A package with one saved review contains 14 files. Additional reviews add
files; the exported manifest gives the actual inventory. Reviews saved after
the captured event set appear in a later export.

Keep the archive and extracted contents on the agreed private delivery route:
the package contains the complete customer exports and HMAC key. Extract into
a private location, preserving the package's directory mode `0700` and file
mode `0600`:

```sh
umask 077
tar -xzf /absolute/private/reconciliation-scap-payroll-trial-001.tar.gz \
  -C /absolute/private/replay-delivery
node /absolute/private/replay-delivery/reconciliation-scap-payroll-trial-001/replay.mjs
```

The extraction destination must exist. The standalone replay requires
Node.js 22 or newer. It verifies the manifest and all inventoried files,
checks the input, engine, report and key pins, then runs the retained engine
with the saved resource limits. It creates `replayed-report.json` beside the
original report. For another replay, choose a fresh filename with
`--out replay-002.json`.

When using the original operator's `export-replay` command, retain its export
receipt and pass its `manifest.sha256` to the replay as
`--manifest-sha256 DIGEST_FROM_EXPORT_RECEIPT`. The
[service guide](../service/README.md#export-a-complete-private-replay-package)
provides that command and receipt workflow.

Every engine run has a fresh `generated_at` timestamp. Replay compares all
other parsed report content and returns `matchesDeliveredReport`, the original
and regenerated report hashes, and the new filename. Matching `PASS` exits 0;
matching comparison `FAIL` exits 2; an execution error or substantive replay
difference exits 1. The delivered report keeps its original bytes.

## Job failure, cancellation and recovery

| State | Operator action |
|---|---|
| `QUEUED` | Reopen to follow the retained request awaiting the customer worker. |
| `RUNNING` | Follow progress or explicitly request cancellation. |
| `COMPLETED` with `PASS` | Inspect the full result and record the receiving review. |
| `COMPLETED` with `FAIL` | Inspect the delivered discrepancies, record review and prepare a linked correction as appropriate. |
| `FAILED` | Read the original error code and correct its cause before choosing recovery or a new corrected bundle. |
| `INTERRUPTED` | Inspect the retained state, then explicitly recover when the original worker is idle. |
| `CANCELLED` | Reopen the job or choose explicit recovery when that same retained trial should resume. |

Cancellation is a request: the current state can remain `RUNNING` briefly
while the original worker stops. Refresh to observe the terminal state.
Recovery uses the same job, bundle and retained engine. It can adopt an
already complete valid report left by the prior attempt or queue another
attempt. A correction to input data or mapping uses a new linked bundle and
new job ID instead.

For service-level diagnosis, the original operator can open the same root:

```sh
node revenue/erp-conversion-assurance/service/operator.mjs status \
  --directory /absolute/private/scap-conversion \
  --job-id scap-payroll-trial-001
```

`BUNDLE_CHANGED`, `REPORT_CHANGED`, `ENGINE_CHANGED` or `HMAC_KEY_CHANGED`
identify a retained-file identity problem; restore the original customer
backup before resuming. `FLEET_LINUX_FLOCK_REQUIRED` identifies the Linux lease
dependency. `FLEET_STATE_ALREADY_OWNED` means an original worker still owns
the operation. Reopen its current state before recovery. An existing
create-only export destination returns `EEXIST`; choose a fresh destination.

## Resource limits

| Resource | Default or limit |
|---|---:|
| Each complete source/target CSV | 8,388,608 bytes |
| Complete mapping, scope, crosswalk and retained profile | 262,144 bytes |
| Complete original report | 16,777,216 bytes |
| Engine runtime per attempt | 60,000 ms |
| Engine heap | 256 MiB; minimum 64 MiB |
| Header inspection | 65,536 bytes; up to 1,000 unique headers |
| Workspace report page | 50 rows by default; maximum 200 |
| Handoff archive packaging | 60-second process limit |

On first creation, set `--max-input-bytes`, `--max-report-bytes`,
`--timeout-ms` and `--max-heap-mib` when the agreed exports need another
resource profile. Later openings read the saved configuration. Supplying
different limits to the same root returns `SERVICE_CONFIGURATION_MISMATCH`;
initialize a separate private root for different limits. Over-limit inputs,
reports and attempts return an error so the operator can address the actual
complete workload. Host CPU, RAM and storage remain shared across customer
roots.

## SCAP source and acceptance scope

This profile follows the issuer's
[RFP 2027 for accounting, HR and payroll management software](https://scapnc.org/wp-content/uploads/2026/10/REQUEST-FOR-PROPOSALS-Accounting-Software.pdf),
issued October 5, 2026 and reviewed for this workspace on October 11, 2026.
The references below use the document's printed page numbers.

| RFP source | How it informs the conversion workflow |
|---|---|
| §18, pp. 11–12 | Conversion includes account structure, historical financial data, vendors, customers/funders, employees, payroll history, fixed assets and grant/program data. Scope records capture convertibility, exclusions, responsibility, resources and timing; retained trials and reviews support integrity validation and UAT. |
| §25, pp. 14–15 | The receiving ERP's demonstration scenarios include purchasing/payment, grant allocations, payroll across grants, time/PTO, budgets, reports, assets, audit/roles/approvals, employee self-service and dashboards. Record the applicable actual scenario observations alongside the corresponding conversion report. |
| §31, pp. 18–19 | Data return and transition requirements inform the usable source, mapping, result and replay handoff. |

The profile's four scenario groups organize fund/grant conversion, payroll and
labor allocation, supplier/funder continuity, and fixed-asset conversion.
Record the actual ERP activity and its corresponding exports within the
agreed acceptance scope. The engine's report timestamp, retained request and
state timestamps, immutable reviewer timestamps, and export review-capture
timestamp preserve when each part of that work occurred.

The same issuer document's §32 lists October 12, 2026 for questions and
answers and October 19, 2026 for proposals. Consult the issuer's current
[procurement notice](https://scapnc.org/rfp-for-nonprofit-accounting-hr-payroll-management-software/)
and addenda when scheduling the implementation.
