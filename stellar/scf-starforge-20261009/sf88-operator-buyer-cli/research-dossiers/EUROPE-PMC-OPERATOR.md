# Europe PMC literature workbench

This is a complete literature-source workspace inside the existing Research application. It saves query revisions, retains the original Europe PMC core JSON pages, reviews complete records, compares source editions, and receives the chosen edition into an existing dossier question. The same workspace is available in the browser, through the Research client and CLI, and through the Merchant attachment.

The workbench records what the source returned and what the operator decided. It does not decide scientific eligibility, replace a review protocol, or infer that a publication was withdrawn because it is absent from a later search. The original dossier's evidence selection, findings, reports, citation updates, Documents/Pipelines and Python/Analysis remain the receiving authority.

## Start and open

Use the complete maintained Research source and its existing Node runtime, with util-linux flock available. This feature adds no service account, database server or paid provider dependency.

Start the original Research server in its private workspace using its normal command:

    node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/server.mjs \
      --dir /private/research-workspace --port 8766

Open the original private connection URL. From Research, open **Literature searches**; the workbench is served at /europe-pmc.html on that same listener. It reuses the original connection token kept in session storage. If opening the page independently, use its **Connect** control with the original private connection URL. Keep that URL private.

The operator name records authorship of saved definitions and decisions. Browser draft storage belongs to this origin, original Research workspace and selected Europe PMC library. Reopening a library uses a separate namespace and preserves the prior drafts.

For shared provider use, start the server with its optional --europe-pmc-rate-state /private/shared-europe-pmc-rate path. Every selected library on that controller shares that original rate state. Independently operated processes using the same outgoing IP should select the same private directory when they can share a filesystem. The default one-second dispatch interval is deliberately below the provider's published ceilings. Other applications using that IP also consume those limits.

## Save the search before acquiring it

1. Choose **New**, name the search, and enter the complete Europe PMC query.
2. Select records per page, maximum pages and the provider synonym setting.
3. Retain the source terms. Each original record also keeps its native licence and authors.
4. Save the revision. Editing the definition later creates a new version; every original definition and edition remains available.
5. Select that saved revision and name the new source edition.
6. Choose **Acquire original pages** or **Prepare file intake**.

Queries use the Europe PMC query language. The bundled examples use exact DOI queries; they make a small, readable receiving exercise. They are not a systematic search strategy.

Live acquisition always requests the production Europe PMC REST search endpoint with format=json and resultType=core. The original query, page size and synonym setting stay fixed across that operation. The first cursor is "*"; subsequent cursors come from the actual provider response. The client validates the echoed query and cursor, and refuses a changed endpoint, extra request fields, mismatched pages, cursor cycles and incomplete response envelopes.

Provider HTTP errors and malformed complete response bodies remain in the operation's failed-source history. HTTP200 without the native hit count, request and result list is an error, not an empty search. A stopped or interrupted operation retains completed pages. **Continue this acquisition** resumes that same saved operation; **Seal retained partial edition** publishes those original pages without another provider request.

The provider may change its live index while pages are read. The workbench records reported totals, repeated identities, differing native variants, and their exact source occurrences. It never describes cursor paging as a transactionally frozen snapshot.

## Import original page files

The browser accepts either a complete import packet or ordered original page files with their original source URLs. An operator file intake records its exact bytes, filename, hash and intake time. It leaves upstream HTTP status, headers and retrieval time unknown unless an original validated HTTP-response descriptor supplies those actual observations.

The complete packet is JSON:

    {
      "schema": "stellar-forge.europe-pmc-import.v1",
      "pages": [
        {
          "url": "https://www.ebi.ac.uk/europepmc/webservices/rest/search?...",
          "bodyBase64": "EXACT_ORIGINAL_PAGE_BYTES_IN_BASE64",
          "retainedAt": "2026-10-12T11:48:38Z",
          "provenance": {
            "source": "original-public-document-transfer",
            "originalUrl": "https://www.ebi.ac.uk/europepmc/webservices/rest/search?..."
          }
        }
      ],
      "stopReason": null
    }

The URL must be the complete actual core JSON search URL, including query, pageSize, cursorMark, resultType and format. The example ellipsis above is explanatory and must never be submitted. The native request echo must match the selected saved revision. A packet may instead contain documents[], using complete validated stellar-forge.europe-pmc-source-document.v1 descriptors. Exactly one of pages or documents is accepted.

Use stopReason only for the selected actual partial boundary: page-limit, byte-limit or operator-stop. A complete native terminal page needs no invented stopping reason. The included public-inputs manifest identifies the four exact original files and complete transfer provenance for the worked example.

## Large queries and original continuation parts

A source page is limited to16MiB. A normalized Research edition is limited to64MiB; this workbench budgets up to24MiB of original JSON per part and a conservative incremental serialization bound. It stops earlier when the full normalized representation requires it. It does not silently discard remaining pages.

When the next complete page crosses the selected budget, the exact response is retained separately as the boundary page. The preceding pages become a usable partial edition with their actual next cursor. **Continue from original next cursor** prepares a new, explicitly linked part of the same query revision. Its plan binds the parent operation, parent plan SHA, parent edition SHA, original next cursor and retained boundary document ID. The new part reuses that boundary response as its first page. No second fetch is needed for that response.

A single unusually large page that cannot fit even an exact one-page edition remains retained with a clear error. Select a suitable new query/page-size definition for future acquisition; do not change the paging contract inside the original operation.

Each part remains visibly identified as a part. **Inspect complete continuation chain** combines coverage across the original parent sequence. It checks reported totals and native record hashes across parts. Changing metadata for one source:id cannot produce a falsely complete chain. Every native variant and occurrence remains in its original part.

Receive the required parts explicitly into the same dossier question, using a new receiving request and the current dossier revision for each part. The complete Europe PMC workspace retains the entire chain and all receiving receipts. A whole portable envelope is limited to128MiB; agree actual complete-source capacity before a large programme. Query record counts alone do not predict file size. The operator reports a size limit before publishing a partial or misleading portable file.

## Review the exact native records

Open an edition and choose **Records & review**.

The list is paged; search applies to the complete retained native records. Opening a record shows its source:id, DOI, authors, date, native licence, abstract, full core JSON, original page occurrences and every differing native variant. The displayed native record is the actual final occurrence, even when a sequence returns variant A, then B, then A again.

Metadata triage decisions are include, exclude, uncertain or follow-up, with a complete operator note. These are edition-bound workbench decisions. They do not silently select or delete evidence in a dossier. Each save retains the prior decision history, exact edition hash, request ID, author and review revision.

A draft keeps its original base revision. Refresh, switching records and a saved-reply failure preserve the complete draft. If another operator changed the review, inspect the current saved review and explicitly choose whether to keep the draft against that revision. The save still uses the original compare-and-swap check.

Full pending payloads and drafts use IndexedDB, not localStorage. An IndexedDB failure leaves the unacknowledged full snapshot in the tab, warns before closing, and keeps **Download recoverable browser work** available. Successful server receipts are retained before pending requests or matching draft versions are cleared.

## Compare editions

Select earlier and later complete retained editions. The comparison preserves their exact SHA256s, query definitions and coverage.

It reports added records, records absent from the new retained edition, changed native metadata and unchanged records. Changed fields include full JSON-pointer locations and before/after values; arrays and nested fields are retained. Absence is limited to those actual source selections.

Changing the query or synonym scope is shown explicitly. The worked example expands one DOI query to two DOI queries. Its extra record follows from that expanded source selection; it is not presented as a temporal database update.

**Download complete comparison** reads all pages with their original source hashes. It does not export only the current visible page.

## Dossier receiving and original reports

Choose **Dossier receiving**, select an existing dossier and question, review its current revision, and receive the selected source edition.

The original dossier receives all normalized native records and the exact raw source edition. Existing questions, evidence selections, findings, citation-review history and other provider editions remain intact. The immutable edition ID is the original dossier's identity derived from question, provider, source hash and receiving intent.

The workbench saves the complete original request before calling the dossier. A lost reply is reconciled against the original edition and saved revision; retrying the same request does not append another edition. A revision conflict leaves the original request available and does not silently rebase it.

Receiving does not convert Europe PMC comment/correction links into Crossref registered-update assertions. Original provider relations remain in the Europe PMC core metadata and the retained source. Use the original dossier's citation-update review for its actual supported assertion sources.

After receiving, open Research dossiers for evidence selection, findings and complete HTML/Markdown/portable reports. Download workbench review history alongside the dossier when handing over metadata triage decisions.

## Complete workspace receiving

**Activity & receiving → Export complete source workspace** retains:
- Every saved query version and its exact original request/event history.
- Every source plan, operation state, original page, failed response and boundary page.
- Every immutable edition and original continuation binding.
- Every record decision and earlier review revision.
- Every dossier receiving request and receipt.

The export is a frozen JSON/gzip file with an exact member inventory, byte counts and hashes. A repeated export request returns the first retained artifact. A missing artifact produces an explicit unavailable result; a new export needs a new request ID. A lost final receipt is recovered from the original prepared member selection and exact complete file.

Reopen the exported file to a separate selected library. The previous library remains intact. Before publication, the receiver verifies the full archive, every source page and edition, query-version/request replay, record-review history and source binding, continuation chain, and original dossier receiving receipts. A create-only receiving selection precedes target directory creation, so an interrupted empty target can resume under its original archive identity without overwriting other files.

An imported RUNNING state is historical until its actual original process is found. The workbench derives interrupted status from the original kernel operation lock. It does not fabricate an exit or launch a provider request merely because a portable workspace was opened.

Use the same received copy for later explicit saves and new export requests. Browser drafts remain in the original browser namespaces; the source workspace and portable file carry committed source and operator history.

## CLI and client

Use the original private Research connection file:

    node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/europe-pmc-cli.mjs \
      list --connection /private/research-connection.json

Run help for the complete command list. JSON request files preserve full text and stable request IDs; use --input instead of shell-interpolating query or note text. The CLI supports saved query revisions, plan preparation, start/stop/seal/continue/chain, original page import, complete records and comparisons, triage, receiving, exports and restore.

The original JavaScript client exposes:

    const client = ResearchWorkspaceClient.fromFile(connectionFile);
    try {
      const europe = client.europePmc();
      const library = await europe.list({limit:30});
      const query = await europe.saveQuery(originalSavedQueryRequest);
      const operation = await europe.prepare(originalEditionRequest);
      // inspect/start/importFile/records/review/receive and complete exports
    } finally {
      await client.close();
    }

Every client method uses the original identity-checked listener. After listing, requests carry the selected Europe PMC library. A restore changes that selection explicitly. An attachment receiving a changed selection fails rather than crossing libraries unnoticed.

Merchant tools use that same original Research attachment, host-declared source file/hash handles, complete native requests and immutable export retainer. See [Europe PMC through Merchant](../../../../stellar-forge/mcp-merchant-operator/EUROPE_PMC.md) for the actual installed names and export kinds. No extra server or provider engine is created.

## Included native receiving example

public-inputs/ contains complete original core JSON for:
- Europe PMC in2023, DOI10.1093/nar/gkad1085.
- EMBL's European Bioinformatics Institute(EMBL-EBI) in2023, DOI10.1093/nar/gkad1088.
- The original terminal empty page for the expanded query.

The original source representation is a retained document transfer. Its upstream HTTP status, headers and retrieval time were not exposed and remain null. Actual transfer IDs, source URLs, intake time, byte lengths and SHA256s are retained. Both papers have record-specific CC BY4.0 attribution; that does not extend a blanket licence to other corpus records.

The complete Linux receiving entry is run-europe-pmc.py. It opens the original Research workspace, creates the two example questions once with saved revision/identity reconciliation, operates the browser/client/CLI/Merchant workflow, closes that process, and starts a separate Node process to reopen the exact source and review history. The original accepted native controller owns this command.

Select the complete installed source manifest, the existing dossier and its revision after any preceding customer workflow:

    python3 stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/run-europe-pmc.py \
      --operation-id ORIGINAL_EUROPE_PMC_OPERATION \
      --source-root /absolute/selected-source \
      --source-manifest /absolute/complete-source-manifest.json \
      --workspace /absolute/original-research-workspace \
      --dossier ORIGINAL_DOSSIER_ID \
      --expected-revision ORIGINAL_CURRENT_REVISION \
      --directory /absolute/private-europe-pmc-run \
      --inputs /absolute/selected-source/stellar/scf-starforge-20261009/sf30-seller-sdk/europe-pmc/public-inputs \
      --node /absolute/node \
      --playwright /absolute/playwright/index.mjs \
      --chromium /absolute/chrome-headless-shell

The manifest contains the complete selected runtime source as files[{path,bytes,sha256}], including the original Research and Merchant dependency closure and these additional provider/operator files. Select existing Linux Python3.10+, Node24+, Playwright and Chromium paths. The original native owner declares their measured memory, source, profile and output budgets before dispatch. This command does not install dependencies or acquire another host.

The three receiving modules keep one original operation directory and inherited kernel lock. Both the private input and source manifest remain unchanged on a retry. The Python parent records the actual child PID/start identity; its child lifetime signal and retained lock prevent a lost parent from starting an overlapping writer. Source/operation selection changes require an explicit successor.

europe-pmc-journey.mjs retains the same query, intake, review and dossier request IDs across restart. It verifies complete native record values and every original source page; exercises query revision, complete browser draft recovery, narrow screens and review replay; receives both editions into the original dossier; invokes the actual Merchant attachment and six complete export kinds; and restores the editable source workspace with its original history. The new Node process then verifies that same received library and source/dossier edition identities.

Europe_PMC_Complete_Receiving.zip contains every selected application source file, all four original provider JSON pages with their transfer provenance, both source editions, the complete comparisons and review histories, original dossier reports, all retained Merchant exports/receipts, browser outputs and the full portable workspace. DELIVERY_MANIFEST.json identifies every exact member. A lost final receipt is recovered only by checking the existing complete ZIP against its original frozen member manifest.

The private listener token, browser profile, control selection and process logs stay outside the customer artifact inventory. The complete original receiving report records the two actual process identities and completed workflow phases.

The journey's result identifies the phases actually completed. Prepared source or a syntax check alone is not evidence of a completed live provider request, browser interaction or customer receipt.
