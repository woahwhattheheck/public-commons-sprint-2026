#!/usr/bin/env python3
"""Receive an exact integration packet from a Commons source-bank or Canvas export.

The existing operator/integrate_operations.py owns source composition, atomic
replacement and recovery. This command only decodes and retains its original input.
"""
import argparse
import base64
import binascii
import gzip
import importlib.util
import io
import json
from pathlib import Path
import re
import sys

MAX_BYTES = 16 * 1024 * 1024
MAX_DEPTH = 32
BANK_SCHEMA = "commons.source-bank/v1"
RESULT_SCHEMA = "upstate.operator-integration-result/v1"
FENCES = re.compile(
    r"^[ \t\u00a0]*(?P<fence>\x60{3,}|~{3,})[ \t]*(?:json)?[ \t]*\r?\n"
    r"(?P<body>.*?)^[ \t\u00a0]*(?P=fence)[ \t]*(?:\r?\n|$)", re.M | re.S | re.I)


def load_receiver(application):
    root = Path(application).resolve(strict=True)
    path = root / "operator" / "integrate_operations.py"
    if not path.is_file() or path.resolve().parent != root / "operator":
        raise ValueError("Existing application receiver is unavailable: " + str(path))
    name = "_upstate_source_bank_integrator"
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ValueError("Cannot load the existing application receiver")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def transport_spaces(text):
    """Repair Canvas structural whitespace without touching any JSON string."""
    quoted = escaped = False
    output = []
    for char in text:
        if quoted:
            output.append(char)
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                quoted = False
        else:
            if char == '"':
                quoted = True
            output.append(" " if char in ("\u00a0", "\u202f") else char)
    return "".join(output)


class Carrier:
    def __init__(self, core):
        self.core = core
        self.candidates = []
        self.opaque_operations = set()
        self.seen = set()
        self.visits = 0
        self.decoded_bytes = 0

    def fail(self, message, **details):
        raise self.core.IntegrationError(message, details=details)

    def bounded(self, data, label):
        if len(data) > MAX_BYTES:
            self.fail("Carrier or decoded member exceeds 16 MiB", input=label)
        return data

    def base64_bytes(self, value, label):
        if not isinstance(value, str):
            self.fail("Expected an original base64 payload", input=label)
        try:
            # Whitespace belongs to the transport; decoded bytes are never edited.
            compact = "".join(value.split()).encode("ascii")
            return self.bounded(base64.b64decode(compact, validate=True), label)
        except (UnicodeError, ValueError, binascii.Error) as exc:
            self.fail("Invalid base64 payload: " + str(exc), input=label)

    def parse_json(self, data, label):
        try:
            return self.core.decode_json(data, label), False
        except self.core.IntegrationError:
            text = data.decode("utf-8-sig")
            repaired = transport_spaces(text)
            if repaired == text:
                raise
            return self.core.decode_json(repaired.encode("utf-8"), label), True

    def document(self, data, label, depth=0, member=None, strict=True):
        self.bounded(data, label)
        if depth > MAX_DEPTH:
            self.fail("Carrier nesting exceeds the receiving limit", input=label)
        identity = (self.core.sha256(data), member)
        if identity in self.seen:
            return
        self.seen.add(identity)
        if data.startswith(b"\x1f\x8b"):
            try:
                with gzip.GzipFile(fileobj=io.BytesIO(data)) as stream:
                    unpacked = stream.read(MAX_BYTES + 1)
            except (OSError, EOFError) as exc:
                self.fail("Invalid gzip carrier: " + str(exc), input=label)
            self.document(self.bounded(unpacked, label), label + ":gzip", depth + 1, member, strict)
            return
        text = data.decode("utf-8-sig")
        stripped = text.lstrip(" \t\r\n\u00a0\u202f")
        if stripped.startswith(("{", "[")):
            try:
                value, repaired = self.parse_json(data, label)
            except self.core.IntegrationError:
                if strict:
                    raise
                return
            self.walk(value, label, depth + 1, data if not repaired else None, member)
            return
        blocks = list(FENCES.finditer(text))
        if blocks:
            for index, block in enumerate(blocks, 1):
                body = block.group("body").encode("utf-8")
                self.document(body, label + ":block-" + str(index), depth + 1, member, False)
            return
        compact = "".join(text.split())
        if compact.startswith("H4sI"):
            packed = self.base64_bytes(compact, label)
            if not packed.startswith(b"\x1f\x8b"):
                self.fail("Base64 carrier is not gzip data", input=label)
            self.document(packed, label + ":base64", depth + 1, member, strict)

    def walk(self, value, label, depth, original=None, member=None):
        self.visits += 1
        if self.visits > 8192 or depth > MAX_DEPTH:
            self.fail("Carrier structure exceeds the receiving limit", input=label)
        if isinstance(value, dict):
            schema = value.get("schema")
            if schema == self.core.BUNDLE_SCHEMA:
                operation_id = value.get("operation_id")
                if not isinstance(operation_id, str) or not self.core.OPERATION.fullmatch(operation_id):
                    self.fail("Invalid integration operation_id", input=label)
                if original is None:
                    # A parsed object cannot establish the original packet's file bytes.
                    self.opaque_operations.add(operation_id)
                    return
                self.candidates.append({
                    "data": original, "raw": value, "operation_id": operation_id,
                    "sha256": self.core.sha256(original), "bytes": len(original),
                    "member": member, "origin": label})
                return
            if schema == BANK_SCHEMA:
                self.bank(value, label, depth)
                return
            for key, item in value.items():
                self.walk(item, label + "." + str(key), depth + 1)
        elif isinstance(value, list):
            for index, item in enumerate(value):
                self.walk(item, label + "[" + str(index) + "]", depth + 1)
        elif isinstance(value, str):
            stripped = value.lstrip(" \t\r\n\ufeff\u00a0\u202f")
            if stripped.startswith(("{", "[", "H4sI")) or FENCES.search(value):
                self.document(value.encode("utf-8"), label, depth + 1, strict=False)

    def bank(self, bank, label, depth):
        rows = bank.get("files")
        if not isinstance(rows, list):
            self.fail("Source-bank files must be an array", input=label)
        paths = set()
        for entry in rows:
            if not isinstance(entry, dict):
                self.fail("Source-bank file entry must be an object", input=label)
            path = self.core.relative_path(entry.get("path"))
            if path in paths:
                self.fail("Duplicate source-bank member", input=label, member=path)
            paths.add(path)
            if entry.get("encoding", "base64") != "base64":
                self.fail("Unsupported source-bank member encoding", member=path)
            expected = self.core.checked_hash(entry.get("sha256"), path + ".sha256")
            size = entry.get("bytes")
            if type(size) is not int or not 0 <= size <= MAX_BYTES:
                self.fail("Invalid source-bank member byte length", member=path)
            payload = self.base64_bytes(entry.get("content_base64"), path)
            if len(payload) != size or self.core.sha256(payload) != expected:
                self.fail("Source-bank member bytes or SHA-256 mismatch", member=path)
            self.decoded_bytes += len(payload)
            if self.decoded_bytes > MAX_BYTES * 4:
                self.fail("Decoded source-bank members exceed 64 MiB", input=label)
            # Source files remain source files. Only an original JSON operation
            # (or another carrier containing one) can reach the live integrator.
            if payload.startswith(b"\x1f\x8b"):
                self.document(payload, label + ":" + path, depth + 1, path, False)
                continue
            try:
                text = payload.decode("utf-8-sig")
            except UnicodeError:
                continue
            if text.lstrip(" \t\r\n\u00a0\u202f").startswith(("{", "[")):
                self.document(payload, label + ":" + path, depth + 1, path, False)

    def select(self, operation_id=None, member=None, expected_sha256=None):
        selected = [item for item in self.candidates
                    if (operation_id is None or item["operation_id"] == operation_id)
                    and (member is None or item["member"] == member)
                    and (expected_sha256 is None or item["sha256"] == expected_sha256)]
        unique = {}
        for item in selected:
            unique.setdefault(item["sha256"], item)
        if len(unique) != 1:
            available = [{"operation_id": item["operation_id"], "member": item["member"],
                          "bytes": item["bytes"], "sha256": item["sha256"]}
                         for item in self.candidates]
            message = ("Several exact operation packets match; select --operation-id, --member or --sha256"
                       if unique else "No exact integration packet matches the requested selectors")
            if not self.candidates and self.opaque_operations:
                message += "; export the original JSON text or its content_base64 member"
            self.fail(message, available=available,
                      operation_objects_without_original_bytes=sorted(self.opaque_operations))
        return next(iter(unique.values()))


def source_path(core, digest):
    return core.CONTROL + "/.received/" + digest + ".json"


def resume_input(core, filesystem, operation_id):
    if not core.OPERATION.fullmatch(operation_id):
        raise core.IntegrationError("Invalid --resume operation id")
    core.relative_path(operation_id)
    record_path = core.CONTROL + "/" + operation_id + "/source-input.json"
    saved = filesystem.read(record_path)
    if saved is None:
        raise core.IntegrationError("No retained source input; receive the original carrier first",
                                    details={"operation_id": operation_id})
    record = core.decode_json(saved.data, record_path)
    if not isinstance(record, dict):
        raise core.IntegrationError("Invalid retained source-input record")
    digest = core.checked_hash(record.get("source_sha256"), "source_sha256")
    relative = source_path(core, digest)
    if record.get("source_path") != relative:
        raise core.IntegrationError("Retained source input has an unexpected path")
    payload = filesystem.read(relative)
    size = record.get("source_bytes")
    if (payload is None or type(size) is not int or len(payload.data) != size
            or core.sha256(payload.data) != digest):
        raise core.IntegrationError("Retained source input is missing or has changed",
                                    details={"path": relative})
    return payload.data, str(filesystem.root / relative), digest


def retain_input(core, filesystem, selected):
    relative = source_path(core, selected["sha256"])
    with filesystem.receiver_lock():
        current = filesystem.read(relative)
        if current is None:
            filesystem.atomic_write(relative, selected["data"], mode=0o600, expected=None)
        elif current.data != selected["data"]:
            raise core.conflict("Retained input path has different bytes", path=relative)
        bundle = core.load_bundle(filesystem.root / relative)
        retained = filesystem.read(relative)
        if (retained is None or retained.data != selected["data"]
                or bundle["sha256"] != core.sha256(core.canonical_json(selected["raw"]))):
            raise core.conflict("Source input changed while loading", path=relative)
        for suffix in ("intent.json", "journal.json"):
            path = core.operation_path(bundle, suffix)
            existing = filesystem.read(path)
            if existing is not None:
                core.check_binding(core.decode_json(existing.data, path), bundle, filesystem, path)
        record_path = core.operation_path(bundle, "source-input.json")
        record = {
            "operation_id": bundle["operation_id"], "application": str(filesystem.root),
            "bundle_sha256": bundle["sha256"], "source_path": relative,
            "source_sha256": selected["sha256"], "source_bytes": selected["bytes"]}
        existing = filesystem.read(record_path)
        if existing is None:
            filesystem.atomic_write(record_path, core.canonical_json(record) + b"\n",
                                    mode=0o600, expected=None)
        else:
            previous = core.decode_json(existing.data, record_path)
            core.check_binding(previous, bundle, filesystem, record_path)
            if any(previous.get(key) != value for key, value in record.items()):
                raise core.conflict("Operation id is bound to different original source bytes",
                                    operation_id=bundle["operation_id"], record=record_path)
    return bundle, {"path": str(filesystem.root / relative), "bytes": selected["bytes"],
                    "sha256": selected["sha256"], "member": selected["member"],
                    "origin": selected["origin"]}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("carrier", nargs="?", help="Canvas Markdown/JSON, source-bank, original packet, or - for stdin")
    parser.add_argument("--application", required=True, help="Existing application with operator/integrate_operations.py")
    parser.add_argument("--operation-id", help="Select the exact published operation id")
    parser.add_argument("--member", help="Select an exact source-bank files[].path")
    parser.add_argument("--sha256", help="Require the original decoded packet's file SHA-256")
    parser.add_argument("--resume", metavar="OPERATION_ID", help="Apply the retained original input without its carrier")
    args = parser.parse_args(argv)
    if bool(args.carrier) == bool(args.resume):
        parser.error("Provide a carrier or --resume OPERATION_ID")
    if args.resume and (args.member or (args.operation_id and args.operation_id != args.resume)):
        parser.error("--resume cannot select a different member or operation id")
    filesystem = core = bundle = receipt = None
    try:
        core = load_receiver(args.application)
        filesystem = core.ApplicationFiles(args.application)
        expected = core.checked_hash(args.sha256, "--sha256") if args.sha256 else None
        if args.resume:
            data, label, retained_sha256 = resume_input(core, filesystem, args.resume)
            if expected is not None and retained_sha256 != expected:
                raise core.conflict("Retained input differs from --sha256", operation_id=args.resume)
            expected = retained_sha256
        elif args.carrier == "-":
            data, label = sys.stdin.buffer.read(MAX_BYTES + 1), "stdin"
        else:
            path = Path(args.carrier).resolve(strict=True)
            with path.open("rb") as stream:
                data = stream.read(MAX_BYTES + 1)
            label = str(path)
        carrier = Carrier(core)
        carrier.document(data, label)
        selected = carrier.select(args.resume or args.operation_id, args.member, expected)
        bundle, receipt = retain_input(core, filesystem, selected)
        # Release the intake lock before the original receiver acquires its lock.
        result = core.integrate(filesystem, bundle, False)
        result["source_input"] = receipt
        print(json.dumps(result, indent=2, ensure_ascii=False))
        return 0
    except KeyboardInterrupt:
        print(json.dumps({"schema": RESULT_SCHEMA, "state": "interrupted",
                          "message": "Rerun the same carrier, or use --resume with its operation id."}))
        return 130
    except Exception as exc:
        if core is not None and isinstance(exc, core.IntegrationError):
            result = exc.details.get("result", {"schema": RESULT_SCHEMA,
                        "state": "conflict" if exc.exit_code == 3 else "error",
                        "error": str(exc), **exc.details})
            result.setdefault("error", str(exc))
            code = exc.exit_code
        else:
            result = {"schema": RESULT_SCHEMA, "state": "error", "error": str(exc)}
            code = 1
        if receipt is not None:
            result["source_input"] = receipt
            result.setdefault("operation_id", bundle["operation_id"])
        print(json.dumps(result, indent=2, ensure_ascii=False))
        return code
    finally:
        if filesystem is not None:
            filesystem.close()


if __name__ == "__main__":
    sys.exit(main())
