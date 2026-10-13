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
from .common import SCHEMA, atomic_json, canonical, file_digest, held, now, read_json
from .portable_databases import snapshot_databases, without_database_files, verify_database_sources

FORMAT = "upstate.scientific-workspace-archive/v1"
APPLICATION_FILES = (
    "observed_hydrology_context.report.json",
    "observed_hydrology_context.sources.json",
    "eighteenmile_scientific_figures.sources.json",
    "README.md",
    "PACKAGING_LIMITS.md",
    "audit.py",
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
    for name in APPLICATION_FILES:
        path = source_root / name
        if path.is_file():
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

def backup(workspace, destination, *, include_intermediates=True, include_deliveries=True,
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
    records = {}
    try:
        with contextlib.ExitStack() as stack:
            stack.enter_context(held(root / ".workspace.lock", blocking=False))
            for path in sorted((root / "experiments").glob("*/.experiment.lock")):
                stack.enter_context(held(path, blocking=False))
            for path in sorted((root / "runs").glob("*/.run.lock")):
                stack.enter_context(held(path, blocking=False))
            for path in sorted((root / "grids").glob("*/.grid.lock")):
                stack.enter_context(held(path, blocking=False))
            for path in sorted((root / "receiving-water-analyses").glob("*/.analysis.lock")):
                stack.enter_context(held(path, blocking=False))
            initial = _inventory(root, excluded=excluded, **selection)
            application = {p.relative_to(source_root).as_posix(): _identity(p)
                           for p in _application(source_root)}
            inputs = [("workspace/" + relative, root / relative, identity)
                      for relative, identity in initial.items()]
            inputs += [("application/" + relative, source_root / relative, identity)
                       for relative, identity in application.items()]
            inputs, databases, database_sources = stack.enter_context(
                snapshot_databases(inputs, destination.parent, frozen=frozen_databases))
            with zipfile.ZipFile(pending, "x", compression=zipfile.ZIP_DEFLATED,
                                 compresslevel=3, allowZip64=True) as archive:
                for name, path, before in inputs:
                    member_name(name)
                    digest = hashlib.sha256()
                    size = 0
                    with path.open("rb") as source, archive.open(name, "w", force_zip64=True) as output:
                        if _identity(path) != before:
                            raise ValueError("Source changed before archive capture: " + name)
                        for block in iter(lambda: source.read(1024 * 1024), b""):
                            output.write(block)
                            digest.update(block)
                            size += len(block)
                    if _identity(path) != before:
                        raise ValueError("Source changed during archive capture: " + name)
                    records[name] = {"bytes": size, "sha256": digest.hexdigest()}
                verify_database_sources(database_sources)
                current = _inventory(root, excluded=excluded, **selection)
                if (without_database_files(current, databases, "workspace") !=
                        without_database_files(initial, databases, "workspace")):
                    raise ValueError("Workspace changed while its archive was captured")
                current_application = {p.relative_to(source_root).as_posix(): _identity(p)
                                       for p in _application(source_root)}
                if (without_database_files(current_application, databases, "application") !=
                        without_database_files(application, databases, "application")):
                    raise ValueError("Application changed while its archive was captured")
                manifest = {"schema": FORMAT, "project": workspace.project, "created_at": now(),
                            "selection": selection, "members": records,
                            "database_snapshots": databases,
                            "receiving": "python application/model/cli.py restore ARCHIVE NEW_DIRECTORY",
                            "source_views": "Recreated from the original content-addressed objects on demand"}
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
                      "selection": selection, "database_snapshots": databases}
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
        if not name.startswith(("workspace/", "application/")):
            raise ValueError("Unexpected archive member namespace")
        info = archive.getinfo(name)
        if info.file_size != record["bytes"]:
            raise ValueError("Archived file length differs: " + name)
        if verify:
            h = hashlib.sha256()
            with archive.open(name) as source:
                for block in iter(lambda: source.read(1024 * 1024), b""):
                    h.update(block)
            if h.hexdigest() != record["sha256"]:
                raise ValueError("Archived file bytes differ: " + name)
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
                reviewer.validate_saved(review, verified_members=manifest["members"])
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
                exporter.inspect(value["id"], verified_members=manifest["members"])
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
        # Finish identity reads and response construction before publication.
        # The retained descriptor stays bound to the same opened archive edition.
        archive_sha256 = _archive_digest(archive_source, before)
        result = {"schema": "upstate.scientific-workspace-receiving/v1", "project": manifest["project"],
                  "directory": str(destination), "workspace": str(destination / "workspace"),
                  "application": str(destination / "application"),
                  "archive_sha256": archive_sha256, "members": len(manifest["members"]),
                  "selection": manifest["selection"], "identity": "MATCH",
                  "database_snapshots": manifest.get("database_snapshots", {})}
        # Directory rename is final publication; the staging directory is owned.
        if destination.exists():
            raise ValueError("Receiving destination appeared during capture")
        os.rename(pending, destination)
        pending = None
        return result
    finally:
        if pending is not None:
            shutil.rmtree(pending)
