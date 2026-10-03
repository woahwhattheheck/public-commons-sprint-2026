from __future__ import annotations

import argparse
import json
import os
from contextlib import ExitStack
from pathlib import Path

from .core import RepoAtlasError, compile_packet, parse_json_bytes, verify_bundle
from .report import render_report


def _read(path: str):
    return parse_json_bytes(Path(path).read_bytes())


def _write_bundle(outputs):
    targets = [Path(path) for path, _ in outputs]
    if len({os.path.normcase(os.path.realpath(path)) for path in targets}) != len(targets):
        raise RepoAtlasError("output_paths_must_differ")
    for target in targets:
        if target.exists() or target.is_symlink():
            raise RepoAtlasError(f"output_exists:{target}")
    payloads = [
        json.dumps(obj, sort_keys=True, indent=2, ensure_ascii=False, allow_nan=False).encode("utf-8") + b"\n"
        for _, obj in outputs
    ]
    created = []
    try:
        with ExitStack() as stack:
            handles = []
            # Reserve both destinations before writing either payload. Exclusive
            # opens also preserve a file created after the admission checks.
            for target in targets:
                handle = stack.enter_context(target.open("xb"))
                identity = os.fstat(handle.fileno())
                created.append((target, identity.st_dev, identity.st_ino))
                handles.append(handle)
            for handle, payload in zip(handles, payloads):
                handle.write(payload)
    except BaseException as exc:
        cleanup_errors = []
        for target, device, inode in reversed(created):
            try:
                current = target.lstat()
                if (current.st_dev, current.st_ino) == (device, inode):
                    target.unlink()
            except FileNotFoundError:
                pass
            except OSError as cleanup:
                cleanup_errors.append(f"{target}: {cleanup}")
        if cleanup_errors:
            raise RepoAtlasError("output_cleanup_failed:" + "; ".join(cleanup_errors)) from exc
        raise


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="repoatlas")
    sub = p.add_subparsers(dest="command", required=True)
    c = sub.add_parser("compile")
    c.add_argument("--input", required=True)
    c.add_argument("--packet", required=True)
    c.add_argument("--receipt", required=True)
    v = sub.add_parser("verify")
    v.add_argument("--input", required=True)
    v.add_argument("--packet", required=True)
    v.add_argument("--receipt", required=True)
    r = sub.add_parser("report", help="Write a standalone human review report from a verified bundle")
    r.add_argument("--input", required=True)
    r.add_argument("--packet", required=True)
    r.add_argument("--receipt", required=True)
    r.add_argument("--out", required=True)
    args = p.parse_args(argv)
    try:
        raw = _read(args.input)
        if args.command == "compile":
            packet, receipt = compile_packet(raw)
            _write_bundle(((args.packet, packet), (args.receipt, receipt)))
        elif args.command == "report":
            report = render_report(raw, _read(args.packet), _read(args.receipt))
            with Path(args.out).open("x", encoding="utf-8", newline="") as handle:
                handle.write(report)
            print(f"REPORT_WRITTEN:{args.out}")
        else:
            verify_bundle(raw, _read(args.packet), _read(args.receipt))
            print("VERIFIED")
        return 0
    except (RepoAtlasError, OSError) as exc:
        print(f"ERROR:{exc}")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
