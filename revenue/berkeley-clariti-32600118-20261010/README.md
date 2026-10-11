# Berkeley / Clariti permitting cutover workspace

A complete local operator application for comparing a supplied municipal permitting export with its migration candidate, reviewing the exact cases, correcting the candidate and recording a retained cutover decision.

The original `audit.mjs` comparator remains the comparison engine. The October 11 continuation adds original CSV/JSON intake, explicit mappings and case crosswalks, SQLite retention, a clean browser, detailed private findings, reviewer assignment and due-date comparison, configured departmental lifecycle checks, corrected-run continuity and portable handoff.

## Run the application

Requirements: Python 3.10+ and Node.js 22+. The service uses their standard libraries.

```bash
cd revenue/berkeley-clariti-32600118-20261010/workspace
python3 app.py --db /path/to/permitting-review.sqlite --port 8798
```

Open `http://127.0.0.1:8798`. If Node is outside PATH, set `BERKELEY_NODE` to its executable. The local database contains the supplied original records and review notes; keep it in the project owner's approved storage location.

Start with [the operator workflow](workspace/WORKFLOW.md), [API and input contract](workspace/API.md), or [the complete nine-case training cohort](workspace/examples/README.md).

## Complete retained workflow

1. Define the intended cohort, observation point, currency scale, included departments and conversion exclusions. Adopt and configure the applicable source-derived acceptance scenarios.
2. Upload original source and target exports. Inspect exact original rows and confirm each column or JSON-path mapping. Explicitly map department/status vocabulary, departmental review columns, reviewer names, due dates and related IDs.
3. Supply a one-to-one crosswalk when target case identifiers changed. Preview the complete normalized population with paginated rows and original row-level errors.
4. Run the original comparator. Review each exact missing, changed, unexpected or orphaned case, its normalized before/after values and the original source-file context. Assign a decision and explanation to each finding.
5. Review configured Building/Fire finalization and open-review ownership/due-date scenarios against the actual candidate records. Record the responsible operator's lifecycle observation.
6. Upload and map a corrected candidate, reuse an earlier confirmed source when appropriate, and run again. The next run identifies unchanged findings, the previous review and findings no longer present while retaining its own current decisions.
7. Record the selected cutover decision. Download the private source-linked handoff, findings CSV, aggregate report and complete workspace backup. Reopen the backup to continue with all original exports, comparisons and reviewer history.

The browser pages both findings and the complete case population. Export metadata is indexed when captured, so refreshing the workspace does not repeatedly parse every retained file. Every comparison pins its original bytes, mappings, source revision and comparator hash. Concurrent writes use a workspace revision; a later reviewer change reopens a previously ready cutover decision.

## Original comparison contract

The canonical same-cohort JSON input remains available to existing consumers:

```json
{
  "cohort": "core-permits-2026-10-11",
  "records": [{
    "id": "CASE-001",
    "type": "permit",
    "department": "Building",
    "status": "Open",
    "relatedIds": ["FIRE-001"],
    "reviewStates": {"Fire": "Open"},
    "reviewAssignments": {"Fire": "Assigned reviewer"},
    "reviewDueAt": {"Fire": "2026-10-20"},
    "attachments": 2,
    "paymentMinor": "15000"
  }]
}
```

Types are `permit`, `license`, `inspection` and `special_event`. The `reviewAssignments` and `reviewDueAt` maps are optional additions. Old snapshots without those fields retain their original aggregate issue shape. The aggregate `auditSnapshots` and file CLI keep bounded anonymous example tags. The operator uses the additive `auditDetailedSnapshots` export from the same classifier to retain private case IDs and field values.

```bash
node audit.mjs --source old-normalized.json --target candidate-normalized.json
```

Exit 0 means snapshot reconciliation; 2 means discrepancies; 3 means invalid input. The input contract supports files up to 25 MiB and 500,000 records each. Payment values remain exact integer minor-unit strings, with explicit decimal conversion in the workspace. Attachments are supplied counts; the project owner defines any separate document-content or transaction-level acceptance population.

## Primary-source adoption

Berkeley's January contract report describes the replacement of legacy Accela and the multi-department permitting implementation. The May 12 council action adopted the special-event module amendment under contract **32600118**, bringing its authorized ceiling to **$5,480,128**. The May report anticipates special-event configuration after the core platform. These records identify relevant delivery work; the partner workshare has its own proposed scope and price.

The application incorporates two concrete departmental requirements from the original procurement sources. **Addendum E, question 71** identifies review assignment, due date and status data in departmental Excel tracking. **To-Be Appendix B, page 6** specifies the Building/Fire finalization dependency. Both are configurable against the real exported vocabulary, and the source links travel with the scenario settings. The same addendum's question 80 identifies a distinct daily Tyler Munis ERMA transaction-reconciliation requirement, whose exact transaction exports should form a separate commissioned acceptance population.

| Original source | Use in the product and workshare |
| --- | --- |
| [January 20, 2026 Clariti contract report](https://berkeleyca.gov/sites/default/files/2026-01/2026-01-20%20Item%2016%20Contract%20Clariti%20Cloud%20Inc.pdf) | Existing-system migration and departmental delivery context |
| [May 12 special-event amendment report](https://berkeleyca.gov/sites/default/files/2026-04/2026-05-12%20Item%2005%20Contract%20No.%2032600118%20Amendment.pdf) | Subsequent event intake, reviews, fees and inspections population |
| [May 12 annotated action, page 4, item 5](https://berkeleyca.gov/sites/default/files/city-council-meetings/2026-05-12%20Annotated%20Agenda%20-%20Council.pdf) | Adopted Resolution 72,256–N.S. |
| [Original RFP 24-11661-C](https://berkeleyca.gov/sites/default/files/documents/24-11661-C_Comprehensive%20Permit%20Management%20Software%20Solution.pdf) | Sections 2.2.4 and 8.6: field maps, transformations, conversion exclusions and extraction/validation roles |
| [Addendum E](https://berkeleyca.gov/sites/default/files/documents/24-11661-C%20-%20Addendum%20E%20-%20Additional%20Vendor%20Questions%20and%20Second%20Extension.pdf) | Open review metadata and the separate financial transaction interface |
| [To-Be process maps](https://berkeleyca.gov/sites/default/files/documents/Appendix%20B%20-%20Rapid%20Workflow%20To-Be%20Business%20Process%20Maps_0.pdf) | Linked Building/Fire lifecycle and cashiering workflows |
| [Clariti Enterprise](https://www.claritisoftware.com/products/enterprise-permitting-software) | Native configurable report exports and supplied platform field/relationship definitions |
| [Clariti partner program](https://www.claritisoftware.com/partners) | Published implementation/technology partner route: partnerships@claritisoftware.com |

Sources were refreshed October 11, 2026. Original January and May PDF bytes were retained with the source scout. The original comparator was adopted from Git blob `9c07dbf4c7dbb6a375fa6cfda29c905bf0173dfa` at this existing repository path; its public comparison interface is preserved.

## Native operator result

The complete nine-case training journey produced six original-engine discrepancies: two statuses, one attachment count, one exact payment value, one reviewer assignment and one due date. Its candidate also contained one Building/Fire lifecycle violation and one open-review metadata violation. A corrected export removed five findings and resolved both configured checks. The remaining event-status decision retained its earlier review for explicit reconfirmation.

The selected corrected run reached ready after the current discrepancy and both scenario observations were recorded. Updating its review note reopened the decision; explicit reconfirmation completed it. A portable backup restored the four original export versions, both runs and the seven corrected-run history entries. The training cohort and mappings are supplied for a hands-on repeat of this operating flow.

## Configured partner delivery

The [proposed workshare](WORKSHARE.md) covers one agreed export family and same-cohort acceptance population, mappings, original case review, two corrected candidates, departmental scenario configuration and an operator handoff: **$4,800 fixed, ten business days after agreed inputs, 50% at kickoff and 50% on acceptance**. This replaces the October 10 concept-stage price hypothesis with the completed workflow's delivery scope. The implementation partner selects the actual project population and reviewers.

MIT-licensed source. Customer exports and workspace databases are stored outside the repository.
