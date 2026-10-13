#!/usr/bin/env python3
"""Collect an Eco component family through the original language collectors.

The application is never imported. Existing component declarations, scientific
members and exact predecessor guards remain authoritative.
"""
from __future__ import annotations
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile

HERE = Path(__file__).resolve().parent
VENDOR = HERE / "vendor" / "source_closure"
sys.path.insert(0, str(VENDOR))
import python_source_closure as python_source
import application_source_closure as mixed_source
if Path(python_source.__file__).resolve().parent != VENDOR or Path(mixed_source.__file__).resolve().parent != VENDOR:
    raise RuntimeError("Use the retained collector dependencies beside this adapter")
try:
    from . import application_assembly as assembly
    from . import application_components as components
except ImportError:
    import application_assembly as assembly
    import application_components as components

SCHEMA = "upstate.component-source-collection/v1"
RECIPE = "upstate.component-source-selection/v1"
REPORT = "upstate.component-source-report/v1"
CODE_SUFFIXES = {".py", ".mjs", ".js", ".cjs"}
TOOL_FILES = ["component_source_collection.py", "application_assembly.py",
              "application_components.py", "component_fragments.py"]
IDENTITY_KEYS = ("bytes", "sha256", "mode")

def clone(value):
    return copy.deepcopy(value)

def canonical(value):
    return assembly.canonical(value)

def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()

def fail(code, message, detail=None):
    python_source.fail(code, message, detail)

def document_bytes(row):
    return assembly.represented_body(row.get("content"), row)

def checked_rows(rows):
    if not isinstance(rows, list):
        fail("COMPONENT_MEMBERS", "Retain the complete original family member list")
    found = {}
    aliases = {}
    total = 0
    for row in rows:
        if not isinstance(row, dict):
            fail("COMPONENT_MEMBER", "Every member needs its complete body and identity")
        name = str(assembly.member_name(row.get("path")))
        if name in found or (name.casefold() in aliases and aliases[name.casefold()] != name):
            fail("COMPONENT_ALIAS", "Duplicate or case-aliased source member", {"path": name})
        body = document_bytes(row)
        assembly.check_identity(body, row.get("bytes"), row.get("sha256"), name)
        if row.get("mode", "100644") not in ("100644", "100755"):
            fail("COMPONENT_MODE", "Use an ordinary original file mode", {"path": name})
        total += len(body)
        found[name] = clone(row)
        aliases[name.casefold()] = name
    assembly.check_layout(found)
    if len(found) > assembly.MAX_FILES or total > assembly.MAX_BYTES:
        fail("COMPONENT_LIMIT", "The full original family exceeds the maintained assembly limit")
    return found

def native_document(rows, declarations):
    combined = checked_rows([*rows, *declarations])
    return {"files": {name: row["content"] for name, row in combined.items()},
            "file_metadata": {name: {k: row[k] for k in
                ("bytes", "sha256", "mode", "encoding") if k in row}
                for name, row in combined.items()}}

def declaration_context(bank):
    selected = bank["family_selection"]
    originals = selected["declaration_sources"]
    checked_rows(originals)
    declarations = {r["path"]: document_bytes(r).decode("utf-8") for r in originals}
    if assembly.CATALOG_PATH not in declarations:
        fail("COMPONENT_CATALOG", "Retain the original catalogue and every original fragment")
    catalog, _ = components.compose_catalog(
        assembly.transport_json(declarations[assembly.CATALOG_PATH]),
        [(name, declarations[name]) for name in components.fragment_paths(declarations)])
    catalog = components.validate_catalog(catalog)
    if canonical(catalog) != canonical(selected["catalog"]):
        fail("COMPONENT_CATALOG", "The selected catalogue differs from its original full declarations")
    requested = selected["requested_components"]
    if not isinstance(requested, list) or not requested:
        fail("COMPONENT_SELECTION", "Select the original component family")
    chosen = components._selected({**catalog, "required_components": requested}, ())
    contexts, retained, templates = components.selected_contexts(catalog, chosen)
    return catalog, chosen, contexts, retained, templates

def selection(value):
    allowed = {"schema", "label", "components", "python", "javascript", "unresolved_contexts", "javascript_runtime"}
    if not isinstance(value, dict) or value.get("schema") != RECIPE or set(value) - allowed:
        fail("COMPONENT_SELECTION", "Use the complete component source selection")
    if not isinstance(value.get("label"), str) or not value["label"].strip():
        fail("COMPONENT_SELECTION", "Give the selected family a readable label")
    if not isinstance(value.get("components"), list) or not value["components"] or any(
            not isinstance(x, str) or not x for x in value["components"]):
        fail("COMPONENT_SELECTION", "Retain the complete requested component list")
    if len(set(value["components"])) != len(value["components"]):
        fail("COMPONENT_SELECTION", "Requested components must be unique")
    ids = set()
    for language in ("python", "javascript"):
        if not isinstance(value.get(language, []), list):
            fail("COMPONENT_SELECTION", "Language selections must be lists")
        for entry in value.get(language, []):
            if not isinstance(entry, dict) or set(entry) != {"id", "selection"}:
                fail("COMPONENT_SELECTION", "Each original language selection needs id and selection")
            if not isinstance(entry["id"], str) or not entry["id"] or entry["id"] in ids:
                fail("COMPONENT_SELECTION", "Language selection IDs must be unique")
            ids.add(entry["id"])
            spec = entry["selection"]
            if language == "python":
                python_source.selection(spec)
            elif (not isinstance(spec, dict) or spec.get("schema") != "commons.javascript-source-selection/v1"
                  or not isinstance(spec.get("paths"), list) or not spec["paths"]):
                fail("COMPONENT_SELECTION", "Retain the complete maintained JavaScript selection")
    unresolved = value.get("unresolved_contexts", [])
    if not isinstance(unresolved, list):
        fail("COMPONENT_SELECTION", "Retain unresolved original source contexts as a list")
    runtime = value.get("javascript_runtime", [])
    if not isinstance(runtime, list):
        fail("COMPONENT_RUNTIME", "Retain explicit JavaScript computed-source choices")
    for row in runtime:
        if not isinstance(row, dict) or set(row) != {"selection_id", "source", "source_sha256", "range", "expression", "paths", "reason"}:
            fail("COMPONENT_RUNTIME", "A computed source choice needs exact original expression, source hash, selected paths and reason")
        python_source.portable(row["source"])
        if not isinstance(row["reason"], str) or not row["reason"].strip():
            fail("COMPONENT_RUNTIME", "Describe the original runtime selection")
        if not isinstance(row["paths"], list):
            fail("COMPONENT_RUNTIME", "Selected runtime paths must be a full list; external runtime can use an explicit empty list")
        for path in row["paths"]:
            python_source.portable(path)
    return clone(value)

def tools_identity():
    rows = []
    for name in TOOL_FILES:
        raw, mode = python_source.read_regular(HERE / name, assembly.MAX_BYTES)
        rows.append({"path": "source_tools/" + name, "mode": mode, **python_source.identity(raw)})
    for row in mixed_source.toolchain()["files"]:
        rows.append({**row, "path": "source_tools/vendor/source_closure/" + row["path"]})
    return {"schema": "upstate.component-source-tools/v1", "files": rows}

def plan(root, requested, label):
    """Propose explicit contexts from the current source declarations, never guess loaders."""
    bank = assembly.export_family(root, requested, edition=label, inspect_only=True)
    _, chosen, contexts, retained, _ = declaration_context(bank)
    catalog = bank["family_selection"]["catalog"]
    roots = list(dict.fromkeys([".", "operator", *[
        r or "." for name in chosen for r in catalog["components"][name].get("import_roots", [])]]))
    root_path = Path(root)
    roots = [r for r in roots if (root_path if r == "." else root_path / r).is_dir()]
    groups = {}
    unresolved = []
    js = []
    for row in bank["files"]:
        name = row["path"]
        if name in retained:
            continue
        suffix = Path(name).suffix.lower()
        if suffix in {".js", ".mjs", ".cjs"}:
            js.append(name)
        if suffix != ".py":
            continue
        matching = [ctx for prefix, ctx in contexts.items()
                    if name == prefix or name.startswith(prefix + "/")]
        context = max(matching, key=lambda x: len(x["prefix"])) if matching else {}
        ordered = list(dict.fromkeys([*(r or "." for r in context.get("import_roots", [])), *roots]))
        installed = context.get("installed_prefix")
        if installed is not None and installed != context.get("prefix"):
            unresolved.append({"path": name, "reason": "Original installed-prefix loader requires its explicit native selection",
                               "context": clone(context)})
            continue
        candidates = []
        for r in ordered:
            if r == ".":
                relative = name
            elif name.startswith(r + "/"):
                relative = name[len(r) + 1:]
            else:
                continue
            module = relative[:-3]
            if module.endswith("/__init__"):
                module = module[:-9]
            module = module.replace("/", ".")
            if module and all(x.isidentifier() for x in module.split(".")):
                candidates.append((len(r) if r != "." else 0, module))
        if not candidates:
            unresolved.append({"path": name, "reason": "This Python filename needs the original explicit file-loader context"})
            continue
        # More specific declared import root describes the installed module name.
        module = max(candidates)[1]
        key = tuple(ordered)
        groups.setdefault(key, []).append({"module": module})
    py = [{"id": "python-" + str(i + 1), "selection": {
        "schema": python_source.SELECTION_SCHEMA, "label": label,
        "module_roots": list(key), "entrypoints": list({canonical(x): x for x in rows}.values()),
        "resources": [], "external_modules": [], "dynamic_imports": []}}
        for i, (key, rows) in enumerate(groups.items())]
    # Explicit native /web served paths preserve the maintained HTTP root.
    routes = [{"url": "/web/" + name[len("operator/web/"):], "path": name}
              for name in js if name.startswith("operator/web/")]
    value = {"schema": RECIPE, "label": label, "components": list(requested),
             "python": py, "javascript": ([{"id": "browser-and-node", "selection": {
                "schema": "commons.javascript-source-selection/v1", "label": label,
                "paths": sorted(js), "resources": [], "routes": routes}}] if js else []),
             "unresolved_contexts": unresolved, "javascript_runtime": []}
    return {"selection": value, "component_inventory": bank["family_selection"]["component_inventory"],
            "declaration_sha256": digest(bank["family_selection"]["declaration_sources"]),
            "instructions": "Review ordered roots, actual launch modules, explicit externals and computed imports before collection."}

def collector_row(row):
    return python_source.row_for(row["path"], document_bytes(row), row.get("mode") or "100644")

def compact(packet):
    return {"analysis": {k: clone(v) for k, v in packet.items() if k != "files"},
            "members": [row["path"] for row in packet["files"]]}

def expand(part, rows):
    if not isinstance(part, dict) or set(part) != {"analysis", "members"}:
        fail("COMPONENT_ANALYSIS", "Retain original analysis plus complete member order")
    names = part["members"]
    if not isinstance(names, list) or len(set(names)) != len(names) or any(name not in rows for name in names):
        fail("COMPONENT_ANALYSIS", "A selected language member is missing or repeated")
    if not isinstance(part["analysis"], dict) or "files" in part["analysis"]:
        fail("COMPONENT_ANALYSIS", "Analysis must use the shared full source table")
    return {**clone(part["analysis"]), "files": [collector_row(rows[name]) for name in names]}

def language_run(root, entry, language, working, node):
    if language == "python":
        return python_source.collect_source(root, entry["selection"])
    spec_path = working / "selection.json"
    output = working / "source.json"
    python_source.publish(spec_path, python_source.json_bytes(entry["selection"]))
    mixed_source.bridge({"command": "collect", "root": str(root), "spec": str(spec_path),
                         "output": str(output)}, working, node)
    packet, _ = python_source.read_packet(output)
    return packet

def javascript_inspect(packet, working, node):
    input_path = working / "source.json"
    python_source.publish(input_path, python_source.json_bytes(packet))
    mixed_source.bridge({"command": "inspect", "input": str(input_path)}, working, node)

def coverage(bank, recipe, analyses):
    catalog, chosen, contexts, retained, templates = declaration_context(bank)
    rows = checked_rows(bank["files"])
    analysis_rows = {**rows, **checked_rows(bank["family_selection"]["declaration_sources"])}
    document = native_document(bank["files"], bank["family_selection"]["declaration_sources"])
    inventory = components.inspect(document, catalog=catalog, selected_components=recipe["components"],
                                   allow_embedded=True)
    parsed = {"python": set(), "javascript": set()}
    errors = []
    runtime_findings = []
    context_findings = []
    selected_directories = set()
    observed_kinds = {}
    used_runtime = set()
    for language in ("python", "javascript"):
        for entry in analyses[language]:
            packet = expand(entry["packet"], analysis_rows)
            if language == "python":
                parsed[language].update(x["path"] for x in packet["contexts"])
                selected_directories.update(packet.get("directories", []))
                for observation in packet["observations"]:
                    name, kind = observation["path"], observation["kind"]
                    if name in observed_kinds and observed_kinds[name] != kind:
                        fail("COMPONENT_OBSERVATIONS", "Language selections captured different original filesystem states", {"path": name})
                    observed_kinds[name] = kind
                    if name in analysis_rows and kind != "file":
                        fail("COMPONENT_OBSERVATIONS", "An original lookup contradicts a retained complete source member", {"path": name})
                    if kind == "missing" and any(path.startswith(name + "/") for path in analysis_rows):
                        fail("COMPONENT_OBSERVATIONS", "An original missing-directory lookup contradicts retained source", {"path": name})
                for seen in packet["contexts"]:
                    matches = [ctx for prefix, ctx in contexts.items()
                               if seen["path"] == prefix or seen["path"].startswith(prefix + "/")]
                    if not matches:
                        continue
                    declared = max(matches, key=lambda x: len(x["prefix"]))
                    original_roots = [r or "." for r in declared.get("import_roots", [])]
                    actual_roots = packet["selection"]["module_roots"]
                    if actual_roots[:len(original_roots)] != original_roots:
                        context_findings.append({"path": seen["path"], "selection_id": entry["id"],
                            "reason": "This selection changes the original context's leading import roots",
                            "declared": declared, "actual_roots": actual_roots})
                    if "installed_prefix" in declared and declared["installed_prefix"] != declared["prefix"]:
                        installed = declared["installed_prefix"].rstrip("/") + "/" + seen["path"][len(declared["prefix"]):].lstrip("/")
                        candidates = []
                        for r in actual_roots:
                            relative = installed if r == "." else installed[len(r) + 1:] if installed.startswith(r + "/") else None
                            if relative is not None:
                                name = relative[:-3]
                                if name.endswith("/__init__"):
                                    name = name[:-9]
                                candidates.append(name.replace("/", "."))
                        if seen["module"] not in candidates:
                            context_findings.append({"path": seen["path"], "selection_id": entry["id"],
                                "reason": "Parsed module does not retain its original installed-prefix context",
                                "declared": declared, "actual_module": seen["module"], "expected_modules": candidates})
            else:
                parsed[language].update(r["path"] for r in packet["files"]
                    if Path(r["path"]).suffix.lower() in {".mjs", ".js", ".cjs"})
                for computed in packet.get("computed", []):
                    matching = [(index, choice) for index, choice in enumerate(recipe.get("javascript_runtime", []))
                        if choice["selection_id"] == entry["id"] and choice["source"] == computed["source"]
                        and choice["range"] == computed["range"] and choice["expression"] == computed["expression"]]
                    if len(matching) != 1:
                        runtime_findings.append({"selection_id": entry["id"], **computed, "reason": "Choose the original runtime paths or explicit external runtime"})
                        continue
                    index, choice = matching[0]
                    if choice["source_sha256"] != analysis_rows[computed["source"]]["sha256"]:
                        fail("COMPONENT_RUNTIME", "Computed selection source bytes differ")
                    if any(path not in entry["packet"]["members"] for path in choice["paths"]):
                        fail("COMPONENT_RUNTIME", "Selected runtime paths must be included in this original language selection")
                    used_runtime.add(index)
            if not packet["coverage"]["complete"]:
                errors.append({"id": entry["id"], "language": language, "coverage": packet["coverage"],
                               "errors": packet.get("errors", []),
                               "computed": packet.get("computed", []), "pending": packet.get("pending", [])})
    if used_runtime != set(range(len(recipe.get("javascript_runtime", [])))):
        fail("COMPONENT_RUNTIME", "A runtime mapping has no exact original computed expression")
    aliases = {name.casefold(): name for name in analysis_rows}
    for name in sorted(selected_directories):
        if name in analysis_rows or (name.casefold() in aliases and aliases[name.casefold()] != name):
            fail("COMPONENT_DIRECTORY", "Selected namespace portions conflict with original family paths", {"path": name})
        aliases[name.casefold()] = name
    required_code = {name for name in rows if Path(name).suffix.lower() in CODE_SUFFIXES and name not in retained}
    uncovered = sorted(name for name in required_code if name not in parsed[
        "python" if name.endswith(".py") else "javascript"])
    retained_reached = sorted(name for name in retained if name in parsed["python"] or name in parsed["javascript"])
    return {"schema": REPORT, "complete": not (errors or runtime_findings or context_findings or uncovered or retained_reached or
                recipe.get("unresolved_contexts") or not inventory["ready"]),
            "members": len(rows), "source_bytes": sum(r["bytes"] for r in rows.values()),
            "parsed_python": sorted(parsed["python"]), "parsed_javascript": sorted(parsed["javascript"]),
            "uncovered_runtime_members": uncovered, "retained_only_reached_as_runtime": retained_reached,
            "unresolved_contexts": clone(recipe.get("unresolved_contexts", [])),
            "language_findings": errors, "javascript_runtime_findings": runtime_findings,
            "python_context_findings": context_findings, "directories": sorted(selected_directories), "component_inventory": inventory,
            "original_python_contexts": contexts, "retained_only": retained, "html_templates": templates}

def collect(root, recipe, *, edition, operation_id=None, against=None, node="node", temporary_parent=None):
    recipe = selection(recipe)
    root = Path(root).absolute()
    bank = assembly.export_family(root, recipe["components"], edition=edition,
                                  operation_id=operation_id, against=against, inspect_only=True)
    initial = clone(bank)
    rows = checked_rows(bank["files"])
    control_names = {row["path"] for row in bank["family_selection"]["declaration_sources"]}
    analyses = {"python": [], "javascript": []}
    tools = tools_identity()
    with tempfile.TemporaryDirectory(prefix="eco-source-collection-", dir=temporary_parent) as temporary:
        for language in analyses:
            for index, entry in enumerate(recipe.get(language, [])):
                working = Path(temporary) / (language + "-" + str(index))
                working.mkdir()
                packet = language_run(root, entry, language, working, node)
                for original in packet["files"]:
                    body = python_source.row_bytes(original)
                    name = original["path"]
                    # Declaration originals remain in their original provenance table.
                    if name in control_names:
                        declared = next(r for r in bank["family_selection"]["declaration_sources"] if r["path"] == name)
                        if document_bytes(declared) != body:
                            fail("COMPONENT_SOURCE_CHANGED", "A declaration changed during collection", {"path": name})
                        continue
                    fresh = assembly._family_member(root, name)
                    if document_bytes(fresh) != body or fresh["mode"] != original["mode"]:
                        fail("COMPONENT_SOURCE_CHANGED", "Collectors observed different original bytes", {"path": name})
                    if name in rows:
                        if any(rows[name].get(k) != fresh.get(k) for k in IDENTITY_KEYS):
                            fail("COMPONENT_SOURCE_CHANGED", "The selected family changed during collection", {"path": name})
                    else:
                        if against is not None:
                            target = Path(against).absolute().joinpath(*assembly.member_name(name).parts)
                            if target.exists() or target.is_symlink():
                                fresh["base_sha256"] = assembly._family_member(Path(against).absolute(), name)["sha256"]
                        rows[name] = fresh
                analyses[language].append({"id": entry["id"], "packet": compact(packet)})
        # Tools and every full family/source row are re-read at the closing boundary.
        if tools_identity() != tools:
            fail("COMPONENT_TOOLS_CHANGED", "Original collector tools changed during this operation")
        for name, expected in rows.items():
            actual = assembly._family_member(root, name, expected)
            if actual["mode"] != expected["mode"]:
                fail("COMPONENT_SOURCE_CHANGED", "Original member mode changed during collection", {"path": name})
        current_filesystem = python_source.FilesystemSource(root, python_source.selected_limits(None))
        for entry in analyses["python"]:
            for observation in entry["packet"]["analysis"]["observations"]:
                if current_filesystem._kind(observation["path"]) != observation["kind"]:
                    fail("COMPONENT_SOURCE_CHANGED", "An original positive/negative import lookup changed before publication", observation)
        repeated = assembly.export_family(root, recipe["components"], edition=edition,
            operation_id=operation_id, against=against, inspect_only=True)
        if canonical(repeated) != canonical(initial):
            fail("COMPONENT_SOURCE_CHANGED", "Original family declarations or selected source changed during collection")
        bank["files"] = [rows[name] for name in sorted(rows)]
        # Analysis-only declared originals also need their original full rows available to replay.
        bank["source_collection"] = {
            "schema": SCHEMA, "selection": recipe, "tools": tools,
            "seed_members": [row["path"] for row in initial["files"]],
            "seed_identity": {k: clone(v) for k, v in initial.items() if k != "files"},
            "analyses": analyses,
        }
        report = coverage(bank, recipe, analyses)
        bank["source_collection"]["report"] = report
        bank["state"] = "selected_family_complete" if report["complete"] else "selected_family_incomplete"
        bank["family_selection"]["component_inventory"] = report["component_inventory"]
        bank["source_ref"] = "collected-family:" + digest({k: v for k, v in bank.items() if k != "source_ref"})
        return bank

def inspect(bank, *, node="node", temporary_parent=None):
    if not isinstance(bank, dict) or bank.get("kind") != "upstate.selected-application-family/v1":
        fail("COMPONENT_BANK", "Open the complete original selected-family bank")
    collected = bank.get("source_collection")
    if not isinstance(collected, dict) or collected.get("schema") != SCHEMA:
        fail("COMPONENT_BANK", "This family has no complete source-collection selection")
    recipe = selection(collected.get("selection"))
    if tools_identity() != collected.get("tools"):
        fail("COMPONENT_TOOLS_CHANGED", "Use the complete original adapter/assembler/collector versions")
    rows = checked_rows(bank["files"])
    declarations = checked_rows(bank["family_selection"]["declaration_sources"])
    if set(rows) & set(declarations):
        fail("COMPONENT_DECLARATIONS", "Keep original declarations in their original provenance table")
    all_rows = {**rows, **declarations}
    seed_names = collected.get("seed_members")
    if not isinstance(seed_names, list) or len(set(seed_names)) != len(seed_names) or any(x not in rows for x in seed_names):
        fail("COMPONENT_SEED", "Retain every original family seed member")
    seed = {**clone(collected.get("seed_identity")), "files": [rows[name] for name in seed_names]}
    if seed["family_selection"]["requested_components"] != recipe["components"]:
        fail("COMPONENT_SEED", "The selection changes the original requested component family")
    # The seed retains its exact original author identity and original predecessor guards.
    expected_seed_ref = "family:" + digest({
        "selection": seed["family_selection"],
        "members": {r["path"]: {k: r[k] for k in IDENTITY_KEYS} for r in seed["files"]}})
    if seed.get("source_ref") != expected_seed_ref:
        fail("COMPONENT_SEED", "Original family source identity differs")
    if seed["family_selection"]["declaration_sources"] != bank["family_selection"]["declaration_sources"]:
        fail("COMPONENT_DECLARATIONS", "Original source declarations changed")
    analyses = collected.get("analyses")
    if not isinstance(analyses, dict) or set(analyses) != {"python", "javascript"}:
        fail("COMPONENT_ANALYSIS", "Retain both complete language selection lists")
    selected_names = set(seed_names)
    with tempfile.TemporaryDirectory(prefix="eco-source-inspect-", dir=temporary_parent) as temporary:
        for language in analyses:
            entries = analyses[language]
            expected = recipe.get(language, [])
            if not isinstance(entries, list) or len(entries) != len(expected):
                fail("COMPONENT_ANALYSIS", "Original language selection population differs")
            for index, (entry, spec) in enumerate(zip(entries, expected)):
                if entry.get("id") != spec["id"]:
                    fail("COMPONENT_ANALYSIS", "Original language selection order differs")
                packet = expand(entry["packet"], all_rows)
                if packet.get("selection") != spec["selection"]:
                    fail("COMPONENT_ANALYSIS", "Original language selection differs")
                selected_names.update(r["path"] for r in packet["files"] if r["path"] not in declarations)
                if language == "python":
                    python_source.inspect_source(packet)
                else:
                    work = Path(temporary) / (language + "-" + str(index))
                    work.mkdir()
                    javascript_inspect(packet, work, node)
        if set(rows) != selected_names:
            fail("COMPONENT_MEMBERS", "The family has omitted or unexplained additional source members")
        report = coverage(bank, recipe, analyses)
        if report != collected.get("report") or report["component_inventory"] != bank["family_selection"]["component_inventory"]:
            fail("COMPONENT_ANALYSIS", "Original complete source report differs")
        state = "selected_family_complete" if report["complete"] else "selected_family_incomplete"
        if bank.get("state") != state:
            fail("COMPONENT_STATE", "The family status differs from its original source coverage")
        expected_ref = "collected-family:" + digest({k: v for k, v in bank.items() if k != "source_ref"})
        if bank.get("source_ref") != expected_ref:
            fail("COMPONENT_IDENTITY", "The complete collected family identity differs")
        return report


def validate_composed_contexts(document, layers, directories):
    """The actual receiving tree must preserve each retained source lookup."""
    final_files = document["files"]
    final_metadata = document["file_metadata"]
    final_directories = {"."}
    final_directories.update(directories)
    for name in [*final_files, *directories]:
        parts = name.split("/")
        final_directories.update("/".join(parts[:i]) for i in range(1, len(parts)))
    if set(final_files) & final_directories:
        fail("COMPONENT_DIRECTORY", "A final source member also names an original directory")
    aliases = {name.casefold(): name for name in final_files}
    for name in sorted(final_directories):
        if name.casefold() in aliases and aliases[name.casefold()] != name:
            fail("COMPONENT_DIRECTORY", "Final source and namespace paths have a case alias", {"path": name})
        aliases[name.casefold()] = name
    for layer in layers:
        bank = layer.document
        collected = bank["source_collection"]
        originals = {**checked_rows(bank["files"]),
                     **checked_rows(bank["family_selection"]["declaration_sources"])}
        for language in ("python", "javascript"):
            for entry in collected["analyses"][language]:
                for name in entry["packet"]["members"]:
                    if name not in final_files:
                        fail("COMPONENT_RECEIVING_SOURCE", "A collected runtime member is absent from the final application",
                             {"selection_id": entry["id"], "path": name})
                    original = originals[name]
                    body = assembly.represented_body(final_files[name], final_metadata[name])
                    if body != document_bytes(original) or final_metadata[name].get("mode", "100644") != original.get("mode", "100644"):
                        fail("COMPONENT_RECEIVING_SOURCE", "A later source layer changes an originally analysed member",
                             {"selection_id": entry["id"], "path": name,
                              "expected_sha256": original["sha256"], "actual_sha256": assembly.sha256(body)})
                if language == "python":
                    analysis = entry["packet"]["analysis"]
                    for observation in analysis["observations"]:
                        name = observation["path"]
                        actual = "file" if name in final_files else "directory" if name in final_directories else "missing"
                        if actual != observation["kind"]:
                            fail("COMPONENT_RECEIVING_CONTEXT", "The complete receiving tree changes an original import lookup",
                                 {"selection_id": entry["id"], "path": name,
                                  "collected_kind": observation["kind"], "receiving_kind": actual})
                    for name in analysis.get("directories", []):
                        if name not in final_directories:
                            fail("COMPONENT_RECEIVING_CONTEXT", "An original namespace directory is absent", {"path": name})
    return {"families": len(layers), "namespace_directories": len(directories),
            "state": "original_source_contexts_preserved"}


def validate_received_contexts(destination, layers, directories):
    """Resume inspects the actual original directory, including additional files."""
    destination = Path(destination).absolute()
    for ancestor in (destination, *destination.parents):
        if ancestor.is_symlink():
            fail("COMPONENT_RECEIVING_ALIAS", "The receiving path contains a directory alias", {"path": str(ancestor)})
    actual = python_source.FilesystemSource(destination, python_source.selected_limits(None))
    for layer in layers:
        for entry in layer.document["source_collection"]["analyses"]["python"]:
            for observation in entry["packet"]["analysis"]["observations"]:
                kind = actual._kind(observation["path"])
                if kind != observation["kind"]:
                    fail("COMPONENT_RECEIVING_CONTEXT", "The actual received directory changes an original import lookup",
                         {"selection_id": entry["id"], "path": observation["path"],
                          "collected_kind": observation["kind"], "received_kind": kind})
    for name in directories:
        if actual._kind(name) != "directory":
            fail("COMPONENT_RECEIVING_CONTEXT", "An original namespace portion is not an ordinary received directory", {"path": name})
    return {"state": "original_physical_contexts_preserved"}

def assemble(base, banks, *, edition, operation_id=None, output=None, node="node", temporary_parent=None):
    """Replay collected source and invoke the original exact-guarded receiving API."""
    layers = [assembly.read_layer(base)]
    for file in banks:
        layer = assembly.read_layer(file)
        report = inspect(layer.document, node=node, temporary_parent=temporary_parent)
        if not report["complete"]:
            fail("COMPONENT_INCOMPLETE", "Resolve the full selected-family source findings before assembly", report)
        layers.append(layer)
    document = assembly.compose(layers, edition=edition, operation_id=operation_id)
    directories = sorted({name for layer in layers[1:]
        for name in layer.document["source_collection"]["report"]["directories"]})
    for name in directories:
        python_source.portable(name)
        if name in document["files"] or any(parent in document["files"]
                for parent in ("/".join(name.split("/")[:i]) for i in range(1, len(name.split("/"))))):
            fail("COMPONENT_DIRECTORY", "An original namespace directory conflicts with an assembled file", {"path": name})
    context_receipt = validate_composed_contexts(document, layers[1:], directories)
    document["component_source_collection"] = {
        "schema": SCHEMA, "original_assembly_source_ref": document["source_ref"],
        "families": [{"source_ref": layer.document["source_ref"],
                     "selection": layer.document["source_collection"]["selection"]} for layer in layers[1:]],
        "directories": directories, "context_receipt": context_receipt}
    document["source_ref"] = "assembly-collected:" + digest({
        "assembly": document["assembly"], "collection": document["component_source_collection"]})
    receipt = assembly.source_receipt(document, canonical(document))
    received = assembly.receive_directory(output, document, receipt) if output is not None else None
    if output is not None:
        # The original atomic source receive finishes first. Restore separately
        # recorded empty namespace portions in that same original new directory.
        # A interrupted directory continuation reuses the exact same source receipt.
        for name in directories:
            current = Path(output).absolute()
            for part in name.split("/"):
                current = current / part
                python_source.ordinary_directory(current)
        received["namespace_directories"] = len(directories)
        received["context_receipt"] = validate_received_contexts(output, layers[1:], directories)
    return document, receipt, received

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    plan_cli = sub.add_parser("plan")
    plan_cli.add_argument("root")
    plan_cli.add_argument("--component", action="append", required=True)
    plan_cli.add_argument("--label", required=True)
    plan_cli.add_argument("--output", required=True)
    collect_cli = sub.add_parser("collect")
    collect_cli.add_argument("root")
    collect_cli.add_argument("--selection", required=True)
    collect_cli.add_argument("--edition", required=True)
    collect_cli.add_argument("--operation-id")
    collect_cli.add_argument("--against")
    collect_cli.add_argument("--output", required=True)
    inspect_cli = sub.add_parser("inspect")
    inspect_cli.add_argument("bank")
    assemble_cli = sub.add_parser("assemble")
    assemble_cli.add_argument("base")
    assemble_cli.add_argument("--bank", action="append", required=True)
    assemble_cli.add_argument("--edition", required=True)
    assemble_cli.add_argument("--operation-id")
    assemble_cli.add_argument("--map-output", required=True)
    assemble_cli.add_argument("--output", required=True)
    for cmd in (collect_cli, inspect_cli, assemble_cli):
        cmd.add_argument("--node", default="node")
        cmd.add_argument("--temporary-parent")
    args = parser.parse_args(argv)
    if args.command == "plan":
        result = plan(args.root, args.component, args.label)
        receipt = python_source.publish(args.output, python_source.json_bytes(result["selection"]))
        print(json.dumps({"selection": receipt, **{k: v for k, v in result.items() if k != "selection"}}, ensure_ascii=False))
        return 0
    if args.command == "collect":
        recipe, _ = python_source.read_packet(args.selection)
        bank = collect(args.root, recipe, edition=args.edition, operation_id=args.operation_id,
                       against=args.against, node=args.node, temporary_parent=args.temporary_parent)
        raw = canonical(bank)
        if len(raw) > assembly.MAX_BYTES:
            fail("COMPONENT_LIMIT", "The complete collected bank exceeds the original receiving limit")
        receipt = python_source.publish(args.output, raw)
        report = bank["source_collection"]["report"]
        print(json.dumps({"bank": receipt, "report": report}, ensure_ascii=False))
        return 0 if report["complete"] else 2
    if args.command == "inspect":
        bank = assembly.read_layer(args.bank).document
        report = inspect(bank, node=args.node, temporary_parent=args.temporary_parent)
        print(json.dumps(report, ensure_ascii=False))
        return 0 if report["complete"] else 2
    document, receipt, received = assemble(args.base, args.bank, edition=args.edition,
        operation_id=args.operation_id, output=args.output, node=args.node,
        temporary_parent=args.temporary_parent)
    written = python_source.publish(args.map_output, canonical(document))
    print(json.dumps({"map": written, "receipt": receipt, "receiving": received}, ensure_ascii=False))
    return 0

if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, OSError, python_source.SourceError) as error:
        print(json.dumps({"status": "ERROR", "code": getattr(error, "code", type(error).__name__),
                          "message": str(error), "detail": getattr(error, "detail", None)},
                         ensure_ascii=False), file=sys.stderr)
        raise SystemExit(1)
