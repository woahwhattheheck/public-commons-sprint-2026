# Study extraction and evidence-table operator

This operator completes the study-extraction work inside the original Research dossier application. It uses the same source editions, Eligibility studies, immutable revisions, private listener, portable files and customer receiving history as the rest of Research. The browser, Node attachment and CLI call the original extraction and publication stores.

## Open the existing workspace

Use the installation's normal Research command and original private directory. For a direct installation, from this directory:

    node server.mjs --dir /absolute/private/research \
      --connection-file /absolute/private/research-connection.json \
      --extraction-python /absolute/python3

The command prints its original connection descriptor. Open that exact URL. The browser takes the token into session storage and removes it from the displayed fragment. Select a dossier, then **Study extraction**. The original workspace ID and dossier ID together identify browser drafts and prepared requests. Reopening a portable dossier in a different workspace preserves the dossier history while creating a distinct local editor scope.

The extraction Python option selects the original exact JSON-number reader. If omitted, it follows the existing clinical-trials Python selection. It does not acquire another study or change the retained source.

An optional Zotero library connection uses the same original host:

    node server.mjs --dir /absolute/private/research \
      --connection-file /absolute/private/research-connection.json \
      --zotero-state /absolute/private/zotero

The **Zotero library** tab opens that original library application on demand and returns its actual private continuation link. Status reads do not start it or expose its private URL. Closing the Research application drains its owned bridge. A Node client attachment never shuts down the application.

## The complete browser workflow

The eight views are Overview, Forms, Result sets, Extraction, Compare & resolve, Tables, Source and History & recovery. All section pages retain the selected dossier revision. Reports contain the complete selected data and history, independently of the visible page size.

1. Select an existing research question. In Eligibility, establish the reviewed Study and its exact version from the retained source occurrences.
2. In Forms, author all fields, instructions, units and choices, the registered reviewers, extractor and resolver assignments, minimum independent entries and disagreement procedure. Save the complete form. A later form revision keeps its predecessor and requires a reason.
3. In Result sets, select that form edition and the exact Eligibility Study version. Author each row's ID, label, context and source occurrences. Complete authored row files can populate the editor. Save the whole result set with its reason; a replacement explicitly names the predecessor.
4. Select the first responsible reviewer. In Extraction, author every row and field or load the complete answer file. The local editor retains all rows when changing the visible row. Save the independent extraction draft, then submit that saved extraction edition. The other reviewer repeats this operation under their own registered identity.
5. In Compare & resolve, inspect the independent submissions and their original source bindings. Use consensus for matching submissions. Use adjudication to choose a submitted value or author a fully sourced answer for a field. Save the explicit resolution reason for each result.
6. In Tables, define the evidence table, select exact result editions, author the title, summary and limitations, and record the review of the current publication context. Publish the complete selected table. The publication freezes the selected result records, source bindings, submissions, comparisons, resolutions and table definition.
7. To revise the work, retain the original form/result/publication history and author the next editions. Review source, Study and form impacts. Publish a successor and compare it with the earlier publication. Withdrawal retains the withdrawn publication and records its reason.
8. Download the extraction reports, publication JSON/CSV/Markdown/HTML and whole editable dossier JSON/gzip. Continue customer work in the received original dossier rather than recreating reviewer decisions.

Reviewer identity is an attribution and assignment in the original dossier protocol. Enter the responsible operator's actual ID and name; the form controls which actors may extract or resolve. Local editor selection does not create a submitted review.

## Preserve original source values

The Source view reads the exact retained occurrence and, where applicable, its named source-bundle member. Select the original JSON pointers, then inspect both the typed value and whether that path was present.

The answer editor keeps these concepts separate:

| Field | Meaning |
| --- | --- |
| Value status | Reported, derived, not estimable, not reported, not applicable or uncertain |
| Tagged value | The original typed payload, including a decimal token retained as a string |
| Source basis | Original occurrence plus JSON pointer or passage locator; optional exact member filename |
| Context | The author's complete structured explanation of the row or answer |
| Derivation | Authored method, input field IDs and optional expression/reference |
| Note | The reviewer's explanation accompanying this answer |

Missing source paths, explicit null, a reported zero and non-estimable text are distinct. The browser does not turn absent or non-estimable values into zero, infer event counts from percentages, substitute an outcome denominator for a class denominator, or change the retained source to match an entered value.

For the original NCT03529110 commissioning case, the case source contains 14 measurement rows and 13 fields per row. The exact original helper constructs all 182 answers and 112 distinct source pointers. Its 138 present values retain their original string payloads; 44 answers explicitly record absent values. The reviewed duration-of-response classes retain 208/90 and 201/97 as their own denominators, independently of the 261/263 outcome totals. The original 79.7 response percentage and the second reviewer's intentionally entered 79.0 remain separately visible through submission, resolution and publication. See study-extraction-case.mjs and the original commissioning guide for the full source selection and hashes.

The two original sources of numerical truth are the retained source file and the original extraction engine. Display formatting and exported table columns do not replace either.

## Local recovery and independent history

Before any browser mutation leaves the page, the operator saves the complete five-field request and its exact route in IndexedDB:

    {
      "requestId": "the-original-request-id",
      "expectedRevision": 12,
      "actor": {"id": "reviewer-id", "name": "Responsible reviewer"},
      "action": "submit-extraction",
      "data": {"extractionId": "the-saved-extraction-id", "reason": "Complete independent review"}
    }

Those IDs and revision are illustrative; use the original values returned by the existing dossier. The downloadable request contains exactly these five fields. Browser-only state and projection options are not inserted into the domain request.

History & recovery includes both the original committed operations and this workspace's prepared requests. An interrupted page can leave a request in prepared or response-unknown state. Recover that exact request before another write. A recovered committed request returns the original operation and duplicate=true. It does not create a second submission, resolution or publication.

A definitive stale-revision rejection means the old request did not commit. Inspect the original operations, refresh the dossier and review the changed context before authoring a new request. Retain the rejected original request. Never change the expected revision or payload of a request already submitted to the engine.

If the mutation succeeds but refreshing the page or saving browser metadata fails, the operator keeps the actual committed result rather than rewriting it as a failed mutation. Continue from the original operation. If the browser is interrupted after saving an extraction draft, **Continue from saved draft** retains its reason and exact saved extraction ID, so submission can resume without an unnecessary replacement draft.

The complete local editors are also downloadable. They are working material, distinct from submitted or adjudicated dossier records. The browser warns on leaving with unsaved work or an unreconciled request.

## Node attachment

Use the installation's original ResearchWorkspaceClient. Its studyExtraction() method returns a typed seven-method attachment; the same methods are also available directly on the original client:

    const client = new ResearchWorkspaceClient({
      connectionFile: '/absolute/private/research-connection.json',
      directory: '/absolute/private/research'
    });
    try {
      await client.status();
      const first = await client.extraction(dossierId, {
        section: 'results', offset: 0, limit: 100
      });
      const next = first.nextOffset === null ? null :
        await client.extraction(dossierId, {
          section: 'results', revision: first.revision,
          offset: first.nextOffset, limit: 100
        });
      const saved = await client.exportExtraction(dossierId, {
        revision: first.revision, format: 'json',
        file: '/absolute/new-output/extraction.json'
      });
    } finally {
      await client.close();
    }

The client checks the original response dossier ID and revision. Pagination after the first page must retain the returned revision. Source-value POSTs are explicitly read-only. Mutation requests retain their original identity on transport interruption. Exports use the original streaming, exclusive destination writer and return actual bytes and SHA-256.

The complete typed attachment is study-extraction-client.d.mts. It imports original domain types instead of translating answer, operation or publication records.

| Method | Original operation |
| --- | --- |
| extraction(id, options) | Complete extraction overview or selected section |
| extractionSourceValues(id, selection) | Exact retained occurrence/member pointer values |
| reviewExtraction(id, request, options) | Original five-field extraction request |
| exportExtraction(id, options) | Complete JSON, Markdown or HTML report |
| extractionPublications(id, options) | Authored tables, frozen editions, impacts, operations and comparison |
| reviewExtractionPublication(id, request, options) | Original five-field publication request |
| exportExtractionPublication(id, options) | Complete JSON, CSV, Markdown or HTML publication/report |

For publication row selection, use the fingerprint returned by the original publication results section. Do not calculate it from the augmented API page. The publication review similarly uses the original reviewContext.fingerprint.

Publication comparisons accept fromPublicationId/toPublicationId, or publicationId with againstPublicationId. Conflicting selections are rejected by the original engine. changeType selects all, added, removed, changed or unchanged rows; the complete comparison remains bound to those two original publications.

## CLI and complete request files

Run the existing workspace CLI:

    node workspace-cli.mjs extraction-help

Every command attaches through the original connection file and directory. The action aliases validate the action in the complete saved request; they do not manufacture request IDs, rewrite expected revisions or create another operator.

    node workspace-cli.mjs extraction-view \
      --connection-file /absolute/private/research-connection.json \
      --directory /absolute/private/research --id DOSSIER \
      --section results --revision REVISION --offset 0 --limit 100

    node workspace-cli.mjs extraction-submit \
      --connection-file /absolute/private/research-connection.json \
      --directory /absolute/private/research --id DOSSIER \
      --input /absolute/original/submit.request.json

    node workspace-cli.mjs extraction-publication-export \
      --connection-file /absolute/private/research-connection.json \
      --directory /absolute/private/research --id DOSSIER \
      --publication PUBLICATION --against-publication ORIGINAL_PUBLICATION \
      --format html --out /absolute/new-output/publication-comparison.html

DOSSIER, REVISION and publication tokens above are placeholders for the original returned values. The complete extraction-help output lists all sections, all twelve mutation aliases, source selection, comparisons and export formats. --current-only takes the explicit string true or false. Repeated flags are rejected.

## Host composition and full receiving

All seven routes remain beneath /api/dossiers/:id/extraction on the existing authenticated listener. Extraction requests and exports carry the actual X-Research-Dossier-Revision. The browser uses the existing X-Research-Workspace-Id guard. Request bodies remain bounded by the engine's original 16 MiB review boundary; source selection is bounded to 1 MiB. Complete reports stream through the existing portable-file path.

The shared app joins preserve the existing sources, questions, findings, revisions, citation review, Eligibility, Crossref, Documents, Pipelines, Trial Registry and Europe PMC navigation. The source map records full postimages and exact guarded additions for the existing host, client, CLI, app, index and HTML. The original cumulative composer applies those additions to current source.

The commissioning programme calls study-extraction-browser.mjs against its already-started original application. Author mode runs the complete form, result set, both independent reviews and resolution journey; inspect mode opens the actual received history without replaying authoring. The driver receives an optional AbortSignal and closes only its owned browser/context. Original request custody, exact source IDs and all native output paths remain in that same operation.

The original workflow then performs publication, form/result revision, Merchant attachment, the existing Eligibility customer delivery, independent JSON/gzip receiving, continued review in that receiver and complete final re-export. Refer to the commissioning and receiving guides for that whole programme. A source parse, a page opening and a completed original native/customer operation are different execution results; retain the actual returned phase result when integrating this source.
