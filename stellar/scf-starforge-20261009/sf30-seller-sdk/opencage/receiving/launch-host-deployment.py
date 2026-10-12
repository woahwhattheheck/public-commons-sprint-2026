#!/usr/bin/env python3
"""Place the selected original package-to-host command in the native foreground worker."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
from shutil import which
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
    parser.add_argument("--memory-reserve-mib", type=int, default=64)
    parser.add_argument("--disk-space", action="append", required=True, metavar="PATH=MIB")
    parser.add_argument("--disk-inodes", action="append", default=[], metavar="PATH=COUNT")
    parser.add_argument("--disk-reserve-mib", type=int, default=4)
    parser.add_argument("--disk-reserve-inodes", type=int, default=64)
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
    flock_command = which("flock")
    if flock_command is None:
        raise ValueError("The selected Linux host needs its existing flock executable")
    flock = regular(str(Path(flock_command).resolve(strict=True)))
    input_bytes = input_path.read_bytes()
    supplied = json.loads(input_bytes)
    if supplied.get("schema") != "commons.scf-opencage-host-receiving/v1":
        raise ValueError("Select the original host receiving input")
    source = Path(supplied["sourceRoot"]).resolve(strict=True)
    manifest = regular(supplied["sourceManifestPath"])
    if hashlib.sha256(manifest.read_bytes()).hexdigest() != supplied["sourceManifestSha256"]:
        raise ValueError("The selected source manifest changed")
    if not input_path.is_relative_to(project) or not manifest.is_relative_to(project):
        raise ValueError("Retain input and source manifest inside the original project")
    output = Path(supplied["outputDirectory"]).absolute()
    if output.resolve() != output or output == project or not output.is_relative_to(project):
        raise ValueError("Output must stay below the original project")

    driver = regular(str(source / "stellar/scf-starforge-20261009/sf30-seller-sdk/opencage/receiving/run-host-deployment.mjs"))
    package = Path(supplied["packageDirectory"]).resolve(strict=True)
    if not package.is_dir() or not isinstance(supplied.get("packageIdentity"), str) or len(supplied["packageIdentity"]) != 64:
        raise ValueError("Select the original complete package and identity")
    record = native.run_path(supplied["operationId"], args.records_root)
    command = [str(node), str(driver), "--source", str(source), "--package", str(package),
               "--output", str(output), "--source-manifest", str(manifest),
               "--manifest-sha256", supplied["sourceManifestSha256"],
               "--package-identity", supplied["packageIdentity"]]
    previous = supplied.get("previousNative")
    previous_paths = set()
    if previous is not None:
        if not isinstance(previous, dict) or set(previous) != {
            "record", "requestSha256", "resultSha256", "artifactsSha256"
        }:
            raise ValueError("Select all four original previous-native bindings")
        previous_record = Path(previous["record"]).absolute()
        if previous_record.resolve(strict=True) != previous_record or not previous_record.is_dir():
            raise ValueError("Select the canonical original previous native record")
        for name in ("request", "result", "artifacts"):
            expected = previous[name + "Sha256"]
            if not isinstance(expected, str) or len(expected) != 64 or any(c not in "0123456789abcdef" for c in expected):
                raise ValueError("Select the exact original previous-native file SHA256")
            retained = regular(str(previous_record / (name + ".json")))
            if hashlib.sha256(retained.read_bytes()).hexdigest() != expected:
                raise ValueError("The selected original previous-native file changed")
        command.extend([
            "--previous-native", str(previous_record),
            "--previous-request-sha256", previous["requestSha256"],
            "--previous-result-sha256", previous["resultSha256"],
            "--previous-artifacts-sha256", previous["artifactsSha256"],
        ])
        previous_paths.add(str(previous_record))
    runtime = {str(host), str(source), str(node), str(package), str(flock), *previous_paths,
               *[str(Path(path).resolve(strict=True)) for path in args.runtime_path]}
    out = output.relative_to(project).as_posix()
    values = argparse.Namespace(
        operation_id=supplied["operationId"], peer=args.peer, project=str(project),
        command=command, java=None, node=None,
        artifact=[input_path.relative_to(project).as_posix(), manifest.relative_to(project).as_posix()],
        artifact_on_success=[out],
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
