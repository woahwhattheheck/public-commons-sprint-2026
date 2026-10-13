"""Prepare retained classified-water inputs through the existing operator queue.

The scientific producers remain high_quality_waters, high_quality_water_crosswalk
and high_quality_water_inventory_cli. This module joins their native file contracts
to source-preparation snapshots, task stages and Workspace intake.
"""
from __future__ import annotations

import gzip
import importlib.util
import json
import shutil
import subprocess
import sys
from pathlib import Path, PurePosixPath

from model.common import atomic_bytes, atomic_json, describe_file, digest, read_json, relative_file

APPLICATION = Path(__file__).resolve().parents[1]


def _input(name, label, *, required=False, builtin=None, mode=None, help=""):
    item = {"name": name, "label": label, "required": required, "help": help}
    if builtin:
        item["default"] = {"builtin_id": builtin}
    if mode:
        item["when"] = {"field": "input_mode", "equals": mode}
    return item


BUILTINS = {
    "classified-water-selection": ("Retained SC DES selected-class edition",
        "source/high_quality_waters/scdes-schydroclass-20261012.retained-selection.json"),
    "classified-water-mapping": ("SC DES native fields and legal edition",
        "source/high_quality_waters/scdes-current.native-field-binding.json"),
    "classified-water-registry": ("Current R.61-69 reaches and complete original text",
        "source/high_quality_waters/sources.json"),
    "classified-water-domain-coverage": ("Complete 217-HUC selected-class inventory",
        "source/high_quality_waters/sources-classified-domain217-20261013.json"),
    "classified-water-planning": ("Original Upper Savannah planning basins",
        "source/geography/planning_basins2023/PlanningBasins2023.shp"),
    "classified-water-focus": ("Original four focus HUC12 polygons",
        "source/geography/wbd_20261012/selected-four-huc12.json.gz"),
}

METHOD = {
    "id": "classified-waters", "title": "SC DES classified waters",
    "role": "WATER_CLASSIFICATION",
    "description": "Prepare original classified linework, the native HUC crosswalk and current legal reach review as one imported source edition.",
    "inputs": [
        _input("metadata", "Original SC DES layer metadata", required=True, mode="original-responses",
               help="Select the metadata retained with the complete original feature response."),
        _input("features", "Complete original SC DES feature response", required=True, mode="original-responses",
               help="Select the retained 1,886-feature Esri JSON, including its original geometry and attributes."),
        _input("selection", "Retained source selection", required=True, builtin="classified-water-selection",
               mode="original-responses", help="Keeps the original source query and selected-class scope."),
        _input("attributes", "Original combined attribute response", mode="original-responses",
               help="Optional: compare a complete retained attribute response against the same original native IDs."),
        _input("capture", "Existing adopted capture", required=True, mode="adopted-capture",
               help="Choose capture.json in a retained edition or registered source folder. Its original companions and selection are reused."),
        _input("mapping", "Native fields and legal edition", required=True, builtin="classified-water-mapping"),
        _input("registry", "Current legal source packet", required=True, builtin="classified-water-registry",
               help="Select the source manifest that retains the reach registry, CSV and complete regulation text."),
        _input("planning", "Original Upper Savannah planning boundary", required=True, builtin="classified-water-planning",
               help="Choose PlanningBasins2023.shp; its original SHX, DBF and PRJ are retained automatically."),
        _input("focus", "Original four focus HUC12 polygons", required=True, builtin="classified-water-focus"),
        _input("network", "Complete upstream HUC12 selection", required=True,
               help="Choose the original network-selection.json in a retained edition or registered source folder. All referenced original polygon pages stay together."),
        _input("coverage", "Complete selected-class source inventory", builtin="classified-water-domain-coverage",
               help="Keeps the separate 217-HUC completeness comparison alongside the original capture query."),
        _input("bindings", "Explicit legal reach associations",
               help="Optional reviewed native-feature-to-regulation bindings, with candidate, partial or coextensive relation."),
    ],
    "options": [{
        "name": "input_mode", "label": "Retained source input", "type": "select",
        "required": True, "default": "original-responses",
        "choices": [
            {"value": "original-responses", "label": "Original metadata and complete features"},
            {"value": "adopted-capture", "label": "Existing adopted capture and companions"},
        ],
        "help": "Both paths use the existing originals and preserve the selected edition.",
    }],
}


def _json(path):
    body = Path(path).read_bytes()
    if body[:2] == b"\x1f\x8b":
        body = gzip.decompress(body)
    return json.loads(body)


def _relative(value):
    if not isinstance(value, str) or "\\" in value or "\0" in value:
        raise ValueError("A retained companion needs an ordinary relative path")
    path = PurePosixPath(value)
    if (path.is_absolute() or not path.parts or str(path) != value
            or any(part in (".", "..") for part in path.parts)):
        raise ValueError("A retained companion must stay within its selected source folder")
    return path


def retain_references(resolved, reference_kind, *, uploaded=False):
    """Expand only declared companions before the existing immutable input snapshot."""
    main = next(item for item in resolved["members"] if item["path"] == resolved["main"])
    root = Path(main["source"]).parent
    prefix = PurePosixPath(resolved["main"]).parent
    members = {item["path"]: dict(item) for item in resolved["members"]}
    visited = set()

    def add(name, expected=None):
        relative = _relative(name)
        target_name = (prefix / relative).as_posix()
        if uploaded and target_name not in members:
            raise ValueError("Select this source packet from an imported edition or registered folder so its original companions can be retained")
        target = relative_file(root, relative.as_posix())
        expected = {key: value for key, value in (expected or {}).items()
                    if key in ("sha256", "bytes") and value is not None}
        if target_name in members:
            item = members[target_name]
            if Path(item["source"]).resolve(strict=True) != target.resolve(strict=True):
                raise ValueError("A retained source path identifies different original files")
            prior = item.get("expected", {})
            if any(key in prior and prior[key] != value for key, value in expected.items()):
                raise ValueError("A retained companion has conflicting original identity")
            item["expected"] = {**prior, **expected}
        else:
            members[target_name] = {"path": target_name, "source": target, "expected": expected}
        return target

    def manifest(name, value=None):
        if name in visited:
            return
        visited.add(name)
        path = add(name)
        value = _json(path) if value is None else value
        if value.get("schema") != "upstate.sources/v1":
            raise ValueError("Select an original upstate.sources/v1 source packet")
        parent = PurePosixPath(name).parent
        for entry in value["entries"]:
            for item in [entry, *entry.get("companions", [])]:
                add((parent / _relative(item["path"])).as_posix(), item)

    value = _json(main["source"])
    if reference_kind == "capture":
        if value.get("schema") != "upstate.classified-water-capture/v1":
            raise ValueError("Choose the original classified-water capture.json")
        for item in value["files"]:
            add(item["path"], item)
    elif reference_kind == "manifest":
        manifest(Path(main["source"]).name, value)
    elif reference_kind == "network":
        if value.get("schema") != "upstate.wbd-upstream-selection/v1":
            raise ValueError("Choose the original upstream network-selection.json")
        for row in value["selected_huc12"]:
            name = row["geometry"]["file"]
            original = add(name)
            receipt = original.parent / ("receipt.json" if original.name == "body.json.gz"
                       else original.name.removesuffix(".json.gz") + ".receipt.json")
            if receipt.is_file():
                receipt_name = receipt.relative_to(root).as_posix()
                add(receipt_name)
                data = _json(receipt)
                add(name, {"sha256": data.get("stored_sha256"), "bytes": data.get("stored_bytes")})
        for name in ("topology-records.json", "capture.json", "sources.json"):
            if (root / name).is_file():
                add(name)
                if name == "sources.json":
                    manifest(name)
    else:
        raise ValueError("Unknown classified-water retained source packet")
    resolved["members"] = list(members.values())
    return resolved


def _registry(path):
    packet = _json(path)
    if packet.get("schema") != "upstate.sources/v1":
        raise ValueError("Choose the complete current legal source packet")
    candidates = []
    for entry in packet["entries"]:
        if entry.get("kind") != "table" or not entry["path"].endswith(".json"):
            continue
        candidate = relative_file(Path(path).parent, entry["path"])
        if _json(candidate).get("schema") == "upstate.classified-water-registry/v1":
            candidates.append(candidate)
    if len(candidates) != 1:
        raise ValueError("The legal packet must contain exactly one native reach registry")
    return candidates[0]


def _active(field, options):
    condition = field.get("when")
    return condition is None or options.get(condition["field"]) == condition.get("equals")


def prepare_workbench(owner, workspace, task, native, record, method, options):
    """Execute the complete source route within SourcePreparation's existing task."""
    from source_tools.high_quality_water_crosswalk import build_crosswalk
    from source_tools.compose import compose

    native = Path(native)
    node = shutil.which("node") or shutil.which("nodejs")
    if node is None:
        raise ValueError("This source operation needs the operator host's Node.js runtime")
    missing = [name for name in ("fiona", "pyproj", "shapely")
               if importlib.util.find_spec(name) is None]
    if missing:
        raise ValueError("Install the operator's native GIS dependencies: " + ", ".join(missing))
    files, snapshots = {}, {}
    supplied = task["payload"].get("inputs", {})
    reference_kinds = {"capture": "capture", "registry": "manifest",
                       "coverage": "manifest", "network": "network"}

    def retain_inputs():
        for field in method["inputs"]:
            if not _active(field, options):
                if supplied.get(field["name"]):
                    raise ValueError("Remove the input from the other source mode: " + field["label"])
                continue
            name = field["name"]
            selected = supplied.get(name)
            if not selected and field.get("default") and name not in supplied:
                builtin = field["default"].get("builtin_id")
                if builtin in BUILTINS and (APPLICATION / BUILTINS[builtin][1]).is_file():
                    selected = field["default"]
            if not selected:
                if field.get("required"):
                    raise ValueError("Choose " + field["label"].lower())
                continue
            files[name], snapshots[name] = owner._snapshot(
                workspace, task["id"], name, selected, native,
                reference_kind=reference_kinds.get(name))

    owner._stage(workspace, record, "Retaining original water sources and geography", retain_inputs)
    selection = {
        "schema": "upstate.preparation-selection/v1", "method": method["id"],
        "request_sha256": task["request_sha256"], "options": options,
        "inputs": snapshots, "project_id": workspace.project["id"],
    }
    directory = owner._record_path(workspace, task["id"]).parent
    atomic_json(native / "selection.json", selection, immutable=True)
    atomic_json(directory / "selection.json", selection, immutable=True)
    logs = []

    def log(name, text):
        body = text.encode("utf-8")
        filename = name + "-" + digest({"text": text})[:20] + ".txt"
        path = directory / "native-logs" / filename
        atomic_bytes(path, body, immutable=True)
        logs.append(describe_file(workspace.root, path, label=name.replace("-", " ").capitalize()))

    def run_native(command, label):
        completed = subprocess.run(command, cwd=APPLICATION, check=False,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        log(label + "-stdout", completed.stdout.decode("utf-8", errors="replace"))
        log(label + "-stderr", completed.stderr.decode("utf-8", errors="replace"))
        if completed.returncode:
            detail = completed.stderr.decode("utf-8", errors="replace").strip()
            raise ValueError(label.replace("-", " ") + " failed: " +
                             (detail[-6000:] or str(completed.returncode)))

    if options["input_mode"] == "original-responses":
        capture = native / "capture"

        def adopt_originals():
            command = [sys.executable, str(APPLICATION / "source_tools/high_quality_waters.py"),
                       "adopt", "--selection", str(files["selection"]),
                       "--metadata", str(files["metadata"]), "--features", str(files["features"]),
                       "--output", str(capture)]
            if "attributes" in files:
                command.extend(["--attributes", str(files["attributes"])])
            run_native(command, "native-source-adoption")
        owner._stage(workspace, record, "Adopting the retained SC DES feature edition", adopt_originals)
    else:
        capture = files["capture"].parent
    registry = _registry(files["registry"])

    crosswalk = owner._stage(workspace, record, "Intersecting original classified waters and native HUC12 polygons",
        lambda: build_crosswalk(capture, files["mapping"], None, native / "crosswalk",
            planning_path=files["planning"], focus_path=files["focus"],
            huc_paths=[files["network"]], registry_paths=[registry],
            bindings_path=files.get("bindings"), workspace_root=None))

    inventory = native / "inventory"
    argv = [node, str(APPLICATION / "source_tools/high_quality_water_inventory_cli.mjs"),
            "--capture", str(capture), "--registry", str(registry),
            "--mapping", str(files["mapping"]), "--out", str(inventory)]

    def build_inventory():
        run_native(argv, "native-classified-water-inventory")
        if not (inventory / "sources.json").is_file():
            raise ValueError("The native inventory did not produce its source manifest")
    owner._stage(workspace, record, "Building the complete captured-linework inventory", build_inventory)

    # Compose only producer manifests and exact original source packets beneath
    # this operation root. The original acquisition selection remains unchanged.
    manifests = [Path(crosswalk["source_manifest"]), inventory / "sources.json", files["registry"]]
    if "coverage" in files:
        manifests.append(files["coverage"])
    composed = owner._stage(workspace, record, "Composing water, legal and coverage sources",
        lambda: compose(native / "sources.json", manifests=manifests, title=record["title"]))
    result = owner._finish(workspace, task, native, record, composed["manifest"])
    result["documents"].extend(logs)
    result.update(source_id="classified-water-crosswalk", role="WATER_CLASSIFICATION",
                  crosswalk={key: crosswalk[key] for key in
                    ("run_id", "selected_native_features", "crosswalk_rows", "huc12_count")
                    if key in crosswalk},
                  review_target={"extension_id": "water-source-review",
                                 "source_id": "classified-water-crosswalk", "load_native": True})
    return result
