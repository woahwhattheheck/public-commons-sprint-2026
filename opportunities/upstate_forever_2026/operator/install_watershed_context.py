#!/usr/bin/env python3
"""Install the regional watershed desk into the current extension-enabled app."""
from __future__ import annotations

import argparse
import ast
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import tempfile
from datetime import datetime, timezone

FILES = (
    "model/watershed_context.py",
    "model/watershed_brief.py",
    "model/watershed_briefing.py",
    "model/utility_monitoring.py",
    "model/utility_monitoring_report.py",
    "model/utility_monitoring_comparison.py",
    "model/monitoring_frontier_comparison.py",
    "docs/UTILITY_MONITORING_COMPARISONS.md",
    "model/monitoring_workspace.py",
    "model/monitoring_packet.py",
    "model/monitoring_comparison_report.py",
    "model/monitoring_report_source.py",
    "docs/UTILITY_MONITORING_REPORTS.md",
    "docs/UTILITY_MONITORING.md",
    "source_tools/receive_utility_monitoring.py",
    "docs/UTILITY_MONITORING_RECEIVING.md",
    "model/utility_microbial_study.py",
    "model/receiving_water_monitoring.py",
    "model/monitoring_sources.py",
    "model/client_briefing.py",
    "docs/UTILITY_SOURCE_BRIEFING.md",
    "model/utility_watershed_context.py",
    "model/utility_observed_context.py",
    "model/watershed_observation_context.py",
    "source/receptor-topology/20261013/utility-focus-profile.json",
    "operator/receive_watershed_context.py",
    "source_tools/prepare_watershed_context.py",
    "source_tools/receive_watershed_context.py",
    "source_tools/watershed_source_entry.py",
    "source_tools/watershed_source_validation.py",
    "operator/watershed_context.py",
    "operator/web/watershed_context.mjs",
    "operator/web/watershed_context.css",
    "operator/extensions/watershed-context.json",
    "operator/install_watershed_context.py",
    "operator/WATERSHED_CONTEXT.md",
)
OPTIONAL = (
    "integration/run_watershed_context_operator.py",
    "integration/component_fragments/watershed-observation-exports.json",
    "integration/WATERSHED_CONTEXT_RECEIVING.md",
    "source_tools/receive_watershed_edition.py",
    "source_tools/utility_observed_context.mjs",
    "source_tools/build_utility_observed_context.mjs",
    "source_tools/receive_utility_source_context.py",
    "integration/watershed_completed_receiving.json",
    "model/WATERSHED_BRIEF.md",
    "model/WATERSHED_CONTEXT.md",
    "model/watershed_context_cli.py",
    "outputs/watershed-connectivity-20261013/WATERSHED_CONNECTIVITY.md",
    "outputs/watershed-connectivity-20261013/connectivity-manifest.json",
    "outputs/watershed-connectivity-20261013/watershed-connectivity-217.csv",
    "outputs/watershed-connectivity-20261013/watershed-connectivity-summary.json",
    "source/water_context/20261013/completed-run.package.json",
    "source/water_context/20261013/full-domain-water-context.json",
    "source/water_context/20261013/scdes-domain217-source-coverage.json",
    "source_tools/WATERSHED_SOURCE_IMPORT.md",
    "source_tools/NATIVE_NETWORK_SOURCE.md",
    "source_tools/prepare_watershed_manifest.py",
    "source_tools/prepare_watershed_network.py",
)


SOURCE_MANIFESTS = (
    "source/water_context/sources-20261013.json",
    "source/water_context/20261013/complete-sources.json",
    "source/water_context/20261013/complete-native-sources.json",
    "utility_observed_context.sources.json",
    "landcover_observation_profiles.sources.json",
)


def source_manifest_files(source_root, application):
    """Snapshot each available source manifest and its exact native members."""
    result = {}
    for manifest_name in SOURCE_MANIFESTS:
        manifest_path = source_root / manifest_name
        owner_root = source_root
        if not manifest_path.exists():
            manifest_path = application / manifest_name
            owner_root = application
        if not manifest_path.exists():
            continue
        if not manifest_path.resolve(strict=True).is_relative_to(owner_root):
            raise ValueError("Source manifest leaves the prepared application: " + manifest_name)
        manifest_body = manifest_path.read_bytes()
        manifest = json.loads(manifest_body)
        if (not isinstance(manifest, dict) or manifest.get("schema") != "upstate.sources/v1"
                or not isinstance(manifest.get("entries"), list)):
            raise ValueError("Choose an original upstate.sources/v1 manifest: " + manifest_name)
        result[manifest_name] = manifest_body
        for entry in manifest["entries"]:
            if not isinstance(entry, dict) or not isinstance(entry.get("companions", []), list):
                raise ValueError("Source entries must declare their native companions")
            for row in [entry] + entry.get("companions", []):
                name = row.get("path") if isinstance(row, dict) else None
                if (not isinstance(name, str) or not name or "\\" in name
                        or any(ord(char) < 32 for char in name)):
                    raise ValueError("Source manifest needs a canonical relative member")
                relative = PurePosixPath(name)
                if (relative.is_absolute() or relative.as_posix() != name
                        or any(part in ("", ".", "..") for part in name.split("/"))):
                    raise ValueError("Source manifest member leaves its native directory: " + name)
                member = (PurePosixPath(manifest_name).parent / relative).as_posix()
                path = source_root / member
                member_root = source_root
                if not path.is_file():
                    path = application / member
                    member_root = application
                resolved = path.resolve(strict=True)
                if not resolved.is_relative_to(member_root) or not resolved.is_file():
                    raise ValueError("Source member leaves the prepared application: " + name)
                body = resolved.read_bytes()
                if row.get("bytes") is not None and row["bytes"] != len(body):
                    raise ValueError("Source member byte count changed: " + name)
                if row.get("sha256") is not None and row["sha256"] != digest(body):
                    raise ValueError("Source member hash changed: " + name)
                if member in result and result[member] != body:
                    raise ValueError("Source manifests name conflicting member bytes: " + member)
                result[member] = body
    return result


def digest(body):
    return hashlib.sha256(body).hexdigest()


def atomic_write(path, body):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix="." + path.name + ".", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(body)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def install(application, source_root, *, dry_run=False):
    application = Path(application).resolve(strict=True)
    source_root = Path(source_root).resolve(strict=True)
    for required in ("operator/extension_registry.py", "operator/web/extension_host.mjs"):
        if not (application / required).is_file():
            raise ValueError("Install the current shared extension host first: missing " + required)
    originals = {}
    prepared = {}
    source_bodies = source_manifest_files(source_root, application)
    names = dict.fromkeys(FILES + tuple(
        name for name in OPTIONAL if (source_root / name).is_file()) + tuple(source_bodies))
    for name in names:
        source = source_root / name
        body = source_bodies[name] if name in source_bodies else source.read_bytes()
        if name.endswith(".py"):
            ast.parse(body.decode("utf-8"), filename=name)
        if name.endswith(".json"):
            value = json.loads(body)
            if name == "operator/extensions/watershed-context.json" and (
                value.get("schema") != "upstate.operator-extension/v1"
                or value.get("id") != "watershed-context"
            ):
                raise ValueError("Choose the regional watershed extension manifest.")
        target = application / name
        old = target.read_bytes() if target.is_file() else None
        originals[name] = old
        if old != body:
            prepared[name] = body
    plan = {
        "schema": "upstate.watershed-context-install/v1",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "application": str(application),
        "files": [{
            "path": name, "before_sha256": digest(originals[name]) if originals[name] is not None else None,
            "after_sha256": digest(body), "bytes": len(body),
        } for name, body in sorted(prepared.items())],
    }
    if dry_run or not prepared:
        return {**plan, "dry_run": dry_run, "changed": False}
    # Compare the complete prepared set again before its first replacement.
    for name in prepared:
        target = application / name
        current = target.read_bytes() if target.is_file() else None
        if current != originals[name]:
            raise ValueError("Application source changed during preparation: " + name)
    identity = digest(json.dumps(plan, sort_keys=True).encode("utf-8"))[:16]
    backup = application / ".watershed-context-installs" / identity
    backup.mkdir(parents=True, exist_ok=False)
    atomic_write(backup / "plan.json", (json.dumps(plan, indent=2) + "\n").encode("utf-8"))
    for name in prepared:
        if originals[name] is not None:
            atomic_write(backup / "before" / name, originals[name])
    written = []
    try:
        for name, body in prepared.items():
            target = application / name
            current = target.read_bytes() if target.is_file() else None
            if current != originals[name]:
                raise ValueError("Application source changed before replacement: " + name)
            atomic_write(target, body)
            written.append(name)
        result = {**plan, "changed": True, "backup": str(backup)}
        atomic_write(backup / "result.json", (json.dumps(result, indent=2) + "\n").encode("utf-8"))
        return result
    except BaseException:
        # Restore only files still containing this installer's exact written bytes.
        for name in reversed(written):
            target = application / name
            if not target.is_file() or target.read_bytes() != prepared[name]:
                continue
            if originals[name] is None:
                target.unlink()
            else:
                atomic_write(target, originals[name])
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", required=True)
    parser.add_argument("--source-root", default=str(Path(__file__).resolve().parents[1]))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    print(json.dumps(install(args.application, args.source_root, dry_run=args.dry_run),
                     indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
