# Crossref in an existing research dossier

The Crossref adapter adds retained publication metadata to the original research
question. It calls the existing dossier engine, preserves expected revisions and
uses its ordinary DOI grouping, evidence selection, findings, comparison,
reporting and portable reopen.

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
each returned next-cursor verbatim. A repeated cursor may be valid in Crossref's
stateful iterator. The next page is acquired through the original source
adapter, not inferred from the cursor's text.

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
