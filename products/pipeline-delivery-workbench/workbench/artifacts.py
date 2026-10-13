"""Read original dbt artifacts without converting missing executions to success."""
from __future__ import annotations
import json
from pathlib import Path
from common import Problem, packed, sha

ARTIFACT_NAMES = {"manifest.json", "run_results.json", "sources.json", "catalog.json", "semantic_manifest.json", "freshness.json"}

def load_artifacts(directory):
    out = {}
    directory = Path(directory)
    for name in sorted(ARTIFACT_NAMES):
        p = directory / name
        if p.is_file():
            raw = p.read_bytes()
            try: value = json.loads(raw)
            except (ValueError, UnicodeError) as exc:
                raise Problem("native_artifact_invalid", "Native " + name + " is not valid JSON", 409) from exc
            if not isinstance(value, dict):
                raise Problem("native_artifact_invalid", "Native " + name + " must be an object", 409)
            out[name] = {"sha256": sha(raw), "bytes": len(raw), "value": value}
    return out

def inspect_manifest(manifest):
    if not isinstance(manifest, dict):
        raise Problem("manifest_missing", "This native operation did not produce a manifest", 409)
    rows = []
    for section in ("nodes", "sources", "exposures", "metrics", "semantic_models"):
        values = manifest.get(section, {})
        if not isinstance(values, dict): continue
        for uid, item in values.items():
            if not isinstance(item, dict): continue
            columns = item.get("columns") if isinstance(item.get("columns"), dict) else {}
            cfg = item.get("config") if isinstance(item.get("config"), dict) else {}
            rows.append({
                "unique_id": uid, "section": section, "name": item.get("name"),
                "resource_type": item.get("resource_type"), "package_name": item.get("package_name"),
                "original_file_path": item.get("original_file_path"), "relation_name": item.get("relation_name"),
                "description": item.get("description"), "depends_on": item.get("depends_on", {}),
                "columns": columns, "config": cfg, "meta": item.get("meta", {}),
                "tags": item.get("tags", []), "raw_code": item.get("raw_code"),
                "compiled_code": item.get("compiled_code"), "checksum": item.get("checksum"),
            })
    return {"metadata": manifest.get("metadata", {}), "nodes": sorted(rows, key=lambda x: x["unique_id"]),
            "parent_map": manifest.get("parent_map", {}), "child_map": manifest.get("child_map", {})}

def evaluate(artifacts, contract):
    results, by_id, freshness = [], {}, []
    run = artifacts.get("run_results.json", {}).get("value", {})
    for raw in run.get("results", []):
        if not isinstance(raw, dict): continue
        row = {"unique_id": raw.get("unique_id"), "status": raw.get("status"),
               "message": raw.get("message"), "failures": raw.get("failures"),
               "execution_time": raw.get("execution_time"), "timing": raw.get("timing", []),
               "adapter_response": raw.get("adapter_response", {}), "raw": raw}
        results.append(row)
        if isinstance(row["unique_id"], str): by_id[row["unique_id"]] = row
    for name in ("freshness.json", "sources.json"):
        data = artifacts.get(name, {}).get("value", {})
        for raw in data.get("results", []):
            if isinstance(raw, dict):
                freshness.append({"artifact": name, "unique_id": raw.get("unique_id"),
                                  "status": raw.get("status"), "raw": raw})
    criteria = []
    for item in contract.get("expectations", []):
        uid = item["unique_id"]
        result = by_id.get(uid)
        if result is None:
            matches = [x for x in freshness if x.get("unique_id") == uid]
            result = matches[0] if matches else None
        status = result.get("status") if result else None
        criteria.append({"unique_id": uid, "label": item.get("label", uid),
                         "accepted_statuses": item["accepted_statuses"],
                         "required": item.get("required", True),
                         "observed_status": status, "executed": result is not None,
                         "passed": result is not None and status in item["accepted_statuses"]})
    required = [x for x in criteria if x["required"]]
    return {"results": results, "freshness": freshness, "criteria": criteria,
            "criteria_satisfied": all(x["passed"] for x in required),
            "manifest": inspect_manifest(artifacts["manifest.json"]["value"]) if "manifest.json" in artifacts else None,
            "native_metadata": {name: entry["value"].get("metadata", {}) for name, entry in artifacts.items()},
            "artifact_files": [{"path": name, "bytes": entry["bytes"], "sha256": entry["sha256"]} for name, entry in artifacts.items()]}

def compare_manifests(before, after):
    a = {x["unique_id"]: x for x in inspect_manifest(before)["nodes"]}
    b = {x["unique_id"]: x for x in inspect_manifest(after)["nodes"]}
    changes = []
    for uid in sorted(a.keys() | b.keys()):
        av, bv = a.get(uid), b.get(uid)
        if av == bv: continue
        fields = sorted(k for k in set(av or {}) | set(bv or {}) if (av or {}).get(k) != (bv or {}).get(k))
        changes.append({"unique_id": uid, "kind": "added" if av is None else "removed" if bv is None else "changed",
                        "changed_fields": fields, "before": av, "after": bv})
    downstream = set()
    children = after.get("child_map", {})
    pending = [x["unique_id"] for x in changes]
    while pending:
        uid = pending.pop()
        for child in children.get(uid, []):
            if child not in downstream:
                downstream.add(child); pending.append(child)
    return {"changes": changes, "downstream_unique_ids": sorted(downstream),
            "before_metadata": before.get("metadata", {}), "after_metadata": after.get("metadata", {})}
