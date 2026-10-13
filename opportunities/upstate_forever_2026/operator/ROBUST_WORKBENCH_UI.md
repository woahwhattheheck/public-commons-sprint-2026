# Decision studies in the native operator

Open **Decision studies** in the original scientific operator. This view uses the retained OPT12 decision engine, the operator's existing task queue, and the selected portable workspace.

## Prepare from an experiment

1. Choose a retained native experiment and click **Configure native experiment**. The original experiment plan supplies its actual scenario and profile IDs, including pending cases. The retained summary supplies metric units and paired results; saving validates the complete requested candidate-by-profile matrix.
2. Enter **Cost units**, candidate costs and capacity use, and each metric's fixed scale and decision weight. Zero is a valid declared cost, capacity use or weight; an empty required field remains incomplete.
3. Set any budget or capacity ceiling, required/excluded package, guaranteed metric gain, or profile probability needed for the decision. Advanced configuration supports membership and group limits.
4. Click **Save native decision study**. The original receiver constructs the candidate-by-profile outcome matrix from the retained experiment summary. Open **Original input matrix and source references** to inspect the baseline and alternative run IDs.
5. Edit decision preferences and save a new revision as needed. The saved revision selector reopens an earlier input set and its corresponding calculation history.

Native package studies choose one complete modeled scenario. Effects from separately modeled scenarios are not added together. An additive-action study is a different original engine mode and requires its explicit decomposition basis when received.

Costs, metric scales and weights express the operator's decision preferences. Metric outcomes retain the units and paired results of the original model runs. A guaranteed gain applies in every included profile; the calculation reports its constraint margins.

## Calculate and compare

Save changed inputs before calculating. Choose the objective:

| Objective | Decision rule |
| --- | --- |
| Maximize worst-profile score | Choose the feasible package with the highest minimum score over included profiles. |
| Minimize maximum regret | Compare each package with each profile's best feasible plan under the same constraints, then minimize the largest regret. |
| Maximize expected score | Use explicitly supplied profile probabilities to maximize expected score. |

The native score uses declared weight times physical gain divided by its fixed scale. A lower export represents a positive gain. Budget frontiers repeat the original decision problem at the entered budget ceilings.

The result displays the exact study revision, selected package, physical outcomes in each profile, constraint margins, profile-specific best plans and native solver status. If the declared constraints are infeasible, the native diagnostic explains the conflict; any relaxed-target comparison remains separately labeled.

**Decision operations** follows the original queue. Open a task to inspect progress, or resume the same failed/interrupted operation. Repeating an unchanged completed calculation reopens its retained operation and run. A new study revision creates a different calculation identity.

## Reopen and deliver

The current result can export an HTML report, outcome CSV and implementation selection. **Export complete project** retains saved input revisions, calculation history and native import provenance. After an export completes, another explicit project export creates a fresh snapshot, including later revisions and calculations.

Downloads appear on the corresponding original task. **Saved study exports** contains retained exports across all revisions, with the native dated labels. A restored workspace can expose these saved files even when the original operator's external task queue is absent.

Receive a complete project through **Import study or project**. The native receiver creates an independent study identity while preserving the input revisions and completed calculation answers. Select the received study and reopen its history to review those results.

Working changes are also retained in browser drafts scoped to the selected workspace. Save a revision to retain them in the portable scientific workspace.

## Operate the real browser journey

Install the compatible provider/descriptor, this interface, and the original native engine in the cumulative application. Use the exact private URL printed by the original operator; keep that URL in a local file.

    node source/run_robust_workbench_browser.mjs \
      --url-file PRIVATE_URL_FILE \
      --experiment RETAINED_EXPERIMENT_ID \
      --configuration DECISION_CONFIG_JSON \
      --workspace OPERATOR_WORKSPACE_KEY \
      --output OUTPUT_DIRECTORY \
      --video

The workspace argument is the original operator registration key, not the project's internal ID. Omit it to search the available workspace choices for the requested experiment.

The JSON configuration uses the actual IDs supplied by that retained experiment:

- cost_units: explicit decision cost unit.
- metrics: selected retained IDs with numeric scale and weight; optional guaranteed_gain.
- candidates: selected scenario IDs with numeric cost and capacity; optional group, required, excluded.
- profiles: selected native profile IDs; optional explicit probability.
- Optional title, budget, capacity, group_limits and notes.

The driver accepts finite numeric values, preserves actual native labels and units, and rejects supplied outcome cells. It operates the visible configuration form, saves the native study, exports an initial snapshot, saves a revision, calculates, retries the same completed operation, downloads native reports and a later project, then receives and reopens that project. The configured constraints must permit a selection for the full implementation-selection journey; the actual native diagnostic and reports are retained if the decision is infeasible.

Output includes original exported bytes with SHA-256 values, focused screenshots, a full workspace screenshot, optional video and journey.json with actual study, task, revision and run identities. The private operator URL and capability are redacted from the report. Native execution is performed on the equipped receiver; source syntax checking alone does not produce these artifacts.
