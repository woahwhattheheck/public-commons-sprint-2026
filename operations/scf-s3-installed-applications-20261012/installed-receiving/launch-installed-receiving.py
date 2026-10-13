#!/usr/bin/env python3
"""Run one installed S3 Applications customer through the original native foreground."""
import argparse
import json
import pathlib
import shutil
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, help="Existing private installed-receiving input JSON")
    parser.add_argument("--host-root", required=True, help="Complete maintained native runtime's host directory")
    parser.add_argument("--peer", required=True, help="Owner of this single receiving operation")
    args = parser.parse_args()
    input_path = pathlib.Path(args.input).resolve(strict=True)
    request = json.loads(input_path.read_text())
    if request.get("schema") != "stellar-forge.s3-installed-receiving-input.v1":
        raise ValueError("Select the original installed-receiving input")
    root = pathlib.Path(request["root"])
    if not root.is_absolute():
        raise ValueError("Use the original absolute receiving root")
    root = root.resolve(strict=True)
    if input_path.parent != root:
        raise ValueError("Keep the original input beside its retained receiving programs")
    host = pathlib.Path(args.host_root).resolve(strict=True)
    sys.path.insert(0, str(host))
    from native_foreground import load_native, start_foreground
    node, npm = shutil.which("node"), shutil.which("npm")
    if not node or not npm:
        raise RuntimeError("Use the receiving host's existing Node and npm runtime")
    archive = pathlib.Path(request["archive"])
    if not archive.is_file():
        raise RuntimeError("Receive the selected original source archive before starting")
    worker = root / "install-and-receive.mjs"
    driver = root.parent / "receive-s3-merchant-application.mjs"
    for path in (worker, driver, root / "receive-original-offline-inputs.py"):
        if not path.is_file():
            raise RuntimeError("Receive the complete original operation source: " + str(path))
    retained = [
        str(host), request["archive"], request["publicTransferDirectory"],
        request["awsLock"], request["awsCache"], request["fixtureModule"],
        request["playwrightPackage"], request["chromiumExecutable"], node, npm,
        str(worker), str(driver), str(input_path), str(root / "bootstrap"),
        str(root / "receive-original-offline-inputs.py"),
        str(root / "node_lockfile_cache.py"), str(root / "node_package_cache.py"),
        str(root.parent / "retained-files.mjs"),
    ]
    specification = argparse.Namespace(
        operation_id=request["operationId"], peer=args.peer, project=str(root),
        command=[node, str(worker), str(input_path)],
        java=None, node=None, artifact=["installed-receiving.json"],
        artifact_on_success=["merchant-reception/managed-s3-reception.json"],
        artifact_on_failure=[], records_root=str(root / "native-records"),
        memory_mib=768, memory_reserve_mib=256,
        memory_reservations_root="/workspace/shared/swarm/capacity/memory",
        memory_reclaim="clean-cache", disk_space=[str(root) + "=256"],
        disk_inodes=[str(root) + "=16000"], disk_reserve_mib=32,
        disk_reserve_inodes=1024, disk_reservations_root=None,
        worker_root=str(root / "worker"), temp_root=str(root / "tmp"),
        runtime_path=retained, runtime_consumers_root=None,
    )
    native = load_native(str(host))
    report = start_foreground(native, specification, report_format="summary")
    if report.get("reused"):
        from native_result_view import select
        print(json.dumps(select(report, "summary")), flush=True)
    return report


if __name__ == "__main__":
    main()
