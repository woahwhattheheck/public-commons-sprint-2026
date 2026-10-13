"""Complete source/configuration/client-operation intake and reviewed editions."""
from __future__ import annotations
import json
from pathlib import Path
import re

from .util import environment_name, identity, json_text, owned_path, parse_configuration, relative_name, require
from .workspace import SOURCE_PIN, durable_file, now, sha

EDITION_FORMAT = "hive-desk-edition/v1"
OPERATIONS_FORMAT = "hive-desk-operations/v1"
SOURCE_BASE = "https://github.com/graphql-hive/router/blob/" + SOURCE_PIN + "/bin/router/src/config/"
FEATURE_SOURCES = {
    "http": "http_server.rs", "supergraph": "supergraph.rs", "headers": "headers.rs",
    "jwt": "jwt_auth.rs", "authorization": "authorization.rs",
    "persisted_documents": "persisted_documents.rs", "subscriptions": "subscriptions.rs",
    "coprocessor": "coprocessor.rs", "telemetry": "telemetry.rs",
    "traffic_shaping": "traffic_shaping.rs", "limits": "limits.rs",
    "cors": "cors.rs", "csrf": "csrf.rs", "override_subgraph_urls": "override_subgraph_urls.rs",
    "query_planner": "query_planner.rs", "demand_control": "demand_control.rs",
    "error_masking": "error_masking.rs", "cache": "cache.rs", "plugins": "mod.rs",
}

def validate_operations(value):
    require(isinstance(value, dict) and value.get("schema") == OPERATIONS_FORMAT,
            "Select the complete hive-desk-operations/v1 programme.")
    rows = value.get("operations")
    require(isinstance(rows, list) and rows, "The client programme needs its complete selected operations.")
    ids = []
    for item in rows:
        require(isinstance(item, dict), "Each operation must be an object.")
        op_id = item.get("id")
        require(isinstance(op_id, str) and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*", op_id),
                "Each operation needs a stable plain id.")
        ids.append(op_id)
        method = item.get("method", "POST")
        require(method in {"GET", "POST"}, "Use the original HTTP GET or POST operation.")
        path = item.get("path", "/graphql")
        require(isinstance(path, str) and path.startswith("/") and not path.startswith("//")
                and "\r" not in path and "\n" not in path and "#" not in path,
                "Operation path must remain on its selected router.")
        if method == "POST":
            require(isinstance(item.get("body"), (dict, list)), "Retain the complete original GraphQL JSON body.")
        for key in ("headers", "header_env"):
            require(isinstance(item.get(key, {}), dict), "Operation headers must be an object.")
        for name, val in item.get("headers", {}).items():
            require(isinstance(name, str) and re.fullmatch(r"[!#$%&'*+.^_`|~0-9A-Za-z-]+", name)
                    and isinstance(val, str) and "\r" not in val and "\n" not in val, "Invalid public HTTP header.")
            require(name.lower() not in {"authorization", "cookie", "proxy-authorization"},
                    "Select the existing private header through header_env.")
        for name, variable in item.get("header_env", {}).items():
            require(isinstance(name, str) and re.fullmatch(r"[!#$%&'*+.^_`|~0-9A-Za-z-]+", name),
                    "Invalid HTTP header name.")
            environment_name(variable)
        timeout = item.get("timeout_seconds", value.get("timeout_seconds", 120))
        require(isinstance(timeout, (int, float)) and timeout > 0, "Operation timeout must be positive.")
    require(len(ids) == len(set(ids)), "Client operation ids must be unique within the complete programme.")
    return value

def load_edition(workspace, edition_id):
    item = workspace.get("edition", edition_id)
    require(item, "Open an imported edition.")
    return item

def edition_bytes(workspace, edition, name):
    files = {entry["path"]: entry for entry in edition["data"]["files"]}
    require(name in files, "Selected edition file does not exist: " + name)
    return workspace.object_bytes(files[name]["sha256"])

def edition_operations(workspace, edition):
    return validate_operations(json.loads(edition_bytes(workspace, edition, edition["data"]["manifest"]["operations_file"])))

def configuration_review(config):
    rows = []
    for name in sorted(config):
        rows.append({"feature": name, "value": config[name],
                     "source": SOURCE_BASE + FEATURE_SOURCES.get(name, "mod.rs")})
    return rows

def import_edition(workspace, directory, name=None):
    root = Path(directory).resolve()
    require(root.is_dir(), "Select the complete original edition directory.")
    manifest_path = owned_path(root, "edition.json")
    original = manifest_path.read_bytes()
    manifest = json.loads(original)
    require(manifest.get("schema") == EDITION_FORMAT, "Select an edition.json using hive-desk-edition/v1.")
    for key in ("config_file", "supergraph_file", "operations_file"):
        relative_name(manifest.get(key))
    declared = manifest.get("files")
    if declared is None:
        declared = []
        for path in sorted(root.rglob("*")):
            require(not path.is_symlink(), "Edition intake retains ordinary original files; resolve the selected symlink explicitly.")
            if path.is_file():
                declared.append(path.relative_to(root).as_posix())
    require(isinstance(declared, list) and declared and len(declared) == len(set(declared)),
            "Edition file inventory must contain all selected original files exactly once.")
    declared = sorted(set(declared) | {"edition.json"})
    for key in ("config_file", "supergraph_file", "operations_file"):
        require(manifest[key] in declared, "Add the selected " + key + " to the complete file inventory.")
    config = parse_configuration(owned_path(root, manifest["config_file"]).read_text("utf-8"), manifest["config_file"])
    operations = validate_operations(json.loads(owned_path(root, manifest["operations_file"]).read_bytes()))
    files = []
    for member in declared:
        path = owned_path(root, member)
        require(path.is_file(), "Original edition file is missing: " + member)
        files.append({"path": member, "mode": path.stat().st_mode & 0o777, **workspace.put_file(path)})
    edition_id = sha(json_text(files).encode("utf-8"))
    existing = workspace.get("edition", edition_id)
    if existing:
        return existing
    body = {"name": name or manifest.get("name") or root.name, "manifest": manifest, "files": files,
            "importedAt": now(), "sourcePin": SOURCE_PIN, "configuration": config,
            "features": configuration_review(config), "operationCount": len(operations["operations"]),
            "operationIds": [row["id"] for row in operations["operations"]],
            "originalDirectory": str(root)}
    return workspace.save("edition", edition_id, body)

def materialize_edition(workspace, edition, destination):
    root = Path(destination).resolve()
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    for member in edition["data"]["files"]:
        path = owned_path(root, member["path"])
        if path.exists():
            require(identity(path) == {"bytes": member["bytes"], "sha256": member["sha256"]},
                    "Prepared original edition file changed: " + member["path"])
        else:
            raw = workspace.object_bytes(member["sha256"])
            durable_file(path, lambda out, raw=raw: out.write(raw), exclusive=True)
            path.chmod(member.get("mode", 0o600) & 0o777)
    return root

def create_changed_edition(workspace, edition_id, directory, changes, name):
    original = load_edition(workspace, edition_id)
    require(isinstance(changes, dict) and changes, "Supply the actual selected changed files.")
    destination = Path(directory).resolve()
    require(not destination.exists(), "Create the changed edition in a fresh directory.")
    materialize_edition(workspace, original, destination)
    for filename, text in changes.items():
        require(isinstance(text, str), "Changed source must contain the complete UTF-8 text.")
        path = owned_path(destination, filename)
        durable_file(path, lambda out, text=text: out.write(text.encode("utf-8")))
    manifest_path = destination / "edition.json"
    manifest = json.loads(manifest_path.read_bytes())
    manifest["name"] = name
    manifest["parent_edition"] = edition_id
    if "files" in manifest:
        manifest["files"] = sorted(set(manifest["files"]) | set(changes))
    durable_file(manifest_path, lambda out: out.write((json_text(manifest) + "\n").encode("utf-8")))
    return import_edition(workspace, destination, name)

def save_review(workspace, edition_id, decisions, note, expected=None):
    edition = load_edition(workspace, edition_id)
    require(isinstance(decisions, list), "Select the concrete feature decisions.")
    known = {row["feature"] for row in edition["data"]["features"]}
    seen = set()
    for row in decisions:
        require(row.get("feature") in known and row.get("feature") not in seen, "Select each actual configuration feature once.")
        require(row.get("decision") in {"retain", "changed", "needs-work"}, "Choose retain, changed or needs-work.")
        require(isinstance(row.get("reason"), str) and row["reason"].strip(), "Record the engineering reason.")
        seen.add(row["feature"])
    require(seen == known, "Review every selected native configuration feature.")
    require(isinstance(note, str) and note.strip(), "Record the complete configuration review.")
    return workspace.save("configuration-review", edition_id, {"edition": edition_id,
        "editionRevision": edition["revision"], "decisions": decisions, "note": note, "at": now()}, expected)
