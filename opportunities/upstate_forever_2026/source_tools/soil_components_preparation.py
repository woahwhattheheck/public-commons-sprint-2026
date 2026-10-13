"""USDA component evidence and explicit K scenarios in the original source queue.

The original soil producers own capture, interpretation and raster science.
This adapter retains the selected complete source packets, exposes labelled
scientific choices, and uses the existing Workspace bank/import/download path.
"""
from __future__ import annotations

import html
from pathlib import Path, PurePosixPath
import re

from model.common import (
    atomic_bytes, atomic_json, describe_file, digest, file_digest, read_json,
    relative_file, verify_file,
)

METHOD_IDS = frozenset({"soil-components", "soil-component-scenario"})


def method_schemas(input_field, option):
    def choice(name, label, values, default, help=""):
        return option(name, label, "choice", default=default,
                      choices=[{"value": value, "label": title} for value, title in values],
                      help=help)

    depth = {"field": "horizon_method", "equals": "depth"}
    raster = {"field": "output_mode", "equals": "raster"}
    return [
        {
            "id": "soil-components", "title": "Soil component evidence",
            "role": "SOIL_COMPONENT_SOURCE",
            "description": (
                "Receive the complete USDA mapunit, component and horizon records "
                "for a retained soil source. The native whole-soil interpretation and "
                "survey editions stay together; existing regional geometry remains exact."),
            "inputs": [input_field(
                "capture", "Original soil evidence", required=True,
                help="For Regional geometry and interpretation, choose the complete "
                     "original capture.json. For Saved USDA interpretation reference, "
                     "choose native-whole-soil.csv with its original method.json and "
                     "source-capture.zip companions. Use the imported edition or "
                     "registered source folder; a loose file is incomplete.")],
            "options": [
                choice("input_kind", "Original source type", [
                    ("regional", "Regional geometry and interpretation"),
                    ("interpretation_reference", "Saved USDA interpretation reference"),
                ], "regional", "The saved interpretation supports tables and comparison "
                               "without claiming polygon geometry."),
                option("vintage", "Soil evidence edition", "text", required=True,
                       help="Describe the actual captured survey edition. Original "
                            "publisher survey versions are checked independently."),
                option("batch_size", "Mapunits per original table request", "integer",
                       default=100,
                       help="Completed original requests are retained and reused on "
                            "an exact continuation."),
            ],
        },
        {
            "id": "soil-component-scenario", "title": "Soil component K scenario",
            "role": "SOIL_K_SCENARIO",
            "description": (
                "Compare an explicit component/horizon interpretation with USDA's "
                "original whole-soil result. Missing values and contributing weight "
                "and depth remain visible. Choose model use separately."),
            "inputs": [
                input_field("capture", "Retained component evidence", required=True,
                            help="Choose the completed component capture.json and all "
                                 "its original companions."),
                {**input_field("reference", "Numeric land-cover grid", required=True,
                               kinds=["raster"],
                               help="Use the exact original numeric NLCD reference "
                                    "for the selected model support."),
                 "when": raster},
            ],
            "options": [
                choice("output_mode", "Prepare", [
                    ("tables", "Source tables and readable comparison"),
                    ("raster", "Comparison and aligned K rasters"),
                ], "tables", "Table comparison can be prepared before a compatible "
                            "reference grid is available."),
                choice("attribute", "Erodibility variable", [
                    ("kwfact", "Whole-soil Kw — original variable"),
                    ("kffact", "Rock-free Kf — alternative interpretation"),
                ], "kwfact", "Kf is not a substitute for a missing Kw rating. "
                             "The original native baseline remains whole-soil Kw."),
                choice("component_method", "Combine soil components", [
                    ("weighted_mean", "Component-weighted mean"),
                    ("dominant_component", "Dominant component"),
                    ("dominant_condition", "Dominant condition"),
                ], "weighted_mean", "These are explicit analyst interpretations. "
                                    "The retained SDA interpretation is compared separately."),
                choice("weight_field", "Component percentage", [
                    ("comppct_r", "Representative percentage"),
                    ("comppct_l", "Lower percentage — sensitivity"),
                    ("comppct_h", "Upper percentage — sensitivity"),
                ], "comppct_r", "Lower and upper component percentages describe "
                               "scenario inputs, not K confidence bounds."),
                choice("component_filter", "Components to include", [
                    ("all", "All retained components"),
                    ("major", "Major components only"),
                ], "all", "The report shows the selected, known and rated weight "
                          "before any available-data normalization."),
                choice("horizon_method", "Depth interpretation", [
                    ("surface", "Surface horizon"),
                    ("depth", "Explicit depth interval — sensitivity"),
                ], "surface", "An organic or unrated surface stays missing. "
                              "A deeper interval is a separate analyst choice."),
                {**option("depth_top_cm", "Interval top (cm)", "number", default=0,
                          help="Depth below the original soil surface; zero is allowed."),
                 "min": 0, "when": depth},
                {**option("depth_bottom_cm", "Interval bottom (cm)", "number", default=20,
                          help="Must be greater than the selected interval top."),
                 "min": 0, "when": depth},
                choice("missing_policy", "Missing contributions", [
                    ("strict", "Preserve incomplete values"),
                    ("available", "Use available rated contributions"),
                ], "strict", "Available-data results retain their actual denominator, "
                             "unrated share and depth gaps. Missing is never numeric zero."),
                choice("tie_break", "Equal dominant choices", [
                    ("lower", "Use the lower rated value"),
                    ("higher", "Use the higher rated value"),
                ], "higher", "The report retains tied candidates and the selected rule."),
                {**choice("model_use", "Use of this raster", [
                    ("comparison", "Comparison only"),
                    ("model", "Use this stated interpretation as model K"),
                ], "comparison", "Model use is an explicit source choice. It never "
                                 "changes a completed run or the original USDA edition."),
                 "when": raster},
                {**choice("null_policy", "Missing raster cells", [
                    ("preserve", "Preserve NoData"),
                    ("nlcd-water-zero", "Zero only at original NLCD open water"),
                ], "preserve", "The optional water rule applies only to the same "
                               "original class-11 cells; other missing or conflicting "
                               "values remain NoData."),
                 "when": raster},
                {**option("tile_size", "Raster tile width (cells)", "integer", default=512),
                 "when": raster},
                option("analyst_note", "Scientific interpretation note", "textarea",
                       help="Record why this component/depth interpretation is useful. "
                            "A note is required when selecting the scenario as model K."),
            ],
        },
    ]


def _relative(value):
    if not isinstance(value, str) or "\\" in value or "\0" in value:
        raise ValueError("A soil companion requires an ordinary relative filename")
    path = PurePosixPath(value)
    if (path.is_absolute() or not path.parts or str(path) != value
            or any(part in (".", "..") for part in path.parts)):
        raise ValueError("A soil companion must remain inside its selected source folder")
    return path


def retain_references(resolved, reference_kind, *, uploaded=False):
    """Expand only the selected capture's declared, hash-bound original members."""
    if reference_kind not in {"soil-regional", "soil-component", "soil-reference"}:
        raise ValueError("Choose a supported original soil packet")
    main = next(item for item in resolved["members"] if item["path"] == resolved["main"])
    root = Path(main["source"]).parent
    prefix = PurePosixPath(resolved["main"]).parent
    if reference_kind == "soil-reference":
        from source_tools.soil_component_reference import verify_reference
        # Verify the exact original CSV, method and all captured provider bodies.
        verify_reference(main["source"])
        members = {item["path"]: dict(item) for item in resolved["members"]}
        for name in ("method.json", "source-capture.zip"):
            target_name = (prefix / name).as_posix()
            if uploaded and target_name not in members:
                raise ValueError("Choose the saved USDA reference with its original "
                                 "method.json and source-capture.zip companions")
            target = relative_file(root, name)
            identity = describe_file(root, target)
            expected = {"bytes": identity["bytes"], "sha256": identity["sha256"]}
            if target_name in members:
                item = members[target_name]
                if Path(item["source"]).resolve(strict=True) != target.resolve(strict=True):
                    raise ValueError("A USDA reference companion identifies a different file")
                prior = item.get("expected", {})
                if any(key in prior and prior[key] != expected[key] for key in expected):
                    raise ValueError("A USDA reference companion has conflicting identities")
                item["expected"] = {**prior, **expected}
            else:
                members[target_name] = {"path": target_name, "source": target, "expected": expected}
        resolved["members"] = list(members.values())
        return resolved
    value = read_json(main["source"])
    schema = ("upstate.regional-soil-capture/v1" if reference_kind == "soil-regional"
              else "upstate.soil-component-capture/v1")
    if value.get("schema") != schema or value.get("state") != "complete":
        raise ValueError("Choose the completed " +
                         ("original soil" if reference_kind == "soil-regional" else "component") +
                         " capture.json")
    if not isinstance(value.get("files"), list) or not value["files"]:
        raise ValueError("The selected soil capture has no declared complete originals")
    members = {item["path"]: dict(item) for item in resolved["members"]}
    seen = set()
    for declared in value["files"]:
        name = _relative(declared.get("path"))
        if name.as_posix() in seen:
            raise ValueError("The soil capture repeats an original member")
        seen.add(name.as_posix())
        if (type(declared.get("bytes")) is not int or declared["bytes"] < 0
                or not re.fullmatch(r"[0-9a-f]{64}", str(declared.get("sha256", "")))):
            raise ValueError("Every soil original must retain its exact bytes and SHA256")
        target_name = (prefix / name).as_posix()
        if uploaded and target_name not in members:
            raise ValueError("Select the complete soil packet from an imported edition "
                             "or registered folder; the uploaded JSON alone has no companions")
        target = relative_file(root, name.as_posix())
        expected = {"bytes": declared["bytes"], "sha256": declared["sha256"]}
        if target_name in members:
            item = members[target_name]
            if Path(item["source"]).resolve(strict=True) != target.resolve(strict=True):
                raise ValueError("A soil member identifies a different source file")
            prior = item.get("expected", {})
            if any(key in prior and prior[key] != expected[key] for key in expected):
                raise ValueError("A soil member has conflicting retained identities")
            item["expected"] = {**prior, **expected}
        else:
            members[target_name] = {"path": target_name, "source": target, "expected": expected}
    resolved["members"] = list(members.values())
    return resolved


def _active(field, options):
    condition = field.get("when")
    return condition is None or options.get(condition["field"]) == condition.get("equals")


def _selection(options):
    names = ("attribute", "component_method", "weight_field", "component_filter",
             "horizon_method", "missing_policy", "tie_break")
    result = {key: options[key] for key in names}
    if options["horizon_method"] == "depth":
        top, bottom = options["depth_top_cm"], options["depth_bottom_cm"]
        if top < 0 or bottom <= top:
            raise ValueError("Choose a depth bottom greater than its nonnegative top")
        result.update(depth_top_cm=top, depth_bottom_cm=bottom)
    return result


def _members(root):
    rows = []
    for file in sorted(Path(root).rglob("*")):
        if file.is_symlink():
            raise ValueError("A prepared soil source cannot include a symbolic link")
        if not file.is_file() or file.name.endswith(".lock"):
            continue
        if file.parent == Path(root) and file.name in {"source-entry.json", "source-manifest.json"}:
            continue
        rows.append(describe_file(root, file))
    return rows


def _entry(root, main, *, source_id, title, role, vintage, metadata=None):
    root = Path(root)
    original = describe_file(root, root / main)
    entry = {**original, "id": source_id, "title": title,
             "kind": "document", "role": role,
             "uri": "urn:sha256:" + original["sha256"], "vintage": vintage,
             **(metadata or {}),
             "companions": [row for row in _members(root) if row["path"] != main]}
    atomic_json(root / "source-entry.json", entry, immutable=True)
    atomic_json(root / "source-manifest.json",
                {"schema": "upstate.sources/v1", "title": title, "entries": [entry]},
                immutable=True)
    return entry


def _capture_report(output, capture, plan):
    esc = lambda value: html.escape(str(value), quote=True)
    counts = "".join("<tr><th scope='row'>" + esc(name) + "</th><td>" + esc(count) +
                     "</td></tr>" for name, count in capture["rows"].items())
    body = (
        "<!doctype html><html lang='en'><meta charset='utf-8'>"
        "<meta name='viewport' content='width=device-width,initial-scale=1'>"
        "<title>Soil component evidence</title><style>"
        "body{margin:0;background:#fff;color:#202020;font:16px/1.55 system-ui,sans-serif}"
        "main{max-width:62rem;margin:auto;padding:2rem}h1{line-height:1.15}"
        "table{border-collapse:collapse;width:100%;margin:1rem 0}"
        "th,td{text-align:left;padding:.65rem;border-bottom:1px solid #ccc}"
        "code{overflow-wrap:anywhere}a{color:#164d71}"
        "@media(max-width:600px){main{padding:1rem}th,td{padding:.45rem}}"
        "</style><main><h1>Soil component evidence</h1>"
        "<p>The complete original USDA relations and native whole-soil interpretation "
        "are retained with their actual source identities.</p>"
        "<p><strong>Geometry:</strong> " +
        ("Original regional geometry retained." if capture.get("regional_capture") else
         "This saved interpretation is a table reference. No polygon geometry or raster support is claimed.") +
        "</p>"
        "<p><strong>Evidence edition:</strong> " + esc(plan["vintage"]) + "</p>"
        "<table><caption>Retained original records</caption><thead>"
        "<tr><th>Source relation</th><th>Records</th></tr></thead><tbody>" +
        counts + "</tbody></table>"
        "<h2>Interpret this source</h2><p>No missing value has been filled. "
        "An organic or unrated surface remains missing. Component percentages "
        "and horizon depth are different kinds of support; horizon rows do not "
        "multiply a component's area weight.</p>"
        "<p>Choose <strong>Soil component K scenario</strong> in Source Preparation "
        "to compare an explicit interpretation against the original USDA result. "
        "The original source is retained independently of each scenario.</p>"
        "<h2>Complete originals</h2><p><a href='tables.json'>Original relational tables</a>"
        " · <a href='capture.json'>Complete capture and member identities</a>"
        " · <a href='plan.json'>Original source selection</a></p>"
        "<p>Source identity: <code>" + esc(capture["source_id"]) + "</code></p></main></html>\n"
    )
    atomic_bytes(Path(output) / "evidence-report.html", body.encode("utf-8"), immutable=True)


def _compose(owner, workspace, task, native, record, output, entry, snapshots):
    """Use the existing native bank and ordinary Workspace import transaction."""
    from source_tools.compose import compose

    original = Path(output) / "source-entry.json"
    if read_json(original) != entry:
        raise ValueError("The returned soil entry differs from its completed original")
    projected = {key: value for key, value in entry.items()
                 if key not in {"path", "bytes", "sha256", "companions"}}
    projected.update(describe_file(native, verify_file(output, entry)))
    companions = [{**item, **describe_file(native, verify_file(output, item))}
                  for item in entry.get("companions", [])]
    companions += [describe_file(native, original, role="ORIGINAL_NATIVE_SOURCE_ENTRY"),
                   describe_file(native, Path(native) / "selection.json", role="PREPARATION_SELECTION")]
    for name, snapshot in snapshots.items():
        folder = Path(native) / "inputs" / name
        companions.append(describe_file(native, folder / "input-snapshot.json",
                                         role="ORIGINAL_INPUT_SELECTION"))
        for item in snapshot["files"]:
            companions.append(describe_file(native, folder / _relative(item["path"]),
                                             role="ORIGINAL_PREPARATION_INPUT"))
    unique = {}
    for item in companions:
        if item["path"] == projected["path"]:
            continue
        if item["path"] in unique and unique[item["path"]]["sha256"] != item["sha256"]:
            raise ValueError("A soil source companion has conflicting identities")
        unique[item["path"]] = item
    projected["companions"] = list(unique.values())
    projected["operator_preparation"] = {
        "method": task["payload"]["method"], "task_id": task["id"],
        "native_entry_sha256": file_digest(original)}
    adapter = Path(native) / "operator-source-entry.json"
    atomic_json(adapter, projected, immutable=True)
    result = compose(Path(native) / "sources.json", entries=[adapter], title=record["title"],
                     scope={"preparation_method": task["payload"]["method"]})
    return owner._finish(workspace, task, native, record, result["manifest"], entry=entry)


def _report_documents(owner, workspace, task, output, result):
    """Publish complete report/table/raster bodies through original file tickets."""
    directory = owner._record_path(workspace, task["id"]).parent / "soil-reports"
    for source in sorted(list(Path(output).iterdir()) +
                         list((Path(output) / "interpretation").glob("*"))):
        if not source.is_file() or source.suffix.lower() not in {".html", ".json", ".csv", ".tif", ".tiff"}:
            continue
        if source.name in {"source-entry.json", "source-manifest.json"}:
            continue
        saved = owner._object(workspace, source)
        target = directory / source.relative_to(output)
        owner._link_object(workspace, saved, target)
        label = ("Soil evidence report" if source.suffix.lower() == ".html"
                 else source.stem.replace("-", " ").replace("_", " ").capitalize())
        result["documents"].append(describe_file(workspace.root, target, label=label))
        result.setdefault("soil_documents", []).append({
            "path": source.relative_to(output).as_posix(),
            "filename": target.name, "bytes": saved["bytes"], "sha256": saved["sha256"]})
        if source.suffix.lower() == ".html":
            result.setdefault("soil_reports", []).append({
                "path": source.relative_to(output).as_posix(),
                "filename": target.name, "sha256": saved["sha256"], "label": label})


def prepare_workbench(owner, workspace, task, native, record, method, options):
    from source_tools import soil_components

    native = Path(native)
    files, snapshots = {}, {}
    supplied = task["payload"].get("inputs", {})
    reference_kind = ("soil-reference" if options.get("input_kind") == "interpretation_reference"
                      else "soil-regional") if method["id"] == "soil-components" else "soil-component"

    def retain_inputs():
        for field in method["inputs"]:
            name = field["name"]
            if not _active(field, options):
                if supplied.get(name):
                    raise ValueError("Remove the input from the other output mode: " + field["label"])
                continue
            selected = supplied.get(name)
            if not selected:
                if field["required"]:
                    raise ValueError("Choose " + field["label"].lower())
                continue
            files[name], snapshots[name] = owner._snapshot(
                workspace, task["id"], name, selected, native,
                reference_kind=reference_kind if name == "capture" else None)
            if name == "reference":
                metadata = snapshots[name].get("metadata", {})
                if metadata.get("kind") not in (None, "raster") or metadata.get("role") not in (None, "NLCD"):
                    raise ValueError("Choose the original numeric land-cover reference grid")

    owner._stage(workspace, record, "Retaining complete original soil evidence", retain_inputs)
    selection = {"schema": "upstate.preparation-selection/v1", "method": method["id"],
                 "request_sha256": task["request_sha256"], "options": options,
                 "inputs": snapshots, "project_id": workspace.project["id"]}
    directory = owner._record_path(workspace, task["id"]).parent
    atomic_json(native / "selection.json", selection, immutable=True)
    atomic_json(directory / "selection.json", selection, immutable=True)
    output = native / "prepared"
    if method["id"] == "soil-components":
        if options["input_kind"] == "interpretation_reference":
            from source_tools.soil_component_reference import capture_reference
            producer = lambda: capture_reference(
                files["capture"], output, vintage=options["vintage"],
                batch_size=options["batch_size"], resume=record["attempt"] > 1)
        else:
            producer = lambda: soil_components.capture(
                files["capture"].parent, output, vintage=options["vintage"],
                batch_size=options["batch_size"], resume=record["attempt"] > 1)
        capture = owner._stage(
            workspace, record, "Receiving original USDA component and horizon relations", producer)
        capture, plan = soil_components.verify_capture(output)
        _capture_report(output, capture, plan)
        entry = _entry(output, "capture.json", source_id=capture["source_id"],
                       title="USDA soil component evidence: " + plan["vintage"],
                       role="SOIL_COMPONENT_SOURCE", vintage=plan["vintage"],
                       metadata={"source_rows": capture["rows"],
                                 "original_capture_sha256": file_digest(output / "capture.json")})
        rows = [[name.capitalize() + " records", count] for name, count in capture["rows"].items()]
        rows += [["Interpretation", "Original evidence; no alternative aggregation applied"],
                 ["Missing values", "Preserved, including organic or unrated horizons"]]
    else:
        # These local fields only select the requested branch. The selected
        # public producer verifies the complete retained source before writing
        # a result; avoid repeating that full regional hash pass here.
        capture = read_json(files["capture"])
        plan = read_json(files["capture"].parent / "plan.json")
        scenario = _selection(options)
        note = options.get("analyst_note", "").strip()
        raster = options["output_mode"] == "raster"
        model_use = options.get("model_use", "comparison") if raster else "comparison"
        if model_use == "model" and not note:
            raise ValueError("Record the scientific interpretation note before selecting model K")
        if raster:
            if not capture.get("regional_capture"):
                raise ValueError("This saved USDA interpretation has no regional polygon geometry. "
                                 "Choose Source tables and readable comparison, or select component "
                                 "evidence captured from a complete regional source for rasters.")
            from source_tools import soil_component_raster
            entry = owner._stage(
                workspace, record, "Preparing the selected soil scenario on the original grid",
                lambda: soil_component_raster.prepare(
                    files["capture"].parent, scenario, files["reference"], output,
                    null_policy=options.get("null_policy", "preserve"),
                    tile_size=options.get("tile_size", 512),
                    model_use=model_use, analyst_note=note))
            prepared = None
        else:
            prepared = owner._stage(
                workspace, record, "Comparing selected components and horizons with the native result",
                lambda: soil_components.prepare_projection(files["capture"].parent, scenario, output))
            atomic_json(output / "operator-interpretation.json", {
                "selection": scenario, "model_use": "comparison", "analyst_note": note,
                "prepared_projection_sha256": prepared["sha256"]}, immutable=True)
            variable = "whole-soil Kw" if scenario["attribute"] == "kwfact" else "rock-free Kf"
            entry = _entry(output, "report.html",
                           source_id="soil-component-scenario-" + digest({
                               "projection": prepared["sha256"], "analyst_note": note})[:20],
                           title="Soil comparison: " + variable + " / " + scenario["component_method"],
                           role="SOIL_K_SCENARIO", vintage=plan["vintage"],
                           metadata={"units": prepared["projection"]["units"]["derived"],
                                     "soil_variable": scenario["attribute"],
                                     "model_use": "comparison", "analyst_note": note})
        rows = [
            ["Erodibility variable", "Whole-soil Kw" if scenario["attribute"] == "kwfact"
                                    else "Rock-free Kf — alternative"],
            ["Component interpretation", scenario["component_method"].replace("_", " ")],
            ["Component percentage", scenario["weight_field"]],
            ["Components", scenario["component_filter"]],
            ["Depth interpretation", scenario["horizon_method"]],
            ["Missing contributions", scenario["missing_policy"]],
            ["Use", "Selected model K" if model_use == "model" else "Comparison only"],
            ["Native baseline", "USDA whole-soil Kw / Dominant Condition / Surface Layer"],
        ]
        if scenario["horizon_method"] == "depth":
            rows.append(["Depth interval (cm)", str(scenario["depth_top_cm"]) +
                         " to " + str(scenario["depth_bottom_cm"])])
        if note:
            rows.append(["Analyst interpretation", note])
        if prepared:
            rows += [["Original " + name + " records", count]
                     for name, count in prepared["projection"]["source_rows"].items()]
            coverage = prepared["projection"]["summary"]
            rows += [["Rated mapunits", coverage["rated_mapunits"]],
                     ["Unrated mapunits", coverage["unrated_mapunits"]],
                     ["Mapunits with tied choices", coverage["mapunits_with_ties"]]]
            shared = [row for row in prepared["native_comparison"] if row["same_support"]]
            rows += [["Mapunits comparable with native Kw", len(shared)],
                     ["Changed comparable mapunits", sum(row["difference_si"] != "0" for row in shared)]]
        elif raster:
            coverage = entry["observed"]
            rows += [["Model domain cells", coverage["model_domain_cells"]],
                     ["Rated scenario cells", coverage["variant_rated_cells"]],
                     ["Cells compared on common support", coverage["same_support_cells"]],
                     ["Changed cells on common support", coverage["changed_same_support_cells"]],
                     ["Scenario-only valid cells", coverage["variant_only_cells"]],
                     ["Native-only valid cells", coverage["native_only_cells"]],
                     ["Conflicting scenario overlap cells", coverage["variant_conflicting_overlap_cells"]],
                     ["Minimum K (SI)", coverage["minimum_si"]],
                     ["Maximum K (SI)", coverage["maximum_si"]],
                     ["Minimum common-support difference (SI)", coverage["minimum_same_support_difference_si"]],
                     ["Maximum common-support difference (SI)", coverage["maximum_same_support_difference_si"]]]
    result = owner._stage(
        workspace, record, "Saving the full soil edition and original source companions",
        lambda: _compose(owner, workspace, task, native, record, output, entry, snapshots))
    result["summary"] = {"title": "Soil evidence and interpretation", "rows": rows}
    _report_documents(owner, workspace, task, output, result)
    return result
