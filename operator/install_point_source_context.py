"""Install the retained-source observation binding desk into the registered operator."""
from __future__ import annotations
import argparse
import ast
import fcntl
import hashlib
import json
import os
from pathlib import Path
import tempfile

FILES = (
    "source/retained_point_sources.py",
    "source/retained_point_sources_cli.py",
    "operator/point_source_context.py",
    "operator/extensions/point-source-context.json",
    "operator/web/point_source_context.mjs",
    "operator/web/point_source_context.css",
    "operator/install_point_source_context.py",
    "source/POINT_SOURCE_CONTEXT.md",
)

KNOWN_RELEASES = {
    "source/retained_point_sources.py": [
        "9fb5722d096682b6529289d9830dd4145c7b4638d2dc74760e1af1ab0e325cb7"
    ],
    "operator/point_source_context.py": [
        "91131591ccaf76205e44e296f50d1d2a1682e140eea9733a8a2001f91cb77f0f"
    ],
    "operator/extensions/point-source-context.json": [
        "bb996aea2cda5eef0b24fb7c8b25c0134a48d054bdfa12f25e18ee8dfb1388f3"
    ],
    "operator/web/point_source_context.mjs": [
        "b6a8ce8a6187f9ac78d9d27fc555e81f4b7f6af3d29b4ab9355c3e0a43868da1"
    ],
    "operator/web/point_source_context.css": [
        "67d1116d0cea4209941f04b6e60d6544172c11a1a920ea0218e20d41ad9622c8"
    ],
    "operator/install_point_source_context.py": [
        "0ad0fe50dd4d52fcd932ed67d8f4fa2373a48c6c43ada23b25af7001f215c40c"
    ],
    "source/POINT_SOURCE_CONTEXT.md": [
        "59b632736c0ccf39a04a1c5441de8e40689dc0863ae287abb0cf928459f982bb"
    ]
}
PORTABLE_BLOCK = "        # Verify retained original point-source observation bindings before publication.\n        if any((restored.root / \"point-source-bindings\").glob(\"*.json\")):\n            from source.retained_point_sources import verify_workspace as verify_point_source_bindings\n            result[\"point_source_context\"] = verify_point_source_bindings(restored)\n\n"
PORTABLE_ANCHOR = "        # Directory rename is final publication; the staging directory is owned."


def compose_portable(text):
    if text.count(PORTABLE_BLOCK) == 1:
        return text
    if "verify_point_source_bindings" in text or text.count(PORTABLE_ANCHOR) != 1:
        raise ValueError("Merge the maintained portable point-source receiving seam")
    return text.replace(PORTABLE_ANCHOR, PORTABLE_BLOCK + PORTABLE_ANCHOR, 1)


def sha(body):
    return hashlib.sha256(body).hexdigest()


def encode(value):
    return (json.dumps(value, indent=2, sort_keys=True, allow_nan=False) + "\n").encode()


def atomic(path, body):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".point-source-context-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(body)
            stream.flush()
            os.fsync(stream.fileno())
        if path.exists():
            os.chmod(temporary, path.stat().st_mode & 0o777)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def install(application, source_root):
    root, source = Path(application).resolve(strict=True), Path(source_root).resolve(strict=True)
    for name in ("operator/extension_registry.py", "model/observation_support.py",
                 "source/observation_source_calendar.py", "model/portable.py"):
        if not (root / name).is_file():
            raise ValueError("Install the maintained registered operator and observation support 1.1: " + name)
    observations = (root / "model/observations.py").read_text()
    if "observation_support.attributes" not in observations:
        raise ValueError("The maintained observation ingester needs the physical-support integration")
    state = root / "operator/installed/point-source-context"
    state.mkdir(parents=True, exist_ok=True)
    with (state / "lock").open("a") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        current_path, pending_path = state / "current.json", state / "pending.json"
        current = json.loads(current_path.read_text()) if current_path.exists() else {}
        pending = json.loads(pending_path.read_text()) if pending_path.exists() else {}
        candidates = {name: (source / name).read_bytes() for name in FILES}
        candidates["model/portable.py"] = compose_portable((root / "model/portable.py").read_text()).encode()
        originals = {}
        for name, body in candidates.items():
            if name.endswith(".py"):
                ast.parse(body.decode(), filename=name)
            if name.endswith(".json"):
                descriptor = json.loads(body)
                if descriptor.get("id") != "point-source-context":
                    raise ValueError("The point-source extension identity differs")
            path = root / name
            path.resolve().relative_to(root)
            if path.is_symlink():
                raise ValueError("Use regular retained component files: " + name)
            old = path.read_bytes() if path.exists() else None
            originals[name] = old
            if name in FILES and old is not None and old != body:
                known = {receipt.get("files", {}).get(name, {}).get("sha256") for receipt in (current, pending)}
                known.update(KNOWN_RELEASES.get(name, []))
                # Exact authored lock repair previously composed by the source-context component.
                if name == "operator/install_point_source_context.py":
                    known.add("a2e4036495ece4eb2ff5fded71543fe099b2e4f07cbd826e9e92a3dabd2783e3")
                if sha(old) not in known:
                    raise ValueError("An independently edited point-source component needs a source merge: " + name)
        target = {name: {"sha256": sha(body), "bytes": len(body)} for name, body in candidates.items()}
        if current.get("files") == target and all(originals[name] == body for name, body in candidates.items()):
            return current
        for old in originals.values():
            if old is not None:
                path = state / "preimages" / sha(old)
                if path.exists() and path.read_bytes() != old:
                    raise ValueError("A retained component preimage differs")
                if not path.exists():
                    atomic(path, old)
        receipt = {"schema": "upstate.point-source-context-install/v1", "version": "1.1.0", "files": target}
        atomic(pending_path, encode(receipt))
        # The extension descriptor is installed last, after its native/provider/browser files.
        order = [name for name in candidates if name != "operator/extensions/point-source-context.json"]
        order.append("operator/extensions/point-source-context.json")
        for name in order:
            path, body = root / name, candidates[name]
            if (path.read_bytes() if path.exists() else None) != originals[name]:
                raise ValueError("The application changed during point-source preflight: " + name)
            if originals[name] != body:
                atomic(path, body)
        atomic(current_path, encode(receipt))
        return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", required=True)
    parser.add_argument("--source-root", default=str(Path(__file__).resolve().parents[1]))
    args = parser.parse_args()
    print(json.dumps(install(args.application, args.source_root), sort_keys=True))


if __name__ == "__main__":
    main()
