"""python -m prs: operate the same direct API from retained local files."""
from __future__ import annotations
import argparse
import json
import os
import sys
import tempfile
from pathlib import Path
from . import PrsError, doctor, inspect, compare, prepare, apply, preview_upload, reconcile, catalog

def _json(path):
    try:
        return json.loads(Path(path).read_bytes())
    except (OSError, ValueError) as exc:
        raise PrsError("Cannot read JSON input: " + str(path), "FILE_JSON", str(exc)) from exc

def _bytes(path):
    try:
        return Path(path).read_bytes()
    except OSError as exc:
        raise PrsError("Cannot read original file: " + str(path), "FILE_READ", str(exc)) from exc

def _write(path, content, force=False):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and not force:
        raise PrsError("Output already exists; select another path or explicitly pass --overwrite.", "FILE_EXISTS", str(path))
    fd, temporary = tempfile.mkstemp(prefix="." + path.name + ".", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        if force:
            os.replace(temporary, path)
        else:
            # Atomic no-clobber install; source and candidate cannot be silently
            # conflated by a concurrent output writer.
            os.link(temporary, path)
            os.unlink(temporary)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)

def _json_output(value, path=None, force=False):
    data = (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n").encode("utf-8")
    if path:
        _write(path, data, force)
    else:
        sys.stdout.buffer.write(data)

def main(argv=None):
    parser = argparse.ArgumentParser(description="Retained NLM PRS XML validation and reviewed reconciliation")
    parser.add_argument("--schema-dir", help="Directory containing the three original contracts and their source-contracts.json")
    sub = parser.add_subparsers(dest="command", required=True)
    def output(p):
        p.add_argument("--output")
        p.add_argument("--overwrite", action="store_true")
    def kind(p):
        p.add_argument("--schema", choices=("protocol", "results"), default="protocol")
    output(sub.add_parser("doctor"))
    output(sub.add_parser("catalog"))
    q = sub.add_parser("inspect"); q.add_argument("input"); kind(q); output(q)
    q = sub.add_parser("compare"); q.add_argument("original"); q.add_argument("candidate"); kind(q); output(q)
    q = sub.add_parser("prepare"); q.add_argument("input"); q.add_argument("--decisions", required=True)
    q.add_argument("--reviewer", required=True); q.add_argument("--rationale", default=""); output(q)
    q = sub.add_parser("apply"); q.add_argument("input"); q.add_argument("--plan", required=True)
    q.add_argument("--candidate", required=True); output(q)
    q = sub.add_parser("preview-upload"); q.add_argument("base"); q.add_argument("incoming")
    q.add_argument("--candidate", required=True); q.add_argument("--rules"); q.add_argument("--reviewer", default="")
    kind(q); output(q)
    q = sub.add_parser("reconcile"); q.add_argument("input"); q.add_argument("--api-records", required=True)
    q.add_argument("--plan", required=True); output(q)
    args = parser.parse_args(argv)
    try:
        input_names = ["input", "original", "base", "incoming", "plan", "decisions", "rules", "api_records"]
        if args.command == "compare":
            input_names.append("candidate")
        inputs = {Path(getattr(args, name)).resolve() for name in input_names if getattr(args, name, None)}
        outputs = [Path(args.output).resolve()] if args.output else []
        if args.command in ("apply", "preview-upload"):
            outputs.append(Path(args.candidate).resolve())
        if len(outputs) != len(set(outputs)) or any(p in inputs for p in outputs):
            raise PrsError("Every original input and generated output needs a distinct path.", "FILE_SOURCE")
        if args.command == "doctor":
            result = doctor(args.schema_dir)
        elif args.command == "catalog":
            result = catalog(args.schema_dir)
        elif args.command == "inspect":
            result = inspect(_bytes(args.input), args.schema, args.schema_dir)
        elif args.command == "compare":
            result = compare(_bytes(args.original), _bytes(args.candidate), args.schema, args.schema_dir)
        elif args.command == "prepare":
            result = prepare(_bytes(args.input), _json(args.decisions), args.reviewer, args.rationale, args.schema_dir)
        elif args.command == "apply":
            candidate, result = apply(_bytes(args.input), _json(args.plan), args.schema_dir)
            if Path(args.candidate).resolve() == Path(args.input).resolve():
                raise PrsError("Keep the original source and generated candidate at separate paths.", "FILE_SOURCE")
            _write(args.candidate, candidate, args.overwrite)
        elif args.command == "preview-upload":
            candidate, result = preview_upload(_bytes(args.base), _bytes(args.incoming), args.schema,
                                              _json(args.rules) if args.rules else None, args.reviewer, args.schema_dir)
            if Path(args.candidate).resolve() in {Path(args.base).resolve(), Path(args.incoming).resolve()}:
                raise PrsError("Keep the base, incoming source and composed candidate at separate paths.", "FILE_SOURCE")
            _write(args.candidate, candidate, args.overwrite)
        else:
            records = _json(args.api_records)
            # Descriptor form preserves complete native study bytes rather than
            # requiring a JSON-in-JSON reserialization by the command-line user.
            for item in records:
                if "rawJsonFile" in item:
                    if "rawJson" in item:
                        raise PrsError("Select rawJson or rawJsonFile, not both.", "JSON_SOURCE")
                    source_path = Path(item["rawJsonFile"])
                    if not source_path.is_absolute():
                        source_path = Path(args.api_records).resolve().parent / source_path
                    if source_path.resolve() in outputs:
                        raise PrsError("An output cannot replace an original API JSON file.", "FILE_SOURCE")
                    item["rawJson"] = _bytes(source_path)
            result = reconcile(_bytes(args.input), records, _json(args.plan), args.schema_dir)
        if args.output and hasattr(args, "input") and Path(args.output).resolve() == Path(args.input).resolve():
            raise PrsError("A report cannot overwrite original XML.", "FILE_SOURCE")
        _json_output(result, args.output, args.overwrite)
        return 0
    except (PrsError, OSError, TypeError, KeyError) as exc:
        error = exc.as_dict() if isinstance(exc, PrsError) else {"error": {"code": "FILE_OPERATION", "message": str(exc)}}
        sys.stderr.write(json.dumps(error, ensure_ascii=False) + "\n")
        return 2

if __name__ == "__main__":
    raise SystemExit(main())
