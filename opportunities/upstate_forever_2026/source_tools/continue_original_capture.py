"""Operate the same retained national capture on the current shared host."""
from __future__ import annotations
import argparse
import hashlib
import json
import platform
import sys
from pathlib import Path


class CapacityInterruption(RuntimeError):
    pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path("/dev/shm/upstate-405f-20261012"))
    parser.add_argument("--application", type=Path,
                        help="Use a retained application source directory; default ROOT/application")
    parser.add_argument("--disk-reserve-mib", type=int, default=4)
    parser.add_argument("--memory-reserve-mib", type=int, default=4)
    args = parser.parse_args()
    if args.disk_reserve_mib < 0 or args.memory_reserve_mib < 0:
        parser.error("Capacity reserves must be nonnegative.")
    root = args.root.resolve(strict=True)
    application = (args.application or root / "application").resolve(strict=True)
    sys.path.insert(0, str(application))
    from model.common import atomic_json, held, now
    from source_tools import http_capture_resume as recovery
    from source_tools.storage_resources import capacity_snapshot, range_capacity
    body = Path(recovery.__file__).read_bytes()
    if hashlib.sha256(body).hexdigest() != "d42bf1174e31bff7a6c0e25073b5f25638fda384ee9b52cb78a55b11ab72e4ed":
        raise ValueError("Select the exact reviewed original-entity recovery source.")
    archive = root / "inputs/Annual_NLCD_LndCov_2025_CU_C1V2.zip"
    output = root / "http-native-recovery"
    output.mkdir(exist_ok=True)
    chunk = 32 * 1024 * 1024

    def progress(value):
        if value["stage"] == "RANGE_REQUESTED":
            capacity = range_capacity(
                archive.parent, value["end"] - value["start"] + 1,
                stream_buffer_bytes=recovery.BLOCK_BYTES,
                disk_reserve_bytes=args.disk_reserve_mib * 1024 * 1024,
                memory_reserve_bytes=args.memory_reserve_mib * 1024 * 1024)
        else:
            capacity = capacity_snapshot(archive.parent)
        observed = {**value, "operation_id": "UPSTATE-ORIGINAL-SOURCES-DBC61",
                    "continuation": "405F", "host": platform.node(), "python": sys.executable,
                    "archive": str(archive), "application": str(application), "capacity": capacity}
        atomic_json(output / "progress.json", observed)
        print(json.dumps(observed, sort_keys=True), flush=True)
        if capacity.get("plan", {}).get("can_start") is False:
            raise CapacityInterruption(
                "Retain the same original prefix; " + "; ".join(capacity["plan"]["reasons"]))

    with held(output / "continuation.lock", blocking=False):
        try:
            result = recovery.resume(archive, maximum_bytes=1457983950,
                                     chunk_bytes=chunk, progress=progress)
            atomic_json(output / "receiving.json", result)
        except BaseException as error:
            partial = archive.with_name(archive.name + ".partial")
            progress({"stage": "INTERRUPTED", "observed_at": now(),
                      "received_bytes": partial.stat().st_size if partial.exists() else None,
                      "error": type(error).__name__ + ": " + str(error)})
            if isinstance(error, CapacityInterruption):
                raise SystemExit(75)
            raise


if __name__ == "__main__":
    main()
