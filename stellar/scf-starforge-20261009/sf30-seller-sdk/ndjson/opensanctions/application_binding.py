"""MIT. OpenSanctions application identity over the original NDJSON binding."""
from __future__ import annotations
import importlib.util
import os
from pathlib import Path

from model import NDJSON, SCHEMA as DOMAIN_SCHEMA, InputError, json_bytes
import managed as original_managed

if Path(original_managed.__file__).resolve() != NDJSON / "managed.py":
    raise InputError("The original NDJSON managed identity module was not selected")

BINDING = "stellar-forge.opensanctions-managed-binding.v1"
STARTUP = "stellar-forge.opensanctions-workspace-launch.v1"
SOURCE_FILES = (
    "model.py", "updates.py", "matching.py", "web.py", "cli.py",
    "application_binding.py", "cli.mjs", "managed.mjs", "application-provider.mjs",
    "public/index.html", "public/app.js", "public/style.css", "SOURCE_CONTRACT.json",
)

# Reuse the native private connection-file context, including its exact-file
# cleanup. Its CLI is imported under a distinct name and its main is never run.
spec = importlib.util.spec_from_file_location("_opensanctions_original_ndjson_cli", NDJSON / "cli.py")
original_cli = importlib.util.module_from_spec(spec)
spec.loader.exec_module(original_cli)
published_connection = original_cli.published_connection


def inspect_binding(directory):
    """Inspect the existing native identity without opening its SQLite writer."""
    native = original_managed.inspect_binding(directory)
    source = dict(native["source"])
    for name in SOURCE_FILES:
        source["ndjson/opensanctions/" + name] = original_managed.source_digest(
            NDJSON / "opensanctions" / name)
    value = {
        key: item for key, item in native.items() if key != "sha256"
    } | {
        "schema": BINDING, "domainSchema": DOMAIN_SCHEMA,
        "nativeBindingSha256": native["sha256"], "source": source,
    }
    bound = {key: item for key, item in value.items() if key != "sourceRoot"}
    return value | {"sha256": original_managed.digest(json_bytes(bound))}


def require_binding(directory, expected):
    value = inspect_binding(directory)
    if expected is not None and (
            not isinstance(expected, str) or len(expected) != 64
            or any(char not in "0123456789abcdef" for char in expected)
            or value["sha256"] != expected):
        raise InputError("The selected source-monitoring workspace, Python or source changed; review the original application again")
    return value


def startup(server, binding, connection_file=None):
    return {
        "schema": STARTUP, "status": "OPENSANCTIONS_WORKSPACE_READY",
        "domainSchema": DOMAIN_SCHEMA,
        "workspace": binding["workspace"], "bindingSha256": binding["sha256"],
        "nativeBindingSha256": binding["nativeBindingSha256"],
        "sourceRoot": binding["sourceRoot"], "python": binding["python"],
        "pid": os.getpid(), "console": server.url,
        **({"connectionFile": connection_file} if connection_file is not None else {}),
    }
