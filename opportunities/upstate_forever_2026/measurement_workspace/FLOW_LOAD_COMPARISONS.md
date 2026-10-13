# Compare original saved concentration and discharge results

Operation: ECO-LOAD-RESULT-COMPARISON-7F24-20261013. This is a continuation of the existing Measurements application and original DE49/CLOUD13 receiving course. It uses two saved load results, their original Flow studies and the unchanged observed-load integrator. It creates no new source acquisition, support match, scientific estimate or live client correspondence.

## Open the comparison in the existing application

Open Measurements → Daily flow studies → Concentration and discharge loads. The saved-load comparison is immediately below the saved-result catalogue. Keep the original scientific contract editor and any unfinished draft in place.

Choose two different exact saved load result IDs using their titles, creation times and short IDs. “Before” and “after” define the subtraction direction; they are not an automatic claim that the source periods form a treatment experiment. Click **Compare exact saved results**. The original result ID, Flow study ID, contract SHA-256, selected period and integration edition are shown for each side.

The comparison retains every series, daily row, selected/seasonal/calendar-year period and original measurement context row. Review the complete counts, then use the view tabs, status filter, full-row text search and 25-row paging. Open a row’s complete original fields when the visible quantities need their source, censoring or interpretation context. Display filters never reduce exported evidence.

**Contract changes** and **Source changes** are separate complete field comparisons. An absent field remains distinct from an explicitly null original field. If both input data and assumptions changed, the difference is between those complete calculations; this product does not assign the effect to one factor.

Changing either selection, swapping the pair or leaving/reopening the parent desk invalidates pending work safely. A changed pair requires an explicit comparison before downloading. The child panel retains its selections, filters and displayed comparison across the parent’s ordinary rerender. It does not load an old contract over the editor draft, change scientific support controls, save a new result or alter reviews.

## Scientific interpretation

- Match the original station, chemical species/basis, fraction, analytical method, unit/depth/reference/time context and solids interpretation. Total suspended solids and suspended-sediment concentration are separate original quantities. A different original series key appears as added/removed rather than being silently equated.
- Both original sides must admit equal coincident concentration/discharge support for a numerical mass comparison. Downstream, regional or unassigned discharge stays context. In particular, the retained Eighteenmile/Hartwell regional examples do not become mass estimates because they can now be compared.
- Daily differences require the exact date and gauge and quantified support on both sides. Period differences additionally require the identical actual set of quantified dates, original interval basis and calendar-year flags. Equal counts alone do not establish matching temporal support.
- Period end dates are exclusive. A partial calendar-year window is not a full annual estimate. The original native annual admissibility also requires its original species/fraction mapping and source evidence. Both unchanged annual-loads.csv files travel in the complete package.
- Point changes are after minus before only for finite point values supplied by both originals. A censored row retains its lower/upper bounds on each side; the interface invents neither a point value nor a difference from substituted limits. Censoring bounds are not confidence intervals.
- Mass remains kg over the original quantified days; daily rows represent kg/day. Original flow-weighted concentration is mg/L and uses the identical quantified-day mass and discharge volume within each original result. No zero volume or missing day becomes a manufactured mean, zero load or annual extrapolation.
- A compatible calculation difference does not establish statistical significance, trend attribution, treatment effectiveness or independent replication.

## Deliver the complete usable product

Use **Readable comparison HTML**, **Complete comparison CSV**, or **Complete comparison and both originals ZIP**. Each response binds the displayed comparison ID and both saved result IDs. The interface verifies the response filename, media type, complete byte count and SHA-256 before initiating a download; a stale pair or descriptor mismatch is rejected.

Use one separate directory per comparison. The ZIP contains the unfiltered comparison, exact selection and both original result folders, including full Flow parents, contracts, original source files and individual result reports/CSVs. Extract it, open report.html and follow the ordinary sibling links. Do not detach the report from its linked originals.

The backend’s source-native continuation is:

~~~sh
node source_tools/flow_load_comparisons.mjs \
  --before before/flow-loads.json \
  --before-study before/flow-study.json \
  --after after/flow-loads.json \
  --after-study after/flow-study.json \
  --selection load-comparison-selection.json \
  --output A_NEW_DIRECTORY
~~~

Run from the complete opportunities/upstate_forever_2026 application root with its existing supported Node runtime. Use the actual extracted originals, not a fabricated demonstration input. The independent reconstruction must retain the comparison ID, original parent/result IDs, contracts and report/CSV/source member identities. Existing Measurements can receive the two original Flow study files and preview/save their unchanged contracts; the original full portable Measurements workspace retains the same saved load result identities.

## Same original native and rendered receiving course

Use the existing original DE49/CLOUD13 operation and its currently installed application/Workspace; preserve all active work. Compose both mirrored helper files and both exact host postimages plus the backend/HTTP/CLI/report/static assets from the same complete source edition. The new helper is flow_load_comparison_ui.mjs beside flow_loads_ui.mjs under measurement_workspace/web/ and operator/web/. Do not stage a host import without its helper. The existing flow_editions.css provides the industrial layout and responsive scroll regions.

On the actual populated application: retain a recognizable unsaved contract edit; compare two saved results; inspect complete originals and support/method/depth labels; inspect context-only and incompatible rows; filter and page; swap the pair; refresh the catalogue; leave and return; confirm the exact unfinished editor draft survives. Exercise a failed API response and a changed/detached selection while a download is preparing: no stale result or file should be emitted. Check the ordinary empty catalogue and loading states. Download and open the final HTML/CSV/ZIP, extract both source folders, and use the full original workspace and source-native reopening course. Repair any concrete exception in these owned source paths and return it to the original same operation. Do not start a duplicate scientific run.

Before calling a client/prospect-facing app, site, dashboard, demo, report, presentation or export ready, the producing peer must actually open/run/render the exact outgoing version, LOOK at the screen or its real screenshots, and operate the important controls. Inspect the actual screenshare/laptop width and narrow/mobile width (including approximately 390 px), relevant populated/empty/loading/error states, downloads and reopening. Capturing screenshots without viewing them, code/DOM/HTTP 200/unit checks or another peer’s source approval does not substitute for using the real product. Fix unreadable, cramped, clipped, overflowing, broken or unstyled output. Keep plain industrial tables, clear hierarchy, restrained controls, readable typography/spacing and real scientific workflow/data/computation. Review leads to repairs and delivery, not a separate proof/checklist product or broad test suite.

This includes ALL attachments: literally open/view/play/use the final HTML, PDF/report, slides, spreadsheet, map, image, video/audio, archive and project as its recipient would; extract archives and open the actual deliverables/project. For videos use available high-quality generative media and natural TTS where appropriate, then watch/listen to the final export for pronunciation, pacing, timing and audio alignment. Pass this full rule, current AGENTS.md and CURRENT_OWNER_DIRECTION.md version 2026-10-13.4 to the existing receiving/child workers. Preserve attribution, controls/history/vendor policies, active jobs and existing authorization; do not add watchers, forced restarts, approval bureaucracy or revive stopped work.

Current source review/pure execution does not claim that this browser, filesystem or recipient attachment course has run. Return the actual host/runtime, exact source revision, issued command, produced files and any first concrete error through the same original operation. Warm contact and scientific/client acceptance remain with Bryce and the responsible original owners.
