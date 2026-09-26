"""Simulate or verify a QOracle manifest.

Usage:
  python3 cli.py simulate MANIFEST.json
  python3 cli.py verify MANIFEST.json CANDIDATE.json
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

if __package__:
    from .engine import OracleError, load_manifest, simulate, verify
else:
    from engine import OracleError, load_manifest, simulate, verify


def _read(path: Path) -> str:
    if path.is_symlink() or not path.is_file():
        raise OracleError(f"refusing non-regular file {path}")
    data = path.read_bytes()
    if len(data) > 1_000_000:
        raise OracleError("input exceeds 1 MiB")
    return data.decode("utf-8")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Independent small-qubit statevector oracle")
    sub = parser.add_subparsers(dest="command", required=True)
    sim = sub.add_parser("simulate")
    sim.add_argument("manifest")
    check = sub.add_parser("verify")
    check.add_argument("manifest")
    check.add_argument("candidate")
    args = parser.parse_args(argv)
    try:
        manifest = load_manifest(_read(Path(args.manifest)))
        if args.command == "simulate":
            report = simulate(manifest)
        else:
            report = verify(manifest, _read(Path(args.candidate)))
    except (OracleError, OSError, UnicodeError) as exc:
        print(f"HOLD {exc}", file=sys.stderr)
        return 2
    json.dump(report, sys.stdout, sort_keys=True, separators=(",", ":"), allow_nan=False)
    sys.stdout.write("\n")
    if args.command == "verify" and report["state"] != "MATCH":
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
