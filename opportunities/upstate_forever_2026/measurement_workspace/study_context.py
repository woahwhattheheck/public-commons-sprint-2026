"""Retain original application-layout context for the Published studies desk.

The same declared source closure is used by native intake and cold installation.
Original manifests and their members keep their application-relative paths.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path, PurePosixPath

LAKE_STUDY = "scdes-eighteenmile-lake-2023"
STREAM_STUDY = "scdes-eighteenmile-streams-2020-2025"
STREAM_ROOT = "application-context/stream-nutrients"
PHYSICAL_ROOT = "application-context/physical-water-quality"

FAMILIES = {
    "eighteenmile_stream_nutrient_analysis.sources.json": {
        "studies": (STREAM_STUDY,),
        "retained_root": STREAM_ROOT,
        "prefixes": (
            "observations/eighteenmile_stream_nutrients_2020_2025/analysis/",
            "source/eighteenmile-stream-nutrients-20261013/original/",
        ),
        "paths": (),
    },
    "eighteenmile_stream_flow_coverage.sources.json": {
        "studies": (STREAM_STUDY,),
        "retained_root": STREAM_ROOT,
        "prefixes": (
            "source/eighteenmile-stream-nutrients-20261013/flow-analysis/",
            "source/eighteenmile-stream-nutrients-20261013/derived/",
            "source/eighteenmile-stream-nutrients-20261013/original/",
        ),
        "paths": ("observations/observed_hydrology_20261013/derived/daily_flow.csv",),
    },
    "eighteenmile_physical_context.sources.json": {
        "studies": (LAKE_STUDY, STREAM_STUDY),
        "retained_root": PHYSICAL_ROOT,
        "prefixes": (
            "observations/eighteenmile_2023/physical_context/",
            "observations/eighteenmile_2023/wqp/originals/",
        ),
        "paths": (
            "observations/eighteenmile_stream_nutrients_2020_2025/analysis/original/daily/usgs_02186702_2023_2023.json",
        ),
    },
}


def manifest_names(study_id=None):
    return tuple(
        name for name, family in FAMILIES.items()
        if study_id is None or study_id in family["studies"]
    )


def retained_manifest_names():
    return tuple(family["retained_root"] + "/" + name for name, family in FAMILIES.items())


def _relative(value):
    if not isinstance(value, str) or not value or "\\" in value or "\x00" in value:
        raise ValueError("A context source must use a canonical relative POSIX path.")
    path = PurePosixPath(value)
    if path.is_absolute() or str(path) != value or value == "." or ".." in path.parts:
        raise ValueError("A context source must remain within the original application.")
    return value


def source_files(application, manifest_path):
    """Return the unchanged app-relative manifest and every declared source body."""
    application = Path(application).resolve(strict=True)
    manifest_path = Path(manifest_path).resolve(strict=True)
    name = manifest_path.name
    family = FAMILIES.get(name)
    if family is None or manifest_path != application / name or not manifest_path.is_file():
        raise ValueError("Choose a registered original application-root context manifest.")
    raw_manifest = manifest_path.read_bytes()
    native = json.loads(raw_manifest.decode("utf-8-sig"))
    if native.get("schema") != "upstate.sources/v1" or not isinstance(native.get("entries"), list) or not native["entries"]:
        raise ValueError("The context manifest must declare original upstate.sources/v1 entries.")
    files = {name: raw_manifest}
    for entry in native["entries"]:
        for item in [entry, *entry.get("companions", [])]:
            relative = _relative(item["path"])
            if relative not in family["paths"] and not any(relative.startswith(prefix) for prefix in family["prefixes"]):
                raise ValueError("A context source is outside its declared original families: " + relative)
            path = (application / relative).resolve(strict=True)
            if not path.is_relative_to(application) or not path.is_file():
                raise ValueError("An original context source is outside the application: " + relative)
            raw = files.get(relative)
            if raw is None:
                raw = path.read_bytes()
            if item.get("bytes") != len(raw) or item.get("sha256") != hashlib.sha256(raw).hexdigest():
                raise ValueError("Original context source bytes changed: " + relative)
            files[relative] = raw
    return files


def retained_files(application, manifest_path):
    files = source_files(application, manifest_path)
    root = FAMILIES[Path(manifest_path).name]["retained_root"]
    return {root + "/" + name: raw for name, raw in files.items()}
