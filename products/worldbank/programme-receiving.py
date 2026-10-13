#!/usr/bin/env python3
"""Receive the installed World Bank product and its original complete programme course."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import signal
import sys
import traceback

OPERATION = "WORLDBANK-CUSTOMER-PROGRAMME-RECEIVING-FE85-20261013"
COURSE_ID = hashlib.sha256((OPERATION + ":original-recurring-course").encode()).hexdigest()[:32]
SCHEMA = "stellar-forge.worldbank-installed-programme-receiving.v1"


def require(value, message):
    if not value:
        raise ValueError(message)


def emit(value):
    print(json.dumps(value, ensure_ascii=False, allow_nan=False), flush=True)


def module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    require(spec is not None and spec.loader is not None, "Open the original installed receiving source.")
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


def stop(number, frame):
    error = InterruptedError("Continue this same installed programme receiving after its original engines close.")
    error.exit_code = 130 if number == signal.SIGINT else 143
    raise error


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--python-dependencies")
    parser.add_argument("--playwright-module", required=True)
    parser.add_argument("--chromium", required=True)
    parser.add_argument("--process-family", required=True,
                        help="The original selected process_family.py used by the programme course")
    args = parser.parse_args(argv)
    if sys.version_info < (3, 11):
        raise ValueError("Python 3.11 or later is required.")
    os.umask(0o077)
    original = module(Path(__file__).resolve().with_name("receiving.py"), "worldbank_installed_receiving")
    root = original.private(Path(args.workspace))
    control = original.private(root / "installed-programme-receiving")
    lease = os.open(control, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        os.close(lease)
        emit({"phase": "PROGRAMME_RECEIVING_BUSY", "workspace": str(root)})
        return 75
    previous = {kind: signal.getsignal(kind) for kind in (signal.SIGINT, signal.SIGTERM)}
    for kind in previous:
        signal.signal(kind, stop)
    try:
        supplied = json.loads(os.environ.get("STARFORGE_WORLDBANK_PRODUCT_RUNTIME", "{}"))
        binding, source_root, package = original.selected_source(root, supplied)
        require(Path(__file__).resolve() == source_root / "products/worldbank/programme-receiving.py"
                and Path(original.__file__).resolve() == source_root / "products/worldbank/receiving.py",
                "Run both receivers from this exact installed source.")
        manifest = json.loads(original.read_regular(Path(binding["directory"]) / "package/manifest.json"))
        selected = {item["path"] for item in manifest["files"]}
        prefix = "stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python/stellar_forge_buyer/"
        required = {
            "products/worldbank/programme-receiving.py",
            "products/worldbank/reviewed-reference.py",
            prefix + "worldbank_programmes.py",
            prefix + "worldbank_recurring_receive.py",
            prefix + "worldbank_programmes_receive.py",
        }
        require(required <= selected, "Use the complete installed programme source selection.")
        if args.python_dependencies:
            dependencies = Path(args.python_dependencies).expanduser().resolve(strict=True)
            require(dependencies.is_dir(), "Select the existing Python dependency directory.")
            sys.path.insert(0, str(dependencies))
        sys.path.insert(0, str(package))
        temporary = original.private(root / "tmp")
        os.environ["TMPDIR"] = str(temporary)
        os.environ["PYTHONDONTWRITEBYTECODE"] = "1"
        sys.dont_write_bytecode = True
        sys.pycache_prefix = str(temporary / "python-cache")
        import openpyxl
        require(openpyxl.__version__ == "3.1.5", "Use the original openpyxl==3.1.5 dependency.")
        from stellar_forge_buyer.worldbank_analysis import encoded, regular, sha
        from stellar_forge_buyer.worldbank_recurring_receive import receive
        from stellar_forge_buyer.worldbank_programmes_receive import (
            receive_programmes, _file, FAMILY_BYTES, FAMILY_SHA)
        fixture = module(source_root / "products/worldbank/reviewed-reference.py",
                         "worldbank_reviewed_reference")
        core = source_root / "stellar/scf-starforge-20261009/sf30-seller-sdk/worldbank/core.py"
        runtime = {
            "node": Path(supplied["node"]).expanduser().resolve(strict=True),
            "playwright": Path(args.playwright_module).expanduser().resolve(strict=True),
            "chromium": Path(args.chromium).expanduser().resolve(strict=True),
            "process_family": Path(args.process_family).expanduser().resolve(strict=True),
        }
        runtime_identity = {name: _file(path) for name, path in runtime.items()}
        family = runtime_identity["process_family"]
        require(family["bytes"] == FAMILY_BYTES and family["sha256"] == FAMILY_SHA,
                "Use the unchanged original process-family source.")
        intent = {
            "schema": SCHEMA, "operation": OPERATION, "course_id": COURSE_ID,
            "installation": binding, "runtime": runtime_identity,
            "fixture": _file(source_root / "products/worldbank/reviewed-reference.py"),
            "receiver": _file(Path(__file__).resolve()),
        }
        original.retain(control / "intent.json", encoded(intent))

        # Keep the original managed Applications, 42 observations, four reports,
        # workbook and customer receiving first. Its own lease, signals and
        # completed-result reopen remain authoritative.
        old_argv = sys.argv
        sys.argv = [str(Path(original.__file__)), "--workspace", str(root)]
        if args.python_dependencies:
            sys.argv += ["--python-dependencies", args.python_dependencies]
        try:
            result = original.main()
        finally:
            sys.argv = old_argv
        if result:
            return result
        original_result = json.loads(original.read_regular(root / "product-receiving.json"))
        require(original_result.get("status") == "COMPLETE"
                and original_result.get("installation") == binding,
                "Complete the original installed product before its recurring course.")

        # This fixture only changes a native review choice. It preserves every
        # original provider body and issues no new provider acquisition.
        reference = fixture.reviewed_reference(
            control / "reference", core, root / "WorldBank_Managed_Customer_Handover_20261012.zip")
        require(reference["baseline"]["rows"] == 42 and reference["candidate"]["rows"] == 41
                and reference["provider_revision_claim"] is False
                and reference["baseline"]["capture_sha256"] == reference["candidate"]["capture_sha256"],
                "Use the explicit 42-to-41 reviewed edition of the same provider capture.")
        course = original.private(control / "recurring-course")
        recurring = receive(reference["baseline"]["path"], reference["candidate"]["path"],
                            core, course, COURSE_ID, resume=True)
        require(recurring.get("status") == "COMPLETE"
                and recurring["intent"]["operation_id"] == COURSE_ID,
                "Complete the original two-handover customer course.")
        programme = receive_programmes(
            recurring, reference["candidate"]["path"], core, course, COURSE_ID,
            node=runtime["node"], playwright=runtime["playwright"],
            chromium=runtime["chromium"], process_family=runtime["process_family"],
            source_commit=binding["sourceCommit"], resume=True)
        require(programme.get("status") == "COMPLETE",
                "Complete the existing programme browser and own-archive continuation.")

        # The original receivers reopen and verify their business files and
        # actual browser images/downloads before this combined result is adopted.
        receipts = {
            "installed_product": _file(root / "product-receiving.json"),
            "reviewed_reference": _file(control / "reference/reviewed-reference.json"),
            "recurring_course": _file(course / "recurring-receiving.json"),
            "programme_course": _file(course / "programme-receiving/programme-receiving.json"),
        }
        complete = {
            "schema": SCHEMA, "status": "COMPLETE", "operation": OPERATION,
            "course_id": COURSE_ID, "intent_sha256": sha(regular(control / "intent.json")),
            "installation": binding, "reference": reference,
            "receipts": receipts, "recurring": recurring, "programme": programme,
        }
        destination = control / "receiving.json"
        reused = destination.exists()
        original.retain(destination, encoded(complete))
        emit({"phase": "INSTALLED_PROGRAMME_COMPLETE", "operation": OPERATION,
              "course_id": COURSE_ID, "result": str(destination), "reused": reused,
              "source_rows": {"before": 42, "after": 41},
              "provider_revision_claim": False, "course": str(course)})
        return 0
    except BaseException as error:
        paused = {"operation": OPERATION, "at": datetime.now(timezone.utc).isoformat(),
                  "error_type": type(error).__name__, "error": str(error),
                  "traceback": traceback.format_exc()}
        try:
            fd = os.open(control / "native-errors.jsonl",
                         os.O_WRONLY | os.O_APPEND | os.O_CREAT | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, "a", encoding="utf-8") as stream:
                stream.write(json.dumps(paused, ensure_ascii=False) + "\n")
                stream.flush()
                os.fsync(stream.fileno())
        except OSError:
            pass
        emit({"phase": "PROGRAMME_RECEIVING_PAUSED", **paused})
        return getattr(error, "exit_code", 75 if isinstance(error, BlockingIOError)
                       else 130 if isinstance(error, KeyboardInterrupt) else 1)
    finally:
        for kind, handler in previous.items():
            signal.signal(kind, handler)
        os.close(lease)


if __name__ == "__main__":
    raise SystemExit(main())
