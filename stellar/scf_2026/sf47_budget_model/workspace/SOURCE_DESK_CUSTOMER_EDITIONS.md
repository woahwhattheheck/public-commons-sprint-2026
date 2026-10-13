# Customer source editions

The Source Desk can compare two complete retained source revisions and compose an editable successor from their original files. The **Customer editions** tab belongs to the same operating case, original Source Desk request journal and saved revision history as the mapping and preparation tabs.

## Prepare the target

Open the current target draft in the existing Installation Source Desk. Retain the customer's new complete source files in **Original files**. Keep receiving filenames, media types, original source references and observation times with the bytes.

The prior edition can be another draft in the same case or an earlier revision of this draft. The target is the current saved revision. Historical editions remain readable; open the current target before composing a successor.

The existing working-copy download retains all mapping fields, selected source bytes, per-file edition choices, comparison and preview results, complete original requests, and any recorded transition. Keep that download when moving between browsers or handing an unfinished review to a colleague.

## Compare exact editions

1. Open **Customer editions** and select the prior source draft.
2. Enter its exact retained revision. Choosing a draft initially selects its current revision; when source and target are the same draft, the initial choice is the preceding revision where one exists.
3. Choose **Compare exact editions**. The desk retrieves both complete immutable source revisions, including every original file and the whole mapping.
4. To compare prepared packages, choose a preparation ID from each edition and compare again. The first comparison populates the prior edition's available preparation IDs. You may compare a preparation on either side independently.
5. Review original file changes, mapping JSON pointers, prepared output changes and preparation report changes. Each row shows full identities and provenance. A missing value is displayed as absent; JSON null, false, zero and an empty string remain distinct values.

Large comparison tables show 40 rows per page. Search covers every row in that section; the displayed count includes both the matching and total rows. Leaving the search field applies the filter. Previous and Next expose all matching pages. The complete comparison download contains all rows regardless of search or current page.

Use **Download complete original** on a source or prepared-output row to retrieve the actual retained bytes from that exact draft or preparation. The existing download path checks the full length and SHA-256 before completing the file. Both complete mappings remain available below the mapping comparison.

Changing source inputs or advancing the saved target leaves the previous comparison visible. Its revision identities stay explicit. Compare the current inputs again before previewing.

## Choose every original source file

Every file in the prior source revision needs one explicit decision:

| Decision | Result in the successor |
| --- | --- |
| Retain exact prior file | Copy its complete original bytes and metadata into the target draft. |
| Replace with target file | Use the exact selected file already retained in the target. |
| Remove prior file | Drop the prior source binding from the successor. |

All new target files remain retained. The desk displays their full metadata separately. If a prior file already exists in the target, the backend applies the explicit choice to that existing file identity. An exact selected replacement remains retained even if another prior binding is removed.

A conflicting receiving filename or provenance is surfaced by preview. Select the intended target replacement or correct the original files through the existing file workflow, then compare again. The planner never silently substitutes a same-named file.

The decision counts show how many source files remain undecided. Preview becomes available when the comparison is current, each source file has a valid decision, and a mapping choice is complete.

## Choose the complete mapping

**Carry forward source mapping** begins with the whole prior selection. The planner rewrites only known native source-file descriptors, production-effort and effort-total sourceFile bindings, and programme filenames affected by the selected replacements. Other original content stays exact, including plan hashes, effort hours, customer bindings and source-specific values.

**Use current target mapping** preserves the complete saved mapping of the compared target revision.

**Use complete explicit JSON mapping** uses the entire object in the editor. Paste the whole mapping and retain its exact unfinished text in the existing working copy. Keep exact decimal amounts as text and numeric whole counts within the safe integer range, matching the original Source mapping editor. The JSON value null deliberately creates an unmapped draft.

The planner identifies changed or removed file roles, stale source descriptors, and mapping inputs requiring review. Findings include their JSON pointer and explanation. Existing native selection formats that have no declared carry-forward mapping remain available for manual review.

## Preview and save the successor

Choose **Preview complete successor**. Review every resulting file, the complete mapping, all findings, and the exact source, target and plan identities. Download the full preview when retaining or sharing the review.

Choose **Save successor draft** to issue the original Source Desk command:

    edition.apply {"plan": COMPLETE_PREVIEW}

The same browser request journal first retains the full original request. The server checks the expected target revision, both pinned inputs, selected source bytes and the entire recomputed plan before appending one successor revision in the existing transaction. A changed target requires a fresh comparison and preview.

If there are unsaved mapping, case, commissioning or Installation fields, the desk asks whether to archive their complete working copy and adopt the previewed mapping. The archived copy remains available through the original working-copy controls. A canceled replacement leaves those fields in place.

The accepted receipt retains the source and target revisions, explicit file decisions, mapping mode, result-file and selection identities, original operator/request, findings and new draft revision. It is stored in the draft's editionTransitions array and original history. The operator can download the complete transition from this tab.

A saved successor is editable. Open **Source mapping** to resolve its findings and review the new source inputs. Run the existing native **Prepare** workflow to produce its complete Workshare/Installation outputs. Prior prepared packages and attachments keep their original identities and history.

## Interrupted requests and continued work

Use the existing pending-request panel after a response interruption. Read or reconcile the exact original request before any new mutation. The original prepared request includes the complete plan and expected target revision; recovery carries that same document through the existing owner transaction.

A recorded edition receipt adopts the saved mapping through the same parent Source Desk path used by other mapping changes. It retains the complete edition review and transition alongside the working copy. After adoption, the earlier preview remains readable and its old target revision prevents accidental reuse.

Opening another draft or revision archives the complete current working copy before clearing the edition editor. Returning to a saved working copy restores the original comparison, decisions, raw explicit mapping, pagination/search and request context. If the server head advanced meanwhile, a retained comparison or preview stays visible and requires refresh before another save.

## Installed integration

The mounted operator is operations_installation_source_editions.mjs. The parent operations_installation_sources.mjs provides the existing API bridge, recording actor, same-case scope, original journal, concurrency controls, whole-byte downloads, native mapping editor and preparation workflow.

Read-only API operations are:

- POST /api/operations/{caseId}/installation-sources/{targetDraft}/editions/compare
- POST /api/operations/{caseId}/installation-sources/{targetDraft}/editions/preview

The mutation uses the existing source command route with action edition.apply. The original operations CLI and typed agent client expose the same compare, preview and prepared-command flow. Retain the current complete application source when installing or restoring; the native source preparation engine and original case/Installation identities continue to own the output.

## Continue a reviewed plan through native preparation

The original operations CLI also provides `source-edition-course-prepare` and `source-edition-course-run`. The prepared course freezes the edition application, native preparation and optional attachment as their complete original requests. Use an already reviewed plan for the selected existing case and target draft.

Run the installed original operations CLI against the same existing private workspace:

```text
python3 -B /absolute/application/workspace/cli.py operations \
  --workspace /absolute/original/private/workspace \
  source-edition-course-prepare --case ORIGINAL_CASE --draft ORIGINAL_DRAFT \
  --plan COMPLETE_PLAN.json --request-prefix ORIGINAL_REQUEST_PREFIX \
  --actor RECORDING_OPERATOR --output course.json

python3 -B /absolute/application/workspace/cli.py operations \
  --workspace /absolute/original/private/workspace \
  source-edition-course-run --case ORIGINAL_CASE --draft ORIGINAL_DRAFT \
  --course course.json --archive-output complete-preparation.zip \
  --output receiving.json
```

Supply the original `--scenario ORIGINAL_SCENARIO` with the operations workspace arguments when that installation requires it. The maintained Node launcher accepts the same operations arguments through `node /absolute/application/workspace/launcher.mjs --python /absolute/python3 operations --workspace /absolute/original/private/workspace …`.

Preparation accepts `--note` and an explicit `--attach-version` when the same course should attach to the original case. Retain and resume the same course after interruption. The continuation reads every native output and the whole preparation ZIP, checks the accepted historical edition and reconciles the original edition request while preserving any later saved head. Its resulting files and original responses stay with that same operation.

## Operate and inspect the outgoing customer edition

Use the existing supplied customer case, source draft and retained originals. Record the selected installed source identity, current target revision, prior source/preparation selections and the original request IDs with the outgoing work.

Choose one originating path for each successor. A successor saved through **Save successor draft** continues through the existing browser **Prepare** and attachment controls. A CLI course starts from a reviewed plan whose target has not yet been advanced; retain its complete course before its first mutation and resume those same requests. After the CLI course completes, refresh the original draft in the browser to inspect its accepted transition and native outputs. An earlier preview is historical and must not become a second successor request against its old target.

Open the exact installed outgoing version and look at its actual desktop and narrow-screen presentation. Inspect the running screen or its actual screenshots yourself; saving images without viewing them does not complete this inspection. Operate the following complete flow with the selected originals:

1. Open the current target and exact prior source revision. Compare their complete original files and mapping, then select available original preparations and review their full output/report differences.
2. Use search and paging on the populated tables. Inspect an empty search result, restore the full population, and download originals from both sides. Open the downloaded files and check that their full identities match the selected rows.
3. Choose each retained, replaced or removed source file explicitly. Select the complete mapping, inspect findings and preview every resulting file. Confirm that changing a choice or advancing the target makes an older preview visibly stale.
4. Save through the selected original browser or CLI request path. If a response is interrupted, recover that same original request through its retained journal before any next mutation. Inspect the recorded transition and accepted mapping; keep prior drafts and preparations accessible.
5. Prepare the successor through the original native workflow, inspect every output and the complete ZIP, and perform the optional attachment only when its original case version is selected. Open the actual workorder, preparation JSON and other selected output documents, including their full source/phase/effort content.
6. Download the complete working copy with unfinished edition fields and reopen it through the existing working-copy controls. Inspect the restored raw mapping, decisions, comparison, preview, selected revisions and original request state. Reopen the accepted draft and prepared package independently through the original native client or existing receiver.

Inspect populated, empty, loading, stale and error views, readable tables, control labels, focus and desktop/narrow layout. Retain the actual images and complete downloads with the same customer operation, return them to the producing owner for viewing, and correct any visible or workflow defects before handing over that outgoing edition. The source and native receiving receipts identify what actually ran; source checks alone do not establish a rendered customer result.


## Existing customer receiving programme

The maintained `installation-source-desk-receiving.py` programme continues to own the original workspace, complete source selection, native server and browser lifetime. Its existing browser programme, `installation-source-desk-receiving.mjs`, invokes `installation-source-editions-receiving.mjs` after the original intake, mapping, preparation, attachment, Installation and source-history operations.

The same actual customer selection supplies both the native prepared source and the browser's editable target. Each has the same complete original file bytes, metadata and customer mapping. The edition course selects each file individually: retain when its full metadata is already identical, otherwise replace it with the exact matching target original. The recorded successor carries the source mapping forward, with the entire customer selection checked against the original input. This course does not author new customer quantities or commercial choices.

The continuation operates five complete stages:

| Stage | Retained result |
| --- | --- |
| Compare exact customer editions | Both complete draft identities, source and target preparation IDs, full comparison, all original files and prepared outputs downloaded from both sides, populated and empty search views, and all available table pages. |
| Compose and reopen unfinished work | Every explicit file choice, complete source mapping, an actual unfinished mapping download and reopen, full preview, and the visible stale-preview state after changing and restoring a choice. |
| Save and recover the original request | One complete `edition.apply` request, its response retained before the browser response is interrupted, recovery of that same request through the existing journal, and the complete accepted transition. |
| Prepare the successor | One original native preparation for the accepted revision, every output and the complete archive, original customer plan/profile/effort checks, and independent readback of both earlier preparations. |
| Reopen history and the complete review | The exact pre-successor target revision, complete accepted working-copy download, reopening that actual file through the installed controls, full review download, and the original request/preparation lineage. |

The browser report's final stage is `14-edition-history-and-final-working-reopen`. The report retains these results under `customerEditions`; the original selection interruption and the edition interruption have separate records. Every mutation comes from the installed controls and remains attached to its original request. The parent programme verifies the actual final draft and includes the complete browser artifacts in the original native delivery.

Keep the current receiving source selected with the whole installed application. An earlier complete report or backup retains its original source identity; it does not establish completion of these additional stages. Resume a partial current run through its original input, report, persistent browser profile and requests. A following source edition of an already completed operation needs its own explicitly retained continuation binding and output directory in that same case.

The producing operator opens the saved desktop and narrow-screen images and the actual downloaded attachments, inspects the displayed content, and reopens the complete outputs. The report identifies the controls and files actually operated; the operator's observations accompany the customer delivery.

## Reconcile individual mapping fields

Customer editions also offers **Reconcile individual mapping fields** when a successor needs choices from both complete mappings. Keep the original file decisions, compare every differing field, and choose source, target, exact custom JSON or explicit absence. Arrays remain whole until you explicitly expand their original positions. The preview preserves original values and records each removed or resulting array index.

The complete field review, unfinished custom text, earlier choices and original pending request travel in the existing Source Desk working copy. Saving uses the same target revision check, original request journal and byte store, then continues through native Prepare. Exact native JSON transport retains original number values and distinguishes absence from null.

See [Installation mapping reconciliation](INSTALLATION_MAPPING_RECONCILIATION.md) for the mounted workflow, complete JSON/CSV/HTML exports, native command and receiving course. The original source/target/explicit whole-mapping modes and customer-edition receiving remain available.
