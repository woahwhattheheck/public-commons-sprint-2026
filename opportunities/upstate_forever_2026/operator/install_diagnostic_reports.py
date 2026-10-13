#!/usr/bin/env python3
"""Install saved Scientific interpretation reports in the original operator.

TokenJunkieLabs. Preserves the current registry and unrelated application source.
"""
from __future__ import annotations
import argparse
import ast
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

PREDECESSORS = json.loads(r'''{
  "model/diagnostic_report_context.py": [
    null,
    "30cfe2a94c68e08020c907900384be726bdeb8d4b92607b0dff97d4b57ce6ce6"
  ],
  "operator/experiment_diagnostics.py": "fd86e59a6223fb0671a5cff79c49a3ee945d4e5b19d3ce934d8b7c2458651d9b",
  "operator/web/experiment_diagnostics.mjs": [
    "41d8de2d22e489621c190b8367f30c566ec9e5724f8f53826fea540f1103f78f",
    "439613ceaf2f79de628dcca00c0f1baeee137df21bc85c6d9177cb3c1973001e",
    "6e151c586a838e2473f368a7a5cff739c9236e78c7b0018068ea6ea720a794c5"
  ],
  "operator/extensions/experiment-diagnostics.json": [
    "958d8df24c61d94cc0651df634abfb29a1735c9bf9c9ccbe61038ad3c2846389",
    "e93fdf3326446a707bdd41c267f4cfaac3330020b63cc786d03f8bee2b0e491e"
  ],
  "operator/DIAGNOSTIC_REPORTS.md": [
    null,
    "f607e7f8a42a19a28aa23e89bc2b24101e5fd4a0b03279ab4fb26760b652b29a",
    "d3e7eb5cb7f572fbf2e168052a8184c8e7cd4217231db2beaa1fe0aca7b77a05",
    "94214aee2d138cb6f5650a9feb1fb105619755df18f1d14f5087bbe607fb2d82"
  ],
  "operator/DIAGNOSTICS.md": [
    "ecfbc5e7c2cee90deaaeee1bb306ef532fae9b120b3028aa6932b4fba7443f3b",
    "0bc9965334c12a39feadbe6b5b5b2d2cd1b668300bd79021cafb2b93a3c65e57",
    "9aab693f786e9de77ae60dcae7d01a08746322a536e512b9606774ec6c423aa4"
  ],
  "model/study_report_transfer.py": null,
  "model/study_transfer.py": "9518fbd91208df57b56e9b7390226bfaaea43ffc823400043a95295c0fbe65c2"
}''')
SELF = "operator/install_diagnostic_reports.py"


def _bytes(path):
    if path.is_symlink():
        raise ValueError("Source installation does not replace symlinks: " + str(path))
    return path.read_bytes() if path.is_file() else None


def _sha(body):
    return hashlib.sha256(body).hexdigest() if body is not None else None


def install(application, source):
    application, source = Path(application).resolve(strict=True), Path(source).resolve(strict=True)
    if not (application / "model" / "workspace.py").is_file():
        raise ValueError("Choose the original scientific application root")
    if not (application / "operator" / "extension_registry.py").is_file():
        raise ValueError("Install the maintained original ExtensionRegistry before this report component")
    host_path = application / "operator" / "web" / "extension_host.mjs"
    if (not host_path.is_file() or
            "openScientificReport" not in host_path.read_text("utf-8")):
        raise ValueError("Install the maintained SourceReports scientific-edition host before this continuation")
    with (application / ".diagnostic-report-install.lock").open("a+b") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        before, after = {}, {}
        for relative, predecessor in {**PREDECESSORS, SELF: [None, "5966d02cbbe99da3715b6d2ef54bf310457a1b237afcc0d40239c7e50cd4876c", "0f0cb6e109c931b51cd3a085f35f0fff4b10af01ce6f08f25c09b3fd5cece30f", "849c8e9028430fddbf3320dfc9016224316e6165ca06e5d688cf632082634826"]}.items():
            body = _bytes(source / relative)
            if body is None:
                raise ValueError("Complete report source is missing: " + relative)
            current = _bytes(application / relative)
            if current == body:
                continue
            accepted = predecessor if isinstance(predecessor, list) else [predecessor]
            if _sha(current) not in accepted:
                raise ValueError("Compose the newer original source before installing " + relative)
            before[relative], after[relative] = current, body
        for relative, body in after.items():
            if relative.endswith(".py"):
                ast.parse(body.decode("utf-8"), filename=relative)
        node = shutil.which("node")
        if node:
            with tempfile.TemporaryDirectory(prefix="diagnostic-report-syntax-") as temp:
                for relative, body in after.items():
                    if relative.endswith(".mjs"):
                        path = Path(temp) / Path(relative).name
                        path.write_bytes(body)
                        result = subprocess.run([node, "--check", str(path)], capture_output=True,
                                                text=True, timeout=45, check=False)
                        if result.returncode:
                            raise ValueError(relative + ": " + result.stderr.strip())
        manifest = json.loads((source / "operator/extensions/experiment-diagnostics.json").read_text("utf-8"))
        if ("diagnostics.report.prepare" not in manifest["backend"]["actions"]
                or "openDelivery" not in manifest["client"]["requires"]
                or "openScientificReport" not in manifest["client"]["requires"]):
            raise ValueError("Report source needs its complete original registry descriptor")
        if not after:
            return {"state": "current", "application": str(application), "changed_files": []}
        for relative, original in before.items():
            if _bytes(application / relative) != original:
                raise ValueError("Current source changed during installation: " + relative)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
        history = application.parent / (application.name + "-source-history") / ("diagnostic-reports-" + stamp)
        history.mkdir(parents=True)
        receipt = {"component": "Scientific diagnostic reports", "created_at": stamp, "files": {}}
        for relative, original in before.items():
            if original is not None:
                target = history / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(original)
            receipt["files"][relative] = {"before_sha256": _sha(original),
                                          "after_sha256": _sha(after[relative]),
                                          "bytes": len(after[relative])}
        (history / "integration.json").write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
        descriptor = "operator/extensions/experiment-diagnostics.json"
        ordered = sorted(relative for relative in after if relative != descriptor)
        if descriptor in after:
            ordered.append(descriptor)
        for relative in ordered:
            target = application / relative
            if _bytes(target) != before[relative]:
                raise ValueError("Current source changed before replacement: " + relative)
            target.parent.mkdir(parents=True, exist_ok=True)
            pending = None
            try:
                with tempfile.NamedTemporaryFile(dir=target.parent, prefix="." + target.name, delete=False) as stream:
                    pending = Path(stream.name)
                    stream.write(after[relative])
                    stream.flush()
                    os.fsync(stream.fileno())
                os.chmod(pending, target.stat().st_mode & 0o777 if target.exists() else 0o644)
                os.replace(pending, target)
                pending = None
            finally:
                if pending is not None:
                    pending.unlink(missing_ok=True)
        return {"state": "installed", "application": str(application), "changed_files": ordered,
                "source_history": str(history),
                "receiving": "Reopen the original operator and retain its current Workspace and state directory."}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", type=Path, required=True)
    parser.add_argument("--source", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args(argv)
    print(json.dumps(install(args.application, args.source), indent=2))


if __name__ == "__main__":
    main()
