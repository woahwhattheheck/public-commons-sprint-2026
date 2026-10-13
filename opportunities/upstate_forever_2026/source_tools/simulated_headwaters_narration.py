"""Prepare natural narration from the exact frozen native teaching selection.

This writes a script and source references. An existing authorized generative
voice producer records it against the actual retained walkthrough timings.
"""
import math

SCHEMA = "upstate.simulated-headwaters-narration/v1"


def build_narration(case, selected_case, *, programme_id=None, fieldwork=None, customer=None):
    if case.get("schema") != "upstate.simulated-teaching-selection/v1":
        raise ValueError("Select the original frozen native teaching case")
    if not isinstance(case.get("runs"), list) or not case["runs"]:
        raise ValueError("Retain the selected baseline and alternatives")
    if case.get("native_direction") != "alternative minus baseline":
        raise ValueError("Retain the original native comparison direction")
    rows = case["runs"]
    baseline = rows[0]
    if baseline["role"] != "baseline":
        raise ValueError("The first original teaching run must be the baseline")
    run_by_id = {row["run_id"]: row for row in rows}
    if len(run_by_id) != len(rows):
        raise ValueError("Retain each original selected native run exactly once")
    scenes = []
    chapters = ["scientific inputs", "calculated response"]
    if fieldwork:
        chapters.append("field quality review")
    if customer:
        chapters.append("engineering handback")
    journey = ", ".join(chapters) + " and independent reopening"

    def add(key, title, text, pointers=(), identities=None):
        scenes.append({
            "id": key, "title": title, "text": text,
            "sources": [{"path": selected_case["path"], "sha256": selected_case["sha256"],
                         "json_pointer": pointer} for pointer in pointers],
            "identities": identities or {},
            "recording_scene_ids": (["parameters", "comparison"] if key == "parameter_course" else [key]),
            "timing": {"basis": "actual recorded scene", "start_seconds": None,
                       "end_seconds": None},
        })

    def number(value):
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            return None
        return format(value, ".8g")

    def name(row):
        return str(row.get("scenario_title") or row["scenario_id"])

    add("study", "The saved simulated study",
        "This is an explicitly simulated Piedmont-style headwater study. "
        "The landscape, source areas, model coefficients and teaching decisions were authored for this demonstration. "
        "The application keeps their original source records alongside the calculated results. "
        "We will follow the saved case through " + journey + ".",
        ["/demo_id", "/project_id", "/selection"])
    add("geography", "One retained model grid",
        "Start with the selected model domain, reporting boundary and original grid. "
        "Read the visible cell size, extent and units before comparing maps. "
        "Each selected alternative retains this grid and its original scientific support.",
        ["/selection/grid_id"])
    profile_names = list(dict.fromkeys(str(row.get("profile_title") or row["profile_id"]) for row in rows))
    add("parameters", "Original parameters and their assumptions",
        "The saved parameter profiles are " + "; ".join(profile_names) + ". "
        "Open the original table and model parameters. Land-cover comparisons and parameter changes answer different questions. "
        "A profile change stays labelled as a parameter sensitivity; it is not silently treated as a land-cover-only effect.",
        ["/profiles"], {"profile_ids": list(dict.fromkeys(row["profile_id"] for row in rows))})
    descriptions = ["The baseline is " + name(baseline) + "."]
    for row in rows[1:]:
        text = "The selected alternative is " + name(row) + "."
        footprint = row.get("footprint_summary") or {}
        cells, hectares = number(footprint.get("net_changed_cells")), number(footprint.get("net_changed_hectares"))
        if cells is not None and hectares is not None:
            text += " Its retained footprint changes " + cells + " cells, covering " + hectares + " hectares."
        text += (" Its parameter profile also differs from the selected baseline profile."
                 if row.get("profile_changed") else " It retains the selected baseline profile.")
        descriptions.append(text)
    add("alternatives", "Read the actual scenario masks",
        " ".join(descriptions) + " Open the saved masks and original class transitions. "
        "Compare treatment location, starting land cover and remaining terrain or climate differences before explaining the response.",
        ["/runs"], {"run_ids": [row["run_id"] for row in rows]})
    add("calculation", "Completed native calculations",
        "These are the retained native calculations for the selected run identities. "
        "Open their actual stages, runtime versions, output files and timestamps. "
        "Reopening a completed calculation reads its saved result; the original model duration and this walkthrough duration remain separate.",
        ["/runs"], {"run_ids": [row["run_id"] for row in rows], "programme_id": programme_id})
    add("maps", "Physical quantities and map support",
        "Read the selected quantity and legend. Original InVEST three point twenty export rasters are annual mass per hectare. "
        "Integrated Workspace export cells contain annual mass after multiplying by the actual cell hectares once. "
        "Native watershed totals already contain annual mass. Read each selected artifact's units and support before summing or comparing. "
        "Physical export quantities and combined priority scores have different meanings.",
        ["/runs"], {"grid_id": case["selection"]["grid_id"]})
    comparison_lines = []
    for index, row in enumerate(case.get("native_changes", [])):
        if row["run_id"] not in run_by_id:
            raise ValueError("A narrated comparison belongs to an unselected run")
        value = number(row.get("alternative_minus_baseline"))
        quantity = str(row["quantity"]).replace("_", " ")
        title = name(run_by_id[row["run_id"]])
        units = row.get("units")
        support = number(row.get("common_valid_cells"))
        if value is None or not units or support is None:
            comparison_lines.append(title + ", " + quantity
                                    + ": inspect the retained record for its stated quantity, units and common support.")
            continue
        comparison_lines.append(title + ", " + quantity + ": signed change " + value + " "
                                + str(units) + ", on " + support + " common valid cells.")
    add("comparison", "Explain the saved response",
        "The ordinary native comparison uses alternative minus baseline. A negative export change is a reduction. "
        + " ".join(comparison_lines)
        + " Each row keeps its own original common-valid-cell support. A different support or parameter profile changes the interpretation.",
        ["/native_changes", "/native_support_basis"], {"comparison_id": case["comparison_id"]})
    if case.get("parameter_course") is not None:
        course = case["parameter_course"]
        add("parameter_course", "Separate sensitivity from siting",
            "Open the retained parameter course and its actual completion state. "
            "The native study's scalar changes use alternative minus baseline. Its parameter contrasts use varied-profile baseline minus reference-profile baseline. "
            "Paired raster reductions and joint siting avoided exports use baseline minus alternative, so positive values indicate reductions there. "
            "Read each named product's original masks, members and sign convention; pairwise support and joint support remain distinct.",
            ["/parameter_course"], {"ensemble_id": course["ensemble_id"]})
    add("delivery", "The complete scientific delivery",
        "Open the selected report, its map families and original physical outputs. "
        "Follow a displayed quantity back to its selected input, run and artifact. "
        "Explain the computed result without assuming restoration must improve every quantity.",
        ["/selection"])
    if fieldwork:
        add("field_qc", "Laboratory evidence and follow-up",
            "Continue into the same saved field plan. Read the original laboratory values, method, units and qualifiers. "
            "Open the initial quality review and the linked corrective task, then the repeat review and closeout history. "
            "The entered quality criteria are explicit project choices. The original observations and source attachments remain visible beside every decision.",
            [], {key: fieldwork[key] for key in ("operation_id", "plan_id", "project_id")})
    if customer:
        add("customer_review", "Customer request and engineering handback",
            "Open the saved original review and its actual authored teaching response. "
            "Follow the request into the assigned engineering work and ready handback. "
            "Open the revised evidence, then return to the original response to see the complete history. "
            "The local response drafted during this walkthrough is explicitly simulated teaching input.",
            [], dict(customer["selected"]))
    add("transfer", "Independently reopen the working project",
        "Download the complete project and its retained review packages. Extract and open the actual outgoing files. "
         "In the received application, reopen the same project and selected results, together with every selected saved field or customer record. "
        "The source identities stay attached to the working records, so another operator can continue the same case.",
        ["/project_id", "/selection"])
    return {"schema": SCHEMA, "project_id": case["project_id"], "demo_id": case["demo_id"],
            "classification": "Explicit simulated teaching case; actual retained native results",
            "selected_case": selected_case, "fieldwork_receiving": fieldwork,
            "customer_review": customer, "scenes": scenes,
            "production": {
                "voice": "Existing authorized high-quality natural generative narrator; no real-person clone",
                "timing": "Align each scene to actual completed recording actions; no invented duration",
                "preserve": "Retain original unedited recording, source-bound script, generated audio and final export",
                "inspection": "Producing worker watches and listens to the final export, opens every included attachment and fixes defects",
                "native_execution_dependency": False,
            }}


def narration_markdown(value):
    lines = ["# Narration for the frozen simulated headwater course", "",
             "Project: " + value["project_id"], "",
             "Selected case SHA256: " + value["selected_case"]["sha256"], "",
             "Read against the actual scene timing. Original IDs and source pointers remain in narration-script.json.", ""]
    for scene in value["scenes"]:
        lines += ["## " + scene["title"] + " (" + scene["id"] + ")", "", scene["text"], ""]
    lines += ["## Production", "", value["production"]["voice"] + ".",
              value["production"]["timing"] + ".",
              value["production"]["preserve"] + ".",
              value["production"]["inspection"] + ".", ""]
    return "\n".join(lines)
