"""Bind six published pasture loading treatments to the original management-case API.

The operator selects an actual retained profile and pasture class. All six
published N/P pairs remain coupled. This entrypoint never runs native models.
"""
from __future__ import annotations
import argparse
import csv
import io
import json
import os
from pathlib import Path
import sys

APP = Path(__file__).resolve().parents[1]
if str(APP) not in sys.path:
    sys.path.insert(0, str(APP))
from model.common import atomic_json, canonical, file_digest, held
from model.workspace import Workspace
from model import management_cases

from model.published_management_cases import recipe, selection, CATALOG_SHA256

EVIDENCE_FIELDS = ("lucode", "parameter", "value", "units", "load_type",
                   "source_title", "source_uri", "source_locator", "source_period",
                   "lower", "upper", "range_basis", "notes")



def evidence_csv(practice):
    """Two observed annual loading values only; no fabricated coefficient ranges."""
    buffer = io.StringIO(newline="")
    writer = csv.DictWriter(buffer, fieldnames=EVIDENCE_FIELDS, lineterminator="\n")
    writer.writeheader()
    for change in practice["changes"]:
        if change["parameter"] not in ("load_n", "load_p"):
            continue
        source = change["source"]
        writer.writerow({
            "lucode": change["lucode"], "parameter": change["parameter"],
            "value": format(change["value"], ".2f"), "units": change["units"],
            "load_type": change["load_type"], "source_title": source["title"],
            "source_uri": source["uri"], "source_locator": source["locator"],
            "source_period": source["period"], "lower": "", "upper": "", "range_basis": "",
            "notes": source["applicability"] + " Zero subsurface partition is a separate "
                     "scenario assumption. Other cells retain their own source status."})
    return buffer.getvalue()


def write_identical(path, content):
    if path.exists():
        if path.read_text(encoding="utf-8") != content:
            raise ValueError("Retained source output differs: " + str(path))
        return
    temporary = path.with_name(path.name + ".tmp")
    with temporary.open("w", encoding="utf-8", newline="") as stream:
        stream.write(content)
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--profile", required=True)
    parser.add_argument("--lucode", type=int, required=True)
    parser.add_argument("--confirm-pasture", action="store_true", required=True)
    parser.add_argument("--nitrogen-compartment", required=True,
                        choices=("existing-surface-only", "explicit-surface-only"))
    parser.add_argument("--applicability", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--prepare", action="store_true",
                        help="Save profiles with the existing management API; no model execution")
    args = parser.parse_args(argv)
    workspace = Workspace(args.workspace)
    selected, binding = selection(
        workspace, args.profile, args.lucode, confirm_pasture=args.confirm_pasture,
        nitrogen_compartment=args.nitrogen_compartment, applicability=args.applicability)
    preview = management_cases.preview(workspace, selected)
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    with held(output / ".published-pasture.lock", blocking=False):
        atomic_json(output / "selection.json", selected, immutable=True)
        atomic_json(output / "source-binding.json", binding, immutable=True)
        data = recipe()
        atomic_json(output / "published-recipe.json", data, immutable=True)
        atomic_json(output / "preview.json", preview, immutable=True)
        evidence_files = {}
        for practice in selected["practices"]:
            path = output / (practice["key"] + "-evidence.csv")
            write_identical(path, evidence_csv(practice))
            evidence_files[practice["key"]] = {
                "path": str(path), "sha256": file_digest(path), "bytes": path.stat().st_size}
        result = management_cases.prepare(workspace, selected) if args.prepare else None
        profile_by_name = {}
        if result is not None:
            verified = management_cases.inspect(workspace, result["id"])
            if canonical(verified) != canonical(result):
                raise ValueError("Saved management case differs from its verified source record")
            for profile in result["profiles"]:
                for case in profile.get("management_cases", []):
                    name = case["name"]
                    if name in profile_by_name and profile_by_name[name] != profile["profile_id"]:
                        raise ValueError("A named treatment unexpectedly resolves to multiple profiles")
                    profile_by_name[name] = profile["profile_id"]
            if set(profile_by_name) != {p["name"] for p in selected["practices"]}:
                raise ValueError("Saved profile lineage must retain all six exact treatment names")
            atomic_json(output / "management-case.json", result, immutable=True)
        receipt = {
            "state": "prepared" if result is not None else "preview",
            "workspace_id": workspace.project["id"],
            "selection": str(output / "selection.json"),
            "source_binding": str(output / "source-binding.json"),
            "baseline_profile_id": selected["baseline_profile_id"],
            "baseline_table_sha256": selected["expected_table_sha256"],
            "management_case_id": result["id"] if result else None,
            "profile_set_id": result["profile_set_id"] if result else preview["profile_preview"]["id"],
            "treatments": [{"key": p["key"], "name": p["name"],
                            "profile_id": profile_by_name.get(p["name"]),
                            "evidence_csv": evidence_files[p["key"]]}
                           for p in selected["practices"]],
            "comparisons": data["comparisons"],
            "native_models_executed": False, "evidence_records_registered": False,
            "next": "Use the existing native experiment workflow. Import each evidence CSV "
                    "against its matching returned treatment profile through the existing "
                    "coefficient evidence workflow; select no range IDs."}
        atomic_json(output / "receiving-result.json", receipt)
    print(json.dumps(receipt, indent=2, ensure_ascii=False, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
