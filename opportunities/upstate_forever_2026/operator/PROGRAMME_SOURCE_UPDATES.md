# Update the sources of a saved Programme

A source update can prepare replacement profiles, land-cover scenarios, grids and native runs. **Run programmes → Update sources** reviews those actual replacements against an existing Programme and saves a successor study. The original Programme remains available with its selected cases and results.

## Complete the source-to-study workflow

1. Open **Source updates** and retain the new source edition using the existing workflow. Review its dependency changes and prepare its affected native cases. Keep the saved plan: it is the source of the exact replacement mappings.
2. Open **Run programmes**, select the original saved Programme, and choose **Update sources**.
3. Select its saved source plan and name the successor. The choices show the affected and already mapped cases. Choose **Preview successor**.
4. Review every case. **Replace** uses a mapped native run, or prepares a run from the plan’s published replacement dependencies when you create the successor. **Retain** keeps the original case; **Pending** identifies source preparation still needed. The preview shows the original and successor grids, both run identities and states, required native work and source reasons. For a large Programme, use the case pages or download the complete preview.
5. Choose **Create successor Programme** when the preview is ready. Creation checks that the original Programme, source mappings and reviewed selection still match. The original task queue retains the request and returns the saved successor.
6. Open the resulting Programme from its task or the normal saved-Programme list. Use the maintained **Continue** controls for any prepared or incomplete native cases. Completed original stages remain eligible for their normal reuse. Open the result catalogue and comparison views, then **Export native study** to produce the new maps, scientific report and editable study source.
7. Export the complete scientific project through the ordinary portable workflow. Restore it and reopen both the original and successor Programmes. Their source-update relationship travels with the Workspace.

A saved refresh plan must cover the selected change coherently. Missing mappings, unsupported case relationships or incompatible target grids appear in the preview with the relevant case. Continue preparation in Source updates, then preview again. The application does not infer a replacement from similar titles, substitute another run, or silently revise an older Programme.

## Continuation and previous results

Successor creation does not start native computation. It selects the exact prepared or completed native runs admitted by Source updates. When a plan refreshes a shared profile, scenario or grid without selecting its dependent runs, the maintained Programme engine previews their exact identities and prepares those runs during successor creation. The preview distinguishes these cases from runs already present in the Workspace. Ordinary Programme controls own execution, comparisons, reports and native-study export.

The preview is tied to one original Programme and one saved source plan. Changing the plan or title clears the reviewed selection. Creation includes the exact preview identity, so a changed dependency or mapping is reviewed again. A repeated original creation request resolves to the same retained relationship and Programme.

If a creation response is interrupted, retrying the still-open form uses its original request and selection. The Tasks panel shows accepted work. Close and reopen the form to review a different edition. Previously created successors are also listed inside the source-update form.

## Maintained API and integration

The original authenticated Operator serves:

- GET /api/programme-source-updates/catalog with programme_id.
- POST /api/programme-source-updates/preview with programme_id, refresh_plan_id and title.
- Existing /api/actions with action compute.programme.source-update and the same selection plus expected_preview_id.

The additive model module uses the maintained source_refresh.get_plan mappings and ComputeProgrammes.preview/create. Its immutable programme-source-updates records bind the original Programme, saved plan, reviewed case mappings and resulting Programme. The registered workspace verifier and portable restore check these relationships during ordinary receiving. Portable backup shares the successor-creation lock, so it captures the Programme and its source relationship together.

The component installer composes its seven explicit Programme browser seams and the portable capture and receiving hooks. It preserves independently maintained execution-console, experiment, conservation, paging and native-study controls. The extension descriptor publishes the new route, task action and module asset through the original registry. The cumulative installer invokes this component after the existing Programme study integration.

To install into an existing complete application from an independently retained source edition:

~~~sh
python -B operator/install_programme_source_updates.py \
  --application /owned/existing-application \
  --source-root /owned/selected-complete-source
~~~

Use the existing operator owner to reopen that application's current server process after source installation. Preserve its workspace and operator-state directories.

## Inspect the outgoing product

The producing worker must open the exact outgoing application in its normal browser and inspect the rendered screens, including a populated Programme at screenshare width and relevant narrow width. Exercise source choice, empty choices, incomplete preparation, preview pagination/download, changed selection, creation, existing-successor reopening and normal task recovery. Then open the actual successor's completed report/maps and exported project in their normal receiving applications.

Look at the actual screens and files, repair clipping, poor spacing, unreadable identifiers, broken controls or incorrect source bindings, and continue the original work. Keep the plain industrial design and the same original scientific cases. Code review and syntax checks support implementation; actual product operation establishes the outgoing result.
