"""Continue a retained original capture on Windows, macOS or Linux."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
import platform
import sys
from pathlib import Path


class CapacityInterruption(RuntimeError):
    pass


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path,
                        help="Retained capture root; default current directory")
    parser.add_argument("--archive", type=Path,
                        help="Original destination, beside its .partial and .capture.json")
    parser.add_argument("--application", type=Path,
                        help="Retained source directory; default ROOT/application or this application")
    parser.add_argument("--maximum-bytes", type=int,
                        help="Original source budget; reuses saved recovery selection when present")
    parser.add_argument("--chunk-bytes", type=int, default=32 * 1024 * 1024)
    parser.add_argument("--disk-reserve-mib", type=int, default=4)
    parser.add_argument("--memory-reserve-mib", type=int, default=4)
    args = parser.parse_args(argv)
    if min(args.disk_reserve_mib, args.memory_reserve_mib) < 0:
        parser.error("Capacity reserves must be nonnegative.")
    if args.chunk_bytes <= 0 or (args.maximum_bytes is not None and args.maximum_bytes <= 0):
        parser.error("Chunk size and maximum bytes must be positive.")
    # Preserve the original Linux course when it is actually present; never
    # manufacture /dev/shm on a recipient's Windows or Mac system.
    legacy = Path("/dev/shm/upstate-405f-20261012")
    default_root = legacy if sys.platform.startswith("linux") and legacy.is_dir() else Path.cwd()
    root = (args.root or default_root).expanduser().resolve(strict=True)
    bundled = root / "application"
    application = (args.application or (bundled if bundled.is_dir() else Path(__file__).resolve().parents[1]))
    application = application.expanduser().resolve(strict=True)
    if __package__ and application != Path(__file__).resolve().parents[1]:
        # -m has already imported source_tools from the invoking application.
        # Start this same driver directly in a clean interpreter before importing
        # the selected application, so its package cannot reuse the wrong engine.
        arguments = sys.argv[1:] if argv is None else list(argv)
        command = [sys.executable, "-B", str(Path(__file__).resolve()), *arguments]
        if os.name == "nt":
            # CRT execv splits unquoted spaced arguments; subprocess handles the
            # Windows command-line quoting while keeping the selected exit code.
            import subprocess
            raise SystemExit(subprocess.run(command, check=False).returncode)
        os.execv(sys.executable, command)
    sys.path.insert(0, str(application))
    from model.common import atomic_json, held, now, read_json
    from model.portable_fs import native_path
    from source_tools import http_capture_resume as recovery
    from source_tools.storage_resources import capacity_snapshot, range_capacity

    # Provenance follows the selected maintained application. Original entity
    # identity is enforced by recovery's receipt, strong ETag and prefix digest;
    # a historical code hash must not reject an installed portability correction.
    engine_sha256 = hashlib.sha256(Path(recovery.__file__).read_bytes()).hexdigest()
    archive = native_path((args.archive or root / "inputs/Annual_NLCD_LndCov_2025_CU_C1V2.zip").expanduser().absolute())
    receipt = read_json(archive.with_name(archive.name + ".capture.json"))
    if receipt.get("schema") != "upstate.public-source-capture/v1":
        raise ValueError("Select an original source capture receipt")
    selection_path = archive.with_name(archive.name + ".range-recovery") / "selection.json"
    selection = read_json(selection_path) if selection_path.exists() else None
    if args.maximum_bytes is not None:
        maximum = args.maximum_bytes
    elif selection is not None:
        maximum = selection["maximum_bytes"]
    elif args.archive is None:
        maximum = 1457983950  # Original national-source course budget.
    else:
        headers = {str(k).lower(): str(v) for k, v in receipt.get("headers", {}).items()}
        maximum = int(headers.get("content-length", "0"))
    if type(maximum) is not int or maximum <= 0:
        raise ValueError("The original receipt needs a positive content length or --maximum-bytes")
    output = native_path(root / "http-native-recovery" if args.archive is None else
                         archive.with_name(archive.name + ".continuation"))
    output.mkdir(parents=True, exist_ok=True)
    identity = ({"operation_id": "UPSTATE-ORIGINAL-SOURCES-DBC61", "continuation": "405F"}
                if args.archive is None else
                {"operation_id": receipt.get("operation_id", "original-source-continuation")})

    def progress(value):
        if value["stage"] == "RANGE_REQUESTED":
            capacity = range_capacity(
                archive.parent, value["end"] - value["start"] + 1,
                stream_buffer_bytes=recovery.BLOCK_BYTES,
                disk_reserve_bytes=args.disk_reserve_mib * 1024 * 1024,
                memory_reserve_bytes=args.memory_reserve_mib * 1024 * 1024)
        else:
            capacity = capacity_snapshot(archive.parent)
        observed = {**value, **identity, "host": platform.node(), "python": sys.executable,
                    "archive": str(archive), "application": str(application), "capacity": capacity,
                    "recovery_source_sha256": engine_sha256}
        print(json.dumps(observed, sort_keys=True), flush=True)
        atomic_json(output / "progress.json", observed)
        if capacity.get("plan", {}).get("can_start") is False:
            raise CapacityInterruption(
                "Retain the same original prefix; " + "; ".join(capacity["plan"]["reasons"]))

    with held(output / "continuation.lock", blocking=False):
        try:
            result = recovery.resume(archive, maximum_bytes=maximum,
                                     chunk_bytes=args.chunk_bytes, progress=progress)
            atomic_json(output / "receiving.json", result)
            return result
        except BaseException as error:
            # An exhausted/unmounted destination must not hide the actual failure
            # behind a second failed progress write. Original recovery state owns
            # the committed prefix and can be opened again from the same paths.
            try:
                partial = archive.with_name(archive.name + ".partial")
                progress({"stage": "INTERRUPTED", "observed_at": now(),
                          "received_bytes": partial.stat().st_size if partial.exists() else None,
                          "error": type(error).__name__ + ": " + str(error)})
            except Exception:
                pass
            if isinstance(error, CapacityInterruption):
                raise SystemExit(75) from error
            raise


if __name__ == "__main__":
    main()
