# Matched control design and native comparison
TokenJunkieLabs — Ecosystem Sciences Upper Savannah scientific workbench.

## What the operator does

The Matched controls desk starts with an existing original baseline run and an actual saved restoration footprint. It retains the complete treatment support and explicitly chosen covariate intervals. It reports candidate availability, selected controls, remaining covariate differences and any failed support or threshold assessment. An accepted design can create its original land-cover scenario, prepared run and saved experiment. The original queue executes that experiment.

The interface is part of the existing installed operator. Its extension descriptor registers its routes, actions, sidebar entry and assets; it does not replace app.mjs, server.py, the original task worker or other desks.

## Use with an original project

1. Open Matched controls in the existing application. Choose the original baseline and saved restoration footprint. Give the study a useful title and scientific reason.
2. Select the prepared covariates you want to constrain. Available elevation, soil erodibility and rainfall erosivity retain the grid's exact units. Enter increasing numeric boundaries, separated by spaces or commas. The first and last intervals remain open; an empty boundary list is one unconstrained interval. An included covariate still requires valid values at all treatment cells, even with no boundaries; disable it to keep it descriptive only. A project using only NDR may select elevation without requiring unavailable sediment-specific rasters.
3. To include slope or connectivity, select an already imported aligned original raster, retain its declared units and describe what it measures. The native producer checks the original alignment and source. Elevation does not replace slope.
4. Optionally select an original binary exclusion raster and a maximum per-pair runoff-proxy difference in the original prepared units. Controls already exclude actual treatment cells and stay within the original reporting mask and exact land-cover transition.
5. Review original sources. The source preview binds the complete current selection and original inputs. Prepare control design retains this exact design identity in the original native queue. Follow Open task for progress, errors and continuation.
6. Inspect the saved support and balance tables. Full treatment and missing/outside support counts remain in the summary. Per-stratum counts describe cells admitted to that stratum. Small nonzero differences use significant or scientific notation.
7. A prepared design can create the original scenario and experiment. Open them through their existing native desks. Execute saved experiment uses the same original queue and scientific runner. Inspect the completed modeled nitrogen/phosphorus/sediment stream-load comparisons in the original experiment, with its unchanged native units.
8. Export the complete original Workspace through its existing archive form. The native producer's typed Study continuation carries its own full design/source closure. Reopen the saved design from its original IDs in that received project.

## Interpret the result

- A support failure retains the full original treatment count and makes the insufficient or missing support visible. It never silently reduces the treatment.
- Exact interval membership constrains only the selected covariates and bins. Within-bin residuals remain visible. A selected covariate with no boundaries is recorded but unconstrained.
- The existing precipitation matcher computes its original one-dimensional optimum inside strata. An optional threshold checks that chosen result. A threshold_not_met assessment means that selected result exceeds the threshold; it does not prove that every alternative constrained pairing is impossible.
- Distinct named designs are not automatically independent spatial placements. Use the retained chosen-cell and mask identities when comparing designs.
- Shared class, area or runoff-proxy totals do not establish local watershed/utility balance. Native experiment results describe modeled annual delivery to streams, not intake concentration or observational causal validation.

## Saved work and recovery

The desk saves editable choices and the complete original queue request before dispatch. The browser receives an immutable operation identity and reuses it after a lost response. Recover same request obtains the existing native task. Resume a failed/interrupted task through the original task dialog; resubmitting unchanged choices keeps its original identity.

Desk export/import is optional interchange for choices and retained requests; ordinary source pickers and labeled controls provide the scientific editing interface. Reopening merges original request receipts and rejects conflicting operation identities or another project's choices. A restored copy keeps the original project identity; requests from a different Workspace instance remain bound to that original instance. New work in the restored Workspace obtains its own operation identity.

If browser persistence fails, the interface shows the failure and prevents new dispatch until the complete request can be retained. Export the current draft to preserve it. Late task receipts are attached to the original Workspace even after navigation; late reads/errors cannot replace a newly selected project's view.

## Installed files and native contracts

- operator/extensions/multivariate-control.json
- operator/multivariate_control_operator.py
- operator/web/multivariate_control.mjs
- operator/web/multivariate_control_core.mjs
- operator/web/multivariate_control.css
- model/multivariate_control.py and its original design/report helpers, CLI and typed-transfer closure

POST /api/multivariate-control/catalog returns original baselines, footprints, raster sources and retained designs. preview accepts selection; inspect accepts design_id; progress accepts task_id. The original /api/actions endpoint receives control.prepare, control.adopt or control.execute plus original workspace and operation_id. Preparation pins expected_design_id to the reviewed native preview. Output file links come from verified original descriptors and the operator's existing download tickets.

The module never executes a model in catalog/preview/inspect reads. Rendering retains original source values. Human text is escaped before HTML insertion.

## Current engineering validation and receiving

The actual authored JavaScript core/controller was executed in V8 against explicit DOM/API boundary fixtures. The focused course covers original units and optional sources, NDR-only admission, exact selection round trip, invalid numeric choices, write-before-dispatch, a response lost after actual queue acceptance, recovery of that same task, original adoption, project identity and lifecycle detachment. Source review found and corrected mandatory sediment covariates, hidden runoff-proxy units and small residuals rounding to zero.

Continue the existing native Geographic receiver and browser chapter with this complete source selection. Use explicit original input IDs and a new saved design, preserving all completed original regional run bytes. The original receiver also owns native execution, Study export, independent restoration and the archived application's own reopening. It must run the actual final operator and inspect its completed results.

## Current owner direction carried with this product

Read and retain the application-level AGENTS.md and CURRENT_OWNER_DIRECTION.md, version 2026-10-13.4, plus the repository's existing attribution/license and rendered-product instructions in every cold application handoff.

Bryce requires the actual final outgoing application and every attachment to be opened, operated and LOOKED at in its normal recipient-facing viewer. Inspect the populated scientific screens at presentation and narrow/mobile widths; use loading, empty/error states, downloads/exports and reopening. Capture and actually view relevant real screenshots. Repair clipped, cramped, broken or unreadable output inside the same product course. Source inspection, DOM/V8 checks, HTTP status or another worker's approval do not replace looking at the actual product. Keep this focused on useful implementation and delivery, without broad test sweeps or a separate review product.

Preserve active workers, completed native results and original implementation ownership. Continue broad modeling/source/runtime/application work from actual saved state. Keep the full model catchment distinct from the South Carolina reporting mask and utility-focus geometry. Identify modeled inputs/results accurately and preserve original units. No forced restart, new controller, watcher or automation is part of this feature.

Bryce's direct war-room update at 2026-10-13 17:05:52 UTC requires preserving TJLabs attribution even when a prospect asks otherwise. Keep existing attribution and third-party source/license notices in all application, report and archive editions. His confirmed meeting end at 16:18:37 UTC allows the existing receiving assignment to continue with its current owner and tab coordination.

The typed Study opening can inspect a known design even when an unrelated source catalogue entry fails. It preserves an unfinished draft and respects the original navigation guard. Catalogue refresh follows native task-state transitions rather than every progress timestamp.
