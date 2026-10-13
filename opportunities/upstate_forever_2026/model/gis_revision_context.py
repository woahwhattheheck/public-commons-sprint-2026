"""Frozen original run revision -> registered context -> native editable GIS."""
from __future__ import annotations

from copy import deepcopy
import html
import json
import os
from pathlib import Path
import tempfile

from .common import digest, identifier, verify_file
from . import gis_project as gis
from .gis_study_context import history_choices, _history

VERSION = "run-revision-gis/v1"
ROOT = "gis-revision-contexts"
SCHEMA = "upstate.gis-run-revision-context/v1"


def binding(value):
    if not isinstance(value, dict) or set(value) - {"revision_id", "handover_sha256", "execution_history"}:
        raise ValueError("Preview the original run revision before GIS export")
    result = {name: identifier(value[name]) for name in ("revision_id", "handover_sha256")}
    if "execution_history" in value:
        chosen = value["execution_history"]
        if not isinstance(chosen, dict) or set(chosen) != {"id", "files_sha256"}:
            raise ValueError("Choose the exact retained execution-history edition")
        result["execution_history"] = {key: identifier(chosen[key]) for key in ("id", "files_sha256")}
    return result


def _pair(workspace, handover):
    body = {key: value for key, value in handover.items() if key != "sha256"}
    if (handover.get("schema") != "upstate.run-revision-handover/v1"
            or handover.get("project_id") != workspace.project["id"]
            or digest(body) != handover.get("sha256")):
        raise ValueError("Use the complete checked revision handover from this original project")
    revision, records = handover["record"], handover["records"]
    identifier(revision["id"])
    baseline, revised, comparison = records["baseline"], records.get("run"), records.get("comparison")
    if (not revised or not comparison or baseline.get("state") != "complete"
            or revised.get("state") != "complete" or baseline["id"] == revised["id"]
            or revision["baseline_run_id"] != baseline["id"]
            or comparison.get("baseline_run_id") != baseline["id"]
            or [row["run_id"] for row in comparison.get("alternatives", [])] != [revised["id"]]):
        raise ValueError("Complete the original reference, distinct revised run and their saved comparison")
    if baseline["selection"]["grid_id"] != revised["selection"]["grid_id"]:
        raise ValueError("The reference and revised run must retain the same original grid")
    from .model_selection import selected
    if selected(baseline["selection"]) != selected(revised["selection"]):
        raise ValueError("The reference and revision must retain the same native model cohort")
    contexts = {"grids": {}, "profiles": {}, "scenarios": {}}
    for run in (baseline, revised):
        actual = workspace.inspect_run(identifier(run["id"]))
        if (actual.get("state") != "complete" or actual["selection"] != run["selection"]
                or actual.get("artifacts", {}) != run.get("artifacts", {})
                or actual.get("stages", {}).get("landcover") != run.get("stages", {}).get("landcover")):
            raise ValueError("The original revision inputs or physical result descriptors changed")
        for family, field in (("profiles", "profile_id"), ("scenarios", "scenario_id")):
            key = run["selection"][field]
            contexts[family][key] = workspace._get(family, key)
        key = run["selection"]["grid_id"]
        contexts["grids"][key] = workspace.get_grid(key)
    if workspace.retained_item("comparisons", comparison["id"]) != comparison:
        raise ValueError("The original reference-first comparison changed")
    if (contexts["grids"][revised["selection"]["grid_id"]] != records["grid"]
            or contexts["profiles"][revised["selection"]["profile_id"]] != records["profile"]
            or contexts["scenarios"][revised["selection"]["scenario_id"]] != records["scenario"]):
        raise ValueError("The complete revision handover differs from its retained native inputs")
    return [baseline, revised], comparison, contexts


def _history_context(workspace, runs, contexts, history_id):
    history = _history(required=True)
    record = history.inspect(workspace, identifier(history_id))
    run_ids = [run["id"] for run in runs]
    if (record["project_id"] != workspace.project["id"]
            or len(record["selection"]["run_ids"]) != 2
            or set(record["selection"]["run_ids"]) != set(run_ids)):
        raise ValueError("Select a saved execution history for exactly this reference and revised run")
    directory = workspace.root / history.ROOT / record["id"]
    originals = json.loads(verify_file(directory, record["files"]["originals.json"]).read_text(encoding="utf-8"))
    frozen = {row["id"]: row for row in originals["runs"]}
    if len(frozen) != 2 or len(originals["runs"]) != 2 or set(frozen) != set(run_ids):
        raise ValueError("The retained history changed its original run pair")
    for run in runs:
        observed = frozen[run["id"]]
        if (observed.get("state") != "complete" or observed["selection"] != run["selection"]
                or observed.get("artifacts", {}) != run.get("artifacts", {})
                or observed.get("stages", {}).get("landcover") != run.get("stages", {}).get("landcover")):
            raise ValueError("History and revision retain different original scientific inputs or results")
    if originals["contexts"] != contexts:
        raise ValueError("History and revision retain different original grid, profile or scenario records")
    files = {}
    for name, descriptor in record["files"].items():
        path = verify_file(directory, descriptor)
        files[name] = gis.record(workspace.root, path)
    return {"binding": {"id": record["id"], "files_sha256": gis.fingerprint(files)},
            "title": record["title"], "captured_at": record["captured_at"],
            "summary": deepcopy(record["summary"]), "files": files}


def preview(workspace, handover, execution_history_id=None):
    runs, comparison, contexts = _pair(workspace, handover)
    revision = handover["record"]
    chosen = {"revision_id": revision["id"], "handover_sha256": handover["sha256"]}
    history = None
    if execution_history_id:
        history = _history_context(workspace, runs, contexts, execution_history_id)
        chosen["execution_history"] = history["binding"]
    return {"schema": "upstate.gis-run-revision-preview/v1", "project_id": workspace.project["id"],
            "title": revision["title"], "binding": chosen,
            "baseline_run_id": runs[0]["id"], "revised_run_id": runs[1]["id"],
            "grid_id": runs[0]["selection"]["grid_id"], "comparison_id": comparison["id"],
            "direction": deepcopy(comparison.get("direction")),
            "models": deepcopy(runs[0]["selection"].get("models")),
            "quantities": {role: {name: item.get("units") for name, item in run.get("artifacts", {}).items()}
                           for role, run in zip(("reference", "revision"), runs)},
            "execution_histories": history_choices(workspace, [run["id"] for run in runs]),
            "selected_execution_history": ({key: deepcopy(history[key]) for key in
                                           ("binding", "title", "captured_at", "summary")} if history else None),
            "interpretation": "Original reference first; revised run second. Original annual quantities, reporting support and comparison direction are preserved. No model is executed or result rescaled."}


def _write(path, body):
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        if path.read_bytes() != body:
            raise ValueError("A frozen revision context member changed: " + path.name)
        return
    with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".revision-", delete=False) as stream:
        temporary = Path(stream.name)
        try:
            stream.write(body)
            stream.flush()
            os.fsync(stream.fileno())
        except BaseException:
            temporary.unlink(missing_ok=True)
            raise
    try:
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def _page(handover, runs, comparison, history):
    esc = lambda value: html.escape(str(value), quote=True)
    title = handover["record"]["title"]
    rows = "".join("<tr><th>" + role + "</th><td><code>" + esc(run["id"]) +
                   "</code></td><td><code>" + esc(run["selection"]["profile_id"]) +
                   "</code></td><td><code>" + esc(run["selection"]["scenario_id"]) + "</code></td></tr>"
                   for role, run in zip(("Original reference", "Revised run"), runs))
    quantities = {role: {name: item.get("units") for name, item in run.get("artifacts", {}).items()}
                  for role, run in zip(("reference", "revision"), runs)}
    history_link = ('<p><a href="history/index.html">Open the explicitly selected execution history</a> · captured ' +
                    esc(history["captured_at"]) + '</p>') if history else '<p>No additional execution history was selected.</p>'
    return ('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">'
            '<title>' + esc(title) + '</title><style>body{font:16px/1.55 system-ui;margin:0 auto;padding:32px;max-width:1100px;color:#222;background:#fafafa}'
            'h1{line-height:1.15}a{color:#222}table{border-collapse:collapse;width:100%}td,th{padding:12px;border:1px solid #bbb;text-align:left}'
            'code,pre{overflow-wrap:anywhere;white-space:pre-wrap;font-size:13px}.scroll{overflow:auto}section{margin:28px 0}</style>'
            '<h1>' + esc(title) + '</h1><p>Saved original run revision and editable GIS context</p>'
            '<p>The reference remains first and the revision remains the alternative. No model was executed by this export. '
            'Original raster values, masks, units and comparison direction remain unchanged. Annual mass is not concentration.</p>'
            '<div class="scroll"><table><tr><th>Role</th><th>Run</th><th>Parameter profile</th><th>Land-cover scenario</th></tr>' +
            rows + '</table></div><section><h2>Original comparison</h2><pre>' +
            esc(json.dumps({"id": comparison["id"], "direction": comparison.get("direction")}, ensure_ascii=False, indent=2)) +
            '</pre><h2>Declared original artifact units</h2><pre>' + esc(json.dumps(quantities, ensure_ascii=False, indent=2)) +
            '</pre></section><section><h2>Inspect and reuse the original choices</h2>'
            '<p><a href="revision.json">Complete native revision JSON</a> retains accepted task requests and results. '
            '<a href="native-inputs.json">Original inputs and role binding</a> retains both parameter profiles, both scenarios and the grid.</p>'
            '<p>Reopen revision.json through Run revisions in the same original or restored Workspace. The full editable GIS archive '
            'contains the selected original physical layers and companions; use the full Workspace backup to retain the runnable application.</p>' +
            history_link + '</section></html>\n').encode("utf-8")


def _selection(handover, runs, comparison, collection_id):
    return {"title": handover["record"]["title"] + " · reference and revision",
            "sources": [{"source_collection_id": collection_id, "source_id": "run-revision-context"}],
            "grid_id": runs[0]["selection"]["grid_id"], "baseline_run_id": runs[0]["id"],
            "scenario_run_ids": [runs[1]["id"]], "comparison_ids": [comparison["id"]], "include_grid": True,
            "notes": ["Original run revision " + handover["record"]["id"],
                      "Reference first; revised run second. Original support, annual physical quantities and comparison direction retained."]}


def _frozen(workspace, directory, chosen):
    record = gis.load(directory / "context.json")
    expected_id = gis.fingerprint({"schema": SCHEMA, "version": VERSION,
                                   "project_id": workspace.project["id"], "binding": chosen})
    if (record.get("schema") != SCHEMA or record.get("version") != VERSION
            or record.get("project_id") != workspace.project["id"] or record.get("binding") != chosen
            or record.get("id") != directory.name or directory.name != expected_id):
        raise ValueError("The retained GIS revision context belongs to another original selection")
    for descriptor in record["files"].values():
        gis.checked(directory, descriptor)
    handover = gis.load(gis.checked(directory, record["files"]["revision.json"]))
    if handover["record"]["id"] != chosen["revision_id"] or handover["sha256"] != chosen["handover_sha256"]:
        raise ValueError("The frozen context changed the selected original handover")
    runs, comparison, contexts = _pair(workspace, handover)
    if gis.load(gis.checked(directory, record["files"]["native-inputs.json"])) != {
            "project_id": workspace.project["id"], "binding": chosen,
            "roles": {"reference": runs[0]["id"], "revision": runs[1]["id"]},
            "comparison": comparison, "contexts": contexts}:
        raise ValueError("The frozen revision input binding changed")
    collection = workspace._get("sources", record["source_collection_id"])
    if collection["entries"] != record["source_entries"] or len(collection["entries"]) != 1:
        raise ValueError("The registered revision context source changed")
    entry = collection["entries"][0]
    provenance = entry.get("provenance", {})
    if (entry["id"] != "run-revision-context" or entry["kind"] != "document"
            or provenance.get("context_id") != expected_id
            or any(provenance.get(name) != value for name, value in chosen.items())
            or entry["body"]["sha256"] != record["files"]["index.html"]["sha256"]
            or record["selection"] != _selection(handover, runs, comparison, collection["id"])):
        raise ValueError("The frozen context changed its registered source or original GIS role selection")
    members = [name for name in sorted(record["files"]) if name not in {"index.html", "sources.json"}]
    if [(row["sha256"], row["bytes"]) for row in entry.get("companions", [])] != [
            (record["files"][name]["sha256"], record["files"][name]["bytes"]) for name in members]:
        raise ValueError("The registered context changed its complete ordered companion identity")
    return record


def resolve(workspace, chosen, handover_loader):
    """Capture once inside the original GIS queue; reuse the same frozen source on retry."""
    chosen = binding(chosen)
    key = gis.fingerprint({"schema": SCHEMA, "version": VERSION,
                           "project_id": workspace.project["id"], "binding": chosen})
    directory = workspace.root / ROOT / key
    if (directory / "context.json").is_file():
        return _frozen(workspace, directory, chosen)
    handover = handover_loader(chosen["revision_id"])
    if handover["record"]["id"] != chosen["revision_id"] or handover["sha256"] != chosen["handover_sha256"]:
        raise ValueError("The revision changed after preview; reopen its current handover before export")
    runs, comparison, contexts = _pair(workspace, handover)
    history = None
    if chosen.get("execution_history"):
        history = _history_context(workspace, runs, contexts, chosen["execution_history"]["id"])
        if history["binding"] != chosen["execution_history"]:
            raise ValueError("The selected execution history changed after preview")
    directory.mkdir(parents=True, exist_ok=True)
    _write(directory / "revision.json", gis.canonical(handover) + b"\n")
    _write(directory / "native-inputs.json", gis.canonical({
        "project_id": workspace.project["id"], "binding": chosen,
        "roles": {"reference": runs[0]["id"], "revision": runs[1]["id"]},
        "comparison": comparison, "contexts": contexts}) + b"\n")
    _write(directory / "index.html", _page(handover, runs, comparison, history))
    members = ["revision.json", "native-inputs.json"]
    if history:
        history_module = _history(required=True)
        history_root = workspace.root / history_module.ROOT / history["binding"]["id"]
        for descriptor in history["files"].values():
            source = gis.checked(workspace.root, descriptor)
            relative = source.relative_to(history_root).as_posix()
            target = directory / "history" / gis.member(relative)
            gis.copy_checked(workspace.root, descriptor, target)
            members.append(target.relative_to(directory).as_posix())
    members = sorted(set(members))
    captured_at = handover["record"].get("updated_at") or handover["record"]["created_at"]
    provenance = {"schema": SCHEMA, "version": VERSION, "context_id": key, **deepcopy(chosen),
                  "project_id": workspace.project["id"],
                  "roles": {"reference": runs[0]["id"], "revision": runs[1]["id"]},
                  "comparison_id": comparison["id"], "direction": deepcopy(comparison.get("direction"))}
    manifest = {"schema": "upstate.sources/v1", "title": handover["record"]["title"] + " · GIS revision context",
                "captured_at": captured_at, "scope": {"kind": "original run revision", **provenance},
                "entries": [{"id": "run-revision-context", "kind": "document",
                    "title": handover["record"]["title"] + " · original revision and inputs",
                    "path": "index.html", "sha256": gis.sha256(directory / "index.html"),
                    "uri": "upstate:run-revision:" + chosen["revision_id"], "vintage": captured_at,
                    "role": "RUN_REVISION_CONTEXT", "units": None, "provenance": provenance,
                    "companions": [{"path": name, "sha256": gis.sha256(directory / name)} for name in members]}]}
    _write(directory / "sources.json", gis.canonical(manifest) + b"\n")
    collection = workspace.import_sources(directory / "sources.json")
    selection = _selection(handover, runs, comparison, collection["id"])
    names = ["index.html", *members, "sources.json"]
    record = {"schema": SCHEMA, "version": VERSION, "id": key, "project_id": workspace.project["id"],
              "binding": chosen, "source_collection_id": collection["id"],
              "source_entries": deepcopy(collection["entries"]), "selection": selection,
              "files": {name: gis.record(directory, directory / name) for name in names}}
    _write(directory / "context.json", gis.canonical(record) + b"\n")
    return _frozen(workspace, directory, chosen)
