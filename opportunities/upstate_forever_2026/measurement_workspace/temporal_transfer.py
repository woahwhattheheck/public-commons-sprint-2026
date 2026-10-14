"""Receive an existing monitoring calculation without rerunning its science."""
from __future__ import annotations

import json
from pathlib import Path, PurePosixPath
import shutil
import stat
import tempfile
import zipfile

from measurement_workspace.temporal_analysis import canonical, sha, SCHEMA


def receive(source: Path, destination: Path, *, maximum_bytes=512 * 1024 * 1024) -> dict:
    """Keep every original input and exact report; import no executable module."""
    source = source.resolve(strict=True)
    destination = destination.resolve()
    if destination.exists():
        raise ValueError("Choose a new receiving directory; existing analysis files stay unchanged.")
    destination.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=".receive-", dir=destination.parent))
    try:
        with zipfile.ZipFile(source) as archive:
            infos = archive.infolist()
            if not infos or len(infos) > 2000 or sum(i.file_size for i in infos) > maximum_bytes:
                raise ValueError("The monitoring package exceeds the selected receiving capacity.")
            names = set()
            for entry in infos:
                path = PurePosixPath(entry.filename)
                if entry.is_dir() or path.is_absolute() or ".." in path.parts or "\\" in entry.filename or ":" in path.parts[0] or str(path) != entry.filename or entry.filename in names:
                    raise ValueError("The monitoring package has an unsafe or repeated file member.")
                if stat.S_ISLNK(entry.external_attr >> 16):
                    raise ValueError("Monitoring source packages cannot contain symbolic links.")
                names.add(entry.filename)
            if not {"package-manifest.json", "analysis.json", "selection.json", "review.html"} <= names:
                raise ValueError("Select the complete temporal-analysis.zip source package.")
            manifest_entry = archive.getinfo("package-manifest.json")
            if manifest_entry.file_size > 2 * 1024 * 1024:
                raise ValueError("The package member manifest is too large.")
            manifest = json.loads(archive.read("package-manifest.json"))
            if manifest.get("schema") != "upstate.temporal-package/v1":
                raise ValueError("Unsupported monitoring package manifest.")
            described = {row["path"]: row for row in manifest["members"]}
            if len(described) != len(manifest["members"]) or set(described) != names - {"package-manifest.json"}:
                raise ValueError("The package inventory does not cover exactly the received files.")
            for entry in infos:
                data = archive.read(entry)
                if entry.filename != "package-manifest.json":
                    record = described[entry.filename]
                    if len(data) != record["bytes"] or sha(data) != record["sha256"]:
                        raise ValueError("A received original differs from its manifest: " + entry.filename)
                target = stage.joinpath(*PurePosixPath(entry.filename).parts)
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data)
        analysis = json.loads((stage / "analysis.json").read_text(encoding="utf-8"))
        if analysis.get("schema") != SCHEMA or analysis.get("id") != manifest.get("analysis_id"):
            raise ValueError("The original analysis and received package have different identities.")
        identity = sha(canonical({"selection": analysis["selection"], "sources": analysis["input_sources"], "implementation": analysis["implementation"]}))
        if identity != analysis["id"]:
            raise ValueError("The original calculation selection or source identity differs.")
        if json.loads((stage / "selection.json").read_text()) != analysis["selection"]:
            raise ValueError("The editable selection differs from the saved calculation.")
        for record in analysis["input_sources"]:
            name = "inputs/" + record["path"]
            if name not in described or (described[name]["bytes"], described[name]["sha256"]) != (record["bytes"], record["sha256"]):
                raise ValueError("The source package lacks an exact original input: " + record["path"])
        for name, expected_sha in analysis["implementation"].items():
            if "engine/" + name not in described or described["engine/" + name]["sha256"] != expected_sha:
                raise ValueError("The original calculation implementation is incomplete.")
        # Preserve the sender's exact ZIP as the recipient's re-export, rather
        # than repackaging an accepted calculation into a new identity.
        shutil.copyfile(source, stage / "temporal-analysis.zip")
        stage.rename(destination)
        return {"id": analysis["id"], "title": analysis["selection"]["title"],
                "selection": analysis["selection"], "summary": analysis["summary"],
                "implementation": analysis["implementation"],
                "received_package": {"bytes": source.stat().st_size, "sha256": sha(source.read_bytes())}}
    except BaseException:
        shutil.rmtree(stage, ignore_errors=True)
        raise
