# Run saved experiments through native programmes

This workflow uses the existing experiment planner, native programme coordinator and retained Workspace. An experiment owns its parameter design and each scientifically matched baseline. The programme executes those exact native selections; completion then fills the experiment's paired results and summary.

For Tim: choose the saved experiment, save its complete run programme, continue the unfinished runs, then open the experiment to compare each land-cover alternative with its matching baseline.

## Operator path

1. Open **Run programmes** and choose **Use saved experiment**.
2. In **Create programme from a saved experiment**, choose the **Saved experiment**. The preview shows the first 100 cases plus the full profile and case counts. The saved programme contains the complete design.
3. Choose **Save complete programme**. The original queue action is `compute.programme.experiment` with `experiment_id`. Preparation retains missing profiles and native run selections through the experiment's public streaming iterator.
4. Open the saved item using **Saved programmes → Open** or the task's **Open run programme** action.
5. Choose **Continue unfinished runs**. A completed item shows **Reconcile saved runs**. Existing verified native results are reused. Check individual cases and choose **Run selected cases** when selecting part of the programme; its reference dependency is included.
6. Use **Inspect run** or **Log** for the selected native case. **Pause after current run** stops the coordinator at its next supported boundary.
7. When all programme cases and comparisons are complete, the original operator calls the experiment synchronizer after the programme has released its native execution locks. The returned `experiment_sync` names the saved experiment and its current paired-result progress.
8. Open that saved experiment to read the matched effects, sensitivity ranges and retained result files. In the programme, **Build result catalogue → Open saved catalogue** produces the programme's own catalogue.

The programme's comparison baseline is its original reference case. The experiment preserves each land-cover case's baseline under that same parameter profile. Parameter cases compare the original land cover under a selected profile with the original reference profile. These two result views describe different comparisons; the pairing fields identify which comparison produced each effect.

## What the selections mean

| Selection | Meaning |
| --- | --- |
| Saved experiment | An existing retained design, including its actual baseline run, alternative scenarios, retained profiles and source-referenced parameter axes. |
| Case key | The experiment's stable case ID, retained as the programme run key. |
| Parameter profile | The exact retained profile for that case, including its table edition and derivation. |
| Land-cover case | The retained original baseline or one explicit alternative scenario. |
| Selected native models | The same model families as the experiment's actual reference run. NDR, SDR and combined selections retain their original native identities. |
| Reference case | The original baseline run in the saved experiment. Every programme includes it. |
| Paired baseline | For a land-cover alternative, the baseline scenario under the same profile and model families. Its native run is included in the programme. |
| Source or experiment reference | A retained experiment programme uses `upstate.experiment:<experiment_id>`, allowing completed native work to return to its exact experiment. |
| Run selected cases | Execute the selected named programme cases plus their reference dependency. Completing a subset retains its results; the full experiment synchronizes after every required native pair is complete. |

The interface previews with `POST /api/programmes/experiment-preview` and saves with the existing serial queue. Arbitrary case offsets use the engine's direct index. Reading a deep preview does not derive preceding parameter profiles.

## Command-line operation

Run these commands from the maintained application root. Use the existing Workspace path and actual IDs returned by the preceding command.

### Prepare a programme from a saved experiment

```sh
/opt/pyvenv/bin/python -B -m model.experiment_cli --workspace /mnt/data/eco12-run/receiving programme EXPERIMENT_ID
```

The result contains `programme_id`, the original experiment ID, native run bindings, current states and `experiment_pairing`. The pairing location is `selection.runs[].changes.pairing`.

### Execute or resume that programme

```sh
/opt/pyvenv/bin/python -B -m model.compute_programme_cli --workspace /mnt/data/eco12-run/receiving execute PROGRAMME_ID
/opt/pyvenv/bin/python -B -m model.compute_programme_cli --workspace /mnt/data/eco12-run/receiving resume PROGRAMME_ID
```

Both commands synchronize completed experiment programmes after the coordinator returns and releases its locks. The result's `experiment_sync` contains `experiment_id`, `state`, `progress`, and completion/update timestamps. Programmes with other source references follow their usual execution and reporting flow.

The programme CLI returns zero on complete success, two when execute/resume returns an unfinished programme, and one for a reported error. Native run outputs and coordinator progress remain retained for the next invocation.

### Synchronize native runs completed elsewhere

```sh
/opt/pyvenv/bin/python -B -m model.experiment_cli --workspace /mnt/data/eco12-run/receiving sync EXPERIMENT_ID
```

This calls `experiments.execute(workspace, experiment_id, completed_only=True)`. It collects retained completed native outputs, calculates the actual matched comparisons and writes the experiment summary. It never starts an unfinished native model. If required cases are still unfinished, available independent results are saved and the command returns an error identifying the remaining work. The programme callback first checks that every required native run and paired baseline is complete.

A normal `experiment_cli run EXPERIMENT_ID` executes unfinished native cases and then collects results. `experiment_cli summary EXPERIMENT_ID` refreshes the summary from retained experiment case records. The explicit `sync` command brings completed external native runs into those records.

### Inspect and export the result

```sh
/opt/pyvenv/bin/python -B -m model.experiment_cli --workspace /mnt/data/eco12-run/receiving inspect EXPERIMENT_ID --offset 0 --limit 100
/opt/pyvenv/bin/python -B -m model.experiment_cli --workspace /mnt/data/eco12-run/receiving summary EXPERIMENT_ID
```

The experiment retains `experiments/<id>/summary.json` and `results.csv`. Completed land-cover rows expose the same four-key pair mapping used by the ensemble and portfolio consumers:

```json
{
  "profile_id": "ACTUAL_PROFILE_ID",
  "baseline_run_id": "ACTUAL_BASELINE_RUN_ID",
  "alternative_run_id": "ACTUAL_ALTERNATIVE_RUN_ID",
  "scenario_id": "ACTUAL_ALTERNATIVE_SCENARIO_ID"
}
```

The machine-facing template above describes field meanings. Actual calls return the existing content IDs from the Workspace.

## Interruption, source changes and portable continuation

Programme creation consumes `materialize_cases` as a streaming iterator. Each yielded case retains its profile and native run under the existing experiment lock; there is no outer lock around the whole iterator. Repeating creation reuses these retained selections and reaches the same programme identity when its scientific source and inputs match.

The complete programme selection is the coordinator's existing explicit run list. It contains all requested cases. The iterator avoids retaining a second parameter matrix or deriving skipped profiles for paginated previews; the saved programme still represents its full selected run list.

Execution and synchronization use the original native batch lock. The programme callback runs after the programme releases it, so the experiment can take that lock to collect matched results. A busy lock reports the existing action error and leaves retained progress available for the next invocation.

A changed scientific helper can change the programme's source identity. Prepare the saved experiment's programme again with `experiment_cli programme EXPERIMENT_ID` or **Use saved experiment**. The coordinator records the current source while preserving the original native case IDs, allowing completed compatible runs to be reused.

Workspace portable archives include experiment plans, case records, summaries, programme selections/progress, profiles, scenarios, native runs and their retained sources. Reopen the restored Workspace, inspect the saved experiment or programme, and resume through the same actions. Native output availability and current source bindings are checked by the maintained coordinator and runner.

## Older partial-model experiments

An earlier planner could retain a partial native reference while omitting model families from generated run selections. The shared engine reads the actual original reference and restores those native bindings. It preserves the original experiment plan bytes, experiment ID and case IDs. The previous case record remains under `previous_case`; corrected selections retain `source_run_id`, `source_baseline_run_id` and `source_selection`.

Recovery visits only already retained case ordinals through the direct index. A sparse, large factorial design does not expand its unmaterialized cases during recovery. Newly materialized cases then use the corrected native model families.

If a previously complete case now needs the corrected native pair, its current state becomes pending and its programme/experiment can continue. Old-model summaries remain on disk as prior artifacts. Current summary reads return a result after the correct binding has been summarized; a recovered incomplete design is shown as prepared, partial or failed according to its actual case progress.

## Implementation and source lineage

The maintained APIs are:

- `experiments.expanded_cases(workspace, experiment_id, offset=0, limit=100)`: read a direct indexed page.
- `experiments.materialize_cases(workspace, experiment_id, offset=0, limit=None)`: yield prepared native cases while preserving completed results.
- `experiments.execute(workspace, experiment_id, *, completed_only=False)`: run or synchronize cases through the existing native lock and paired-result path.
- `programme_experiments.preview(workspace, experiment_id, offset=0, limit=100)`: programme preview using the public case page.
- `programme_experiments.create(workspace, experiment_id)`: save the complete programme through the public materializer.
- `programme_experiments.sync_completed(workspace, programme)`: verify every required completed native pair, then save actual experiment metrics.

Source joins retain A73C's current programme and selected-model engine work:

- [Current programme core and CLI](https://github.com/woahwhattheheck/public-commons-sprint-2026/tree/ac228f779116925302469b1961d455c10f7d7e16/opportunities/upstate_forever_2026/model)
- [Current programme interface](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/ac228f779116925302469b1961d455c10f7d7e16/opportunities/upstate_forever_2026/operator/web/programmes.mjs)
- [A73C current experiment engine source](https://api.github.com/repos/woahwhattheheck/public-commons-sprint-2026/git/blobs/9afcb226af371301eb4c15deccee88d0f191ec4f)
- [A73C exact original result-sync source](https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C9JEF77PA)
- [Current conservation portfolio-to-experiment source](https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C8TSYEWH2)

The original programme worker already invokes result synchronization. The joins add public iterator composition, command-line continuation and corrected summary state after old partial-model binding recovery. The same native selections, paired comparisons, units and original source authors remain in the maintained workflow.
