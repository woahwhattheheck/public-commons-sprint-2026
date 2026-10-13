# Joint parameter sensitivity from original native runs

This report belongs to ECO-GLOBAL-DESIGN-CB2A-20261013 (WO21/24). It extends the original scientific workspace and experiment report. It does not replace the native InVEST models, profile storage, scenario allocation, execution or paired-raster comparison engine.

## Select and retain the design

Use model.joint_parameter_studies to preview and prepare the complete sourced design. Its upstate.joint-parameter-definition/v1 document retains the original completed baseline, full sampler versions, ordered axes, physical ranges, units, source references, explicit seeds, every unit-cube coordinate and every transformed native value. Uniform and log-uniform marginals are independent exploratory choices. Coupled paths within one axis receive the same physical value. The original routing choice is fixed within a study; a changed routing method belongs to another explicitly labelled study.

A study's ID is the original model.common.digest of the whole definition. Preparing the original experiment saves an immutable joint-parameter-study.json pointer under that experiment and the sample-to-profile map under joint-parameter-studies/<study-id>/state.json. Duplicate physical profiles can reuse native outputs; their original sample positions remain in the design. The unsampled baseline profile is never appended to the statistical population.

Ordinary strength-1 Latin hypercubes stratify each marginal, not every multidimensional combination. The design uses scramble=True and optimization=None. More axes require more actual completed samples if a useful interaction fit is wanted. The full quadratic diagnostic has 1 + 2d + d(d-1)/2 columns for d axes; it needs strictly more matched samples than columns and full numerical rank. This is a mathematical estimability requirement, not an arbitrary run ceiling. A fit's held-out prediction also requires enough remaining distinct native profiles after each whole profile is removed.

For another independent replicate, select another explicit seed in the original definition. Changing samples, ranges, seeds, sources, routing or baseline creates a new scientific selection. Resumption reads the frozen matrix and does not redraw it using the current library version.

## Run and build the existing report

Run the saved study through model.joint_parameter_studies.execute. That calls the existing model.experiments runner and preserves its native state, resumable stages, failures and original output reuse.

The existing report entry point remains:

    python -m model.study_report --workspace /absolute/original/workspace --experiment <experiment-id>

Run this command from the original opportunities/upstate_forever_2026 application root using its installed native environment. It opens the original experiment lock, reads the maintained native summary and builds the same complete scientific report. If the experiment has a joint-study pointer, collect() verifies the entire frozen definition, the original sampler's saved profile identities, the native sample map and the retained case records before adding this analysis. A stale native summary must be refreshed by the original experiment engine.

The report keeps its existing comparison controls, maps/context, profile sources, native execution observations and downloads. The additive analysis appears as Joint parameter sensitivity. Expand the actual replicate/scenario/outcome you need. Each panel gives accepted and expected sample counts, exact support, raw sample ranges, relationships, interaction diagnostics and explicit exclusions.

The same module also exposes:

    analyse(definition, sample_map, native_summary, study_id=None)
    collect(workspace, native_summary)
    html_section(analysis)
    render_html(analysis)
    downloads(analysis)

analyse is a pure calculation on retained inputs; collect is the workspace-native entry point that validates original file/profile lineage. render_html creates a standalone responsive report with the complete analysis downloads embedded. downloads returns full (label, MIME, bytes) tuples for the original file publication machinery. It performs no native execution, new sampling or publication.

## What is analysed

Each analysis group is one replicate, scenario, pollutant, native unit, producing-version cohort, exact support_sha256 and outcome. No statistic pools distinct raster masks or different producing versions. Even equal cell counts do not establish equal support.

Every completed pair retains the original native_versions declaration, both run IDs and the original native_source/native_baseline_source lineage. The native runner checks versions within each pair; a failed parameter comparison does not prevent a later same-profile land-cover pair from completing. Consequently, the analysis also separates version cohorts across sampled profiles. Per-model versions and observed-versus-requested-only legacy evidence form that cohort. Requested legacy versions remain explicitly labelled and do not become observed runtime evidence. An older complete row without the native version declaration keeps its raw metric and source identity, but is excluded from parameter attribution until the original engine supplies its provenance. No run is relabelled or rerun by this analysis.

Three outcomes are retained:

| Outcome | Definition | Units |
|---|---|---|
| Annual delivered export | Native alternative_total on the paired valid cells | kg/year for nitrogen/phosphorus; tonnes/year for sediment |
| Export reduction | Native baseline_total minus alternative_total | The native annual mass unit |
| Relative export change | Native alternative-minus-baseline percentage | Percent; undefined where the native reference cannot supply it |

For land-cover alternatives, the native comparison pairs the alternative with baseline land cover under that same sampled parameter profile. Parameter cases instead compare sampled baseline land cover with the original reference profile. The report keeps these native pairing meanings. Annual mass outputs are not intake concentrations and do not establish drinking-water compliance.

Missing, failed, pending and unmaterialized cases remain explicit. A missing pollutant or undefined percentage stays missing. A completed subset is not claimed to retain full Latin-hypercube balance. Every support/version group's exclusions include samples belonging to another support or producing-version cohort. Therefore each panel can be read without losing the original expected denominator.

Repeated sampled positions have their original design multiplicity, but the report separately gives distinct native-profile counts. Repeated use of one deterministic native output is not independent experimental replication.

## Relationships and interaction diagnostics

Pearson correlation describes a linear relationship in the physical parameter values. Spearman uses average ranks for ties and describes a monotonic relationship. Partial rank correlation residualizes each input's ranks and the outcome ranks against an intercept and every other sampled axis. Constant values, insufficient residual degrees of freedom and deficient control rank are reported as unavailable. The code does not silently drop controls to force a coefficient.

The response surface uses z = 2u - 1, where u is the saved marginal coordinate. For uniform parameters this is a fixed linear coding of their sourced interval; for log-uniform parameters it is a fixed linear coding of log(parameter). The additive quadratic includes the intercept, every main effect and every squared term. The full quadratic adds every pair product. This keeps both main effects and curvature present when considering interactions.

The report supplies full-rank and residual-degree checks, condition number, leverage, training R², adjusted R², residual RMSE and the incremental training R² gained by pair products. These are response-surface diagnostics, not variance-based Sobol indices. No stepwise significance selection is applied.

Prediction diagnostics hold out all sample positions sharing one native profile together, refit on the other profiles and predict the withheld values. If any holdout loses rank, the incomplete prediction count and unavailable profile IDs remain explicit. Q² can be negative; that accurately indicates worse held-out squared prediction error than the observed-mean denominator. An apparently strong in-sample fit should not override poor held-out behaviour.

There is no pure observation-error estimate for these deterministic runs, so no formal replicated lack-of-fit test is claimed. Correlations and fitted coefficients describe the selected model, ranges, source choices and actual completed support; they do not prove causality.

## What uncertainty statements are justified

The output distribution is the empirical distribution of the retained sampled native responses. Its min/max and linearly interpolated empirical quantiles describe those responses. They are not confidence limits, observed environmental distributions or calibrated model uncertainty.

A single ordinary Latin hypercube is not a collection of IID rows. The report therefore supplies neither a naive IID bootstrap interval nor regression p-values. Independent seeds remain separate. Their descriptive variation can inform whether another source-explicit design is useful, but is not environmental, measurement or calibration confidence.

## Complete delivered files

The existing report saves these additional files and includes their complete bytes in its standalone HTML download links:

- study-joint-parameter-analysis.json: the complete definition binding, source axes, native sample observations, support-specific exclusions, diagnostics and method references.
- study-joint-parameter-samples.csv: every retained sample/scenario/pollutant/outcome, including missing states, values, units, exact support, producing-version cohort and original run IDs.
- study-joint-parameter-relations.csv: all matched Pearson, rank and partial-rank relationships with unavailable reasons and original group counts.
- study-joint-parameter-surface.csv: all available hierarchical surface terms with native units and source group IDs.

The full JSON also preserves separate replicate comparisons. CSV text cells are escaped to prevent formula execution; numeric model values remain numeric.

## Receiving and actual visual use

Follow the project's current AGENTS.md and CURRENT_OWNER_DIRECTION.md. Open and use the exact produced report at presentation width and narrow width; actually look at the rendered result. Expand representative complete, incomplete and rank-deficient panels that occur in the actual case, operate the existing report controls, download all four new files and reopen the standalone HTML without its original server. Inspect the real attachment contents, source references, units, missing cases and named native runs. Fix clipped or unreadable output before calling the deliverable ready.

Source review or parser success is not a native result and is not rendered acceptance. Do not generate an invented completed case for a customer demonstration. Retain the actual scientific model output, downloaded files and observed native state from the original operation. Keep source/native/rendered states distinct in the handoff.

## Primary methods references

- SciPy LatinHypercube documentation: https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.qmc.LatinHypercube.html . Defines marginal stratification and the actual scramble, strength, optimization and random generator options; documents the distinction between plain and optimized designs.
- Sandia National Laboratories, Dakota 6.13 User's Manual, section 5.2 (printed page 79; PDF page 77): https://www.sandia.gov/app/uploads/sites/241/2023/03/Users-6.13.0.pdf#page=77 . Describes Pearson, partial, rank and partial-rank relationships. This application uses its own explicitly retained SciPy sample design; it does not claim Dakota's restricted-pairing sampler.
- NIST/SEMATECH, Response surface model example: https://www.itl.nist.gov/div898/handbook/pri/section4/pri473.htm . Explains hierarchical quadratic model terms and the role of residual/predictive checks; its replicated experimental p-values are not imported into this deterministic study.

Implementation choices such as whole-profile holdout, exact support separation and conservative incomplete-design reporting are explicit project decisions, not claims that the cited software executed this study.

## Focused numerical and attribution checks

Before the original scientific course, the accepting native owner can run this source tool from the complete current application:

```sh
python -B source_tools/check_joint_parameter_analysis.py --output /absolute/owned-receiving/joint-analysis-check.json
```

Use the same actual installed Python/NumPy environment selected for receiving. The output path must be outside the application and all scientific workspaces. The receipt is immutable and binds the exact analysis/check source hashes plus actual Python and NumPy versions; use a new owned receipt path for a changed source or environment.

The tool checks an explicitly authored polynomial with known coefficients and independent whole-profile predictions; tied ranks, constant/dependent inputs and insufficient residual degrees of freedom; negative predictive Q-squared; and a duplicate-profile case where row-wise holdout would incorrectly leak the held-out native profile. Its separate authored bookkeeping cases verify exact support, replicate, producing-version and observed-versus-requested evidence separation, complete missing-case denominators, retained raw metrics with unavailable provenance, and exact paired-run binding.

These are numerical/source checks, not observed environmental data or simulated native results. The tool opens no scientific Workspace, invokes no native model or sampler, and launches no browser. It does not substitute for the original native experiment, independent full receiving, or actual desktop/narrow report and attachment viewing. Source-only attempts in this producing seat ended before process creation; no successful Python check is claimed until the actual command returns its receipt.
