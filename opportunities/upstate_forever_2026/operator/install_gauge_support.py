#!/usr/bin/env python3
"""Install the complete gauge-support component into the existing extension-enabled app."""
from __future__ import annotations
import argparse
import ast
import hashlib
import json
import os
from pathlib import Path
import tempfile
from datetime import datetime, timezone

FILES = (
    "model/gauge_support.py",
    "model/gauge_report_context.py",
    "source_tools/receive_gauge_support.py",
    "source_tools/GAUGE_SUPPORT_RECEIVING_RECOVERY.md",
    "operator/gauge_support.py",
    "operator/extensions/gauge-support.json",
    "operator/web/gauge_support.mjs",
    "operator/web/gauge_support.css",
    "operator/install_gauge_support.py",
    "operator/GAUGE_SUPPORT.md",
    "integration/component_fragments/gauge-scientific-composer.json",
    "model/gauge_study_transfer.py",
    "model/gauge_study_receiving.py",
    "model/GAUGE_STUDY_RECEIVING.md",
    "operator/gauge_receiving.py",
    "operator/web/gauge_received_studies.mjs",
    "model/GAUGE_STUDY_TRANSFER.md",
    "integration/component_fragments/gauge-study-transfer.json",
)
REQUIRES = (
    "model/station_geography.py", "model/station_assessment_context.py", "model/spatial_esri.py",
    "model/workspace.py", "model/portable.py", "model/watershed_context.py",
    "model/observed_context.py", "model/scientific_report.py",
    "model/observed_report_render.py", "model/scientific_report_editions.py",
    "model/study_transfer.py", "model/scientific_report_study_transfer.py",
    "model/study_report_transfer.py",
    "model/study_receiving.py", "operator/study_receiving.py",
    "operator/web/received_studies.mjs", "operator/web/extensions/study_transfer.mjs",
    "operator/extensions/study-transfer.json",
    "operator/extension_registry.py", "operator/web/extension_host.mjs",
    "operator/extensions/station-geography.json", "operator/extensions/watershed-context.json",
    "operator/source_reports.py", "operator/source_report_editions.py",
    "operator/web/source_reports.mjs", "operator/web/source_report_editions.mjs",
)


def digest(body):
    return hashlib.sha256(body).hexdigest()


def write(path, body):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix="." + path.name + ".", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(body)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def install(application, source_root, *, apply=False):
    application, source_root = Path(application).resolve(strict=True), Path(source_root).resolve(strict=True)
    for member in REQUIRES:
        if not (application / member).is_file():
            raise ValueError("Install the maintained complete application dependency: " + member)
    before, after = {}, {}
    for member in FILES:
        source = source_root / member
        if not source.resolve(strict=True).is_relative_to(source_root):
            raise ValueError("Component source leaves its original root")
        body = source.read_bytes()
        if member.endswith(".py"):
            ast.parse(body.decode("utf-8"), filename=member)
        if member.endswith(".json"):
            value = json.loads(body)
            if member == "operator/extensions/gauge-support.json":
                if value.get("schema") != "upstate.operator-extension/v1" or value.get("id") != "gauge-support":
                    raise ValueError("Choose the gauge-support shared extension descriptor")
            elif (value.get("schema") != "upstate.application-component-fragment/v1"
                    or value.get("id") != Path(member).stem):
                raise ValueError("Choose the original Gauge component fragment: " + member)
        target = application / member
        if not target.resolve().is_relative_to(application):
            raise ValueError("Component destination leaves its application root")
        before[member] = target.read_bytes() if target.is_file() else None
        after[member] = body
    changed = {member: body for member, body in after.items() if before[member] != body}
    plan = {"schema": "upstate.gauge-support-install/v1",
        "application": str(application), "source_root": str(source_root),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "files": [{"path": member, "before_sha256": digest(before[member]) if before[member] is not None else None,
                   "after_sha256": digest(body), "bytes": len(body)} for member, body in changed.items()],
        "shared_host": "Existing descriptor discovery; no shared host, station or regional source is replaced."}
    if not apply or not changed:
        return {**plan, "applied": False, "changed": False}
    identity = digest(json.dumps(plan, sort_keys=True).encode("utf-8"))[:16]
    backup = application / ".gauge-support-installs" / identity
    for member in changed:
        target = application / member
        if (target.read_bytes() if target.is_file() else None) != before[member]:
            raise ValueError("The application changed during source preparation: " + member)
    backup.mkdir(parents=True, exist_ok=False)
    write(backup / "plan.json", (json.dumps(plan, indent=2) + "\n").encode("utf-8"))
    for member in changed:
        if before[member] is not None:
            write(backup / "before" / member, before[member])
    written = []
    try:
        for member, body in changed.items():
            target = application / member
            if (target.read_bytes() if target.is_file() else None) != before[member]:
                raise ValueError("The application changed before source replacement: " + member)
            write(target, body)
            written.append(member)
        result = {**plan, "applied": True, "changed": True, "backup": str(backup)}
        write(backup / "result.json", (json.dumps(result, indent=2) + "\n").encode("utf-8"))
        return result
    except BaseException:
        for member in reversed(written):
            target = application / member
            if target.is_file() and target.read_bytes() == changed[member]:
                if before[member] is None:
                    target.unlink()
                else:
                    write(target, before[member])
        raise


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", default=str(Path(__file__).resolve().parents[1]))
    parser.add_argument("--source-root", default=str(Path(__file__).resolve().parents[1]))
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args(argv)
    print(json.dumps(install(args.application, args.source_root, apply=args.apply), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
