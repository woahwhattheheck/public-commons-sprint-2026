"""Run the whole native source/round-trip/receiving flow on pinned MPXJ fixtures."""
from __future__ import annotations
import argparse
from decimal import Decimal
import hashlib
import json
from pathlib import Path

from portfolio import PortfolioWorkspace
from portfolio.storage import atomic_json, canonical, file_identity, read_json, require

UPSTREAM = "7ef9e72813d33378c55ec6ceb148cc831ed22033"
FIXTURES = [
    {"path": "junit/data/timephased-budget-baseline.mpp", "blob": "f4d2dcb2b74a829a6368d106a55e68712f417c68", "bytes": 354304},
    {"path": "junit/data/calendar-exception-precedence-daily.mpp", "blob": "77e7036f04f3cc582c61438c0deee30834d4d3b1", "bytes": 240640},
    {"path": "junit/data/generated/assignment-assignments/assignment-assignments-project2019-mspdi.xml", "blob": "229c381968ee1b23d2027a20eff0983dab3e855b", "bytes": 38478},
    {"path": "junit/data/baselines.xml", "blob": "f2b689d213abc719d55394f476c329634fc47517", "bytes": 24522},
    {"path": "junit/data/enterprise.xml", "blob": "11d5ddf8e3b799a655000890612e623ad9f935df", "bytes": 46339},
]


def run(upstream, directory):
    upstream, directory = Path(upstream).absolute(), Path(directory).absolute()
    directory.mkdir(parents=True, mode=0o700, exist_ok=True)
    result_path = directory / "result.json"
    if result_path.exists():
        result = read_json(result_path)
        require(file_identity(result["archive"]["path"]) == {k: result["archive"][k] for k in ("sha256", "bytes")},
                "receiving_archive_changed", "The completed receiving archive changed.")
        restored = PortfolioWorkspace(result["receiving"]["destination"])
        for row in result["sources"]:
            require(restored.read_edition(row["edition_id"])["sha256"] == row["model_sha256"],
                    "receiving_edition_changed", "A received original native model changed.")
        return result
    ws = PortfolioWorkspace(directory / "workspace")
    runtime = ws.native.ensure()
    atomic_json(directory / "native-runtime.json", runtime, immutable=True)
    selected, captures = [], []
    for fixture in FIXTURES:
        path = upstream / fixture["path"]
        raw = path.read_bytes()
        blob = hashlib.sha1(b"blob " + str(len(raw)).encode("ascii") + b"\0" + raw).hexdigest()
        require(len(raw) == fixture["bytes"] and blob == fixture["blob"],
                "upstream_fixture_changed", "Use the unchanged fixture from the pinned maintained engine.", fixture)
        original = {"path": fixture["path"], "upstream_commit": UPSTREAM, "git_blob": blob, **file_identity(path)}
        selected.append(original)
        request = "native-intake-" + blob
        edition = ws.intake(request, path, label=Path(fixture["path"]).name)
        # Reopen the exact completed original request; this must not create another edition.
        reopened = ws.intake(request, path, label=Path(fixture["path"]).name)
        require(reopened["id"] == edition["id"], "intake_replay", "A repeated original intake must reopen its recorded edition.")
        export = ws.export_mspdi("native-export-" + blob, edition["id"])
        repeated = ws.export_mspdi("native-export-" + blob, edition["id"])
        require(repeated["id"] == export["id"] and repeated["sha256"] == export["sha256"],
                "export_replay", "A repeated native export must reopen the original bytes.")
        comparison = ws.store.record("comparisons", export["comparison_id"])
        captures.append({"fixture": original, "edition_id": edition["id"], "model_sha256": edition["sha256"],
                         "counts": edition["model"]["counts"], "findings": edition["findings"],
                         "native_export": export, "comparison": comparison})
    atomic_json(directory / "original-fixtures.json", selected, immutable=True)
    original = ws.read_edition(captures[2]["edition_id"])
    target = next(row for row in original["model"]["tasks"]
                  if row["uid"] not in (None, "0") and row["fields"].get("NAME", {}).get("type") == "string")
    correction = {"family": "tasks", "key": target["key"], "field": "NAME",
                  "before": target["fields"]["NAME"],
                  "after": {"type": "string", "value": target["fields"]["NAME"]["value"] + " — native receiving correction"}}
    corrections = [correction]
    fixed_cost = target["fields"].get("FIXED_COST")
    if fixed_cost and fixed_cost["type"] in {"number", "integer"}:
        corrections.append({"family": "tasks", "key": target["key"], "field": "FIXED_COST",
                            "before": fixed_cost, "after": {"type": "number",
                            "value": str(Decimal(fixed_cost["value"]) + Decimal("17.125"))}})
    review = ws.review(original["id"], target_profile={"kind": "mspdi"}, corrections=corrections)
    require(review["ready"], "native_review", "The selected original file correction must be ready.", review["unresolved"])
    changed = ws.apply_review("native-reviewed-correction", review["id"])
    corrected_output = ws.export_mspdi("native-corrected-output", changed["edition_id"])
    returned = ws.read_edition(corrected_output["native_readback_edition_id"])
    changed_row = next(row for row in returned["model"]["tasks"] if row["uid"] == target["uid"])
    require(changed_row["fields"]["NAME"]["value"] == correction["after"]["value"],
            "native_name_roundtrip", "The original native correction must survive actual MSPDI readback.")
    # A full archive is an original source/model/history delivery, including
    # features which the native file format itself cannot carry.
    archive = ws.export_workspace(directory / "portfolio-workspace.zip")
    received = PortfolioWorkspace.receive_workspace(archive["path"], directory / "received")
    restored = PortfolioWorkspace(received["destination"])
    require(restored.read_edition(changed["edition_id"])["sha256"] == changed["edition"]["sha256"],
            "native_receiving_model", "The received corrected native model must retain its complete original identity.")
    restored_export = restored.export_mspdi("native-corrected-output", changed["edition_id"])
    require(restored_export["sha256"] == corrected_output["sha256"]
            and Path(restored_export["path"]).is_relative_to(restored.root),
            "native_receiving_export", "The original export must reopen from the received workspace.")
    result = {"schema": "project-portfolio-native-receiving.v1", "state": "complete", "runtime": runtime,
              "sources": captures, "review_id": review["id"], "corrected_edition_id": changed["edition_id"],
              "corrections": corrections, "corrected_export": corrected_output,
              "archive": archive, "receiving": received,
              "source_workspace": str(ws.root), "restored_export_path": restored_export["path"]}
    atomic_json(result_path, result, immutable=True)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--upstream", required=True, help="Pinned original MPXJ checkout or unchanged fixture root")
    parser.add_argument("--directory", required=True, help="Original receiving operation directory; reuse to reopen")
    args = parser.parse_args()
    result = run(args.upstream, args.directory)
    print(json.dumps({"state": result["state"], "result": str(Path(args.directory).absolute() / "result.json"),
                      "source_workspace": result["source_workspace"], "receiving": result["receiving"]}, indent=2))


if __name__ == "__main__":
    main()
