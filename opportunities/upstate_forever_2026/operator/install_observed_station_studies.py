"""Add observed station recipes to the maintained Station Geography catalogue."""
from __future__ import annotations
import argparse
import ast
import datetime as dt
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import tempfile

FILES = (
    "model/station_wbd_context.py",
    "operator/observed_station_wbd_hooks.json",
    "observations/wbd_station_join_20261013/station-context.sources.json",
    "observations/wbd_station_join_20261013/station_context.mjs",
    "observations/wbd_station_join_20261013/rebuild_station_context.mjs",
    "observations/wbd_station_join_20261013/STATION_CONTEXT.md",
    "model/observed_station_studies.py",
    "model/observed_station_studies.json",
    "observations/station_context.sources.json",
    "calibration_station_geography.sources.json",
    "regional_station_context.sources.json",
    "operator/OBSERVED_STATION_STUDIES.md",
    "operator/install_observed_station_studies.py",
)
MARKER = "    # Original observation station study catalogue extension"
HOOK = MARKER + """
    from .observed_station_studies import prepared_studies as observed_station_studies
    studies.extend(observed_station_studies(workspace, original_studies=studies))
"""
ANCHOR = '    return {"schema": "upstate.station-geography-catalog/v1"'

def catalogue_source(current):
    if MARKER in current:
        if current.count(HOOK) != 1:
            raise ValueError("Compose the existing observed station catalogue extension explicitly")
        return current
    if current.count(ANCHOR) != 1:
        raise ValueError("Choose the maintained Station Geography catalogue")
    return current.replace(ANCHOR, HOOK + ANCHOR, 1)

def wbd_source(current, hooks):
    if hooks.get("schema") != "upstate.observed-station-wbd-hooks/v1":
        raise ValueError("Choose the authored WBD station integration hooks")
    for edit in hooks["edits"]:
        before, after = edit["before"], edit["after"]
        if current.count(after) == 1:
            continue
        if current.count(before) != 1:
            raise ValueError("Compose the current Station Geography WBD hook explicitly: " + before)
        current = current.replace(before, after, 1)
    return current


# These generated native manifests share the source identity added by this
# component. Install their current authored edition together; raw observations
# and publisher responses still require exact equality with any installed body.
AUTHORED_BINDINGS = {
    "source/hydrology-huc05-07-20261013/model-sources.json",
    "observed_hydrology_context.report.json",
    "observed_hydrology_context.sources.json",
}


def _relative(value):
    if not isinstance(value, str) or not value or "\\" in value:
        raise ValueError("Select an original relative POSIX source path")
    path = PurePosixPath(value)
    if (path.is_absolute() or path.as_posix() != value
            or any(part in {".", ".."} or ":" in part for part in path.parts)):
        raise ValueError("Original source path leaves the application: " + value)
    return path


def _member(root, name):
    path = root.joinpath(*_relative(name).parts)
    if not path.resolve().is_relative_to(root):
        raise ValueError("Original source path leaves the selected application: " + name)
    return path


def _source_body(application, source_root, name, definition):
    candidate, current = _member(source_root, name), _member(application, name)
    body = candidate.read_bytes() if candidate.is_file() else current.read_bytes()
    expected_sha = definition.get("sha256")
    if (not isinstance(expected_sha, str) or len(expected_sha) != 64
            or hashlib.sha256(body).hexdigest() != expected_sha
            or (definition.get("bytes") is not None and len(body) != definition["bytes"])):
        raise ValueError("Original observation source differs: " + name)
    if (current.is_file() and current.read_bytes() != body
            and name not in AUTHORED_BINDINGS):
        raise ValueError("Preserve the newer source already at " + name + " and reconcile its study recipe")
    return body


def _manifest_members(name, body):
    manifest = json.loads(body)
    if manifest.get("schema") != "upstate.sources/v1" or not manifest.get("entries"):
        raise ValueError("Choose the complete native original-source manifest: " + name)
    parent = _relative(name).parent
    for entry in manifest["entries"]:
        for member in (entry, *entry.get("companions", [])):
            relative = _relative(member["path"])
            yield (parent / relative).as_posix(), member


def install(application, source_root, *, dry_run=False):
    application = Path(application).resolve(strict=True)
    source_root = Path(source_root).resolve(strict=True)
    target_catalogue = application / "model/station_geography.py"
    original = target_catalogue.read_bytes()
    pending = {}
    for name in FILES:
        pending[name] = (source_root / name).read_bytes()
    current_catalogue = catalogue_source(original.decode("utf-8"))
    hooks = json.loads(pending["operator/observed_station_wbd_hooks.json"])
    pending["model/station_geography.py"] = wbd_source(current_catalogue, hooks).encode("utf-8")
    spec = json.loads(pending["model/observed_station_studies.json"])
    manifest = json.loads(pending["observations/station_context.sources.json"])
    if spec.get("schema") != "upstate.observed-station-recipes/v1" or manifest.get("schema") != "upstate.sources/v1":
        raise ValueError("Choose the authored observation study definitions and native source manifest")
    source_manifests = [name for name in FILES if name.endswith(".sources.json")]
    report_pair = ("observed_hydrology_context.report.json",
                   "observed_hydrology_context.sources.json")
    if any((source_root / name).is_file() or (application / name).is_file()
           for name in report_pair):
        for name in report_pair:
            # Use the source edition as one pair. Falling back to a separately
            # installed report could retain its earlier calibration binding.
            candidate = _member(source_root, name)
            if not candidate.is_file():
                raise ValueError("Include the current observed report binding pair in the source root: " + name)
            pending[name] = candidate.read_bytes()
        source_manifests.append(report_pair[1])
    references = {}
    for definition in spec["sources"].values():
        references[definition["path"]] = definition
    for manifest_name in source_manifests:
        for name, definition in _manifest_members(manifest_name, pending[manifest_name]):
            previous_definition = references.get(name)
            if (previous_definition and
                    previous_definition["sha256"] != definition["sha256"]):
                raise ValueError("Selected original manifests bind different source editions: " + name)
            references[name] = definition
    for name, definition in references.items():
        body = _source_body(application, source_root, name, definition)
        if name in pending and pending[name] != body:
            raise ValueError("The authored source binding differs from its native manifest: " + name)
        pending[name] = body
    for name, body in pending.items():
        if name.endswith(".py"):
            ast.parse(body.decode("utf-8"), filename=name)
        elif name.endswith(".json"):
            json.loads(body)
    previous = {name: (application / name).read_bytes() if (application / name).exists() else None for name in pending}
    if previous["model/station_geography.py"] != original:
        raise RuntimeError("Station Geography changed during catalogue preparation")
    changed = [name for name in pending if pending[name] != previous[name]]
    result = {"schema": "upstate.observed-station-install/v1", "application": str(application),
              "dry_run": dry_run, "changed": changed, "study_count": len(spec["studies"]),
              "original_source_count": len(spec["sources"]),
              "retained_source_members": len(references),
              "native_source_manifests": source_manifests}
    if dry_run:
        return result
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    backup = application / ".observed-station-backups" / stamp
    with tempfile.TemporaryDirectory(prefix=".observed-stations-", dir=application.parent) as temporary:
        staging = Path(temporary)
        for name in changed:
            target = staging / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(pending[name])
        for name in changed:
            target = application / name
            current = target.read_bytes() if target.exists() else None
            if current != previous[name]:
                raise RuntimeError("Concurrent authored source changed: " + name)
        for name in changed:
            target = application / name
            if previous[name] is not None:
                saved = backup / name
                saved.parent.mkdir(parents=True, exist_ok=True)
                saved.write_bytes(previous[name])
            target.parent.mkdir(parents=True, exist_ok=True)
            os.replace(staging / name, target)
    result["installed_at"] = dt.datetime.now(dt.timezone.utc).isoformat()
    return result

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", required=True)
    parser.add_argument("--source-root", default=str(Path(__file__).resolve().parent.parent))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    print(json.dumps(install(args.application, args.source_root, dry_run=args.dry_run), indent=2))

if __name__ == "__main__":
    main()
