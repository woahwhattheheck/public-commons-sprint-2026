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
SV833_STUDY = "scdes-sv833-water-quality-2021-2026"
SV833_ROOT = "application-context/sv833"
RL18151_STUDY = "scdes-rl18151-water-quality-2018-2026"
RL18151_ROOT = "application-context/rl18151"
STREAM_ROOT = "application-context/stream-nutrients"
PHYSICAL_ROOT = "application-context/physical-water-quality"

FAMILIES = {
    "three_twenty_hydrologic_context.sources.json": {
        "studies": (SV833_STUDY, "scdes-three-twenty-water-quality-2026",
                    "three-twenty-historical-2021-2025"),
        "retained_root": "application-context/three-twenty-hydrologic-context",
        "source_inventory": "source/three-twenty-hydrologic-context-20261013/family.json",
        "prefixes": ("source/three-twenty-hydrologic-context-20261013/",
                     "source/sv833-hydrologic-context-20261013/"),
        "paths": (
            "source/three-twenty-water-quality-20261013/original/three-twenty-rs-26250-station-2026-original.csv",
            "source/three-twenty-water-quality-20261013/original/three-twenty-sv-735-station-2026-original.csv",
            "source/three-twenty-water-quality-20261013/original/three-twenty-sv-111-station-2026-original.csv",
            "source/eighteenmile-stream-nutrients-20261013/original/seneca-nutrient-stations.csv",
        ),
    },
    "three_twenty_historical.sources.json": {
        "studies": ("three-twenty-historical-2021-2025",),
        "retained_root": "application-context/three-twenty-historical",
        "prefixes": ("observations/three_twenty_history_2021_2025/",
                     "source/three-twenty-history-20261013/",
                     "source/three-twenty-water-quality-20261013/",
                     "source/sv833-water-quality-20261013/"),
        "paths": ("source/eighteenmile-stream-nutrients-20261013/original/seneca-nutrient-stations.csv",),
    },
    "three_twenty_2026.sources.json": {
        "studies": ("scdes-three-twenty-water-quality-2026",),
        "retained_root": "application-context/three-twenty-2026",
        "prefixes": ("observations/three_twenty_2026/",
                     "source/three-twenty-water-quality-20261013/",
                     "source/sv833-water-quality-20261013/"),
        "paths": ("source/eighteenmile-stream-nutrients-20261013/original/seneca-nutrient-stations.csv",),
    },
    "source/rl18151-lake-phosphorus-20261013/sources.json": {
        "studies": (RL18151_STUDY,),
        "retained_root": RL18151_ROOT,
        "prefixes": ("source/rl18151-lake-phosphorus-20261013/",),
        "paths": (),
    },
    "sv833_hydrologic_context.sources.json": {
        "studies": (SV833_STUDY,),
        "retained_root": SV833_ROOT,
        "prefixes": ("source/sv833-hydrologic-context-20261013/",),
        "paths": (
            "source/eighteenmile-stream-nutrients-20261013/original/seneca-nutrient-stations.csv",
            "observations/sv833_2021_2026/csv.mjs",
        ),
    },
    "sv833_water_quality.sources.json": {
        "studies": (SV833_STUDY,),
        "retained_root": SV833_ROOT,
        "prefixes": (
            "observations/sv833_2021_2026/",
            "source/sv833-water-quality-20261013/",
        ),
        "paths": (
            "source/eighteenmile-stream-nutrients-20261013/original/seneca-nutrient-stations.csv",
        ),
    },
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
    "eighteenmile_paired_sensitivity.sources.json": {
        "studies": (STREAM_STUDY,),
        "retained_root": STREAM_ROOT,
        "prefixes": (
            "observations/eighteenmile_stream_nutrients_2020_2025/analysis/",
            "source/eighteenmile-stream-nutrients-20261013/original/",
        ),
        "paths": ("eighteenmile_stream_nutrient_analysis.sources.json",),
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
    name = manifest_path.relative_to(application).as_posix()
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
            relative = _relative(str(PurePosixPath(name).parent / _relative(item["path"])))
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
    inventory_name = family.get("source_inventory")
    if inventory_name is not None:
        inventory_name = _relative(inventory_name)
        inventory_path = (application / inventory_name).resolve(strict=True)
        if not inventory_path.is_relative_to(application) or not inventory_path.is_file():
            raise ValueError("The original context inventory must remain inside the application.")
        inventory_raw = inventory_path.read_bytes()
        inventory = json.loads(inventory_raw.decode("utf-8-sig"))
        descriptors = inventory.get("files")
        if (inventory.get("schema") != "commons.file-inventory/v1"
                or not isinstance(descriptors, list)
                or any(not isinstance(item, dict) for item in descriptors)):
            raise ValueError("Retain the complete original context file inventory.")
        identities = {}
        for descriptor in descriptors:
            relative = _relative(descriptor.get("path"))
            if relative in identities or relative == inventory_name:
                raise ValueError("The context inventory must list each source once and exclude itself.")
            identities[relative] = descriptor
        if set(identities) != set(files):
            raise ValueError("The context inventory differs from the complete native source closure.")
        for relative, raw in files.items():
            descriptor = identities[relative]
            if (type(descriptor.get("bytes")) is not int or descriptor["bytes"] != len(raw)
                    or descriptor.get("sha256") != hashlib.sha256(raw).hexdigest()):
                raise ValueError("Original context inventory identity changed: " + relative)
        files[inventory_name] = inventory_raw
    return files


def retained_files(application, manifest_path):
    files = source_files(application, manifest_path)
    name = Path(manifest_path).resolve(strict=True).relative_to(Path(application).resolve(strict=True)).as_posix()
    root = FAMILIES[name]["retained_root"]
    return {root + "/" + name: raw for name, raw in files.items()}
