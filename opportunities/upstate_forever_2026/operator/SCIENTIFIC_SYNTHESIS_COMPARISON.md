# Comparing scientist-authored editions

This extends Scientific Reports → Scientist-authored synthesis. It reads two original saved source editions. It changes no scientific result, named author's document, pending save request, source catalogue, report selection or native history.

## Scientific use

Select a **Before** and an **After** edition, then choose **Compare selected editions**. Both selectors name the exact retained collection, not a chapter title alone. The comparison displays:

- Full question, scope, title, edition name, author and change-note differences.
- Every complete authored section before and after, including findings, interpretations, limitations and next work. Stable section IDs preserve identity when wording or headings change.
- Added and removed sections, changes to every retained field, and relative reordering among shared section IDs. Inserting an extra section does not label all following sections as moved.
- Each section's complete selected reference values, source collection/source pairs, member path, JSON Pointer and member identity. Reference order and the entire catalog remain retained.
- Full original source recipes and member inventories, including changed source selections and their order.
- Original revision/request identities and both entire history chains.

A renamed heading is a change to its original section. Deleting a section and creating a new identity appears as removal plus addition. This product does not infer that similar texts represent the same scientific statement. Distinct source editions remain distinct even when their titles match.

The history relationship distinguishes identical editions, forward or reverse ancestry, divergent histories, explicit forks and different series/projects. Comparing unrelated series remains useful but does not create a native revision chain. Changes in authored language do not establish a new model result or prove that one interpretation is scientifically correct.

## Complete outgoing files

**Download readable comparison HTML** creates a self-contained document with full before/after prose, exact reference details, all changed fields and complete historical records. It uses no external fonts, scripts or network resources. Open sections and reference details, use the unchanged-content toggle, and use its three embedded downloads:

1. Complete comparison JSON.
2. Complete before edition, including catalog and history.
3. Complete after edition, including catalog and history.

The HTML embeds the same whole package as its JSON download. The JSON retains both complete native read responses, including unknown retained metadata, in source_text. Its source_bytes and source_sha256 bind those exact UTF-8 bytes. The derived comparison is regenerated and checked on reopening. SHA-256 detects changed content; it is not an electronic signature or a replacement for the original Workspace source validator.

Open either downloaded **JSON or HTML** with **Open complete comparison JSON or HTML**. Reading HTML uses an inert parser to locate its one embedded JSON member; it executes none of the imported scripts. The complete package is validated before replacing the displayed comparison. An invalid file leaves the previous complete comparison and authored draft unchanged. The file input is cleared immediately after retaining the selected File, so the same file can be opened again.

**Download before/after original source ZIP** calls the original SourceReports.archive with the displayed edition's actual registered collection. Each archive retains its original manifest, authored record/history/catalog and all original source companions. A comparison received from another Workspace remains readable; a ZIP button is available only when that same collection is registered in the current Workspace. Do not relabel a different imported collection as the old selector.

Comparison JSON/HTML contains complete authored records, catalogs and recipes. It does not replace binary companions in native source ZIPs. Deliver those ZIPs alongside the comparison when the recipient needs underlying scientific files. Reimport through ordinary Sources and retain the actual receipt; archive manifest filenames can affect collection identity. Normal full Workspace or selected Study transfer remains the route preserving the editable project and producer lineage.

## Capacity and recovery

The entire pretty-printed comparison JSON plus newline must fit within **64 MiB of UTF-8 bytes**. Full standalone HTML must independently fit within 64 MiB. Limits apply to both complete histories/catalogs, not a row preview. Original document and working-copy capacities remain unchanged. If full HTML exceeds its limit, retain complete JSON and native archives; nothing is silently truncated.

Failure does not clear the prior displayed comparison. Downloads use its exact displayed edition IDs. Changing selectors requests another comparison; it does not silently change an already displayed one.

Every asynchronous read captures active Workspace and request serial. Leaving the view, changing Workspace, resetting or starting a later read invalidates an older result. File import is read-only and creates no task or source edition. The authoring pane retains its independent draft, pending request and original recovery behavior.

## Maintained integration

Four reusable assets:

- operator/web/scientific_synthesis_compare_core.mjs
- operator/web/scientific_synthesis_compare_report.mjs
- operator/web/scientific_synthesis_compare.mjs
- operator/web/scientific_synthesis_compare.css

The shared host owns one stable data-synthesis-comparison container after saved editions. Its controller attaches with attachSynthesisComparison({getWorkspace, readEdition, archiveEdition}).

- getWorkspace() returns the original active Workspace key.
- readEdition(id) uses the existing /api/source-reports/synthesis-edition reader.
- archiveEdition(id) uses existing POST /api/source-reports/archive with {collection_id:id}.

Call mount(container,{workspace,projectId,editions}) after catalogue updates. A null projectId is supported during original catalogue loading. Forward detach() and reset(). No backend, queue, source writer or provider request is created. The extension descriptor serves all four assets; scientific-synthesis-comparison.json adds this entire source and guide to the original scientific-report-editions component.

## Complete reusable API

validateEdition(value) checks the full native read response, document/catalog selection, original requests and historical chain. Original Python scientific_synthesis.inspect remains authoritative for native record hashes and retained source objects.

compareAuthoredSections(beforeSections,afterSections,beforeReferences=[],afterReferences=[]) returns the deterministic full section comparison used by the complete model.

compareEditions({before,after}) returns deterministic differences and lineage, retaining entire section/source/reference values. It performs no numerical scientific calculation.

await createComparisonPackage({before,after}) retains both complete read responses and their UTF-8 source hash.

await openComparisonPackage(value) checks bytes/hash, native record shapes and the entire regenerated comparison, returning {package,before,after,comparison}.

comparisonText(package) returns full pretty JSON plus newline under the declared capacity.

await buildComparisonReport(package) validates and renders literal self-contained HTML with the complete package and downloadable before/after objects.

## Original source operation and receiving

The actual published two-edition land-cover authoring recipe was operated through the same compareAuthoredSections implementation: all six original sections remained exact and unchanged; only the existing domain-accounting section was added. This checks the real authored-source transformation, not a fabricated native save receipt.

The existing ECO-CLOUD-6C52 owner retains project b9d5d257-c6bb-4f07-b975-8e8c63705db3, two actual saved land-cover editions and original Workspace/report/Study exports. Its same-operation read-only continuation opens both complete native responses, operates the installed comparison, downloads/reopens literal HTML/JSON and both native ZIPs, and repeats source inspection against the independently restored Workspace. Preserve original completed tasks/source IDs and accepted browser/controller. No scientific rerun or new authored save is required.

The producer must actually open/use the populated installed page at desktop and 390 px, read complete before/after sections and evidence, download/open every outgoing HTML/JSON/ZIP and its included files, and LOOK at final captures. All PDF pages, spreadsheets, maps and media in attachments must be opened and inspected through their appropriate original product route. Source review, DOM assertions or screenshot capture alone do not establish pixel inspection. Keep actual completion and outstanding recipient inspection separate in the original handoff.

TJLabs attribution and original authorship remain visible. No customer message, contract signature or provider mutation is part of this contribution.
