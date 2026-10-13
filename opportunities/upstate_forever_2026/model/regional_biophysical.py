"""Regional source library joined to original profile, evidence and experiment writers."""
from __future__ import annotations
import copy
import csv
import hashlib
import html
import io
import json
from pathlib import Path
import zipfile
from .common import (INVEST_VERSION, atomic_bytes, atomic_json, canonical, digest,
                     file_digest, held, identifier, read_json, selected_models)
from . import experiment_profiles as profiles
from . import biophysical_evidence as evidence

SCHEMA = "upstate.regional-biophysical-library/v1"
DEFINITION = "upstate.regional-biophysical-selection/v1"
KIND = "regional-biophysical-profiles"
ROOT = Path(__file__).resolve().parents[1] / "source" / "regional-biophysical-20261013"
CLASSIFICATIONS = {"published_model_input", "published_default", "measured_plot_runoff",
                   "application_rate", "operator_hypothesis"}
SOURCE_FIELDS = {"title", "uri", "locator", "period", "geography", "management",
                 "method", "classification", "notes"}

def text(value, label, required=True):
    if not isinstance(value, str) or (required and not value.strip()):
        raise ValueError(label + " must be " + ("nonempty " if required else "") + "text")
    return value

def obj(value, fields, label):
    if not isinstance(value, dict) or set(value) - set(fields):
        raise ValueError("Unsupported " + label + " fields")
    return value

def source(value):
    obj(value, SOURCE_FIELDS, "coefficient source")
    result = {key: text(value.get(key, ""), key, key != "notes") for key in SOURCE_FIELDS}
    if result["classification"] not in CLASSIFICATIONS:
        raise ValueError("Catchment export, event concentration and unqualified ranges are not native parameter inputs")
    if not result["uri"].startswith(("https://", "http://", "urn:")):
        raise ValueError("Retain an original source URI")
    return result

def entry(value):
    obj(value, ("id", "target", "lucode", "land_cover", "value", "units",
                "load_type", "range", "source"), "library entry")
    key = text(value.get("id"), "Entry ID")
    target = value.get("target")
    if target not in profiles.PARAMETERS or target.startswith("table.load_type_"):
        raise ValueError("Select an original numeric coefficient or supported native setting")
    rule = profiles.PARAMETERS[target]
    if value.get("units") != rule["units"]:
        raise ValueError("Retain the exact native units for " + target)
    literal = value.get("value")
    if (not isinstance(literal, (str, int, float)) or isinstance(literal, bool)) and not (target == "ndr.runoff_proxy_av" and literal is None):
        raise ValueError("Retain a finite native coefficient or exact method")
    checked = profiles._value(target, literal)
    code = value.get("lucode")
    if target.startswith("table."):
        if type(code) is not int:
            raise ValueError("A table coefficient needs its original integer land-cover code")
    elif code is not None:
        raise ValueError("An algorithm setting does not select a land-cover code")
    citation = source(value.get("source"))
    load_type = value.get("load_type")
    if target in ("table.load_n", "table.load_p"):
        if load_type not in ("application-rate", "measured-runoff"):
            raise ValueError("Each load needs an explicit native interpretation")
        if citation["classification"] == "application_rate" and load_type != "application-rate":
            raise ValueError("Application-rate evidence must retain its native application-rate interpretation")
        if citation["classification"] == "measured_plot_runoff" and load_type != "measured-runoff":
            raise ValueError("Measured plot runoff must enter directly")
    elif load_type is not None:
        raise ValueError("Only load coefficients carry a load interpretation")
    interval = value.get("range")
    if interval is not None:
        obj(interval, ("lower", "upper", "basis"), "sourced range")
        lower, upper = (profiles._value(target, interval[k]) for k in ("lower", "upper"))
        if isinstance(checked, str) or lower > checked or checked > upper:
            raise ValueError("A sourced numeric range must contain its stated central coefficient")
        text(interval.get("basis"), "Range basis")
    return copy.deepcopy({**value, "lucode": code, "land_cover": value.get("land_cover"),
                          "load_type": load_type, "range": interval, "source": citation})

def validate_library(value):
    obj(value, ("schema", "title", "edition", "native_version", "notes", "originals",
                "entries", "families", "context_sources"), "regional library")
    if value.get("schema") != SCHEMA or value.get("native_version") != INVEST_VERSION:
        raise ValueError("Use the exact retained native-version library")
    text(value.get("title"), "Library title"); text(value.get("edition"), "Library edition")
    if not isinstance(value.get("entries"), list) or not value["entries"]:
        raise ValueError("Retain original library entries")
    values = [entry(row) for row in value["entries"]]
    by_id = {row["id"]: row for row in values}
    if len(by_id) != len(values):
        raise ValueError("Library entry IDs must be unique")
    families = value.get("families")
    if not isinstance(families, list) or not families:
        raise ValueError("Retain explicitly selected profile families")
    seen = set()
    for family in families:
        obj(family, ("id", "title", "entry_ids", "interpretation"), "profile family")
        fid = text(family.get("id"), "Family ID")
        if fid in seen: raise ValueError("Family IDs must be unique")
        seen.add(fid); text(family.get("title"), "Family title")
        text(family.get("interpretation"), "Family interpretation")
        ids = family.get("entry_ids")
        if not isinstance(ids, list) or not ids or len(set(ids)) != len(ids) or set(ids) - set(by_id):
            raise ValueError("Family selection must identify distinct original library entries")
        cells = [(by_id[k]["target"], by_id[k].get("lucode")) for k in ids]
        if len(set(cells)) != len(cells):
            raise ValueError("A family cannot change the same scientific cell twice")
    for key in ("notes", "originals", "context_sources"):
        if not isinstance(value.get(key, []), list):
            raise ValueError("Retain " + key + " as a list")
    canonical(value)
    return copy.deepcopy({**value, "entries": values})

def _builtin():
    raw = (ROOT / "library.json").read_bytes()
    value = validate_library(json.loads(raw))
    for item in value["originals"]:
        if set(item) != {"path", "bytes", "sha256"} or Path(item["path"]).name != item["path"]:
            raise ValueError("Use a named original library companion")
        body = (ROOT / item["path"]).read_bytes()
        if len(body) != item["bytes"] or hashlib.sha256(body).hexdigest() != item["sha256"]:
            raise ValueError("A bundled original coefficient source changed")
    return value, raw

def _library(workspace, binding):
    obj(binding, ("builtin_sha256", "source_collection_id", "source_id"), "library binding")
    if set(binding) == {"builtin_sha256"}:
        value, raw = _builtin()
        if hashlib.sha256(raw).hexdigest() != binding["builtin_sha256"]:
            raise ValueError("The installed source library changed; reopen the exact intended edition")
        return value, {"sha256": binding["builtin_sha256"], "bytes": len(raw), "builtin": True}, raw
    if set(binding) != {"source_collection_id", "source_id"}:
        raise ValueError("Select either the installed exact library or an original retained source")
    path, item = workspace.source_file(binding["source_collection_id"], binding["source_id"])
    if item["kind"] != "document":
        raise ValueError("Import library JSON as an original document source")
    raw = path.read_bytes()
    value = validate_library(json.loads(raw))
    # Companion descriptions are verified against the same original collection.
    parts = [item["body"], *item.get("companions", [])]
    for expected in value["originals"]:
        matches = [part for part in parts if part["sha256"] == expected["sha256"]
                   and part["bytes"] == expected["bytes"]]
        if len(matches) != 1:
            raise ValueError("Retain every declared original source companion with this library")
        from .common import relative_file
        original = relative_file(workspace.root, matches[0]["object"])
        if file_digest(original) != expected["sha256"] or original.stat().st_size != expected["bytes"]:
            raise ValueError("An original library companion changed")
    return value, {**binding, "sha256": item["body"]["sha256"],
                   "bytes": item["body"]["bytes"], "builtin": False}, raw

def catalog(workspace, baseline_profile_id=None):
    value, raw = _builtin()
    result = {"schema": "upstate.regional-biophysical-catalog/v1",
              "workspace_id": workspace.project["id"], "project": workspace.project,
              "library": value, "library_binding": {"builtin_sha256": hashlib.sha256(raw).hexdigest()},
              "profiles": workspace._list("profiles"),
              "selections": workspace._list(KIND),
              "source_libraries": [{"collection_id": collection["id"], "id": item["id"],
                                   "title": item["title"], "sha256": item["body"]["sha256"]}
                                  for collection in workspace._list("sources")
                                  for item in collection["entries"] if item["kind"] == "document"]}
    if baseline_profile_id:
        base, original, table = profiles._base(workspace, baseline_profile_id)
        result.update(baseline=base, table=table, table_source=original)
    return result

def read_library(workspace, binding):
    value, identity, _ = _library(workspace, binding)
    return {"library": value, "identity": identity}

def preview(workspace, definition):
    obj(definition, ("schema", "baseline_profile_id", "library", "family_id", "title", "reason",
                     "applicability_note", "selected_entry_ids", "edits"), "regional selection")
    if definition.get("schema") != DEFINITION:
        raise ValueError("Use a regional biophysical selection")
    text(definition.get("title"), "Selection title")
    text(definition.get("reason"), "Scientific purpose")
    text(definition.get("applicability_note"), "Regional applicability decision")
    base, original, table = profiles._base(workspace, definition.get("baseline_profile_id"))
    library, identity, _ = _library(workspace, definition.get("library"))
    families = [x for x in library["families"] if x["id"] == definition.get("family_id")]
    if len(families) != 1: raise ValueError("Choose a retained library family")
    selected = definition.get("selected_entry_ids")
    if (not isinstance(selected, list) or not selected or len(set(selected)) != len(selected)
            or set(selected) - set(families[0]["entry_ids"])):
        raise ValueError("Select explicit distinct entries from the retained family")
    original_entries = {x["id"]: x for x in library["entries"]}
    edits = definition.get("edits", [])
    if not isinstance(edits, list): raise ValueError("Edits must be a list")
    edited = {}
    for change in edits:
        obj(change, ("entry_id", "value", "load_type", "source", "range", "reason"), "explicit coefficient edit")
        key = change.get("entry_id")
        if key not in selected or key in edited:
            raise ValueError("Each edit must bind one selected original entry")
        text(change.get("reason"), "Edit rationale")
        changed = copy.deepcopy(original_entries[key])
        for name in ("value", "load_type", "source", "range"):
            if name in change: changed[name] = copy.deepcopy(change[name])
        if "source" not in change:
            raise ValueError("An edited coefficient needs its own source or explicit hypothesis attribution")
        edited[key] = entry(changed)
    active = selected_models(base)
    codes = set(table["lucodes"])
    chosen, factors, occupied = [], [], set()
    for key in selected:
        current = edited.get(key, original_entries[key])
        target, code = current["target"], current.get("lucode")
        if profiles._target_model(target) not in active or (code is not None and code not in codes):
            raise ValueError("Selected source entry is outside the original profile model/code scope: " + key)
        if (target, code) in occupied: raise ValueError("Two selected entries change the same scientific cell")
        occupied.add((target, code))
        value = profiles._value(target, current["value"])
        rationale = (next(x["reason"] for x in edits if x["entry_id"] == key)
                     if key in edited else current["source"]["method"])
        references = [current["source"]["uri"], profiles.PARAMETERS[target]["reference"]]
        factor = {"name": key, "target": target,
                  "levels": [{"label": str(current["value"]), "value": value,
                              "references": references,
                              "reason": rationale + " Regional applicability: " + definition["applicability_note"]}]}
        if code is not None: factor["lucodes"] = [code]
        factors.append(factor)
        if target in ("table.load_n", "table.load_p"):
            factors.append({"name": key + "-load-basis", "target": "table.load_type_" + target[-1],
                            "lucodes": [code], "levels": [{
                                "label": current["load_type"], "value": current["load_type"],
                                "references": references,
                                "reason": current["source"]["notes"] + " No pre-reduction; original native model owns interpretation."}]})
        chosen.append({"entry": current, "original_entry": original_entries[key],
                       "edited": key in edited, "rationale": rationale})
    spec = {"title": definition["title"], "reason": definition["reason"],
            "baseline_profile_id": base["id"], "design": "factorial", "factors": factors}
    proposed = profiles.preview(workspace, spec)
    if proposed["derived_profile_count"] > 1:
        raise ValueError("A selected family must compose one joined profile")
    result = {"schema": "upstate.regional-biophysical-preview/v1",
              "workspace_id": workspace.project["id"], "definition": copy.deepcopy(definition),
              "library": identity, "family": families[0], "selected_entries": chosen,
              "baseline_profile_id": base["id"], "baseline_table_sha256": original["body"]["sha256"],
              "baseline_table_bytes": original["body"]["bytes"], "models": active,
              "source_profile_spec": spec, "profile_preview": proposed,
              "inherited_fields": "All unselected table cells and native settings retain the original baseline values. Their existing provenance is not replaced.",
              "interpretation": "Published input/default choices and explicit hypotheses are not local calibration. Native execution remains with model.experiments."}
    result["preview_sha256"] = digest(result)
    return result

def _retain_library(workspace, definition, directory):
    library, identity, raw = _library(workspace, definition["library"])
    if not identity["builtin"]: return definition["library"]
    atomic_bytes(directory / "library.json", raw, immutable=True)
    companions = []
    for item in library["originals"]:
        atomic_bytes(directory / item["path"], (ROOT / item["path"]).read_bytes(), immutable=True)
        companions.append({"path": item["path"]})
    manifest = {"schema": "upstate.sources/v1", "title": library["title"],
                "entries": [{"id": "regional-library", "kind": "document", "title": library["title"],
                             "path": "library.json", "sha256": identity["sha256"],
                             "uri": "urn:upstate:regional-library:" + identity["sha256"],
                             "vintage": library["edition"], "companions": companions}]}
    atomic_json(directory / "sources.json", manifest, immutable=True)
    saved = workspace.import_sources(directory / "sources.json")
    return {"source_collection_id": saved["id"], "source_id": "regional-library"}

def _evidence(workspace, profile_id, proposed, directory):
    profile, item, table, cells = evidence._context(workspace, profile_id)
    rows = []
    for selected in proposed["selected_entries"]:
        value = selected["entry"]
        if not value["target"].startswith("table.") or value["target"].split(".", 1)[1] not in evidence.NUMERIC_FIELDS:
            continue
        field = value["target"].split(".", 1)[1]
        cell = cells[(value["lucode"], field)]
        citation = value["source"]
        interval = value["range"]
        rows.append({"lucode": value["lucode"], "parameter": field,
                     "value": cell["table_value_text"], "units": value["units"],
                     "load_type": cell["load_type"] or "",
                     "source_title": citation["title"], "source_uri": citation["uri"],
                     "source_locator": citation["locator"], "source_period": citation["period"],
                     "lower": interval["lower"] if interval else "",
                     "upper": interval["upper"] if interval else "",
                     "range_basis": interval["basis"] if interval else "",
                     "notes": json.dumps({"geography": citation["geography"], "management": citation["management"],
                                          "method": citation["method"], "classification": citation["classification"],
                                          "notes": citation["notes"], "regional_selection": proposed["preview_sha256"],
                                          "rationale": selected["rationale"]}, ensure_ascii=False)})
    if not rows: return None
    out = io.StringIO(newline="")
    writer = csv.DictWriter(out, fieldnames=evidence.CSV_FIELDS, lineterminator="\n")
    writer.writeheader(); writer.writerows(rows)
    raw = out.getvalue().encode("utf-8")
    atomic_bytes(directory / "coefficient-evidence.csv", raw, immutable=True)
    manifest = {"schema": "upstate.sources/v1", "title": proposed["definition"]["title"] + " coefficient evidence",
                "entries": [{"id": "regional-evidence", "kind": "table",
                             "title": proposed["definition"]["title"] + " selected original cells",
                             "path": "coefficient-evidence.csv", "sha256": hashlib.sha256(raw).hexdigest(),
                             "uri": "urn:upstate:regional-evidence:" + proposed["preview_sha256"],
                             "vintage": "Retained published edition and explicit operator source choices"}]}
    atomic_json(directory / "evidence-sources.json", manifest, immutable=True)
    collection = workspace.import_sources(directory / "evidence-sources.json")
    return evidence.save_evidence(workspace, {"profile_id": profile_id,
                                 "source_collection_id": collection["id"], "source_id": "regional-evidence"})["id"]

def prepare(workspace, value):
    obj(value, ("definition", "preview_sha256"), "profile preparation")
    proposed = preview(workspace, value["definition"])
    if proposed["preview_sha256"] != value.get("preview_sha256"):
        raise ValueError("Reopen the exact source-bound preview before preparing a profile")
    directory = workspace.root / "regional-biophysical-operations" / proposed["preview_sha256"]
    directory.mkdir(parents=True, exist_ok=True)
    with held(workspace.root / ".workspace.lock", blocking=False), held(directory / ".preparation.lock", blocking=False):
        atomic_json(directory / "selection.json", proposed, immutable=True)
        result_path = directory / "result.json"
        if result_path.exists():
            saved = read_json(result_path)
            return inspect(workspace, saved["id"])
        retained_binding = _retain_library(workspace, value["definition"], directory)
        prepared = profiles.materialize(workspace, proposed["source_profile_spec"])
        ids = prepared["profile_ids"]
        if len(ids) > 1 or prepared["state"] != "complete":
            raise ValueError("Original profile materialization did not produce one joined selection")
        selected_id = ids[0] if ids else proposed["baseline_profile_id"]
        evidence_id = _evidence(workspace, selected_id, proposed, directory)
        retained_definition = {**proposed["definition"], "library": retained_binding}
        # Recompute with the retained bytes, so this record cold-opens without installed catalogue dependence.
        received = preview(workspace, retained_definition)
        result = workspace._save(KIND, {
            "workspace_id": workspace.project["id"], "title": proposed["definition"]["title"],
            "original_definition": proposed["definition"], "definition": retained_definition,
            "original_preview_sha256": proposed["preview_sha256"], "retained_preview": received,
            "profile_set_id": prepared["id"], "profile_id": selected_id,
            "baseline_profile_id": proposed["baseline_profile_id"], "evidence_id": evidence_id,
            "native_version": INVEST_VERSION})
        inspect(workspace, result["id"])
        atomic_json(result_path, result, immutable=True)
        return result

def inspect(workspace, ident):
    record = workspace._get(KIND, identifier(ident))
    if record["workspace_id"] != workspace.project["id"] or record["native_version"] != INVEST_VERSION:
        raise ValueError("Select the original workspace and native library version")
    current = preview(workspace, record["definition"])
    if canonical(current) != canonical(record["retained_preview"]):
        raise ValueError("Retained regional source/selection changed")
    selected_profile, selected_source, selected_table = profiles._base(workspace, record["profile_id"])
    base, base_source, base_table = profiles._base(workspace, record["baseline_profile_id"])
    configs = current["profile_preview"]["configurations"]
    config = next((c for c in configs if not c["is_baseline"]), configs[0])
    expected_changes = {(change["target"], code): change["value"]
                        for change in config["changes"] if change["target"].startswith("table.")
                        for code in change["lucodes"]}
    if selected_table["columns"] != base_table["columns"] or len(selected_table["rows"]) != len(base_table["rows"]):
        raise ValueError("Regional profile changed the original table shape")
    for old, new in zip(base_table["rows"], selected_table["rows"]):
        if old["lucode"] != new["lucode"]: raise ValueError("Original row order changed")
        for field in base_table["columns"]:
            key = ("table." + field, int(old["lucode"]))
            if key in expected_changes:
                if profiles._value(key[0], new[field]) != expected_changes[key]:
                    raise ValueError("A selected coefficient differs from its retained choice")
            elif new[field] != old[field]: raise ValueError("An unselected original cell changed")
    for model in current["models"]:
        expected = copy.deepcopy(base[model])
        for change in config["changes"]:
            domain, field = change["target"].split(".", 1)
            if domain == model:
                if change["value"] is None: expected.pop(field, None)
                else: expected[field] = change["value"]
        if canonical(expected) != canonical(selected_profile[model]):
            raise ValueError("The selected native settings differ from the retained source choice")
    if record["evidence_id"]:
        saved = evidence.inspect_evidence(workspace, record["evidence_id"])
        if saved["profile_id"] != record["profile_id"]:
            raise ValueError("Coefficient evidence belongs to another profile")
    return record

def prepare_experiment(workspace, value):
    obj(value, ("selection_id", "baseline_run_id", "scenario_ids", "source_run_ids", "title", "reason"), "native experiment")
    from . import experiments
    record = inspect(workspace, value["selection_id"])
    baseline = workspace.inspect_run(identifier(value["baseline_run_id"]))
    if baseline["selection"]["profile_id"] != record["baseline_profile_id"]:
        raise ValueError("Use the original central profile's completed native baseline")
    scenario = workspace._get("scenarios", baseline["selection"]["scenario_id"])
    if baseline["state"] != "complete" or scenario["kind"] != "baseline":
        raise ValueError("Use a completed native land-cover baseline")
    selection = {"title": text(value.get("title"), "Experiment title"),
                 "reason": text(value.get("reason"), "Experiment purpose") + " Regional selection " + record["id"],
                 "baseline_run_id": baseline["id"], "scenario_ids": value.get("scenario_ids", []),
                 "profile_ids": [] if record["profile_id"] == record["baseline_profile_id"] else [record["profile_id"]],
                 "design": "one_at_a_time", "axes": []}
    if value.get("source_run_ids"): selection["source_run_ids"] = value["source_run_ids"]
    return experiments.prepare(workspace, selection)

def report(record):
    e = lambda x: html.escape(str(x), quote=True)
    selected = record["retained_preview"]["selected_entries"]
    body = []
    for row in selected:
        cell, src = row["entry"], row["entry"]["source"]
        body.append("<tr><td>" + e(cell["lucode"] if cell["lucode"] is not None else "Whole model") +
                    "</td><td>" + e(cell["target"]) + "</td><td>" + e(cell["value"]) +
                    "</td><td>" + e(cell["units"]) + "</td><td>" + e(cell["load_type"] or "") +
                    "</td><td>" + e(src["classification"]) + "</td></tr><tr><td colspan=6>" +
                    e(src["title"]) + " · " + e(src["uri"]) + "<br>" + e(src["locator"]) +
                    "<br>" + e(src["geography"]) + " · " + e(src["management"]) +
                    "<br>" + e(src["period"]) + "<br>" + e(src["method"]) +
                    "<br>" + e(src["notes"]) + "<br>Selection rationale: " + e(row["rationale"]) + "</td></tr>")
    return ("<!doctype html><html lang=en><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
            "<title>" + e(record["title"]) + "</title><style>body{font:16px/1.5 system-ui;color:#222;background:#fff;max-width:1200px;margin:2em auto;padding:1em}"
            "table{border-collapse:collapse;width:100%}th,td{padding:.5em;border:1px solid #aaa;text-align:left;overflow-wrap:anywhere}"
            "pre{white-space:pre-wrap;overflow-wrap:anywhere}@media print{body{margin:0}tr{break-inside:avoid}}</style>"
            "<h1>" + e(record["title"]) + "</h1><p>" + e(record["definition"]["reason"]) + "</p><p>" +
            e(record["definition"]["applicability_note"]) + "</p><p>Working scientific choice; no inferred calibration or local measurement.</p>"
            "<p>Profile " + e(record["profile_id"]) + "<br>Original baseline " + e(record["baseline_profile_id"]) +
            "<br>Retained source selection " + e(record["id"]) + "</p><table><thead><tr>"
            "<th>Land cover</th><th>Parameter</th><th>Value</th><th>Units</th><th>Load basis</th><th>Evidence kind</th>"
            "</tr></thead><tbody>" + "".join(body) + "</tbody></table><h2>Inherited inputs</h2><p>" +
            e(record["retained_preview"]["inherited_fields"]) + "</p><h2>Complete retained selection</h2><pre>" +
            e(json.dumps(record, ensure_ascii=False, indent=2)) + "</pre></html>").encode("utf-8")

def export(workspace, ident):
    with held(workspace.root / ".workspace.lock", blocking=False):
        return _export(workspace, ident)

def _export(workspace, ident):
    record = inspect(workspace, ident)
    directory = workspace.root / "regional-biophysical-exports" / record["id"]
    directory.mkdir(parents=True, exist_ok=True)
    members = {"selection.json": (json.dumps(record, ensure_ascii=False, indent=2) + "\n").encode("utf-8"),
               "report.html": report(record)}
    for label, pid in (("selected", record["profile_id"]), ("baseline", record["baseline_profile_id"])):
        value = workspace._get("profiles", pid)
        path, original = workspace.source_file(value["source_collection_id"], value["biophysical_source_id"])
        members[label + "/profile.json"] = (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
        members[label + "/biophysical.csv"] = path.read_bytes()
    binding = record["definition"]["library"]
    path, original = workspace.source_file(binding["source_collection_id"], binding["source_id"])
    members["library/library.json"] = path.read_bytes()
    from .common import relative_file
    for index, part in enumerate(original.get("companions", [])):
        members["library/originals/" + str(index) + "-" + Path(part["filename"]).name] = relative_file(workspace.root, part["object"]).read_bytes()
    if record["evidence_id"]:
        item = evidence.inspect_evidence(workspace, record["evidence_id"])
        path, _ = workspace.source_file(item["source"]["source_collection_id"], item["source"]["source_id"])
        members["coefficient-evidence.csv"] = path.read_bytes()
        members["coefficient-evidence.json"] = (json.dumps(item, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    for name, raw in members.items(): atomic_bytes(directory / name, raw, immutable=True)
    manifest = {name: {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()} for name, raw in members.items()}
    members["manifest.json"] = (json.dumps(manifest, indent=2) + "\n").encode("utf-8")
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, raw in members.items():
            info = zipfile.ZipInfo(name, date_time=(2020, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, raw)
    atomic_bytes(directory / "Regional_Profile.zip", stream.getvalue(), immutable=True)
    return {"selection": directory / "selection.json", "report": directory / "report.html",
            "package": directory / "Regional_Profile.zip"}

def verify_all(workspace):
    values = workspace._list(KIND)
    for value in values: inspect(workspace, value["id"])
    return {"regional_profile_selections": len(values)}
