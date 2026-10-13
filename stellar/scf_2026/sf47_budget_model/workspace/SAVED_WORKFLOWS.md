# Find and reopen original saved workflows

The Grant Operations case finder includes the complete retained account statements, reconciliation revisions, funding decisions, issuer terms, cohort delivery comparisons and operating procedures for the current case. Select a saved result to open that exact original edition in its existing desk.

## Operator workflow

1. Open **Delivery and cash operations** and choose the retained case.
2. Open **Find in case**, or press **Ctrl+K / Command+K** while focus is inside Operations.
3. Choose **Saved workflow summaries** to focus on retained work. Search by an original source ID, account, filename, title, revision, period or saved summary text. The section filter narrows the same complete result set.
4. Select the result to inspect its original summary, retained source references and revision. The detail view follows references already present in the current case. Long original arrays remain paged rather than truncated.
5. Use **Open [original section]**. The receiving desk preserves its existing drafts and pending request state and loads the selected original source or revision.

Native case records and their source metadata are available immediately. Additional saved editions load in the background without closing a child desk, moving focus or replacing a draft. **Search coverage** shows the complete additional populations and their counts once the response arrives. A failed saved-workflow read leaves the current case search usable and provides **Load saved workflows** for an explicit retry.

The loader shares a single request across section changes at the same case version. A response for an older case or version cannot replace the current finder. Saving or receiving work changes the case version and loads its new saved-workflow index.

## What each saved result opens

| Saved family | Original identity retained by the result | Receiving behavior |
| --- | --- | --- |
| Account statements | Original statement source ID and original review source ID | Retrieves the complete original CSV, OFX/QFX or MT940 inputs through the existing account-reconciliation statement reader. The Account statements desk retains the handoff alongside its current draft and pending/accepted request. Choose **Open original inputs** there to continue. |
| Account reconciliation | Original reconciliation ID and exact revision | Reopens the saved edition and its current account comparison through the existing account reader. The host confirms the actual selected report before reporting that the edition opened. The existing editable draft remains retained. |
| Cost funding | Original source ID and exact funding revision | Uses the existing funding history and saved-edition reader. The selected edition opens with the funding desk's complete draft map preserved. |
| Issuer terms | Original issuer-terms ID and exact revision | Opens that exact revision, including an older revision of the same ID. Existing issuer drafts, parked drafts and original request recovery remain in the original desk. |
| Cohort delivery | Original comparison source ID and retained comparison edition | Reads the exact original source bytes and reopens the comparison through the existing source engine. An unsaved comparison is retained in **Retained comparison drafts**, with **Resume draft** and **Download original input**. |
| Operating procedures | Original procedure source ID, edition and selected revision | Reads and verifies the original procedure and its selected native sources through the existing procedure reader. Complete procedure drafts remain available in that desk. |

All retained revisions are included. A reconciliation or issuer result is keyed by its original ID and revision; older editions do not disappear when a newer edition is saved. The source metadata remains available through the original Sources desk and its downloads.

The three controlled child adapters refuse to replace their own unresolved original request. Their normal request recovery controls remain available in the same desk. The Account statements receiving flow explicitly queues the selected original inputs and preserves its current request until the operator continues that handoff.

## Staff visibility

Saved-workflow discovery follows the current host's section visibility. Owners and delivery leads can discover the six families. Finance operators can discover account statements and account reconciliations. Reviewer profiles retain their original review-oriented case search; these six additional desks are absent from that profile.

The original server authenticates the request and checks the staff profile's selected case before the saved-workflow route runs. The route filters its returned populations for that profile. The browser independently filters entries against the current visible section registry before adding them to either search results or reference lookup. Opening a result checks the original case ID, current case version and visible section again.

## Read-only API

```http
GET /api/operations/{caseId}/operating-workflows?expectedVersion={version}
```

The required version is a positive integer within the original case version range. The response is read inside the original workspace snapshot. A different current case version returns the existing operations conflict response, so callers can reopen the current case before selecting an edition.

The response uses `stellar-forge.sf47-operating-workflows.v1`:

```text
{
  schema,
  case: { id, version },
  populations: [ { key, section, label, count } ],
  entries: [
    {
      key, collection, id, revision, section, kindLabel, label,
      summary,
      selection
    }
  ]
}
```

`revision` is an integer for versioned funding, reconciliation and issuer records, and `null` for an original source selected by source ID. `summary` is the retained native summary or the identified source metadata. It contains the original source IDs, hashes, dates, amounts and saved fields appropriate to that family. The response carries source metadata and saved summaries; attached bank bytes and packed procedure plans stay in their original source files.

The six explicit selection forms are:

| Selection kind | Required selection fields |
| --- | --- |
| `statement-original` | `sourceId` |
| `account-reconciliation` | `reconciliationId`, `revision` |
| `cost-funding` | `revision` |
| `award-terms` | `id`, `revision` |
| `cohort-delivery` | `sourceId` |
| `grant-procedure` | `sourceId` |

Every entry belongs to a returned population. Population counts match the complete entry collection. Browser receiving rejects a wrong schema, wrong case/version, duplicate entry identity, incomplete selection or count mismatch before using the response.

The typed native client exposes `operatingWorkflows(caseId, expectedVersion)` and `read('operating-workflows', {caseId, expectedVersion})`. Merchant MCP exposes `grant_workspace.operating_workflows` with required `{workspace, caseId, expectedVersion}`; it keeps the complete response in its existing retained snapshot and uses its normal paging for large results. With the existing native workspace CLI entry command, use `operations operating-workflows CASE --version N [--output FILE]`. That command uses the same Python `Operations.operating_workflows(caseId, expectedVersion)` method.

## Original readers and source handling

The index creates no new database records, source copies, financial transactions or case versions. It reads the original case snapshot and builds a transient discovery response.

Statement and reconciliation summaries come from their saved review/edition JSON and existing native summary functions. Discovery therefore avoids reparsing a bank file or recomputing every cash projection merely to search for a saved edition. Opening the selected original desk uses that desk's complete original reader and source checks.

Funding and issuer terms continue through their original validated history readers and summary functions. Their existing source/history errors remain visible if the retained chain needs attention.

Cohort and procedure candidates use the same original source filenames and media types as their desks. The index binds recognized documents to the original case and reads only their saved summary and edition metadata. Complete comparison reconstruction and procedure plan/source verification happen through the existing child readers when the operator opens the result. A malformed statement or candidate source can remain discoverable with a `reviewRequired` explanation and its original source identity.

A complete case export and cold reopen retain these saved workflows through the product's existing original sources and histories. The finder itself adds no separate ledger or hidden business state.

## Receiving exercise

Continue the same original Grant Operations receiving case used for the CSV, Cash correction, OFX/MT940 and account ZIP/cold-reopen journey:

1. Open the saved case at its exact current version. Search the retained statement filename and open its original inputs; confirm the existing Account statements draft and original request recovery remain available.
2. Select an older reconciliation revision. Confirm the account desk identifies that exact revision and retains its editable draft.
3. Search and open a funding revision and two revisions of the same issuer-terms ID. Confirm the original selected editions and existing drafts.
4. Open a saved cohort comparison while another comparison has unsaved inputs. Resume and download the retained prior input, then return to the original saved comparison.
5. Open a saved procedure and confirm its original selected native sources and retained procedure drafts.
6. Reopen the complete exported case in the original receiving installation and repeat the saved selections.
7. Use the existing finance/reviewer profiles to confirm the original section visibility and reference lookup behavior.

Source-level V8 execution covered all six selection families, role filtering, malformed response rejection, one shared request across concurrent renders, stale case-version reply exclusion and explicit recovery after a failed read. The original native receiving operation owns the complete process and browser journey.
