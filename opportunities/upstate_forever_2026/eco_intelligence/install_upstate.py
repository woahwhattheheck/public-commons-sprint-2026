"""Install the complete original-workspace Investigations package and archive source."""
from __future__ import annotations
import argparse
import ast
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import tempfile

ORIGINAL = {
  "eco_intelligence/__init__.py": "e5b69de4261a189ea94a501588d78ea9ef57f05ff18c22038dfc8d77a3266a08",
  "eco_intelligence/__main__.py": "a5c321a0e8317c090112a5281d78150656045fdb6b0f7caf9347990d9e615d13",
  "eco_intelligence/adapters.py": "58eec1c5db44ee0c24010d2198416434f62c7a0e752cb343ee45fe4a8cde0c00",
  "eco_intelligence/api.py": "41dfd8db2578b0ae4c46d464a9b23b3cc5a04fe8823e60b86e841aad7845bf30",
  "eco_intelligence/common.py": "83f5b129599a119d0cd5e8bf5f0ece3b7f4251410c6b5177da80cecb8438ed64",
  "eco_intelligence/engine.py": "1a122793466468dd40447f5ea131a1a3ea47c39e83dfc05ca25aa02bda236ecf",
  "eco_intelligence/profiling.py": "b84d9f712b7a0adbf7e43607092d0a6de1fce52f1d4f3b07455947c52c36b725",
  "eco_intelligence/provider.py": "afde356a4dc525bc813e39bdfccd0826c307bee0d4c9f6f4a7e8c3c22cfc458a",
  "eco_intelligence/repository.py": "f6040715c1553074e8057ee5800e83378d6959302e27b21a7cf90b02b0bcd3d5",
  "eco_intelligence/schemas.py": "5055ac77e0b664ec7aac346d117a6f2e2490cead056e6836d87d228abf50fbcc",
  "eco_intelligence/static/app.js": "d692efa4dd38d4c14acd56c4003e1e055190253e4fa44a4984cd05f19bad2f30",
  "eco_intelligence/static/index.html": "1565864f2611c1a42b2049d5839d44daa13efceb7cd087c44147549e03122a60",
  "eco_intelligence/static/style.css": "07c3c32ba5dc2eea2aed8af46c518281163ad0d1055e490812c9e8a1059b219b",
  "eco_intelligence/store.py": "6fa57bbd062322ef44f1266013f17843786c58328a09ba73fb569f8f8027eb4d"
}
PREVIOUS_BINDING = {
  "eco_intelligence/UPSTATE_BINDING.md": "937984f954a905cc3d8d9d7b2a1ab816726737d8c9c3ec07de36f3179c9c9b23",
  "eco_intelligence/__init__.py": "ae86d24ceb946b606d9b6a0f76a6046ebf58389d3a2b8292c42ca686d25b4b2d",
  "eco_intelligence/__main__.py": "a5c321a0e8317c090112a5281d78150656045fdb6b0f7caf9347990d9e615d13",
  "eco_intelligence/adapters.py": "58eec1c5db44ee0c24010d2198416434f62c7a0e752cb343ee45fe4a8cde0c00",
  "eco_intelligence/api.py": "67d43dbe8d8b9651d6191515618ea714a5659b28b50c8417a81ec7b5720164cc",
  "eco_intelligence/common.py": "83f5b129599a119d0cd5e8bf5f0ece3b7f4251410c6b5177da80cecb8438ed64",
  "eco_intelligence/engine.py": "1a122793466468dd40447f5ea131a1a3ea47c39e83dfc05ca25aa02bda236ecf",
  "eco_intelligence/install_upstate.py": "cdf296e5216f0d211fedc0c0f79468ac56e4574037de721aa261b60550dee50c",
  "eco_intelligence/profiling.py": "b84d9f712b7a0adbf7e43607092d0a6de1fce52f1d4f3b07455947c52c36b725",
  "eco_intelligence/provider.py": "afde356a4dc525bc813e39bdfccd0826c307bee0d4c9f6f4a7e8c3c22cfc458a",
  "eco_intelligence/report.py": "c8345fa252d19af3485d8a931e84a8abd8bed8fc27fcd157bef7cf3acec57f53",
  "eco_intelligence/repository.py": "f6040715c1553074e8057ee5800e83378d6959302e27b21a7cf90b02b0bcd3d5",
  "eco_intelligence/schemas.py": "5055ac77e0b664ec7aac346d117a6f2e2490cead056e6836d87d228abf50fbcc",
  "eco_intelligence/static/app.js": "d692efa4dd38d4c14acd56c4003e1e055190253e4fa44a4984cd05f19bad2f30",
  "eco_intelligence/static/index.html": "1565864f2611c1a42b2049d5839d44daa13efceb7cd087c44147549e03122a60",
  "eco_intelligence/static/style.css": "07c3c32ba5dc2eea2aed8af46c518281163ad0d1055e490812c9e8a1059b219b",
  "eco_intelligence/store.py": "6fa57bbd062322ef44f1266013f17843786c58328a09ba73fb569f8f8027eb4d",
  "eco_intelligence/upstate.py": "5f7c7e4a580e7161b923508735858e93c6762a91786d955dab36e78bcb4b25cf"
}
KNOWN_CORRECTION_PREIMAGES = {
    "eco_intelligence/UPSTATE_BINDING.md": {"62d645fe9f3df23ed4ceba455c4f880eb2242859fb3bed08bcbdb3377f033bda"},
    "eco_intelligence/schemas.py": {"ed96a65f34eb9fe579f4fe190c1dfeb4663d2bfa328f0a25dc9e458422364317"},
    "eco_intelligence/install_upstate.py": {"9ceb6c85004fd8dc961fc6f3801bd221d3a12cfa5b3c35f02f583ec68f3d448f",
        "966fc37537d4a61053ef1e87150d3bcb3b8ed11d78914fa6671652e278126b73"},
    "eco_intelligence/upstate_experiments.py": {"a8edb0b5ae972cc16b6d3f94ca98f5cf36cf09fef315e1593119699730c8e718"},
}
MARKER = "# E258 complete Investigations application source"

def sha(body):
    return hashlib.sha256(body).hexdigest()

def read(path):
    if path.is_symlink():
        raise ValueError("Source publication requires a regular original path: " + str(path))
    return path.read_bytes() if path.exists() else None

def publish(path, body):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=".intelligence-source-", dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(fd, "wb") as output:
            output.write(body)
            output.flush()
            os.fsync(output.fileno())
        os.chmod(temporary, path.stat().st_mode & 0o777 if path.exists() else 0o644)
        os.replace(temporary, path)
        fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    finally:
        temporary.unlink(missing_ok=True)

def install(application, source_root):
    application = Path(application).resolve(strict=True)
    source_root = Path(source_root).resolve(strict=True)
    if not (application / "model" / "workspace.py").is_file():
        raise ValueError("Select the current original Upper Savannah application.")
    source_package = source_root / "eco_intelligence"
    if not (source_package / "upstate.py").is_file():
        raise ValueError("Receive the complete native binding source first.")
    with (application / ".intelligence-binding-install.lock").open("a+b") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        before, after = {}, {}
        for source in sorted(source_package.rglob("*")):
            if not source.is_file() or source.is_symlink() or "__pycache__" in source.parts or source.suffix == ".pyc":
                continue
            relative = source.relative_to(source_root).as_posix()
            incoming = source.read_bytes()
            current = read(application / relative)
            if current is not None and current != incoming:
                accepted = {ORIGINAL.get(relative), PREVIOUS_BINDING.get(relative)} | KNOWN_CORRECTION_PREIMAGES.get(relative, set())
                if sha(current) not in accepted:
                    raise ValueError("Compose the current source before replacement: " + relative)
            before[relative], after[relative] = current, incoming
        relative = "model/portable.py"
        original = read(application / relative)
        if original is None:
            raise ValueError("The original full workspace archive implementation is required.")
        text = original.decode("utf-8")
        if MARKER not in text:
            tree = ast.parse(text, filename=relative)
            assignments = [node for node in tree.body if isinstance(node, ast.Assign)
                           and any(isinstance(target, ast.Name) and target.id == "APPLICATION_DIRECTORIES"
                                   for target in node.targets)]
            if len(assignments) != 1:
                raise ValueError("Compose the current portable application source inventory.")
            lines = text.splitlines(keepends=True)
            at = assignments[0].end_lineno
            lines[at:at] = [
                MARKER + "\n",
                'APPLICATION_DIRECTORIES = tuple(dict.fromkeys((*APPLICATION_DIRECTORIES, "eco_intelligence")))\n',
            ]
            text = "".join(lines)
        before[relative], after[relative] = original, text.encode("utf-8")
        for relative, body in after.items():
            if relative.endswith(".py"):
                ast.parse(body.decode("utf-8"), filename=relative)
        changed = [path for path in after if before[path] != after[path]]
        if not changed:
            return {"state": "current", "files": [], "application": str(application)}
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
        history = application.parent / (application.name + "-source-history") / ("E258-intelligence-" + stamp)
        history.mkdir(parents=True, exist_ok=False)
        manifest = {"format": "upstate.intelligence-source-install/v1", "created_at": stamp, "files": {}}
        for relative in changed:
            old = before[relative]
            if old is not None:
                target = history / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(old)
            manifest["files"][relative] = {
                "previous_sha256": sha(old) if old is not None else None,
                "sha256": sha(after[relative]), "bytes": len(after[relative]),
            }
        (history / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        # Runtime modules are present before the complete portable source inventory.
        order = [path for path in changed if path != "model/portable.py"]
        if "model/portable.py" in changed:
            order.append("model/portable.py")
        for relative in order:
            target = application / relative
            if read(target) != before[relative]:
                raise RuntimeError("Current source changed during installation: " + relative)
            publish(target, after[relative])
        return {"state": "installed", "application": str(application), "files": order,
                "history": str(history), "source": manifest}

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", required=True, type=Path)
    parser.add_argument("--source-root", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args(argv)
    print(json.dumps(install(args.application, args.source_root), indent=2))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
