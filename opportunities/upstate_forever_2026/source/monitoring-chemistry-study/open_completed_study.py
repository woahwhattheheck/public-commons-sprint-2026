#!/usr/bin/env python3
"""Open the selected completed study with the delivered application's own modules."""
from pathlib import Path
import argparse
import fcntl
import importlib.util
import json
import os
import subprocess
import sys
import tempfile

MODES = ("calibration", "sensitivity", "uncertainty", "monitoring")
PRODUCERS = {
    "model.common": "model/common.py",
    "model.workspace": "model/workspace.py",
    "model.chemistry": "model/chemistry.py",
    "model.chemistry_reports": "model/chemistry_reports.py",
    "model.chemistry_report_source": "model/chemistry_report_source.py",
    "model.monitoring_workspace": "model/monitoring_workspace.py",
    "model.monitoring_sources": "model/monitoring_sources.py",
    "model.reach_chemistry.model": "model/reach_chemistry/model.py",
    "model.reach_chemistry.inference": "model/reach_chemistry/inference.py",
    "model.reach_chemistry.reporting": "model/reach_chemistry/reporting.py",
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def atomic_json(path, value):
    """Publish only a complete local receiving record."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, pending = tempfile.mkstemp(prefix="." + path.name + "-", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as output:
            json.dump(value, output, ensure_ascii=False, indent=2, allow_nan=False)
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
        os.replace(pending, path)
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        Path(pending).unlink(missing_ok=True)


def inspect_study(application, root, reports_path, comparison_path, expected=None):
    """Executed only in the new isolated interpreter below; native reads stay native."""
    import importlib
    application = Path(application).resolve(strict=True)
    root = Path(root).resolve(strict=True)
    sys.path.insert(0, str(application))
    modules = {name: importlib.import_module(name) for name in PRODUCERS}
    common = modules["model.common"]
    loaded = {}
    for name, relative in PRODUCERS.items():
        path = Path(modules[name].__file__).resolve(strict=True)
        require(path == application / relative,
                "Selected producer loaded outside the delivered application: " + name)
        item = {"path": relative, "bytes": path.stat().st_size,
                "sha256": common.file_digest(path)}
        if expected is not None:
            require(expected["producers"].get(name) == item,
                    "Delivered producer differs from its captured edition: " + name)
        loaded[name] = item

    reports = read_json(reports_path)
    supplied_comparison = read_json(comparison_path)
    workspace = modules["model.workspace"].Workspace(root, create=False)
    chemistry = modules["model.chemistry"].Chemistry(workspace)
    report_service = modules["model.chemistry_reports"]
    source_service = modules["model.chemistry_report_source"]
    monitoring = modules["model.monitoring_workspace"].MonitoringWorkspace(workspace)
    files = {}

    def retain(path):
        path = Path(path)
        resolved = path.resolve(strict=True)
        require(resolved == path.absolute() and resolved.is_file()
                and resolved.is_relative_to(root),
                "Selected scientific member is not its original Workspace file")
        relative = resolved.relative_to(root).as_posix()
        files[relative] = {"bytes": resolved.stat().st_size,
                           "sha256": common.file_digest(resolved)}

    case = chemistry.get_case(reports["course_inputs"]["case_id"])
    retain(root / "workspace.json")
    retain(root / "chemistry-cases" / (case["id"] + ".json"))
    retained = {"project": workspace.project, "case": case,
                "analyses": {}, "reports": {}, "sources": {}}
    summary = {}
    for mode in MODES:
        run = chemistry.get_run(reports["analyses"][mode]["run_id"])
        require(run["state"] == "complete" and run["case_id"] == case["id"]
                and run["mode"] == ("calibrate" if mode == "calibration" else mode),
                "Selected analysis is not a complete run of the original case")
        directory = chemistry._verified_artifacts(run["id"], run)
        retain(directory / "run.json")
        for item in run["artifacts"]:
            retain(common.verify_file(directory, item))
        report = report_service.inspect(workspace, reports["reports"][mode]["id"])
        source = source_service.inspect(workspace, reports["sources"][mode]["id"])
        require(report["run_id"] == run["id"] and report["case_id"] == case["id"]
                and source["run_id"] == run["id"] and source["case_id"] == case["id"]
                and source["report_id"] == report["id"],
                "Selected scientific report or source belongs to a different native analysis")
        report_directory = root / report_service.FOLDER / report["id"]
        retain(report_directory / "report.json")
        retain(report_directory / "manifest.json")
        for item in read_json(report_directory / "manifest.json")["files"]:
            retain(common.verify_file(report_directory, item))
        for item in report["artifacts"]:
            retain(common.verify_file(root, item))
        retain(root / source_service.KIND / (source["id"] + ".json"))
        source_directory = root / source["directory"]
        retain(common.verify_file(source_directory, source["manifest"]))
        for item in source["files"].values():
            retain(common.verify_file(source_directory, item))
        retained["analyses"][mode] = run
        retained["reports"][mode] = report
        retained["sources"][mode] = source
        summary[mode] = {"run_id": run["id"], "report_id": report["id"],
                         "source_id": source["id"], "state": run["state"]}

    comparison = workspace._get("monitoring_frontier_comparisons", supplied_comparison["id"])
    require(comparison == supplied_comparison,
            "Selected original budget comparison differs from the native record")
    frontier = monitoring.get("frontiers", comparison["frontier_id"])
    require(frontier["plan_ids"] == comparison["plan_ids"]
            and frontier["network_id"] == comparison["network_id"],
            "Comparison does not retain its original ordered frontier plans")
    network = monitoring.get("networks", frontier["network_id"])
    monitoring.verify_sources(network)
    plans = [monitoring.get("plans", key) for key in frontier["plan_ids"]]
    require(all(plan["network_id"] == network["id"] for plan in plans),
            "A selected budget plan belongs to another native network")
    collections = modules["model.monitoring_workspace"].COLLECTIONS
    for kind, values in (("networks", [network]), ("frontiers", [frontier]), ("plans", plans)):
        for value in values:
            retain(root / collections[kind] / (value["id"] + ".json"))
    retain(root / "monitoring_frontier_comparisons" / (comparison["id"] + ".json"))
    retained.update(comparison=comparison, frontier=frontier, network=network, plans=plans)
    if expected is not None:
        require(retained == expected["retained"],
                "Cold receiving changed a selected original scientific record")
        require(files == expected["files"],
                "Cold receiving changed a selected original scientific file")
    return {
        "schema": "upstate.archived-application-reopen/v1", "state": "complete",
        "application": str(application), "workspace": str(root),
        "interpreter": sys.executable, "python_version": sys.version,
        "project_id": workspace.project["id"], "analyses": summary,
        "plans": [{"plan_id": row["id"], "state": row["status"]} for row in plans],
        "comparison_id": comparison["id"], "loaded_source": {
            name: str(application / item["path"]) for name, item in loaded.items()},
        "producers": loaded, "retained": retained, "files": files,
        "retained_science_sha256": common.digest(retained),
    }


def open_study(application, workspace, reports, comparison, output, *, expected=None, lock_fd=None):
    """Keep the public original CLI; the capture helper may supply its frozen selection."""
    application, workspace, reports, comparison = (
        Path(path).resolve(strict=True) for path in (application, workspace, reports, comparison))
    output = Path(output).resolve()
    require(not output.is_relative_to(application) and not output.is_relative_to(workspace),
            "Keep the receiving output outside the application and Workspace")
    output.parent.mkdir(parents=True, exist_ok=True)
    request = {"application": str(application), "root": str(workspace),
               "reports_path": str(reports), "comparison_path": str(comparison), "expected": expected}
    request_path = output.with_name(output.name + ".request.json")
    atomic_json(request_path, request)
    child = (
        "import importlib.util,sys\n"
        "spec=importlib.util.spec_from_file_location('completed_study_receiver',sys.argv[1])\n"
        "module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)\n"
        "request=module.read_json(sys.argv[2])\n"
        "result=module.inspect_study(**request)\n"
        "module.atomic_json(sys.argv[3],result)\n"
    )
    # The child imports the selected application's modules in an isolated process.
    # Carry the parent's lock when capture owns one, including if that parent dies.
    with output.with_name(output.name + ".stdout.log").open("w", encoding="utf-8") as stdout, (
            output.with_name(output.name + ".stderr.log")).open("w", encoding="utf-8") as stderr:
        result = subprocess.run(
            [sys.executable, "-I", "-B", "-c", child, str(Path(__file__).resolve()),
             str(request_path), str(output)], cwd=application,
            stdout=stdout, stderr=stderr, pass_fds=(() if lock_fd is None else (lock_fd,)))
    require(result.returncode == 0,
            "Archived application reopening failed; inspect " + str(output) + ".stderr.log")
    value = read_json(output)
    require(value.get("state") == "complete" and value["application"] == str(application)
            and value["workspace"] == str(workspace),
            "Receiving result belongs to another application or Workspace")
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", type=Path, required=True)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--reports", type=Path, required=True)
    parser.add_argument("--comparison", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--expected-selection", type=Path)
    args = parser.parse_args()
    output = args.output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(output.with_name("." + output.name + ".lock"),
                 os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        result = open_study(args.application, args.workspace, args.reports, args.comparison,
                            output, expected=read_json(args.expected_selection)
                            if args.expected_selection else None, lock_fd=fd)
    finally:
        os.close(fd)
    print(json.dumps({key: result[key] for key in (
        "state", "application", "workspace", "project_id", "comparison_id",
        "retained_science_sha256")}, indent=2))


if __name__ == "__main__":
    main()
