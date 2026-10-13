"""Continue an existing completed Programme through real source editions and reuse.

The original native matcher and Programme executor perform all scientific work.
This course adds a provenance-only CSV column, then changes one retained USLE-C
coefficient. Each edition is a separate successor of the selected original.
"""
from __future__ import annotations

import argparse
import csv
from datetime import datetime, timezone
from decimal import Decimal
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import time

APPLICATION = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APPLICATION))

from model.common import (atomic_bytes, atomic_json, describe_file, digest, held,
                          identifier, now, read_json, verify_file)
from model.compute_programme import ComputeProgrammes
from model.model_selection import run_models, validate_completed_run
from model.native import runtime
from model.native_equivalence import NativeInputMatcher
from model.profiles import inspect_table
from model.reuse import verify_stage
from model import portable, programme_source_updates, source_refresh
from model.workspace import Workspace

SCHEMA = "upstate.programme-reuse-course/v1"
CAPTURE_SCHEMA = "upstate.programme-reuse-course-capture/v1"
DEFAULT_DEADLINE = "2026-10-13T14:00:00Z"
SCRIPT_PATH = "source_tools/continue_programme_source_reuse.py"


def sha(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def deadline(value):
    if not value:
        return
    end = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if end.tzinfo is None:
        raise ValueError("Use a deadline with its UTC offset")
    if datetime.now(timezone.utc) >= end:
        raise TimeoutError("Owner cutoff reached; retained course phases remain resumable")


def json_copy(value):
    return json.loads(json.dumps(value, allow_nan=False))


def immutable_json(path, value):
    atomic_json(path, value, immutable=True)
    if read_json(path) != value:
        raise ValueError("Retained course document differs: " + str(path))


def descriptors(value):
    if isinstance(value, dict):
        if {"path", "sha256", "bytes"} <= set(value):
            yield value
        else:
            for child in value.values():
                yield from descriptors(child)
    elif isinstance(value, list):
        for child in value:
            yield from descriptors(child)


def verify_report(ws, manager, programme_id):
    report = manager.read_report(programme_id)
    if not report.get("id") or report.get("programme_state") != "complete":
        raise ValueError("Retain the complete original Programme report")
    for item in descriptors({"rows": report["rows"], "files": report["files"]}):
        verify_file(ws.root, item)
    return report


def verify_native(ws, key):
    run = ws.inspect_run(identifier(key))
    scope = validate_completed_run(run)
    if run.get("state") != "complete" or not scope["full_model_outputs"]:
        raise ValueError("Complete the original selected native outputs: " + key)
    root = ws.root / "runs" / key
    for model in run_models(run):
        verify_stage(root, run["stages"][model])
    for item in run["artifacts"].values():
        verify_file(root, item)
    return run


def programme_snapshot(ws, programme_id):
    manager = ComputeProgrammes(ws)
    status = manager.status(programme_id, include_ensemble_candidates=False)
    if status["active"] or status["state"] != "complete":
        raise ValueError("Choose a complete, idle saved Programme")
    report = verify_report(ws, manager, programme_id)
    records = [describe_file(ws.root, ws.root / "compute-programmes" / programme_id / name)
               for name in ("programme.json", "progress.json")]
    runs = []
    for row in status["runs"]:
        native = verify_native(ws, row["run_id"])
        if run_models(native) != ["ndr", "sdr"]:
            raise ValueError("This paired reuse course requires completed NDR and SDR in every selected case")
        runs.append({"key": row["key"], "title": row["title"], "run_id": row["run_id"],
                     "selection": native["selection"],
                     "record": describe_file(ws.root, ws.root / "runs" / row["run_id"] / "run.json")})
    if len(runs) < 2 or len({row["selection"]["profile_id"] for row in runs}) != 1:
        raise ValueError("Select a baseline and alternative cohort under one original profile")
    return {"id": programme_id, "title": status["title"], "selection": status["selection"],
            "report_id": report["id"], "records": records, "runs": runs}


def retained_original(ws, snapshot):
    for item in snapshot["records"] + [row["record"] for row in snapshot["runs"]]:
        verify_file(ws.root, item)
    report = verify_report(ws, ComputeProgrammes(ws), snapshot["id"])
    if report["id"] != snapshot["report_id"]:
        raise ValueError("The original Programme report changed during the continuation")


def select_programme(ws, args, output):
    manager = ComputeProgrammes(ws)
    if args.receipt:
        from source_tools.adopt_simulated_headwaters_programme import adopt
        result = adopt(ws, args.receipt, output=output / "original-adoption.json")
        return identifier(result["programme_id"])
    if args.programme_id:
        return identifier(args.programme_id)
    candidates = []
    catalog = manager.catalog(include_completed_sources=False)
    atomic_json(output / "original-catalog.json", catalog)
    for item in catalog["programmes"]:
        if item.get("state") != "complete":
            continue
        status = manager.status(item["id"], include_ensemble_candidates=False)
        rows = status["runs"]
        if (not status["active"] and len(rows) >= 2
                and len({row["profile_id"] for row in rows}) == 1
                and all(run_models({"selection": row["native_selection"]}) == ["ndr", "sdr"] for row in rows)
                and not str(status.get("source_reference", "")).startswith("upstate.programme-source-update:")):
            candidates.append(item["id"])
    if len(candidates) != 1:
        raise ValueError("Select --programme-id from original-catalog.json; completed candidates: "
                         + ", ".join(candidates))
    return candidates[0]


class CourseWorkspace(Workspace):
    """Use the existing executor, checking the owner boundary before each case."""
    cutoff = None

    def run(self, key, **kwargs):
        deadline(self.cutoff)
        return super().run(key, **kwargs)


class Course:
    def __init__(self, ws, output, identity, cutoff):
        self.ws, self.output, self.cutoff = ws, output, cutoff
        self.id = digest(identity)
        self.path = output / "course-state.json"
        if self.path.exists():
            self.state = read_json(self.path)
            if self.state.get("schema") != SCHEMA or self.state.get("identity") != identity:
                raise ValueError("Choose a new output directory for a different original course")
        else:
            self.state = {"schema": SCHEMA, "id": self.id, "identity": identity,
                          "created_at": now(), "state": "prepared", "phases": {}, "history": []}
            self.save()

    def save(self):
        self.state["updated_at"] = now()
        atomic_json(self.path, self.state)

    def phase(self, name, function):
        retained = self.state["phases"].get(name)
        if retained and retained.get("state") == "complete":
            return retained["result"]
        deadline(self.cutoff)
        entry = {"phase": name, "started_at": now(), "state": "running"}
        self.state["history"].append(entry)
        self.state["state"], self.state["active_phase"] = "running", name
        self.save()
        print(json.dumps({"course_id": self.id, **entry}), flush=True)
        started = time.perf_counter()
        try:
            result = function()
            json.dumps(result, allow_nan=False)
            entry.update(state="complete", completed_at=now(),
                         elapsed_seconds=time.perf_counter() - started)
            self.state["phases"][name] = {**entry, "result": result}
            self.save()
            return result
        except BaseException as exc:
            entry.update(state="paused" if isinstance(exc, TimeoutError) else "failed",
                         ended_at=now(), elapsed_seconds=time.perf_counter() - started,
                         error={"type": type(exc).__name__, "message": str(exc)})
            self.state["state"] = entry["state"]
            self.save()
            raise

    def edition(self, mode, profile, original_entry, original_path, code, factor):
        directory = self.output / mode
        directory.mkdir(exist_ok=True)
        table = inspect_table(original_path, models=["ndr", "sdr"])
        columns = list(table["columns"])
        marker = "programme_source_edition"
        if marker in columns:
            raise ValueError("The original table already has the course annotation column")
        columns.append(marker)
        changes = []
        rows = json_copy(table["rows"])
        for row in rows:
            row[marker] = self.id + ":" + mode
            if mode == "sdr-coefficient" and int(row["lucode"]) == code:
                before = Decimal(row["usle_c"])
                after = before * factor
                if not before.is_finite() or not after.is_finite() or not 0 < after <= 1 or after == before:
                    raise ValueError("The selected USLE-C change must remain positive and at most one")
                row["usle_c"] = format(after, "f")
                changes.append({"lucode": code, "field": "usle_c",
                                "before": str(before), "after": str(after)})
        if mode == "sdr-coefficient" and len(changes) != 1:
            raise ValueError("Select exactly one original table lucode for the SDR change")
        stream = io.StringIO(newline="")
        writer = csv.DictWriter(stream, fieldnames=columns, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
        body = stream.getvalue().encode("utf-8")
        table_path = directory / "biophysical.csv"
        atomic_bytes(table_path, body, immutable=True)
        summary = inspect_table(table_path, models=["ndr", "sdr"])
        if summary["lucodes"] != table["lucodes"]:
            raise ValueError("Source edition changed the original class set")
        entry = {name: json_copy(value) for name, value in original_entry.items()
                 if name not in {"body", "companions", "bytes", "sha256", "path"}}
        entry.update(path="biophysical.csv", sha256=hashlib.sha256(body).hexdigest(),
                     bytes=len(body), title=original_entry["title"] + " / " + mode,
                     vintage=str(original_entry["vintage"]) + " / reuse course " + self.id[:12] + " / " + mode,
                     uri="urn:upstate:programme-reuse-course:" + self.id + ":" + mode,
                     course_lineage={"course_id": self.id, "mode": mode,
                         "original_collection_id": profile["source_collection_id"],
                         "original_source_id": profile["biophysical_source_id"],
                         "original_body": original_entry["body"], "coefficient_changes": changes,
                         "annotation": "The added column is not a native NDR/SDR input"})
        manifest = {"schema": "upstate.sources/v1",
                    "title": "Retained Programme source course / " + mode,
                    "captured_at": self.state["created_at"], "entries": [entry],
                    "notes": ["Operator-selected source-edition exercise using the retained original table.",
                              "Grid, reporting support, scenarios and native parameters remain selected from the original Programme."]}
        manifest_path = directory / "sources.json"
        immutable_json(manifest_path, manifest)
        collection = self.ws.import_sources(manifest_path)
        plan = source_refresh.SourceRefresh(self.ws).plan(
            profile["source_collection_id"], collection["id"],
            mapping={profile["biophysical_source_id"]: entry["id"]},
            roots={"profiles": [profile["id"]]},
            title="Programme " + self.id[:12] + " / " + mode)
        applied = source_refresh.apply_plan(self.ws, plan["id"], run_models=False)
        atomic_json(directory / "refresh-result.json", applied)
        return {"source_collection_id": collection["id"], "source_id": entry["id"],
                "refresh_plan_id": plan["id"], "table_sha256": entry["sha256"],
                "coefficient_changes": changes,
                "manifest": describe_file(self.output, manifest_path)}

    def successor(self, mode, original, edition):
        title = original["title"] + " / " + mode + " " + self.id[:8]
        preview = programme_source_updates.preview(self.ws, original["id"],
                    edition["refresh_plan_id"], title=title)
        atomic_json(self.output / mode / "programme-preview.json", preview)
        if not preview["ready"]:
            raise ValueError("Source successor needs its original inputs: " + json.dumps(preview["issues"]))
        result = programme_source_updates.create(self.ws, original["id"],
            edition["refresh_plan_id"], expected_preview_id=preview["id"], title=title)
        atomic_json(self.output / mode / "source-successor.json", result)
        return result

    def match(self, original, successor, mode):
        manager = ComputeProgrammes(self.ws)
        status = manager.status(successor["programme_id"], include_ensemble_candidates=False)
        originals = {row["key"]: row for row in original["runs"]}
        native_runtime = runtime(["ndr", "sdr"])[1]
        rows = []
        for row in status["runs"]:
            source = self.ws.inspect_run(originals[row["key"]]["run_id"])
            if row["run_id"] == source["id"] or source["id"] not in row.get("reuse_source_run_ids", []):
                raise ValueError("Successor must retain a new native identity and its original explicit candidate")
            if row["native_selection"]["grid_id"] != source["selection"]["grid_id"] or row["scenario_id"] != source["selection"]["scenario_id"]:
                raise ValueError("The table-edition course must preserve grid and scenario identity")
            scenario = self.ws._get("scenarios", row["scenario_id"])
            target_lulc = None
            if scenario["kind"] != "baseline":
                target_lulc = verify_file(self.ws.root / "runs" / source["id"],
                                         source["stages"]["landcover"]["artifact"])
            matcher = NativeInputMatcher(self.ws, row["run_id"],
                         target_lulc=target_lulc, target_runtime=native_runtime)
            matches = {model: matcher.compare(source["id"], model) for model in ("ndr", "sdr")}
            if not matches["ndr"]["matches"] or not matches["ndr"]["mass_exports_match"]:
                raise ValueError("The actual unchanged NDR inputs cannot reuse this original stage: "
                                 + json.dumps(matches["ndr"]))
            if mode == "equivalent":
                if not matches["sdr"]["matches"] or not matches["sdr"]["mass_exports_match"]:
                    raise ValueError("The equivalent table differs in actual SDR inputs: " + json.dumps(matches["sdr"]))
            elif matches["sdr"]["matches"] or matches["sdr"]["differences"] != ["model biophysical columns"]:
                raise ValueError("The coefficient edition must change only the native SDR table: " + json.dumps(matches["sdr"]))
            rows.append({"key": row["key"], "source_run_id": source["id"],
                         "target_run_id": row["run_id"], "matches": matches})
        return rows

    def execute(self, mode, successor):
        manager = ComputeProgrammes(self.ws)
        current = manager.status(successor["programme_id"], include_ensemble_candidates=False)
        if current["state"] != "complete":
            current = manager.resume(successor["programme_id"])
        if current["state"] != "complete":
            raise RuntimeError("Source successor remains " + current["state"] + ": " + json.dumps(current.get("error")))
        report = verify_report(self.ws, manager, successor["programme_id"])
        outcomes = []
        for row in current["runs"]:
            run = verify_native(self.ws, row["run_id"])
            stages = {}
            for model in ("ndr", "sdr"):
                stage = run["stages"][model]
                origin = stage.get("reused_from")
                if (mode == "equivalent" or model == "ndr") and not origin:
                    raise ValueError("A scientifically equivalent stage was unexpectedly recomputed: " + model + "/" + run["id"])
                stages[model] = {"execution": "reused" if origin else "native",
                    "reused_from": origin, "started_at": stage.get("started_at"),
                    "completed_at": stage.get("completed_at"), "reused_at": stage.get("reused_at"),
                    "arguments": stage["arguments"]}
            outcomes.append({"key": row["key"], "run_id": run["id"], "selection": run["selection"],
                "stages": stages, "execution": run.get("execution"),
                "execution_history": run.get("execution_history", []),
                "artifacts": run["artifacts"]})
        return {"programme_id": current["id"], "report_id": report["id"],
                "runs": outcomes, "report_rows": report["rows"], "report_files": report["files"]}

    def compare(self, original, result, mode):
        source = {row["key"]: row for row in original["runs"]}
        rows = []
        for row in result["runs"]:
            old = source[row["key"]]["run_id"]
            value = self.ws.compare_runs([old, row["run_id"]])
            if len(value["alternatives"]) != 1 or value["alternatives"][0]["run_id"] != row["run_id"]:
                raise ValueError("Native comparison returned another successor")
            if mode == "equivalent":
                before = self.ws.inspect_run(old)
                after = self.ws.inspect_run(row["run_id"])
                for name, item in value["alternatives"][0]["artifacts"].items():
                    if (item.get("sum_change") != 0
                            or item["valid_cells"] != before["artifacts"][name]["valid_cells"]
                            or item["valid_cells"] != after["artifacts"][name]["valid_cells"]
                            or before["artifacts"][name]["sha256"] != after["artifacts"][name]["sha256"]):
                        raise ValueError("Equivalent inputs did not retain the original converted export and support")
            rows.append({"key": row["key"], "source_run_id": old,
                         "target_run_id": row["run_id"], "comparison": value})
        return rows


def cold_check(workspace, capture_id):
    ws = Workspace(workspace)
    path = ws.root / "programme-reuse-courses" / identifier(capture_id) / "capture.json"
    capture = read_json(path)
    if capture.get("schema") != CAPTURE_SCHEMA or digest(capture["identity"]) != capture_id:
        raise ValueError("Retained reuse course capture identity changed")
    if capture["workspace_id"] != ws.project["id"]:
        raise ValueError("The archived course belongs to another project")
    if sha(Path(__file__)) != capture["script_sha256"]:
        raise ValueError("Execute the exact script from the restored application")
    retained_original(ws, capture["original"])
    manager = ComputeProgrammes(ws)
    for mode, result in capture["editions"].items():
        status = manager.status(result["programme_id"], include_ensemble_candidates=False)
        report = verify_report(ws, manager, result["programme_id"])
        if status["state"] != "complete" or report["id"] != result["report_id"]:
            raise ValueError("Received successor Programme differs: " + mode)
        by_key = {row["key"]: row for row in status["runs"]}
        for row in result["runs"]:
            actual = verify_native(ws, row["run_id"])
            if by_key[row["key"]]["run_id"] != row["run_id"] or actual["selection"] != row["selection"]:
                raise ValueError("Received native binding differs")
            for model, stage in row["stages"].items():
                if actual["stages"][model].get("reused_from") != stage["reused_from"]:
                    raise ValueError("Received original stage donor identity differs")
    for pair in capture["comparisons"].values():
        for row in pair:
            comparison = row["comparison"]
            retained = read_json(ws.root / "comparisons" / comparison["id"] / "comparison.json")
            if retained != comparison:
                raise ValueError("Received comparison differs from its captured original")
            for alternative in comparison["alternatives"]:
                for item in alternative["artifacts"].values():
                    verify_file(ws.root / "comparisons" / comparison["id"], item)
    verified = programme_source_updates.verify_workspace(ws)
    return {"schema": "upstate.programme-reuse-course-reopen/v1", "state": "complete",
            "identity": "MATCH", "course_id": capture_id, "workspace_id": ws.project["id"],
            "application": str(APPLICATION), "workspace": str(ws.root),
            "interpreter": sys.executable, "script_sha256": sha(Path(__file__)),
            "programme_ids": {mode: item["programme_id"] for mode, item in capture["editions"].items()},
            "source_updates": verified}


def run(args):
    output = Path(args.output).resolve()
    ws = CourseWorkspace(Path(args.workspace).resolve(strict=True))
    ws.cutoff = args.deadline
    if output == ws.root or output.is_relative_to(ws.root) or output.is_relative_to(APPLICATION):
        raise ValueError("Use a separate course output directory outside the Workspace and application")
    output.mkdir(parents=True, exist_ok=True)
    with held(output / ".course.lock", blocking=False):
        deadline(args.deadline)
        original_path = output / "original-programme.json"
        if original_path.exists():
            original = read_json(original_path)
            if args.programme_id and original["id"] != args.programme_id:
                raise ValueError("Output already selects another original Programme")
            retained_original(ws, original)
        else:
            original = programme_snapshot(ws, select_programme(ws, args, output))
            immutable_json(original_path, original)
        profile_id = original["runs"][0]["selection"]["profile_id"]
        profile = ws._get("profiles", profile_id)
        table_path, entry = ws.source_file(profile["source_collection_id"], profile["biophysical_source_id"])
        if entry["kind"] != "table" or entry.get("companions"):
            raise ValueError("Select a self-contained retained native biophysical CSV")
        factor = Decimal(args.usle_c_factor)
        if not factor.is_finite() or factor <= 0 or factor == 1:
            raise ValueError("Choose a finite positive USLE-C multiplier different from one")
        grid = ws.get_grid(original["selection"]["grid_id"])
        if int(grid["inputs"]["NLCD"]["class_counts"].get(str(args.lucode),
                grid["inputs"]["NLCD"]["class_counts"].get(args.lucode, 0))) <= 0:
            raise ValueError("Choose a land-cover class present in the actual original grid")
        identity = {"workspace_id": ws.project["id"], "original_programme_id": original["id"],
            "original_profile_id": profile_id, "original_table_sha256": entry["body"]["sha256"],
            "lucode": args.lucode, "usle_c_factor": str(factor),
            "script_sha256": sha(Path(__file__))}
        course = Course(ws, output, identity, args.deadline)
        results, comparisons = {}, {}
        for mode in ("equivalent", "sdr-coefficient"):
            edition = course.phase(mode + ":source", lambda mode=mode:
                        course.edition(mode, profile, entry, table_path, args.lucode, factor))
            ws._get("sources", edition["source_collection_id"])
            verify_file(output, edition["manifest"])
            successor = course.phase(mode + ":successor", lambda mode=mode:
                        course.successor(mode, original, edition))
            course.phase(mode + ":native-input-match", lambda mode=mode:
                        course.match(original, successor, mode))
            results[mode] = course.phase(mode + ":execute", lambda mode=mode:
                        course.execute(mode, successor))
            verify_report(ws, ComputeProgrammes(ws), results[mode]["programme_id"])
            comparisons[mode] = course.phase(mode + ":comparison", lambda mode=mode:
                        course.compare(original, results[mode], mode))
        retained_original(ws, original)
        capture = {"schema": CAPTURE_SCHEMA, "id": course.id, "identity": identity,
                   "workspace_id": ws.project["id"], "script_sha256": identity["script_sha256"],
                   "original": original, "editions": results, "comparisons": comparisons,
                   "source_editions": {mode: course.state["phases"][mode + ":source"]["result"]
                                       for mode in results}}
        capture_path = ws.root / "programme-reuse-courses" / course.id / "capture.json"
        immutable_json(capture_path, capture)
        archive = output / "programme-source-reuse.zip"

        def archive_workspace():
            if not archive.exists():
                ws.backup(archive, include_intermediates=True)
            manifest = portable.inspect_archive(archive, verify=True)
            key = "workspace/" + capture_path.relative_to(ws.root).as_posix()
            if manifest["members"].get(key, {}).get("sha256") != sha(capture_path):
                raise ValueError("Existing archive captures another course edition")
            return {"path": str(archive), "sha256": sha(archive), "bytes": archive.stat().st_size,
                    "members": len(manifest["members"])}

        archived = course.phase("archive", archive_workspace)
        if sha(archive) != archived["sha256"]:
            raise ValueError("Course archive changed")
        destination = output / "received"

        def receive():
            return (portable.resume_restore(archive, destination, expected_archive_sha256=archived["sha256"])
                    if destination.exists() else portable.restore(archive, destination))

        received = course.phase("restore", receive)

        def reopen():
            script = Path(received["application"]) / SCRIPT_PATH
            if not script.is_file() or sha(script) != identity["script_sha256"]:
                raise ValueError("Install the current reuse-course component before exporting its application")
            command = [sys.executable, "-B", str(script), "--cold-workspace",
                       received["workspace"], "--capture-id", course.id]
            began = time.perf_counter()
            child = subprocess.run(command, cwd=received["application"],
                env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
                text=True, capture_output=True)
            atomic_bytes(output / "cold-reopen.stdout", child.stdout.encode("utf-8"))
            atomic_bytes(output / "cold-reopen.stderr", child.stderr.encode("utf-8"))
            if child.returncode:
                raise RuntimeError("Original restored application failed cold reopening: " + child.stderr[-4000:])
            value = json.loads(child.stdout)
            if value.get("identity") != "MATCH" or value.get("course_id") != course.id:
                raise ValueError("Cold child returned another course identity")
            return {"argv": command, "returncode": child.returncode,
                    "elapsed_seconds": time.perf_counter() - began, "result": value}

        reopened = course.phase("cold-reopen", reopen)
        retained_original(ws, original)
        course.state.update(state="complete", active_phase=None, completed_at=now())
        course.save()
        result = {"schema": SCHEMA, "id": course.id, "state": "complete",
            "workspace_id": ws.project["id"], "original_programme_id": original["id"],
            "editions": results, "comparisons": comparisons, "archive": archived,
            "receiving": received, "cold_reopen": reopened,
            "history": course.state["history"],
            "interpretation": "Native annual N/P exports are kg/year; sediment is metric tonnes/year reaching modeled streams. Each quantity and its comparison support remain separate.",
            "completed_at": course.state["completed_at"]}
        atomic_json(output / "programme-source-reuse-result.json", result)
        return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace")
    parser.add_argument("--output")
    choice = parser.add_mutually_exclusive_group()
    choice.add_argument("--programme-id")
    choice.add_argument("--receipt", help="Original completed demo-receiving.json; uses the maintained adopter")
    parser.add_argument("--lucode", type=int, default=82)
    parser.add_argument("--usle-c-factor", default="0.9")
    parser.add_argument("--deadline", default=DEFAULT_DEADLINE)
    parser.add_argument("--cold-workspace", help=argparse.SUPPRESS)
    parser.add_argument("--capture-id", help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    try:
        if args.cold_workspace:
            result = cold_check(args.cold_workspace, args.capture_id)
        else:
            if not args.workspace or not args.output:
                parser.error("--workspace and --output are required")
            result = run(args)
        print(json.dumps(result, sort_keys=True, allow_nan=False), flush=True)
        return 0
    except (ValueError, OSError, KeyError, ImportError, RuntimeError, TimeoutError) as exc:
        print(json.dumps({"state": "paused" if isinstance(exc, TimeoutError) else "failed",
                          "type": type(exc).__name__, "message": str(exc)}), file=sys.stderr, flush=True)
        return 2 if isinstance(exc, TimeoutError) else 1


if __name__ == "__main__":
    raise SystemExit(main())
