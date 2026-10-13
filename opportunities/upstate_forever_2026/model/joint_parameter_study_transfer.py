"""Original joint-design dependencies for selected studies and full receiving.

This module reads the frozen design, original profile/experiment bindings and
retained output bytes. It does not sample, prepare, execute or rewrite a study.
"""
from __future__ import annotations

from copy import deepcopy
import os
from pathlib import Path
import stat

from .common import digest, file_digest, identifier, read_json
from . import experiments, joint_parameter_studies as studies

KIND = studies.DIRECTORY
ROOT_KINDS = (KIND,)
DOCUMENTS = {KIND: "definition.json"}
LOCKS = {KIND: ".joint-study.lock"}
LABELS = {KIND: "Joint parameter studies"}
SCHEMA = "upstate.joint-parameter-portable/v1"


def _directory(workspace, key):
    identifier(key)
    root = Path(workspace.root) / KIND
    directory = root / key
    if root.is_symlink() or directory.is_symlink() or not directory.is_dir():
        raise ValueError("Retain the original ordinary joint-study directory")
    return directory


def _files(workspace, directory, verified_members=None):
    """Bind each retained file to its original bytes and any archive descriptor."""
    result = {}
    for current, folders, names in os.walk(directory, followlinks=False):
        current = Path(current)
        for name in folders:
            if (current / name).is_symlink():
                raise ValueError("A joint-study directory contains a nonportable alias")
        folders[:] = sorted(name for name in folders if name not in {"__pycache__", "source-views"})
        for name in sorted(names):
            if (name.endswith((".lock", ".pyc", ".pyo"))
                    or name.startswith((".write-", ".intake-", ".archive-", ".native-reserve-",
                                        ".native-recovery-reserve"))):
                continue
            path = current / name
            before = path.lstat()
            if not stat.S_ISREG(before.st_mode):
                raise ValueError("A joint-study member must remain a regular original file")
            relative = path.relative_to(workspace.root).as_posix()
            item = {"bytes": before.st_size, "sha256": file_digest(path)}
            after = path.lstat()
            if ((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns)
                    != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns)):
                raise ValueError("A joint-study member changed during verification: " + relative)
            if verified_members is not None:
                captured = verified_members.get("workspace/" + relative)
                if captured is None:
                    captured = verified_members.get(relative)
                if (not isinstance(captured, dict)
                        or any(captured.get(field) != value for field, value in item.items())):
                    raise ValueError("The archive omitted or changed an original joint-study member: " + relative)
            result[relative] = item
    return result


def _marker(workspace, path):
    if path.is_symlink() or not path.is_file():
        raise ValueError("Retain the original regular experiment joint-study marker")
    value = read_json(path)
    key = identifier(value.get("study_id"))
    experiment_id = identifier(value.get("experiment_id"))
    if (path.parent.name != experiment_id or value != {
            "schema": "upstate.joint-parameter-experiment/v1",
            "study_id": key, "experiment_id": experiment_id,
            "definition_sha256": key}):
        raise ValueError("An experiment changed its complete original joint-study binding")
    return value


def _links(workspace, key):
    """Find only this study's original typed experiment marker."""
    result = []
    for path in sorted((workspace.root / "experiments").glob("*/joint-parameter-study.json")):
        raw = read_json(path)
        if isinstance(raw, dict) and raw.get("study_id") == key:
            result.append(_marker(workspace, path))
    return result


def _analysis_pointer(workspace, directory, key, experiment_id, files):
    path = directory / "analysis-current.json"
    if not path.exists() and not path.is_symlink():
        return
    if path.is_symlink() or not path.is_file() or not experiment_id:
        raise ValueError("The original analysis pointer lost its prepared native experiment")
    value = read_json(path)
    if (not isinstance(value, dict)
            or value.get("schema") != "upstate.joint-parameter-analysis-files/v1"
            or value.get("study_id") != key or value.get("experiment_id") != experiment_id):
        raise ValueError("The retained analysis pointer belongs to another original study")
    summary_sha = value.get("summary_sha256")
    if (not isinstance(summary_sha, str) or len(summary_sha) != 64
            or any(letter not in "0123456789abcdef" for letter in summary_sha)):
        raise ValueError("Retain the original complete summary SHA in the analysis pointer")
    downloads = value.get("files")
    if not isinstance(downloads, dict) or "analysis" not in downloads or not downloads:
        raise ValueError("The analysis pointer lost its complete original downloads")
    scope = None
    seen = set()
    prefix = KIND + "/" + key + "/"
    for descriptor in downloads.values():
        if not isinstance(descriptor, dict):
            raise ValueError("The original analysis download is not a complete descriptor")
        relative = descriptor.get("path")
        parts = relative.split("/") if isinstance(relative, str) else []
        if (len(parts) != 4 or parts[0] != "analyses" or parts[1] != summary_sha
                or len(parts[2]) != 64 or any(letter not in "0123456789abcdef" for letter in parts[2])
                or not parts[3] or parts[3] in (".", "..") or "\\" in relative
                or relative in seen):
            raise ValueError("An analysis download escaped or changed its original retained edition")
        seen.add(relative)
        if scope is not None and scope != parts[2]:
            raise ValueError("The original analysis pointer mixes different analysis editions")
        scope = parts[2]
        expected = {"bytes": descriptor.get("bytes"), "sha256": descriptor.get("sha256")}
        if (type(expected["bytes"]) is not int or expected["bytes"] < 0
                or files.get(prefix + relative) != expected):
            raise ValueError("A declared original analysis download is missing or changed: " + relative)
    if downloads["analysis"]["path"].split("/")[-1] != "joint-analysis.json":
        raise ValueError("The original analysis pointer changed its complete JSON download")
    analysis = read_json(directory / downloads["analysis"]["path"])
    if (not isinstance(analysis, dict) or digest(analysis) != scope
            or analysis.get("study_id") != key or analysis.get("definition_sha256") != key
            or analysis.get("experiment_id") != experiment_id
            or analysis.get("workspace_id") != workspace.project["id"]):
        raise ValueError("The retained complete analysis changed its original scientific identity")
    # A stale original summary remains a valid historical edition. Do not compare
    # this pointer with today's native summary or regenerate any analysis.

def _snapshot(workspace, key, verified_members=None):
    directory = _directory(workspace, key)
    files = _files(workspace, directory, verified_members)
    definition_name = KIND + "/" + key + "/definition.json"
    if definition_name not in files:
        if files:
            raise ValueError("Retained joint-study files require their complete frozen definition")
        return None  # The original mkdir-before-definition boundary has no archive members.
    definition = studies._definition(workspace, key)
    state_path = directory / "state.json"
    state = None
    checked = None
    if state_path.exists() or state_path.is_symlink():
        if state_path.is_symlink() or not state_path.is_file():
            raise ValueError("The original joint-study state is not a regular file")
        state = read_json(state_path)
        checked = studies.inspect(workspace, key)
    elif set(files) != {definition_name}:
        raise ValueError("A definition-only joint study cannot already contain later outputs")
    links = _links(workspace, key)
    if len(links) > 1:
        raise ValueError("A frozen joint design is bound to more than one original experiment")
    experiment_id = state.get("experiment_id") if state else None
    if links:
        linked_id = links[0]["experiment_id"]
        rows = state.get("samples", []) if state else []
        if len(rows) != len(definition["samples"]):
            raise ValueError("A prepared experiment lost its complete original sample map")
        selected = deepcopy(definition["experiment_selection"])
        selected["profile_ids"] = list(dict.fromkeys(row["profile_id"] for row in rows))
        original = experiments.inspect(workspace, linked_id, offset=0, limit=1)
        if original["selection"] != selected or (experiment_id and experiment_id != linked_id):
            raise ValueError("The original joint experiment changed its complete native selection")
        # A kill after marker publication but before state publication is valid.
        # Retain that original experiment without changing state.json.
        experiment_id = linked_id
    elif experiment_id:
        raise ValueError("A prepared joint study lost its original experiment marker")
    _analysis_pointer(workspace, directory, key, experiment_id, files)
    rows = state.get("samples", []) if state else []
    record = {"schema": SCHEMA, "study_id": key, "definition_sha256": key,
              "workspace_id": workspace.project["id"],
              "state_sha256": digest(state) if state is not None else None,
              "preparation_state": state.get("state") if state else "definition_retained",
              "sample_map": deepcopy(rows), "sample_map_sha256": digest(rows), "prepared_samples": len(rows),
              "declared_samples": len(definition["samples"]),
              "profile_ids": list(dict.fromkeys(row["profile_id"] for row in rows)),
              "experiment_id": experiment_id, "experiment_markers": links,
              "files": files}
    return {"record": record, "definition": definition, "state": state, "checked": checked}


def verify_workspace(workspace, verified_members=None):
    """Verify complete and interrupted original studies without advancing them."""
    root = workspace.root / KIND
    if root.is_symlink():
        raise ValueError("The joint-study root must remain its original directory")
    records = []
    if root.exists():
        if not root.is_dir():
            raise ValueError("The joint-study root is not a directory")
        for directory in sorted(root.iterdir()):
            if directory.is_symlink() or not directory.is_dir():
                raise ValueError("The joint-study root contains a non-native record")
            key = identifier(directory.name)
            snapshot = _snapshot(workspace, key, verified_members)
            if snapshot is not None:
                records.append(snapshot["record"])
    keys = {row["study_id"] for row in records}
    for path in sorted((workspace.root / "experiments").glob("*/joint-parameter-study.json")):
        marker = _marker(workspace, path)
        if marker["study_id"] not in keys:
            raise ValueError("A retained native experiment lost its complete frozen joint design")
    return records


def workspace_lock_paths(root):
    """Acquire the original study owner locks before original experiment locks."""
    root = Path(root) / KIND
    if root.is_symlink():
        raise ValueError("The joint-study root is an alias")
    if not root.exists():
        return
    if not root.is_dir():
        raise ValueError("The joint-study root is not a directory")
    for directory in sorted(root.iterdir()):
        if directory.is_symlink() or not directory.is_dir():
            raise ValueError("A joint-study owner directory changed")
        identifier(directory.name)
        yield directory / ".joint-study.lock"


def visit(closure, kind, key, value):
    if kind != KIND:
        return False
    snapshot = _snapshot(closure.workspace, key)
    if snapshot is None or snapshot["definition"] != value:
        raise ValueError("The selected joint study changed its frozen definition")
    record = snapshot["record"]
    definition = snapshot["definition"]
    closure.tree(KIND + "/" + key)
    # Hashes from the typed verifier join the original native file collector.
    for relative, descriptor in record["files"].items():
        closure.add_file(relative, descriptor)
    baseline = definition["baseline"]
    closure.need("runs", baseline["baseline_run_id"], "Original completed joint-study baseline")
    closure.need("grids", baseline["grid_id"], "Original joint-study grid")
    closure.need("profiles", baseline["baseline_profile_id"], "Original sampled profile reference")
    closure.need("scenarios", baseline["baseline_scenario_id"], "Original baseline land cover")
    for scenario_id in definition["specification"]["scenario_ids"]:
        closure.need("scenarios", scenario_id, "Original joint-study land-cover alternative")
    for source_id in definition["experiment_selection"].get("source_run_ids", []):
        closure.need("runs", source_id, "Original explicitly adopted native source")
    for profile_id in record["profile_ids"]:
        closure.need("profiles", profile_id, "Original sampled native profile")
    if record["experiment_id"]:
        closure.need("experiments", record["experiment_id"], "Original joint native experiment")
    closure._source_refs(definition, "Original sourced joint design")
    closure.nodes[(kind, key)].update(
        title=definition["specification"]["title"],
        state=(snapshot["checked"] or {}).get("state", record["preparation_state"]))
    records = getattr(closure, "joint_parameter_records", None)
    if records is None:
        records = closure.joint_parameter_records = {}
    records[key] = record
    return True


def include_experiment(closure, key):
    if not getattr(closure, "joint_parameter_lineage_enabled", True):
        return
    path = closure.root / "experiments" / key / "joint-parameter-study.json"
    if not path.exists() and not path.is_symlink():
        return
    value = _marker(closure.workspace, path)
    closure.read(path.relative_to(closure.root).as_posix())
    closure.need(KIND, value["study_id"], "Frozen design behind the original native experiment")


def include_profile(closure, key, value):
    if not getattr(closure, "joint_parameter_lineage_enabled", True):
        return
    derivation = value.get("joint_parameter_derivation")
    if derivation is None:
        return
    if not isinstance(derivation, dict):
        raise ValueError("The sampled native profile lost its original derivation")
    study_id = identifier(derivation.get("study_id"))
    definition = studies._definition(closure.workspace, study_id)
    matches = [row for row in definition["samples"] if row["overrides"] == derivation.get("overrides")]
    if not matches:
        raise ValueError("The native profile is not a retained joint sample")
    base = closure.workspace._get("profiles", definition["baseline"]["baseline_profile_id"])
    expected = studies._profile(base, definition, study_id, matches[0])
    expected["schema"] = "upstate.profiles/v1"
    expected["table_summary"] = deepcopy(base["table_summary"])
    if digest(expected) != key:
        raise ValueError("The native sampled profile differs from its frozen joint design")
    closure.need(KIND, study_id, "Frozen design behind the sampled native profile")


def lock_paths(closure):
    for kind, key in sorted(closure.nodes):
        if kind == KIND:
            yield KIND + "/" + key + "/.joint-study.lock"


def receipt(closure):
    records = getattr(closure, "joint_parameter_records", {})
    return [deepcopy(records[key]) for key in sorted(records)]


def verify_receipt(closure, retained):
    """Keep a historical capture valid as its original preparation continues.

    The archive manifest still verifies every captured byte. This receipt binds
    the immutable design and already-published sample prefix, while preserving
    its historical state and analysis pointer instead of relabelling them current.
    """
    if not isinstance(retained, list):
        raise ValueError("Retain the complete original joint-study receipts")
    current = {row["study_id"]: row for row in receipt(closure)}
    seen = set()
    for original in retained:
        if not isinstance(original, dict):
            raise ValueError("The original joint-study receipt is not a record")
        key = identifier(original.get("study_id"))
        if key in seen or key not in current:
            raise ValueError("The original joint-study receipt is repeated or absent")
        seen.add(key)
        actual = current[key]
        for field in ("schema", "study_id", "definition_sha256", "workspace_id", "declared_samples"):
            if original.get(field) != actual[field]:
                raise ValueError("The original frozen joint-study identity changed")
        rows = original.get("sample_map")
        if (not isinstance(rows, list) or original.get("prepared_samples") != len(rows)
                or original.get("sample_map_sha256") != digest(rows)
                or rows != actual["sample_map"][:len(rows)]
                or original.get("profile_ids") != list(dict.fromkeys(row["profile_id"] for row in rows))):
            raise ValueError("An original joint-study sample was lost, replaced or reordered")
        if original.get("experiment_id") is not None:
            if (original["experiment_id"] != actual["experiment_id"]
                    or original.get("experiment_markers") != actual["experiment_markers"]):
                raise ValueError("The original prepared joint experiment changed")
        elif original.get("experiment_markers"):
            raise ValueError("A historical unprepared study declares an experiment marker")
        files = original.get("files")
        prefix = KIND + "/" + key + "/"
        if (not isinstance(files, dict) or prefix + "definition.json" not in files):
            raise ValueError("The original joint receipt lost its complete frozen definition")
        for relative, descriptor in files.items():
            if not isinstance(relative, str) or not relative.startswith(prefix):
                raise ValueError("A joint receipt claims another original study's file")
            # Only these two original publications are mutable. The full archive
            # retains their captured bytes; the live workspace may have advanced.
            if relative in (prefix + "state.json", prefix + "analysis-current.json"):
                continue
            if actual["files"].get(relative) != descriptor:
                raise ValueError("An immutable original joint-study member changed: " + relative)
    if seen != set(current):
        raise ValueError("The selected study has different original joint-design dependencies")
    return deepcopy(retained)


def catalogue(workspace):
    rows = []
    root = workspace.root / KIND
    if not root.exists():
        return rows
    for directory in sorted(root.iterdir()):
        if directory.is_symlink() or not directory.is_dir():
            raise ValueError("The original joint-study catalogue changed its native directory")
        key = identifier(directory.name)
        snapshot = _snapshot(workspace, key)
        if snapshot is None:
            continue
        record = snapshot["record"]
        rows.append({"kind": KIND, "id": key,
                     "title": snapshot["definition"]["specification"]["title"],
                     "state": (snapshot["checked"] or {}).get("state", record["preparation_state"]),
                     "prepared_samples": record["prepared_samples"],
                     "updated_at": ((snapshot["state"] or {}).get("updated_at")
                                    or (snapshot["state"] or {}).get("created_at") or ""),
                     "declared_samples": record["declared_samples"],
                     "experiment_id": record["experiment_id"]})
    return rows
