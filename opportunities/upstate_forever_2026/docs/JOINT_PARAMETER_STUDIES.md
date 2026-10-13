# Sourced joint parameter studies

This component adds explicit joint parameter designs to the existing Upper Savannah scientific application. It retains the original profile store, source editions, grids, land-cover scenarios, native InVEST runner, task queue, paired raster comparison, scientific report and portable receiving. The new desk is registered through the existing extension registry.

## Select a scientific question

Choose an original completed baseline. Choose the actual retained land-cover alternatives to compare with it. For every numeric axis provide the exact native parameter path, units, increasing bounds, marginal transformation, source references and a written reason for the range. Several paths may share an axis only when they intentionally receive the same value and have identical units.

Ranges describe the proposed experiment. They are not measured regional distributions or calibrated priors. The interface does not invent ranges or approve scientific choices. Routing is held at the baseline setting. A changed routing algorithm belongs to a separately identified design.

Choose one or more explicit replicate IDs, positive sample counts and distinct nonnegative seeds. Each replicate is its own scrambled, strength-one Latin hypercube. Every marginal contains one sample in each equal-probability stratum; this does not cover every multidimensional combination. Uniform coordinates are transformed either linearly or in log space. There is no optimization step.

The native engine runs the unique sampled profiles and each selected land-cover case. The original unsampled profile remains a native reference, and is excluded from the sampled statistical population. Sample positions that resolve to the same physical profile retain their identities and multiplicities.

## Numeric controls and interpretation boundary

The available axes come directly from the original `model.experiments.supported_axes()` for the baseline's selected model families. This release samples the following ten numeric controls; it retains the baseline routing algorithm.

| Model | Native parameter paths |
| --- | --- |
| NDR | `threshold_flow_accumulation`, `k_param`, `subsurface_critical_length_n`, `subsurface_eff_n`, `runoff_proxy_av` |
| SDR | `threshold_flow_accumulation`, `k_param`, `sdr_max`, `ic_0_param`, `l_max` |

Every path uses its original engine validation and units. An axis for `ndr.runoff_proxy_av` supplies a positive numeric average; a baseline's omitted value still means the original native mean when that control is not sampled. Numeric bounds must be sourced and selected explicitly.

Land-cover table load, retention and C/P coefficient cells, and source R/K raster editions, remain separate retained inputs. A published coefficient family or an observed minimum and maximum does not establish a continuous probability distribution. Compare those actual input editions in explicitly identified strata through their original native courses; do not interpret this numeric-control design as sampling them.

## Existing operator

Open **Joint parameter studies** in the original operator.

1. Select the completed baseline and retained land-cover alternatives.
2. Enter sourced axes and explicit replicate counts/seeds. Use **Import specification** to load a complete existing design specification.
3. Choose **Preview complete design**. Inspect the sample count and requested workload, sampler versions and first rows. Download the complete design to inspect every coordinate and physical value.
4. Choose **Save preview and prepare profiles**. The exact preview definition is retained before the original profile APIs are called.
5. Open the saved study. Choose **Run or resume original native cases** to use the existing experiment runner. Existing case/stage reuse remains authoritative.
6. Choose **Analyze currently completed cases** to summarize retained native output without inventing missing results. Reports identify incomplete designs, failed cases, changed spatial support and unestimable diagnostics.
7. Download the complete standalone report, design, state, native files and analysis CSV/JSON. **Export editable study** uses the original selected-study transfer desk.

Form edits stay in the same browser workspace. A submission retains the complete original request and operation ID before contacting the original queue. **Recover original submitted request** repeats that exact request after an uncertain acknowledgment. A definite rejected validation request can be corrected; unknown outcomes retain their original identity. A browser storage error stops dispatch before a new request is sent. Task completion and scientific completion remain distinct.

The existing Sources, Profiles, Runs, Experiments, Scientific interpretation, report and transfer desks remain available.

## Command line

Run from the original application root with its native Python environment and installed NumPy/SciPy.

    python -m model.joint_parameter_studies --workspace /ABS/WORKSPACE \
      preview /ABS/specification.json --output /ABS/design-preview.json

    python -m model.joint_parameter_studies --workspace /ABS/WORKSPACE \
      prepare /ABS/design-preview.json --output /ABS/prepared-study.json

    python -m model.joint_parameter_studies --workspace /ABS/WORKSPACE \
      run STUDY_ID --output /ABS/native-result.json

    python -m model.joint_parameter_studies --workspace /ABS/WORKSPACE \
      inspect STUDY_ID --output /ABS/current-study.json

    python -m model.study_report --workspace /ABS/WORKSPACE \
      --experiment EXPERIMENT_ID

The final command adds the analysis to the original scientific report. Its source is described in docs/JOINT_PARAMETER_ANALYSIS.md.

A specification has schema upstate.joint-parameter-design/v1 and fields title, reason, baseline_run_id, scenario_ids, axes and replicates. Optional source_run_ids retain explicitly adopted original native sources. Each axis has id, label, paths, distribution, lower, upper, units, reason and references. Each replicate has id, samples and seed. Use exact IDs from the existing scientific workspace and exact units from model.experiments.supported_axes; the native preview rejects unsupported paths or units.

The output of preview contains the whole definition. First preparation regenerates the same preview with the actually installed sampler and rejects any change. Once saved, resumption uses the frozen definition and never redraws it with another software version.

## Retained identity and recovery

The study ID is model.common.digest of the complete definition: canonical UTF-8 JSON, sorted keys, no nonfinite numbers. The definition retains the original baseline run selection, complete profile digest, table digest, grid/model selection, normalized experiment selection, full ordered axes, actual SciPy/NumPy versions and the entire unit-cube/physical sample matrix.

Files are retained under joint-parameter-studies/STUDY_ID. definition.json is immutable. state.json records every original sample-to-profile binding and the exact original experiment ID. Profile preparation is idempotent; a partial preparation can be resumed from the same definition. Changed ranges, coordinates, source bindings or sample identity require another study ID.

The original experiment contains joint-parameter-study.json, binding the study and complete definition digest to the native experiment. Inspection rechecks the complete deterministic profile identity, ordered mapping, exact experiment selection and this pointer. Joint-study locks precede original experiment locks; the portable export uses the same order.

The native engine retains its existing failures and resumable stages. A scientific summary must agree with the actual retained case records before joint analysis. Analysis output is retained by native summary digest and analysis content digest, allowing source editions to coexist without overwriting a prior exact report.

## Interpretation

Analysis groups are separate for each replicate, scenario, pollutant, units and exact paired spatial support. Land-cover effects use the same sampled profile on both sides. Missing or failed runs remain in the expected denominator. A completed subset is explicitly identified as incomplete.

The report provides empirical distributions, Pearson/Spearman relationships and partial-rank relationships when identifiable. A hierarchical quadratic response surface includes all main effects and squares before pair products. It reports rank, residual degrees of freedom, conditioning, leverage and leave-one-native-profile-out prediction. Every repeated occurrence of a profile is withheld together.

These are descriptive diagnostics for the actual native runs and chosen ranges. They are not Sobol indices, causal effects, calibrated uncertainty or environmental confidence. There is no naive independent-row bootstrap or regression p-value. Independent seed results remain separate; an empirical quantile is not a confidence bound.

The original SciPy method reference is https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.qmc.LatinHypercube.html . Detailed primary statistical sources and interpretation are retained in docs/JOINT_PARAMETER_ANALYSIS.md.

## Complete receiving and visual acceptance

Use the existing portable/selected-study export and receiving procedures. Retain the full application, definition, profile mapping, original inputs, native runs, experiment records and complete report downloads. Reopen the received study in a separate workspace and verify its original IDs, complete coordinates, profile bindings, source bytes and analysis groups. Receiving must not launch another scientific experiment merely to prove that saved output exists.

Before calling a delivered result ready, open the actual produced operator and reports at desktop and narrow widths. Inspect every source and result attachment that will accompany delivery. Use the actual controls, expand outcome groups, download the whole design and CSV/JSON files, open the standalone report without the producing server, and compare the independent received workspace. Look at the rendered outputs and correct clipping or unreadable content.

Source review, Python syntax and a synthetic numerical diagnostic do not establish a completed native scientific case or rendered acceptance. Keep those evidence states separate. Original teaching, regional and 38F0 results remain historical accepted evidence; this joint design only becomes a native result after its own actual original-engine execution.

## Complete native and independent receiving companion

The maintained whole-course command uses the exact authored specification, original workspace and current complete application:

    python source_tools/receive_joint_parameter_study.py \
      --workspace /ABS/ORIGINAL_WORKSPACE \
      --specification /ABS/SOURCED_SPECIFICATION.json \
      --output /ABS/OWNED_JOINT_RECEIVING

It freezes the source/specification binding, retains the whole preview before profile preparation, continues the original experiment, renders the existing scientific report, exports the complete selected-study closure and independently restores it. It compares the entire frozen definition, sample/profile mapping and recomputed descriptive analysis using only the received native output. A completed native result is reused on continuation. The final native state explicitly leaves visual acceptance pending until the actual operator/report has been viewed and used at desktop and narrow widths.

For an already-retained study on a received or relocated workspace, add --resume-study STUDY_ID. The companion validates the same normalized specification and adopts the saved definition directly, preserving its sampler versions and original coordinates. A new operation output can then verify/export the completed native case without drawing another design or running completed cases again.

## Actual operator and attachment receiving

After the native companion reaches NATIVE_AND_RECEIVING_COMPLETE, launch the original operator against the producing workspace and the separately received application/workspace. Keep both private loopback URLs and capability tokens in an owner-only configuration file. The complete browser course accepts:

    {
      "producer": {"url": "http://127.0.0.1:PRODUCER_PORT/#token=PRIVATE", "workspace": "ORIGINAL_KEY"},
      "receiver": {"url": "http://127.0.0.1:RECEIVER_PORT/#token=PRIVATE", "workspace": "RECEIVED_KEY"},
      "studyId": "COMPLETE_STUDY_ID",
      "nativeResultFile": "/ABS/OWNED_JOINT_RECEIVING/operation.json",
      "outputDirectory": "/ABS/OWNED_JOINT_BROWSER",
      "playwrightModule": "/ABS/EXISTING_PLAYWRIGHT_OR_RUNTIME_WRAPPER.mjs",
      "chromium": "/ABS/EXISTING_CHROMIUM",
      "chromiumArgs": [],
      "environment": {}
    }

Use the already installed, observed runtime and its required private font/library environment. Then invoke:

    node source_tools/receive_joint_parameter_browser.mjs /ABS/PRIVATE_BROWSER_CONFIG.json

The course uses the existing authenticated desk and its real controls, retains and reloads a draft, imports/downloads the complete specification and frozen preview, downloads every original report attachment, opens the original HTML and full text readers, and downloads matching files through the independent received operator. It checks desktop and 390-pixel page widths, records each actual screenshot and browser error, and closes Chromium before recording completion. It does not submit another scientific task.

Each attempt preserves its complete result, files and viewing gallery. COMPLETE means the automated course returned and the browser closed; visualInspection stays AWAITING_ACTUAL_VIEWER until someone opens the actual screenshots/reports and checks their readability. Attachments requiring a specialized renderer remain explicitly listed. Keep private connection configuration separate from the source or public delivery.

## Complete application source selection

Use the complete application checkout at the selected release commit, then restore the original scientific case with its own retained input and result identities. The shared report and portable modules depend on the other maintained components in that checkout. The native receiving command binds the digest of every application member selected by the original portable inventory before preparing any profile; preserve that full source directory for every continuation. Keep the original case archive and its accepted native outputs as a separate input.

The browser may run after the saved design's SciPy or NumPy edition changes. It retains both the original saved definition and the complete current unsaved preview, requires the same scientific specification/baseline/native selection, and requires exact coordinates whenever the sampler descriptor is unchanged. A new sampler preview is identified as an unsaved candidate and never replaces or executes the original study.
