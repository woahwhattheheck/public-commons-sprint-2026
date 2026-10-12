# SPDX-License-Identifier: MIT
"""Run the installed original QWC ConfigGenerator against one retained candidate."""
from __future__ import annotations

import argparse
import copy
import importlib.metadata
import json
import logging
import os
from pathlib import Path
import signal
import shutil
import sys
import threading

from contract import (need, QwcError, read_json, json_bytes, atomic, keep_json, measure,
                      directory, member, inventory, copy_file, copy_inventory, digest, value_hash, now)

GENERATION_SCHEMA = "starforge.stac-qwc-native-generation.v1"


def native_source_inventory(root):
    root = directory(root)
    names = []
    for path in root.rglob("*"):
        if path.is_file() and not path.is_symlink() and "__pycache__" not in path.parts and (
                path.suffix == ".py" or path.name == "schema-versions.json"):
            names.append({"path": path.relative_to(root).as_posix(), **measure(path)})
    need(any(x["path"] == "config_generator/config_generator.py" for x in names),
         "ORIGINAL_GENERATOR_SOURCE_REQUIRED", "Select the installed original ConfigGenerator src directory.")
    return sorted(names, key=lambda x: x["path"])


def configure_candidate(raw):
    """Rebase only native input-file references and the private viewer staging path."""
    profile = raw["profile"]
    original_input = directory(profile["inputRoot"])
    original_viewer = directory(profile["viewerRoot"])
    staged_input = directory(raw["inputDirectory"])
    staged_viewer = directory(raw["viewerDirectory"])
    original_cwd = directory(profile["generatorCwd"])
    seen = set()
    changes = []

    def mapped(path):
        path = Path(path).absolute()
        if path.is_relative_to(original_input):
            return staged_input / path.relative_to(original_input)
        if path.is_relative_to(original_viewer):
            return staged_viewer / path.relative_to(original_viewer)
        raise QwcError("CONFIGURATION_CLOSURE_REQUIRED",
                       "Retain this original configuration input in the selected input or viewer tree.",
                       path=str(path))

    def reference(value, base):
        need(isinstance(value, str) and value, "CONFIGURATION_PATH_REQUIRED",
             "The original native configuration reference must name a file.")
        path = Path(value)
        return path if path.is_absolute() else (base / path).absolute()

    def visit(original):
        original = Path(original).absolute()
        if str(original) in seen:
            return mapped(original)
        seen.add(str(original))
        staged = mapped(original)
        need(staged.is_file(), "CONFIGURATION_MEMBER_MISSING",
             "Keep the complete original native configuration input.", path=str(original))
        obj, body = read_json(staged)
        need(isinstance(obj, dict), "CONFIGURATION_OBJECT_REQUIRED", "A native configuration must be an object.")
        before = copy.deepcopy(obj)
        if isinstance(obj.get("template"), str):
            target = reference(obj["template"], original.parent)
            obj["template"] = str(visit(target))
        if isinstance(obj.get("themesConfig"), str):
            target = reference(obj["themesConfig"], original.parent)
            obj["themesConfig"] = str(mapped(target))
            need(Path(obj["themesConfig"]).is_file(), "THEMES_CONFIG_MISSING", "Keep the original theme configuration.")
        for service in obj.get("services", []):
            if service.get("name") != "mapViewer":
                continue
            config = service.get("config", {})
            if "qwc2_path" in config:
                target = reference(config["qwc2_path"], original_cwd).resolve(strict=True)
                need(target == original_viewer, "VIEWER_DIRECTORY_CHANGED",
                     "The selected viewer directory differs from the native mapViewer configuration.")
                config["qwc2_path"] = str(staged_viewer)
            qwc = service.get("generator_config", {}).get("qwc2_config", {})
            for key in ("qwc2_config_file", "qwc2_index_file"):
                if key in qwc:
                    target = reference(qwc[key], original_cwd)
                    replacement = visit(target) if key == "qwc2_config_file" else mapped(target)
                    need(replacement.is_file(), "VIEWER_CONFIG_MISSING", "Keep the original viewer file.", path=str(target))
                    qwc[key] = str(replacement)
        if obj != before:
            atomic(staged, json_bytes(obj), expected=digest(body))
            changes.append({"path": str(original), "inputSha256": digest(body),
                            "stagedSha256": value_hash(obj)})
        return staged

    selected = visit(original_input / profile["tenantConfig"])
    return selected, changes


def flatten_themes(root):
    result = []
    def group(value):
        result.extend(value.get("items", []))
        for child in value.get("groups", []):
            group(child)
    group(root.get("themes", {}))
    return result


def leaf_layers(root):
    if root.get("layers"):
        return [x for child in root["layers"] for x in leaf_layers(child)]
    return [root]


def generate(raw, cancelled):
    need(isinstance(raw, dict) and raw.get("schema") == GENERATION_SCHEMA,
         "GENERATION_INPUT_REQUIRED", "Use the complete retained native generation request.")
    root = directory(raw["directory"], True)
    p = raw["profile"]
    native_directory = directory(root / "native", True)
    deployment_directory = directory(root / "deployment", True)
    report_path = root / "native-generation.json"
    request_sha = value_hash(raw)
    if report_path.exists():
        retained, _ = read_json(report_path)
        need(retained.get("requestSha256") == request_sha,
             "GENERATION_REQUEST_CHANGED", "The native generation already belongs to a different input.")
        for row in retained["nativeFiles"]:
            measure(member(native_directory, row["path"]), row)
        for row in retained["deploymentFiles"]:
            measure(member(deployment_directory, row["path"]), row)
        for row in retained["viewerFiles"]:
            measure(member(raw["viewerDirectory"], row["path"]), row)
        return retained

    original_source = native_source_inventory(p["generatorSource"])
    need(original_source == raw["generatorSourceFiles"], "GENERATOR_SOURCE_CHANGED",
         "The installed original ConfigGenerator source changed after review.")
    # Configuration generation is a pure rebuild until its complete receipt exists.
    # Restore only this marked candidate from the same immutable reviewed input.
    candidate = directory(raw["candidateDirectory"])
    owner, _ = read_json(candidate / "candidate.json")
    need(owner == {"schema": "starforge.stac-qwc-candidate.v1",
                   "publicationId": raw["publicationId"]},
         "CANDIDATE_OWNER_CHANGED", "Keep the original candidate and its retained publication.")
    for target_name, baseline_name, files_name in (
            ("inputDirectory", "inputBaselineDirectory", "inputFiles"),
            ("viewerDirectory", "viewerBaselineDirectory", "viewerFiles")):
        target = Path(raw[target_name]).absolute()
        need(target.parent == candidate and target.name in ("input", "viewer"),
             "CANDIDATE_DIRECTORY_CHANGED", "The rebuild must remain in the original private candidate.")
        if target.exists():
            directory(target)
            shutil.rmtree(target)
        copy_inventory(raw[baseline_name], target, raw[files_name])
    copy_file(raw["themeDocumentFile"],
              member(raw["inputDirectory"], p["themeInput"], False),
              raw["themeDocument"], replace=True)
    config_file, changes = configure_candidate(raw)
    prepared = {"requestSha256": request_sha, "tenantConfig": str(config_file),
                "derivations": changes, "files": inventory(raw["inputDirectory"])}
    keep_json(root / "configured-input.json", prepared)

    os.environ["CONFIG_PATH"] = str(native_directory)
    os.environ["OUTPUT_CONFIG_PATH"] = str(native_directory)
    os.environ["INPUT_CONFIG_PATH"] = str(directory(raw["inputDirectory"]))
    os.chdir(directory(p["generatorCwd"]))
    source = str(directory(p["generatorSource"]))
    if source not in sys.path:
        sys.path.insert(0, source)
    from config_generator.config_generator import ConfigGenerator

    logger = logging.getLogger("starforge-qwc-" + raw["publicationId"])
    logger.setLevel(logging.INFO)
    handler = logging.FileHandler(root / "native-generation.log", encoding="utf-8")
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    logger.addHandler(handler)
    generator = None
    try:
        generator = ConfigGenerator(str(config_file), logger, cancelled, False, False)
        need(not cancelled.is_set(), "CANCELLED", "The original configuration generation was cancelled.")
        need(generator.tenant == p["tenant"], "NATIVE_TENANT_CHANGED",
             "The native generator selected a different tenant.")
        need(type(generator.permissions_default_allow) is bool and
             generator.permissions_default_allow == p["permissionsDefaultAllow"],
             "NATIVE_PERMISSION_DEFAULT_CHANGED", "Review the existing host's effective permission default.")
        need(generator.default_qgis_server_url == p["qgisServerBaseUrl"],
             "NATIVE_QGIS_SERVICE_CHANGED", "The effective native QGIS server route changed after review.")
        native_resources = Path(generator.theme_reader.config.get("qgis_projects_base_dir")).resolve(strict=True)
        need(native_resources == Path(p["qgisResourcesRoot"]).resolve(strict=True),
             "NATIVE_PROJECT_ROOT_CHANGED", "The native generator reads a different QGIS project tree.")
        need(str(generator.theme_reader.config.get("qgis_project_extension", ".qgs")) == ".qgz",
             "NATIVE_QGZ_CONFIGURATION", "Set the existing QWC generator and QGIS server to the native .qgz project extension.")
        theme = [x for x in flatten_themes(generator.theme_reader.themes_config)
                 if x.get("id") == p["themeId"]]
        need(len(theme) == 1 and theme[0].get("url") == raw["theme"]["url"],
             "NATIVE_THEME_IDENTITY", "The original template/theme composition must select this theme exactly once.")
        map_name = p["mapPrefix"] + "/current/project"
        need(generator.theme_reader.service_name(theme[0]["url"]) == map_name,
             "NATIVE_MAP_IDENTITY", "The native theme resolves to a different project.")
        project_path = Path(p["qgisResourcesRoot"]) / map_name
        measure(project_path.with_suffix(".qgz"), raw["projectFile"])
        capabilities = generator.theme_reader.wms_capabilities(map_name)
        need(capabilities and capabilities.get("root_layer"), "NATIVE_CAPABILITIES_REQUIRED",
             "The original QGIS server did not return the selected project metadata.")
        selected_names = [x["wmsName"] for x in raw["layers"]]
        actual_names = [x["name"] for x in leaf_layers(capabilities["root_layer"])]
        need(len(actual_names) == len(set(actual_names)) and set(actual_names) == set(selected_names),
             "NATIVE_LAYER_SELECTION_CHANGED", "The native service layer set differs from the retained original project.",
             expected=selected_names, actual=actual_names)
        native_input = {
            "requestSha256": request_sha, "publicationId": raw["publicationId"],
            "theme": theme[0], "mapName": map_name,
            "capabilities": capabilities,
            "projectMetadata": generator.theme_reader.project_metadata(map_name)
        }
        # The first retained source observation remains available if a later rebuild is needed.
        observation = root / ("observed-source-" + value_hash(native_input) + ".json")
        keep_json(observation, native_input)
        configs_ok = generator.write_configs()
        need(configs_ok is True, "NATIVE_CONFIG_GENERATION_FAILED",
             "The original ConfigGenerator did not complete its service configuration.")
        permissions_ok = generator.write_permissions()
        need(permissions_ok is True, "NATIVE_PERMISSION_GENERATION_FAILED",
             "The original ConfigGenerator did not complete its permission configuration.")
        need(not cancelled.is_set(), "CANCELLED", "The original configuration generation was cancelled.")
        measure(project_path.with_suffix(".qgz"), raw["projectFile"])
        files = inventory(native_directory / p["tenant"])
        names = {x["path"] for x in files}
        need({"mapViewerConfig.json", "permissions.json", "index.html"} <= names,
             "NATIVE_CONFIGURATION_INCOMPLETE", "Keep the complete original viewer and permission output.")
        permission, _ = read_json(native_directory / p["tenant"] / "permissions.json")
        need(permission.get("permissions_default_allow") == p["permissionsDefaultAllow"],
             "NATIVE_PERMISSION_PROJECTION_CHANGED", "The generated permission default changed.")
        roles = {x["role"] for x in permission.get("roles", [])}
        need(all(not x.get("role") or x["role"] in roles for x in raw.get("roleViews", [])),
             "NATIVE_ROLE_MISSING", "A selected existing role is missing from the native ConfigDB projection.")
        derived = []
        for row in files:
            source_file = member(native_directory / p["tenant"], row["path"])
            target = member(deployment_directory, row["path"], False)
            if row["path"] == "mapViewerConfig.json":
                obj, body = read_json(source_file)
                need(obj.get("config", {}).get("qwc2_path") == raw["viewerDirectory"],
                     "NATIVE_VIEWER_PATH_CHANGED", "The original mapViewer output has an unexpected staging path.")
                obj["config"]["qwc2_path"] = p["viewerRoot"]
                deployed = json_bytes(obj)
                atomic(target, deployed)
                derived.append({"path": row["path"], "jsonPointer": "/config/qwc2_path",
                                "from": raw["viewerDirectory"], "to": p["viewerRoot"],
                                "nativeSha256": digest(body), "deployedSha256": digest(deployed)})
            else:
                copy_file(source_file, target, row, replace=target.exists())
        # Native generation changes viewer assets. Input-config staging paths remain private.
        for change in prepared["derivations"]:
            original = Path(change["path"])
            if original.is_relative_to(Path(p["viewerRoot"])):
                name = original.relative_to(Path(p["viewerRoot"])).as_posix()
                source_file = member(raw["viewerBaselineDirectory"], name)
                copy_file(source_file, member(raw["viewerDirectory"], name, False),
                          measure(source_file), replace=True)
        versions = {}
        for name in ("qwc-services-core", "SQLAlchemy", "requests", "jsonschema", "deepmerge"):
            try:
                versions[name] = importlib.metadata.version(name)
            except importlib.metadata.PackageNotFoundError:
                pass
        result = {
            "schema": GENERATION_SCHEMA, "publicationId": raw["publicationId"],
            "requestSha256": request_sha, "completedAt": now(),
            "nativeSourceFiles": original_source, "nativeSourceSha256": value_hash(original_source),
            "python": sys.version.split()[0], "packages": versions,
            "nativeMethods": {"write_configs": configs_ok, "write_permissions": permissions_ok},
            "nativeErrorCounts": list(generator.check_for_errors()),
            "sourceObservation": {"path": observation.name, **measure(observation)},
            "theme": copy.deepcopy(theme[0]), "mapName": map_name,
            "capabilities": capabilities,
            "projectMetadata": generator.theme_reader.project_metadata(map_name),
            "roles": sorted(roles), "permissionsDefaultAllow": permission["permissions_default_allow"],
            "nativeFiles": [{"path": p["tenant"] + "/" + x["path"], "bytes": x["bytes"], "sha256": x["sha256"]}
                            for x in files],
            "deploymentFiles": inventory(deployment_directory),
            "viewerFiles": inventory(raw["viewerDirectory"]),
            "derivations": derived
        }
        keep_json(report_path, result)
        return result
    finally:
        if generator is not None:
            generator.cleanup_temp_dir()
        handler.flush()
        handler.close()
        logger.removeHandler(handler)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True)
    args = parser.parse_args()
    raw, _ = read_json(args.input)
    cancelled = threading.Event()
    state = {"signal": None}
    def stop(signum, _frame):
        if state["signal"] is None:
            state["signal"] = signum
        cancelled.set()
    previous = {s: signal.signal(s, stop) for s in (signal.SIGINT, signal.SIGTERM)}
    try:
        result = generate(raw, cancelled)
        print(json.dumps({"schema": result["schema"], "publicationId": result["publicationId"],
                          "result": str(Path(raw["directory"]) / "native-generation.json"),
                          "files": len(result["deploymentFiles"]), "completedAt": result["completedAt"]},
                         ensure_ascii=False), flush=True)
        return 0
    except Exception as error:
        print(json.dumps({"error": getattr(error, "code", "NATIVE_GENERATION_ERROR"),
                          "message": str(error), "details": getattr(error, "details", {})},
                         ensure_ascii=False), file=sys.stderr, flush=True)
        return 128 + state["signal"] if state["signal"] is not None else 2
    finally:
        for sig, handler in previous.items():
            signal.signal(sig, handler)


if __name__ == "__main__":
    raise SystemExit(main())
