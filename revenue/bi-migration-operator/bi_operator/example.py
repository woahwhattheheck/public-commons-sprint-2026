"""Install the full, explicitly sourced public SANDAG migration example."""
import base64
import json
from pathlib import Path

EXAMPLE = Path(__file__).resolve().parents[1] / "examples" / "sandag"


def load_example(service, build=False):
    def call(action, label, request):
        return service.dispatch(action, {**request, "operation_id": "sandag-public-v1-" + label})["record"]

    def source_file(path):
        return {"filename": path.name, "base64": base64.b64encode(path.read_bytes()).decode()}

    source_info = json.loads((EXAMPLE / "SOURCE.json").read_text())
    source = call("source.import", "source", {**source_file(EXAMPLE / "SANDAG_Public_Aggregates.xml"),
        "label": "SANDAG published aggregate working example", "owner": "Migration operator",
        "source_system": "Commons-authored specification for published SANDAG aggregates",
        "business_use": source_info["data_scope"] + " " + source_info["specification_origin"]})
    datasets = {}
    for item in source_info["datasets"]:
        datasets[item["table"]] = call("dataset.import", "dataset-" + item["table"],
            {**source_file(EXAMPLE / item["file"]), "label": "SANDAG · " + item["table"], "null_token": "\\N",
             "scope": source_info["normalization"], "source_url": source_info["url"],
             "description": source_info["data_scope"]})
    baseline = call("dataset.import", "baseline", {**source_file(EXAMPLE / "expected-native-rows.csv"),
        "label": "SANDAG · exact native-query baseline", "null_token": "\\N", "source_url": source_info["url"],
        "scope": "All 5,037 original offense cells, including unlabeled rows and nonreported values; native query aliases in capture-query.dax."})
    plan = call("plan.create", "initial-plan", {"source_id": source["id"]})
    project = json.loads((EXAMPLE / "reviewed-project.json").read_text())
    plan_payload = {**plan["payload"], "project": project, "bindings": {
        table: {"kind": "csv", "digest": dataset["payload"]["file"]["digest"], "null_token": "\\N", "culture": "en-US"}
        for table, dataset in datasets.items()},
        "scope": "Published 2021, 2023 and 2024 aggregate offense cells; Group A and arrest-based Group B remain separate. "
                 "Regional totals include Sheriff-Total once; published summary controls remain separate from detailed source tables.",
        "notes": "SOURCE.json, counting-basis.json and footnotes.json define scope. The authored demonstration specification is not a production agency Cognos export. "
                 "Use capture-query.dax against the refreshed native model and native-comparison.json against the retained query baseline.",
        "review_decisions": [{"index": index, "code": flag["code"], "decision": flag["message"]}
                             for index, flag in enumerate(project["review_flags"])]}
    plan = call("plan.save", "reviewed-plan", {"id": plan["id"], "expected": plan["revision"], "plan": plan_payload})
    artifact = call("artifact.build", "native-build", {"plan_id": plan["id"], "plan_revision": plan["revision"]}) if build else None
    return {"source": service.reference(source), "datasets": {name: service.reference(item) for name, item in datasets.items()},
            "baseline": service.reference(baseline), "plan": service.reference(plan),
            "artifact": service.reference(artifact) if artifact else None, "record": artifact or plan}
