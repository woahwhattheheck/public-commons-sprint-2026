#!/usr/bin/env python3
"""Install conservation study programmes into the existing application."""
from __future__ import annotations

import argparse
import ast
import fcntl
import hashlib
import json
import os
from pathlib import Path
import runpy
import tempfile

SOURCE_FILES = {
  "model/programme_interactions.py": {
    "bytes": 32029,
    "sha256": "c5ee1b1e185bdff4ae8daeb095a677ede163050b6195b02e0a54be3f7516fe1d"
  },
  "docs/programme-interactions.md": {
    "bytes": 9238,
    "sha256": "49eec1695330380f6f8da551b3d41f225142a6ebb704bde9863d4be9ce1d4950"
  },
  "model/compute_programme.py": {
    "bytes": 95604,
    "sha256": "dc102a0ff059c2e004d33cb5a45ff358d2e91bc3a55a7db33ac99afd2c012b13"
  },
  "model/compute_programme_cli.py": {
    "bytes": 8954,
    "sha256": "8e35bffa0669f80a24aeafeb34a166c0d53e436b0a49efa2196345e489932730"
  },
  "model/portable.py": {
    "bytes": 49628,
    "sha256": "2e46470a7f0096446a396c96f3ae1e6b26b57228c71da94b9fc6c3cffd3fbb3f"
  },
  "operator/programmes.py": {
    "bytes": 13262,
    "sha256": "e203c6fd581f2bd0c26fdbee47c951f6e270911ee1890e8bebd6748639755993"
  },
  "operator/web/programmes.mjs": {
    "bytes": 78664,
    "sha256": "b4166ab4d763dc0df5dde77f3164f369b80779104cd260752388cfa8c148bd32"
  },
  "install_programmes.py": {
    "bytes": 23802,
    "sha256": "b6e086094c3246dc0d88bd8fac2ba643b92e64213e252c6d1ce14c0cbd47d99d"
  },
  "operator/web/native-interactions.mjs": {
    "bytes": 39769,
    "sha256": "15a086bfc42ed700ea986878d416bde923a015e52447b4c3168945d18520275b"
  },
  "PROGRAMME_INTERACTIONS.md": {
    "bytes": 5896,
    "sha256": "839b42c94778e88a8f1d7124ce73a4b98f1a0d6a3810e81a33b2c4b76d17f736"
  }
}
PREDECESSORS = {
  "model/compute_programme.py": [
    "5df48145fc5b05a4a2468fe938c2eddd5c4bd508c6407e6e95cd3cc616969f37",
    "7bfaac9fd416a503441038a4716db4b75d2cf8c71db88c4417055c2c686ae4a1",
    "1b01e49baeb0463b7dd194a39979b81bc47785c735c63cefea71c2a5d699753e"
  ],
  "model/compute_programme_cli.py": [
    "634894886f680f1762a7885bf6de9233edad4d15a2159bcdd41506e8698f0f29",
    "8e35bffa0669f80a24aeafeb34a166c0d53e436b0a49efa2196345e489932730"
  ],
  "model/portable.py": [
    "60e424da2ba8b395b7e5c2df2da8309e206f628f0cd95b95aa009347fee48386",
    "27cd6f5c16d9c8b81b3d5ead461ea9f6ed5f11e2ec22a81222deed4a248b2ea5"
  ],
  "operator/programmes.py": [
    "431a783614df0b72d3c25a3896f520ed69fbd421c172046d2a6b0b2480ccd94e",
    "e203c6fd581f2bd0c26fdbee47c951f6e270911ee1890e8bebd6748639755993"
  ],
  "operator/web/programmes.mjs": [
    "14b71fd70d0050c9968b9a025287c65d7240146aae8c085817762c79f4d40f8b",
    "b4166ab4d763dc0df5dde77f3164f369b80779104cd260752388cfa8c148bd32"
  ],
  "install_programmes.py": [
    "d8348ad65bbd0cb08327af500b668fbb8072882c7d1d32863738df42b2ca2093",
    "3c23eb8407888398fbb95370a2671d924817b7ed54223565c107244698a28b3e",
    "8ddac4633d080a775ac6dd99136fd7e04ba52b6c9ad9e1aac9e58ce9ef4f30fb"
  ],
  "operator/web/native-interactions.mjs": [
    "9cb6c436ed7e0cf6cb39887f894374beab65bc387e0960ec45c1a6f05c427825",
    "15a086bfc42ed700ea986878d416bde923a015e52447b4c3168945d18520275b"
  ],
  "model/programme_interactions.py": [
    "8acaff9a620242ae17cc4d06756efa14256198aa28cb7470911e10fc92063a3a"
  ],
  "docs/programme-interactions.md": [
    "41fb0118f7817ba5d5606a13fbf9a1eddff85b51abcb4b65a304f8158de34783"
  ],
  "PROGRAMME_INTERACTIONS.md": [
    "da317b0e2fc761d78ab7fe4d0a96371de93612f5ed041da9d054c6d20aa709d4"
  ]
}
COMPOSED_FILES = {
  "model/portable.py": [
    {
      "path": "model/portable.py",
      "old": "            for path in sorted((root / \"experiments\").glob(\"*/.experiment.lock\")):",
      "new": "            for pattern in (\"compute-programmes/*/.programme.lock\",\n                            \"interactions/*/.interaction.lock\",\n                            \"interaction-results/*/.analysis.lock\"):\n                for path in sorted(root.glob(pattern)):\n                    stack.enter_context(held(path, blocking=False))\n            for path in sorted((root / \"experiments\").glob(\"*/.experiment.lock\")):",
      "retained_block": "            for pattern in (\"compute-programmes/*/.programme.lock\",\n                            \"interactions/*/.interaction.lock\",\n                            \"interaction-results/*/.analysis.lock\"):\n                for path in sorted(root.glob(pattern)):\n                    stack.enter_context(held(path, blocking=False))\n"
    },
    {
      "path": "model/portable.py",
      "old": "        # Directory rename is final publication; the staging directory is owned.",
      "new": "        if any((restored.root / \"compute-programmes\").glob(\"*/interaction-links/*.json\")):\n            from .programme_interactions import validate_workspace as validate_programme_interactions\n            validate_programme_interactions(restored, verified_members=manifest[\"members\"])\n        # Directory rename is final publication; the staging directory is owned.",
      "retained_block": "        if any((restored.root / \"compute-programmes\").glob(\"*/interaction-links/*.json\")):\n            from .programme_interactions import validate_workspace as validate_programme_interactions\n            validate_programme_interactions(restored, verified_members=manifest[\"members\"])\n"
    }
  ]
}

def sha(value):
    return hashlib.sha256(value).hexdigest()

def compose(text, patches, name):
    for patch in patches:
        retained = patch["retained_block"]
        if retained and text.count(retained) == 1:
            continue
        if text.count(patch["old"]) != 1:
            raise ValueError("Compose the current retained shared source: " + name)
        text = text.replace(patch["old"], patch["new"], 1)
    return text

def install(application, source_root, *, dry_run=False):
    root = Path(application).resolve(strict=True)
    source = Path(source_root).resolve(strict=True)
    for name in ("model/workspace.py", "model/compute_programme.py",
                 "model/native_interactions.py", "model/interaction_dispatch.py",
                 "model/native_versions.py",
                 "operator/server.py", "operator/web/app.mjs"):
        if not (root / name).is_file():
            raise ValueError("Receive the complete application and conservation combinations 1.3 first: " + name)
    locks = root / ".locks"
    locks.mkdir(exist_ok=True)
    with (locks / "programme-install.lock").open("a+") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        pending, original = {}, {}
        for name, expected in SOURCE_FILES.items():
            target, incoming = root / name, source / name
            if not target.resolve().is_relative_to(root) or not incoming.resolve().is_relative_to(source):
                raise ValueError("Source or target leaves its selected application: " + name)
            data = incoming.read_bytes()
            before = target.read_bytes() if target.exists() else None
            shared = COMPOSED_FILES.get(name)
            # A cumulative application may already contain later maintained joins.
            # Its shared source is composed in place through exact retained blocks.
            if not (source == root and shared):
                if len(data) != expected["bytes"] or sha(data) != expected["sha256"]:
                    raise ValueError("Complete source differs from this installer edition: " + name)
            if shared:
                if before is None:
                    raise ValueError("Receive the complete shared source first: " + name)
                data = compose(before.decode("utf-8"), shared, name).encode("utf-8")
            elif before is not None and before != data and sha(before) not in PREDECESSORS.get(name, []):
                raise ValueError("Compose this change with the current retained source: " + name)
            if name.endswith(".py"):
                ast.parse(data.decode("utf-8"), filename=name)
            original[name], pending[name] = before, data
        # Use the maintained programme installer for its current shared joins.
        provider = runpy.run_path(str(source / "install_programmes.py"))
        for name, operation in (
                ("operator/server.py", provider["patch_server"]),
                ("operator/web/app.mjs", provider["patch_app"]),
                ("operator/web/index.html", provider["patch_index"])):
            path = root / name
            if not path.resolve().is_relative_to(root):
                raise ValueError("Shared source leaves the selected application: " + name)
            before = path.read_bytes()
            original[name] = before
            pending[name] = operation(before.decode("utf-8")).encode("utf-8")
        changed = [name for name, value in pending.items() if value != original[name]]
        receipt = {
            "schema": "upstate.programme-interactions-install/v1",
            "application": str(root), "source_root": str(source),
            "dry_run": dry_run, "changed": changed,
            "files": [{"path": name, "bytes": len(data), "sha256": sha(data),
                       "previous_sha256": sha(original[name]) if original[name] is not None else None}
                      for name, data in sorted(pending.items())],
            "opening_route": "/#programmes",
        }
        if dry_run:
            return receipt
        with tempfile.TemporaryDirectory(prefix=".upstate-programme-interactions-", dir=root.parent) as temporary:
            staging = Path(temporary)
            for name in changed:
                path = staging / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(pending[name])
                existing = root / name
                os.chmod(path, existing.stat().st_mode & 0o777 if existing.exists() else 0o644)
            for name in changed:
                target = root / name
                if (target.read_bytes() if target.exists() else None) != original[name]:
                    raise RuntimeError("Concurrent source change preserved at " + name + "; compose against its current bytes.")
            for name in changed:
                target = root / name
                if (target.read_bytes() if target.exists() else None) != original[name]:
                    raise RuntimeError("Concurrent source change preserved at " + name + "; rerun against the retained edition.")
                target.parent.mkdir(parents=True, exist_ok=True)
                os.replace(staging / name, target)
        return receipt

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", required=True)
    parser.add_argument("--source-root", default=str(Path(__file__).resolve().parent))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    print(json.dumps(install(args.application, args.source_root, dry_run=args.dry_run),
                     indent=2, sort_keys=True))

if __name__ == "__main__":
    main()
