#!/usr/bin/env python3
"""Place the retained CSV receiving command in the original native foreground worker."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import sys


def regular(path: str) -> Path:
    selected = Path(path).absolute()
    if selected.resolve(strict=True) != selected or not selected.is_file() or selected.is_symlink():
        raise ValueError("Select a canonical original file")
    return selected


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host-root", required=True)
    parser.add_argument("--input", required=True)
    parser.add_argument("--node", required=True)
    parser.add_argument("--project", required=True)
    parser.add_argument("--records-root", required=True)
    parser.add_argument("--peer", required=True)
    parser.add_argument("--worker-root", required=True)
    parser.add_argument("--temp-root", required=True)
    parser.add_argument("--memory-mib", type=int, required=True)
    parser.add_argument("--memory-reserve-mib", type=int, default=128)
    parser.add_argument("--disk-space", action="append", required=True, metavar="PATH=MIB")
    parser.add_argument("--disk-inodes", action="append", default=[], metavar="PATH=COUNT")
    parser.add_argument("--disk-reserve-mib", type=int, default=8)
    parser.add_argument("--disk-reserve-inodes", type=int, default=128)
    parser.add_argument("--runtime-path", action="append", default=[])
    args = parser.parse_args()

    host = Path(args.host_root).resolve(strict=True)
    sys.path.insert(0, str(host))
    from native_foreground import ForegroundLaunch, load_native
    native = load_native(host)
    if not callable(getattr(native, "start", None)):
        raise ValueError("Use the maintained original native worker")

    project = Path(args.project).resolve(strict=True)
    if not project.is_dir():
        raise ValueError("Select the existing receiving project")
    input_path, node = regular(args.input), regular(args.node)
    input_bytes = input_path.read_bytes()
    supplied = json.loads(input_bytes)
    if supplied.get("schema") != "commons.scf-opencage-csv-receiving/v1":
        raise ValueError("Select the original CSV receiving input")
    source = Path(supplied["sourceRoot"]).resolve(strict=True)
    manifest = regular(supplied["sourceManifestPath"])
    if hashlib.sha256(manifest.read_bytes()).hexdigest() != supplied["sourceManifestSha256"]:
        raise ValueError("The selected source manifest changed")
    if not input_path.is_relative_to(project) or not manifest.is_relative_to(project):
        raise ValueError("Retain input and source manifest inside the original project")
    output = Path(supplied["outputDirectory"]).absolute()
    if output.resolve() != output or output == project or not output.is_relative_to(project):
        raise ValueError("Output must stay below the original project")

    driver = regular(str(source / "stellar/scf-starforge-20261009/sf30-seller-sdk/opencage/receiving/run-csv-workshare.mjs"))
    record = native.run_path(supplied["operationId"], args.records_root)
    command = [str(node), str(driver), "--input", str(input_path), "--input-sha256",
               hashlib.sha256(input_bytes).hexdigest(), "--record", str(record)]
    runtime = {str(host), str(source), str(node), str(regular(supplied["browser"]["playwright"]).parent),
               str(regular(supplied["browser"]["chromium"]).parent),
               *[str(Path(path).resolve(strict=True)) for path in args.runtime_path]}
    out = output.relative_to(project).as_posix()
    values = argparse.Namespace(
        operation_id=supplied["operationId"], peer=args.peer, project=str(project),
        command=command, java=None, node=None,
        artifact=[input_path.relative_to(project).as_posix(), manifest.relative_to(project).as_posix()],
        artifact_on_success=[out + "/" + name for name in (
            "journey.json", "browser", "inputs", "customer-delivery", "retry-delivery",
            "agent-delivery", "agent-results.csv", "managed-selection.json", "mcp-connection.json")],
        artifact_on_failure=[out],
        retain_artifacts=True, records_root=str(Path(args.records_root).resolve()),
        worker_root=str(Path(args.worker_root).resolve()), temp_root=str(Path(args.temp_root).resolve()),
        runtime_path=sorted(runtime), runtime_consumers_root=None,
        memory_mib=args.memory_mib, memory_reserve_mib=args.memory_reserve_mib,
        memory_reservations_root=None, memory_reclaim="clean-cache", memory_storage="included",
        disk_space=args.disk_space, disk_inodes=args.disk_inodes,
        disk_reserve_mib=args.disk_reserve_mib, disk_reserve_inodes=args.disk_reserve_inodes,
        disk_reservations_root=None,
    )
    launch = ForegroundLaunch(native)
    report = native.start(values, launcher=launch)
    print(json.dumps({"operation_id": supplied["operationId"], "record": str(record),
                      "original_native": report}, ensure_ascii=False), flush=True)
    if launch.root is not None:
        return launch.handoff()
    # The original start API returned the existing operation. Inspect/resume that
    # same request through native_foreground; this adapter adds no second owner.
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
