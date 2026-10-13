"""Install the current monitoring observational context into the existing app."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import tempfile


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def inside(root, name):
    relative = Path(name)
    if relative.is_absolute() or ".." in relative.parts or "\\" in name:
        raise ValueError("Source member is not an application-relative path")
    path = (root / relative).resolve()
    if not path.is_relative_to(root):
        raise ValueError("Source member escapes its application")
    return path


def install(application, source, *, preview=False):
    application = Path(application).resolve(strict=True)
    source = Path(source).resolve(strict=True)
    if not (application / "operator/extension_registry.py").is_file():
        raise ValueError("Use the original application with its shared extension registry")
    manifest_path = source / "integration/monitoring_observed_sources.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("schema") != "upstate.monitoring-observed-source-install/v1":
        raise ValueError("Select the current complete monitoring source manifest")
    changes = []
    for item in manifest["files"]:
        original = inside(source, item["path"])
        target = inside(application, item["path"])
        if (not original.is_file() or original.stat().st_size != item["bytes"]
                or digest(original) != item["sha256"]):
            raise ValueError("Current source file differs: " + item["path"])
        previous = digest(target) if target.exists() else None
        if previous == item["sha256"]:
            continue
        if previous is not None and previous not in item.get("predecessor_sha256", []):
            raise ValueError("Current target contains a different owner edition: " + item["path"])
        if original.suffix == ".py":
            compile(original.read_text(encoding="utf-8"), str(original), "exec")
        changes.append((item, original, target, previous))
    if not preview:
        for item, original, target, previous in changes:
            observed = digest(target) if target.exists() else None
            if observed != previous:
                raise ValueError("Target changed during source adoption: " + item["path"])
            target.parent.mkdir(parents=True, exist_ok=True)
            fd, temporary = tempfile.mkstemp(prefix="."+target.name+".", dir=target.parent)
            try:
                with os.fdopen(fd, "wb") as output:
                    output.write(original.read_bytes())
                    output.flush()
                    os.fsync(output.fileno())
                os.replace(temporary, target)
            finally:
                if os.path.exists(temporary):
                    os.unlink(temporary)
        destination = application / "integration/monitoring_observed_sources.json"
        if manifest_path.resolve() != destination.resolve():
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(manifest_path.read_bytes())
    return {"schema": "upstate.monitoring-observed-install-result/v1",
            "application": str(application), "source": str(source), "preview": preview,
            "changed_paths": [item["path"] for item, _, _, _ in changes],
            "complete_source_files": len(manifest["files"]),
            "extension": "operator/extensions/monitoring.json"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", required=True)
    parser.add_argument("--source", required=True)
    parser.add_argument("--preview", action="store_true")
    args = parser.parse_args()
    print(json.dumps(install(args.application, args.source, preview=args.preview), indent=2))


if __name__ == "__main__":
    main()
