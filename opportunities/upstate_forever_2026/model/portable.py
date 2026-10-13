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

FORMAT = "upstate.scientific-workspace-archive/v1"
APPLICATION_FILES = ("README.md", "audit.py", "raster_checks.py", "package_delivery.py",
                     "delivery_snapshot.py", "handoff_view.py", "focused_check.py",
                     "install_extensions.py", "install_experiments.py", "install_terrain.py",
                     "receive_application_source.py", "requirements-terrain.txt",
                     "terrain-source-manifest.json", "START_HERE.md", "TERRAIN_STATIC.md")
APPLICATION_DIRECTORIES = ("model", "operator", "source_tools", "source")
MAX_MANIFEST = 64 * 1024 * 1024

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
        folders[:] = sorted(name for name in folders if name not in ("source-views", "__pycache__")
                            and (include_deliveries or name != "deliveries")
                            and not (directory / name).is_symlink())
        for name in sorted(files):
            path = directory / name
            if path in excluded or name.endswith(".lock") or name.startswith((".write-", ".intake-", ".archive-")):
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
    for name in APPLICATION_DIRECTORIES:
        folder = source_root / name
        if folder.exists():
            files.extend(p for p in folder.rglob("*") if p.is_file() and not p.is_symlink()
                         and "__pycache__" not in p.parts and p.suffix != ".pyc")
    return sorted(set(files))

def backup(workspace, destination, *, include_intermediates=True, include_deliveries=True):
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
            for path in sorted((root / "runs").glob("*/.run.lock")):
                stack.enter_context(held(path, blocking=False))
            for path in sorted((root / "grids").glob("*/.grid.lock")):
                stack.enter_context(held(path, blocking=False))
            initial = _inventory(root, excluded=excluded, **selection)
            with zipfile.ZipFile(pending, "x", compression=zipfile.ZIP_DEFLATED,
                                 compresslevel=3, allowZip64=True) as archive:
                inputs = [("workspace/" + relative, root / relative, identity)
                          for relative, identity in initial.items()]
                inputs += [("application/" + p.relative_to(source_root).as_posix(), p, _identity(p))
                           for p in _application(source_root)]
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
                if _inventory(root, excluded=excluded, **selection) != initial:
                    raise ValueError("Workspace changed while its archive was captured")
                manifest = {"schema": FORMAT, "project": workspace.project, "created_at": now(),
                            "selection": selection, "members": records,
                            "receiving": "python application/model/cli.py restore ARCHIVE NEW_DIRECTORY",
                            "source_views": "Recreated from the original content-addressed objects on demand"}
                archive.writestr("ARCHIVE.json", canonical(manifest) + b"\n")
            with pending.open("rb") as file:
                os.fsync(file.fileno())
            inspect_archive(pending, verify=True)
            # Publish without replacing an unrelated archive created meanwhile.
            os.link(pending, destination)
            pending.unlink()
            fd = os.open(destination.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)
        return {"schema": FORMAT, "project_id": workspace.project["id"], "path": str(destination),
                "bytes": destination.stat().st_size, "sha256": file_digest(destination),
                "members": len(records), "selection": selection}
    finally:
        pending.unlink(missing_ok=True)

def inspect_archive(path, *, verify=True):
    with zipfile.ZipFile(path) as archive:
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
    from .workspace import Workspace
    destination = Path(destination).absolute()
    if destination.exists():
        raise ValueError("Restore into a new directory so existing work is preserved")
    manifest = inspect_archive(archive_path, verify=True)
    destination.parent.mkdir(parents=True, exist_ok=True)
    pending = Path(tempfile.mkdtemp(prefix=".receive-", dir=destination.parent))
    try:
        with zipfile.ZipFile(archive_path) as archive:
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
        for kind in ("sources", "profiles", "scenarios", "observations", "observation-comparisons"):
            restored._list(kind)
        reviews = restored._list("spatial-reviews")
        if reviews:
            from .spatial import SpatialReview
            reviewer = SpatialReview(restored)
            for review in reviews:
                reviewer.validate_saved(review, verified_members=manifest["members"])
        spatial_exports = restored.overview().get("spatial_exports", [])
        if spatial_exports:
            from .spatial_exports import SpatialExports
            exporter = SpatialExports(restored)
            for value in spatial_exports:
                exporter.inspect(value["id"], verified_members=manifest["members"])
        if restored._list("reviews"):
            from .reviews import validate_workspace
            # The archive inspection and extraction already checked every byte.
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
                    verify = pending / "workspace" / "runs" / original["id"] / artifact["path"]
                    if file_digest(verify) != artifact["sha256"]:
                        raise ValueError("Receiving changed a completed native result")
        # Directory rename is final publication; the staging directory is owned.
        if destination.exists():
            raise ValueError("Receiving destination appeared during capture")
        os.rename(pending, destination)
        pending = None
        return {"schema": "upstate.scientific-workspace-receiving/v1", "project": manifest["project"],
                "directory": str(destination), "workspace": str(destination / "workspace"),
                "application": str(destination / "application"),
                "archive_sha256": file_digest(archive_path), "members": len(manifest["members"]),
                "selection": manifest["selection"], "identity": "MATCH"}
    finally:
        if pending is not None:
            shutil.rmtree(pending)
