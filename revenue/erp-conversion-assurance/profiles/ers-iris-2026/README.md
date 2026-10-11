# IRIS retirement-return workbench

Prepare and review a 1099-R conversion using the actual filing XML, the agreed
upstream export, and the IRS responses received for that transmission. This
workbench joins filing operations to the existing retained conversion service:
one private directory contains the original files, field maps, comparison jobs,
review decisions, response history and linked correction or replacement work.

The browser provides a plain, monochrome operator desk. The command line exposes
the same retained operations for an existing filing process. Submit reviewed XML
through the organization's filing provider, then import that provider's original
IRS receipt and acknowledgment into the same filing record.

## Start or reopen

Use the complete repository checkout on Linux with Node.js 22 or newer, Python 3,
and `flock`. Browser handoff downloads also use `tar`. The JavaScript workspace
has no npm dependencies. Install Python `lxml` when selecting an XSD package.

Choose a private customer directory outside the checkout. Its parent must exist;
the service creates its root with mode `0700`. An existing root must already be
private and owned by the operating-system account running the service.

```sh
umask 077
node revenue/erp-conversion-assurance/profiles/ers-iris-2026/cli.mjs serve \
  --directory /absolute/private/retirement-conversion \
  --port 8470 \
  --xsd /absolute/private/iris-schema/transmission-entry.xsd \
  --schema-root /absolute/private/iris-schema
```

Select the actual transmission entry XSD from the downloaded IRS package. The
workbench retains the local schema files used for validation and their hashes.
The [current IRS notice](https://www.irs.gov/filing/e-file-information-returns-with-iris)
requires `SchemaVersionNum` 5.0.7 for tax years 2022–2026 beginning October 7,
2026; use the corresponding September 24 package and current business rules.

Open the complete `workspace` URL from startup JSON. The server binds to
`127.0.0.1`; its URL fragment grants private operator access. `--port 0` chooses
an available port. Reopen with the same directory and original service limits
to continue the saved work. Each launcher session supplies a fresh access URL.

For a local XML contract walkthrough, omit the XSD options and explicitly select
**XML structure inspection** at intake. Each filing displays its selected
validation mode, and that mode travels with the retained result and handoff.

## 1. Retain the prepared transmission

In **IRIS filings**, choose a new filing ID and the original transmission XML.
Review its UTID, transmission type, tax year, schema version, submission count
and record count. Expand membership to inspect the native submission and record
identities. The source XML is stored once by its exact content hash.

Use a distinct filing ID for each prepared transmission. A correction,
replacement, resend or rejected-record refile belongs to its original filing
family. After saving the relevant parent decision, enter that parent filing and
decision when retaining the prepared child. The native validator checks the
child against that selected operation and saves its result with the child.

The command-line equivalent begins with:

```sh
node revenue/erp-conversion-assurance/profiles/ers-iris-2026/cli.mjs intake \
  --directory /absolute/private/retirement-conversion \
  --filing retirement-original-001 \
  --input /absolute/private/prepared-original.xml \
  --xsd /absolute/private/iris-schema/transmission-entry.xsd \
  --schema-root /absolute/private/iris-schema
```

`show --filing ID` returns the current retained revision. Subsequent mutations
require that revision through `--revision N`. If another operator has changed
the filing, refresh its selected response and revision before resubmitting the
operation. The browser carries the displayed revision automatically.

## 2. Project the actual XML into a comparison CSV

Choose the real record grain and direct XML child paths from the prepared file.
In **Project XML fields for comparison**, load or enter an explicit map, name
the projection, and choose **Retain map and project**. The map and resulting CSV
both retain their exact hashes beside the original XML.

The [domain interface](API.md#explicit-xml-projection-map) defines the map shape.
Each field names a comparison column, a scope and a direct child path. A normal
retirement-return map selects `Form1099RDetail` as its record element. For repeated
state or local entries, select that repeated group as the record grain; `form`
scope then reaches its enclosing form while `record` scope reads the selected
state or local entry. Use namespace-qualified names when the input requires
them. An ambiguous or repeated child needs an explicit grain choice.

Select the saved projection for mapping, download its CSV, and load that CSV as
the target in the existing conversion input controls. Load the complete agreed
upstream export as the source. Staging verifies that the target bytes match the
selected projection. This keeps the comparison attached to the filing that the
operator actually reviewed.

The profile supplies five configurable starting cohorts:

| Cohort | Work to reconcile |
|---|---|
| 1099-R payment amounts | Gross distribution, taxable amount and federal withholding at the agreed payment grain; distribution and correction attributes |
| Recipient and account identity | Selected recipient identifiers, names and account fields using the original private keyed report identities |
| State and local withholding | Repeated state/local entries at their own grain, with jurisdiction and selected amounts |
| Prepared filing membership | Submission, record, form, tax year and filing-origin membership |
| Correction and replacement reconciliation | Complete revised records, selected amounts and original receipt/record or prior-system references |

These are logical comparison fields. Select actual source and target headers
and the conversion scope for each trial. The corrected
[Texas ERS RFP 26-15697-001](https://www.txsmartbuy.gov/esbd/26-15697-001),
sections A.1.a and B.5.a.ii, calls for structured source conversion to IRIS and
provides the ERS file and record layouts to the selected vendor. The agreed
layout drives the mapping.

## 3. Run, correct and review the original comparison

Complete the scope, conversion owner and coverage in the shared workspace.
Choose keys at the agreed grain, exact text attributes, and the scale and
tolerance for each amount. The original comparator uses integer arithmetic for
decimals, NFC normalization for text, explicit composite-key crosswalks, source
and target record locators, duplicate detection, and complete group counts and
totals. See the [conversion guide](../../scap-workspace/README.md) for those
controls and their exact semantics.

Stage the mapping and start an explicit comparison job. In **Runs & review**,
inspect the full report and its findings, then record the review. A corrected
trial receives a new bundle and job, preserving the preceding trial and review.

Back in the filing panel, link the selected projection to its completed job and
report. The workbench verifies the original report hash and projection binding.
The filing's comparison history then opens the existing job and review directly.

## 4. Retain and select the IRS response

Import the original intake receipt or acknowledgment XML in **Retain and select
the IRS observation**. The domain parser correlates the requested UTID, any
known receipt and the returned response identity. The original XML remains
available beside its parsed status, submission results and native error paths.

An intake receipt records `Received`. The acknowledgment keeps the IRS status
text, including `Processing`, `Not Found`, `Accepted`, `Accepted with Errors`,
`Partially Accepted` or `Rejected`. Select the response that should govern the
next decision. Earlier observations remain in the history, and the current
selection is an explicit revisioned choice.

For an intake or schema failure, retain the actual XML or JSON response together
with the observed HTTP status and operation. That capture supplies the recovery
planner with the original failure context.

## 5. Prepare the next operation

The planner uses the current response and the selected observations in the
filing family. Save the decision, prepare its complete XML, and retain that XML
as a child of the saved decision.

| Action | Operator path |
|---|---|
| Recover receipt | Look up acknowledgment using the same UTID after an uncertain intake response. |
| Resend | Use the retained native failure and required lookup; prepare a new UTID for the same intended filing scope. |
| Replace | Select rejected work. Whole replacement retains the original scope; partial replacement selects rejected submissions. |
| Refile rejected submissions as O | Deliberately prepare a new original for selected rejected O/R submissions, with a new filing date. |
| Correct | Select accepted records and use each record's latest accepted correction as the complete starting record. |
| Correct a wrong form | Follow the saved zero-amount correction and subsequent correct-form original sequence. |
| Review a prior-system correction | Retain the original FIRE or third-party evidence and validate the prepared correction's prior-system linkage. |

The filing-date distinction for a new original and the replacement treatment is
documented in the IRS [May 14, 2025 Q&A](https://www.irs.gov/pub/irs-efile/iris-working-group-meeting-qa-05142025.pdf),
page 5, question 10. The interface displays the new-original choice explicitly.
[Publication 5718](https://www.irs.gov/pub/irs-pdf/p5718.pdf), sections 5 and 6,
and the [August 12, 2026 working group](https://www.irs.gov/pub/irs-efile/iris-working-group-meeting-08122026.pdf)
supply the native status, correction and prior-system rules used by the planner.

When a child changes submission or record numbering, supply the explicit
prepared-record map described in [API.md](API.md#prepared-child-validation).
The retained canonical origin follows the original record across those local
IDs. An overlapping accepted or in-flight native observation appears in the
family view and is checked before preparing another original or replacement.

If a saved child reports incomplete derived lineage, **Rebuild record lineage**
reconstructs its index from the saved native prepared input and validation. This
requires the current revision and preserves the prior index in history.

## 6. Hand off the complete retained work

Export a filing's family through the panel or command line:

```sh
node revenue/erp-conversion-assurance/profiles/ers-iris-2026/cli.mjs export \
  --directory /absolute/private/retirement-conversion \
  --filing retirement-original-001 \
  --destination /absolute/private/retirement-handoff-001
```

The destination must be new. The handoff contains original XML and responses,
maps and projections, saved revisions, native decision inputs and results,
selected schema files, pinned domain code, and linked original comparison
exports. It carries private taxpayer inputs and belongs in the agreed customer
delivery location.

Replay the native operations with:

```sh
node /absolute/private/retirement-handoff-001/replay-domain.mjs \
  --directory /absolute/private/retirement-handoff-001
```

The replay verifies artifact hashes and recomputes each saved domain result with
its retained engine and schema. Each exported comparison also has its original
`comparisons/JOB/replay.mjs` and review history. Preserve the returned handoff
manifest hash with the delivery record; replay accepts it through
`--manifest-sha256`.

## Limits and command reference

Run `cli.mjs --help` for all commands, including explicit response selection,
failure capture, evidence retention, decision planning, record-lineage rebuild,
comparison binding, individual artifact download and family export. Native file
intake defaults to 100 MiB; maps fit within 256 KiB. The browser paginates filing,
submission and record views from the retained complete data. Adjust trusted
runtime limits at startup for the actual customer workload, and retain the
original service limits when reopening it.

Use [API.md](API.md) when integrating the domain parser and retained workbench
with an existing filing provider. Keep each handoff connected to the reviewed
upstream export, prepared XML, selected IRS observation and complete correction
history.
