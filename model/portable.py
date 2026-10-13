"""Self-contained scientific workspace backup and new-directory receiving."""
from __future__ import annotations
import contextlib
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import tempfile
import zipfile
from .common import (SCHEMA, atomic_json, canonical, file_digest, held, identifier,
                     now, read_json, relative_file)
from .portable_databases import snapshot_databases, without_database_files, verify_database_sources
from .portable_acquisitions import capture_lock_paths, verify_acquisitions
from .portable_implementation import locked_implementation, verify_implementation
from .portable_parameter_studies import verify_parameter_studies

FORMAT = "upstate.scientific-workspace-archive/v1"
APPLICATION_FILES = (
    "observed_hydrology_context.report.json",
    "observed_hydrology_context.sources.json",
    "observed_flow_seasonality.report.json",
    "observed_flow_seasonality.sources.json",
    "observed_seasonal_figures.report.json",
    "observed_seasonal_figures.sources.json",
    "calibration_station_geography.sources.json",
    "eighteenmile_scientific_figures.sources.json",
    "eighteenmile_routine_nutrient_flow.sources.json",
    "README.md",
    "PACKAGING_LIMITS.md",
    "audit.py",
    "native_study_audit.py",
    "raster_checks.py",
    "package_delivery.py",
    "delivery_snapshot.py",
    "handoff_view.py",
    "focused_check.py",
    "install_extensions.py",
    "install_experiments.py",
    "install_terrain.py",
    "receive_application_source.py",
    "requirements-terrain.txt",
    "terrain-source-manifest.json",
    "START_HERE.md",
    "TERRAIN_STATIC.md",
    "environment.yml",
    "PROGRAMMES.md",
    "PAIRED_ENSEMBLES.md",
    "ENSEMBLES.md",
    "requirements-ensemble.txt",
    "install_programmes.py",
    "requirements-paired-ensemble.txt",
    "PUBLISHED_STUDIES.md",
    "eighteenmile_chlorophyll_reconciled.sources.json",
    "eighteenmile_point_source_context.sources.json",
    "eighteenmile_lake_observation_report.sources.json",
    "eighteenmile_lake_paired_analysis.sources.json",
    "published_studies_family.json",
    "eighteenmile_lake_microcystin_reconciliation.sources.json",
    "install_published_studies.py",
    "receive_published_studies.py",
    "tools/attach_published_report.py",
    "CHEMISTRY.md",
    "DECISION_CONTEXT.md",
    "GIS_SOURCE.json",
    "GURA_NATIVE_WORKFLOW.md",
    "NLCD_NATIVE_WPS.md",
    "LANDCOVER_LEDGER.md",
    "README_RECEIVING.md",
    "RFP_RESPONSE_MAP.md",
    "SOURCE_REFRESH.md",
    "WORKSHARE.md",
    "install_chemistry.py",
    "install_economic_desk.py",
    "install_gis_projects.py",
    "install_landcover.py",
    "install_source_refresh.py",
    "native_recovery_check.py",
    "receive_decision_source.py",
    "receive_upstate_local.py",
    "requirements-chemistry.txt",
    "requirements-landcover.txt",
    "water_context_cli.py",
    "WATER_CONTEXT_OPERATOR.md",
    "NATIVE_REUSE_MATCHING.md",
    "install_intelligence.py",
    "requirements-intelligence.txt",
    "install_native_supervision.py",
    "install_ensemble.py",
    "portable_sqlite_check.py",
    "science_catalog_delivery.py",
    "SCIENTIFIC_CATALOG.md",
    "install_intelligence_operator.py",
    "open_profile_desk.py",
    "install_profile_workbench.py",
)
APPLICATION_DIRECTORIES = (
    "assessment",
    "scenario-design",
    "model",
    "operator",
    "source_tools",
    "source",
    "source_data",
    "ecsa_runs",
    "eco_intelligence",
    "measurement_workspace",
    "observations",
    "checks",
    "docs",
    "examples",
    "integration",
    "integrations",
    "receiving",
    "tests",
    "tools",
)
MAX_MANIFEST = 64 * 1024 * 1024
RUNTIME_DIRECTORIES = {
    "__pycache__", ".git", ".hg", ".svn", ".venv", "venv", "node_modules",
}


def _retained_directory(path):
    return (path.name not in RUNTIME_DIRECTORIES
            and not path.name.startswith((".archive-", ".receive-", ".write-", ".intake-"))
            and not path.is_symlink()
            and not (path / "pyvenv.cfg").is_file())

def member_name(value):
    if not isinstance(value, str) or "\\" in value or "\0" in value:
        raise ValueError("Invalid archive member path")
    path = PurePosixPath(value)
    if path.is_absolute() or not path.parts or any(p in ("..", ".") for p in path.parts):
        raise ValueError("Archive paths must remain within the receiving directory")
    if str(path) != value:
        raise ValueError("Archive member path must be canonical")
    return path

def _identity(path):
    value = path.lstat()
    if not stat.S_ISREG(value.st_mode):
        raise ValueError("Only retained regular files enter the workspace archive")
    return (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns)

def _inventory(root, *, include_intermediates, include_deliveries, excluded):
    selected = {}
    for directory, folders, files in os.walk(root, followlinks=False):
        directory = Path(directory)
        relative = directory.relative_to(root)
        folders[:] = sorted(name for name in folders if name != "source-views"
                            and (include_deliveries or name != "deliveries")
                            and _retained_directory(directory / name))
        for name in sorted(files):
            path = directory / name
            if (path in excluded or name.endswith((".lock", ".pyc", ".pyo"))
                    or name.startswith(".native-recovery-reserve")
                    or name.startswith((".write-", ".intake-", ".archive-", ".native-reserve-"))):
                continue
            rel = (relative / name).as_posix()
            if not include_intermediates and len(relative.parts) >= 3 and relative.parts[0] == "runs":
                if "intermediate_outputs" in relative.parts or "_taskgraph_working_dir" in relative.parts:
                    continue
            if path.is_symlink():
                raise ValueError("Workspace contains a nonportable file alias: " + rel)
            member_name(rel)
            selected[rel] = _identity(path)
    return selected

def _application(source_root):
    files = []
    # Root source files added by another maintained component travel with the
    # same application; named nested entrypoints remain explicitly included.
    candidates = list(source_root.iterdir()) + [source_root / name for name in APPLICATION_FILES]
    for path in sorted(set(candidates)):
        if (path.name.startswith(".") or path.name.endswith((".pyc", ".pyo", ".lock"))
                or path.name == "APPLICATION_SOURCE_RECEIPT.json"):
            continue
        if path.is_symlink():
            raise ValueError("Application source contains a file alias: " + path.name)
        if path.is_file():
            _identity(path)
            files.append(path)
    # Preserve the complete maintained source families without walking installed
    # environments or version-control caches that can live beside their source.
    for name in APPLICATION_DIRECTORIES:
        folder = source_root / name
        if not folder.is_dir() or folder.is_symlink():
            continue
        for directory, folders, names in os.walk(folder, followlinks=False):
            directory = Path(directory)
            folders[:] = sorted(
                part for part in folders
                if _retained_directory(directory / part)
            )
            for filename in sorted(names):
                path = directory / filename
                if (path.suffix in {".pyc", ".pyo"} or filename.endswith(".lock")
                        or filename.startswith(".native-recovery-reserve")
                        or filename.startswith((".write-", ".intake-", ".archive-", ".native-reserve-"))):
                    continue
                if path.is_file() and not path.is_symlink():
                    files.append(path)
    return sorted(set(files))

def application_digest():
    """Identify the complete current source used by a newly requested delivery."""
    source_root = Path(__file__).resolve().parent.parent
    selected = {path.relative_to(source_root).as_posix(): _identity(path)
                for path in _application(source_root)}
    records = {}
    for relative, identity in selected.items():
        path = source_root / relative
        if _identity(path) != identity:
            raise ValueError("Application changed before delivery selection: " + relative)
        records[relative] = {"bytes": identity[2], "sha256": file_digest(path)}
        if _identity(path) != identity:
            raise ValueError("Application changed during delivery selection: " + relative)
    current = {path.relative_to(source_root).as_posix(): _identity(path)
               for path in _application(source_root)}
    if current != selected:
        raise ValueError("Application changed during delivery selection")
    return hashlib.sha256(canonical(records)).hexdigest()


def _delivery_inputs(directory, files, state=None):
    if directory is None and files is None and state is None:
        return [], {}, None
    if directory is None or not isinstance(files, dict) or not files:
        raise ValueError("Delivery capture requires its original directory and explicit file records")
    directory = Path(directory).resolve(strict=True)
    key = identifier(directory.name)
    inputs, expected, selected = [], {}, {}
    for role, item in files.items():
        if not isinstance(role, str) or not isinstance(item, dict):
            raise ValueError("Delivery capture requires named original artifact records")
        relative = member_name(item["path"]).as_posix()
        name = "delivery/" + relative
        path = relative_file(directory, relative)
        identity = _identity(path)
        wanted = {"bytes": item["bytes"], "sha256": item["sha256"]}
        if identity[2] != wanted["bytes"]:
            raise ValueError("Selected delivery file changed length: " + relative)
        if name in expected and expected[name] != wanted:
            raise ValueError("Selected delivery roles disagree on original bytes: " + relative)
        if name not in expected:
            inputs.append((name, path, identity))
            expected[name] = wanted
        selected[role] = {**item, "path": name}
    delivery = {"directory": "delivery", "id": key, "files": selected}
    if state is not None:
        if (not isinstance(state, dict) or state.get("schema") != "upstate.delivery/v1"
                or state.get("id") != key or not isinstance(state.get("selection"), dict)):
            raise ValueError("Delivery capture requires its original selected delivery record")
        original = {name: {**item, "path": item["path"][len("delivery/"):]}
                    for name, item in selected.items()}
        by_path = {item["path"]: item for item in original.values()}
        maps = {}
        for name, item in state.get("maps", {}).items():
            retained = by_path.get(item["path"])
            if retained is None or any(item[field] != retained[field]
                                       for field in ("bytes", "sha256")):
                raise ValueError("Delivery capture omits a selected original map")
            maps[name] = item
        omitted = {"files", "maps", "package", "manifest", "error", "reused", "completed_at"}
        record = {name: value for name, value in state.items() if name not in omitted}
        record.update(state="received_snapshot", files=original, maps=maps,
                      received_snapshot={"original_state": state.get("state"),
                                         "original_completed_at": state.get("completed_at")})
        delivery["record"] = record
    return inputs, expected, delivery


def _retain_received_archive(archive_source, destination, before, sha256):
    """Retain the same opened ZIP outside its own captured member inventory."""
    if _archive_identity(archive_source) != before:
        raise ValueError("Original archive changed before retaining its working copy")
    relative = "working/scientific-workspace.zip"
    target = Path(destination) / "delivery" / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    linked = False
    if target.exists():
        if target.is_symlink() or target.stat().st_size != before[2] or file_digest(target) != sha256:
            raise ValueError("Delivery snapshot conflicts with its enclosing working archive")
    else:
        source_path = Path(archive_source.name)
        try:
            same_source = (_identity(source_path) == before)
        except (OSError, ValueError):
            same_source = False
        if same_source:
            try:
                os.link(source_path, target)
            except OSError as error:
                import errno
                if error.errno not in {errno.EXDEV, errno.EPERM, errno.EACCES,
                                       errno.EOPNOTSUPP, errno.ENOSYS}:
                    raise
            else:
                linked = _identity(target)[:4] == before[:4]
                if not linked:
                    # The pathname was replaced after the identity check. Keep the
                    # original open descriptor and discard only our just-created link.
                    target.unlink()
        if not linked:
            copied = hashlib.sha256()
            archive_source.seek(0)
            with target.open("xb") as outgoing:
                for block in iter(lambda: archive_source.read(1024 * 1024), b""):
                    outgoing.write(block)
                    copied.update(block)
                outgoing.flush()
                os.fsync(outgoing.fileno())
            if copied.hexdigest() != sha256:
                raise ValueError("Retained working archive differs from its opened original")
    after = _archive_identity(archive_source)
    # Adding the safe hardlink changes ctime, but not device, inode, size or mtime.
    if (after[:4] != before[:4] or (not linked and after != before)
            or target.stat().st_size != before[2]):
        raise ValueError("Original archive changed while retaining its working copy")
    return {"path": relative, "bytes": before[2], "sha256": sha256}


def _register_received_delivery(manifest, destination, working_archive=None):
    """Register the verified snapshot where the original operator lists deliveries."""
    delivery = manifest.get("delivery") or {}
    record = delivery.get("record")
    if record is None:
        return
    key = identifier(delivery["id"])
    directory = Path(destination) / "workspace" / "deliveries" / key
    directory.mkdir(parents=True, exist_ok=True)
    state_path = directory / "delivery-state.json"
    if state_path.exists():
        existing = read_json(state_path)
        if existing.get("id") != key or existing.get("selection") != record["selection"]:
            raise ValueError("Received delivery registration conflicts with retained work")
        if existing.get("state") == "complete":
            return existing
    for item in record["files"].values():
        relative = member_name(item["path"]).as_posix()
        source = Path(destination) / "delivery" / relative
        target = directory.joinpath(*member_name(relative).parts)
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            if target.is_symlink() or (target.stat().st_size != item["bytes"]
                                      or file_digest(target) != item["sha256"]):
                raise ValueError("Received delivery artifact conflicts with retained work: " + relative)
        else:
            # Both trees live on the receiving filesystem; a link retains one data copy.
            os.link(source, target)
    if working_archive is not None:
        record = {**record, "files": {**record["files"], "working_archive": working_archive}}
        source = Path(destination) / "delivery" / working_archive["path"]
        target = directory.joinpath(*member_name(working_archive["path"]).parts)
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            if target.is_symlink() or (target.stat().st_size != working_archive["bytes"]
                                      or file_digest(target) != working_archive["sha256"]):
                raise ValueError("Received working archive conflicts with retained work")
        else:
            os.link(source, target)
    if working_archive is not None:
        from .received_delivery_navigation import build as build_received_navigation
        record = build_received_navigation(directory, record, working_archive)
    atomic_json(state_path, record)
    return record


def received_delivery(manifest, destination, record=None):
    """Expose reports and their original operator record after ordinary receiving."""
    delivery = manifest.get("delivery")
    if not delivery:
        return {}
    destination = Path(destination)
    result = {"id": delivery["id"], "directory": str(destination / delivery["directory"]),
              "files": {name: {**item, "path": str(destination / item["path"])}
                        for name, item in delivery["files"].items()}}
    if delivery.get("record") is not None:
        directory = destination / "workspace" / "deliveries" / identifier(delivery["id"])
        record = record if record is not None else read_json(directory / "delivery-state.json")
        result.update(workspace_directory=str(directory),
                      record=str(directory / "delivery-state.json"),
                      state=record["state"])
        for role in ("working_archive", "received_delivery_inventory", "map_atlas_received_browser"):
            retained = record.get("files", {}).get(role)
            if retained is not None:
                result["files"][role] = {
                    **retained, "path": str(directory / retained["path"])}
        if record.get("received_navigation"):
            result["navigation"] = record["received_navigation"]
    return {"delivery": result}


def _review_delivery_inputs(workspace, selected_delivery, stack, staging):
    """Retain original delivery layers needed by saved reviews without ZIP recursion."""
    needs = {}
    for review in workspace._list("spatial-reviews"):
        if review.get("project_id") != workspace.project["id"]:
            raise ValueError("Saved review belongs to another Workspace")
        for binding in review.get("bindings", []):
            if binding.get("group") != "delivery":
                continue
            key = identifier(binding["owner_id"])
            wanted = needs.setdefault(key, {"roles": {}, "atlas": set()})
            role = binding["role"]
            identity = {name: binding[name] for name in ("bytes", "sha256")}
            if role in wanted["roles"] and wanted["roles"][role] != identity:
                raise ValueError("Saved reviews select different bytes for one original delivery role")
            wanted["roles"][role] = identity
        origin = review.get("atlas_review", {}).get("origin")
        if origin is not None:
            if (origin.get("schema") != "upstate.atlas-review-origin/v1"
                    or origin.get("project_id") != workspace.project["id"]):
                raise ValueError("Saved atlas review has another original project binding")
            key = identifier(origin["delivery_id"])
            wanted = needs.setdefault(key, {"roles": {}, "atlas": set()})
            wanted["atlas"].add(identifier(origin["atlas_index_sha256"]))
    inputs, expected, retained = [], {}, []
    for key, wanted in sorted(needs.items()):
        selected = selected_delivery is not None and selected_delivery["id"] == key
        if selected:
            state = selected_delivery.get("record")
            if not isinstance(state, dict):
                raise ValueError("The selected delivery needs its original review registration")
            files = state["files"]
        else:
            directory = workspace.root / "deliveries" / key
            state_path = directory / "delivery-state.json"
            if not state_path.is_file():
                raise ValueError("Saved review lacks its original delivery: " + key)
            stack.enter_context(held(directory / ".delivery.lock", blocking=False))
            state = read_json(state_path)
            if (state.get("schema") != "upstate.delivery/v1" or state.get("id") != key
                    or state.get("state") not in {"complete", "received_snapshot"}
                    or not isinstance(state.get("selection"), dict)):
                raise ValueError("Saved review needs its completed original delivery selection")
            # Keep atlas index, map/source-context companions and native layers.
            # Nested working/GIS/export archives are separate deliverables.
            excluded_suffixes = {".zip", ".tar", ".tgz", ".gz", ".bz2", ".xz", ".7z"}
            files = {role: item for role, item in state.get("files", {}).items()
                     if Path(item["path"]).suffix.lower() not in excluded_suffixes}
        for role, identity in wanted["roles"].items():
            item = files.get(role)
            if item is None or any(item.get(name) != value for name, value in identity.items()):
                raise ValueError("Saved review changed its original delivery artifact: " + key + "/" + role)
        if wanted["atlas"]:
            index = files.get("map_atlas_index")
            if index is None or wanted["atlas"] != {index["sha256"]}:
                raise ValueError("Saved atlas reviews select another original delivery index")
            if "map_atlas_sources" not in files:
                raise ValueError("Saved atlas review needs its original source-context companion")
        if selected:
            continue
        captured, identities, snapshot = _delivery_inputs(directory, files, state)
        prefix = "workspace/deliveries/" + key + "/"
        for name, path, identity in captured:
            relative = name[len("delivery/"):]
            member = prefix + relative
            inputs.append((member, path, identity))
            expected[member] = identities[name]
        record_path = Path(staging) / (key + ".json")
        atomic_json(record_path, snapshot["record"])
        member = prefix + "delivery-state.json"
        inputs.append((member, record_path, _identity(record_path)))
        expected[member] = {"bytes": record_path.stat().st_size, "sha256": file_digest(record_path)}
        retained.append(key)
    return inputs, expected, retained


def _received_member_aliases(manifest, destination):
    """Expose already verified selected-delivery links under their Workspace names."""
    members = dict(manifest["members"])
    delivery = manifest.get("delivery") or {}
    record = delivery.get("record")
    if record is None:
        return members
    key = identifier(delivery["id"])
    directory = Path(destination) / "workspace" / "deliveries" / key
    for item in record["files"].values():
        relative = member_name(item["path"]).as_posix()
        original = "delivery/" + relative
        declared = members.get(original)
        wanted = {"bytes": item["bytes"], "sha256": item["sha256"]}
        if declared is None or any(declared.get(name) != value for name, value in wanted.items()):
            raise ValueError("Received delivery alias differs from its archived source: " + relative)
        linked = relative_file(directory, relative)
        source = relative_file(Path(destination) / "delivery", relative)
        if (linked.stat().st_size != wanted["bytes"]
                or (not os.path.samefile(linked, source) and file_digest(linked) != wanted["sha256"])):
            raise ValueError("Received delivery alias differs from its registered source: " + relative)
        alias = "workspace/deliveries/" + key + "/" + relative
        if alias in members and any(members[alias].get(name) != value
                                    for name, value in wanted.items()):
            raise ValueError("Received delivery alias conflicts with a retained Workspace member")
        members[alias] = {**declared, **wanted}
    return members


def backup(workspace, destination, *, include_intermediates=True, include_deliveries=True,
           delivery_root=None, delivery_files=None, delivery_state=None,
           frozen_databases=None):
    root = workspace.root
    destination = Path(destination).absolute()
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        raise ValueError("Choose a new archive path")
    pending = destination.parent / (".archive-" + destination.name + ".pending")
    if pending.exists():
        raise ValueError("The original archive staging path is already present")
    source_root = Path(__file__).resolve().parent.parent
    excluded = {destination, pending}
    selection = {"include_intermediates": bool(include_intermediates),
                 "include_deliveries": bool(include_deliveries)}
    inventory_selection = dict(selection)
    extra_inputs, expected_delivery, delivery = _delivery_inputs(
        delivery_root, delivery_files, delivery_state)
    if any(path in excluded for _, path, _ in extra_inputs):
        raise ValueError("A working archive cannot include itself")
    if delivery:
        selection["delivery_id"] = delivery["id"]
        selection["include_delivery_assets"] = True
    records = {}
    try:
        with contextlib.ExitStack() as stack:
            stack.enter_context(held(root / ".workspace.lock", blocking=False))
            stack.enter_context(held(root / ".receiving-water-report-source.lock", blocking=False))
            stack.enter_context(held(root / ".monitoring-report-source.lock", blocking=False))
            stack.enter_context(held(root / ".receiving-water-monitoring.lock", blocking=False))
            stack.enter_context(held(root / ".utility-monitoring.lock", blocking=False))
            for pattern in ("compute-programmes/*/.programme.lock",
                            "interactions/*/.interaction.lock",
                            "interaction-results/*/.analysis.lock"):
                for path in sorted(root.glob(pattern)):
                    stack.enter_context(held(path, blocking=False))
            for path in sorted((root / "experiments").glob("*/.experiment.lock")):
                stack.enter_context(held(path, blocking=False))
            for path in sorted((root / "runs").glob("*/.run.lock")):
                stack.enter_context(held(path, blocking=False))
            for path in sorted((root / "grids").glob("*/.grid.lock")):
                stack.enter_context(held(path, blocking=False))
            for path in sorted((root / "receiving-water-analyses").glob("*/.analysis.lock")):
                stack.enter_context(held(path, blocking=False))
            # Prepared captures may not yet have a lock file. Lock every retained
            # operation directory before inventory, in the donor helper's order.
            for path in capture_lock_paths(root):
                stack.enter_context(held(path, blocking=False))
            stack.enter_context(locked_implementation(root))
            if not include_deliveries:
                staging = stack.enter_context(tempfile.TemporaryDirectory(
                    prefix=".archive-review-deliveries-", dir=destination.parent))
                review_inputs, review_expected, review_deliveries = _review_delivery_inputs(
                    workspace, delivery, stack, staging)
                extra_inputs.extend(review_inputs)
                expected_delivery.update(review_expected)
                if review_deliveries:
                    selection["review_delivery_ids"] = review_deliveries
            initial = _inventory(root, excluded=excluded, **inventory_selection)
            application = {p.relative_to(source_root).as_posix(): _identity(p)
                           for p in _application(source_root)}
            inputs = [("workspace/" + relative, root / relative, identity)
                      for relative, identity in initial.items()]
            inputs += [("application/" + relative, source_root / relative, identity)
                       for relative, identity in application.items()]
            inputs += extra_inputs
            inputs, databases, database_sources = stack.enter_context(
                snapshot_databases(inputs, destination.parent, frozen=frozen_databases))
            with zipfile.ZipFile(pending, "x", compression=zipfile.ZIP_DEFLATED,
                                 compresslevel=3, allowZip64=True) as archive:
                for name, path, before in inputs:
                    member_name(name)
                    digest = hashlib.sha256()
                    size = 0
                    mode = "100755" if path.stat().st_mode & 0o111 else "100644"
                    member = zipfile.ZipInfo(name)
                    member.create_system = 3
                    member.compress_type = zipfile.ZIP_DEFLATED
                    member.external_attr = int(mode, 8) << 16
                    with path.open("rb") as source, archive.open(member, "w", force_zip64=True) as output:
                        if _identity(path) != before:
                            raise ValueError("Source changed before archive capture: " + name)
                        for block in iter(lambda: source.read(1024 * 1024), b""):
                            output.write(block)
                            digest.update(block)
                            size += len(block)
                    if _identity(path) != before:
                        raise ValueError("Source changed during archive capture: " + name)
                    records[name] = {"bytes": size, "sha256": digest.hexdigest(), "mode": mode}
                    if name in expected_delivery and {
                            key: records[name][key] for key in ("bytes", "sha256")
                    } != expected_delivery[name]:
                        raise ValueError("Selected delivery differs from its retained bytes: " + name)
                verify_database_sources(database_sources)
                current = _inventory(root, excluded=excluded, **inventory_selection)
                if (without_database_files(current, databases, "workspace") !=
                        without_database_files(initial, databases, "workspace")):
                    raise ValueError("Workspace changed while its archive was captured")
                current_application = {p.relative_to(source_root).as_posix(): _identity(p)
                                       for p in _application(source_root)}
                if (without_database_files(current_application, databases, "application") !=
                        without_database_files(application, databases, "application")):
                    raise ValueError("Application changed while its archive was captured")
                source_acquisitions = verify_acquisitions(
                    root, records, source_ids={row["id"] for row in workspace._list("sources")})
                implementation = verify_implementation(root, records)
                parameter_studies = verify_parameter_studies(workspace, records)
                manifest = {"schema": FORMAT, "project": workspace.project, "created_at": now(),
                            "selection": selection, "members": records,
                            "database_snapshots": databases,
                            "receiving": "python application/model/cli.py restore ARCHIVE NEW_DIRECTORY",
                            "source_views": "Recreated from the original content-addressed objects on demand",
                            "source_acquisitions": source_acquisitions,
                            "implementation": implementation,
                            "parameter_studies": parameter_studies}
                if delivery:
                    expected_application = (delivery.get("record", {}).get("selection") or {}).get(
                        "application_sha256")
                    if expected_application:
                        captured_application = {
                            name[len("application/"):]: {key: item[key] for key in ("bytes", "sha256")}
                            for name, item in records.items() if name.startswith("application/")}
                        if hashlib.sha256(canonical(captured_application)).hexdigest() != expected_application:
                            raise ValueError("Application changed since the delivery was selected")
                    manifest["delivery"] = delivery
                archive.writestr("ARCHIVE.json", canonical(manifest) + b"\n")
            with pending.open("rb") as file:
                os.fsync(file.fileno())
                before = _archive_identity(file)
                with zipfile.ZipFile(file) as archive:
                    _inspect_archive(archive, verify=True)
                archive_sha256 = _archive_digest(file, before)
                archive_bytes = before[2]
            result = {"schema": FORMAT, "project_id": workspace.project["id"],
                      "path": str(destination), "bytes": archive_bytes,
                      "sha256": archive_sha256, "members": len(records),
                      "selection": selection, "database_snapshots": databases,
                      "source_acquisitions": source_acquisitions,
                      "implementation": implementation,
                      "parameter_studies": parameter_studies}
            # Publish without replacing an unrelated archive created meanwhile.
            os.link(pending, destination)
            pending.unlink()
            fd = os.open(destination.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)
        return result
    finally:
        pending.unlink(missing_ok=True)

def _archive_identity(source):
    value = os.fstat(source.fileno())
    if not stat.S_ISREG(value.st_mode):
        raise ValueError("Select a retained regular archive file")
    return (value.st_dev, value.st_ino, value.st_size,
            value.st_mtime_ns, value.st_ctime_ns)


def _archive_digest(source, before):
    """Identify the opened archive before publishing any receiving result."""
    if _archive_identity(source) != before:
        raise ValueError("Archive changed during receiving")
    source.seek(0)
    digest = hashlib.sha256()
    for block in iter(lambda: source.read(1024 * 1024), b""):
        digest.update(block)
    if _archive_identity(source) != before:
        raise ValueError("Archive changed while its identity was recorded")
    return digest.hexdigest()


def inspect_archive(path, *, verify=True):
    with zipfile.ZipFile(path) as archive:
        return _inspect_archive(archive, verify=verify)


def _inspect_archive(archive, *, verify):
    entries = archive.infolist()
    names = [entry.filename for entry in entries]
    if len(names) != len(set(names)) or "ARCHIVE.json" not in names:
        raise ValueError("Archive has duplicate names or lacks its original manifest")
    for entry in entries:
        member_name(entry.filename)
        mode = entry.external_attr >> 16
        if entry.is_dir() or stat.S_ISLNK(mode) or entry.flag_bits & 1:
            raise ValueError("Archive members must be unencrypted regular files")
    info = archive.getinfo("ARCHIVE.json")
    if info.file_size > MAX_MANIFEST:
        raise ValueError("Archive manifest is too large")
    manifest = json.loads(archive.read(info))
    if manifest.get("schema") != FORMAT or manifest.get("project", {}).get("schema") != SCHEMA:
        raise ValueError("Select an original scientific workspace archive")
    declared = manifest.get("members")
    if not isinstance(declared, dict) or set(names) != set(declared) | {"ARCHIVE.json"}:
        raise ValueError("Archive content differs from its declared file inventory")
    if "workspace/workspace.json" not in declared:
        raise ValueError("Archive lacks the original project identity")
    for name, record in declared.items():
        member_name(name)
        if not name.startswith(("workspace/", "application/", "delivery/")):
            raise ValueError("Unexpected archive member namespace")
        info = archive.getinfo(name)
        if info.file_size != record["bytes"]:
            raise ValueError("Archived file length differs: " + name)
        mode = record.get("mode")
        if mode is not None:
            if mode not in {"100644", "100755"} or info.external_attr >> 16 != int(mode, 8):
                raise ValueError("Archived file mode differs: " + name)
        if verify:
            h = hashlib.sha256()
            with archive.open(name) as source:
                for block in iter(lambda: source.read(1024 * 1024), b""):
                    h.update(block)
            if h.hexdigest() != record["sha256"]:
                raise ValueError("Archived file bytes differ: " + name)
    delivery_members = {name for name in declared if name.startswith("delivery/")}
    if delivery_members:
        delivery = manifest.get("delivery")
        if (not isinstance(delivery, dict) or delivery.get("directory") != "delivery"
                or not isinstance(delivery.get("files"), dict)):
            raise ValueError("Delivery snapshot requires its original artifact index")
        selected_members = set()
        for item in delivery["files"].values():
            if not isinstance(item, dict):
                raise ValueError("Delivery snapshot artifact must retain its descriptor")
            name = member_name(item["path"]).as_posix()
            if name not in delivery_members or any(
                    item[key] != declared[name][key] for key in ("bytes", "sha256")):
                raise ValueError("Delivery snapshot descriptor differs from its archived bytes")
            selected_members.add(name)
        if selected_members != delivery_members:
            raise ValueError("Delivery snapshot index omits an archived file")
        identifier(delivery["id"])
        record = delivery.get("record")
        if record is not None:
            if (not isinstance(record, dict) or record.get("schema") != "upstate.delivery/v1"
                    or record.get("id") != delivery["id"]
                    or record.get("state") != "received_snapshot"
                    or not isinstance(record.get("selection"), dict)
                    or not isinstance(record.get("maps"), dict)):
                raise ValueError("Delivery snapshot has no original receiving registration")
            original_files = {name: {**item, "path": item["path"][len("delivery/"):]}
                              for name, item in delivery["files"].items()}
            if record.get("files") != original_files:
                raise ValueError("Delivery registration differs from its archived artifacts")
            by_path = {item["path"]: item for item in original_files.values()}
            for item in record["maps"].values():
                if not isinstance(item, dict) or item.get("path") not in by_path:
                    raise ValueError("Delivery registration includes an absent map")
                retained = by_path[item["path"]]
                if any(item[field] != retained[field] for field in ("bytes", "sha256")):
                    raise ValueError("Delivery registration changes an original map")
    elif manifest.get("delivery"):
        raise ValueError("Delivery snapshot index has no archived files")
    project = json.loads(archive.read("workspace/workspace.json"))
    if project != manifest["project"]:
        raise ValueError("Archived project identity differs")
    return manifest

def restore(archive_path, destination):
    destination = Path(destination).absolute()
    if destination.exists():
        raise ValueError("Restore into a new directory so existing work is preserved")
    # Metadata and extraction use one opened edition. Each payload is verified
    # during extraction rather than decompressed once just to inspect it first.
    with Path(archive_path).open("rb") as source:
        before = _archive_identity(source)
        with zipfile.ZipFile(source) as archive:
            manifest = _inspect_archive(archive, verify=False)
            return _restore_archive(archive, source, before, manifest, destination)


def _restore_archive(archive, archive_source, before, manifest, destination):
    from .workspace import Workspace
    destination.parent.mkdir(parents=True, exist_ok=True)
    pending = Path(tempfile.mkdtemp(prefix=".receive-", dir=destination.parent))
    try:
        for name, expected in manifest["members"].items():
            target = pending.joinpath(*member_name(name).parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            h = hashlib.sha256()
            with archive.open(name) as source, target.open("xb") as output:
                for block in iter(lambda: source.read(1024 * 1024), b""):
                    output.write(block)
                    h.update(block)
                output.flush()
                os.fsync(output.fileno())
            if h.hexdigest() != expected["sha256"] or target.stat().st_size != expected["bytes"]:
                raise ValueError("Receiving file differs: " + name)
            if expected.get("mode") is not None:
                target.chmod(int(expected["mode"], 8) & 0o777)
        # Restore selected original delivery bindings before saved Spatial checks.
        _register_received_delivery(manifest, pending)
        verified_members = _received_member_aliases(manifest, pending)
        restored = Workspace(pending / "workspace")
        if restored.project != manifest["project"]:
            raise ValueError("Receiving changed the original workspace identity")
        for kind in ("sources", "profiles", "scenarios", "observations", "observation-comparisons",
                     "planning-inventories", "portfolios", "portfolio-reports"):
            restored._list(kind)
        if restored._list("planning-inventories"):
            from .planning_inventory import inspect as inspect_planning_inventory
            for inventory in restored._list("planning-inventories"):
                inspect_planning_inventory(restored, inventory["id"])
        if restored._list("portfolios"):
            from .portfolios import verify_portfolio
            for portfolio in restored._list("portfolios"):
                verify_portfolio(restored, portfolio)
        for report in restored._list("portfolio-reports"):
            for retained in report["files"].values():
                path = restored.root.joinpath(*member_name(retained["path"]).parts)
                if (not path.is_file() or path.stat().st_size != retained["bytes"]
                        or file_digest(path) != retained["sha256"]):
                    raise ValueError("Receiving changed a conservation portfolio report")
        reviews = restored._list("spatial-reviews")
        if reviews:
            from .spatial import SpatialReview
            reviewer = SpatialReview(restored)
            for review in reviews:
                reviewer.validate_saved(review, verified_members=verified_members)
        if restored._list("spatial-regions"):
            from .spatial_regions import SpatialRegions
            SpatialRegions(restored).verify()
        if restored._list("spatial-cohorts"):
            from .spatial_cohorts import SpatialCohorts
            SpatialCohorts(restored).verify()
        spatial_exports = restored.overview().get("spatial_exports", [])
        if spatial_exports:
            from .spatial_exports import SpatialExports
            exporter = SpatialExports(restored)
            for value in spatial_exports:
                exporter.inspect(value["id"], verified_members=verified_members)
        if restored._list("reviews"):
            from .reviews import validate_workspace
            # Extraction already checked every retained member against its SHA-256.
            validate_workspace(restored)
        community_tables = restored._list("community-tables")
        community_plans = restored._list("community-plans")
        community_reports = restored._list("community-reports")
        if community_tables or community_plans or community_reports:
            from . import communities
            from .common import verify_file
            for table in community_tables:
                original, _ = restored.source_file(
                    table["source"]["collection_id"], table["source"]["source_id"])
                if file_digest(original) != table["source"]["sha256"]:
                    raise ValueError("Receiving changed the original community source")
            for plan in community_plans:
                table = communities.get_table(restored, plan["table_id"])
                if table["source"] != plan["source"]:
                    raise ValueError("Received community plan changed its table edition")
                communities.verify_plan_context(restored, plan)
            for report in community_reports:
                plan = communities.get_plan(restored, report["plan_id"])
                if (report["table_id"] != plan["table_id"] or
                        report["context_snapshot_sha256"] != plan["context"]["snapshot_sha256"]):
                    raise ValueError("Received community report changed its saved plan")
                for artifact in report["files"].values():
                    verify_file(restored.root, artifact)
        for grid in restored.overview()["grids"]:
            if grid["state"] == "complete":
                restored.get_grid(grid["id"])
        for run in restored.overview()["runs"]:
            original = restored.inspect_run(run["id"])
            if original["state"] == "complete":
                for artifact in original["artifacts"].values():
                    relative = member_name(artifact["path"]).as_posix()
                    name = member_name("workspace/runs/" + original["id"] + "/" + relative).as_posix()
                    retained = manifest["members"].get(name)
                    if (retained is None or retained["sha256"] != artifact["sha256"]
                            or ("bytes" in artifact and retained["bytes"] != artifact["bytes"])):
                        raise ValueError("Receiving changed a completed native result")
        # Original capture bodies are already byte-verified during extraction.
        # Reattach their operation lineage and imported editions without running
        # GIS derivation or rewriting an immutable request from its original host.
        source_acquisitions = verify_acquisitions(
            restored.root, verified_members,
            source_ids={row["id"] for row in restored._list("sources")})
        retained_acquisitions = manifest.get("source_acquisitions")
        if retained_acquisitions is not None and retained_acquisitions != source_acquisitions:
            raise ValueError("Receiving changed the original source acquisition lineage")
        implementation = verify_implementation(restored.root, verified_members)
        retained_implementation = manifest.get("implementation")
        if retained_implementation is not None and retained_implementation != implementation:
            raise ValueError("Receiving changed the original implementation plans or reports")
        parameter_studies = verify_parameter_studies(restored, verified_members)
        retained_studies = manifest.get("parameter_studies")
        if retained_studies is not None and retained_studies != parameter_studies:
            raise ValueError("Receiving changed the original parameter studies or exports")
        # Finish identity reads and response construction before publication.
        # The retained descriptor stays bound to the same opened archive edition.
        archive_sha256 = _archive_digest(archive_source, before)
        working_archive = None
        if (manifest.get("delivery") or {}).get("record") is not None:
            working_archive = _retain_received_archive(
                archive_source, pending, before, archive_sha256)
        received_record = _register_received_delivery(manifest, pending, working_archive)
        result = {"schema": "upstate.scientific-workspace-receiving/v1", "project": manifest["project"],
                  "directory": str(destination), "workspace": str(destination / "workspace"),
                  "application": str(destination / "application"),
                  "archive_sha256": archive_sha256, "members": len(manifest["members"]),
                  "selection": manifest["selection"], "identity": "MATCH",
                  "database_snapshots": manifest.get("database_snapshots", {}),
                  "source_acquisitions": source_acquisitions,
                  "implementation": implementation,
                  "parameter_studies": parameter_studies,
                  **received_delivery(manifest, destination, record=received_record)}
        if any((restored.root / "compute-programmes").glob("*/interaction-links/*.json")):
            from .programme_interactions import validate_workspace as validate_programme_interactions
            validate_programme_interactions(restored, verified_members=manifest["members"])
        # Verify retained Scenario analysis source context before publication.
        if any((restored.root / "scenario-source-contexts").glob("*.json")):
            from .analysis_source_context import verify_workspace as verify_analysis_source_context
            result["scenario_source_context"] = verify_analysis_source_context(restored)
        # Verify retained original point-source observation bindings before publication.
        if any((restored.root / "point-source-bindings").glob("*.json")):
            from source.retained_point_sources import verify_workspace as verify_point_source_bindings
            result["point_source_context"] = verify_point_source_bindings(restored)

        # Directory rename is final publication; the staging directory is owned.
        if destination.exists():
            raise ValueError("Receiving destination appeared during capture")
        os.rename(pending, destination)
        pending = None
        return result
    finally:
        if pending is not None:
            shutil.rmtree(pending)
