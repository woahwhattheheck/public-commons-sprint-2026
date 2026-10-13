# Scientist-authored synthesis in the scientific report composer

Operation: ECO-SCIENTIFIC-SYNTHESIS-R24C-20261013.

This component adds attributed writing to the existing Sources → scientific report composer. A scientist selects retained studies, writes a decision question and scope, cites exact original sections, tables, figures or member files, and saves a named edition through the original task queue. The resulting chapter is an ordinary OBSERVED_CONTEXT source. Existing scientific report, briefing, OpenDocument where installed, Study transfer and Workspace writers consume it through their normal contracts.

## The complete working flow

1. Open the existing populated Workspace and Sources. In Prepare a scientific report, select the exact saved scientific studies in reading order. Read the original study before interpreting it.
2. In Scientist-authored synthesis, choose Start from selected report studies. The source catalog retains complete original recipes, section/block values, selected figure specifications, source member identities and exact JSON Pointers. Repeated headings remain distinct by their original indices.
3. Name the chapter and edition; enter the decision question, scope and named author. TJLabs attribution is retained. Add findings, interpretation, limitations and next-work sections. Each finding requires at least one exact reference. Other authored sections can carry references whenever useful. The original text, units, qualifiers, periods and model values remain in their source editions.
4. Expand a reference to read the complete retained value before selecting it. “Use current report study selection” explicitly adopts the current composer choice. It preserves authored text and unresolved prior reference IDs; those references must be deliberately resolved against the selected originals before saving.
5. Download complete working copy at any time. It includes unfinished text, full source catalog, the prior saved collection, exact pending save request and import history. Open restores that whole file only in its original project. File input is cleared after selecting a File, so the same file can be opened again. A delayed import cannot replace intervening typed edits.
6. Save attributed chapter through original queue. The complete request first commits to browser IndexedDB. The original /api/actions queue returns its existing accepted task. The accepted task may have a different queue operation ID when the original server coalesces identical work; the selected workspace, action, payload and task identity are compared exactly. The authored operation ID remains in the payload.
7. Use Recover or open original save task after a lost response or while the queued work finishes. Complete source commit is resolved before checking the current series head. An exact retry therefore returns its original edition after a later author has saved another revision.
8. Open the saved edition. Change the edition name and write a change note for a revision; save against that actual prior source collection. Concurrent author changes reject a stale prior edition while preserving the full working copy.
9. Choose Use saved chapter and original studies in report. The existing report selection becomes the authored chapter followed by its exact original studies. Prepare PDF/HTML/data and the original report ZIP. Use the existing Study transfer for the complete editable scientific lineage, or Workspace backup for the complete project.
10. Open every outgoing report and attachment, extract archives and use the contained editable project and source companions. Inspect all PDF pages and the actual desktop and 390-pixel screen outputs. Reopen the literal downloaded working copy, source ZIP, report, Study and Workspace using the receiving course and original native writers.

The draft does not supply scientific conclusions. The named author writes and reviews the interpretation. Sources and figures retain their producer’s original scientific validation.

## Saved source edition and history

There is no additional mutable Workspace record kind. Each accepted save calls Workspace.import_sources with a complete ordinary source manifest. Its source entry includes:

- observed-report.json: ordinary native report sections and source links.
- synthesis-record.json: the complete authored document, exact current reference catalog, literal original save request, operation identity, origin project, named revision and prior edition binding.
- synthesis-history.json: the complete immutable authored revision chain, including every prior document, source catalog and exact request.
- source-catalog.json: the full currently selected original sources and exact references.
- original-source-archives.json: the original collection IDs, manifest hashes, actual ZIP descriptors, member paths and receiving rules.
- original-sources/<collection-id>.zip: each distinct complete original collection used anywhere in the retained authoring history, including an explicit fork origin.

The save holds the original Workspace lock, which coordinates full backups. Original source import retains every body/companion object before committing the source collection. Staging is outside the scientific Workspace; it is temporary, and the retained native source objects are the durable product. Global authored-operation lookup precedes current series-head comparison. The source marker, full record, complete history and literal request identities are cross-checked when reopened.

An ordinary source-only import can carry a chapter into a different project. It remains readable with its origin project intact. Continuing authorship requires the explicit Fork into this project action, a new series identity and the actual retained origin chapter. Existing sources must be registered in the receiving project before a new source catalog/save can proceed. Full original Study and Workspace restore preserve project identity and continue the existing series normally.

## Source archives and editable native lineage

Each original collection ZIP is produced by the existing SourceReports.archive writer. It contains the byte-exact original manifest and all body/companion files. Nested ZIPs keep separate source roots separate; they are not unwrapped into the authored recipe where the original observation reader might otherwise interpret multiple study roots as one.

A ZIP preserves complete source bytes, but source-only reimport is not automatic producer registration. The existing archive may use a different manifest filename. Since the native collection identity includes that filename, record the actual reimport receipt instead of assigning an old collection ID to a new one. Original selectors, body/member hashes and authored reference JSON Pointers remain unchanged in history.

Keep the authored chapter and its original study choices together in the report selection. The original scientific-report Study exporter then follows the original producer lineage. The chapter’s companion history remains complete even when a selected-source transfer omits unrelated sibling Workspace records.

## Browser durability and recovery

Complete drafts are stored in the existing browser origin’s IndexedDB under Workspace and tab identities. Each write compares the retained draft revision before commit, so a duplicated tab cannot silently replace another tab’s complete work. A conflicting tab keeps its full in-memory copy and can download it or use Keep this complete copy in a separate browser draft. That action changes only browser draft custody, not the original native source or queued operation.

The pending request is immutable while waiting. Its document, prior collection and catalog identity must equal the complete working copy. Save dispatch occurs only after the exact pending body is durably committed. If a task failed before any authored collection was committed, Retain failed request and return to draft verifies that exact failed task and checks original source operation lookup. Its full failed request/task becomes retained working-copy history. A source that committed before the task response failed is recovered through the original task instead of creating another edition.

Save uses the actual server source catalog, not browser-supplied source values. The draft’s catalog hash identifies the exact reviewed source selection. Native save validates every chosen reference against that original catalog and uses the current original collection archives.

Capacity is visible: a complete portable working copy supports 16 MiB of UTF-8 JSON; one saved authored document supports 8 MiB. Original scientific source ZIPs are streamed through the original source writer and are not embedded in browser save requests. When complete draft storage fails, the full working copy remains available for download and no new save is dispatched.

## Installed source joins

Reusable additive files:

- model/scientific_synthesis.py and model/scientific_synthesis_catalog.py.
- operator/scientific_synthesis.py.
- operator/web/scientific_synthesis.mjs, scientific_synthesis_core.mjs and scientific_synthesis.css.
- This guide and the catalog/portable integration guide.

The only existing product hooks are:

- SourceReports instantiates and delegates the synthesis read/action/task decoration/verification to the additive adapter.
- The original source-reports extension registers four read routes, one original queue action and three static assets.
- The original scientific report composer mounts the additive panel with current original selection and its existing openForSources callback; it detaches/resets that panel with the original view.

GET /api/source-reports/synthesis-catalog returns native authored editions and the original project identity. POST /api/source-reports/synthesis-references receives ordered original source choices. GET /api/source-reports/synthesis-edition selects the retained collection. POST /api/source-reports/synthesis-operation reconciles the complete original request. The one write action is source-reports.synthesis-save on /api/actions.

## Actual receiving and delivery

Use the existing equipped scientific operator, its current installed full source and populated scientific Workspace. Preserve accepted original runs, source/queue IDs, current CEDAR/source owners and the real Page/controller. The same-owner receiving callback operates the whole authored journey, source/figure inspection, unfinished work, revision, response-loss recovery, report output, selected Study and complete Workspace reopen.

Follow the current complete AGENTS.md and CURRENT_OWNER_DIRECTION.md, including the current post-call work bank and actual recipient operation. The producing agent personally opens, LOOKs at and uses the final rendered output; screenshots captured but not viewed, source review or a passed programmatic check alone do not complete that requirement. Inspect all outgoing HTML, every PDF page, worksheets, source files and archives. When producing media, use the required natural voice/media workflow and actually watch or listen to the final export.

All customer relationship messages after positive human contact require Bryce’s approval of that exact text and attachments. Ordinary account creation/standard terms remain under his standing authorization; confidentiality/signature agreements require his review and actual signature. TJLabs attribution remains required. This component performs no external messages, provider model execution, account creation or legal signature.
