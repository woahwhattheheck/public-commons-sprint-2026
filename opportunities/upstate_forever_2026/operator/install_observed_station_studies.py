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
    "model/observed_station_studies.py",
    "source_tools/receive_observed_station_studies.py",
    "model/station_wbd_context.py",
    "operator/observed_station_wbd_hooks.json",
    "observations/wbd_station_join_20261013/station-context.sources.json",
    "observations/wbd_station_join_20261013/station_context.mjs",
    "observations/wbd_station_join_20261013/rebuild_station_context.mjs",
    "observations/wbd_station_join_20261013/STATION_CONTEXT.md",
    "integration/component_fragments/observed-station-wbd.json",
    "integration/component_fragments/observed-station-wbd-nldi-197.json",
    "integration/observed-station-wbd-components.json",
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



# Accept only these recorded generated-source transitions from the 184-point
# WBD edition to the complete 197-point edition. Direction and both identities
# are fixed: unrelated edits, newer bodies and reverse replacement still fail.
# Original publisher responses and point inputs are never upgrade candidates.
WBD_SOURCE_UPGRADES = {
    "observations/wbd_station_join_20261013/query-plan.json": (
        "cfe27b718fd572bd8c08066a79b0f69c872c9247b2dda8bbfcf16ae801920aad",
        "498652d776ff4eef2fac4c94f0bf62742c8441b12beb9bebaaf08375f943aad7",
    ),
    "observations/wbd_station_join_20261013/capture-index.json": (
        "f339aa0fbc24cd0441d3cacc2b2d55714ae1d397f7d20187e9c80808ff327573",
        "d3f9579edd3e708c63c9d2d4805207a2ff0e744c363524238d161783d40c7cf7",
    ),
    "observations/wbd_station_join_20261013/watershed_join.mjs": (
        "a2bb5fd9341dfc71f2561809ca118c30134897f78502485df00879e245df203b",
        "aee840c8a9ecc26b69b04168422cc31716df6857a6fde7f0dfc431564f2bf1fb",
    ),
    "observations/wbd_station_join_20261013/README.md": (
        "14353aad3ff1565862a89850c592b07e40f1ee1e144e8dcbc23c1a1ada4a37be",
        "a1ee3a6b77ec75fdd64256ca3525e1119fc2faa7aece4efc089e99cb32266a17",
    ),
    "observations/wbd_station_join_20261013/derived/point_watersheds.csv": (
        "6767a61912146ade1496a72a4704c00085aa02523d8e92c97e5124792354c28f",
        "4dae939207751422d63620d5fff17d0a6eb04e70743f8636e704db5363b5e8a4",
    ),
    "observations/wbd_station_join_20261013/derived/polygon_matches.csv": (
        "0f34b1d5d958e3cdac5a1fe6c7a7de9b01e9634751947fb4e6a065d2d5a2d0a9",
        "cc766b49806106e311fb5f198fc06de1745f1acfbd2587d5a612b195b2ab84cc",
    ),
    "observations/wbd_station_join_20261013/derived/summary.json": (
        "9891b4879db81ed99a691ab56e3e630fe7f6e3b56e0a5d381fb6e4eea63b85da",
        "f46a7dba0d4e03e93b2a95ce8253b26581cd5c414a0c54bac7ef770b9a2739ec",
    ),
    "observations/wbd_station_join_20261013/model-sources.json": (
        "59b64d22d1db2549da27a24cbc38f37fb0d9b79927d5dba149ba6229bc5be2c8",
        "147ef394e32a49d55e93c2231e4eba22110ee10fd0aefdff3e29f0185afa85b6",
    ),
    "observations/wbd_station_join_20261013/derived/station_context.csv": (
        "31488b1b105906240c779db7c268d69ec76c4252440d09d1aee373f09b841f0e",
        "af6e61b78ef6d3f666e43f9770cafa477f6667487d75fa9db9dc1394146004f7",
    ),
    "observations/wbd_station_join_20261013/rebuild_station_context.mjs": (
        "4eec160655adbd504e6064b8de540571ec8d1e456e56da609799ef5b556ccdeb",
        "3ba2b8902dcc59ee60ea4a4771ac97878cdbb32f13d964b327fec7d10f3efc4c",
    ),
    "observations/wbd_station_join_20261013/STATION_CONTEXT.md": (
        "7ec7d097380ee247b8d35a6c48fc912fde26eaffdaf83ad48fab94da44d306d9",
        "65db7cd29bd66ff2d03ac5b7362c9365c875f9271dd4d0493b0bf0fe5e85005d",
    ),
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
    if current.is_file():
        previous_body = current.read_bytes()
        if previous_body != body and name not in AUTHORED_BINDINGS:
            edition_pair = (hashlib.sha256(previous_body).hexdigest(), expected_sha)
            if WBD_SOURCE_UPGRADES.get(name) != edition_pair:
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


def install(application, source_root, *, dry_run=False, include_hydrology_report=True):
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
    if include_hydrology_report and any(
            (source_root / name).is_file() or (application / name).is_file()
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
              "native_source_manifests": source_manifests,
              "include_hydrology_report": include_hydrology_report}
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
    parser.add_argument("--without-hydrology-report", action="store_true",
                        help="Install the complete station studies while preserving the existing separate hydrology report edition")
    args = parser.parse_args(argv)
    print(json.dumps(install(args.application, args.source_root, dry_run=args.dry_run,
                             include_hydrology_report=not args.without_hydrology_report), indent=2))

if __name__ == "__main__":
    main()
