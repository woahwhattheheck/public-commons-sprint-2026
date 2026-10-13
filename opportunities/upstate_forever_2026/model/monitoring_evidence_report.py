"""Readable native evidence chapters in the original Sampling report.

TokenJunkieLabs. Render the frozen resolver record; perform no scientific
calculation, unit conversion, source lookup or statistical inference here.
"""
from __future__ import annotations

import html
import json
import math
from pathlib import PurePosixPath
from urllib.parse import quote

SCHEMA = "upstate.monitoring-native-evidence/v1"


def _text(value):
    if value is None:
        return "Unavailable"
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, float) and not math.isfinite(value):
        raise ValueError("Retain finite original native evidence quantities")
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False)
    return str(value)


def _esc(value):
    return html.escape(_text(value), quote=True)


def _table(title, rows):
    return ("<div class='table'><table><caption>" + _esc(title)
        + "</caption><thead><tr><th scope='col'>Retained quantity or meaning</th>"
          "<th scope='col'>Value</th></tr></thead><tbody>"
        + "".join("<tr><th scope='row'>" + _esc(label) + "</th><td>"
                  + _esc(value) + "</td></tr>" for label, value in rows)
        + "</tbody></table></div>")


def _detail(title, value):
    return ("<details><summary>" + _esc(title) + "</summary><pre>"
            + _esc(value) + "</pre></details>")


def _path(value):
    if not isinstance(value, str):
        raise ValueError("Retain the native evidence member's relative path")
    path = PurePosixPath(value)
    if (not path.parts or path.is_absolute() or str(path) != value
            or ".." in path.parts or "\\" in value or "\0" in value):
        raise ValueError("Native evidence report links require original relative paths")
    return value


def _source_files(source):
    prefix = "native-evidence/" + _path(source["collection_id"]) + "/" + _path(source["source_id"]) + "/"
    files = []
    for item in [source["body"], *source["members"]]:
        name = _path(item.get("view_path", item["filename"]))
        files.append((name, item))
    labels = {
        "report.html": "Open the complete native scientific report",
        "report.pdf": "Open the native report PDF",
        "report.md": "Read the native report Markdown",
        "outcomes.csv": "Open the original matched-control quantities",
        "partitions.csv": "Open the original source-cell partitions",
        "placements.csv": "Open the original control placements",
        "native-response.csv": "Open the original terrain response quantities",
        "response/native-response.csv": "Open the original terrain response quantities",
        "original-native-response.json": "Open the complete original terrain response",
        "assessment.json": "Open the complete original outcome assessment",
        "decision-packet.zip": "Download the saved Conservation decision and editable geography",
        "records/portfolio.json": "Open the original selected-land and union quantities",
        "optimization/index.html": "Open the saved land-priority decision report",
        "conservation-report.json": "Open the original scientific report recipe",
    }
    preferred = []
    remaining = []
    for name, item in files:
        link = "<a href='" + html.escape(quote(prefix + name, safe="/"), quote=True) + "'>"
        label = labels.get(name, name)
        row = ("<li>" + link + _esc(label) + "</a> — " + _esc(name)
               + " (" + _esc(item["bytes"]) + " bytes)</li>")
        (preferred if name in labels else remaining).append(row)
    result = "<h4>Original reports and scientific files</h4>"
    if preferred:
        result += "<ul>" + "".join(preferred) + "</ul>"
    result += ("<details><summary>Complete retained native file inventory</summary><ul>"
               + "".join(remaining) + "</ul></details>")
    result += _detail("Exact source file identities", [
        {"path": name, "bytes": item["bytes"], "sha256": item["sha256"]}
        for name, item in files])
    return result


def _target(value):
    binding = value["target_binding"]
    station = binding["station"]
    cohort = binding["cohort"]
    result = _table("Target and original observation support", [
        ("Source station", station.get("source_station_id")),
        ("Saved network station", station.get("network_station_id")),
        ("Saved contributing-catchment assignment", station.get("catchment_id")),
        ("Retained analytical cohort", cohort["label"]),
        ("Historical evidence begins", binding["evidence_start"]),
        ("Historical evidence ends", binding["evidence_end"]),
        ("Selected calendar months", ", ".join(str(m) for m in binding["months"])),
    ])
    rows = []
    for field, description in cohort["fields"].items():
        if not description["present"]:
            meaning = "Field absent in original observations"
        elif description["value"] is None:
            meaning = "Explicit null in original observations"
        else:
            meaning = description["value"]
        rows.append((field, meaning))
    result += _table("Exact laboratory and constituent metadata", rows)
    result += _table("Applicability of native evidence to this target", [
        ("Spatial relationship", "Original modeled support and station catchment are retained separately; equivalence is not established."),
        ("Constituent relationship", "Analyst-authored context for the exact cohort retained above."),
        ("Temporal relationship", "Annual modeled quantity alongside the selected historical observation window."),
        ("Comparison method", "The scientist's rationale links this evidence to the proposed target."),
    ])
    result += _detail("Saved target, context and network identities", binding)
    return result


def _controls(native):
    pollutant = native["selected_quantity"]["pollutant"]
    units = native["selected_quantity"]["units"]
    support = native["support"]
    result = ("<h4>Matched-control outcomes</h4><p>B denotes the unchanged baseline, "
              "R the restoration, and C the selected matched control. "
              "B−R and B−C are the original modeled reductions in source-pixel export. "
              "C−R is the directly computed restoration advantage. All values below retain "
              "the original annual units: " + _esc(units) + ".</p>")
    result += _table("Support shared by the complete selected control roster", [
        ("Quantity scope", native["quantity_scope"]),
        ("Common finite native cells", support["native_common_cells"]),
        ("Common finite native area, hectares", support["native_common_hectares"]),
        ("All selected run IDs", support["run_ids"]),
        ("Original common-support mask SHA256", support["mask_sha256"]),
        ("Availability", support.get("unavailable_reason") or "Available"),
    ])
    ordered = sorted(enumerate(native["rows"]),
                     key=lambda pair: (pair[1]["support_mode"] != "group_common", pair[0]))
    last_mode = None
    for _, region in ordered:
        mode = region["support_mode"]
        if mode != last_mode:
            result += "<h4>" + ("Complete-roster common support" if mode == "group_common"
                                else "Individual-design common support") + "</h4>"
            result += "<p>" + _esc(region["support_definition"]) + ".</p>"
            last_mode = mode
        row = region["siting_contrasts"][pollutant]
        mass = row["mass"]
        alternatives = row["alternatives"]
        result += _table(region["title"] + " — " + region["design_id"], [
            ("Baseline export, B (" + units + ")", mass["baseline"]),
            ("Restoration export, R (" + units + ")", mass["restoration"]),
            ("Control export, C (" + units + ")", mass["control"]),
            ("Baseline − restoration, B−R (" + units + ")", alternatives["restoration"]["avoided_export_mass"]),
            ("Baseline − control, B−C (" + units + ")", alternatives["control"]["avoided_export_mass"]),
            ("Control − restoration, C−R (" + units + ")", row["restoration_advantage_mass"]),
            ("Common finite native cells", row["native_common_cells"]),
            ("Common-support mask SHA256", row["mask_sha256"]),
            ("Source interpretation", row.get("interpretation")),
        ])
        for role in ("restoration", "control"):
            alternative = alternatives[role]
            result += _table(role.capitalize() + " intervention area denominators", [
                ("Whole-scenario changed area, hectares", alternative["whole_scenario_changed_hectares"]),
                ("Selected-region changed area, hectares", alternative["region_changed_hectares"]),
                ("Changed area within native common support, hectares", alternative["native_common_changed_hectares"]),
                ("Whole-scenario changed-footprint ID", alternative["whole_scenario_footprint_id"]),
            ])
        result += _detail("Original support, source-cell partitions and area-normalized quantities", {
            "quantity": row,
            "native_support": region["native_support"][pollutant],
            "explicit_run_ids": region["run_ids"],
        })
    for placement in native["placements"]:
        result += _table("Retained control placement: " + placement["title"], [
            ("Design ID", placement["design_id"]),
            ("Control run ID", placement["control_run_id"]),
            ("Changed cells", placement["changed_cells"]),
            ("Changed area, hectares", placement["changed_hectares"]),
            ("Same placement as design", placement["same_placement_as"] or "No exact duplicate in the selected roster"),
            ("Original placement SHA256", placement["placement_sha256"]),
        ])
    if native["placement_overlaps"]:
        result += _detail("Original pairwise placement intersections and Jaccard overlap", native["placement_overlaps"])
    return result


def _terrain(native):
    units = native["selected_quantity"]["units"]
    support = native["support"]
    result = ("<h4>Terrain sensitivity outcomes</h4><p>Each change is "
              "alternative minus baseline on the finite native cells shared by the "
              "baseline and every selected terrain alternative. The original normalized "
              "pixel masses were summed once. Annual totals below retain "
              + _esc(units) + "; the original map legends retain their per-pixel units.</p>")
    result += _table("Support shared by all selected terrain editions", [
        ("Common finite native cells", support["joint_valid_cells"]),
        ("Common finite native area, hectares", support["joint_area_ha"]),
        ("Baseline export on that support (" + units + ")", support["baseline_joint_total"]),
        ("Original terrain case", native["case_id"]),
        ("Completed native response", native["response_id"]),
    ])
    for row in native["rows"]:
        result += _table("Terrain edition: " + row["variant"], [
            ("Entered stream-burn depth, metres", row["burn_depth_m"]),
            ("Baseline export on joint support (" + units + ")", row["baseline_joint_total"]),
            ("Alternative export on joint support (" + units + ")", row["alternative_joint_total"]),
            ("Alternative − baseline on joint support (" + units + ")", row["change_joint_total"]),
            ("Change relative to joint-support baseline, percent", row["change_percent"]),
            ("Common finite native cells", row["joint_valid_cells"]),
            ("Common finite native area, hectares", row["joint_area_ha"]),
            ("Original alternative run", row["run_id"]),
        ])
        result += _table("Original full-support coverage: " + row["variant"], [
            ("Baseline valid cells", row["baseline_valid_cells"]),
            ("Alternative valid cells", row["alternative_valid_cells"]),
            ("Pairwise cells lost from baseline", row["lost_valid_cells"]),
            ("Pairwise cells gained from baseline", row["gained_valid_cells"]),
            ("Baseline export on its own full support (" + units + ")", row["baseline_native_total"]),
            ("Alternative export on its own full support (" + units + ")", row["alternative_native_total"]),
        ])
    result += ("<p>Full-support totals describe each run's own valid coverage. "
               "The comparison uses the common-support values above. Entered burn depth "
               "precedes terrain filling; the original terrain report records the final elevation changes.</p>")
    return result



def _conservation(native):
    decision = native["decision"]
    units = native["selected_quantity"]["units"]
    result = ("<h4>Saved Conservation decision</h4><p>The quantities below describe the "
              "original selected reporting-area union. Overlapping planning units are counted "
              "once in these union totals. The decision's selected land, native scenarios and "
              "scientist-authored sampling hypothesis remain separate records.</p>")
    result += _table("Original selected decision and geography", [
        ("Saved portfolio", decision["title"]), ("Saved study", decision["study_title"]),
        ("Scientific purpose", decision["purpose"]), ("Original planning-unit label", decision["planning_unit_label"]),
        ("Selected original unit IDs", ", ".join(decision["selected_ids"])),
        ("Selected reporting union, hectares", decision["summary"].get("union_area_ha")),
        ("Selected whole-unit union, hectares", decision["summary"].get("whole_unit_union_area_ha")),
        ("Overlap excluded from union, hectares", decision["summary"].get("overlap_area_ha")),
        ("Original analysis CRS", native["geometry"]["analysis_crs"]),
        ("Original footprint layer", native["geometry"]["selected_union"]["layer"]),
        ("Saved plan ID", decision["plan_id"]), ("Original study ID", decision["study_id"]),
    ])
    for row in native["rows"]:
        if row["support_kind"] == "baseline_own":
            result += _table("Original baseline on its own valid support", [
                ("Baseline run", row["baseline_run_id"]),
                ("Baseline annual mass (" + units + ")", row["baseline_own_total"]),
                ("Own-support coverage fraction", row["baseline_own_coverage_fraction"]),
                ("Own-support valid area, hectares", row["baseline_own_valid_area_ha"]),
                ("Own-support structural stream area, hectares", row["baseline_own_structural_area_ha"]),
                ("Own-support missing area, hectares", row["baseline_own_missing_area_ha"]),
                ("Availability", row.get("availability")),
                ("Availability explanation", row.get("availability_reason")),
            ])
            continue
        matched = row["support_kind"] == "all_family_common"
        title = ("All-declared-family common support: " if matched else
                 "Original fixed-baseline pair support: ") + row["label"]
        result += _table(title, [
            ("Scientific family reason", row.get("scientific_reason")),
            ("Scientific reference", row.get("reference")),
            ("Baseline run", row["baseline_run_id"]), ("Alternative run", row["alternative_run_id"]),
            ("Baseline annual mass on comparison support (" + units + ")", row.get("common_baseline")),
            ("Alternative annual mass on comparison support (" + units + ")", row.get("common_alternative")),
            ("Alternative − baseline (" + units + ")", row.get("delta")),
            ("Baseline − alternative (" + units + ")", row.get("reduction")),
            ("Common valid area, hectares", row.get("common_valid_area_ha")),
            ("Verified structural stream area, hectares", row.get("common_structural_stream_area_ha")),
            ("Covered area, hectares", row.get("common_covered_area_ha")),
            ("Missing area on comparison support, hectares", row.get("missing_area_ha") if matched else None),
            ("Common coverage fraction", row.get("common_coverage_fraction")),
            ("Availability", row.get("comparison_availability")),
            ("Availability explanation", row.get("comparison_availability_reason")),
            ("Original profile changed in this pair", row.get("profile_changed")),
            ("Original per-pollutant support ID", row.get("support_id")),
            ("Original support mask SHA256", row.get("support_sha256")),
        ])
        if not matched:
            result += _table("Original alternative on its own support", [
                ("Alternative own-support annual mass (" + units + ")", row.get("value")),
                ("Own-support coverage fraction", row.get("coverage_fraction")),
                ("Own-support valid area, hectares", row.get("valid_area_ha")),
                ("Own-support structural area, hectares", row.get("structural_stream_area_ha")),
                ("Own-support missing area, hectares", row.get("missing_area_ha")),
                ("Availability", row.get("availability")),
                ("Availability explanation", row.get("availability_reason")),
            ])
    result += ("<p>Each pollutant retains its own support. Fixed-baseline pair coverage and "
               "all-family coverage are different original comparisons. Structural stream omissions "
               "remain distinct from finite mass-bearing cells; absent finite mass remains unavailable. "
               "Annual source-pixel exports, selected-area treatments and station observations are "
               "not converted into one another.</p>")
    optimization = decision.get("optimization")
    if optimization:
        request = optimization["request"]
        objective = request.get("objective", {})
        weights = request.get("weights", {})
        constraints = request.get("constraints", {})
        filters = request.get("filters", {})
        historical = optimization.get("detail_availability") == "historical_reference_only"
        result += _table("Authored land-decision settings retained with this sampling question", [
            ("Saved analysis title", request.get("title")),
            ("Decision purpose", request.get("purpose")),
            ("Objective kind", objective.get("kind")),
            ("Quantity basis", objective.get("basis")),
            ("Selected original alternative", objective.get("scenario_run_id")),
            ("Selected matched family", objective.get("family_id")),
            ("Original selected weights", weights),
            ("Budget limit, USD", constraints.get("budget_usd") if constraints.get("budget_usd") is not None
             else "No budget limit selected"),
            ("Area limit, hectares", constraints.get("area_ha") if constraints.get("area_ha") is not None
             else "No area limit selected"),
            ("Area-limit basis", constraints.get("area_basis")),
            ("Planning-unit count limit", constraints.get("max_count") if constraints.get("max_count") is not None
             else "No count limit selected"),
            ("Minimum objective coverage fraction", filters.get("min_coverage_fraction")),
            ("Maximum protected fraction", filters.get("max_protected_fraction")),
            ("Source-water selection", filters.get("source_water")),
            ("High-quality-water selection", filters.get("high_quality_water")),
            ("Selected candidate universe", filters.get("include_ids") or "All original candidates before the other filters"),
            ("Excluded unit IDs", filters.get("exclude_ids")),
            ("Include otherwise ineligible units", request.get("include_ineligible")),
            ("Selected solver", request.get("solver")),
            ("Saved analysis detail", "Historical saved-decision reference" if historical
             else "Complete original analysis retained"),
            ("Analysis ID", optimization["id"]),
        ])
        if historical:
            result += ("<p>" + _esc(optimization.get("detail_reason"))
                       + ". The original selected request, engine, normalization and saved solver result "
                         "remain in the decision reference below.</p>")
        for criterion in objective.get("criteria", []):
            result += _table("Authored criterion: " + str(criterion.get("label", criterion["id"])), [
                ("Criterion ID", criterion["id"]),
                ("Quantity kind", criterion.get("kind")),
                ("Quantity basis", criterion.get("basis")),
                ("Original quantity axis", criterion.get("axis")),
                ("Weight", weights.get(criterion["id"])),
                ("Available in this original decision", criterion.get("available")),
                ("Matched family", criterion.get("family_id")),
                ("Alternative run", criterion.get("scenario_run_id")),
                ("Source attribute", criterion.get("field")),
                ("Original criterion units", criterion.get("unit")),
                ("Preference direction", criterion.get("direction")),
            ])
        result += ("<p>Each selected weight belongs to its named quantity or criterion and the "
                   "saved normalization. Geographic filters, budget, area and count limits describe "
                   "the original land decision. The Sampling target retains its separately authored "
                   "station, cohort and calendar.</p>")
        result += ("<p>Preference weights and deterministic case-selection frequencies "
                   "describe the saved land decision. They are not measured uncertainty, "
                   "sampling power or a calculated benefit of a future field visit.</p>")
        result += _detail(
            "Original historical decision reference" if historical else
            "Original priority request, fixed normalization and complete case results",
            optimization)
    result += _detail("Selected original planning-unit rows (overlapping rows are not additive)",
                      decision["selected_units"])
    return result


def render(value):
    """Return one escaped HTML chapter from a frozen per-target evidence record."""
    if value is None:
        return ""
    if not isinstance(value, dict) or value.get("schema") != SCHEMA:
        raise ValueError("Render an original retained Sampling native-evidence record")
    source = value["source"]
    native = value["native"]
    quantity = native["selected_quantity"]
    result = ("<div class='sampling-native-evidence'><h3>Native model evidence</h3>"
              "<h4>Scientist's rationale for this target</h4><p>"
              + _esc(value["applicability"]) + "</p>")
    result += _table("Selected scientific source", [
        ("Report", source["title"]),
        ("Selected quantity", quantity["pollutant"]),
        ("Original annual units", quantity["units"]),
        ("Original source classification", native.get("classification")),
        ("Source project", native["project_id"]),
        ("Completed native result", native["id"]),
        ("Source entry", source["source_id"]),
        ("Source relationship", "Same saved project" if native["source_project_relation"] == "same_project"
                               else "Retained report from another project"),
        ("Modeled quantity scope", native["quantity_scope"]),
    ])
    result += _target(value)
    if native["family"] == "control_outcomes":
        result += _controls(native)
    elif native["family"] == "terrain_response":
        result += _terrain(native)
    elif native["family"] == "conservation_portfolio":
        result += _conservation(native)
    else:
        raise ValueError("Use a supported completed native evidence family")
    result += ("<h4>Scientific interpretation</h4><ul>"
               + "".join("<li>" + _esc(item) + "</li>" for item in value["limitations"]) + "</ul>")
    result += _source_files(source)
    result += _detail("Original geometry, source classifications and producing native versions", {
        "geometry": native["geometry"],
        "original_input_classifications": native["original_input_classifications"],
        "native_execution": native["native_execution"],
        "run_ids": native["run_ids"],
    })
    result += _detail("Exact scientific source identity", {
        "collection_id": source["collection_id"],
        "source_id": source["source_id"],
        "uri": source["uri"],
        "collection_sha256": source["collection_sha256"],
        "entry_sha256": source["entry_sha256"],
        "native_id": native["id"],
        "relation": value["relation"],
    })
    return result + "<p>Scientific workflow and software: TokenJunkieLabs.</p></div>"
