"""Pure admission for the original Grant managed source inventory."""
from __future__ import annotations
import ast
import json
import re

SCHEMA = "stellar-forge.managed-source-manifest.v1"
BASE_PATH = "stellar/scf_2026/sf47_budget_model/workspace"
MANIFEST_NAME = "managed-source.json"
MAXIMUM = 1024 * 1024


def manifest_files(value):
    valid = (isinstance(value, dict) and set(value) == {"schema", "basePath", "files"} and
             value["schema"] == SCHEMA and value["basePath"] == BASE_PATH and
             isinstance(value["files"], list) and 0 < len(value["files"]) <= 4096)
    if not valid:
        raise ValueError("Select the complete managed source inventory.")
    names, resolved = [], set()
    for name in value["files"]:
        if (not isinstance(name, str) or not 0 < len(name) <= 1024 or
                not re.fullmatch(r"[A-Za-z0-9._/-]+", name)):
            raise ValueError("Select an explicit managed source filename.")
        root, file_started = BASE_PATH.split("/"), False
        for part in name.split("/"):
            if not part or part == ".":
                raise ValueError("Managed source paths must be normalized.")
            if part == "..":
                if file_started or not root:
                    raise ValueError("Managed source leaves its selected repository.")
                root.pop()
            else:
                file_started = True
                root.append(part)
        path = "/".join(root)
        if not file_started or path in resolved:
            raise ValueError("Select each explicit managed source once.")
        names.append(name)
        resolved.add(path)
    if MANIFEST_NAME not in names:
        raise ValueError("The inventory must retain its own manifest.")
    return names


def manifest_selector(source, read_manifest):
    """Read a new selector without importing or executing the selected application."""
    module = ast.parse(source)
    for key, expected in (("SOURCE_MANIFEST", MANIFEST_NAME), ("SOURCE_BASE_PATH", BASE_PATH)):
        values = [node.value for node in module.body if isinstance(node, ast.Assign)
                  and any(isinstance(target, ast.Name) and target.id == key for target in node.targets)]
        if len(values) != 1 or ast.literal_eval(values[0]) != expected:
            raise ValueError("Use the original explicit managed manifest selector.")
    raw = read_manifest()
    if not isinstance(raw, bytes) or len(raw) > MAXIMUM:
        raise ValueError("Select the complete bounded managed source manifest.")
    return manifest_files(json.loads(raw.decode("utf-8"))), raw
