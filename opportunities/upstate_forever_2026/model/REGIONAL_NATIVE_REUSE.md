# Reuse completed native stages in regional baselines and alternatives

The regional drivers accept original native run IDs from the same retained workspace. This joins completed nutrient and sediment stages through the normal `Workspace.run` API, so a combined run can reuse a completed NDR stage while executing the SDR work that is still needed. The current seven-family delivery continues to consume ordinary completed combined runs.

## Receiving source

Use the current selected-model/cache application and the native input reuse source published at:

https://chatgpt.com/space/page_edd9f57caf748191bea76513baecd59b

The cumulative regional source bank includes the maintained `stage_cache.recover` extension, `NativeInputMatcher`, and the optional `reuse_source_run_ids` passthrough in `Workspace.run` and `native.execute_run`, composed over the current 70CB r3 native source. The provider Page above records the component's source lineage and current complete native postimages. Use the full joined source from this regional bank when installing the combined application; its Workspace also preserves regional review, run combination, grid recovery and aligned raster masks.

Install the accompanying `model/regional_job.py` and `model/regional_scenarios.py` together. They extend 7F24's current selected-summary drivers and preserve the complete `model/scenario_summary.py` at SHA256 `e161b0a41a5a57d1acba194b07baaf4234106f418ce1394418e05624edb2cd5b`.

## Baseline plan

The optional top-level `reuse_source_run_ids` field in an `upstate.regional-core-plan/v1` document is a JSON list of original 64-character run IDs. IDs are validated, duplicates are removed while preserving candidate order, and the original plan bytes are retained with the operation. The receiving scientific grid, profile and run continue to use their existing identity rules.

To derive the IDs from actual completed regional core results and add them to an existing combined core plan:

```python
import json
from pathlib import Path

plan_path = Path("combined-core-plan.json")
plan = json.loads(plan_path.read_bytes())
completed = [
    json.loads(Path("completed-ndr-core-result.json").read_bytes()),
    json.loads(Path("completed-sdr-core-result.json").read_bytes()),
]
if len({item["workspace_id"] for item in completed}) != 1:
    raise ValueError("Select completed cores from the same retained workspace")
plan["reuse_source_run_ids"] = [item["baseline_run_id"] for item in completed]
Path("combined-core-with-reuse.json").write_text(
    json.dumps(plan, indent=2) + "\n", encoding="utf-8")
```

Use the resulting plan with the existing command:

```sh
/opt/pyvenv/bin/python -B -m model.regional_job run --workspace "$UPSTATE_MODEL_WORKSPACE" --plan combined-core-with-reuse.json --source-reference "$UPSTATE_SOURCE_REF" --output combined-core-result.json
```

The combined source manifest still selects the actual physical inputs required by both models. The native input matcher compares each candidate against the receiving run's actual physical grid, model inputs, scenario land cover, relevant parameters and biophysical values, and pinned runtime. Different partial-model grid or profile IDs can be scientifically compatible; their original identities remain recorded. A candidate that does not match becomes a retained reuse observation and the normal native execution computes that model.

## Scenario plan

Each named land-cover alternative in an `upstate.regional-scenarios-plan/v1` document can carry its own optional `reuse_source_run_ids` list. Keep the actual mask patches and source aliases unchanged. The driver removes the donor field before saving the scientific scenario, preserving its existing scenario identity.

To add the matching completed NDR and SDR alternatives to an existing scenario plan:

```python
import json
from pathlib import Path

plan = json.loads(Path("regional-scenarios-plan.json").read_bytes())
completed = [
    json.loads(Path("completed-ndr-scenarios-result.json").read_bytes()),
    json.loads(Path("completed-sdr-scenarios-result.json").read_bytes()),
]
if len({item["workspace_id"] for item in completed}) != 1:
    raise ValueError("Select scenario results from the same retained workspace")
for name, scenario in plan["scenarios"].items():
    scenario["reuse_source_run_ids"] = [
        item["scenario_runs"][name] for item in completed
        if name in item["scenario_runs"]
    ]
Path("regional-scenarios-with-reuse.json").write_text(
    json.dumps(plan, indent=2) + "\n", encoding="utf-8")
```

Execute with the retained combined baseline:

```sh
/opt/pyvenv/bin/python -B -m model.regional_scenarios --core-result combined-core-result.json --plan regional-scenarios-with-reuse.json --output combined-scenarios-result.json
```

Each alternative still completes on the retained baseline grid and profile before the paired comparison and annual quantity tables are written.

## Interruption and provenance

Omitting `reuse_source_run_ids` continues the ordinary run API, which retains any donor choices already stored in an unfinished `run.json`. An explicit empty list clears those candidate choices for unfinished work. Completed runs keep their completed results.

Core, scenario and finished-delivery result summaries retain each native stage's original runtime, input signature and `reused_from` lineage, including the original `run_id`, scientific input equivalence and earlier reuse chain. Results also retain the stored candidate choices and reuse observations. Reopening a completed operation reads that persisted lineage, so the summary does not depend on whether the current process performed the original native stage or resumed it.

The selected-model annual JSON, CSV and Markdown summaries remain beside the original operation result. The driver returns `summary_directory` for those tables. The combined core and alternative run IDs feed the existing `model.regional_job finish` and regional delivery route.
