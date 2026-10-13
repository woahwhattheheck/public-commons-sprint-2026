"""Add observed station recipes to the maintained Station Geography catalogue."""
from __future__ import annotations
import argparse
import ast
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import tempfile

FILES = (
    "model/observed_station_studies.py",
    "model/observed_station_studies.json",
    "observations/station_context.sources.json",
    "calibration_station_geography.sources.json",
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

def install(application, source_root, *, dry_run=False):
    application = Path(application).resolve(strict=True)
    source_root = Path(source_root).resolve(strict=True)
    target_catalogue = application / "model/station_geography.py"
    original = target_catalogue.read_bytes()
    pending = {}
    for name in FILES:
        pending[name] = (source_root / name).read_bytes()
    pending["model/station_geography.py"] = catalogue_source(original.decode("utf-8")).encode("utf-8")
    spec = json.loads(pending["model/observed_station_studies.json"])
    manifest = json.loads(pending["observations/station_context.sources.json"])
    if spec.get("schema") != "upstate.observed-station-recipes/v1" or manifest.get("schema") != "upstate.sources/v1":
        raise ValueError("Choose the authored observation study definitions and native source manifest")
    for definition in spec["sources"].values():
        name = definition["path"]
        candidate = source_root / name
        current = application / name
        body = candidate.read_bytes() if candidate.is_file() else current.read_bytes()
        if len(body) != definition["bytes"] or hashlib.sha256(body).hexdigest() != definition["sha256"]:
            raise ValueError("Original observation source differs: " + name)
        if current.is_file() and current.read_bytes() != body:
            raise ValueError("Preserve the newer source already at " + name + " and reconcile its study recipe")
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
              "original_source_count": len(spec["sources"])}
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
