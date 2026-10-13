#!/usr/bin/env python3
"""Install a complete additive Web Map source bank into the current native app."""
from __future__ import annotations
import argparse
import ast
import base64
import hashlib
import json
from pathlib import Path, PurePosixPath
import sys


def select_scenario_registration(application, current_content, builtin_content):
    """Choose the complete scenario desk binding for the actual native owner."""
    application = Path(application).resolve(strict=True)
    variants = {
        "extension_owner": (current_content, 1614, "44985e69b36f8e67663425c9ff7a4f640f768df8bcb75467da47d9e747a40ba1"),
        "native_owner": (builtin_content, 971, "cda51b9e834a8b5de3718139bf8b1497d19bacdfeebb0558a9b87b8f1d054f28"),
    }
    for mode, (content, expected_bytes, expected_sha) in variants.items():
        if len(content) != expected_bytes or hashlib.sha256(content).hexdigest() != expected_sha:
            raise ValueError("The complete scenario registration differs: " + mode)
        descriptor = json.loads(content.decode("utf-8"))
        if descriptor.get("id") != "scenario-analysis":
            raise ValueError("Use the original scenario-analysis desk registration.")
    server_path = (application / "operator" / "server.py").resolve(strict=True)
    if not server_path.is_relative_to(application) or not server_path.is_file():
        raise ValueError("The original native server must be inside the application.")
    server_content = server_path.read_bytes()
    tree = ast.parse(server_content.decode("utf-8"), filename=str(server_path))

    def literal_members(name):
        values = []
        for node in tree.body:
            if isinstance(node, ast.Assign) and any(
                    isinstance(target, ast.Name) and target.id == name for target in node.targets):
                values.append(node.value)
            elif (isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name)
                  and node.target.id == name):
                values.append(node.value)
        if len(values) != 1:
            raise ValueError("The original server must declare one literal " + name + " collection.")
        try:
            value = ast.literal_eval(values[0])
        except (ValueError, TypeError, SyntaxError) as error:
            raise ValueError("Read the original literal " + name + " declaration before installing this desk.") from error
        if not isinstance(value, (set, tuple, list)) or any(not isinstance(item, str) for item in value):
            raise ValueError("The original " + name + " declaration must contain literal names.")
        return set(value)

    action_owned = "scenario.analyze" in literal_members("ACTIONS")
    kind_owned = "scenario_analyses" in literal_members("KINDS")
    if action_owned != kind_owned:
        raise ValueError("The scenario action and result kind have different owners; complete the native host migration together.")
    mode = "native_owner" if action_owned else "extension_owner"
    model_path = (application / "model" / "model_selection.py").resolve(strict=True)
    if not model_path.is_relative_to(application) or not model_path.is_file():
        raise ValueError("Receive the original selected-native-model module inside this application.")
    model_content = model_path.read_bytes()
    model_sha = hashlib.sha256(model_content).hexdigest()
    model_tree = ast.parse(model_content.decode("utf-8"), filename=str(model_path))
    for name in ("common_comparison_outputs", "validate_completed_run"):
        definitions = [node for node in model_tree.body
                       if isinstance(node, ast.FunctionDef) and node.name == name]
        if len(definitions) != 1:
            raise ValueError("The installed native model-selection module needs " + name + ".")
        args = definitions[0].args
        positional = len(args.posonlyargs) + len(args.args)
        required = positional - len(args.defaults)
        if ((positional < 1 and args.vararg is None) or required > 1
                or any(value is None for value in args.kw_defaults)):
            raise ValueError("The native model-selection method must accept one retained selection: " + name)
    content, byte_count, content_sha = variants[mode]
    return content, {
        "mode": mode,
        "descriptor_path": "operator/extensions/scenario-analysis.json",
        "descriptor_bytes": byte_count,
        "descriptor_sha256": content_sha,
        "native_server_sha256": hashlib.sha256(server_content).hexdigest(),
        "native_action_owner": action_owned,
        "native_result_kind_owner": kind_owned,
        "model_selection_bytes": len(model_content),
        "model_selection_sha256": model_sha,
    }


def migrate_scenario_browser(application):
    """Prepare the legacy app's single-owner extension migration without writes."""
    application = Path(application).resolve(strict=True)
    path = (application / "operator" / "web" / "app.mjs").resolve(strict=True)
    if not path.is_relative_to(application) or not path.is_file():
        raise ValueError("The original browser application must remain inside its native root.")
    original = path.read_bytes()
    source = original.decode("utf-8")
    for join in ("createExtensionHost(", "extensions.render(", "extensions.dispatch("):
        if join not in source:
            raise ValueError("Install the current original extension-host join before receiving scenario analysis: " + join)
    before = hashlib.sha256(original).hexdigest()
    if "attachScenarioAnalysis" not in source and "scenarioAnalysis" not in source:
        return original, {
            "mode": "already_extension_owned",
            "path": "operator/web/app.mjs",
            "previous_sha256": before,
            "sha256": before,
            "bytes": len(original),
        }
    replacements = (
        ("import {attachScenarioAnalysis} from './scenario_analysis.mjs';\n", ""),
        ("const scenarioAnalysis=attachScenarioAnalysis({getState:()=>state,api,endpoint,openForm,submitAction,fileList,toast,openItem});\n", ""),
        ("  scenarioAnalysis.detach();\n", ""),
        ("  if(view==='scenario-analysis')html=scenarioAnalysis.render();\n", ""),
        ("  if(view==='scenario-analysis')scenarioAnalysis.mount($('#content'));\n", ""),
        ("experiments.detach();scenarioAnalysis.detach();workspace=id;", "experiments.detach();workspace=id;"),
        (" if(action?.startsWith('analysis-'))return scenarioAnalysis.dispatch(button);\n", ""),
    )
    for old, new in replacements:
        if source.count(old) != 1:
            raise ValueError("Compose the changed native scenario browser binding before replacing this original app: " + old.strip())
        source = source.replace(old, new, 1)
    if "attachScenarioAnalysis" in source or "scenarioAnalysis" in source:
        raise ValueError("Another native scenario controller binding remains in this browser.")
    content = source.encode("utf-8")
    return content, {
        "mode": "legacy_controller_migrated",
        "path": "operator/web/app.mjs",
        "previous_sha256": before,
        "sha256": hashlib.sha256(content).hexdigest(),
        "bytes": len(content),
    }


def install(source_bank, application, replace_existing=False):
    application = Path(application).resolve(strict=True)
    bank = json.loads(Path(source_bank).read_text(encoding="utf-8"))
    if bank.get("schema") != "commons.source-bank/v1":
        raise ValueError("Use the complete commons.source-bank/v1 document.")
    if bank.get("operation_id") != "ECO-264B-WEBMAP-ADMISSION-20261013":
        raise ValueError("This installer accepts the original map admission source bank.")
    for relative in ("model/workspace.py", "model/spatial_esri.py", "model/portable.py",
                     "operator/server.py", "operator/extension_registry.py",
                     "source/capture_upstream_network.py"):
        if not (application / relative).is_file():
            raise ValueError("Install into the current cumulative original application: missing " + relative)
    members = {row["path"]: row for row in bank["files"]}
    if len(members) != len(bank["files"]):
        raise ValueError("The source bank repeats an application member.")
    descriptor_path = "operator/extensions/scenario-analysis.json"
    native_variant_path = "source/webmap_county_context/scenario-analysis-native21.json"
    effective_descriptor, compatibility = select_scenario_registration(
        application,
        base64.b64decode(members[descriptor_path]["content_base64"], validate=True),
        base64.b64decode(members[native_variant_path]["content_base64"], validate=True))
    browser_name = "operator/web/app.mjs"
    if browser_name in members:
        raise ValueError("The original browser migration and source bank cannot both own app.mjs.")
    browser_content, browser_compatibility = migrate_scenario_browser(application)
    materialized = []
    for row in bank["files"]:
        name = row["path"]
        relative = PurePosixPath(name)
        if (relative.is_absolute() or ".." in relative.parts or "\\" in name or
                str(relative) != name or relative.parts[0] not in
                {"model", "operator", "source", "source_tools"}):
            raise ValueError("Invalid additive native application path: " + name)
        destination = (application / relative).resolve()
        if not destination.is_relative_to(application):
            raise ValueError("Application source path escapes its original root.")
        content = base64.b64decode(row["content_base64"], validate=True)
        if len(content) != row["bytes"] or hashlib.sha256(content).hexdigest() != row["sha256"]:
            raise ValueError("Complete source member differs: " + name)
        if name == descriptor_path:
            content = effective_descriptor
            row = {**row, "published_source_sha256": row["sha256"],
                   "bytes": len(content), "sha256": hashlib.sha256(content).hexdigest(),
                   "content_base64": base64.b64encode(content).decode("ascii")}
        if name.endswith(".py"):
            ast.parse(content.decode("utf-8"), filename=name)
        elif name.endswith(".json"):
            json.loads(content.decode("utf-8"))
        previous = hashlib.sha256(destination.read_bytes()).hexdigest() if destination.exists() else None
        if previous and previous != row["sha256"]:
            expected_predecessor = row.get("predecessor_sha256")
            if expected_predecessor is not None:
                accepted_predecessors = ([expected_predecessor] if isinstance(expected_predecessor, str)
                                         else expected_predecessor)
                if previous not in accepted_predecessors:
                    raise ValueError("Compose the current shared controller before replacing " + name)
            elif not replace_existing:
                raise ValueError("An earlier edition exists; inspect it and use --replace-existing for this exact bank: " + name)
        materialized.append((row, destination, content, previous))
    if browser_compatibility["mode"] == "legacy_controller_migrated":
        browser_row = {"path": browser_name, "bytes": len(browser_content),
                       "sha256": hashlib.sha256(browser_content).hexdigest(),
                       "derived_from_original": True}
        materialized.append((browser_row, (application / browser_name).resolve(),
                             browser_content, browser_compatibility["previous_sha256"]))
    if len({row["path"] for row, _, _, _ in materialized}) != len(materialized):
        raise ValueError("The source bank repeats an application member.")
    sys.path.insert(0, str(application))
    from model import portable
    roots = set(portable.APPLICATION_DIRECTORIES)
    if not {"model", "operator", "source", "source_tools"}.issubset(roots):
        raise ValueError("The installed native portable source inventory omits an admission source root.")
    # Validate all source members before any writes.
    for row, destination, content, previous in materialized:
        if previous == row["sha256"]:
            continue
        if previous is not None:
            original = destination.read_bytes()
            if hashlib.sha256(original).hexdigest() != previous:
                raise ValueError("The source changed during installation: " + row["path"])
            saved = application / "source_tools" / "webmap-source-history" / previous / destination.name
            saved.parent.mkdir(parents=True, exist_ok=True)
            if saved.exists() and saved.read_bytes() != original:
                raise ValueError("The retained predecessor differs: " + row["path"])
            if not saved.exists():
                saved.write_bytes(original)
        elif destination.exists():
            raise ValueError("The source appeared during installation: " + row["path"])
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_name(destination.name + ".eco264b-partial")
        temporary.write_bytes(content)
        temporary.replace(destination)
    return {"status": "installed", "application": str(application),
            "operation_id": bank["operation_id"],
            "files": [{"path": row["path"], "bytes": row["bytes"], "sha256": row["sha256"],
                       "previous_sha256": previous} for row, _, _, previous in materialized],
            "native_portable_source_roots": sorted(roots),
            "scenario_registration": compatibility,
            "scenario_browser_migration": browser_compatibility}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-bank", type=Path, required=True)
    parser.add_argument("--application", type=Path, required=True)
    parser.add_argument("--replace-existing", action="store_true")
    args = parser.parse_args()
    print(json.dumps(install(args.source_bank, args.application, args.replace_existing), indent=2))
