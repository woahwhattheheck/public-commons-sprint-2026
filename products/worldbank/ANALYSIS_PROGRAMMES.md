# World Bank customer programmes in Analysis

A programme keeps one customer's existing view, report and workbook together across approved World Bank editions. Open the **World Bank** tab in the original Analysis application. It uses the same private workspace and capability as the SQL, report and workbook editors.

## Start with the customer's current workspace

Use the original World Bank source and receiving workflow to retain the complete approved handover. The programme's source picker lists original World Bank documents already registered in this Analysis workspace, including their exact revisions, handover identities and source/review metadata. Its pages include older editions. Source acquisition, merchant releases and buyer intents continue in their existing workflows.

Create a named programme with a title, the customer's existing view, report and workbook names, the reviewed observation key columns, and a short source prefix. The selected workbook must contain a sheet from the selected report. Save keeps an immutable programme revision and a request identity; repeating the same request returns that saved revision. Editing a programme uses the displayed expected revision.

The programme preserves the customer's saved SQL and report definitions. The original recurring service captures the current report definition, including its pinned query revisions, section titles, notes and parameter overrides. It also captures the complete current workbook definition and all worksheet positions. Use the original editors to make and review customer changes before preparing the next source edition.

## Review and refresh an edition

Select a retained source revision and prepare an edition. The browser records its operation ID and request before submitting it. The operation runs in a separate coordinator while the existing Analysis job worker performs source preview, import and comparison. The tab displays phase and job progress; closing and reopening the browser preserves the server's operation.

Review the original comparison, complete source/review metadata, accepted view binding, report definition and workbook definition. The source remains a candidate until the operator supplies the review digest and a selection note.

Publish continues the original recurring service: it selects that reviewed comparison, runs the selected customer report and refreshes the related workbook sheets through the existing workbook engine. Every other worksheet is preserved. If actual changed columns require a decision, the tab displays the retained workbook proposal and full column mappings. Correct the affected worksheet mappings and continue the same operation. The original selection and report publication remain attached to that operation.

A customer edit made after the review is handled by the original definition and view revision checks. Open a new review for the customer's current definitions rather than overwriting their edits. The retained earlier review remains visible in programme history.

## Continue interrupted work

Programme definitions, save request identities, operation requests and exact continuation JSON are stored in the original SQLite workspace. They travel with its existing portable archive.

Use **Continue** on an interrupted operation. The browser and command line reuse the original operation ID and retained inputs with resume enabled. The original service owns its actual job attempts: completed jobs are reused; supported archive continuation retains its existing snapshot; a failed or interrupted non-resumable job receives a new retained attempt under the same business operation. A second source acquisition or a new comparison selection is not needed to recover a later delivery phase.

The coordinator drains before the Analysis workspace closes. A process termination leaves its operation visible as interrupted when the same workspace is reopened. Immutable review and selection JSON retain their exact bytes and digest. An original mutable operation file that advanced just before a process stopped is reconciled into the SQLite mirror, preserving the engine's actual progress.

## Deliver and reopen

A completed edition provides the complete original report, workbook, handover, comparison exports, workspace archive and customer delivery ZIP. Downloads use the Analysis server's existing descriptor verification and streaming response.

A restored customer workspace retains original native report, workbook and source outputs, plus programme history. It may not contain the old producer's assembled delivery directory. The tab shows file availability for each completed operation. An edition’s own workspace snapshot is taken while its final archive is being assembled. After that snapshot is received, its old archive assembly remains interrupted. The programme separately verifies the already accepted source selection, report publication and completed workbook, and makes those exact accepted outputs available for a fresh portable delivery.

Choose **Create portable delivery** to package an accepted edition from that restored workspace, including when its producer’s final archive assembly was interrupted. This creates a new delivery ID linked to the accepted operation. It reuses the original report publication, workbook job, dataset version and source review. It also retains the accepted source comparison and selection binding. The new workspace snapshot includes later customer edits; the report and workbook remain the selected accepted editions. The original delivery and all history remain distinct.

This uses the original World Bank delivery writer and original archive engine. Older workspace ZIPs are not recursively nested into subsequent customer snapshots. Repeating the new delivery request returns the same new operation, and an interruption continues its retained export jobs.

## Command line

The original product launcher exposes the programme commands alongside its existing one-edition and recurring service commands:

~~~sh
node products/worldbank/cli.mjs programme --workspace /path/to/customer serve
node products/worldbank/cli.mjs programme --workspace /path/to/customer list
node products/worldbank/cli.mjs programme --workspace /path/to/customer sources
~~~

The programme command's help lists save, prepare, publish, operation, review, history, download and reopen request forms. These use the same manager and request identities as the browser. A launch-time original World Bank core path can be supplied when the installed source layout differs; browser source choices never supply executable code.

## Storage and implementation

The manager is stellar_forge_buyer.worldbank_programmes.WorldBankProgrammes. Its additive SQLite tables store programme revisions, same-request results, operation history and seven exact original service JSON files. Its single coordination thread does not occupy the Analysis executor. The service receives the already-open Analysis workspace instead of attempting to acquire a second owner lease.

Source files, row comparisons, report publications, workbook definitions, complete workbook outputs and workspace archives remain owned by their existing native engines. A programme records their identities and sequences the customer's review and delivery.
