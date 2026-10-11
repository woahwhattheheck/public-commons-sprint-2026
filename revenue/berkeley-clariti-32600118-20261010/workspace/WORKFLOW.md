# Permitting cutover operator workflow

This workspace turns the existing case comparator into a retained migration review: original exports → explicit mappings → complete case comparison → assigned review → corrected reruns → operational acceptance → handoff and reopen.

It is designed for an implementation partner reviewing a defined permitting cohort. Keep one database per project or engagement. The workspace preserves original files, capture times, field mappings, normalized comparisons, case findings, reviewer history and cutover decisions in that database. The existing aggregate comparator remains available in ../audit.mjs.

## Open a project

Use Python 3.10 or later and Node.js 22 or later. No Python packages, database service, browser extension or front-end build is required.

From this directory:

    python3 app.py --db /absolute/path/to/project-review.sqlite --port 8798

Open http://127.0.0.1:8798 in your browser. Keep the server running while reviewing the project. If Node is installed at a separate path, set BERKELEY_NODE to its executable before starting the server.

Enter the current reviewer or team in the header. The browser remembers that value on this computer and proposes it on new decisions. Each saved decision records its own accountable reviewer.

### Project setup

Define:

- **Cohort identifier:** a stable name for the same population in both exports.
- **Currency and decimal places:** the meaning of the optional case payment field.
- **Export scope:** original systems, observation time, included case types and departments, related records, review metadata, attachment counts, and the payment field's meaning.
- **Required operational scenarios:** observable behavior that must be reviewed for the selected cohort.

Use an agreed observation point so ordinary case activity does not masquerade as migration change. Name which records and linked records belong in the cohort. A missing or unexpected case is a finding; a related target identifier absent from the supplied target population is also a finding.

The source-derived recipe picker provides two editable checks:

1. **Building and linked Fire finalization.** A finalized Building permit must have its linked Fire permits finalized. Adjust parent and child case types, normalized department names and finalized statuses to the actual exports.
2. **Open departmental review ownership and due dates.** Selected open reviews must retain an assigned reviewer and due date. Adjust the normalized departments and open review states.

Each recipe carries its original workflow source and locator. A manual operational scenario records observed application behavior without an automatic snapshot check. A configured check runs against the actual normalized target records in each comparison. A named reviewer additionally records the operational observation and acceptance result.

Save setup before normalizing or comparing exports. Settings edits apply to future comparisons. Existing runs retain their original scope, scenarios and check configuration.

## Retain and map original exports

In **Inputs & mapping**, upload the source CSV or JSON and its target counterpart. Enter each export's original capture timestamp as an ISO date/time with an explicit UTC offset, for example 2026-10-11T15:30:00-07:00. Each upload retains the exact file bytes and selects the file for its side of the next comparison.

Supported input forms:

- UTF-8 CSV with unique nonblank headers.
- A JSON array of case records.
- A JSON object containing records and an optional cohort identifier.

Each export can contain up to 500,000 records within the 25 MiB upload limit. Large case populations are paged in the interface. Dates and exact payment amounts should be supplied as text where their lexical meaning matters.

Select an export from the retained list and confirm its field mapping. The five required fields are case identifier, record type, owning department, case status and attachment count. An explicit zero is valid for a case with no attachments.

Optional fields include related identifiers, department review states, assigned reviewers, review due dates and the case payment amount. A field mapping names a column or discovered JSON path in the original file.

### Departmental exports and value translations

The advanced mapping area accepts one pair per line:

    Fire = Assigned Fire Reviewer
    Public Works = PW Review Owner

Use separate department mappings for review status, assigned reviewer and due date when the export has one column per department. Alternatively, map a field containing a JSON department-to-value object. The same department cannot be mapped twice for the same field.

Translate actual source-system vocabulary explicitly, for example:

    Building Permit = permit
    Complete = Finalized
    PW = Public Works

Supported normalized record types are permit, license, inspection and special_event. Department, case-status, review-status and reviewer translations remain explicit and case-sensitive. Reviewer translations allow an agreed equivalence such as an employee identifier versus a display name.

Due dates accept ISO dates or timestamps with a UTC offset. Date-only values preserve date-only meaning. Offset timestamps normalize to UTC. Ambiguous local dates require preparation in the original export.

Choose JSON array, pipe or semicolon for related identifiers. Choose exact minor units or dot-decimal major units for the payment field. Decimal conversion uses the configured currency scale and rejects rounding. Case payment comparison retains exact integer text, including values too large for ordinary spreadsheet or JavaScript number precision.

After confirming a mapping, review normalized rows beside the untouched original values. Normalization errors identify the original file and row. Inspect the complete original file through its download link.

### Identifier crosswalk

When case identifiers change, retain a CSV with exactly these columns:

    source_id,target_id

Each source and target identifier may appear only once. The crosswalk applies to target case identifiers and related target identifiers. Every supplied target identifier must appear in the selected crosswalk.

A corrected crosswalk is a new retained upload. Removing the current crosswalk changes the next comparison's selection; its original bytes and earlier comparisons remain available.

### Reuse retained inputs

Selecting a retained export opens its mapping and preview. **Use for next run** selects an earlier confirmed source, target or crosswalk without re-uploading it. A newly uploaded source or target requires mapping confirmation.

Mapping edits apply to later runs. Completed run manifests retain the mapping used at comparison time.

## Compare and assign the review

In **Runs & case review**, enter a useful comparison label and create the run. The service captures the selected files, hashes, capture times, mapping choices, scope and original comparator identity.

Input errors produce a retained input-review run with the rejected row context. Correct the original export or mapping and create another comparison.

Valid inputs produce a finding queue covering missing or unexpected cases, case type, owning department, status, relationships, department reviews, attachment counts, payments and orphan target links. Assigned-reviewer or review-due changes are included when that metadata is supplied.

The queue supports case/issue search, issue filtering and review-state filtering. Select **Review** to see:

- The exact source and target fields side by side.
- Original source and target row numbers and values.
- Links to the untouched exports.
- The accountable reviewer, decision and explanation.
- A previous review of an unchanged finding, when available.

Mark a finding **Open**, **Correction required**, or **Accept this difference**. Acceptance requires a named reviewer and explanation. Review changes append history.

The **Complete case cohort** view includes all normalized cases, including matches. Use it to inspect linked record states and operational cases that have no migration difference. The comparison is not limited to a small sample of findings.

## Correct and rerun

Retain the corrected original-system export, confirm its mapping and create a new labeled comparison. Earlier exports, findings and decisions remain available in the run selector.

Correction continuity identifies the previous same-cohort run and counts:

- Earlier findings no longer present.
- Unchanged findings.
- New or changed findings.

An unchanged finding shows its previous review and offers **Use this review as a draft**. Inspect the current inputs and save the current comparison's decision. The earlier decision remains attached to its original run.

The comparison evaluates actual before/after values and relationship details when identifying unchanged findings. A case or issue label alone does not transfer a decision.

## Operational acceptance and cutover

In **Acceptance & handoff**, select the exact comparison under review.

For each required operational scenario, record the named reviewer, observed application behavior and pass/fail result. For configured checks, the interface also shows the actual number of applicable cases or departmental reviews, violation count and exact retained violation case IDs. **Inspect case** opens the matching record in the complete case view.

A check with no applicable records returns **Not exercised**. Use a relevant cohort or adjust the documented recipe vocabulary in a new comparison. Retained check details include up to 1,000 violations and the full violation count.

A **Ready for cutover** decision requires:

- Both source and target snapshots contain records.
- The input normalization is valid.
- Every comparison finding has an explicit accepted-difference decision, or has been removed in the corrected comparison.
- At least one required operational scenario is defined.
- Each required operational scenario has a passed observation.
- Every required configured candidate check has passed.

Record the accountable owner and decision reason. **Pending** and **Deferred** remain available during review. Changing a finding or scenario decision after Ready reopens the cutover decision and appends the reason to history. Reconfirm Ready after reviewing the changed result.

These controls describe the configured project's acceptance work. The application does not trigger the source or target platform's live cutover.

## Deliver, reopen and support

Download from the selected run:

| Download | Use |
| --- | --- |
| Full review handoff | Complete run, normalized cases, exact finding contexts, settings, manifests, reviewer decisions and full history |
| Aggregate comparison summary | The original comparator's aggregate publication format with anonymous example tags |
| Finding queue CSV | Exact case findings, assigned owners, explanations and original row contexts |
| Complete workspace backup | Original uploaded bytes, selected exports, mappings, every comparison and all decision history |

Keep the full handoff and backup with the project's implementation records. Original export downloads remain available from the manifest. The finding CSV escapes spreadsheet formula prefixes in text fields.

A handoff JSON can be read independently. The backup restores the interactive workspace, including original files and earlier comparisons.

To reopen the same retained database, start app.py with its existing --db path. To restore a downloaded backup, use a new destination:

    python3 app.py --restore /absolute/path/to/permitting-workspace.sqlite \
      --db /absolute/path/to/restored-review.sqlite --port 8798

The destination must be new. The restore operation checks the workspace format and SQLite consistency before copying. Open the same local browser address and inspect the run selector, source downloads, decisions and history.

If another browser saves a change while a form is open, the service rejects the stale write and refreshes the current revision. The interface retains the draft so the reviewer can assess the latest state before saving it again.

## Demonstration files and source context

The examples directory contains a small training cohort, its original field mappings, an explicit crosswalk, scenario settings and a corrected candidate export. These files exercise the same intake and comparison flow as an implementation export. Their filenames and scope identify their training purpose.

For a repeatable operator walkthrough:

1. Define the cohort and scope using examples/settings.json and add the two matching workflow recipes.
2. Retain examples/source-permits.csv and examples/candidate-permits.csv.
3. Apply the original source and target mappings, then retain examples/case-crosswalk.csv.
4. Create the initial comparison, inspect case findings and both configured check results.
5. Retain examples/corrected-permits.csv, apply the target mapping and create the corrected comparison.
6. Review the unchanged finding, record the required scenario observations and save the cutover decision.
7. Download the handoff and backup, then reopen the saved workspace.

The original Berkeley contract and RFP sources are linked in API.md, including the Building/Fire relationship rule, departmental review ownership and due dates, and the separately scoped finance transaction requirements. The source rules inform editable acceptance scenarios.

The optional case payment field compares a case-level value. Daily Tyler Munis ERMA receivables and settlement reconciliation needs a separate transaction export contract, including transaction identifiers, partial payments and correction rules. Record the commissioned financial population and source definition before extending that lane.

See API.md for exact request/response contracts, limits, decision semantics and source links.
