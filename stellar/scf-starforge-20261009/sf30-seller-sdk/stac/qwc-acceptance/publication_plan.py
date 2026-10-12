"""Bind the original stac/qwc publication to an explicit native review profile."""
from __future__ import annotations
import argparse
import copy
import json
import os
from pathlib import Path
import stat
import sys

from qwc_acceptance import (SCHEMA, MAX_CONFIG, MAX_SOURCE, AcceptanceError, need,
    identifier, load_json, pack, read_file, retain, sha, text, validate_plan, relative)

PROFILE_SCHEMA = "starforge.stac-qwc-review-profile.v1"
PUBLICATION_SCHEMA = "starforge.stac-qwc-publication.v1"


def original_member(root, name, limit):
    """Open the selected original member through nonsymlink directory handles."""
    relative(name)
    directory = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        parts = name.split("/")
        for part in parts[:-1]:
            next_fd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory)
            os.close(directory)
            directory = next_fd
        fd = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
        try:
            info = os.fstat(fd)
            need(stat.S_ISREG(info.st_mode) and info.st_size <= limit, "PUBLICATION_MEMBER",
                 "Select a bounded regular original publication/configuration file", path=name)
            with os.fdopen(fd, "rb", closefd=False) as stream:
                raw = stream.read(limit + 1)
            need(len(raw) == info.st_size and len(raw) <= limit, "PUBLICATION_MEMBER_CHANGED", name)
            return raw
        finally:
            os.close(fd)
    finally:
        os.close(directory)


def publication_input(publication_path, profile_path, *, expected_sha256):
    publication_path, profile_path = Path(publication_path).absolute(), Path(profile_path).absolute()
    raw, profile_raw = read_file(publication_path, MAX_CONFIG), read_file(profile_path, MAX_CONFIG)
    need(sha(raw) == expected_sha256, "PUBLICATION_SHA",
         "Select the exact completed original publication manifest")
    publication, profile = load_json(raw), load_json(profile_raw)
    need(publication.get("schema") == PUBLICATION_SCHEMA, "PUBLICATION_SCHEMA",
         "Use the original stac/qwc immutable publication")
    need(profile.get("schema") == PROFILE_SCHEMA and set(profile) <=
         {"schema", "run_id", "title", "checks", "principal_references", "source_files", "notes"},
         "PROFILE_SCHEMA", "Use the explicit native publication review profile")
    publication_id = text(publication.get("publicationId"), "publicationId", 200)
    theme, service = publication["theme"], publication["service"]
    need(service.get("wmsVersion") in ("1.3.0", "1.1.1"), "PUBLICATION_WMS_VERSION",
         "Select the publisher's original supported WMS version")
    layer_names = {x["wmsName"] for x in theme["layers"]}
    need(len(layer_names) == len(theme["layers"]), "PUBLICATION_LAYER_NAMES",
         "The original native WMS layer names must be distinct")
    role_views = publication.get("roleViews")
    need(isinstance(role_views, list) and role_views, "PUBLICATION_ROLES",
         "Retain the publisher's actual original role views")
    principals = profile.get("principal_references", {})
    need(isinstance(principals, dict), "PROFILE_PRINCIPALS", "Select original nonsecret principal references")
    roles, bindings = [], {}
    for view in role_views:
        view_id = identifier(view.get("id"), "role_view.id")
        private = bool(view.get("headersEnvironment"))
        role = {"id": view_id, "title": view.get("title", view_id),
                "authentication": "existing_session" if private else "anonymous"}
        if private:
            role["principal_reference"] = text(principals.get(view_id), "principal_reference", 500)
            environment = text(view["headersEnvironment"], "headersEnvironment", 200)
            need(environment.replace("_", "").isalnum() and environment[0].isalpha(),
                 "HEADER_ENVIRONMENT", "Use the original selected header environment name")
            bindings[view_id] = {"role_id": view_id, "principal_reference": role["principal_reference"],
                                 "headers_environment": environment}
        need(set(view.get("expectedLayerNames", [])) <= layer_names, "ROLE_LAYER_SELECTION",
             "A role view refers to a layer outside this selected publication")
        roles.append(role)
    checks = copy.deepcopy(profile.get("checks", []))
    need(isinstance(checks, list), "PROFILE_CHECKS", "Select the native request checks")
    if not any(x.get("operation") == "GetCapabilities" for x in checks):
        need(not any(x.get("id") == "publication-capabilities" for x in checks),
             "PROFILE_CHECK_ID", "The reserved capabilities check ID is already used")
        checks.insert(0, {"id": "publication-capabilities", "title": "Published service and role layers",
                         "operation": "GetCapabilities", "params": {}, "expect": {}})
    keyword = "starforge-publication:" + publication_id
    for check in checks:
        operation = check.get("operation")
        params = {key.upper(): value for key, value in check.get("params", {}).items()}
        if operation in ("GetCapabilities", "GetProjectSettings"):
            expect = check.setdefault("expect", {})
            expect["required_keywords"] = sorted(set(expect.get("required_keywords", [])) | {keyword})
            overrides = check.setdefault("role_expectations", {})
            for view in role_views:
                role_expect = overrides.setdefault(view["id"], {})
                role_expect["required_layers"] = sorted(set(role_expect.get("required_layers", [])) |
                                                       set(view.get("expectedLayerNames", [])))
                # A role override replaces the generic expectation, so preserve the edition binding there too.
                role_expect["required_keywords"] = sorted(set(role_expect.get("required_keywords", [])) | {keyword})
        if operation in ("GetMap", "GetFeatureInfo"):
            required = {"LAYERS", "BBOX", "WIDTH", "HEIGHT", "FORMAT",
                        "CRS" if service["wmsVersion"] == "1.3.0" else "SRS"}
            need(required <= set(params), "PROFILE_MAP_PARAMS",
                 "Select the exact native layer, wire CRS/BBOX, pixels and response format", check_id=check["id"])
            selected = str(params["LAYERS"]).split(",")
            need(set(selected) <= layer_names | {theme["mapName"]}, "PROFILE_LAYER",
                 "Use the original publication's actual WMS names", check_id=check["id"])
        if operation == "GetFeatureInfo":
            need(str(params.get("LAYERS")) == str(params.get("QUERY_LAYERS")) and
                 params.get("INFO_FORMAT") == "text/xml", "QWC_FEATURE_INFO",
                 "This QWC proxy uses equal LAYERS/QUERY_LAYERS and original text/xml feature information")
            coordinates = {"I", "J"} if service["wmsVersion"] == "1.3.0" else {"X", "Y"}
            need(coordinates <= set(params), "PROFILE_FEATURE_PIXEL", "Select the original feature-info pixel")
        if operation == "GetPrint":
            names = {x["name"] for x in theme.get("layouts", [])}
            need(params.get("TEMPLATE") in names and params.get("FORMAT") == "application/pdf",
                 "PROFILE_PRINT_LAYOUT", "Use a retained original native print layout and PDF output")
            need(any(key.endswith(":EXTENT") for key in params), "PROFILE_PRINT_EXTENT",
                 "Select the exact ComposerMap request identifiers and wire extents from native GetProjectSettings")
    publication_binding = {"schema": PUBLICATION_SCHEMA, "publication_id": publication_id,
        "manifest": {"name": "publication.json", "bytes": len(raw), "sha256": sha(raw)},
        "operation_id": publication.get("operationId"), "request_id": publication.get("requestId"),
        "qgis": copy.deepcopy(publication["qgis"]), "theme": copy.deepcopy(theme),
        "qwc": {key: copy.deepcopy(publication["qwc"].get(key)) for key in
                ("tenant", "version", "permissionsDefaultAllow", "nativeSourceBinding")},
        "viewer_url": service["viewerUrl"]}
    plan = {"schema": SCHEMA, "run_id": profile["run_id"], "title": profile["title"],
            "publication": publication_binding,
            "service": {"url": service["wmsUrl"], "wms_version": service["wmsVersion"]},
            "roles": roles, "checks": checks, "notes": profile.get("notes", "")}
    validate_plan(plan)
    sources = {"publication.json": raw, "acceptance-profile.json": profile_raw}
    descriptors = publication.get("files", [])
    need(isinstance(descriptors, list), "PUBLICATION_FILES", "Retain the publisher's original file inventory")
    inventory = {}
    for item in descriptors:
        name = relative(item["path"])
        need(name not in inventory, "PUBLICATION_FILE_DUPLICATE", name)
        inventory[name] = item
    selected_files = profile.get("source_files", [])
    need(isinstance(selected_files, list) and all(isinstance(x, str) for x in selected_files)
         and len(selected_files) == len(set(selected_files)), "PROFILE_SOURCES",
         "Select distinct original manifest/configuration paths")
    for name in selected_files:
        need(name in inventory and name not in sources, "PROFILE_SOURCE",
             "Select the exact original publication file descriptor", path=name)
        item = inventory[name]
        body = original_member(publication_path.parent, name, MAX_SOURCE)
        need(item["bytes"] == len(body) and item["sha256"] == sha(body),
             "PUBLICATION_MEMBER_HASH", name)
        sources[name] = body
    return {"plan": plan, "sources": sources, "session_bindings": bindings,
            "publication": publication, "publication_sha256": sha(raw),
            "profile_sha256": sha(profile_raw)}


def existing_sessions(bindings):
    sessions = {}
    for role_id, selected in bindings.items():
        environment = selected["headers_environment"]
        value = os.environ.get(environment)
        need(value is not None, "EXISTING_SESSION_ENVIRONMENT",
             "The selected host has not supplied this original role session", role_id=role_id,
             environment_name=environment)
        try:
            headers = json.loads(value)
        except json.JSONDecodeError as exc:
            raise AcceptanceError("EXISTING_SESSION_FORMAT",
                 "The selected original header environment must contain a JSON object", role_id=role_id) from exc
        need(isinstance(headers, dict) and headers and
             set(key.lower() for key in headers) <= {"authorization", "cookie"} and
             all(isinstance(value, str) and value and "\r" not in value and "\n" not in value
                 for value in headers.values()), "EXISTING_SESSION_HEADERS",
             "Use only the original authorized Cookie or Authorization header", role_id=role_id)
        sessions[role_id] = {"role_id": role_id,
            "principal_reference": selected["principal_reference"], "headers": headers}
    return sessions


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--publication", required=True)
    parser.add_argument("--profile", required=True)
    parser.add_argument("--expected-sha256", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    selected = publication_input(args.publication, args.profile, expected_sha256=args.expected_sha256)
    directory = Path(args.out).absolute()
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    for name, raw in selected["sources"].items():
        retain(directory / "sources" / relative(name), raw)
    retain(directory / "acceptance-plan.json", pack(selected["plan"]))
    retain(directory / "session-bindings.json", pack(selected["session_bindings"]))
    input_value = {"plan": selected["plan"],
                  "sources": {name: str(directory / "sources" / name) for name in selected["sources"]}}
    retain(directory / "acceptance-input.json", pack(input_value))
    print(pack({"directory": str(directory), "run_id": selected["plan"]["run_id"],
                "publication_sha256": selected["publication_sha256"],
                "profile_sha256": selected["profile_sha256"],
                "source_files": len(selected["sources"]), "plan_sha256": sha(pack(selected["plan"]))}).decode(), end="")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        result = exc.as_dict() if isinstance(exc, AcceptanceError) else {"code": type(exc).__name__, "message": str(exc)[:1000]}
        print(pack({"error": result}).decode(), file=sys.stderr, end="")
        raise SystemExit(1)
