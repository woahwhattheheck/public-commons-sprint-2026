"""Transfer selected scientific studies as original editable workspaces.

TokenJunkieLabs. Selection and dependency capture compose model.portable;
the existing archive format, receiving, task queue and byte transport stay
authoritative. Original source collections and complete native run trees are
retained once, even when many selected studies share them.
"""
from __future__ import annotations

from collections import Counter, deque
import contextlib
import copy
import errno
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import tempfile
import zipfile

from .common import (atomic_json, canonical, digest, held, identifier, now,
                     read_json)
from . import portable, study_delivery_transfer as delivery_transfer

SELECTION_SCHEMA = "upstate.study-selection/v1"
PLAN_SCHEMA = "upstate.study-transfer-plan/v1"
RECEIPT_SCHEMA = "upstate.study-transfer/v1"
ROOT_KINDS = ("experiment-diagnostics", "experiments", "runs", "robust-decisions")
IMMUTABLE_KINDS = ("sources", "profiles", "scenarios", "observations",
                   "observation-comparisons", *delivery_transfer.IMMUTABLE_KINDS)
DOCUMENTS = {
    "grids": "grid.json", "runs": "run.json", "experiments": "plan.json",
    "experiment-diagnostics": "manifest.json", "comparisons": "comparison.json",
    **delivery_transfer.DOCUMENTS,
}
LOCKS = {
    "grids": ".grid.lock", "runs": ".run.lock",
    "experiments": ".experiment.lock", "experiment-diagnostics": ".diagnostics.lock",
    "comparisons": ".comparison.lock",
    **delivery_transfer.LOCKS,
}
LABELS = {
    "experiment-diagnostics": "Scientific analyses", "experiments": "Experiment programmes",
    "runs": "Native runs", "robust-decisions": "Decision studies",
    "profiles": "Parameter profiles", "scenarios": "Land-cover scenarios",
    "sources": "Source collections", "grids": "Prepared grids",
    "observations": "Observation editions", "observation-comparisons": "Observation comparisons",
    "comparisons": "Native comparisons",
    **delivery_transfer.LABELS,
}


def _study_key(kind, value):
    if kind == "robust-decisions":
        from .decision_study_transfer import study_id
        return study_id(value)
    return identifier(value)


def normalise(selection):
    if not isinstance(selection, dict):
        raise ValueError("Select scientific studies to transfer.")
    unknown = set(selection) - {"schema", "title", "roots", "include_related_results", "preview_token"}
    if unknown:
        raise ValueError("Unknown study selection fields: " + ", ".join(sorted(unknown)))
    if selection.get("schema", SELECTION_SCHEMA) != SELECTION_SCHEMA:
        raise ValueError("Select an original scientific study selection.")
    roots = selection.get("roots")
    if not isinstance(roots, list) or not roots:
        raise ValueError("Select at least one scientific analysis, programme, native run or decision study.")
    unique = set()
    for item in roots:
        if not isinstance(item, dict) or set(item) != {"kind", "id"} or item["kind"] not in ROOT_KINDS:
            raise ValueError("Study roots must name a saved scientific analysis, programme, native run or decision study.")
        unique.add((item["kind"], _study_key(item["kind"], item["id"])))
    related = selection.get("include_related_results", True)
    if type(related) is not bool:
        raise ValueError("Related results must be selected with a boolean.")
    title = selection.get("title", "Selected scientific study")
    if not isinstance(title, str) or not title.strip():
        raise ValueError("Give the transferred study a title.")
    return {"schema": SELECTION_SCHEMA, "title": title.strip(),
            "roots": [{"kind": kind, "id": key} for kind, key in sorted(unique)],
            "include_related_results": related}


def _identity(path):
    value = path.lstat()
    if not stat.S_ISREG(value.st_mode):
        raise ValueError("A study member must be a retained regular file: " + str(path))
    return (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns)


def _stable_data_identity(value):
    # An owned hard-link staging operation changes ctime while preserving bytes.
    return value[:4]


def _member(root, relative):
    part = portable.member_name(relative)
    path = root.joinpath(*part.parts)
    current = root
    for name in part.parts:
        current = current / name
        if current.is_symlink():
            raise ValueError("Study members must retain their original portable paths: " + relative)
    if not path.resolve(strict=True).is_relative_to(root):
        raise ValueError("Study member leaves its original workspace: " + relative)
    _identity(path)
    return path


def _record_path(kind, key):
    _study_key(kind, key)
    if kind == "robust-decisions":
        from .decision_study_transfer import MEMBER
        return MEMBER
    if kind in IMMUTABLE_KINDS:
        return kind + "/" + key + ".json"
    if kind in DOCUMENTS:
        return kind + "/" + key + "/" + DOCUMENTS[kind]
    raise ValueError("Unknown scientific dependency kind: " + kind)


class _Closure:
    def __init__(self, workspace, selection, *, decision_database=None):
        self.workspace = workspace
        self.root = Path(workspace.root).resolve()
        self.selection = normalise(selection)
        self.files = {}
        self.nodes = {}
        self.pending = deque()
        self.expected = {}
        self._requested = set()
        self.trees = {}
        self.related_issues = []
        self.decision_database = decision_database
        self.decision_records = {}
        self.delivery_records = {}
        self.external_decision_dependencies = []

    def add_file(self, relative, expected=None):
        path = _member(self.root, relative)
        identity = _identity(path)
        previous = self.files.get(relative)
        if previous and previous["identity"] != identity:
            raise ValueError("Study member changed during selection: " + relative)
        value = previous or {"identity": identity, "bytes": identity[2]}
        if expected is not None:
            sha, size = expected.get("sha256"), expected.get("bytes")
            identifier(sha)
            if type(size) is not int or size < 0 or identity[2] != size:
                raise ValueError("The retained scientific file length differs: " + relative)
            if value.get("sha256") is not None and value["sha256"] != sha:
                raise ValueError("Scientific references disagree about a retained file: " + relative)
            value["sha256"] = sha
        self.files[relative] = value
        return path

    def read(self, relative):
        path = self.add_file(relative)
        before = self.files[relative]["identity"]
        raw = path.read_bytes()
        if _identity(path) != before:
            raise ValueError("Scientific record changed during selection: " + relative)
        value = json.loads(raw)
        actual = hashlib.sha256(raw).hexdigest()
        expected = self.files[relative].get("sha256")
        if expected is not None and expected != actual:
            raise ValueError("The retained scientific record differs from its source hash: " + relative)
        self.files[relative]["sha256"] = actual
        return value

    def _tree_members(self, prefix):
        folder = self.root.joinpath(*portable.member_name(prefix).parts)
        if folder.is_symlink() or not folder.is_dir():
            raise ValueError("The original scientific directory is missing: " + prefix)
        members = []
        for directory, folders, files in os.walk(folder, followlinks=False):
            base = Path(directory)
            for name in folders:
                if (base / name).is_symlink():
                    raise ValueError("Scientific directory contains a nonportable alias.")
            folders[:] = sorted(name for name in folders
                                if name not in {"__pycache__", "source-views"})
            for name in sorted(files):
                if name.endswith(".lock") or name.startswith((".write-", ".intake-", ".archive-")):
                    continue
                members.append((base / name).relative_to(self.root).as_posix())
        return sorted(members)

    def tree(self, prefix):
        members = self._tree_members(prefix)
        previous = self.trees.get(prefix)
        if previous is not None and previous != members:
            raise ValueError("The selected scientific directory changed: " + prefix)
        self.trees[prefix] = members
        for name in members:
            self.add_file(name)

    def exists(self, kind, key):
        path = self.root / _record_path(kind, key)
        return path.exists() or path.is_symlink()

    def need(self, kind, key, reason, *, required=True):
        key = _study_key(kind, key)
        token = (kind, key)
        if not self.exists(kind, key):
            if required:
                raise ValueError("The selected study needs its original " + kind + " record " + key + ".")
            self.expected.setdefault(token, {"kind": kind, "id": key, "reason": reason})
            return
        self.expected.pop(token, None)
        if token in self.nodes:
            if reason not in self.nodes[token]["reasons"]:
                self.nodes[token]["reasons"].append(reason)
            return
        if token not in self._requested:
            self._requested.add(token)
            self.pending.append((kind, key, reason))

    def _source_refs(self, value, reason, *, required=True):
        if isinstance(value, dict):
            # These are explicit original source-edition fields, not arbitrary hashes.
            for key in ("source_collection_id", "collection_id"):
                if key in value and value[key] is not None:
                    candidate = value[key]
                    if isinstance(candidate, str) and len(candidate) == 64:
                        self.need("sources", candidate, reason, required=required)
            for child in value.values():
                if isinstance(child, (dict, list)):
                    self._source_refs(child, reason, required=required)
        elif isinstance(value, list):
            for child in value:
                self._source_refs(child, reason, required=required)

    def _descriptors(self, value, prefix=""):
        if isinstance(value, dict):
            if {"path", "bytes", "sha256"}.issubset(value):
                relative = value["path"]
                portable.member_name(relative)
                self.add_file(prefix + relative, value)
            else:
                for child in value.values():
                    self._descriptors(child, prefix)
        elif isinstance(value, list):
            for child in value:
                self._descriptors(child, prefix)

    def _body(self, value):
        self.add_file(value["object"], value)

    def _native_selection(self, selection, reason, *, required=True):
        for field, kind in (("grid_id", "grids"), ("profile_id", "profiles"), ("scenario_id", "scenarios")):
            self.need(kind, selection[field], reason, required=required)

    def _immutable(self, kind, key, value, reason):
        if value.get("schema") != "upstate." + kind + "/v1" or digest(value) != key:
            raise ValueError("The retained " + kind + " record changed: " + key)
        if kind == "sources":
            self._body(value["original_manifest"])
            for entry in value["entries"]:
                self._body(entry["body"])
                for companion in entry.get("companions", []):
                    self._body(companion)
        elif kind in {"profiles", "scenarios"}:
            self.need("sources", value["source_collection_id"], reason)
            self._source_refs(value, reason)
            if kind == "profiles":
                derivation = value.get("experiment_derivation", {})
                if derivation.get("base_profile_id"):
                    self.need("profiles", derivation["base_profile_id"], "Original parameter derivation")
        elif kind == "observations":
            self._body(value["original"])
            self._source_refs(value.get("metadata", {}), reason)
        elif kind == "observation-comparisons":
            self.need("runs", value["run_id"], reason)
            self.need("observations", value["observation_id"], reason)
            self._source_refs(value["catchment_selection"], reason)

    def _experiment(self, key, plan, reason):
        if (plan.get("schema") != "upstate.experiment-plan/v1" or digest(plan) != key
                or plan.get("workspace_id") != self.workspace.project["id"]):
            raise ValueError("The experiment plan differs from this workspace.")
        prefix = "experiments/" + key + "/"
        state = self.read(prefix + "state.json")
        if state.get("id") != key or state.get("workspace_id") != self.workspace.project["id"]:
            raise ValueError("The experiment state differs from its original plan.")
        self.nodes[("experiments", key)]["state"] = state.get("state")
        selection, baseline = plan["selection"], plan["baseline"]
        self.need("runs", baseline["run_id"], "Experiment reference")
        self._native_selection(baseline, "Experiment reference")
        # Adopted producing-stage runs exist before any generated case is materialized.
        # Their actual immutable run selections remain the receiving authority.
        for run_id in selection.get("source_run_ids", []):
            self.need("runs", run_id, "Explicit adopted original experiment source")
        for profile_id in selection.get("profile_ids", []):
            self.need("profiles", profile_id, "Explicit experiment profile")
        for scenario_id in selection.get("scenario_ids", []):
            self.need("scenarios", scenario_id, "Explicit experiment scenario")
        self.tree(prefix.rstrip("/"))
        cases = sorted((self.root / prefix / "cases").glob("*.json"))
        for path in cases:
            case = self.read(path.relative_to(self.root).as_posix())
            if case.get("id") != path.stem or case.get("schema") != "upstate.experiment-case/v1":
                raise ValueError("The retained experiment case has a different identity.")
            complete = case.get("state") == "complete"
            native_selection = case["selection"]
            if digest(native_selection) != case["run_id"]:
                raise ValueError("The retained experiment case changed its native selection.")
            self.need("runs", case["run_id"], "Retained experiment case", required=complete)
            self.need("runs", case["baseline_run_id"], "Paired experiment baseline", required=complete)
            self._native_selection(native_selection, "Retained experiment case", required=complete)
            if case.get("comparison_id"):
                self.need("comparisons", case["comparison_id"], "Retained experiment comparison")
        planned = max(0, int(plan["counts"]["cases"]) - len(cases))
        if planned:
            self.nodes[("experiments", key)]["planned_cases"] = planned

    def _diagnostic(self, key, manifest, reason):
        if manifest.get("id") != key or digest(manifest.get("identity")) != key:
            raise ValueError("The scientific analysis changed its saved selection.")
        selection = manifest["identity"]["selection"]
        prefix = "experiment-diagnostics/" + key + "/"
        state = self.read(prefix + "state.json")
        if state.get("id") != key:
            raise ValueError("The scientific analysis state belongs to another selection.")
        self.nodes[("experiment-diagnostics", key)]["state"] = state.get("state")
        self.tree(prefix.rstrip("/"))
        for run_id in selection["run_ids"]:
            self.need("runs", run_id, "Scientific analysis run cohort")
        self.need("grids", selection["grid_id"], "Scientific analysis grid")
        self.need("profiles", selection["reference_profile_id"], "Scientific analysis reference")
        self.need("scenarios", selection["baseline_scenario_id"], "Scientific analysis baseline")
        for profile_id in selection.get("expected_profile_ids", []):
            self.need("profiles", profile_id, "Expected analysis profile", required=False)
        for scenario_id in selection.get("scenario_ids", []):
            self.need("scenarios", scenario_id, "Expected analysis scenario", required=False)
        campaign = selection.get("campaign_id")
        if isinstance(campaign, str) and len(campaign) == 64 and all(c in "0123456789abcdef" for c in campaign):
            self.need("experiments", campaign, "Original experiment programme", required=False)
        self._descriptors(state.get("report_artifact"))
        self._descriptors(state.get("archive_artifact"))
        report = None
        if state.get("report_artifact"):
            report = self.read(state["report_artifact"]["path"])
            self._descriptors(report.get("artifacts", {}))
        requests = {item["request_id"]: item for item in
                    (report or {}).get("observation_diagnostics", {}).get("requests", [])}
        for request in selection.get("observations", []):
            saved = requests.get(digest(request), {})
            source_complete = saved.get("source_roster_state") == "complete"
            compared = bool(saved.get("compared_profile_ids"))
            self.need("observations", request["observation_id"],
                      "Scientific analysis observation edition", required=source_complete)
            self._source_refs(request["catchments"], "Original observation catchments", required=compared)
        # Cached successful calls are authoritative even when report publication
        # was interrupted. Their original comparison records retain all inputs.
        for item in state.get("observation_calls", {}).values():
            self._descriptors(item)
            wrapper = self.read(item["path"])
            comparison_id = wrapper.get("comparison", {}).get("id")
            if comparison_id:
                self.need("observation-comparisons", comparison_id,
                          "Saved successful scientific observation call")

    def _decision(self, key, reason):
        from . import decision_study_transfer as decisions
        record = decisions.read(self.workspace, [key], database=self.decision_database)[key]
        self.decision_records[key] = record
        self.nodes[("robust-decisions", key)] = {
            "kind": "robust-decisions", "id": key, "title": record["study"]["title"],
            "state": "saved", "reasons": [reason],
            "revisions": len(record["revisions"]), "calculations": len(record["runs"]),
        }
        self.external_decision_dependencies.extend(decisions.dependencies(
            record, self.workspace.project["id"], external=True))
        for dependency in decisions.dependencies(record, self.workspace.project["id"]):
            self.need(dependency["kind"], dependency["id"], dependency["reason"],
                      required=dependency["required"])
        members = {**decisions.operation_members(self.workspace, [key]),
                   **decisions.diagnostic_members(self.workspace, record)}
        for relative, expected in members.items():
            self.add_file(relative, expected)

    def _visit(self, kind, key, reason):
        if kind == "robust-decisions":
            self._decision(key, reason)
            return
        prefix = kind + "/" + key + "/"
        value = self.read(_record_path(kind, key))
        title = (value.get("title") or value.get("metadata", {}).get("title")
                 or value.get("selection", {}).get("title")
                 or value.get("identity", {}).get("selection", {}).get("title")
                 or key[:12])
        node = {"kind": kind, "id": key, "title": title, "state": value.get("state"),
                "reasons": [reason]}
        self.nodes[(kind, key)] = node
        if delivery_transfer.visit(self, kind, key, value):
            pass
        elif kind in IMMUTABLE_KINDS:
            self._immutable(kind, key, value, reason)
        elif kind == "runs":
            if value.get("id") != key or digest(value["selection"]) != key:
                raise ValueError("The original native run selection changed.")
            self._native_selection(value["selection"], "Native run inputs")
            self.tree(prefix.rstrip("/"))
            self._descriptors(value.get("artifacts", {}), prefix)
            self._descriptors(value.get("stages", {}), prefix)
            from .model_selection import validate_completed_run
            validate_completed_run(value)
        elif kind == "grids":
            if (value.get("id") != key or digest({"spec": value["spec"], "grid": value["grid"]}) != key):
                raise ValueError("The original prepared grid changed its definition.")
            self._source_refs(value["spec"], "Original prepared grid sources")
            self.tree(prefix.rstrip("/"))
            self._descriptors(value.get("files", {}), prefix)
        elif kind == "experiments":
            self._experiment(key, value, reason)
        elif kind == "experiment-diagnostics":
            self._diagnostic(key, value, reason)
        elif kind == "comparisons":
            ids = [value["baseline_run_id"]] + [row["run_id"] for row in value["alternatives"]]
            if value.get("id") != key or digest({"runs": ids, "direction": value["direction"]}) != key:
                raise ValueError("The original native comparison changed its run cohort.")
            for run_id in ids:
                self.need("runs", run_id, "Native comparison cohort")
            self.tree(prefix.rstrip("/"))
            self._descriptors(value["alternatives"], prefix)

    def _related(self):
        runs = {key for kind, key in self.nodes if kind == "runs"}
        for path in sorted((self.root / "comparisons").glob("*/comparison.json")):
            if ("comparisons", path.parent.name) in self.nodes:
                continue
            try:
                value = read_json(path)
                if not isinstance(value, dict) or not isinstance(value.get("alternatives", []), list):
                    raise ValueError("The additional comparison is not an original comparison record.")
                if any(not isinstance(row, dict) for row in value.get("alternatives", [])):
                    raise ValueError("The additional comparison has an unreadable alternative.")
                ids = {value.get("baseline_run_id"), *(row.get("run_id") for row in value.get("alternatives", []))}
                if any(not isinstance(key, str) for key in ids):
                    raise ValueError("The additional comparison has unreadable native-run identities.")
            except (ValueError, TypeError, OSError) as error:
                self.related_issues.append({"path": path.relative_to(self.root).as_posix(), "message": str(error)})
                continue
            if len(ids) >= 2 and ids.issubset(runs):
                self.need("comparisons", path.parent.name, "Saved comparison within the selected cohort")
        for path in sorted((self.root / "observation-comparisons").glob("*.json")):
            try:
                value = read_json(path)
                if not isinstance(value, dict):
                    raise ValueError("The additional observation comparison is not an original record.")
            except (ValueError, OSError) as error:
                self.related_issues.append({"path": path.relative_to(self.root).as_posix(), "message": str(error)})
                continue
            if value.get("run_id") not in runs:
                continue
            self.need("observation-comparisons", path.stem, "Saved observation comparison for this study")

    def resolve(self, additional=()):
        self.read("workspace.json")
        for item in self.selection["roots"]:
            self.need(item["kind"], item["id"], "Selected study")
        for item in additional:
            kind = item.get("kind")
            if kind not in LABELS or type(item.get("required", True)) is not bool:
                raise ValueError("An investigation needs a known original scientific record.")
            self.need(kind, item["id"], item.get("reason") or "Retained investigation dependency",
                      required=item.get("required", True))
        while self.pending:
            self._visit(*self.pending.popleft())
        if self.selection["include_related_results"]:
            # A completed release can name another retained report/source cohort.
            # Resolve its typed descendants before discovering their saved comparisons.
            while True:
                count = len(self.nodes)
                self._related()
                delivery_transfer.related(self)
                while self.pending:
                    self._visit(*self.pending.popleft())
                if len(self.nodes) == count:
                    break
            self.related_issues = list({canonical(row): row for row in self.related_issues}.values())
        self.assert_unchanged()
        return self

    def assert_unchanged(self):
        if self.decision_records:
            from . import decision_study_transfer as decisions
            if digest(decisions.read(self.workspace, self.decision_records, database=self.decision_database)) != digest(self.decision_records):
                raise ValueError("The selected decision history changed during study capture.")
        for prefix, members in self.trees.items():
            if self._tree_members(prefix) != members:
                raise ValueError("The selected scientific directory changed: " + prefix)
        for relative, item in self.files.items():
            if _identity(_member(self.root, relative)) != item["identity"]:
                raise ValueError("The selected study changed during capture: " + relative)

    def plan(self):
        counters = Counter()
        byte_totals = Counter()
        node_sizes = Counter()
        node_files = Counter()
        for relative, item in self.files.items():
            kind = relative.split("/", 1)[0]
            counters[kind] += 1
            byte_totals[kind] += item["bytes"]
            parts = relative.split("/")
            if len(parts) >= 2:
                key = parts[1][:-5] if kind in IMMUTABLE_KINDS and parts[1].endswith(".json") else parts[1]
                node_files[(kind, key)] += 1
                node_sizes[(kind, key)] += item["bytes"]
        nodes = []
        for (kind, key), row in sorted(self.nodes.items()):
            value = copy.deepcopy(row)
            value["files"] = node_files[(kind, key)]
            value["bytes"] = node_sizes[(kind, key)]
            nodes.append(value)
        snapshot = {
            "project_id": self.workspace.project["id"], "selection": self.selection,
            "decision_history_sha256": digest(self.decision_records),
            "files": [[name, list(item["identity"]), item.get("sha256")]
                      for name, item in sorted(self.files.items())],
        }
        return {
            "schema": PLAN_SCHEMA, "project": self.workspace.project,
            "selection": self.selection, "preview_token": digest(snapshot),
            "files": len(self.files), "bytes": sum(item["bytes"] for item in self.files.values()),
            "source_object_bytes": byte_totals["objects"], "native_run_bytes": byte_totals["runs"],
            "groups": [{"kind": kind, "title": LABELS.get(kind, kind.replace("-", " ").capitalize()),
                        "files": counters[kind], "bytes": byte_totals[kind],
                        "records": sum(row["kind"] == kind for row in nodes)}
                       for kind in sorted(counters)],
            "nodes": nodes, "expected_unmaterialized": sorted(self.expected.values(), key=lambda row: (row["kind"], row["id"])),
            "planned_cases": sum(row.get("planned_cases", 0) for row in nodes),
            "related_result_issues": self.related_issues,
            "external_decision_dependencies": self.external_decision_dependencies,
            "completed_deliveries": delivery_transfer.receipt(self),
            "decision_history": {"studies": len(self.decision_records),
                                 "revisions": sum(len(row["revisions"]) for row in self.decision_records.values()),
                                 "calculations": sum(len(row["runs"]) for row in self.decision_records.values())},
            "application": "The receiving archive includes the maintained application source.",
        }


def preview(workspace, selection):
    """Read metadata and file sizes; scientific rasters are not rehashed."""
    return _Closure(workspace, selection).resolve().plan()


def _capture_locks(stack, closure, already):
    for kind, key in sorted(closure.nodes):
        if kind not in LOCKS or (kind, key) in already:
            continue
        stack.enter_context(held(closure.root / kind / key / LOCKS[kind], blocking=False))
        already.add((kind, key))


def _stage_file(source, target, expected, linked_inodes):
    target.parent.mkdir(parents=True, exist_ok=True)
    before = _identity(source)
    if before != expected["identity"] and not (
            before[:2] in linked_inodes and _stable_data_identity(before) == _stable_data_identity(expected["identity"])):
        raise ValueError("The original study member changed before capture.")
    try:
        os.link(source, target, follow_symlinks=False)
        linked_inodes.add(before[:2])
    except OSError as error:
        if error.errno not in {errno.EXDEV, errno.EPERM, errno.EACCES, errno.EMLINK, errno.ENOTSUP}:
            raise
        # Cross-device receiving keeps one streaming copy, with stable-byte checks.
        with source.open("rb") as src, target.open("xb") as out:
            shutil.copyfileobj(src, out, 1024 * 1024)
            out.flush()
            os.fsync(out.fileno())
        if _identity(source) != before:
            raise ValueError("The original study member changed while it was copied.")
    after = _identity(source)
    if _stable_data_identity(after) != _stable_data_identity(before):
        raise ValueError("The original study member changed during staging.")
    return after


def _receipt_from_archive(path, manifest):
    candidates = [name for name in manifest["members"]
                  if name.startswith("workspace/study-transfers/") and name.endswith(".json")]
    if len(candidates) != 1:
        raise ValueError("The selected-study archive needs its original study receipt.")
    with zipfile.ZipFile(path) as archive:
        receipt = json.loads(archive.read(candidates[0]))
    if receipt.get("schema") != RECEIPT_SCHEMA or digest(receipt["identity"]) != receipt.get("id"):
        raise ValueError("The study transfer receipt changed its original identity.")
    if receipt["identity"]["project_id"] != manifest["project"]["id"]:
        raise ValueError("The study transfer belongs to a different original workspace.")
    return receipt


def inspect_transfer_archive(path, *, verify=True):
    manifest = portable.inspect_archive(path, verify=verify)
    return {"manifest": manifest, "study": _receipt_from_archive(path, manifest)}


def _prepare_investigation_snapshot(workspace):
    """Use the installed original project's snapshot implementation for CLI exports."""
    database = Path(workspace.root) / "intelligence" / "investigations.sqlite3"
    if not database.exists():
        return None
    _member(Path(workspace.root).resolve(), "intelligence/investigations.sqlite3")
    try:
        from eco_intelligence.study_transfer import prepare_workspace_study_snapshot
    except ModuleNotFoundError as error:
        if error.name not in {"eco_intelligence", "eco_intelligence.study_transfer"}:
            raise
        raise ValueError("Receive the original scientific investigation source with this workspace.") from error
    return prepare_workspace_study_snapshot(workspace)


def _investigation_dependencies(workspace, snapshot, plan):
    if snapshot is None:
        return []
    prepare = getattr(snapshot, "prepare", None)
    if not callable(prepare):
        raise ValueError("Receive the matching selected-study investigation dependency adapter.")
    prepared = prepare(plan)
    if (not isinstance(prepared, dict)
            or prepared.get("project_id") != workspace.project["id"]):
        raise ValueError("The investigation dependency selection belongs to another workspace.")
    rows = prepared.get("scientific_dependencies")
    if not isinstance(rows, list):
        raise ValueError("The investigation selection needs its original scientific dependencies.")
    selected = {}
    for row in rows:
        if not isinstance(row, dict) or row.get("kind") not in LABELS:
            raise ValueError("An investigation dependency has an unknown scientific record kind.")
        key = (row["kind"], _study_key(row["kind"], row.get("id")))
        required = row.get("required", True)
        if type(required) is not bool:
            raise ValueError("A scientific dependency must state whether its record is materialized.")
        reason = row.get("reason") or "Retained investigation dependency"
        if not isinstance(reason, str):
            raise ValueError("A scientific dependency needs its original selection reason.")
        previous = selected.get(key)
        selected[key] = {"kind": key[0], "id": key[1], "reason": reason,
                         "required": required or bool(previous and previous["required"])}
    return [selected[key] for key in sorted(selected)]


def _captured_investigations(staged, snapshot):
    if snapshot is None:
        return None, {}
    if not isinstance(snapshot, dict) or snapshot.get("project_id") != staged.project["id"]:
        raise ValueError("The investigation snapshot belongs to a different scientific workspace.")
    members = snapshot.get("members")
    if not isinstance(members, list):
        raise ValueError("The original investigation snapshot needs its retained member descriptors.")
    captured = {}
    for member in members:
        if not isinstance(member, dict):
            raise ValueError("An investigation snapshot member is unreadable.")
        path, size, sha = member.get("path"), member.get("bytes"), member.get("sha256")
        if not isinstance(path, str) or type(size) is not int or size < 0:
            raise ValueError("An investigation snapshot member needs its original path and size.")
        identifier(sha)
        retained = _member(Path(staged.root).resolve(), path)
        if retained.stat().st_size != size:
            raise ValueError("The captured investigation member length changed: " + path)
        # Retain original mutable/immutable member semantics for later receiving.
        descriptor = copy.deepcopy(member)
        descriptor.pop("path")
        if path in captured and captured[path] != descriptor:
            raise ValueError("Investigation snapshot descriptors disagree: " + path)
        captured[path] = descriptor
    original = copy.deepcopy(snapshot)
    original["members"] = [{"path": path, **item} for path, item in sorted(captured.items())]
    canonical(original)
    return original, captured


def export_study(workspace, destination, selection, *, progress=None, investigation_snapshot=None):
    """Freeze one selected dependency closure and publish an original archive.

    The original portable writer hashes and verifies all retained members. Native
    directories use their original locks; the temporary workspace is read only.
    A completed destination is reusable for the identical original selection.
    """
    from .workspace import Workspace
    normal = normalise(selection)
    destination = Path(destination).absolute()
    destination.parent.mkdir(parents=True, exist_ok=True)

    def report(phase, **values):
        if progress:
            progress({"phase": phase, **values})

    if destination.exists():
        previous = inspect_transfer_archive(destination, verify=True)
        if (previous["study"]["identity"]["selection"] != normal
                or previous["manifest"]["project"] != workspace.project):
            raise ValueError("This retained archive belongs to a different study selection.")
        from .common import file_digest
        result = {"id": previous["study"]["id"], "project_id": workspace.project["id"],
                  "path": str(destination), "bytes": destination.stat().st_size,
                  "sha256": file_digest(destination), "members": len(previous["manifest"]["members"]),
                  "study": previous["study"], "reused_completed_output": True}
        report("complete", archive_bytes=result["bytes"], id=result["id"], reused_completed_output=True)
        return result

    # Bind the original Store before the exclusive guard: its normal connections
    # acquire that same workspace guard in shared mode.
    if investigation_snapshot is None:
        investigation_snapshot = _prepare_investigation_snapshot(workspace)

    with contextlib.ExitStack() as stack:
        root = Path(workspace.root).resolve()
        stack.enter_context(held(root / ".workspace.lock", blocking=False))
        stack.enter_context(held(root / ".native-model-batch.lock", blocking=False))
        report("resolving")
        decision_database = None
        if any(row["kind"] == "robust-decisions" for row in normal["roots"]):
            from . import decision_study_transfer as decisions
            decision_database = stack.enter_context(decisions.source_snapshot(
                workspace, directory=root.parent))
        closure = _Closure(workspace, normal, decision_database=decision_database).resolve()
        original_plan = closure.plan()
        # Freeze the initially selected conversation cohort once, before its
        # science dependencies expand the selected record closure.
        dependencies = _investigation_dependencies(
            workspace, investigation_snapshot, original_plan)
        if dependencies:
            closure = _Closure(workspace, normal, decision_database=decision_database).resolve(dependencies)
        locked = set()
        # The first read discovers owners; repeat under their original locks.
        _capture_locks(stack, closure, locked)
        closure = _Closure(workspace, normal, decision_database=decision_database).resolve(dependencies)
        _capture_locks(stack, closure, locked)
        closure.assert_unchanged()
        plan = closure.plan()
        expected_token = selection.get("preview_token")
        changed = bool(expected_token and expected_token != original_plan["preview_token"])
        stage_parent = Path(stack.enter_context(tempfile.TemporaryDirectory(
            prefix=".study-workspace-", dir=root.parent)))
        output_parent = Path(stack.enter_context(tempfile.TemporaryDirectory(
            prefix=".study-archive-", dir=destination.parent)))
        stage_root = stage_parent / "workspace"
        stage_root.mkdir()
        report("staging", files=plan["files"], bytes=plan["bytes"], preview_changed=changed)
        linked_inodes = set()
        for ordinal, (relative, item) in enumerate(sorted(closure.files.items()), 1):
            source = _member(root, relative)
            _stage_file(source, stage_root / relative, item, linked_inodes)
            if ordinal == plan["files"] or ordinal % 100 == 0:
                report("staging", copied_files=ordinal, files=plan["files"], bytes=plan["bytes"])
        for relative, item in closure.files.items():
            observed = _identity(_member(root, relative))
            if _stable_data_identity(observed) != _stable_data_identity(item["identity"]):
                raise ValueError("The original study changed while its native members were staged.")
            item["identity"] = observed
        closure.assert_unchanged()
        staged = Workspace(stage_root)
        decision_history, decision_members = None, {}
        if closure.decision_records:
            from . import decision_study_transfer as decisions
            report("decisions", studies=len(closure.decision_records))
            decision_history, decision_members = decisions.capture(
                workspace, staged, closure.decision_records, database=closure.decision_database)
            closure.assert_unchanged()
        investigations, investigation_members = None, {}
        if investigation_snapshot is not None:
            report("investigations", files=plan["files"], bytes=plan["bytes"])
            investigations, investigation_members = _captured_investigations(
                staged, investigation_snapshot(staged, plan))
            closure.assert_unchanged()
        snapshot_members = {**decision_members, **investigation_members}
        additional = {path: value for path, value in snapshot_members.items() if path not in closure.files}
        source_files = plan["files"] + len(additional)
        source_bytes = plan["bytes"] + sum(value["bytes"] for value in additional.values())
        identity = {
            "project_id": workspace.project["id"], "selection": normal,
            "source_preview_token": plan["preview_token"],
            "nodes": [{"kind": row["kind"], "id": row["id"]} for row in plan["nodes"]],
            "expected_unmaterialized": plan["expected_unmaterialized"],
            "planned_cases": plan["planned_cases"],
            "related_result_issues": plan["related_result_issues"],
        }
        if closure.delivery_records:
            identity["completed_deliveries"] = delivery_transfer.receipt(closure)
        if dependencies:
            identity["investigation_dependencies"] = dependencies
        if investigations is not None:
            identity["investigations"] = investigations
        if decision_history is not None:
            identity["decision_history"] = decision_history
            identity["external_decision_dependencies"] = plan["external_decision_dependencies"]
        transfer_id = digest(identity)
        receipt = {
            "schema": RECEIPT_SCHEMA, "id": transfer_id, "identity": identity,
            "title": normal["title"], "captured_at": now(),
            "source_files": source_files, "source_bytes": source_bytes,
            "groups": plan["groups"], "preview_changed": changed,
            "receiving": "Original workspace restore; reopen the received workspace and continue its saved studies.",
        }
        atomic_json(stage_root / "study-transfers" / (transfer_id + ".json"), receipt, immutable=True)
        report("archiving", files=source_files, bytes=source_bytes)
        archive_path = output_parent / "study.zip"
        # This private, closed SQLite snapshot already has the original history
        # receipt's content identity. Keep those exact bytes in the native ZIP.
        frozen_databases = {
            "workspace/" + member["path"]: {
                "bytes": member["bytes"], "sha256": member["sha256"],
            }
            for member in [
                *(investigations or {}).get("members", []),
                *(decision_history or {}).get("members", []),
            ]
            if member["path"] in {"intelligence/investigations.sqlite3",
                                   "robust_decisions/robust_decisions.sqlite3"}
        }
        result = portable.backup(
            staged, archive_path, include_intermediates=True, include_deliveries=True,
            frozen_databases=frozen_databases)
        manifest = portable.inspect_archive(archive_path, verify=False)
        for relative, item in {**closure.files, **snapshot_members}.items():
            retained = manifest["members"].get("workspace/" + relative)
            if retained is None or retained["bytes"] != item["bytes"]:
                raise ValueError("The original archive omitted a selected scientific member: " + relative)
            if item.get("sha256") and retained["sha256"] != item["sha256"]:
                raise ValueError("The original scientific source bytes changed: " + relative)
        closure.assert_unchanged()
        report("publishing", archive_bytes=result["bytes"])
        os.link(archive_path, destination)
        directory_fd = os.open(destination.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
        result.update(id=transfer_id, path=str(destination), study=receipt,
                      source_files=source_files, source_bytes=source_bytes)
        report("complete", archive_bytes=result["bytes"], id=transfer_id)
        return result


def verify_received_studies(workspace):
    """Validate selected-study records during the original receiving operation."""
    result = []
    for path in sorted((workspace.root / "study-transfers").glob("*.json")):
        receipt = read_json(path)
        if (receipt.get("schema") != RECEIPT_SCHEMA or receipt.get("id") != path.stem
                or digest(receipt.get("identity")) != path.stem
                or receipt["identity"]["project_id"] != workspace.project["id"]):
            raise ValueError("The received scientific study has a different original identity.")
        closure = _Closure(workspace, receipt["identity"]["selection"]).resolve(
            receipt["identity"].get("investigation_dependencies", ()))
        delivery_transfer.verify_receipt(closure, receipt["identity"].get("completed_deliveries", []))
        present = set(closure.nodes)
        required = {(row["kind"], row["id"]) for row in receipt["identity"]["nodes"]}
        if not required.issubset(present):
            raise ValueError("The received scientific study lost an original dependency.")
        investigations = receipt["identity"].get("investigations")
        history = None
        if investigations is not None:
            from eco_intelligence.study_transfer import verify_received_investigations
            history = verify_received_investigations(workspace, investigations)
        decision_history = None
        if receipt["identity"].get("decision_history") is not None:
            from .decision_study_transfer import verify_received
            decision_history = verify_received(workspace, receipt["identity"]["decision_history"])
        result.append({"id": receipt["id"], "title": receipt["title"],
                       "retained_records": len(required), "identity": "MATCH",
                       "investigations": history, "decision_history": decision_history})
    return result


def catalog(workspace, *, kind=None, query="", offset=0, limit=200):
    if kind not in (None, "", *ROOT_KINDS):
        raise ValueError("Choose analyses, programmes, native runs or decision studies.")
    if type(offset) is not int or offset < 0 or type(limit) is not int or limit < 1 or limit > 1000:
        raise ValueError("Use a nonnegative offset and a page size from 1 to 1000.")
    query = str(query).strip().casefold()
    rows = []
    for selected_kind in ROOT_KINDS:
        if kind and selected_kind != kind:
            continue
        if selected_kind == "robust-decisions":
            from .decision_study_transfer import catalogue
            for row in catalogue(workspace):
                if not query or query in canonical(row).decode("utf-8").casefold():
                    rows.append(row)
            continue
        document = DOCUMENTS[selected_kind]
        for path in (workspace.root / selected_kind).glob("*/" + document):
            key = path.parent.name
            try:
                identifier(key)
                value = read_json(_member(workspace.root, path.relative_to(workspace.root).as_posix()))
                if selected_kind == "experiment-diagnostics":
                    selection = value["identity"]["selection"]
                    state = read_json(_member(workspace.root, selected_kind + "/" + key + "/state.json"))
                elif selected_kind == "experiments":
                    selection = value["selection"]
                    state = read_json(_member(workspace.root, selected_kind + "/" + key + "/state.json"))
                else:
                    selection, state = value["selection"], value
                row = {"kind": selected_kind, "id": key,
                       "title": selection.get("title") or state.get("title") or key[:12],
                       "state": state.get("state"), "updated_at": state.get("updated_at") or
                       state.get("completed_at") or state.get("created_at") or "",
                       "selection": {name: selection[name] for name in
                                     ("grid_id", "profile_id", "scenario_id", "models", "design", "baseline_run_id")
                                     if name in selection},
                       "counts": state.get("counts"), "error": state.get("error")}
                if selected_kind == "runs":
                    labels = []
                    for field, source_kind in (("profile_id", "profiles"), ("scenario_id", "scenarios")):
                        record = workspace._get(source_kind, selection[field])
                        labels.append(record.get("title") or record["id"][:12])
                    row["title"] = " / ".join(labels)
                    row["models"] = selection.get("models", ["ndr", "sdr"])
                if query and query not in canonical(row).decode("utf-8").casefold():
                    continue
            except Exception as error:
                row = {"kind": selected_kind, "id": key, "title": key[:12], "state": "unreadable",
                       "updated_at": "", "error": {"type": type(error).__name__, "message": str(error)}}
                if query and query not in canonical(row).decode("utf-8").casefold():
                    continue
            rows.append(row)
    rows.sort(key=lambda row: (row["updated_at"], row["kind"], row["id"]), reverse=True)
    selected = rows[offset:offset + limit]
    next_offset = offset + len(selected)
    return {"schema": "upstate.study-catalog/v1", "project": workspace.project,
            "items": selected, "total": len(rows), "offset": offset, "limit": limit,
            "next_offset": next_offset if next_offset < len(rows) else None}
