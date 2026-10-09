"""Simulate, verify or diagnose a QOracle manifest."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

if __package__:
    from .engine import OracleError, load_manifest, simulate, verify
    from .diagnostics import expectation_gradients, reduced_state
else:
    from engine import OracleError, load_manifest, simulate, verify
    from diagnostics import expectation_gradients, reduced_state


def _read(path: Path) -> str:
    if path.is_symlink() or not path.is_file():
        raise OracleError(f"refusing non-regular file {path}")
    # Read one byte beyond the permitted size; never materialize the entire
    # input before enforcing the CLI limit.
    with path.open("rb") as stream:
        data = stream.read(1_000_001)
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
    gradient = sub.add_parser("gradient", help="Pauli expectation derivatives per rotation gate")
    gradient.add_argument("manifest")
    gradient.add_argument("--gates", type=int, nargs="+", help="zero-based RX/RY/RZ gate indices; default: all")
    density = sub.add_parser("reduced-state", help="partial trace and purity on ordered wires")
    density.add_argument("manifest")
    density.add_argument("--wires", type=int, nargs="+", required=True, help="ordered register wires, at most six")
    args = parser.parse_args(argv)
    try:
        manifest = load_manifest(_read(Path(args.manifest)))
        if args.command == "simulate":
            report = simulate(manifest)
        elif args.command == "gradient":
            report = expectation_gradients(manifest, args.gates)
        elif args.command == "reduced-state":
            report = reduced_state(manifest, args.wires)
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
