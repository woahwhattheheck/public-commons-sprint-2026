# Fiscal comparison briefing

Turn a reviewed Treasury comparison into a usable report for a colleague: exact dated values, the complete row and field differences, the original interpretation of every field, and one complete source archive. The report opens directly in a browser and keeps all its pages and downloads together.

The source workspace remains the analysis authority. This component consumes its saved comparison, exact decimal results, verified file descriptors and existing complete comparison export. It presents those results in HTML, Markdown, CSV and JSON.

## The customer workflow

A fiscal analyst prepares a reporting update from two saved editions. Before handing it to an editor, reviewer or colleague, the analyst needs to distinguish three questions:

1. Which observations are included in each selection?
2. Did values at the same complete source key change?
3. How did each reviewed stock series move between its own first and last observation?

Those questions have different answers. The briefing gives each its own section and retains the underlying row detail. A reader can follow any conclusion back to the original edition, source filter, captured pages and field review.

The offline report is the handover surface. The existing Fiscal Application remains the operating surface for source capture, review, comparison, query, export and reopen.

## Prepare the comparison in the original Application

Use the existing Fiscal workspace or its managed Applications entry:

1. Open the named operator and selected source workspace.
2. Inspect both saved captures and their original source filters, page chain, acquisition intervals and complete field roster.
3. Review the two editions, including source units, scale annotations, dates, unique keys and null representation. Build each selected edition to READY.
4. Compare the two immutable editions using their complete common key and selected measure fields.
5. Inspect added, removed, changed and unchanged observations. Review the exact first/last dated values for stock series.
6. Create the original complete comparison export. Its source delivery includes both editions, both original captures, all retained response pages and the comparison.
7. Stop this workspace's managed Application before opening the standalone briefing command. The original kernel lease serializes the two operators.
8. Select the comparison and export below, create the briefing, and give the complete archive to its intended reader.

The managed Applications guide is at
[FISCALDATA_APPLICATIONS.md](../../../distribution/runtime-workspace/FISCALDATA_APPLICATIONS.md).
The original [README](README.md) and [domain contract](DOMAIN.md) describe the model actions and exact source semantics.

## Installed command

The maintained distribution contribution adds one command and one module export:

| Interface | Original source |
| --- | --- |
| starforge fiscaldata-briefing | fiscaldata/briefing-cli.mjs |
| @tokenjunkielabs/starforge-merchant/seller/fiscaldata/briefing | fiscaldata/briefing.mjs |

Inspect the installed registration:

    starforge registrations --source fiscaldata-briefing
    starforge fiscaldata-briefing --help

List the saved comparisons and their complete comparison exports:

    starforge fiscaldata-briefing list --dir /absolute/private/treasury-workspace

The result includes each original comparison ID, SHA-256, edition IDs, row summary and corresponding export IDs. Select the actual comparison hash and an existing comparison export.

Create the report:

    starforge fiscaldata-briefing create \
      --dir /absolute/private/treasury-workspace \
      --comparison COMPARISON_UUID \
      --expected-comparison-sha256 COMPARISON_SHA256 \
      --source-export EXPORT_UUID \
      --out /absolute/private/treasury-briefings \
      --operation october-debt-update-1 \
      --title "Treasury debt observations: selected source comparison" \
      --audience "Research and editorial review" \
      --notes-file /absolute/private/analyst-commentary.txt

The notes file is an optional UTF-8 private regular file, up to 64,000 bytes. Its text appears as separately labeled analyst commentary. Source notes and original numerical results remain independently retained.

The output directory must be private, outside the source workspace and outside any parent directory containing that workspace. It is created with mode 0700 when absent. Every report file is private. The operation uses the original model lease and the original private-directory lock helper.

The returned result provides:

- The complete report directory and index.html path.
- Original comparison ID and SHA-256.
- Complete manifest hash, file count and byte count.
- The final briefing.tar.gz path, size and SHA-256.
- Whether this same completed operation was reused.

The original source entry point accepts the same arguments:

    node stellar/scf-starforge-20261009/sf30-seller-sdk/fiscaldata/briefing-cli.mjs \
      create --dir /absolute/private/treasury-workspace ...

Node 22 or later, Linux util-linux flock and GNU tar are the runtime requirements. The existing SCF package supplies the original Fiscal model and file helpers.

## Read and hand over the report

Open the returned index.html. It includes:

| Section | Reader action |
| --- | --- |
| Comparison summary | See the size of each selection and counts by row status. |
| Dated observations | Read original first/last dates, exact values, exact dated changes, units and scale. |
| Row detail | Follow complete paginated all/added/removed/changed/unchanged observations. |
| Source identity | Inspect immutable edition/capture identities, exact source filters and acquisition intervals. |
| Field meaning | Compare original labels, source fields, roles, units, scales, null markers and notes. |
| Complete handover | Download the original complete source archive, CSV, Markdown and JSON files. |

The layout is monochrome and works on a narrow screen. Wide numeric tables scroll inside their own panel; the document stays within the viewport. The HTML uses ordinary links and native expandable details, so it opens offline without a service, browser extension or JavaScript dependency.

Each row-detail page contains up to 200 observations by default. All rows are included in both the complete original rows.jsonl and the all-rows pages. Each status also has its own complete page sequence. Change detail preserves each source field and its original left/right value, with absent fields and native nulls explicitly distinguished. Values at unchanged rows remain available.

Use --rows-per-page to select a page size from 1 to 500. The page size is part of the immutable report operation.

Give the reader the complete briefing.tar.gz. It contains the report, all row pages and every source download listed below. Extract it into a new private directory while preserving its private file modes, then open index.html.

    mkdir -m 700 /absolute/private/received-treasury-briefing
    tar -xzf briefing.tar.gz -C /absolute/private/received-treasury-briefing
    starforge fiscaldata-briefing verify \
      --report /absolute/private/received-treasury-briefing \
      --manifest-sha256 THE_RETURNED_MANIFEST_SHA256

The verify command checks the complete manifest inventory and every selected file's exact size and SHA-256. It works against an extracted handover without the original source workspace. For the original local package it also verifies its sealed complete archive.

## Complete file contents

| File | Contents |
| --- | --- |
| index.html | Main offline customer report. |
| briefing.md | Complete Markdown report for document/editorial reuse. |
| briefing.json | Original bindings, source context, full comparison result, dated measures and complete page index. |
| dated-measures.csv | One row per original edition, measure and source-key group; exact first/last dates, values and change. |
| comparison.json | Byte-identical original comparison, including selected-row arithmetic and interpretation. |
| rows.jsonl | Every original comparison row, including unchanged pairs and absent/null distinctions. |
| changes.csv | Byte-identical original field-change CSV. |
| left-source.json / right-source.json | Full original edition source declarations, capture intervals, pages and context. |
| left-review.json / right-review.json | Exact retained original field reviews. |
| source-manifest.json | Original complete comparison delivery inventory. |
| source-delivery.tar.gz | Byte-identical original archive containing both reviewed editions, both source captures and the comparison. |
| rows/*.html | Complete all/status row-detail pages, each linked to the briefing and its adjacent page. |
| manifest.json | Complete briefing inventory and original producer/source identities. |

The original source archive keeps its original SHA-256. Packaging a report never changes or repacks that inner source delivery. The outer archive has its own digest and complete inventory.

The working report directory also retains its operation intent, archive publication record, final seal and any interrupted copy bytes. Those private working records are separate from the reader's archive.

## Exact interpretation

The renderer never parses financial values as JavaScript numbers. Grouped display is a string-formatting operation; CSV/JSON preserve original decimal strings. Numerical changes, compatible-unit decisions, participating-row counts and date groups come directly from the saved original comparison.

For Debt to the Penny, values are stock observations at particular dates. A first-to-last change is the last dated stock minus the first dated stock in one selected series. Summing daily stock balances does not give a period total. The original comparison retains its selected-row arithmetic with the full interpretation and participating-row counts; the briefing leads with dated observations.

Added and removed rows describe selected membership. A source filter that begins one day later can remove one observation without revising any matching observation. The report states that distinction and links the exact original row.

Source unit and scale are independent annotations. A scale of 1 remains 1. The briefing applies no currency conversion, rounding or scaling. Separate key groups remain separate, and incompatible dates, units or missing numerical values keep their original comparison treatment.

Native null, an absent value and an explicit string used as a null marker remain distinct in the JSON and field review. The dated CSV includes null_token_kind alongside null_token. Import the value columns as text when exact decimal strings must survive a spreadsheet workflow.

## The accepted Treasury demonstration

The original Treasury receiving retained all eleven fields of Debt to the Penny. Two source selections cover 1–8 October 2026 and 2–8 October 2026, with three actual Treasury response pages each. The selected row sets contain six and five observations.

The saved comparison is:

    1e596687-510e-47bd-8cd0-cc27c93d3214
    d26fd89fec959136fa5332ad188cefb86b306df97c2150301133f514101bc195

Its accepted complete comparison export is:

    8128e1aa-4363-43c4-ba3b-c3567089a66e
    source-delivery.tar.gz:
    25fb62bd12948b0bf3d93bfbfb5881e5bf707e88f1a2d25e323b65c824e4aa15

That comparison contains zero added observations, one removed observation, zero changed matching observations and five unchanged matching observations. The omitted source key is 2026-10-01. Every original field of that row is retained in its change detail.

For Total Public Debt Outstanding, the original 1–8 October edition begins at 40260641972390.03 USD and ends at 40305316210829.72 USD. Its exact dated change is 44674238439.69 USD. The later-start selection has a different first observation and exact dated change; the report presents both independently.

This is a dated retained-source demonstration. Its original source publication is
[Treasury Fiscal Data: Debt to the Penny](https://fiscaldata.treasury.gov/datasets/debt-to-the-penny/).
The archive preserves the actual API requests and responses used for the two selections.

The original whole workspace also completed full-field review, native query, comparison export, narrow-screen browser use, Stop and service restart. The separate named-MCP receiving completed source checkpoint retries and adapter/HTTP restart using the same original model. Those completed workflows establish the operating path for a colleague who receives the briefing and then continues analysis in the managed Application.

## Embedding in an existing operator

Import createFiscalBriefing and verifyFiscalBriefing from the installed export or original module. A standalone call takes directory and opens the existing original Fiscal model:

    const result = await createFiscalBriefing({
      directory: '/absolute/private/source',
      comparisonId,
      expectedComparisonSha256,
      exportId,
      outputDirectory: '/absolute/private/briefings',
      operationId: 'monthly-observations-1',
      title: 'Reviewed Treasury observations',
      audience: 'Research review',
      notes: 'Analyst-authored commentary',
      rowsPerPage: 200
    });

An existing owner can additionally supply model: its already-open original model. In that form, the helper checks that verified original file paths belong to directory, borrows the model and leaves its lifetime with the caller. The caller keeps its managed browser and operator history.

The selected complete source export is mandatory. The helper checks its source ID and comparison SHA-256, and verifies its comparison/rows/change digests against the original model's file descriptors before rendering.

## Interruption and continuation

Keep the same output directory and operation ID to continue the identical report. The saved request pins comparison/export identities, commentary, page size, workspace identity and the executing producer source hashes. Changed input requires a new operation ID, preserving the earlier report.

Each file is staged privately, fully read back and published create-only. A complete staged file is fsynced before publication even when it came from a stopped earlier write. Interrupted partial copies remain in the operation's interrupted directory. A lost acknowledgement between the create-only link and removal of its temporary is reconciled using the same original inode.

The outer archive is built only after every selected payload and manifest is complete. Its full digest is retained before publication, and a seal is published after the final archive is verified. The same completed operation returns the original archive and manifest identities.

The receiver's verify operation uses the same manifest/file verification and remains independent of the original source workspace. The full original comparison and source delivery travel with the report.
