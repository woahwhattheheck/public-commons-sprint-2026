"""Build the complete offline opening page inside the native geographic archive.

The geographic receiver owns execution, the archive and independent reopening.
This helper captures the completed original inputs, reports and review desk
through portable.backup's maintained delivery interface. Scientific files stay
at their original Workspace paths; no raster tree or nested archive is copied.
"""
from __future__ import annotations

from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import shutil
import tempfile
from urllib.parse import quote

from model.common import (atomic_bytes, atomic_json, describe_file, digest,
                          file_digest, held, identifier, read_json, verify_file)
from source_tools.simulated_headwaters_handover import STYLE, _name, _number, _text

SCHEMA = "upstate.geographic-headwaters-handover/v1"
VERSION = 3


def _url(namespace, relative):
    relative = _name(relative)
    if namespace not in ("workspace", "application", "delivery"):
        raise ValueError("Choose an original application, Workspace or delivery member")
    return ("" if namespace == "delivery" else "../" + namespace + "/") + quote(relative, safe="/")


def _link(namespace, path, label, *, button=False, primary=False, download=False):
    css = ' class="button' + (" primary" if primary else "") + '"' if button else ""
    action = " download" if download else ""
    return '<a href="' + _url(namespace, path) + '"' + css + action + '>' + _text(label) + '</a>'


def _regular(root, relative):
    root = Path(root).resolve(strict=True)
    relative = _name(relative)
    path = root / relative
    if path.resolve(strict=True) != path or not path.is_file():
        raise ValueError("Keep the original ordinary handover member: " + relative)
    return path


def _descriptor(root, item):
    """Keep the producer's exact identity; native archive capture hashes the bytes."""
    path = _regular(root, item["path"])
    if type(item["bytes"]) is not int or item["bytes"] < 0 or path.stat().st_size != item["bytes"]:
        raise ValueError("Original handover member length changed: " + item["path"])
    identifier(item["sha256"])
    return {key: item[key] for key in ("path", "bytes", "sha256")}


def _small_original(root, item):
    path = verify_file(root, _descriptor(root, item))
    return read_json(path)


def _table(headings, rows):
    return ('<div class="table-scroll"><table><thead><tr>'
            + "".join("<th>" + _text(value) + "</th>" for value in headings)
            + "</tr></thead><tbody>" + "".join(
                "<tr>" + "".join("<td>" + _text(value) + "</td>" for value in row) + "</tr>"
                for row in rows) + "</tbody></table></div>")


def _list(items):
    return '<ul class="file-list">' + "".join("<li>" + item + "</li>" for item in items) + "</ul>"


def _first_elapsed(state):
    return {name: {key: row[key] for key in ("first_completed_at", "first_elapsed_seconds")
                   if key in row}
            for name, row in state.get("stages", {}).items()
            if row.get("state") == "complete" and row.get("first_completed_at")
            and name not in ("archive", "independent_restore", "resume_independent_restore",
                             "independent_reopen", "independent_cold_reopen", "handover")}



def _operator_choices(prepared):
    """Reopen the retained native selection in the existing Geographic desk.

    This is the inverse transport of geographic_preparation.selection, matching
    geographic_workbench.payloadFromSelection. Original source identifiers and
    typed filters stay unchanged; native preview still owns validation/geometry.
    """
    selected = prepared["selection"]
    if selected.get("schema") != "upstate.geographic-headwaters-selection/v1":
        raise ValueError("Use the original geographic selection for editable choices")

    def selector(value):
        result = {"collection_id": value["source_collection_id"],
                  "source_id": value["source_id"]}
        if value.get("part"):
            result["companion_path"] = value["part"]
        return result

    def json_text(value):
        return json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False)

    hucs, reporting, utility = (selected["huc_polygons"],
                                selected["reporting_boundary"],
                                selected["utility_focus"][0])
    options = {
        "question": selected["question"],
        "reporting_huc12s": "\n".join(selected["reporting_huc12s"]),
        "huc_field": selected["huc_field"],
        "huc_layer": hucs.get("layer", ""),
        "huc_where": json_text(hucs.get("where", {})),
        "reporting_layer": reporting.get("layer", ""),
        "reporting_where": json_text(reporting.get("where", {})),
        "reporting_boundary_description": selected["reporting_boundary_description"],
        "utility_layer": utility.get("layer", ""),
        "utility_where": json_text(utility.get("where", {})),
        "additional_utility_focus": json_text(selected["utility_focus"][1:]),
        "intakes": json_text(selected.get("intakes", [])),
        "utility_label": selected["utility_label"],
        "seed": selected["seed"],
        "corridor_width_m": selected["corridor_width_m"],
    }
    # Absence identifies the original legacy edition; do not insert defaults.
    for name in ("matching_method", "max_working_bytes"):
        if name in selected:
            options[name] = deepcopy(selected[name])
    return {
        "schema": "upstate.geographic-operator-selection/v1",
        "project_id": prepared["project_id"],
        "geographic_edition_id": prepared["id"],
        "payload": {
            "method": "geographic-headwaters", "title": selected["title"],
            "inputs": {"huc_polygons": selector(hucs),
                       "reporting_boundary": selector(reporting),
                       "utility_focus": selector(utility)},
            "options": options, "import_sources": True,
        },
        # A received application must preview its own installed producer.
        "preview": None,
    }


def _course_snapshot(workspace, prepared, scientific, reference_basis):
    """Read the saved native course and its original all-alternative reports."""
    from model.ensembles import Ensembles
    from source_tools.headwaters_parameter_course import reference_report_basis

    plan = Ensembles(workspace).inspect(prepared["ensemble_id"])
    course = read_json(workspace.root / "ensemble_results" / prepared["ensemble_id"]
                       / "headwaters-results.json")
    actual_basis = reference_report_basis(workspace, prepared["ensemble_id"], course)
    if (plan["grid_id"] != prepared["grid_id"]
            or actual_basis["baseline_run_id"] != prepared["baseline_run_id"]
            or actual_basis["alternative_run_ids"] != prepared["alternative_run_ids"]
            or scientific.get("progress") != plan["progress"]):
        raise ValueError("Keep the actual selected geographic course and scientific progress")
    if reference_basis is not None:
        if (reference_basis != actual_basis or not actual_basis["reference_ready"]
                or actual_basis["state"] != "reference_complete"):
            raise ValueError("The reference handover must retain its exact completed native basis")
    elif course["state"] != "complete":
        raise ValueError("Pass the explicit reference basis for a partial native course")
    members = []
    for member in plan["members"]:
        members.append({
            "member_id": member["id"], "profile_id": member["profile_id"],
            "label": member.get("label") or member["profile_id"],
            "assignments": deepcopy(member["assignments"]),
            "parameters": deepcopy(member["parameters"]),
            "runs": [{"run_id": run["run_id"], "scenario_id": run["scenario_id"],
                      "state": run["state"]} for run in member["runs"]],
        })
    reports = []
    for product in course.get("joint_decisions", {}).get("support_group_reports", []):
        archive = _descriptor(workspace.root, product["archive_identity"])
        index = Path(product["index"]).resolve(strict=True)
        relative = index.relative_to(workspace.root.resolve()).as_posix()
        _regular(workspace.root, relative)
        reports.append({
            "report_id": product["report_id"],
            "comparison_id": product["reference_comparison_id"],
            "profile_id": product["reference_profile_id"],
            "index": describe_file(workspace.root, index), "archive": archive,
        })
    return {
        "schema": "upstate.geographic-course-presentation/v1",
        "edition_kind": "reference" if reference_basis is not None else "complete_course",
        "state": course["state"], "native_progress": deepcopy(plan["progress"]),
        "planned_profile_count": len(members),
        "completed_comparison_profile_count": actual_basis["completed_comparison_profile_count"],
        "members": members, "joint_reports": reports,
    }


def _course_section(data):
    course = data["course_snapshot"]
    progress = course["native_progress"]
    reference = data.get("reference_basis")
    heading = ("Completed reference scenarios" if reference is not None
               else "Completed parameter study")
    explanation = (
        "This edition contains the completed original baseline, riparian alternative and matched control. "
        "The wider parameter study retains the run states below; its pending members remain available "
        "in this editable project for continuation."
        if reference is not None else
        "This edition includes the original reference scenarios and the completed parameter choices. "
        "Each profile retains its own baseline and both alternatives."
    )
    rows = []
    for member in course["members"]:
        assignments = (json.dumps(member["assignments"], ensure_ascii=False, sort_keys=True)
                       if member["assignments"] else "Original working profile")
        states = [run["state"] for run in member["runs"]]
        rows.append([member["label"], assignments, *states])
    table = _table(["Profile", "Changed parameter choices", "Baseline", "Riparian alternative",
                    "Matched control"], rows)
    reports = _list([
        _link("workspace", item["index"]["path"],
              "All-alternative decision report " + str(index + 1))
        + " · " + _link("workspace", item["archive"]["path"], "Complete decision files")
        for index, item in enumerate(course["joint_reports"])
    ])
    source = ('<details><summary>Original parameters and native run identities</summary><pre>'
              + _text(json.dumps(course["members"], indent=2, ensure_ascii=False))
              + "</pre></details>")
    return ('<section id="course"><h2>' + heading + "</h2><p>" + explanation
            + "</p><p><strong>" + _text(str(progress.get("complete", 0))) + " / "
            + _text(str(progress.get("total", 0))) + " native runs complete</strong> · "
            + _text(str(course["completed_comparison_profile_count"])) + " / "
            + _text(str(course["planned_profile_count"])) + " profiles have all-alternative comparisons.</p>"
            + table + "<h3>Compare the alternatives together</h3><p>The original decision reports "
            "compare baseline, restoration and control on their actual common finite cells. "
            "Different support groups retain separate reports. Parameter ranges describe the saved "
            "choices; they are not confidence intervals.</p>" + reports + source + "</section>")


def _render(data):
    prepared, scientific = data["prepared"], data["scientific"]
    reference = data.get("reference_basis")
    selection, geo = prepared["selection"], prepared["geography"]
    grid, summary = geo["grid"], prepared["input_summary"]
    links, report = data["links"], data["native_report"]
    scientific_files = links["scientific"]
    report_html = scientific_files["report.html"]["path"]
    report_pdf = scientific_files["report.pdf"]["path"]
    edition = ("Reference scenario edition" if reference is not None else "Complete parameter study")
    buttons = [
        _link("workspace", report_html, "Read scientific report", button=True, primary=True),
        _link("workspace", report_pdf, "Open report PDF", button=True),
        _link("delivery", "customer-review/index.html", "Open review desk", button=True),
        '<a class="button" href="#working">Open editable project</a>',
        _link("delivery", "geographic-operator-choices.json", "Download editable choices",
              button=True, download=True),
    ]
    map_links = [_link("workspace", row["path"], role.replace("_", " "))
                 for role, row in links["delivery"].items()
                 if row["path"].lower().endswith((".html", ".pdf", ".qgz", ".gpkg", ".zip"))]
    shape_rows = [
        ("Upstream model domain", len(geo["model_domain_huc12s"]), geo["areas_ha"]["model_domain"],
         "Complete original contributing HUC polygons"),
        ("Selected reporting HUCs", len(geo["reporting_huc12s"]), geo["areas_ha"]["reporting_whole_hucs"],
         "Original selected HUCs before the SC boundary intersection"),
        ("South Carolina reporting area", "—", geo["areas_ha"]["reporting_area"],
         "Selected HUCs intersected with the original reporting boundary"),
        ("Utility focus in reporting area", "—", geo["areas_ha"]["utility_reporting_intersection"],
         "Retained utility focus intersected with reporting support; original or derived geometry is recorded in its source binding"),
    ]
    shapes = _table(["Geometry", "HUCs", "Vector area (ha)", "Meaning"],
                    [[label, count, _number(area), meaning] for label, count, area, meaning in shape_rows])
    totals = [
        ("Grid", str(grid["width"]) + " × " + str(grid["height"]), str(grid["resolution_m"]) + " m · " + grid["crs"]),
        ("Reporting cells", _number(summary.get("reporting_cells")), "30 m cell centres inside reporting support"),
        ("Treatment", _number(summary.get("changed_cells", 0) * grid["pixel_area_ha"]), "ha changed in each treatment/control"),
    ]
    stats = '<div class="stats">' + "".join(
        '<article class="stat"><strong>' + _text(value) + '</strong><span>'
        + _text(label) + '<br><span class="muted">' + _text(note) + "</span></span></article>"
        for label, value, note in totals) + "</div>"
    native_rows = []
    for index, row in enumerate(report.get("paired_rows", [])):
        native_rows.append('<tr data-native-case><td>' + _text(row["member_label"])
            + '</td><td>' + _text(row["scenario_label"]) + '</td><td>' + _text(row["pollutant"])
            + '</td><td class="numeric">' + _text(_number(row.get("baseline_common")))
            + '</td><td class="numeric">' + _text(_number(row.get("alternative_common")))
            + '</td><td class="numeric">' + _text(_number(row.get("delta_common")))
            + '</td><td class="unit">' + _text(row["total_units"])
            + '</td><td class="numeric">' + _text(_number(row["common_cells"]))
            + '</td><td><details><summary>Pair ' + str(index + 1)
            + '</summary><dl><dt>Comparison</dt><dd><code>' + _text(row["comparison_id"])
            + '</code></dd><dt>Common support</dt><dd><code>'
            + _text(row.get("common_support_sha256") or "Undefined")
            + '</code></dd><dt>Baseline only / alternative only</dt><dd>'
            + _text(str(row["baseline_only_cells"]) + " / " + str(row["alternative_only_cells"]))
            + "</dd></dl></details></td></tr>")
    comparisons = ('<label for="native-filter">Find a parameter case, scenario or quantity</label>'
        '<div class="actions"><input id="native-filter" type="search" autocomplete="off" '
        'placeholder="Filter the retained comparisons"><button type="button" id="clear-filter">Clear</button></div>'
        '<p id="native-count" class="muted" aria-live="polite"></p>'
        '<div class="table-scroll"><table><thead><tr>'
        '<th>Parameter case</th><th>Alternative</th><th>Quantity</th><th>Baseline</th>'
        '<th>Alternative</th><th>Signed change</th><th>Unit</th><th>Common cells</th><th>Source</th>'
        '</tr></thead><tbody>' + "".join(native_rows) + "</tbody></table></div>")
    progress = scientific.get("progress", {})
    cases = (_text(str(progress.get("complete", "Unspecified"))) + " / "
             + _text(str(progress.get("total", "Unspecified"))) + " native runs complete")
    assumptions = data["assumptions"]
    assumptions_html = "<dl>" + "".join(
        "<dt>" + _text(label) + "</dt><dd>" + _text(assumptions.get(key, "See the original assumption record")) + "</dd>"
        for key, label in (("physical_fields", "Physical inputs"), ("terrain", "Terrain"),
                           ("loads", "Loading coefficients"), ("parameters", "Native parameters"),
                           ("control", "Matched control"), ("outputs", "Output meaning"))) + "</dl>"
    ranges = summary.get("ranges", {})
    assumptions_html += "<details><summary>Original physical input ranges and class counts</summary>"
    assumptions_html += "<pre>" + _text(json.dumps({"ranges": ranges,
        "baseline_class_counts": summary.get("baseline_class_counts"),
        "restoration_original_class_counts": summary.get("restoration_original_class_counts")},
        indent=2, sort_keys=True, allow_nan=False)) + "</pre></details>"
    original_links = [
        _link("workspace", links["assumptions"]["path"], "Complete assumptions and control record"),
        _link("workspace", links["selection"]["path"], "Original native geographic selection"),
        _link("delivery", "geographic-operator-choices.json", "Geographic desk choices for this project", download=True),
        _link("workspace", links["binding"]["path"], "Full geography, topology and source identities"),
        _link("workspace", links["native_report"]["path"], "Complete native report JSON, at original precision"),
        _link("delivery", "handover-record.json", "This handover's complete selected source inventory"),
    ]
    if data.get("geographic_programme") is not None:
        original_links.append(_link("delivery", "geographic-programme.json",
                                    "Complete saved Programme, original results and editable map selection"))
    figures = '<div class="figures">' + "".join(
        '<figure><a href="' + _url("workspace", row["path"]) + '"><img src="'
        + _url("workspace", row["path"]) + '" alt="' + _text(Path(row["path"]).stem.replace("-", " "))
        + '" loading="lazy"></a><figcaption>' + _text(Path(row["path"]).name)
        + "</figcaption></figure>" for row in links["figures"][:6]) + "</div>"
    timing_rows = [[name.replace("_", " "), _number(row.get("first_elapsed_seconds")),
                   row["first_completed_at"]] for name, row in data["first_elapsed"].items()]
    timings = _table(["Completed operation", "First recorded elapsed seconds", "Completed at"], timing_rows)
    guides = _list([_link("application", path, Path(path).name.replace("_", " "))
                   for path in links["application_guides"]])
    identities = "<dl>" + "".join("<dt>" + _text(label) + "</dt><dd><code>" + _text(value) + "</code></dd>"
        for label, value in (("Project", prepared["project_id"]), ("Geographic edition", prepared["id"]),
                            ("Ensemble", prepared["ensemble_id"]), ("Grid", prepared["grid_id"]),
                            ("Scientific source operation", scientific["id"]),
                            ("Mapped delivery", data["delivery_id"]),
                            ("Customer review", data["review"]["review_id"]))) + "</dl>"
    style = STYLE + """
input,button{font:inherit;color:#202020;background:#fff;border:1px solid #555;border-radius:3px;min-height:44px;padding:9px 12px}
input{flex:1;min-width:180px;max-width:640px}button{cursor:pointer}button:hover{background:#eee}
pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:.85rem;background:#f5f5f5;padding:14px}
td{min-width:6em}td details{margin:0}.table-scroll summary{font-weight:400}
"""
    script = """
const input=document.getElementById('native-filter');
const rows=Array.from(document.querySelectorAll('[data-native-case]'));
function filter(){const query=input.value.trim().toLocaleLowerCase();let count=0;
for(const row of rows){const visible=!query||row.textContent.toLocaleLowerCase().includes(query);row.hidden=!visible;if(visible)count++;}
document.getElementById('native-count').textContent=count+' of '+rows.length+' retained comparisons shown';}
input.addEventListener('input',filter);
document.getElementById('clear-filter').addEventListener('click',()=>{input.value='';filter();input.focus();});
filter();
"""
    return ('<!doctype html><html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1"><title>'
        + _text(selection["title"]) + '</title><style>' + style + '</style></head><body>'
        '<header><div class="eyebrow">Upper Savannah · ' + _text(edition) + '</div><h1>'
        + _text(selection["title"]) + '</h1><p class="lead">' + _text(selection["question"])
        + '</p><p>Original geographic sources, explicit simulated physical inputs and completed native NDR/SDR results.</p>'
        '<nav aria-label="Primary documents">' + "".join(buttons) + '</nav></header><main>'
        '<section id="geography"><h2>The selected geography</h2>' + stats + shapes
        + '<p>The native calculation uses the upstream domain. Results reported here retain the selected South Carolina mask; '
        'the utility footprint is a separate focus layer. Vector hectares and pixel-centre coverage use their original distinct definitions.</p>'
        + '<details><summary>Selected reporting and upstream HUCs</summary><p><strong>Reporting:</strong> '
        + _text(", ".join(geo["reporting_huc12s"])) + '</p><p><strong>Additional upstream:</strong> '
        + _text(", ".join(geo["upstream_huc12s"]) or "None in this retained topology")
        + '</p></details></section>'
        + _course_section(data) + '<section id="results"><h2>Native scenario comparisons</h2><p>' + cases
        + ' · ' + _text(str(scientific.get("figure_count", 0))) + ' scientific figures.</p>'
        '<p>Nitrogen and phosphorus are annual mass delivered to streams in kg/year; sediment is tonnes/year. '
        'Each row keeps its own common finite cells. Signed change is alternative minus baseline; a negative value is a reduction. '
        'Parameter cases are descriptive choices, not probabilities. Intake concentrations require a separate physical model.</p>'
        + comparisons + '<p>Display values use eight significant digits; the original JSON retains full precision. '
        'Compare magnitudes across rows only when their geographic support is equivalent.</p>'
        + figures + '</section><section id="maps"><h2>Maps and complete report files</h2>'
        + _list(map_links) + '<p>The original report and map files retain their companion assets and relative links.</p></section>'
        '<section id="assumptions"><h2>Inputs and editable assumptions</h2>' + assumptions_html
        + _list(original_links) + '</section>'
        '<section id="review"><h2>Review and continue the work</h2><p>The review desk contains the original selected artifacts, '
        'requirements and retained response history. Open evidence, enter review decisions and export the response JSON. '
        'The complete project contains the original sources, editable selections and native outputs.</p>'
        + _link("delivery", "customer-review/index.html", "Open the complete customer review", button=True)
        + '<p>Review generation: ' + _text(data["review"].get("latest_response_id") or "Original request")
        + '</p></section>'
        '<section id="speed"><h2>Recorded production time</h2><p>These are the first completed intervals recorded by the actual receiving process. '
        'They describe individual phases and may include reuse; they are not an end-to-end delivery promise.</p>' + timings + '</section>'
        '<section id="working"><h2>Open the editable application and project</h2>'
        '<p>Use the maintained restore command for the delivered archive, then open <code>delivery/START_HERE.html</code> '
        'inside the receiving directory. The sibling <code>application</code> and <code>workspace</code> directories '
        'contain the editable source and original scientific project.</p>'
        '<pre>python application/model/cli.py restore GEOGRAPHIC_STUDY.zip NEW_DIRECTORY</pre>'
        + guides
        + (('<h3>Saved native Programme</h3><p>Open <strong>Programmes</strong> in the received application and select '
             '<code>' + _text(data["geographic_programme"]["programme_id"]) + '</code>. '
             'Its baseline, riparian restoration and matched-control results already exist. Open the report, '
             'inspect original source choices, or explicitly create a source-update successor; reopening this '
             'Programme does not run the remaining sensitivity design.</p>')
           if data.get("geographic_programme") is not None else '')
        + '<h3>Continue this exact geographic case</h3><ol>'
        '<li>Start the contained operator against the received sibling Workspace using its current start guide; '
        'reopen the existing project without creating a new one.</li>'
        '<li>Open <strong>Geographic model case</strong>. Choose <strong>Reopen choices</strong> and select '
        '<code>delivery/geographic-operator-choices.json</code>, or use the download above. '
        'This file carries the original project identity, complete source selectors and editable assumptions.</li>'
        '<li>Choose <strong>Preview selected coverage</strong>. Review the actual upstream domain, '
        'South Carolina reporting mask, utility focus, matching method and working-memory budget. '
        'The received application previews its own installed producer.</li>'
        '<li>For a revision, edit the question, source selections or stated assumptions, preview again, '
        'then use <strong>Prepare selected source</strong>. Preparation retains a new edition when choices change. '
        'Open its original baseline/restoration/control runs or programme to execute the selected calculation.</li>'
        '<li>Keep the delivered edition available beside the revised maps and report, then export the updated working project.</li>'
        '</ol><p>Optional intake-point selectors and additional utility polygons keep their separate original identities. '
        'Reopening a choices file fills the form; it does not start preparation or a model.</p>'
        + '<p>In the received application, use the retained source selection and parameter profiles to edit assumptions, '
        'prepare a new scenario, run it and inspect the changed maps and report alongside these originals. '
        'Keep each completed scientific edition available for comparison.</p>'
        '<p>The receiving process exposes its exact original archive and opening-page path in its completion record.</p></section>'
        '<section><details><summary>Original project and source identities</summary>' + identities
        + '</details></section></main><footer>Actual selected geography · Declared simulated physical inputs · '
        'Original native calculations and editable source</footer><script>' + script + '</script></body></html>\n')


def prepare(workspace, output, state, prepared, scientific, delivery, exported, *, reference_basis=None, programme=None):
    """Return delivery_root/files for the caller's one ordinary portable.backup."""
    output = Path(output).resolve(strict=True)
    if (output.is_relative_to(workspace.root.resolve())
            or workspace.root.resolve().is_relative_to(output)):
        raise ValueError("Keep geographic handover output outside the original Workspace")
    if (prepared["project_id"] != workspace.project["id"]
            or state["project_id"] != workspace.project["id"]
            or state["ensemble_id"] != prepared["ensemble_id"]
            or scientific["workspace_id"] != workspace.project["id"]
            or scientific["ensemble_id"] != prepared["ensemble_id"]
            or scientific["state"] != "complete"
            or delivery["state"] != "complete"
            or delivery["id"] != state["delivery_id"]
            or exported["project_id"] != workspace.project["id"]
            or exported["review_id"] != state["customer_review_id"]):
        raise ValueError("Retain one completed original geographic/scientific/customer selection")
    selection = delivery["selection"]
    if (selection["baseline_run_id"] != prepared["baseline_run_id"]
            or selection["scenario_run_ids"] != prepared["alternative_run_ids"]):
        raise ValueError("The geographic maps select different native scenarios")
    course_snapshot = _course_snapshot(workspace, prepared, scientific, reference_basis)
    root = workspace.root
    inputs = root / _name(prepared["directory"]) / "inputs"
    original = read_json(_regular(inputs, "input-receipt.json"))
    if (original["identity"]["id"] != prepared["id"]
            or original["identity"]["project_id"] != workspace.project["id"]
            or original["geography"] != prepared["geography"]
            or original["input_summary"] != prepared["input_summary"]):
        raise ValueError("Use the original prepared geographic inputs and support")
    by_name = {row["path"]: row for row in original["files"]}
    selected_inputs = {}
    for role, name in (("assumptions", "assumptions.json"),
                       ("selection", "geographic-selection.json"), ("binding", "geographic-binding.json")):
        item = by_name[name]
        data = _small_original(inputs, item)
        selected_inputs[role] = (data, {**item, "path": (inputs / name).relative_to(root).as_posix()})
    if selected_inputs["selection"][0] != prepared["selection"]:
        raise ValueError("The retained geographic selection changed")
    scientific_files = {name: _descriptor(root, row) for name, row in scientific["report"]["files"].items()}
    recipe = _small_original(root, scientific["files"]["source_recipe"])
    source_root = root / scientific["files"]["source_recipe"]["path"]
    source_root = source_root.parent
    report_input = next(item for item in recipe["inputs"] if item["path"] == "numeric/report.json")
    report_data = _small_original(source_root, report_input)
    if report_data["ensemble_id"] != prepared["ensemble_id"]:
        raise ValueError("The scientific numeric report selects a different native ensemble")
    native_path = (source_root / report_input["path"]).relative_to(root).as_posix()
    delivery_files = {role: {**_descriptor(root / "deliveries" / identifier(delivery["id"]), row),
                            "path": "deliveries/" + delivery["id"] + "/" + row["path"]}
                      for role, row in delivery["files"].items()}
    report_root = _regular(root, scientific_files["report.html"]["path"]).parent
    figures = [describe_file(root, path) for path in sorted(report_root.rglob("*"))
               if path.is_file() and path.suffix.lower() in (".svg", ".png", ".jpg", ".jpeg")]
    application = Path(__file__).resolve().parents[1]
    guides = [name for name in ("START_HERE.md", "README.md", "docs/GEOGRAPHIC_HEADWATERS_HANDOVER.md")
              if (application / name).is_file()]
    review_root = Path(exported["directory"]).resolve(strict=True)
    review_manifest = read_json(_regular(review_root, "review-manifest.json"))
    if (review_manifest["project_id"] != workspace.project["id"]
            or review_manifest["review_id"] != exported["review_id"]
            or review_manifest["package_sha256"] != exported["package_sha256"]
            or digest({key: value for key, value in review_manifest.items() if key != "package_sha256"})
                != review_manifest["package_sha256"]):
        raise ValueError("Use the exact original complete customer review export")
    packet = read_json(_regular(review_root, "review.json"))
    if packet["latest_response_id"] != exported["latest_response_id"]:
        raise ValueError("The selected customer response generation changed")
    links = {
        **{role: row for role, (value, row) in selected_inputs.items()},
        "scientific": scientific_files, "delivery": delivery_files, "figures": figures,
        "native_report": {**report_input, "path": native_path}, "application_guides": guides,
    }
    data = {"schema": SCHEMA, "version": VERSION, "prepared": deepcopy(prepared),
            "scientific": {key: deepcopy(scientific[key]) for key in (
                "id", "workspace_id", "ensemble_id", "title", "selection", "state", "source",
                "source_records", "figure_count", "landcover_pairs", "parameter_pairs",
                "native_state", "progress", "files", "report") if key in scientific},
            "delivery_id": delivery["id"],
            "review": {key: exported[key] for key in ("project_id", "review_id", "package_sha256", "latest_response_id")},
            "links": links, "assumptions": selected_inputs["assumptions"][0],
            "native_report": report_data, "first_elapsed": _first_elapsed(state),
            "course_snapshot": course_snapshot,
            "operator_choices": _operator_choices(prepared)}
    if reference_basis is not None:
        data["reference_basis"] = deepcopy(reference_basis)
    if programme is not None:
        from model.geographic_programme import verify as verify_programme
        verify_programme(workspace, programme)
        if (programme.get("geographic_id") != prepared["id"]
                or programme.get("existing_delivery_id") != delivery["id"]):
            raise ValueError("Select the programme of this original geographic delivery")
        data["geographic_programme"] = deepcopy(programme)
    identity = {"schema": SCHEMA, "version": VERSION, "project_id": workspace.project["id"],
                "content_sha256": digest(data), "helper_sha256": file_digest(Path(__file__)),
                "style_sha256": hashlib.sha256(STYLE.encode("utf-8")).hexdigest()}
    key = digest(identity)
    directory = output / "handover" / key
    directory.parent.mkdir(parents=True, exist_ok=True)
    with held(directory.parent / ".geographic-handover.lock", blocking=False):
        if directory.exists():
            saved = read_json(_regular(directory, "handover-complete.json"))
            if saved["identity"] != identity:
                raise ValueError("Preserve the original handover edition")
            for row in saved["files"].values():
                verify_file(directory, row)
        else:
            with tempfile.TemporaryDirectory(prefix=".geographic-handover-", dir=directory.parent) as temporary:
                pending = Path(temporary)
                atomic_json(pending / "handover-record.json", data, immutable=True)
                atomic_json(pending / "geographic-operator-choices.json", data["operator_choices"], immutable=True)
                if programme is not None:
                    atomic_json(pending / "geographic-programme.json", programme, immutable=True)
                atomic_bytes(pending / "START_HERE.html", _render(data).encode("utf-8"), immutable=True)
                review_files = dict(review_manifest["members"])
                review_files["review-manifest.json"] = describe_file(review_root, review_root / "review-manifest.json")
                for name, descriptor in review_files.items():
                    source = _regular(review_root, name)
                    if source.stat().st_size != descriptor["bytes"]:
                        raise ValueError("The original review member changed length")
                    target = pending / "customer-review" / _name(name)
                    target.parent.mkdir(parents=True, exist_ok=True)
                    try:
                        os.link(source, target)
                    except OSError as error:
                        import errno
                        if error.errno not in (errno.EXDEV, errno.EPERM, errno.EACCES, errno.EOPNOTSUPP, errno.ENOSYS):
                            raise
                        shutil.copyfile(source, target)
                    # Hash once here; portable also checks these exact expected bytes while capturing.
                    verify_file(pending, {"path": target.relative_to(pending).as_posix(),
                                          "bytes": descriptor["bytes"], "sha256": descriptor["sha256"]})
                files = {"opening_page": describe_file(pending, pending / "START_HERE.html"),
                         "handover_record": describe_file(pending, pending / "handover-record.json"),
                         "operator_choices": describe_file(pending, pending / "geographic-operator-choices.json")}
                if programme is not None:
                    files["geographic_programme"] = describe_file(pending, pending / "geographic-programme.json")
                for index, name in enumerate(sorted(review_files)):
                    files["customer_review_%05d" % index] = {
                        "path": "customer-review/" + name,
                        **{field: review_files[name][field] for field in ("bytes", "sha256")}}
                saved = {"schema": SCHEMA, "id": key, "identity": identity, "files": files}
                atomic_json(pending / "handover-complete.json", saved, immutable=True)
                os.rename(pending, directory)
    files = {**saved["files"], "handover_completion": describe_file(directory, directory / "handover-complete.json")}
    return {"schema": SCHEMA, "id": key, "project_id": workspace.project["id"],
            "directory": str(directory), "files": files, "opening_page": "delivery/START_HERE.html",
            "identity": identity}
