# Crossref in an existing research dossier

The Crossref adapter adds retained publication metadata to the original research
question. It calls the existing dossier engine, preserves expected revisions and
uses its ordinary DOI grouping, evidence selection, findings, comparison,
reporting and portable reopen.


## Operate in the original research workspace

Enable DOI metadata on the same research workspace that holds your questions,
selected evidence and findings:

~~~sh
npx --no-install starforge research-workspace --dir /absolute/private/research-dossiers --crossref-state /absolute/private/crossref-source --port 8846
~~~

Open the complete local address printed by that command. It carries the original
workspace session fragment. The **DOI metadata** tab appears when the launcher
has configured a Crossref source. The source directory and account are chosen by
the local launcher; the browser selects research scope.

The source flag alone uses the original public Crossref API. To reuse an existing
merchant account, contact identity, response limits and cache policy, also supply
**--crossref-config /absolute/existing-crossref-merchant.json**. This optional
configuration requires **--crossref-state**. Existing edition-adapter and saved
OpenAlex workspace flags can be used on the same invocation.

1. Open the existing dossier and choose **DOI metadata**. Select its actual
   research question. **Selected evidence only** starts enabled, so the scope
   follows the evidence already selected for that question. The current DOI
   count is shown before preparation.
2. Enter an edition label and choose whether to include registered updates.
   Select **Refresh provider responses** when a new provider retrieval is
   required; otherwise the original source cache can supply retained captures.
   Click **Review acquisition**.
3. Review the saved question and exact DOI list. The prepared operation records
   its source identity, selection options, originating dossier revision and
   request ceilings. Click **Acquire metadata**.
4. Watch retained response progress. **Stop acquisition** saves the captures
   already received. Reopen this same workspace later, choose the saved operation
   and click **Resume acquisition** to continue from those original responses.
5. Review publication dates, funding, licences, registered relations and changed
   metadata fields. The coverage section includes the original request intentions,
   collection totals, provider responses and acquisition failures.
6. Click **Retain reviewed edition**. This is the explicit decision to receive
   that exact reviewed envelope into the original dossier. The existing source,
   question, findings, revision comparison, report and portable export controls
   remain the place to review and use the resulting research.

Metadata acquisition is retained before the receiving decision. A request or
session interruption therefore leaves an operation that the operator can reopen.
Preparation uses a stable request identifier so a lost preparation response can
be reconciled. A lost response after the original dossier commits the reviewed
edition is also recovered from that exact original edition, question, operation
and recorded revision; repeating the same receiving decision preserves the
original receipt.

### Review and refresh behavior

A saved operation has an immutable question and DOI scope. It does not
automatically follow a later change to evidence selection. Create a new reviewed
scope to acquire a different set of DOIs. If the question text changes, the
operator reviews a new scope against that question.

A completed acquisition can be **COMPLETE**, **PARTIAL** or an original provider
error outcome. Useful records in a partial refresh remain available. A DOI that
was not returned by that refresh retains its earlier saved metadata and is not
reported as removed. An edition with no usable metadata can still be retained as
its original provider outcome. To acquire again after reviewing a completed
partial outcome, prepare a new operation with the required scope and refresh
option; the earlier result and original response history remain available.

Receiving compares the current original dossier revision and the exact reviewed
plan and edition hashes. The original metadata API supplies revision and edition checks
without re-projecting retained research bodies. A completed receive returns the
full original dossier view at its recorded receiving revision. If another operator changes the dossier first, the
workspace refreshes the review before another decision. Existing source notes,
classifications, selected evidence and authored findings remain on their original
occurrences. Crossref metadata does not automatically select new evidence or
rewrite a finding.

**Download original edition** returns the retained research envelope with its
complete original Crossref bodies and response receipts. The ordinary **Export**
control produces readable reports or a portable dossier containing all retained
editions and authored analysis. Reopening that portable dossier restores the
received metadata and original research history.

### Preserve the operating state

The dossier directory contains the original research data and a **crossref/**
directory for prepared plans, acquisition references, reviewed editions and
receiving receipts. Preserve it with the configured Crossref source directory
when resuming acquisition on another local installation. The source directory
holds the original capture bytes referenced by in-progress operations.

A portable dossier is sufficient to reopen received research and analyst work.
It is not an acquisition queue export. To resume unfinished operations, preserve
both private directories. Stop the workspace before moving them, and reopen with
the same source configuration. A changed account or configuration is visible in
the saved operation; already reviewed editions remain available while new
acquisition uses a new prepared scope.

The original Crossref source enforces provider request and concurrency limits
and retains rate headers and HTTP outcomes. See the
[current rate-limit deployment notice](https://community.crossref.org/t/refining-rest-api-limits-for-improved-stability-and-reliability/16137)
and [current cursor behavior](https://community.crossref.org/t/changes-to-cursors-filtering-and-sorting-in-the-rest-api/16246).
A registered update relation is a provider metadata result at its recorded
retrieval time; publication dates keep their original date kind and precision.

## Existing question and original input

Use the actual dossier and question IDs from the original workspace. Sources can
already come from an imported OpenAlex edition, a retained methods review, or
another original research result. **selectedCrossrefDois(view, options)** selects
their DOI-bearing evidence on the chosen question.

~~~js
import {openDossierStore} from '@tokenjunkielabs/starforge-merchant/buyer/research-dossiers';
import {
  selectedCrossrefDois, receiveCrossrefEdition, receiveCrossrefBuyerResult,
  compareCrossrefMetadata, enrichCrossrefDossier
} from '@tokenjunkielabs/starforge-merchant/buyer/research-dossiers/crossref';

const dossiers = await openDossierStore('/absolute/private/research-dossiers');
const before = await dossiers.get(existingDossierId);
const dois = selectedCrossrefDois(before, {questionId: existingQuestionId});

const imported = await receiveCrossrefEdition(dossiers, existingDossierId, {
  questionId: existingQuestionId,
  label: 'Publication metadata review',
  captures: originalCrossrefCaptures,
  dois,
  expectedRevision: before.revision
});
const comparison = compareCrossrefMetadata(before, imported.dossier, {dois});
~~~

The importer validates every capture's original request, DOI correspondence,
body length, body SHA and response schema. It retains complete response bytes
inside the ordinary research envelope. Repeating the same input on the current
revision reuses the existing retained edition identity.

Earlier analyst notes and decisions stay on their original evidence occurrences.
A new Crossref occurrence does not automatically assert that its metadata
supports or contradicts a research finding. Use the existing selected-evidence
and finding operations for that review.

## Capture-pack file

The **import** command accepts either a complete Crossref merchant envelope or
a **stellar-forge.crossref-capture-pack.v1** file:

~~~json
{
  "schema": "stellar-forge.crossref-capture-pack.v1",
  "dois": ["10.1002/cphy.cp010129"],
  "sourceReference": "https://www.crossref.org/documentation/retrieve-metadata/rest-api/",
  "captures": [
    {
      "request": {"kind": "work", "doi": "10.1002/cphy.cp010129"},
      "url": "https://api.crossref.org/works/10.1002%2Fcphy.cp010129",
      "status": 200,
      "retrievedAt": "ORIGINAL_RETRIEVAL_TIME",
      "headers": {},
      "bodyBase64": "ORIGINAL_BODY_AS_BASE64",
      "bodyBytes": 0,
      "bodySha256": "ORIGINAL_BODY_SHA256"
    }
  ]
}
~~~

The capitalized fields describe values from the actual source capture. The
illustrated byte count is replaced by that capture's actual body length. Native
code can instead pass a **Uint8Array** as **body**.

For registered updates, the request contains **kind: updates**, the actual
**dois** array, **rows**, and **cursor**. Start with **cursor: "*"**, then retain
each returned next-cursor verbatim and keep the same DOI filter and rows.
[Crossref changed cursor behavior in August 2026](https://community.crossref.org/t/changes-to-cursors-filtering-and-sorting-in-the-rest-api/16246):
a new cursor advances the collection; repeating one returns the same page.
The receiving adapter retains incomplete pages and marks nonadvancing cursors,
duplicated DOI rows, changed totals, or a final count that differs from the
first page as PARTIAL. A complete empty first page has an original total of zero.

Complete collection requires a chain beginning at "*" and ending with fewer
items than requested rows. A retained page from the middle of a collection
stays visibly partial. Zero returned records on the first final page is a
complete empty collection. The original total-results value is retained
separately from the number of received rows.

~~~sh
npx --no-install starforge crossref-dossier import --store /private/dossiers --id EXISTING_DOSSIER_ID --question EXISTING_QUESTION_ID --revision CURRENT_REVISION --file /private/crossref-captures.json
npx --no-install starforge crossref-dossier compare --store /private/dossiers --id EXISTING_DOSSIER_ID --before EARLIER_REVISION --after CURRENT_REVISION --out /private/crossref-field-review.json
~~~

## Original buyer result

The merchant response is already the retained research envelope. Use
**receiveCrossrefBuyerResult** for a saved original **BuyerResult**; the adapter
checks the projection against its retained source bodies, then calls the
original **receiveBuyerResult** method. Its existing delivery identity and
intent remain attached to the dossier.

Existing **research-dossiers import-buyer** also accepts these complete
envelopes with **--provider crossref**. The dedicated command adds the Crossref
projection check before that same receiving operation.

## Report and reopen

The original dossier report includes the source metadata as readable evidence,
its full original record and the question's reviewed findings. The JSON portable
export includes the retained Crossref envelope and all original response
bodies. Reopening that portable state restores the same source occurrences and
analysis.

Dates keep both their kind and original precision. Online publication,
print publication and metadata deposit are independent fields. Missing citation
or reference counts remain null; an explicit source zero remains zero.

Native source capture caching is separate from dossier revision history. Preserve
the merchant's original source directory to reuse a capture during acquisition;
preserve the portable dossier for the selected research and authored analysis.

### Acquisition coverage

An enriched edition retains its intended metadata and update requests together with
transport, pagination and request-capacity failures in `usage.acquisition`. The
receiver rebuilds coverage from those intentions and the complete original captures.
A successful empty updates response cannot hide a failed metadata lookup; failed
update requests cannot make a metadata-only result appear fully enriched. Useful
records remain available under PARTIAL; an entirely failed acquisition remains an
original retained provider-error edition that can be reopened and retried.
