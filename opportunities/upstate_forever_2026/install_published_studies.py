#!/usr/bin/env python3
"""Install the published-study desk into the existing ECSA application."""
from __future__ import annotations
import argparse
import ast
import hashlib
import json
import os
from pathlib import Path
import shutil
import tempfile
from datetime import datetime, timezone

CODE_FILES = (
    "measurement_workspace/published_studies.py",
    "measurement_workspace/study_context.py",
    "measurement_workspace/observation_support.py",
    "measurement_workspace/source_observations.py",
    "measurement_workspace/utility_microbiology.py",
    "measurement_workspace/utility_microbiology_context.py",
    "measurement_workspace/UTILITY_MICROBIAL_OBSERVATIONS.md",
    "measurement_workspace/STREAM_OBSERVATIONS.md",
    "source_tools/build_eighteenmile_stream_study.mjs",
    "measurement_workspace/OBSERVATION_SUPPORT.md",
    "operator/published_study_operator.py",
    "operator/extensions/published-studies.json",
    "operator/web/published_studies.mjs",
    "operator/web/published_studies.css",
    "PUBLISHED_STUDIES.md",
    "published_studies_family.json",
    "install_published_studies.py",
    "receive_published_studies.py",
    "tools/attach_published_report.py",
)
DATA_ROOT = Path("observations/eighteenmile_2023")


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def atomic_copy(source, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix="." + target.name + "-", dir=target.parent)
    try:
        with os.fdopen(fd, "wb") as output:
            output.write(source.read_bytes())
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, target)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def portable_source(source):
    """Extend the original archive inventory while preserving its other code."""
    additions = {
        "APPLICATION_DIRECTORIES": ("measurement_workspace", "observations", "source", "source_tools"),
        "APPLICATION_FILES": (
            "PUBLISHED_STUDIES.md", "published_studies_family.json", "install_published_studies.py",
            "receive_published_studies.py", "tools/attach_published_report.py",
            "eighteenmile_chlorophyll_reconciled.sources.json",
            "eighteenmile_lake_observation_report.sources.json",
            "eighteenmile_lake_paired_analysis.sources.json",
            "eighteenmile_lake_microcystin_reconciliation.sources.json",
            "eighteenmile_stream_nutrient_analysis.sources.json",
            "microbial_temporal_observed_report.sources.json",
        ),
    }
    from measurement_workspace.study_context import manifest_names
    additions["APPLICATION_FILES"] += manifest_names()
    lines = source.splitlines(keepends=True)
    offsets = [0]
    for line in lines:
        offsets.append(offsets[-1] + len(line))
    replacements = []
    found = set()
    for node in ast.parse(source).body:
        if not isinstance(node, ast.Assign) or len(node.targets) != 1 or not isinstance(node.targets[0], ast.Name):
            continue
        name = node.targets[0].id
        if name not in additions:
            continue
        found.add(name)
        original = ast.literal_eval(node.value)
        if not isinstance(original, (list, tuple)) or any(not isinstance(item, str) for item in original):
            raise ValueError("The native archive inventory is not a literal filename list: " + name)
        updated = tuple(original) + tuple(item for item in additions[name] if item not in original)
        if tuple(original) != updated:
            start = offsets[node.value.lineno - 1] + node.value.col_offset
            end = offsets[node.value.end_lineno - 1] + node.value.end_col_offset
            replacements.append((start, end, repr(updated)))
    if found != set(additions):
        raise ValueError("The native portable module is missing its application inventory.")
    for start, end, replacement in sorted(replacements, reverse=True):
        source = source[:start] + replacement + source[end:]
    return source


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", required=True)
    args = parser.parse_args()
    source = Path(__file__).resolve().parent
    application = Path(args.application).expanduser().resolve(strict=True)
    for required in ("model/workspace.py", "operator/extension_registry.py"):
        if not (application / required).is_file():
            parser.error("The existing ECSA application is missing " + required)
    data_files = [str(path.relative_to(source)) for path in sorted((source / DATA_ROOT).iterdir()) if path.is_file()]
    observations = source / DATA_ROOT / "wqp_20261013"
    if observations.is_dir():
        data_files.extend(str(path.relative_to(source)) for path in sorted(observations.iterdir()) if path.is_file())
    cohort = source / DATA_ROOT / "cohort_reconciliation_20261013"
    if cohort.is_dir():
        data_files.extend(str(path.relative_to(source)) for path in sorted(cohort.rglob("*")) if path.is_file())
    cohort_manifest = "eighteenmile_chlorophyll_reconciled.sources.json"
    if (source / cohort_manifest).is_file():
        data_files.append(cohort_manifest)
    for manifest in (
        source / DATA_ROOT / "model-sources.json",
        source / DATA_ROOT / "wqp" / "flow-context-sources.json",
        source / DATA_ROOT / "wqp" / "flow-context-public-sources.json",
        source / DATA_ROOT / "wqp_20261013" / "source-manifest.json",
        source / DATA_ROOT / "figures" / "model-sources.json",
        source / "eighteenmile_chlorophyll_reconciled.sources.json",
        source / "eighteenmile_lake_observation_report.sources.json",
        source / "eighteenmile_lake_paired_analysis.sources.json",
        source / "eighteenmile_lake_microcystin_reconciliation.sources.json",
    ):
        if not manifest.is_file():
            continue
        value = json.loads(manifest.read_text(encoding="utf-8-sig"))
        if value.get("schema") != "upstate.sources/v1":
            parser.error("Incompatible installed source manifest: " + str(manifest))
        data_files.append(str(manifest.relative_to(source)))
        for entry in value.get("entries", []):
            for item in [entry, *entry.get("companions", [])]:
                path = (manifest.parent / item["path"]).resolve(strict=True)
                if not path.is_relative_to((source / DATA_ROOT).resolve()):
                    parser.error("A study manifest refers outside its source directory.")
                data_files.append(str(path.relative_to(source)))
    flow_manifest = DATA_ROOT / "wqp" / "flow-context-sources.json"
    if (source / flow_manifest).is_file():
        data_files.append(str(flow_manifest))
    support_result = DATA_ROOT / "microcystin_support_20261013" / "original-campaign-support.json"
    if (source / support_result).is_file():
        data_files.append(str(support_result))
    stream_root = source / "observations/eighteenmile_stream_nutrients_2020_2025"
    if stream_root.is_dir():
        inventory = json.loads((stream_root / "study-files.json").read_text(encoding="utf-8-sig"))
        if inventory.get("schema") != "upstate.study-file-inventory/v1":
            parser.error("The stream observation source inventory is incompatible.")
        for entry in inventory.get("files", []):
            relative = entry["path"]
            path = (stream_root / relative).resolve(strict=True)
            if Path(relative).is_absolute() or "\\" in relative or ".." in Path(relative).parts or not path.is_relative_to(stream_root.resolve()):
                parser.error("The stream source inventory points outside its study directory.")
            if not path.is_file() or path.stat().st_size != entry["bytes"] or digest(path) != entry["sha256"]:
                parser.error("The original stream study source bytes changed: " + relative)
            data_files.append(str(path.relative_to(source)))
        data_files.append(str((stream_root / "study-files.json").relative_to(source)))
    from measurement_workspace.study_context import manifest_names, source_files as context_source_files
    for name in manifest_names():
        manifest = source / name
        if manifest.is_file():
            originals = context_source_files(source, manifest)
            data_files.extend(originals)
    from measurement_workspace import utility_microbiology as microbial
    microbial_root = source / microbial.SOURCE_DIRECTORY
    if microbial_root.is_dir():
        originals = microbial.source_files(source)
        data_files.extend(str(Path(microbial.SOURCE_DIRECTORY) / name) for name in originals)
        from measurement_workspace import utility_microbiology_context as temporal_context
        if (source / temporal_context.SOURCE_MANIFEST).is_file():
            data_files.extend(temporal_context.source_paths(source))
    data_files = sorted(set(data_files))
    expected = list(CODE_FILES) + data_files
    for relative in expected:
        if not (source / relative).is_file():
            parser.error("The source carrier is missing " + relative)
    for relative in data_files:
        target = application / relative
        if target.exists() and digest(target) != digest(source / relative):
            parser.error("Published source bytes differ at " + str(target) + "; retain that edition separately before installing this companion.")
    portable_path = application / "model" / "portable.py"
    portable_original = portable_path.read_text(encoding="utf-8")
    portable_updated = portable_source(portable_original)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    changed, reused = [], []
    for relative in expected:
        original, target = source / relative, application / relative
        if target.is_file() and digest(target) == digest(original):
            reused.append(relative)
            continue
        if target.exists():
            backup = application / ".published-studies-backups" / stamp / relative
            backup.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(target, backup)
        atomic_copy(original, target)
        changed.append(relative)
    if portable_updated != portable_original:
        backup = application / ".published-studies-backups" / stamp / "model" / "portable.py"
        backup.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(portable_path, backup)
        fd, temporary = tempfile.mkstemp(prefix=".portable-", dir=portable_path.parent)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as output:
                output.write(portable_updated)
            os.replace(temporary, portable_path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
        changed.append("model/portable.py")
    package = application / "measurement_workspace" / "__init__.py"
    if not package.exists():
        package.write_text('"""Measurement workspace extensions."""\n', encoding="utf-8")
    print(json.dumps({
        "schema": "upstate.published-study-install/v1",
        "application": str(application),
        "installed": changed, "reused": reused,
        "extension": "published-studies", "view": "published-studies",
        "action": "published-study.import",
        "builtin_id": "scdes-eighteenmile-lake-2023",
        "builtin_ids": ["scdes-eighteenmile-lake-2023"] + (["scdes-eighteenmile-streams-2020-2025"] if stream_root.is_dir() else []) + ([microbial.BUILTIN_ID] if microbial_root.is_dir() else []),
        "files": [{"path": name, "sha256": digest(application / name)} for name in expected],
    }, indent=2))


if __name__ == "__main__":
    main()
