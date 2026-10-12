#!/usr/bin/env python3
"""Bind an explicit algorithm invocation to retained submission and companion bytes."""
from __future__ import annotations

from copy import deepcopy
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import sys

SCHEMA = "tjlabs.l2d.source-invocation/v1"
RESERVED_OPTIONS = {"random_seed", "population_size", "objective", "obj"}


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=False, allow_nan=False).encode()


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def file_sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _hash(value):
    if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{64}", value):
        raise ValueError("A selected source must have an exact SHA256")
    return value


def selection_for(row):
    """Return path-independent treatment identity without importing a candidate."""
    invocation = row.get("invocation", {})
    if not isinstance(invocation, dict):
        raise ValueError("Candidate invocation must be an object")
    options = invocation.get("optimize_kwargs", {})
    if not isinstance(options, dict) or any(not isinstance(k, str) for k in options):
        raise ValueError("optimize_kwargs must be an object with named options")
    if RESERVED_OPTIONS.intersection(options):
        raise ValueError("Candidate options cannot override the native cell's seed, population or Objective")
    canonical(options)
    companions = invocation.get("companions", [])
    if not isinstance(companions, list):
        raise ValueError("Companions must be an explicit source list")
    seen = set()
    bound = []
    for companion in companions:
        module = companion.get("module")
        if (not isinstance(module, str) or
                not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", module) or module in seen):
            raise ValueError("Companion module names must be unique explicit top-level identifiers")
        seen.add(module)
        if not isinstance(companion.get("path"), str):
            raise ValueError("Companion requires a retained source path")
        bound.append({"module": module, "sha256": _hash(companion.get("sha256"))})
    expectations = invocation.get("diagnostic_expectations", [])
    if not isinstance(expectations, list):
        raise ValueError("Diagnostic expectations must be an explicit list")
    for check in expectations:
        if (not isinstance(check, dict) or set(check) != {"path", "equals"} or
                not isinstance(check["path"], list) or not check["path"] or
                any(not isinstance(k, str) or not k for k in check["path"])):
            raise ValueError("Diagnostic expectation requires a named path and exact value")
        canonical(check["equals"])
    return {"schema": SCHEMA, "candidate_sha256": _hash(row.get("submission_sha256")),
            "requirements_sha256": _hash(row.get("requirements_sha256")),
            "companions": sorted(bound, key=lambda item: item["module"]),
            "optimize_kwargs": deepcopy(options),
            "diagnostic_expectations": deepcopy(expectations)}


def arm_identity(row):
    return digest(selection_for(row))


def _member(root, name):
    value = Path(name)
    if value.is_absolute() or ".." in value.parts:
        raise ValueError("Source manifest paths must stay within their retained package")
    path = (root / value).resolve()
    path.relative_to(root)
    if not path.is_file():
        raise ValueError("Selected source is not a regular retained file: " + name)
    return path


def load_selection(manifest_path, source_id, candidate_path):
    manifest_path = Path(manifest_path).resolve()
    raw = manifest_path.read_bytes()
    manifest = json.loads(raw)
    rows = manifest["candidates"]
    if len({row["id"] for row in rows}) != len(rows):
        raise ValueError("Source IDs must be unique")
    matches = [row for row in rows if row["id"] == source_id]
    if len(matches) != 1:
        raise ValueError("Select one source ID from the retained manifest")
    row = matches[0]
    selection = selection_for(row)
    root = manifest_path.parent
    submission = _member(root, row["submission"])
    if Path(candidate_path).resolve() != submission:
        raise ValueError("Native --candidate does not name this selected source")
    files = [{"role": "submission", "path": str(submission),
              "sha256": selection["candidate_sha256"]},
             {"role": "requirements", "path": str(_member(root, row["requirements"])),
              "sha256": selection["requirements_sha256"]}]
    companions = []
    for item in row.get("invocation", {}).get("companions", []):
        bound = {"module": item["module"], "path": str(_member(root, item["path"])),
                 "sha256": item["sha256"]}
        companions.append(bound)
        files.append({"role": "companion", **bound})
    for item in files:
        if file_sha(item["path"]) != item["sha256"]:
            raise ValueError("Selected source bytes differ: " + item["path"])
    return {"source_id": source_id, "selection": selection,
            "arm_sha256": digest(selection), "files": files,
            "companions": companions, "manifest_path": str(manifest_path),
            "manifest_sha256": hashlib.sha256(raw).hexdigest(),
            "manifest_content_sha256": digest(manifest),
            "adapter_sha256": file_sha(__file__)}


def source_observation(bound):
    observations = []
    for item in bound["files"]:
        try:
            actual = file_sha(item["path"])
            observations.append({**item, "observed_sha256": actual,
                                 "unchanged": actual == item["sha256"]})
        except OSError as exc:
            observations.append({**item, "unchanged": False,
                                 "error": {"type": type(exc).__name__, "message": str(exc)}})
    return {"files": observations, "unchanged": all(x["unchanged"] for x in observations)}


def _value_at(value, path):
    for key in path:
        if not isinstance(value, dict) or key not in value:
            return False, None
        value = value[key]
    return True, value


class InvocationMismatch(RuntimeError):
    pass


def run_native(runner, argv, bound, receipt):
    """Call the unchanged runner with an explicit constructor/invocation adapter.

    The original runner constructs the original Objective, owns every clock and
    computes every metric. This adapter supplies only pinned algorithm options.
    """
    runner = Path(runner).resolve()
    receipt.update({"schema": SCHEMA, "source_id": bound["source_id"],
                    "selection": deepcopy(bound["selection"]),
                    "arm_sha256": bound["arm_sha256"],
                    "manifest_sha256": bound["manifest_sha256"],
                    "manifest_content_sha256": bound["manifest_content_sha256"],
                    "adapter_sha256": bound["adapter_sha256"],
                    "optimize_calls": 0, "loaded_companions": [],
                    "diagnostics": [], "state": "preparing_native_invocation"})
    original_modules = {}
    module_name = "_source_bound_public_uifo"
    previous_argv = sys.argv
    try:
        for item in bound["companions"]:
            name = item["module"]
            original_modules[name] = sys.modules.get(name)
            if name in sys.modules:
                raise ValueError("A companion was already imported before this source-bound invocation: " + name)
            raw = Path(item["path"]).read_bytes()
            if hashlib.sha256(raw).hexdigest() != item["sha256"]:
                raise ValueError("Companion changed before import: " + name)
            spec = importlib.util.spec_from_file_location(name, item["path"])
            if spec is None or spec.loader is None:
                raise ValueError("Selected companion cannot be imported: " + name)
            module = importlib.util.module_from_spec(spec)
            sys.modules[name] = module
            # Execute these verified bytes, independent of an older bytecode cache.
            exec(compile(raw, item["path"], "exec"), module.__dict__)
            if file_sha(item["path"]) != item["sha256"]:
                raise ValueError("Companion changed while importing: " + name)
            receipt["loaded_companions"].append(deepcopy(item))
        spec = importlib.util.spec_from_file_location(module_name, str(runner))
        if spec is None or spec.loader is None:
            raise ValueError("The unchanged native runner cannot be imported")
        native = importlib.util.module_from_spec(spec)
        original_modules[module_name] = sys.modules.get(module_name)
        sys.modules[module_name] = native
        spec.loader.exec_module(native)
        original_load = native.load_algorithm

        def selected_algorithm(path):
            if Path(path).resolve() != Path(bound["files"][0]["path"]):
                raise ValueError("Runner requested a different selected candidate")
            cls, previous_adapter = original_load(path)
            fixed = deepcopy(bound["selection"]["optimize_kwargs"])
            expected = bound["selection"]["diagnostic_expectations"]

            class SelectedInvocation(cls):
                def optimize(self, objective, **kwargs):
                    receipt["optimize_calls"] += 1
                    if receipt["optimize_calls"] != 1 or set(fixed).intersection(kwargs):
                        raise InvocationMismatch("Native invocation/options differ from the selected arm")
                    receipt["forwarded_options"] = deepcopy(fixed)
                    receipt["native_options"] = native.json_safe(kwargs)
                    receipt["state"] = "algorithm_running"
                    try:
                        result = super().optimize(objective, **kwargs, **deepcopy(fixed))
                    except BaseException:
                        receipt["state"] = "algorithm_raised"
                        raise
                    diagnostics = native.json_safe(getattr(self, "last_run_diagnostics", None))
                    checks = []
                    for expectation in expected:
                        present, observed = _value_at(diagnostics, expectation["path"])
                        checks.append({**deepcopy(expectation), "present": present, "observed": observed,
                                       "matched": present and observed == expectation["equals"]})
                    receipt["diagnostics"] = checks
                    if any(not check["matched"] for check in checks):
                        receipt["state"] = "requested_arm_not_applied"
                        raise InvocationMismatch("Original algorithm diagnostics do not match the selected arm")
                    receipt["state"] = "algorithm_returned"
                    return result

            suffix = "source-bound optimize options; invocation identity " + bound["arm_sha256"]
            return SelectedInvocation, (previous_adapter + "; " + suffix) if previous_adapter else suffix

        native.load_algorithm = selected_algorithm
        sys.argv = [str(runner), *argv]
        return native.main()
    finally:
        sys.argv = previous_argv
        receipt["sources_after"] = source_observation(bound)
        receipt["adapter_unchanged"] = file_sha(__file__) == bound["adapter_sha256"]
        receipt["valid_invocation"] = (
            receipt.get("optimize_calls") == 1 and receipt.get("state") == "algorithm_returned"
            and receipt["sources_after"]["unchanged"] and receipt["adapter_unchanged"])
        for name, original in original_modules.items():
            if original is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = original
