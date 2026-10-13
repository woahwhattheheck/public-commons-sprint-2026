"""Capture, transfer, and receive the original application's native environment."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import signal
import sys

# Support a source ZIP on a donor before it is composed into the main application.
if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from source_tools.native_runtime import capsule, probe, transport


def parser():
    root = argparse.ArgumentParser(description=__doc__)
    root.add_argument("--debug", action="store_true", help="include a traceback on failure")
    commands = root.add_subparsers(dest="command", required=True)

    command = commands.add_parser("identity", help="inspect the selected donor/receiver interpreter")
    command.add_argument("--python", default=sys.executable)
    command.add_argument("--output", type=Path)

    command = commands.add_parser("probe", help="load the exact maintained native models and application adapter")
    command.add_argument("--python", default=sys.executable)
    command.add_argument("--application", type=Path, required=True)
    command.add_argument("--output", type=Path, required=True, help="retained probe directory")

    command = commands.add_parser("build-wheels", help="build the complete dependency wheelhouse on one equipped donor")
    command.add_argument("--requirements", type=Path, required=True)
    command.add_argument("--destination", type=Path, required=True)
    command.add_argument("--python", default=sys.executable)
    command.add_argument("--cache", type=Path)

    command = commands.add_parser("seal-wheels", help="seal built wheels and the actual build interpreter identity")
    command.add_argument("--wheels", type=Path, required=True)
    command.add_argument("--application", type=Path, required=True)
    command.add_argument("--python", default=sys.executable, help="the interpreter used to build these wheels")
    command.add_argument("--output", type=Path, required=True)

    command = commands.add_parser("capture-conda", help="probe and conda-pack an existing native donor environment")
    command.add_argument("--prefix", type=Path, required=True)
    command.add_argument("--application", type=Path, required=True)
    command.add_argument("--output", type=Path, required=True)
    command.add_argument("--pack-python", default=sys.executable, help="interpreter with conda-pack installed")
    command.add_argument("--resume", action="store_true")

    command = commands.add_parser("seal-conda", help="seal an already retained conda-pack and its donor probe")
    command.add_argument("--archive", type=Path, required=True)
    command.add_argument("--donor-probe", type=Path, required=True)
    command.add_argument("--application", type=Path, required=True)
    command.add_argument("--output", type=Path, required=True)

    command = commands.add_parser("inspect", help="verify all capsule payload bytes and read complete package metadata")
    command.add_argument("--capsule", type=Path, required=True)
    command.add_argument("--output", type=Path)

    command = commands.add_parser("split", help="create complete ordered transfer parts, reusing original matching parts")
    command.add_argument("--capsule", type=Path, required=True)
    command.add_argument("--destination", type=Path, required=True)
    command.add_argument("--part-bytes", type=int, default=8 * transport.BLOCK)

    command = commands.add_parser("join", help="resume and verify the exact complete capsule from ordered parts")
    command.add_argument("--manifest", type=Path, required=True)
    command.add_argument("--output", type=Path, required=True)

    command = commands.add_parser("install", help="receive into one new final prefix and run the maintained native probe")
    command.add_argument("--capsule", type=Path, required=True)
    command.add_argument("--prefix", type=Path, required=True)
    command.add_argument("--application", type=Path, required=True)
    command.add_argument("--python", default=sys.executable, help="matching base Python for wheelhouse mode")
    command.add_argument("--resume", action="store_true")
    return root


def operate(args):
    name = args.command
    if name == "identity":
        return capsule.python_identity(args.python)
    if name == "probe":
        selection = probe.selected_source(args.application)
        return capsule.probe_python(capsule.resolve_python(args.python), selection,
                                    args.output, application=args.application)
    if name == "build-wheels":
        return capsule.build_wheelhouse(args.requirements, args.destination,
                                       python=args.python, cache=args.cache)
    if name == "seal-wheels":
        return capsule.seal(args.wheels, args.output, probe.selected_source(args.application),
                            capsule.python_identity(args.python), kind="wheelhouse")
    if name == "capture-conda":
        return capsule.capture_conda(args.prefix, args.application, args.output,
                                     pack_python=args.pack_python, resume=args.resume)
    if name == "seal-conda":
        donor = transport.read_json(args.donor_probe)
        selected = probe.selected_source(args.application)
        if donor.get("state") != "ready" or donor.get("schema") != "upstate.native-runtime-probe/v1":
            raise ValueError("Select the completed original donor runtime probe")
        if any(selected[key] != donor.get("selection", {}).get(key) for key in ("version", "source")):
            raise ValueError("Donor and receiving application select different native models")
        return capsule.seal(args.archive, args.output, selected, donor["identity"],
                            kind="conda-pack", donor_probe=donor)
    if name == "inspect":
        return capsule.inspect_capsule(args.capsule)
    if name == "split":
        return transport.split(args.capsule, args.destination, args.part_bytes)
    if name == "join":
        return transport.join(args.manifest, args.output)
    if name == "install":
        return capsule.install(args.capsule, args.prefix, args.application,
                               python=args.python, resume=args.resume)
    raise ValueError("Unknown runtime command")


def main(argv=None):
    args = parser().parse_args(argv)
    try:
        result = operate(args)
        if args.command in ("identity", "inspect") and args.output:
            transport.atomic_json(args.output, result)
        print(json.dumps(result, sort_keys=True, indent=2, allow_nan=False), flush=True)
        return 2 if args.command == "probe" and result["state"] != "ready" else 0
    except KeyboardInterrupt:
        print(json.dumps({"state": "interrupted", "command": args.command}), file=sys.stderr)
        return 130
    except Exception as exc:
        print(json.dumps({"state": "failed", "command": args.command,
                          "error": {"type": type(exc).__name__, "message": str(exc)}}), file=sys.stderr)
        if args.debug:
            import traceback
            traceback.print_exc()
        return 2


if __name__ == "__main__":
    def terminated(_signal, _frame):
        raise SystemExit(143)
    signal.signal(signal.SIGTERM, terminated)
    raise SystemExit(main())
