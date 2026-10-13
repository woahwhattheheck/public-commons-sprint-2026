"""Install the additive station geography desk in the existing complete application."""
from __future__ import annotations
import argparse
import ast
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

FILES = (
    "model/station_geography.py",
    "model/station_study.py",
    "operator/PREPARED_STATION_STUDY.md",
    "operator/station_geography.py",
    "operator/web/station_geography.mjs",
    "operator/web/station_geography.css",
    "operator/extensions/station-geography.json",
    "operator/install_station_geography.py",
    "operator/STATION_GEOGRAPHY.md",
    "operator/fixtures/station_geography_actual87_ids.json",
)

def sha(body):
    return hashlib.sha256(body).hexdigest()

def install(application, source_root, *, dry_run=False):
    application, source_root = Path(application).resolve(strict=True), Path(source_root).resolve(strict=True)
    for name in ("model/workspace.py", "model/spatial_esri.py", "operator/server.py",
                 "operator/web/app.mjs", "operator/extension_registry.py", "operator/web/extension_host.mjs"):
        if not (application / name).is_file():
            raise ValueError("Receive the complete existing application before adding station geography: " + name)
    pending, previous = {}, {}
    for name in FILES:
        body = (source_root / name).read_bytes()
        if name.endswith(".py"):
            ast.parse(body.decode("utf-8"), filename=name)
        elif name.endswith(".json"):
            value = json.loads(body)
            if name.endswith("station-geography.json") and value.get("schema") != "upstate.operator-extension/v1":
                raise ValueError("The station geography descriptor schema differs")
        pending[name] = body
        previous[name] = (application / name).read_bytes() if (application / name).exists() else None
    changed = [name for name in FILES if previous[name] != pending[name]]
    server = (application / "operator/server.py").read_text(encoding="utf-8")
    browser = (application / "operator/web/app.mjs").read_text(encoding="utf-8")
    host_needed = "ExtensionRegistry" not in server or "createExtensionHost" not in browser
    if host_needed and not (application / "install_extensions.py").is_file():
        raise ValueError("Retain the existing authored install_extensions.py to join its original operator host")
    receipt = {"schema": "upstate.station-geography-install/v1", "application": str(application),
        "dry_run": dry_run, "changed": changed, "existing_host_install_needed": host_needed,
        "files": [{"path": name, "bytes": len(pending[name]), "sha256": sha(pending[name]),
                  "previous_sha256": sha(previous[name]) if previous[name] is not None else None} for name in FILES]}
    if dry_run:
        return receipt
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    backup = application / ".station-geography-backups" / stamp
    with tempfile.TemporaryDirectory(prefix=".station-geography-install-", dir=application.parent) as temporary:
        staging = Path(temporary)
        for name in changed:
            target = staging / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(pending[name])
        for name in changed:
            target = application / name
            current = target.read_bytes() if target.exists() else None
            if current != previous[name]:
                raise RuntimeError("Concurrent authored source changed during station installation: " + name)
        for name in changed:
            target = application / name
            if previous[name] is not None:
                original = backup / name
                original.parent.mkdir(parents=True, exist_ok=True)
                original.write_bytes(previous[name])
            target.parent.mkdir(parents=True, exist_ok=True)
            os.replace(staging / name, target)
    if host_needed:
        completed = subprocess.run([sys.executable, str(application / "install_extensions.py"),
            "--application", str(application), "--source-root", str(application)],
            check=True, capture_output=True, text=True, cwd=application)
        receipt["original_host_install"] = json.loads(completed.stdout)
    receipt["installed_at"] = dt.datetime.now(dt.timezone.utc).isoformat()
    receipt_path = application / "operator" / "station-geography-install.json"
    receipt_path.write_text(json.dumps(receipt, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return receipt

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", required=True)
    parser.add_argument("--source-root", default=str(Path(__file__).resolve().parent.parent))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    print(json.dumps(install(args.application, args.source_root, dry_run=args.dry_run), indent=2, sort_keys=True))

if __name__ == "__main__":
    main()
