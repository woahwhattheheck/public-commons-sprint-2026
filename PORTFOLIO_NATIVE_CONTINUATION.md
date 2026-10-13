# Portfolio native baseline continuation

The original Conservation portfolios desk now uses one retained baseline pairing across scenario analysis, portfolio reports and whole-scenario economic comparisons.

## Operator journey

1. Open a saved portfolio and complete a native evaluation of its selected land-cover scenario.
2. Choose **Compare native scenarios**, **Build portfolio report**, or **Build decision desk**. The original form reads the evaluation's grid, profile, selected models and each completed native stage's execution version.
3. Choose an eligible completed baseline from the original baseline definition. The form shows the original ranking baseline separately, every candidate's compatibility reasons, and completed-stage, last-run and declared engine versions.
4. When needed, explicitly enable completion of the matching baseline. The original retained native runner prepares/resumes that baseline through the existing authenticated serial operation queue.
5. Scenario analysis continues into the existing scenario-analysis form after the original operator refreshes its retained run state. Reports and economics use the same pairing resolver directly. Baseline/evaluation IDs, selected models, per-model execution versions, declarations and legacy fallback labels remain in retained report metadata and the original HTML/downloaded archive.

Changing the profile or selected models during portfolio evaluation does not reuse the screening baseline's outputs as its comparison baseline. NDR-only and SDR-only portfolios retain their actual selected models. Every model calculation remains in the original native runner.

## Retained API contract

GET /api/portfolios/pairing?workspace=KEY&portfolio_id=ID&evaluation_run_id=ID

Returns upstate.portfolio-pairing/v1:

- portfolio_id, ranking_baseline, evaluation and baseline_scenario_id;
- candidates, each with id/state/selection/models/native_version/eligible/reasons;
- excluded_records identifying malformed retained candidate records;
- selected_baseline_run_id and ready;
- prepared_baseline_run_id/prepared_selection for this application's pinned native engine;
- can_complete/execution_issues, actual runtime_preflight/unfinished_models and version_policy.

The default is a compatible completed original. Operators may choose another eligible original. Prepared-run identity uses the original Workspace.prepare_run definition, including its current pinned engine, and is verified after preparation.

POST /api/actions with action portfolio.baseline.complete and payload:

    {"portfolio_id":"ID","evaluation_run_id":"ID","title":"Analysis title",
     "baseline_run_id":"optional explicit completed or canonical prepared ID"}

The task retains the original request and returns upstate.portfolio-baseline-completion/v1 with portfolio_id, evaluation_run_id, baseline_run_id, analysis_selection and native_pair. The original task detail links to the completed baseline run. Its IDs remain usable after the browser reopens.

Original portfolio.report.build and portfolio.decision.build continue to accept their current selections. Optional baseline_run_id now selects an actual compatible observed-version pair. run_missing_baseline is honored. A supplied comparison must contain this evaluation and exactly the selected matched baseline.

## Native identity and report behavior

Completed selected-model stage.runtime.version is authoritative. A resumed run can retain NDR from one runtime and SDR from another while run.runtime describes its most recent execution. The shared model/native_versions.py and operator/web/native_versions.mjs preserve each model's stage version, last run runtime, original declaration, completion time and reused-from provenance separately.

If a completed stage lacks its version, the resolver uses the run's observed version with basis observed_run_fallback. Only older records without either observed source use the explicitly labeled requested_legacy declaration. Unknown versions are excluded. Two runs compare only when each actually compared model has matching effective versions. An NDR version difference does not exclude an SDR-only comparison.

The native portfolio baseline must use the original baseline scenario, the evaluation's exact grid and parameter profile, and the same selected native models. Existing completed mixed-version stage combinations remain usable when their per-model execution versions match. Completion first asks the original runtime loader to verify the actual installed engine and its source for only unfinished stages. Those observed versions must match the evaluation. Already retained stages keep their own execution provenance, and export-only continuation does not load another engine. Existing incompatible originals remain intact.

The original scenario-analysis engine, form and decision-to-analysis handoff adopt the same rule on their actual common model outputs. New analysis run details retain all compared per-model provenance. Ordinary same-version cohorts preserve their existing input binding and analysis ID. Per-model provenance enters the digest when an authoritative stage version differs from the prior run-level comparison version; existing saved snapshots remain unchanged. Current operator polling must include original stage_summary[model].runtime, as supplied by merged PR3092.

The retained upstate.portfolio-native-pair/v1 binding contains the original ranking baseline, actual matched baseline and evaluation with each run's complete selection and native version provenance. Physical portfolio reports show this table visibly. Economic lineage retains it alongside its original cost inputs. Updated report keys use version 2; older immutable reports remain unchanged.

## Original economic and delivery continuation

The existing economic workspace adapter checks stage versions after the actual pollutant subset is selected. Incompatible native alternatives retain their original IDs and reasons. Its original native-report intake keeps requested identity separate from the producer's retained execution provenance. New physical packets retain the per-model versions in baseline, alternative and sensitivity records; explicit legacy physical packets keep their original declared-version behavior. Annual masses, common support, costs, optimization and source-report hashes are unchanged.

The saved-analysis delivery table reads compared per-model versions from the immutable saved run details, with the last run runtime and requested identity shown separately. Older analyses retain their saved run-level provenance and remain reopenable.

## Installation

Receive the nine portfolio files, three scenario-analysis files two economic/delivery-continuation files and three original producer/release/viewer files from the four complete source banks on this Page under the current application root. The additive descriptor registers the read route, queued action and static helpers with the installed original extension host; restart the existing operator to read it.

The original app factory must supply its existing refresh callback:

    const portfolio=attachPortfolio({
      ...existingCapabilities,
      refreshState:()=>refresh({force:true})
    });

Apply that single addition to the current original attachPortfolio call, preserving all current delivery review, compact polling, source header and rehearsal changes. It is supplied as an exact hunk in the source bank; the full current app remains with its publication owner.

No new server, queue, page or raster engine is installed. Current model/portfolios.py and operator/web/portfolio.mjs are complete maintained source successors. model/planning_inventory.py remains with its current raster-cache owner; the browser inventory picker uses original baseline scenarios and checks versions on the actual selected cohort’s common outputs, without hiding candidates before cohort selection. The companion source bank on this Page supplies the full scenario_analysis.py, scenario_analysis.mjs and scenario_handoff.mjs successors; install it with this bank.

## Focused verification

Both complete authored JavaScript modules parse. A direct wiring check executed the actual attachPortfolio and pairing-control source with retained-record-shaped fixtures: a changed-profile NDR evaluation opens the matched baseline, and a missing baseline queues exactly one original completion then refreshes the host before opening the original analysis form. The shared browser version source also accepts identical NDR/SDR stage-version vectors when the last run runtimes differ, rejects a changed compared stage, and allows an unrelated noncompared model version difference. Original stage_summary runtime metadata produces the same result. The native-report producer retains its existing supported-engine conversion and checks selected completed stages; the original delivery backend verifies saved per-model bindings before release.

Native receiving should run the same journey with actual saved portfolio/evaluation IDs, then reopen the result and original report archive. Python source review and native execution remain part of that original receiving operation.
