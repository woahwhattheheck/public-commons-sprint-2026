"""Apply dependency startup while preserving unrelated current ECSA source."""
from __future__ import annotations
import argparse
import ast
import hashlib
import os
from pathlib import Path
import tempfile

APPROVED_METHOD_SHA256 = frozenset((
    "edfa3e7c0dec1bba1f4ffb5fc2ae58b00e735f596273b1e9ab5b59665223d970",
    "404dbe280ef2ffd787fcc0cde9e06a7ed6ac634b72467d6de2fcb0aaac2b52bf",
    "8e6c81c1851ebc2827816f25af3b6a7c944a25900a16e7137fd3bbef6cd4316c",
    "e8536cc1a489fcd27213bf7a5e55562b358ee07f1d5d3180375879272f278780",
))
REPLACEMENT = "    def load(self):\n        \"\"\"Compose installed providers by their declared action dependencies.\n\n        File names control neither provider availability nor load success. A\n        failed or cyclic dependency is attached to its actual component while\n        all independently usable desks continue to register.\n        \"\"\"\n        # Rebuild registration diagnostics from this installed-manifest pass.\n        # Runtime task/state issues and every active provider stay untouched.\n        for key in tuple(self._issues):\n            if key[1] == \"registration\":\n                self._issues.pop(key, None)\n        if not self.directory.is_dir():\n            return self\n        candidates = []\n        identity_paths = {}\n        for path in sorted(self.directory.glob(\"*.json\")):\n            recognized_identity = None\n            try:\n                manifest = json.loads(path.read_text(encoding=\"utf-8\"))\n                if not isinstance(manifest, dict) or manifest.get(\"schema\") != SCHEMA:\n                    raise ValueError(\"Unsupported extension manifest schema.\")\n                extension_id = manifest.get(\"id\")\n                if not isinstance(extension_id, str) or not _IDENTIFIER.fullmatch(extension_id):\n                    raise ValueError(\"An extension needs a stable lowercase id.\")\n                recognized_identity = extension_id\n                identity_paths.setdefault(extension_id, []).append(path.name)\n                required = manifest.get(\"requires_actions\", [])\n                backend = manifest.get(\"backend\") or {}\n                if not isinstance(backend, dict):\n                    raise ValueError(\"The extension backend must be an object.\")\n                declared = backend.get(\"actions\", [])\n                for names, label in ((required, \"Required actions\"), (declared, \"Actions\")):\n                    if (not isinstance(names, list)\n                            or any(not isinstance(name, str) or not name for name in names)\n                            or len(set(names)) != len(names)):\n                        raise ValueError(label + \" must be a list of unique nonempty names.\")\n                order = manifest.get(\"order\", 100)\n                if isinstance(order, bool) or not isinstance(order, (int, float)) or not math.isfinite(order):\n                    raise ValueError(\"Extension order must be a finite number.\")\n                candidates.append({\n                    \"id\": extension_id, \"manifest\": manifest, \"path\": path.name,\n                    \"required\": set(required), \"declared\": set(declared), \"order\": order,\n                })\n            except Exception as error:\n                key = recognized_identity or \"file:\" + path.name\n                self._issue(key, \"registration\", error)\n\n        for extension_id, paths in identity_paths.items():\n            if len(paths) > 1:\n                self._issue(extension_id, \"registration\", ValueError(\n                    \"Duplicate installed extension id in: \" + \", \".join(paths)))\n        pending = []\n        for row in candidates:\n            if len(identity_paths[row[\"id\"]]) > 1:\n                continue\n            if row[\"id\"] in self._extensions:\n                installed = self._extensions[row[\"id\"]][\"manifest\"]\n                if installed == row[\"manifest\"]:\n                    self._clear_issue(row[\"id\"], \"registration\")\n                else:\n                    self._issue(row[\"id\"], \"registration\", ValueError(\n                        \"This installed extension changed after startup; reopen the operator to load its new source.\"))\n            else:\n                pending.append(row)\n\n        pending.sort(key=lambda row: (row[\"order\"], row[\"id\"], row[\"path\"]))\n        while pending:\n            progressed = False\n            deferred = []\n            for row in pending:\n                available = self._builtin_actions | self._actions.keys() | row[\"declared\"]\n                if row[\"required\"] - available:\n                    deferred.append(row)\n                    continue\n                try:\n                    self.register(row[\"manifest\"])\n                    self._clear_issue(row[\"id\"], \"registration\")\n                except Exception as error:\n                    self._issue(row[\"id\"], \"registration\", error)\n                progressed = True\n            if not deferred:\n                break\n            if progressed:\n                pending = deferred\n                continue\n            providers = {}\n            for row in deferred:\n                for action in row[\"declared\"]:\n                    providers.setdefault(action, []).append(row[\"id\"])\n            for row in deferred:\n                missing = sorted(row[\"required\"] - (\n                    self._builtin_actions | self._actions.keys() | row[\"declared\"]))\n                details = []\n                for action in missing:\n                    waiting = providers.get(action, [])\n                    suffix = \" (waiting on \" + \", \".join(sorted(waiting)) + \")\" if waiting else \"\"\n                    details.append(action + suffix)\n                self._issue(row[\"id\"], \"registration\", ValueError(\n                    \"Required actions remain unavailable after loading installed providers: \"\n                    + \", \".join(details)\n                    + \". Check the named provider's registration result or its dependency cycle.\"))\n            break\n        return self\n\n"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def compose(source):
    """Replace only the uniquely identified, approved registry load method."""
    module = ast.parse(source)
    classes = [node for node in module.body
               if isinstance(node, ast.ClassDef) and node.name == "ExtensionRegistry"]
    if len(classes) != 1:
        raise ValueError("The installed registry class differs or is ambiguous.")
    methods = [node for node in classes[0].body
               if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
               and node.name == "load"]
    if len(methods) != 1 or methods[0].decorator_list:
        raise ValueError("The current registry load method differs or is ambiguous.")
    node = methods[0]
    lines = source.splitlines(keepends=True)
    start, end = node.lineno - 1, node.end_lineno
    while end < len(lines) and not lines[end].strip():
        end += 1
    current = "".join(lines[start:end])
    if current == REPLACEMENT:
        return source
    if sha(current.encode("utf-8")) not in APPROVED_METHOD_SHA256:
        raise ValueError("The current registry load method differs. Compose that actual method before applying; all source is preserved.")
    return "".join(lines[:start]) + REPLACEMENT + "".join(lines[end:])


def apply(application):
    path = Path(application).resolve() / "operator" / "extension_registry.py"
    if path.is_symlink() or not path.is_file():
        raise ValueError("Choose the current installed registry as a regular source file.")
    before = path.read_bytes()
    after = compose(before.decode("utf-8")).encode("utf-8")
    if after == before:
        return {"path": str(path), "state": "already-applied", "sha256": sha(before)}
    compile(after, str(path), "exec")
    backup = path.with_name(path.name + ".before-es9960-" + sha(before)[:16])
    try:
        with backup.open("xb") as stream:
            stream.write(before)
            stream.flush()
            os.fsync(stream.fileno())
    except FileExistsError:
        if backup.is_symlink() or backup.read_bytes() != before:
            raise ValueError("The preserved original source differs from this application revision.")
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".es9960-", delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(after)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, path.stat().st_mode & 0o777)
        if path.read_bytes() != before:
            raise ValueError("The registry changed during integration; retain the newer source and compose again.")
        os.replace(temporary, path)
        temporary = None
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return {"path": str(path), "state": "applied", "before_sha256": sha(before),
            "sha256": sha(after), "original": str(backup)}


def main():
    import json
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("application")
    args = parser.parse_args()
    print(json.dumps(apply(args.application), indent=2))


if __name__ == "__main__":
    main()
