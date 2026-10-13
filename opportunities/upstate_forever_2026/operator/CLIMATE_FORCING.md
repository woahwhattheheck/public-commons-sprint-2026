# Spatial climate-forcing studies

Follow `../CURRENT_OWNER_DIRECTION.md`, version `2026-10-13.4`, and the original active run owner. Open and visually inspect the exact outgoing desktop and narrow-screen application, exercise its important controls, and open every delivered report, map, archive and editable project in its normal recipient workflow before presenting it.

This desk connects retained source editions to the original Upper Savannah native model. A completed run supplies the baseline configuration. Alternative cases change explicitly selected precipitation/runoff-proxy and rainfall-erosivity sources, create new immutable source/grid/run records, execute through the original native run queue, and compare actual completed outputs on verified common support.

## Operator course

1. Open the original application and choose **Climate forcing**. The catalogue lists completed baselines and actual registered forcing sources. Use the original source preparation desk to receive additional source files and publisher metadata.
2. Choose a completed baseline. Its profile, conservation scenario, model scope, pollutant selection, terrain, land cover, soils and original reporting geometry remain the study reference.
3. Add as many scientifically justified forcing cases as the investigation requires. For each changed input choose a retained source, its period/edition label, an explicit annual temporal basis, and the interpretation of the comparison. The publisher's source metadata remains visible separately.
4. Select optional retained polygon reporting sources or layers. Each checkbox selects the entire source/layer, combining its polygon features, and adds a summary inside the baseline reporting mask. The complete baseline reporting mask is included in every report.
5. Preview. Inspect the source identities, model scope, units, spatial checks and normalization diagnostics. Preparing uses the exact preview identity so changed source bytes cannot silently replace the inspected inputs.
6. Prepare the cases. This is an original operator task. The saved study records each new grid/run and its source bindings.
7. Queue unfinished native cases together or individually. The desk first retrieves the exact retained case request, then submits the existing `run.start` action with its original `run_id`, completed-baseline donor and source-bound climate context. The original queue, detached native process supervisor, logs, cancellation and task retention remain the execution owner.
8. Compare completed cases. The report retains the actual completed-case roster, native versions, common finite support, annual mass changes, forcing diagnostics and selected GIS differences. Further completed cases can produce a new report without altering previous reports.
9. Download the retained report files and open the resulting source collection in the original workspace. Choose **Export editable study** to open the selected Study delivery desk with this study selected. Its preview includes the baseline and case runs, grids, source collections, reporting geometry, frozen selection and saved reports. Export and receive the editable archive, then choose **Open climate forcing study** in the received catalogue to reopen the original selection and report. The full application/workspace delivery remains available.

Opening a saved study explicitly loads its original selection into the editor. Editing it and preparing again creates a new study identity; ordinary refresh preserves the current draft. The selected Study receipt freezes the report membership present at export, so later reports do not change an older receipt. See **CLIMATE_FORCING_STUDY_DELIVERY.md** for the complete export, relocation and receiving course.

Pending browser submissions retain their exact operation identity and payload. **Reconcile pending submissions** resends that same request. Completed baseline and alternative runs are reused. Browser draft storage is optional; the operator owns submitted tasks and retained studies.

## Native stage reuse and actual outcomes

A changed forcing grid can retain an unchanged model stage. A precipitation-only case may retain SDR inputs; an erosivity-only case may retain NDR inputs. The application offers the completed original baseline as a donor candidate. The original per-model input matcher checks the actual scientific input bodies, lattice, scenario and effective land cover, parameters and native runtime/version. A matching stage is copied and verified through the maintained native stage cache; a nonmatching stage is calculated by the same native engine.

The expected unchanged model list is an eligibility explanation. It is not proof that reuse happened. Reports retain the actual stage outcome, donor run, input signature, native arguments, timestamps, transfer details and rejected candidates. The browser and offline report distinguish **Verified original stage reused** from **Completed; no reuse record**. Neither infers saved elapsed time. Previously completed runs are reopened without solving them again.

The original two-model `source_runs` contract is unchanged. Do not send a one-model `source_runs` object. This path uses the existing independent `reuse_source_run_ids` donor capability. Its exact climate context freezes the original study/case, baseline selection, completed baseline stage hashes and original artifact descriptors. Both the operator and detached worker check that context before the original execution path.

For an existing application and Workspace, the same CLI can show the exact request without starting a model:

```bash
python3 source_tools/climate_forcing_study.py --workspace /actual/original/workspace \
  run-request --study ACTUAL_STUDY_ID --case ACTUAL_CASE_ID
```

The existing `run --study ... --case ...` and explicitly authorized `course --execute-alternatives` use that same request through `Workspace.run`. Preserve the sole active native owner and original queued task; do not start the CLI beside a task already executing that case. After completion use `report` and `reopen` to inspect the saved outcomes and original sources.

The installed application must include the matched model, CLI, operator provider/descriptor/browser, `ecsa_runs/upstate.py`, `operator/native_jobs.py` and `model/native_worker.py` successors. The shared worker files carry the current ensemble lifecycle and are also used by the structural-study owner; compose the complete published successors rather than replacing them with an older climate-only body.

## Scientific meaning

A spatial forcing comparison isolates the selected input editions while retaining the rest of the model configuration. It does not require identical grid identifiers: changed forcing sources necessarily create new grid records. It does require the same physical lattice, model domain and reporting geometry, plus verified unchanged non-forcing inputs.

A precipitation input may be an annual total, an explicitly described multi-year annual mean, or the existing annual normal. Keep that temporal basis alongside every case. Different source-network normal editions must not be presented as a climate trend merely by subtracting them.

The saved model profile controls NDR normalization. Under automatic normalization, the native mean uses the runoff proxy's own valid support inside the native watershed mask. Uniformly multiplying a proxy cancels when its support is unchanged. A positive fixed \`runoff_proxy_av\` preserves a magnitude response and requires compatible effective proxy units. The study preserves the profile's actual setting and inspects the actual retained native proxy/index after execution.

Rainfall erosivity is an independent SDR input. Precipitation alone does not determine annual erosivity. A comparison that holds the R-factor constant examines precipitation/runoff-proxy variation under that retained erosivity assumption; the report must retain that distinction.

NDR nutrient exports and SDR sediment exports are annual modeled mass delivered to streams. Nitrogen and phosphorus remain kg/year; sediment remains metric tonnes/year. They are not intake concentrations, storm hydrographs or measurements. Interpret differences on the reported common finite area, with the recorded model version and source resolution.

The original exact-grid guard in general scenario comparison remains intact. Climate-forcing studies use their own stricter physical-lattice and non-forcing identity checks. Terrain, resolution, routing and buffer sensitivity belong to the structural-study workflow.

## Existing source intake

Use the maintained \`source_tools/prism_period.py\` for exact annual or multi-year period capture, and \`source_tools/climate_region.py\` for original regional alignment and unit conversion. These tools preserve original source companions and temporal support. Acquire the complete native model domain, including required upstream drainage; a reporting-area-only crop cannot substitute for the model-domain forcing source.

The accompanying source-period guide provides the receiving-host recipe and actual publisher semantics. Register its returned original manifest through the existing source intake before selecting the case in this desk. Original source collection IDs and bytes remain the scientific input identity.

## Integration

The source family adds:

- \`model/forcing_sources.py\`: retained source/grid binding and source metadata.
- \`model/climate_forcing.py\`: study preview/preparation, physical comparison, retained report retrieval and receiving verification.
- \`source_tools/climate_forcing_study.py\`: original-workspace command-line entry.
- \`operator/climate_forcing.py\`: task/HTTP/download adapter.
- \`operator/extensions/climate-forcing.json\`: explicit registration with the installed extension host.
- \`operator/web/climate_forcing.mjs\` and \`.css\`: desktop and narrow-screen desk.
- The application component fragment and this guide.

The current original application discovers the installed extension manifest. If receiving into an older original application, use the existing \`install_extensions.py\` source composition course first. Do not replace a concurrently edited server or browser application with an older copy.

### Registered routes and actions

| Surface | Operation |
| --- | --- |
| GET /api/climate-forcing/catalog | Source metadata, completed baseline runs, reporting-area choices and retained studies |
| POST /api/climate-forcing/preview | Read-only source-bound preview of the selected cases |
| GET /api/climate-forcing/study?id=ID | Reconciled original run state for a retained study |
| GET /api/climate-forcing/report?id=ID&report_id=ID | Read-only retrieval of an existing verified report and download tickets |
| GET /api/climate-forcing/run-request?id=STUDY&case_id=CASE | Read-only exact original native request and eligible completed-baseline donor |
| climate-forcing.prepare | Original queued study preparation |
| run.start | Existing native run execution for the prepared run ID |
| climate-forcing.report | Original queued comparison/report creation |

Each HTTP request retains the original workspace selection and authentication. Downloads use the original verified file-ticket mechanism. The adapter resolves files only inside the named retained report directory and verifies their recorded hashes before issuing tickets.

The receiving hook calls the model's complete climate-study verifier before the original archive is registered. No separate workspace format is introduced; original recursive source and workspace delivery carries the new files and records.

## Receiving and operation

Receive this complete source family into the current assembled application. Preserve its original workspace and completed baseline. On an actual equipped host, compile/import the new Python modules with the application's existing interpreter, load the registered desk, select real retained source editions, and complete the native course above.

Exercise the actual browser at desktop and narrow width: source selection, case editing, preview, preparation, run queue/log access, report download, source collection opening, workspace switch during a read, and saved-study reopening. Confirm the full editable archive retains source, study, native outputs and report files. Report native execution and visual review separately from source parsing or code review.

A failed native process remains an original run/task with its own logs. Refresh and reopen that task to recover the same retained state; do not manufacture another scientific baseline or overwrite an accepted completed run.
