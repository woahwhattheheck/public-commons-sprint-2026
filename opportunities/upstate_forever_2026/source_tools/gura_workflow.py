"""Run the original Gura input-to-delivery workflow in the maintained application.

The default comparison uses every observed original class, in both directions
against the dominant class, through the maintained InVEST 3.20.0 executor.
Run from the application root with: python -B -m source_tools.gura_workflow --help
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import importlib
import json
import math
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
from types import SimpleNamespace

APPLICATION_ROOT = Path(__file__).resolve().parents[1]
OPERATION_ID = "GURA-NATIVE-01"
SCHEMA = "upstate.gura-workflow/v1"
SOURCE_EDITION = "Original Natural Capital Project InVEST 3.20.0 Gura release archives and pinned native biophysical tables"
TABLE_REVISION = "098183806c0c715e6422d4d0570db91321c0f4e8"
SOURCES = {
    "ndr_archive": {
        "relative": "NDR.zip",
        "sha256": "df4ba0d9b96152d3bc5eef3c41b6ec701f62ec3548dc4d4d4c8af8bea53c6c7d",
        "uri": "https://storage.googleapis.com/download/storage/v1/b/releases.naturalcapitalproject.org/o/invest%2F3.20.0%2Fdata%2FNDR.zip?generation=1781204725169434&alt=media",
    },
    "sdr_archive": {
        "relative": "SDR.zip",
        "sha256": "34351a1305d8e6258c2d566917cfeab5f152096e930ef5b0a834968146bdc779",
        "uri": "https://storage.googleapis.com/download/storage/v1/b/releases.naturalcapitalproject.org/o/invest%2F3.20.0%2Fdata%2FSDR.zip?generation=1781204725769073&alt=media",
    },
    "ndr_table": {
        "relative": "NDR/biophysical_table_gura.csv",
        "sha256": "e3f503cb1c82fb1035225eb68eb84303de8de7842b1bda6e94f4754fe538c42c",
        "uri": "https://bitbucket.org/natcap/invest-sample-data/raw/" + TABLE_REVISION + "/NDR/biophysical_table_gura.csv",
    },
    "sdr_table": {
        "relative": "SDR/biophysical_table_Gura.csv",
        "sha256": "b27b1549a41c4929f161e3b18962d6bc8627c10ed7ed27e504203c175a0f5f69",
        "uri": "https://bitbucket.org/natcap/invest-sample-data/raw/" + TABLE_REVISION + "/SDR/biophysical_table_Gura.csv",
    },
}
REQUIRED_SOURCE = (
    "source_tools/receive_gura.py", "source_tools/gura_comparison.py",
    "source_tools/gura_workflow.py", "model/workspace.py", "model/rasters.py",
    "model/compute_programme.py", "model/compute_programme_cli.py",
    "model/scenario_decisions.py", "model/native_study.py", "model/portable.py", "operator/server.py",
)
GIS_MODULES = ("numpy", "rasterio", "fiona", "pyproj", "shapely")
NATIVE_MODULES = ("natcap.invest", "osgeo.gdal", "pygeoprocessing")


def now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def sha256(path):
    result = hashlib.sha256()
    with Path(path).open("rb") as incoming:
        for part in iter(lambda: incoming.read(1024 * 1024), b""):
            result.update(part)
    return result.hexdigest()


def read_json(path):
    with Path(path).open(encoding="utf-8") as incoming:
        return json.load(incoming)


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix="." + path.name + ".", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as outgoing:
            json.dump(value, outgoing, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False)
            outgoing.write("\n")
            outgoing.flush()
            os.fsync(outgoing.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def describe(path):
    path = Path(path).resolve(strict=True)
    return {"path": str(path), "bytes": path.stat().st_size, "sha256": sha256(path)}


def event(name, **values):
    print(json.dumps({"operation_id": OPERATION_ID, "event": name, "at": now(), **values},
                     ensure_ascii=False, sort_keys=True, allow_nan=False), flush=True)


def runtime(require_native=False):
    modules, errors = {}, {}
    for name in GIS_MODULES + (NATIVE_MODULES if require_native else ()):
        try:
            module = importlib.import_module(name)
            version = getattr(module, "__version__", None)
            if name == "osgeo.gdal":
                version = module.VersionInfo("RELEASE_NAME")
            modules[name] = {"version": str(version) if version is not None else None,
                             "path": str(getattr(module, "__file__", ""))}
        except (ImportError, OSError, RuntimeError) as error:
            errors[name] = {"type": type(error).__name__, "message": str(error)}
    if require_native and "natcap.invest" in modules:
        version = modules["natcap.invest"]["version"]
        if version != "3.20.0":
            errors["natcap.invest"] = {"type": "VersionMismatch",
                                      "message": "Select InVEST 3.20.0; this interpreter contains " + str(version)}
    return {"python": sys.executable, "python_version": sys.version.split()[0],
            "hostname": socket.gethostname(), "modules": modules, "errors": errors}


def source_identity():
    files = {}
    for relative in REQUIRED_SOURCE:
        path = APPLICATION_ROOT / relative
        if not path.is_file():
            raise ValueError("Install the cumulative application component " + relative)
        files[relative] = {"sha256": sha256(path), "bytes": path.stat().st_size}
    encoded = json.dumps(files, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return {"sha256": hashlib.sha256(encoded).hexdigest(), "files": files}


def original_inputs(args):
    manifest_path = args.source_directory / "sources.json"
    if manifest_path.exists():
        manifest = read_json(manifest_path)
        if manifest.get("schema") != "upstate.sources/v1":
            raise ValueError("Select the retained original source manifest")
        entries = {entry["id"]: entry for entry in manifest["entries"]}
        found = {}
        for role, source_id in (
                ("ndr_archive", "GURA_ORIGINAL_NDR_ZIP"),
                ("sdr_archive", "GURA_ORIGINAL_SDR_ZIP"),
                ("ndr_table", "GURA_NDR_TABLE"),
                ("sdr_table", "GURA_SDR_TABLE")):
            entry = entries[source_id]
            path = (args.source_directory / entry["path"]).resolve(strict=True)
            if not path.is_relative_to(args.source_directory):
                raise ValueError("Retain original input bytes within the source directory")
            item = describe(path)
            if item["sha256"] != entry["sha256"]:
                raise ValueError("Retained original input changed: " + str(path))
            if role.endswith("_table") and item["sha256"] != SOURCES[role]["sha256"]:
                raise ValueError("Retain the original pinned " + role + " source table")
            found[role] = {**item, "uri": entry["uri"], "edition": entry["vintage"]}
        return found
    if args.archives is None:
        raise ValueError("Select the retained original archive directory with --archives")
    table_root = args.tables.resolve(strict=True)
    archives = args.archives.resolve(strict=True)
    found = {}
    for role, source in SOURCES.items():
        root = archives if role.endswith("_archive") else table_root
        item = describe(root / source["relative"])
        if item["sha256"] != source["sha256"]:
            raise ValueError("The selected " + role + " differs from the retained original 3.20.0 source: "
                             + item["path"])
        found[role] = {**item, "uri": source["uri"], "edition": SOURCE_EDITION}
    return found


@contextmanager
def operation_lock(source_directory):
    import fcntl
    source_directory.mkdir(parents=True, exist_ok=True)
    path = source_directory / ".gura-workflow.lock"
    with path.open("a+", encoding="utf-8") as handle:
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            handle.seek(0)
            owner = handle.read().strip()
            raise RuntimeError("The retained Gura workflow is already active: " + owner) from None
        try:
            handle.seek(0)
            handle.truncate()
            json.dump({"operation_id": OPERATION_ID, "hostname": socket.gethostname(),
                       "pid": os.getpid(), "started_at": now()}, handle, sort_keys=True)
            handle.write("\n")
            handle.flush()
            yield
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def _native_selection(args, grid=None):
    """Keep native cell size and upstream context as independent selections."""
    requested = {
        "resolution_m": getattr(args, "expected_resolution_m", None),
        "upstream_buffer_m": getattr(args, "upstream_buffer_m", None),
    }
    for key, value in requested.items():
        if value is not None and (not math.isfinite(float(value))
                or (float(value) <= 0 if key == "resolution_m" else float(value) < 0)):
            raise ValueError("Select a finite positive resolution and nonnegative context buffer")
    if grid is None:
        return (requested["resolution_m"],
                requested["upstream_buffer_m"] if requested["upstream_buffer_m"] is not None else 0.0)
    retained = {
        "resolution_m": float(grid["grid"]["resolution_m"]),
        "upstream_buffer_m": float(grid["spec"]["upstream_buffer_m"]),
    }
    for key, value in retained.items():
        if not math.isfinite(value) or (value <= 0 if key == "resolution_m" else value < 0):
            raise ValueError("The retained Gura grid has an invalid " + key)
        selected = requested[key]
        if selected is not None and not math.isclose(float(selected), value, rel_tol=1e-9, abs_tol=1e-8):
            raise ValueError("Continue the retained Gura " + key + "=" + format(value, "g")
                             + "; use a separate Workspace and source directory for another selection")
    return retained["resolution_m"], retained["upstream_buffer_m"]


def _native_header(dataset):
    """Read the original north-up metre grid without preparing another edition."""
    import math
    crs, affine = dataset.crs, dataset.transform
    if (not crs or not crs.is_projected
            or str(crs.linear_units).lower() not in ("metre", "meter", "metres", "meters")):
        raise ValueError("The original Gura land-cover grid must be projected in metres")
    x, y = map(float, dataset.res)
    transform = [float(value) for value in list(affine)[:6]]
    if (not all(math.isfinite(value) for value in [x, y, *transform])
            or x <= 0 or y <= 0
            or not math.isclose(x, y, rel_tol=1e-9, abs_tol=1e-8)
            or not math.isclose(affine.b, 0.0, abs_tol=1e-10)
            or not math.isclose(affine.d, 0.0, abs_tol=1e-10)
            or affine.a <= 0 or affine.e >= 0
            or dataset.width <= 0 or dataset.height <= 0):
        raise ValueError("The original Gura land-cover grid must retain finite square north-up cells")
    area = abs(affine.a * affine.e - affine.b * affine.d) / 10000.0
    return {"resolution_m": x, "pixel_area_ha": area, "source_crs": str(crs),
            "source_transform": transform, "source_resolution_m": [x, y],
            "width": dataset.width, "height": dataset.height}


def _verify_retained_native_header(ws, collection, grid, receipt):
    """Compare retained source headers without replacing the saved model grid."""
    import rasterio
    reference, source_entry = ws.source_file(
        collection["id"], grid["spec"]["input_sources"]["NLCD"])
    with rasterio.open(reference) as dataset:
        actual = _native_header(dataset)
        actual_crs = dataset.crs

    def numbers(label, recorded, observed):
        if not isinstance(recorded, (tuple, list)) or len(recorded) != len(observed):
            raise ValueError("The retained Gura " + label + " has another shape")
        for before, after in zip(recorded, observed):
            value = float(before)
            if not math.isfinite(value) or not math.isclose(
                    value, float(after), rel_tol=1e-9, abs_tol=1e-8):
                raise ValueError("The retained Gura " + label + " differs from its source raster")

    definition = grid["grid"]
    if rasterio.crs.CRS.from_user_input(definition["crs"]) != actual_crs:
        raise ValueError("The saved Gura grid and retained source use different coordinate systems")
    normalization = definition.get("reference_normalization", {})
    for key, actual_key in (("source_transform", "source_transform"),
                            ("source_pixel_size_m", "source_resolution_m")):
        if key in normalization:
            numbers(key, normalization[key], actual[actual_key])
    for key, actual_key in (("source_width", "width"), ("source_height", "height")):
        if key in normalization and normalization[key] != actual[actual_key]:
            raise ValueError("The retained Gura source dimensions differ from the saved grid")
    source_identity = receipt.get("raster_identities", {}).get("NLCD", {})
    for key, actual_key in (("transform", "source_transform"),
                            ("resolution", "source_resolution_m")):
        if key in source_identity:
            numbers(key, source_identity[key], actual[actual_key])
    for key in ("width", "height"):
        if key in source_identity and source_identity[key] != actual[key]:
            raise ValueError("The original Gura receiving record has another source raster size")
    if source_identity.get("crs") and rasterio.crs.CRS.from_user_input(
            source_identity["crs"]) != actual_crs:
        raise ValueError("The original Gura receiving record has another source coordinate system")
    native = receipt["native_grid"]
    for key in ("source_transform", "source_resolution_m"):
        if key in native:
            numbers(key, native[key], actual[key])
    if native.get("source_crs") and rasterio.crs.CRS.from_user_input(native["source_crs"]) != actual_crs:
        raise ValueError("The retained native source coordinate system differs from its receipt")
    if "source_pixel_area_ha" in native:
        numbers("source cell area", [native["source_pixel_area_ha"]], [actual["pixel_area_ha"]])
    # A selected model grid may be a separate prepared edition. Its cell area
    # is bound to that saved resolution, independently of source size/context.
    grid_area = float(definition["resolution_m"]) ** 2 / 10000.0
    for label, record in (("model grid", definition), ("receiving grid", native)):
        if "pixel_area_ha" in record:
            numbers(label + " cell area", [record["pixel_area_ha"]], [grid_area])


def check_receiving(path, workspace, args=None, *, expected_resolution_m=None, upstream_buffer_m=None):
    from model.common import file_digest, selected_models
    from source_tools.gura_comparison import _context
    original_path, receipt, ws, collection, grid, profile, baseline = _context(
        path, workspace=workspace)
    if ws.root.resolve() != workspace.resolve():
        raise ValueError("Select the actual receiving Workspace")
    native = receipt.get("native_grid", {})
    resolution = float(native.get("resolution_m", -1))
    context = float(native.get("upstream_buffer_m", -1))
    if (not math.isfinite(resolution) or resolution <= 0
            or not math.isfinite(context) or context < 0):
        raise ValueError("Retain the original finite native cell size and nonnegative context buffer")
    if not math.isclose(context, float(grid["spec"]["upstream_buffer_m"]), rel_tol=1e-9, abs_tol=1e-8):
        raise ValueError("The receiving record differs from its retained native context selection")
    for name, chosen, actual in (("resolution", expected_resolution_m, resolution),
                                ("upstream buffer", upstream_buffer_m, context)):
        if chosen is not None and not math.isclose(float(chosen), actual, rel_tol=1e-9, abs_tol=1e-8):
            raise ValueError("Continue this receipt's original " + name + ": " + str(actual) + " metres")
    # Preserve the shared positional args contract and explicit receiving controls.
    _native_selection(SimpleNamespace(
        expected_resolution_m=(expected_resolution_m if expected_resolution_m is not None
                               else getattr(args, "expected_resolution_m", None)),
        upstream_buffer_m=(upstream_buffer_m if upstream_buffer_m is not None
                           else getattr(args, "upstream_buffer_m", None))), grid)
    _verify_retained_native_header(ws, collection, grid, receipt)
    source_ids = receipt.get("source_ids", {})
    for model in selected_models(receipt):
        role = model + "_archive"
        archived = receipt.get("archives", {}).get(model, {})
        # New intake is pinned by original_inputs. An imported archive keeps its
        # own exact source edition when the original Workspace is reopened.
        archive_alias = "GURA_ORIGINAL_" + model.upper() + "_ZIP"
        archive_id = source_ids.get(archive_alias, archive_alias)
        if archive_id in {entry["id"] for entry in collection["entries"]}:
            retained_path, retained_entry = ws.source_file(collection["id"], archive_id)
            retained = describe(retained_path)
            if (retained["sha256"] != archived.get("sha256")
                    or retained["bytes"] != archived.get("bytes")
                    or retained["sha256"] != retained_entry["body"]["sha256"]):
                raise ValueError("The original " + model.upper() + " archive differs from its retained source collection")
        elif archived.get("sha256") != SOURCES[role]["sha256"]:
            # The original datastack receiver imports its member inputs and
            # arguments rather than the ZIP. Its receipt pins the captured
            # archive; tables and native inputs remain checked by their store.
            raise ValueError("Retain the original " + model.upper()
                             + " archive in its source collection to reopen this source edition")
        alias = "GURA_" + model.upper() + "_TABLE"
        table_path, entry = ws.source_file(collection["id"], source_ids.get(alias, alias))
        table = receipt.get("original_tables", {}).get(model, {})
        if table.get("sha256") != file_digest(table_path):
            raise ValueError("The receiving record differs from its retained original " + model.upper() + " table")
    return receipt


def capsule_directory(workspace):
    return workspace / "gura-workflow"


def _recover_original_receiving(capsule, source_directory, workspace, saved_plan):
    """Find or reproduce the exact original receipt authenticated by its plan."""
    from model.common import atomic_bytes, canonical
    expected = saved_plan["receiving"]
    expected_size = expected["bytes"]
    expected_digest = expected["sha256"]
    if (not isinstance(expected_size, int) or isinstance(expected_size, bool)
            or expected_size < 1 or not isinstance(expected_digest, str)
            or len(expected_digest) != 64
            or any(character not in "0123456789abcdef" for character in expected_digest)):
        raise ValueError("The saved comparison plan lacks its exact receiving identity")
    candidates = [capsule / "original-receiving.json", source_directory / "receiving.json"]
    candidates.extend(sorted((capsule / "receiving-locations").glob("*.json")))
    candidates.extend(sorted((source_directory / "receiving-locations").glob("*.json")))
    candidates.extend(sorted((workspace.root / "gura-comparisons").glob("*/original-receiving.json")))
    captured = []
    for candidate in candidates:
        if not candidate.is_file():
            continue
        raw = candidate.read_bytes()
        if len(raw) == expected_size and hashlib.sha256(raw).hexdigest() == expected_digest:
            return candidate
        captured.append((candidate, raw))
    # The old workflow writer used pretty JSON while receive_gura used common
    # canonical JSON plus LF. Recover only bytes that reproduce the saved hash;
    # neither a plan identity nor a receipt field is changed to fit the copy.
    for candidate, raw in captured:
        try:
            document = json.loads(raw.decode("utf-8"))
            restored = canonical(document) + b"\n"
        except (UnicodeError, ValueError, TypeError):
            continue
        if len(restored) != expected_size or hashlib.sha256(restored).hexdigest() != expected_digest:
            continue
        destination = capsule / "receiving-records" / (expected_digest + ".json")
        atomic_bytes(destination, restored, immutable=True)
        event("original_receiving_bytes_recovered", source=str(candidate),
              receiving=str(destination), bytes=expected_size, sha256=expected_digest)
        return destination
    raise ValueError("The retained copies do not reproduce the original receipt selected by the comparison plan")


def restore_workflow_paths(args):
    """Reopen a copied workflow without changing its original receipt bytes."""
    from model.common import atomic_bytes
    from model.workspace import Workspace
    from source_tools.gura_comparison import _check_plan
    capsule = capsule_directory(args.workspace)
    metadata_path = capsule / "workflow-selection.json"
    if not metadata_path.exists():
        return False
    metadata = read_json(metadata_path)
    if metadata.get("schema") != "upstate.gura-workflow-selection/v1":
        raise ValueError("The retained Gura workflow selection has an unsupported schema")
    ws = Workspace(args.workspace)
    if metadata["workspace_id"] != ws.project["id"]:
        raise ValueError("The Gura workflow selection belongs to another scientific Workspace")
    original_path = capsule / "original-receiving.json"
    selection_path = capsule / "programme-selection.json"
    if (sha256(original_path) != metadata["original_receiving_sha256"]
            or sha256(selection_path) != metadata["programme_selection_sha256"]):
        raise ValueError("The copied Gura workflow inputs differ from their retained source selection")
    plan_path = capsule / "comparison-plan.json"
    saved_plan = read_json(plan_path)
    original_path = _recover_original_receiving(capsule, args.source_directory, ws, saved_plan)
    receipt = read_json(original_path)
    collection = ws._get("sources", receipt["source_collection_id"])
    if collection["original_manifest"]["sha256"] != receipt["source_manifest_sha256"]:
        raise ValueError("The copied Workspace selects another Gura source collection")
    for name in ("source_collection_id", "grid_id", "profile_id", "scenario_id", "programme_id"):
        if receipt[name] != metadata[name]:
            raise ValueError("The copied Gura workflow changed its original " + name)
    stored_conversions = metadata["conversions"]
    if args.convert is None and stored_conversions is not None:
        args.convert = [str(left) + ":" + str(right) for left, right in stored_conversions]
    elif args.convert is not None:
        if [list(pair) for pair in conversions(args.convert)] != stored_conversions:
            raise ValueError("Resume the original selected Gura cohort from this Workspace")
    selected_zone = metadata["zone_id_field"]
    if args.zone_id_field is None:
        args.zone_id_field = selected_zone
    elif args.zone_id_field != selected_zone:
        raise ValueError("Resume the original watershed feature ID field " + selected_zone)
    _check_plan(original_path, plan_path, workspace=ws)
    args.source_directory.mkdir(parents=True, exist_ok=True)
    current_receiving = args.source_directory / "receiving.json"
    if current_receiving.exists() and current_receiving.read_bytes() != original_path.read_bytes():
        # Retain a previous path-rewritten copy, then restore the verified source
        # record. A different scientific receipt is never overwritten.
        prior = read_json(current_receiving)
        relocatable = {"workspace", "source_directory", "selection_path"}
        if ({key: value for key, value in prior.items() if key not in relocatable}
                != {key: value for key, value in receipt.items() if key not in relocatable}):
            raise ValueError("The receiving destination selects another original scientific receipt")
        snapshot = args.source_directory / "receiving-locations" / (sha256(current_receiving) + ".json")
        atomic_bytes(snapshot, current_receiving.read_bytes(), immutable=True)
    origin_state = receipt.get("receiving_origin", {}).get("state")
    if origin_state:
        from model.common import verify_file
        retained_state = None
        # Older capsules can recover a snapshot still present in the restored
        # Workspace or receiving directory. Its recorded bytes remain exact.
        state_roots = [capsule, original_path.parent, args.source_directory]
        try:
            original_relative = Path(receipt["source_directory"]).relative_to(Path(receipt["workspace"]))
        except ValueError:
            pass
        else:
            state_roots.append(ws.root / original_relative)
        for state_root in state_roots:
            try:
                retained_state = verify_file(state_root, origin_state)
            except FileNotFoundError:
                continue
            break
        if retained_state is None:
            raise ValueError("Restore the original native receiving-state snapshot named by this receipt")
        state_bytes = retained_state.read_bytes()
        atomic_bytes(capsule / origin_state["path"], state_bytes, immutable=True)
        atomic_bytes(args.source_directory / origin_state["path"], state_bytes, immutable=True)
    atomic_bytes(current_receiving, original_path.read_bytes())
    relocated_selection = args.source_directory / "programme-selection.json"
    atomic_bytes(relocated_selection, selection_path.read_bytes(), immutable=True)
    restored_plan = args.source_directory / "gura-comparison-plan.json"
    atomic_bytes(restored_plan, plan_path.read_bytes(), immutable=True)
    progress = capsule / "workflow-progress.json"
    current_progress = args.source_directory / "gura-workflow.json"
    if progress.is_file() and not current_progress.exists():
        atomic_bytes(current_progress, progress.read_bytes(), immutable=True)
    check_receiving(current_receiving, args.workspace,
                    expected_resolution_m=args.expected_resolution_m,
                    upstream_buffer_m=args.upstream_buffer_m)
    event("copied_workflow_reopened", workspace_id=ws.project["id"],
          receiving=str(current_receiving), original_programme_id=receipt["programme_id"])
    return True


def retain_workflow(args, receipt, plan, state):
    """Keep the source selection inside every complete Workspace archive."""
    from model.workspace import Workspace
    from model.common import atomic_bytes
    from model.compute_programme import ComputeProgrammes
    capsule = capsule_directory(args.workspace)
    capsule.mkdir(parents=True, exist_ok=True)
    original = capsule / "original-receiving.json"
    selection = capsule / "programme-selection.json"
    receiving_path = args.source_directory / "receiving.json"
    if original.exists() and original.read_bytes() != receiving_path.read_bytes():
        prior = read_json(original)
        relocatable = {"workspace", "source_directory", "selection_path"}
        if ({key: value for key, value in prior.items() if key not in relocatable}
                != {key: value for key, value in receipt.items() if key not in relocatable}):
            raise ValueError("The retained capsule selects another original scientific receipt")
        atomic_bytes(capsule / "receiving-locations" / (sha256(original) + ".json"),
                     original.read_bytes(), immutable=True)
    origin_state = receipt.get("receiving_origin", {}).get("state")
    if origin_state:
        from model.common import verify_file
        retained_state = verify_file(receiving_path.parent, origin_state)
        atomic_bytes(capsule / origin_state["path"], retained_state.read_bytes(), immutable=True)
    atomic_bytes(original, receiving_path.read_bytes())
    original_selection = ComputeProgrammes(Workspace(args.workspace)).status(
        receipt["programme_id"])["selection"]
    if selection.exists():
        if read_json(selection) != original_selection:
            raise ValueError("The retained workflow has another original programme selection")
    else:
        atomic_json(selection, original_selection)
    saved = read_json(original)
    for name in ("source_collection_id", "grid_id", "profile_id", "scenario_id", "programme_id"):
        if saved[name] != receipt[name]:
            raise ValueError("The retained workflow selects another original " + name)
    selected_conversions = conversions(args.convert)
    metadata = {
        "schema": "upstate.gura-workflow-selection/v1",
        "operation_id": OPERATION_ID, "workspace_id": Workspace(args.workspace).project["id"],
        "source_collection_id": receipt["source_collection_id"],
        "source_manifest_sha256": receipt["source_manifest_sha256"],
        "grid_id": receipt["grid_id"], "profile_id": receipt["profile_id"],
        "scenario_id": receipt["scenario_id"], "programme_id": receipt["programme_id"],
        "original_receiving_sha256": sha256(original),
        "programme_selection_sha256": sha256(selection),
        "conversions": [list(pair) for pair in selected_conversions] if selected_conversions is not None else None,
        "zone_id_field": plan["inventory"]["watershed_source"]["id_field"],
        "source_reference": plan["source_reference"],
    }
    atomic_json(capsule / "workflow-selection.json", metadata)
    atomic_json(capsule / "comparison-plan.json", plan)
    atomic_json(capsule / "workflow-progress.json", state)


def prepare(args, identity):
    from source_tools import receive_gura
    restore_workflow_paths(args)
    receiving_path = args.source_directory / "receiving.json"
    if receiving_path.exists():
        receipt = check_receiving(receiving_path, args.workspace,
                                  expected_resolution_m=args.expected_resolution_m,
                                  upstream_buffer_m=args.upstream_buffer_m)
        event("original_workspace_reopened", receiving=str(receiving_path),
              programme_id=receipt["programme_id"], grid_id=receipt["grid_id"])
        return receipt
    native_state_path = args.workspace / "gura-receiving" / "gura-receiving-state.json"
    generic_selection_exists = any(
        (args.source_directory / name).exists()
        for name in ("sources.json", "programme-selection.json"))
    if native_state_path.is_file() and not generic_selection_exists:
        native_state = read_json(native_state_path)
        native_baseline = native_state.get("workspace_baseline") or {}
        if native_baseline.get("run_id"):
            from source_tools.gura_receipt import prepare as adopt_native_baseline
            native_reference = "upstate.original-gura-run:" + native_baseline["run_id"]
            if args.source_reference and args.source_reference != native_reference:
                raise ValueError("Continue the original native baseline source reference: " + native_reference)
            adopt_native_baseline(
                args.workspace, run_id=native_baseline["run_id"],
                receiving_state=native_state_path, output=receiving_path)
            receipt = check_receiving(
                receiving_path, args.workspace,
                expected_resolution_m=args.expected_resolution_m,
                upstream_buffer_m=args.upstream_buffer_m)
            event("original_native_baseline_adopted",
                  receiving=str(receiving_path), baseline_run_id=native_baseline["run_id"],
                  programme_id=receipt["programme_id"], grid_id=receipt["grid_id"])
            return receipt
    inputs = original_inputs(args)
    selection_path = args.source_directory / "programme-selection.json"
    prior_selection = read_json(selection_path) if selection_path.exists() else None
    source_reference = (prior_selection.get("source_reference") if prior_selection else None)
    source_reference = source_reference or getattr(args, "_retained_source_reference", None)
    if args.source_reference and source_reference and args.source_reference != source_reference:
        raise ValueError("Continue the saved original source reference: " + source_reference)
    source_reference = source_reference or args.source_reference or "retained-application-sha256:" + identity["sha256"]
    retained_grid = None
    if prior_selection is not None:
        from model.workspace import Workspace
        retained_reference = prior_selection.get("source_reference")
        if not isinstance(retained_reference, str) or not retained_reference.strip():
            raise ValueError("The retained original programme selection lacks its source reference")
        retained_grid = Workspace(args.workspace).get_grid(prior_selection["grid_id"])
        if retained_grid.get("state") != "complete":
            raise ValueError("Complete the original partial-intake grid before preparing its programme")
    resolution_m, buffer_m = _native_selection(args, retained_grid)
    selected = SimpleNamespace(
        workspace=args.workspace, source_directory=args.source_directory,
        ndr_archive=Path(inputs["ndr_archive"]["path"]),
        sdr_archive=Path(inputs["sdr_archive"]["path"]),
        ndr_table=Path(inputs["ndr_table"]["path"]), sdr_table=Path(inputs["sdr_table"]["path"]),
        ndr_source_uri=inputs["ndr_archive"]["uri"], sdr_source_uri=inputs["sdr_archive"]["uri"],
        ndr_table_source_uri=inputs["ndr_table"]["uri"], sdr_table_source_uri=inputs["sdr_table"]["uri"],
        source_edition=inputs["ndr_archive"]["edition"],
        source_reference=source_reference,
        expected_resolution_m=resolution_m, upstream_buffer_m=buffer_m,
    )
    event("preparing_original_inputs", workspace=str(args.workspace),
          source_directory=str(args.source_directory), inputs=inputs,
          expected_resolution_m=selected.expected_resolution_m,
          upstream_buffer_m=selected.upstream_buffer_m)
    receipt = receive_gura.receive(selected)
    check_receiving(receiving_path, args.workspace,
                    expected_resolution_m=selected.expected_resolution_m,
                    upstream_buffer_m=selected.upstream_buffer_m)
    event("original_inputs_prepared", receiving=str(receiving_path),
          programme_id=receipt["programme_id"], grid_id=receipt["grid_id"],
          profile_id=receipt["profile_id"], scenario_id=receipt["scenario_id"],
          native_grid=receipt["native_grid"])
    return receipt


def conversions(values):
    if not values:
        return None
    selected = []
    for value in values:
        parts = value.split(":")
        if len(parts) != 2:
            raise ValueError("Use the original integer class pair FROM:TO for each --convert")
        try:
            selected.append((int(parts[0]), int(parts[1])))
        except ValueError:
            raise ValueError("Use the original integer class pair FROM:TO for each --convert") from None
    if len(set(selected)) != len(selected):
        raise ValueError("A source-class conversion was selected more than once")
    return selected


def plan_and_catalog(args):
    from model.common import digest
    from source_tools import gura_comparison
    receiving = args.source_directory / "receiving.json"
    selected = conversions(args.convert)
    destination = args.source_directory / "gura-comparison-plan.json"
    candidate = gura_comparison.make_plan(receiving, conversions=selected,
                                          zone_id_field=args.zone_id_field,
                                          workspace=args.workspace)
    if destination.exists():
        # Validate the original receipt bytes and every retained scientific
        # binding on this Workspace before normalizing its local copy name.
        prior = gura_comparison._check_plan(
            receiving, destination, workspace=args.workspace)[-1]
        candidate["receiving"] = dict(prior["receiving"])
        candidate["inventory"] = dict(prior["inventory"])
        candidate.pop("id")
        candidate["id"] = digest(candidate)
        if prior != candidate:
            raise ValueError("The retained comparison plan already selects a different cohort. "
                             "Resume it with its original --convert and --zone-id-field selections.")
        candidate = prior
    else:
        atomic_json(destination, candidate)
    atomic_json(args.source_directory / "gura-source-catalog.json", candidate["inventory"])
    event("comparison_plan_ready", path=str(destination), plan_id=candidate["id"],
          alternatives=len(candidate["cases"]),
          cases=[{"key": row["key"], "title": row["title"],
                  "source_cells": row["planned_source_cells"],
                  "source_area_ha": row["planned_source_area_ha"]} for row in candidate["cases"]])
    return destination, candidate



def run_original_programme(args, receipt, state, state_path):
    from model.compute_programme import ComputeProgrammes
    from model.workspace import Workspace
    from source_tools.gura_comparison import run_retained_programme
    manager = ComputeProgrammes(Workspace(args.workspace))
    programme_id = state.get("active_original_programme_id", receipt["programme_id"])
    if programme_id != receipt["programme_id"]:
        original = manager._load(receipt["programme_id"])
        active = manager._load(programme_id)
        if active["selection"] != original["selection"]:
            raise ValueError("The retained active programme differs from the original Gura selection")

    def observe(process, observation):
        state.update(phase="original native programme",
                     active_original_programme_id=observation["programme_id"],
                     original_native_observation=observation, updated_at=now())
        if process is not None:
            state["original_native_process"] = process
        atomic_json(state_path, state)
        event("original_native_programme_status",
              programme_id=receipt["programme_id"],
              observation=observation,
              process=state.get("original_native_process"))

    result = run_retained_programme(
        manager, programme_id, args.source_directory,
        record_name="original-native-command.json",
        log_name="original-native-programme.log",
        previous_record=state.get("original_native_process"),
        original_programme_id=receipt["programme_id"], notify=observe)
    event("original_native_programme_complete",
          programme_id=result["programme_id"], state=result["state"],
          process=state.get("original_native_process"))


def build_reference_report(args, receipt, plan, state, state_path):
    """Publish the completed original reference before the broad alternatives."""
    from model.workspace import Workspace
    from model.common import selected_models
    from model import scenario_decisions

    workspace = Workspace(args.workspace)
    active = selected_models(receipt)
    native_scope = {"models": active} if active != ["ndr", "sdr"] else {}
    original = workspace.prepare_run({"grid_id": receipt["grid_id"],
                                      "profile_id": receipt["profile_id"],
                                      "scenario_id": receipt["scenario_id"], **native_scope})
    if original["state"] != "complete":
        raise ValueError("Complete the retained original reference before producing its annual totals")
    selection = scenario_decisions.select_cohort(
        workspace, original["id"], alternative_run_ids=[],
        title=receipt["study"] + " | original annual watershed totals", zones=plan["zones"],
        delivery_mode="native_study", native_study={
            "title": plan["study"], "purpose": plan["purpose"],
            "reference": plan.get("source_reference"),
        })
    state.update(phase="original annual watershed totals", updated_at=now())
    atomic_json(state_path, state)

    def report_progress(progress):
        state.update(reference_report_progress=progress, updated_at=now())
        atomic_json(state_path, state)
        event("reference_report_progress", **progress)

    report = scenario_decisions.build(workspace, selection, progress=report_progress)
    directory = workspace.root / "scenario-decisions" / report["id"]
    state.update(reference_report_id=report["id"],
                 reference_report_directory=str(directory),
                 reference_report_files=report["files"], updated_at=now())
    atomic_json(state_path, state)
    event("reference_report_complete", report_id=report["id"],
          baseline_run_id=original["id"], directory=str(directory), files=report["files"])
    return report


def operator_command(args):
    command = [sys.executable, "-B", str(APPLICATION_ROOT / "operator" / "server.py"),
               "--workspace", str(args.workspace),
               "--operator-state", str(args.operator_state),
               "--port", str(args.port)]
    manifest = args.source_directory / "sources.json"
    if manifest.is_file():
        command.extend(["--source-manifest", str(manifest),
                        "--source-root", str(args.source_directory)])
    return command


def serve(args):
    command = operator_command(args)
    event("operator_starting", argv=command,
          ready_file=str(args.operator_ready_file) if args.operator_ready_file else None)
    if args.operator_ready_file is None:
        return subprocess.call(command, cwd=APPLICATION_ROOT)
    ready_path = args.operator_ready_file.resolve()
    ready_path.parent.mkdir(parents=True, exist_ok=True)
    # Keep the single original server receipt separate from workflow JSONL.
    # An existing receipt may belong to a server already serving this study.
    with ready_path.open("x", encoding="utf-8") as ready:
        return subprocess.call(command, cwd=APPLICATION_ROOT, stdout=ready)


def status(args):
    receiving_path = args.source_directory / "receiving.json"
    progress_path = args.source_directory / "gura-workflow.json"
    result = {"schema": SCHEMA, "operation_id": OPERATION_ID,
              "workspace": str(args.workspace), "source_directory": str(args.source_directory),
              "receiving": read_json(receiving_path) if receiving_path.exists() else None,
              "progress": read_json(progress_path) if progress_path.exists() else None,
              "operator_command": operator_command(args)}
    if args.inspect_runtime:
        result["runtime"] = runtime(require_native=True)
    event("status", result=result)
    return 0


def bind_receiving_location(args, receipt, state, state_path):
    from model.workspace import Workspace

    ws = Workspace(args.workspace)
    identity = {
        "workspace_id": ws.project["id"],
        "receiving_sha256": sha256(args.source_directory / "receiving.json"),
        "source_collection_id": receipt["source_collection_id"],
        "source_manifest_sha256": receipt["source_manifest_sha256"],
        "grid_id": receipt["grid_id"], "profile_id": receipt["profile_id"],
        "baseline_scenario_id": receipt["scenario_id"],
        "original_programme_id": receipt["programme_id"],
    }
    if any(state.get(name) not in (None, receipt[name])
           for name in ("grid_id", "profile_id")):
        raise ValueError("The retained workflow has another original Gura grid or profile")
    previous_identity = state.get("receiving_identity")
    if previous_identity is not None and previous_identity != identity:
        raise ValueError("The retained workflow selects another original Gura Workspace")
    location = {"workspace": str(args.workspace),
                "source_directory": str(args.source_directory)}
    previous = {name: state.get(name) for name in location}
    if previous != location:
        history = state.setdefault("receiving_locations", [])
        if not history or any(history[-1].get(name) != previous[name] for name in previous):
            history.append({**previous, "moved_at": now()})
        event("receiving_workspace_reopened", **location, workspace_id=ws.project["id"],
              original_location=previous)
    state.update(**location, receiving_identity=identity, updated_at=now())
    atomic_json(state_path, state)


def workflow(args):
    from source_tools import gura_comparison
    state_path = args.source_directory / "gura-workflow.json"
    with operation_lock(args.source_directory):
        restore_workflow_paths(args)
        state = read_json(state_path) if state_path.exists() else {
            "schema": SCHEMA, "operation_id": OPERATION_ID, "created_at": now(),
            "workspace": str(args.workspace), "source_directory": str(args.source_directory),
        }
        if state.get("schema") != SCHEMA or state.get("operation_id") != OPERATION_ID:
            raise ValueError("Select the retained GURA-NATIVE-01 workflow")
        if (state.get("workspace") != str(args.workspace)
                or state.get("source_directory") != str(args.source_directory)):
            check_receiving(args.source_directory / "receiving.json", args.workspace)
        previous_application = state.get("application", {}).get("sha256")
        args._retained_source_reference = state.get("source_reference") or (
            "retained-application-sha256:" + previous_application if previous_application else None)
        try:
            state.update(state="running", phase="runtime", updated_at=now(),
                         source_directory=str(args.source_directory),
                         hostname=socket.gethostname(), pid=os.getpid())
            state.pop("error", None)
            atomic_json(state_path, state)
            identity = source_identity()
            # Reopening completed native runs needs only the GIS/reporting stack.
            # ComputeProgrammes.execute verifies the pinned native runtime for
            # unfinished runs, after resolving their original retained bindings.
            available = runtime()
            source_reference = args._retained_source_reference or args.source_reference or (
                "retained-application-sha256:" + identity["sha256"])
            state.update(runtime=available, application=identity, source_reference=source_reference,
                         execution_environment={name: os.environ.get(name) for name in
                                                ("GDAL_CACHEMAX", "GDAL_NUM_THREADS")})
            atomic_json(state_path, state)
            if available["errors"]:
                issues = "; ".join(name + ": " + item["message"] for name, item in available["errors"].items())
                raise RuntimeError("Use the application's compatible interpreter. " + issues)
            state.update(phase="original inputs", updated_at=now())
            atomic_json(state_path, state)
            receipt = prepare(args, identity)
            bind_receiving_location(args, receipt, state, state_path)
            from model.compute_programme import ComputeProgrammes
            from model.workspace import Workspace
            saved_selection = ComputeProgrammes(
                Workspace(args.workspace)).status(receipt["programme_id"])["selection"]
            state.setdefault("original_programme_id", receipt["programme_id"])
            state.update(source_reference=saved_selection.get("source_reference"),
                         grid_id=receipt["grid_id"], profile_id=receipt["profile_id"],
                         phase="scenario catalogue", updated_at=now())
            atomic_json(state_path, state)
            plan_path, plan = plan_and_catalog(args)
            if state.get("plan_id") not in (None, plan["id"]):
                raise ValueError("The retained workflow names another original class-comparison plan")
            state.update(plan_id=plan["id"], alternative_count=len(plan["cases"]),
                         phase="inputs and scenarios prepared", updated_at=now())
            atomic_json(state_path, state)
            retain_workflow(args, receipt, plan, state)
            if args.command == "prepare":
                state.update(state="prepared", updated_at=now())
                atomic_json(state_path, state)
                event("prepared", result=state)
                return 0
            run_original_programme(args, receipt, state, state_path)
            build_reference_report(args, receipt, plan, state, state_path)
            state.update(phase="native comparisons and reports", updated_at=now())
            atomic_json(state_path, state)
            retain_workflow(args, receipt, plan, state)
            result = gura_comparison.execute(
                args.source_directory / "receiving.json", plan_path,
                output=args.source_directory / "gura-comparison-result.json",
                build_economics=not args.physical_only, backup=args.backup,
                workspace=args.workspace)
            state.update(state="complete", phase="native report and Workspace archive complete",
                         programme_id=result["programme_id"],
                         baseline_run_id=result["baseline_run_id"],
                         alternative_run_ids=result["alternative_run_ids"],
                         native_report_directory=result["native_report_directory"],
                         native_report_path=result["native_report_path"],
                         economic_editions=result["economic_editions"],
                         workspace_archive=result.get("workspace_archive"),
                         result_path=str(args.source_directory / "gura-comparison-result.json"),
                         operator_command=operator_command(args), completed_at=now(), updated_at=now())
            atomic_json(state_path, state)
            event("complete", result=state)
        except BaseException as error:
            state.update(state="interrupted", updated_at=now(),
                         error={"type": type(error).__name__, "message": str(error)})
            atomic_json(state_path, state)
            raise
    return serve(args) if args.serve else 0


def main(argv=None):
    # Configure the inherited native child before any GIS/native imports.
    # Explicit caller settings remain visible and take precedence.
    os.environ.setdefault("GDAL_CACHEMAX", "16")
    os.environ.setdefault("GDAL_NUM_THREADS", "1")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("status", "prepare", "run", "serve"))
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--source-directory", type=Path, required=True)
    parser.add_argument("--archives", type=Path,
                        help="Retained original 3.20.0 directory containing NDR.zip and SDR.zip")
    parser.add_argument("--tables", type=Path,
                        default=APPLICATION_ROOT / "source" / "gura-original-tables-3.20")
    parser.add_argument("--source-reference")
    parser.add_argument("--expected-resolution-m", type=float,
                        help="Optional expected source cell size; new intake reads its original raster, resume retains its grid")
    parser.add_argument("--upstream-buffer-m", type=float,
                        help="New original intake defaults to zero added context; an existing receipt retains its buffer")
    parser.add_argument("--convert", action="append",
                        help="Optional original FROM:TO class pair; repeat for a selected cohort")
    parser.add_argument("--zone-id-field",
                        help="Original watershed feature ID field, retained with the comparison plan")
    parser.add_argument("--backup", type=Path,
                        help="Complete Workspace archive outside the Workspace; defaults beside it")
    parser.add_argument("--physical-only", action="store_true",
                        help="Produce the native watershed report without the economic companion")
    parser.add_argument("--operator-state", type=Path)
    parser.add_argument("--operator-ready-file", type=Path,
                        help="Write only the original server startup receipt to a new local file")
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--serve", action="store_true",
                        help="Open the operator server after the native run and archive finish")
    parser.add_argument("--inspect-runtime", action="store_true",
                        help="Include actual imported runtime versions in status")
    args = parser.parse_args(argv)
    args.workspace = args.workspace.resolve()
    args.source_directory = args.source_directory.resolve()
    args.operator_state = (args.operator_state or args.workspace.with_name(args.workspace.name + "-operator")).resolve()
    args.backup = (args.backup or args.workspace.with_name(
        args.workspace.name + ("-physical-complete.zip" if args.physical_only else "-complete.zip"))).resolve()
    if args.expected_resolution_m is not None and (
            not math.isfinite(args.expected_resolution_m) or args.expected_resolution_m <= 0):
        parser.error("--expected-resolution-m must be positive and finite")
    if args.upstream_buffer_m is not None and (
            not math.isfinite(args.upstream_buffer_m) or args.upstream_buffer_m < 0):
        parser.error("--upstream-buffer-m must be nonnegative and finite")
    if not 0 <= args.port <= 65535:
        parser.error("--port must be between 0 and 65535")
    if args.backup.is_relative_to(args.workspace):
        parser.error("--backup must be outside the Workspace")
    try:
        if args.command == "status":
            return status(args)
        if args.command == "serve":
            restore_workflow_paths(args)
            check_receiving(args.source_directory / "receiving.json", args.workspace, args)
            return serve(args)
        return workflow(args)
    except (ValueError, OSError, KeyError, TypeError, ImportError, RuntimeError) as error:
        event("error", type=type(error).__name__, message=str(error))
        return 1
    except KeyboardInterrupt:
        event("interrupted", message="Resume the same command to continue the retained Workspace and programme.")
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
