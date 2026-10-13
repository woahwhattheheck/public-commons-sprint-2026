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
VERSION = 1


def _url(namespace, relative):
    relative = _name(relative)
    if namespace not in ("workspace", "application", "delivery"):
        raise ValueError("Choose an original application, Workspace or delivery member")
    return ("" if namespace == "delivery" else "../" + namespace + "/") + quote(relative, safe="/")


def _link(namespace, path, label, *, button=False, primary=False):
    css = ' class="button' + (" primary" if primary else "") + '"' if button else ""
    return '<a href="' + _url(namespace, path) + '"' + css + '>' + _text(label) + '</a>'


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
                             "independent_reopen", "handover")}


def _render(data):
    prepared, scientific = data["prepared"], data["scientific"]
    selection, geo = prepared["selection"], prepared["geography"]
    grid, summary = geo["grid"], prepared["input_summary"]
    links, report = data["links"], data["native_report"]
    scientific_files = links["scientific"]
    report_html = scientific_files["report.html"]["path"]
    report_pdf = scientific_files["report.pdf"]["path"]
    buttons = [
        _link("workspace", report_html, "Read scientific report", button=True, primary=True),
        _link("workspace", report_pdf, "Open report PDF", button=True),
        _link("delivery", "customer-review/index.html", "Open review desk", button=True),
        '<a class="button" href="#working">Open editable project</a>',
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
        _link("workspace", links["selection"]["path"], "Editable original geographic selection"),
        _link("workspace", links["binding"]["path"], "Full geography, topology and source identities"),
        _link("workspace", links["native_report"]["path"], "Complete native report JSON, at original precision"),
        _link("delivery", "handover-record.json", "This handover's complete selected source inventory"),
    ]
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
        '<header><div class="eyebrow">Upper Savannah · Native scientific working package</div><h1>'
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
        '<section id="results"><h2>Native scenario comparisons</h2><p>' + cases
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
        + '<p>In the received application, use the retained source selection and parameter profiles to edit assumptions, '
        'prepare a new scenario, run it and inspect the changed maps and report alongside these originals. '
        'Keep each completed scientific edition available for comparison.</p>'
        '<p>The receiving process exposes its exact original archive and opening-page path in its completion record.</p></section>'
        '<section><details><summary>Original project and source identities</summary>' + identities
        + '</details></section></main><footer>Actual selected geography · Declared simulated physical inputs · '
        'Original native calculations and editable source</footer><script>' + script + '</script></body></html>\n')


def prepare(workspace, output, state, prepared, scientific, delivery, exported):
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
            "native_report": report_data, "first_elapsed": _first_elapsed(state)}
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
                         "handover_record": describe_file(pending, pending / "handover-record.json")}
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
