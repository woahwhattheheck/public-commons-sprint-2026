"""Retain an existing native parameter design as an ordered scientific source.

The original ensemble/report producers own every physical quantity, case range
and support identity. This module packages those results and their scientific
choices, then uses the existing collector and report renderer. It never starts
a native model or assigns a probabilistic meaning to the selected cases.
"""
from __future__ import annotations

from collections import defaultdict
from copy import deepcopy
from pathlib import Path
import json
import textwrap
from xml.etree import ElementTree as ET

from .common import (atomic_bytes, atomic_json, describe_file, digest, file_digest,
                     held, identifier, now, read_json, verify_file)
from .ensembles import Ensembles
from . import ensemble_report, ensemble_scientific_source as shared
from . import ensemble_scientific_figures as drawing
from . import ensemble_study_scope as source_scope

VERSION = 2
DIRECTORY = "ensemble-study-sources"
SOURCE_ID = "saved-native-ensemble-study"
SPEC = "study-figure-spec.json"
COORDINATES = "study-figure-coordinates.csv"
POLLUTANT_LABELS = {"nitrogen_export": "Nitrogen", "phosphorus_export": "Phosphorus",
                    "sediment_export": "Sediment"}


def _plain(value):
    if value is None:
        return "Undefined"
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False)
    if isinstance(value, float):
        return format(value, ".7g")
    return str(value)


def _table(columns, rows):
    return {"kind": "table", "columns": columns,
            "rows": [[_plain(value) for value in row] for row in rows]}


def _case_key(field, index):
    """A display key for one unchanged row of the retained report edition."""
    return ("LC" if field == "paired_rows" else "PS") + format(index + 1, "04d")


def _percentage(row, *, reference_label="baseline"):
    value = row["percent_change"]
    if value is not None:
        return _plain(value)
    if not row["common_cells"]:
        return "Undefined: no common valid cells"
    if row["baseline_common"] == 0:
        return "Undefined: zero common-valid " + reference_label
    return "Undefined in original report"


def _mask_agreement(row):
    if not row["common_cells"]:
        return "No common valid cells"
    return "Yes" if not row["baseline_only_cells"] and not row["alternative_only_cells"] else "No"


def _case_tables(field, rows, *, reference_label="Baseline"):
    identities = _table(
        ["Pair", "Parameter case", "Original profile", "Reference case / profile"],
        [[_case_key(field, index), row["member_label"], row["profile_id"],
          (str(row.get("reference_member_label") or "Reference") + "\n"
           + str(row.get("reference_profile_id") or "Unspecified"))
          if field == "parameter_rows" else "Same profile as this alternative"]
         for index, row in rows])
    identities["caption"] = "Figure case key — original report rows and selected profiles"
    coverage = _table(
        ["Pair", reference_label + " valid", "Alternative valid", "Common", reference_label + " only", "Alternative only"],
        [[_case_key(field, index), row["baseline_valid_cells"], row["alternative_valid_cells"],
          row["common_cells"], row["baseline_only_cells"], row["alternative_only_cells"]]
         for index, row in rows])
    coverage["caption"] = (
        "Original cell counts inside the reporting mask. Only-cells are excluded from this paired "
        "contrast. Cells invalid in both runs and cells outside the reporting mask are not counted.")
    return [identities, coverage]


def _study_svg(figure):
    """Add the visible case key to the existing monochrome standalone drawing."""
    original = ET.fromstring(drawing._svg(figure))
    namespace = "http://www.w3.org/2000/svg"
    ET.register_namespace("", namespace)
    width, height = 960, int(original.attrib["height"])
    lines = []
    for note in figure["case_legend"]:
        lines.extend(textwrap.wrap(note, width=64, break_long_words=True,
                                   break_on_hyphens=False) or [""])
    footer_height = 48 + 17 * len(lines)
    original.set("height", str(height + footer_height))
    original.set("viewBox", "0 0 " + str(width) + " " + str(height + footer_height))
    group = ET.SubElement(original, "{" + namespace + "}g")
    ET.SubElement(group, "{" + namespace + "}line",
                  x1="62", x2="922", y1=str(height + 8), y2=str(height + 8),
                  stroke="#777", **{"stroke-width": "1"})
    label = ET.SubElement(group, "{" + namespace + "}text", x="62", y=str(height + 29),
                          **{"font-size": "13", "font-weight": "bold"})
    label.text = "Case key and original geographic support"
    for index, line in enumerate(lines):
        label = ET.SubElement(group, "{" + namespace + "}text", x="62",
                              y=str(height + 49 + index * 17), **{"font-size": "12"})
        label.text = line
    return ET.tostring(original, encoding="unicode") + "\n"


def _snapshot(workspace, ensemble_id, scenario_reference=None):
    if scenario_reference is None:
        release = ensemble_report.build(workspace, identifier(ensemble_id))
    else:
        from . import ensemble_scenario_contrasts
        release = ensemble_scenario_contrasts.build(workspace, identifier(ensemble_id), scenario_reference)
    directory = workspace.root / "ensemble_reports" / release["id"]
    original = read_json(verify_file(directory, release["files"]["report.json"]))
    plan = workspace._get("ensembles", identifier(ensemble_id))
    manager = Ensembles(workspace)
    runs = {item["run_id"]: workspace.inspect_run(item["run_id"])
            for member in plan["members"] for item in member["runs"]}
    report = original["report"]
    if (original["ensemble_id"] != plan["id"] or release["ensemble_id"] != plan["id"]
            or release["summary_signature"] != ensemble_report.summary_signature(report)
            or manager._signature(runs) != report["run_signature"]):
        raise ValueError("The native design advanced while its report was selected; prepare its current report again")
    if not original["paired_rows"] and not original["parameter_rows"]:
        raise ValueError("Complete at least one native land-cover or parameter contrast before preparing its scientific source")
    selection = {"version": VERSION, "workspace_id": workspace.project["id"], "ensemble_id": plan["id"],
                 "report_id": release["id"], "summary_signature": release["summary_signature"],
                 "run_signature": report["run_signature"],
                 "producer_sha256": file_digest(Path(__file__)),
                 "figure_helper_sha256": file_digest(Path(drawing.__file__)),
                 "source_scope_helper_sha256": file_digest(Path(source_scope.__file__))}
    if scenario_reference is not None:
        selection["scenario_reference"] = deepcopy(report["scenario_reference"])
        selection["scenario_contrast_helper_sha256"] = file_digest(Path(ensemble_scenario_contrasts.__file__))
    return selection, plan, release, original, runs


def _package(workspace, directory, plan, release, content, runs):
    """Keep all report inputs; retain native raster identities without duplicating them."""
    report_root = workspace.root / "ensemble_reports" / release["id"]
    for name, item in release["files"].items():
        if name.endswith(".zip"):
            continue
        source = verify_file(report_root, item)
        shared._copy(workspace, describe_file(workspace.root, source),
                     directory / "numeric" / shared._member(name))
    atomic_json(directory / "numeric" / "release.json", release, immutable=True)
    atomic_json(directory / "original" / "ensemble.json", plan, immutable=True)
    atomic_json(directory / "original" / "native-runs.json", runs, immutable=True)
    grid = workspace.get_grid(plan["grid_id"])
    atomic_json(directory / "original" / "grid.json", grid, immutable=True)
    profiles, scenarios, roles, originals = {}, {}, {}, {}
    for member in plan["members"]:
        for key in (member["profile_id"], member.get("parent_profile_id")):
            if key and key not in profiles:
                profiles[key] = workspace._get("profiles", identifier(key))
        for item in member["runs"]:
            key = item["scenario_id"]
            if key not in scenarios:
                scenarios[key] = workspace._get("scenarios", identifier(key))
    for key, value in profiles.items():
        atomic_json(directory / "original" / "profiles" / (key + ".json"), value, immutable=True)
        ref = (identifier(value["source_collection_id"]), value["biophysical_source_id"])
        roles.setdefault(ref, set()).add("biophysical table")
        originals[ref] = True
    for key, value in scenarios.items():
        atomic_json(directory / "original" / "scenarios" / (key + ".json"), value, immutable=True)
        for patch in value.get("patches", []):
            ref = (identifier(value["source_collection_id"]), patch["mask_source_id"])
            roles.setdefault(ref, set()).add("scenario mask: " + key)
    spec = grid["spec"]
    collection_id = identifier(spec["source_collection_id"])
    for role, source_id in spec["input_sources"].items():
        roles.setdefault((collection_id, source_id), set()).add(role)
    for role in ("reporting_area", "model_domain"):
        value = spec.get(role)
        if isinstance(value, dict) and value.get("source_id"):
            roles.setdefault((collection_id, value["source_id"]), set()).add(role)
    collections, source_records, bindings = {}, [], []
    for collection, source_id in sorted(roles):
        if collection not in collections:
            collections[collection] = workspace._get("sources", collection)
            atomic_json(directory / "original" / "source-collections" / (collection + ".json"),
                        collections[collection], immutable=True)
        selected = [entry for entry in collections[collection]["entries"] if entry["id"] == source_id]
        if len(selected) != 1:
            raise ValueError("An original native input source is absent from its retained collection")
        entry = selected[0]
        ref = (collection, source_id)
        included = bool(originals.get(ref))
        folder = directory / "coefficient-sources" / collection / digest(source_id)
        if included:
            unused, entry = workspace.source_file(collection, source_id)
            atomic_json(folder / "entry.json", entry, immutable=True)
            shared._copy(workspace, collections[collection]["original_manifest"],
                         folder / "original-manifest.json")
            for body in [entry["body"], *entry.get("companions", [])]:
                shared._copy(workspace, body, folder / "members" /
                             shared._member(body.get("view_path", body["filename"])))
        bindings.append({"source_collection_id": collection, "source_id": source_id,
                         "roles": sorted(roles[ref]), "entry": deepcopy(entry),
                         "original_bytes_in_report_package": included})
        source_records.append({"id": "native-input-%04d" % len(source_records),
            "source_collection_id": collection, "source_id": source_id,
            "title": entry.get("title", source_id), "uri": entry.get("uri", ""),
            "vintage": entry.get("vintage", ""), "body_sha256": entry["body"]["sha256"]})
    # Exact comparisons are report inputs, including original difference descriptors.
    comparison_ids = {row["comparison_id"] for name in ("paired_rows", "parameter_rows")
                      for row in content[name]}
    for key in sorted(comparison_ids):
        path = workspace.root / "comparisons" / identifier(key) / "comparison.json"
        if not path.is_file():
            raise ValueError("The original native comparison record is unavailable: " + key)
        record = read_json(path)
        if record.get("id") != key:
            raise ValueError("The original comparison record has another identity")
        atomic_json(directory / "original" / "comparisons" / (key + ".json"), record, immutable=True)
    scope, reference_bindings, reference_records = source_scope.capture(
        workspace, directory, grid, profiles, bindings, collections)
    bindings.extend(reference_bindings)
    source_records.extend(reference_records)
    inventory = {
        "schema": "upstate.ensemble-study-inputs/v1", "ensemble_id": plan["id"],
        "grid_id": grid["id"], "grid": deepcopy(grid["grid"]),
        "aligned_inputs": deepcopy(grid["inputs"]), "aligned_files": deepcopy(grid["files"]),
        "source_bindings": bindings,
        "native_output_artifacts": {key: deepcopy(run.get("artifacts", {})) for key, run in runs.items()},
        "package_scope": (
            "This scientific source includes every original numeric report row, common-support hash, "
            "native run/comparison/grid record, complete selected profile and scenario record, and "
            "original biophysical table body and explicitly referenced assumption/recipe documents "
            "with companions. Large original/aligned model rasters "
            "and scenario geometry remain in the complete Workspace archive under their exact "
            "retained paths, bytes and SHA256 identities. They are not replaced by the report figures."),
    }
    atomic_json(directory / "native-input-inventory.json", inventory, immutable=True)
    atomic_json(directory / "original-source-editions.json", source_records, immutable=True)
    return source_records, profiles, scenarios, scope


def _figures(directory, content):
    """Show original contrasts, with each geographic support and physical unit separate."""
    figures, coordinates, omissions = [], [], []
    direct_reference = content.get("report", {}).get("scenario_reference")
    reference_word = "reference" if direct_reference else "baseline"
    for field, kind in (("paired_rows", "landcover"), ("parameter_rows", "parameter")):
        groups = defaultdict(list)
        for index, row in enumerate(content[field]):
            pointer = "/" + field + "/" + str(index)
            support = row.get("common_support_sha256")
            if not row.get("common_cells"):
                omissions.append({"source": {"path": "numeric/report.json", "json_pointer": pointer},
                                  "reason": "No common valid cells; original physical contrast remains undefined"})
                continue
            if not support:
                omissions.append({"source": {"path": "numeric/report.json", "json_pointer": pointer},
                                  "reason": "No retained exact common-support identity"})
                continue
            identifier(support)
            groups[(row["scenario_id"], row["pollutant"], row["total_units"], support)].append((index, row))
        for group_index, ((scenario, pollutant, units, support), rows) in enumerate(sorted(groups.items())):
            for page, start in enumerate(range(0, len(rows), drawing.PAGE_SIZE)):
                subset = rows[start:start + drawing.PAGE_SIZE]
                panels = []
                y_values = [row[key] for unused, row in subset for key in ("baseline_common", "alternative_common")]
                deltas = [row["delta_common"] for unused, row in subset]
                if any(drawing._number(value) is None for value in y_values + deltas):
                    raise ValueError("A retained native figure contrast lacks finite original quantities")
                x = drawing._axis("Original report pair key", "",
                    [start + .4, start + len(subset) + .6],
                    [{"value": start + j + 1, "label": _case_key(field, index)}
                     for j, (index, row) in enumerate(subset)])
                mass_series, delta_series = [], []
                fields = (("baseline_common", "Reference baseline" if kind == "parameter" else "Same-profile " + reference_word, "circle"),
                          ("alternative_common", "Varied-profile baseline" if kind == "parameter" else "Land-cover alternative", "square-open"))
                for name, label, marker in fields:
                    points = []
                    for j, (index, row) in enumerate(subset):
                        point = {"x": start + j + 1, "y": row[name], "case_key": _case_key(field, index),
                                 "source": {"path": "numeric/report.json",
                                            "json_pointer": "/" + field + "/" + str(index) + "/" + name},
                                 "original_field": name, **{key: deepcopy(row.get(key)) for key in (
                                     "member_id", "member_label", "profile_id", "reference_profile_id",
                                     "scenario_id", "scenario_label", "baseline_run_id", "alternative_run_id",
                                     "common_support_sha256", "common_cells", "total_units", "comparison_id",
                                     "baseline_valid_cells", "alternative_valid_cells",
                                     "baseline_only_cells", "alternative_only_cells")}}
                        points.append(point)
                        coordinates.append({"kind": kind, "figure_group": group_index + 1,
                                            "page": page + 1, "case": start + j + 1,
                                            "field": name, "value": row[name], **point})
                    mass_series.append({"geometry": "scatter", "label": label, "marker": marker, "points": points})
                points = []
                for j, (index, row) in enumerate(subset):
                    point = {"x": start + j + 1, "y": row["delta_common"], "case_key": _case_key(field, index),
                             "source": {"path": "numeric/report.json",
                                        "json_pointer": "/" + field + "/" + str(index) + "/delta_common"},
                             "original_field": "delta_common", **{key: deepcopy(row.get(key)) for key in (
                                 "member_id", "member_label", "profile_id", "reference_profile_id",
                                 "scenario_id", "scenario_label", "baseline_run_id", "alternative_run_id",
                                 "common_support_sha256", "common_cells", "total_units", "comparison_id",
                                     "baseline_valid_cells", "alternative_valid_cells",
                                     "baseline_only_cells", "alternative_only_cells")}}
                    points.append(point)
                    coordinates.append({"kind": kind, "figure_group": group_index + 1,
                                        "page": page + 1, "case": start + j + 1,
                                        "field": "delta_common", "value": row["delta_common"], **point})
                delta_series.append({"geometry": "scatter", "label": "Varied minus reference" if kind == "parameter"
                                     else "Alternative minus " + reference_word, "marker": "circle", "points": points})
                panels.append({"title": "Annual mass on the identical common-valid cells", "x": x,
                               "y": drawing._axis("Annual export mass", units, drawing._domain(y_values, zero=True)),
                               "series": mass_series})
                panels.append({"title": "Original paired annual change", "x": deepcopy(x),
                               "y": drawing._axis("Annual change", units, drawing._domain(deltas, zero=True)),
                               "series": delta_series,
                               "reference_lines": [{"axis": "y", "value": 0, "label": "No change"}]})
                key = kind + "-" + digest([scenario, pollutant, units, support])[:16] + "-" + str(page + 1)
                figure = {"id": key, "title": POLLUTANT_LABELS[pollutant] + " — " +
                          ("baseline parameter sensitivity" if kind == "parameter" else subset[0][1]["scenario_label"]),
                    "caption": (
                        str(len(subset)) + " original report pairs on " + str(subset[0][1]["common_cells"])
                        + " common-valid cells; exact support SHA256 " + support + ". "
                        "The visible pair keys identify the original case rows in the accompanying "
                        "case and coverage tables. Annual mass and change are copied from the "
                        "original common-support report; negative change means lower export. "
                        + ("Land cover is held fixed; the first selected profile is the reference. "
                           if kind == "parameter" else
                           "Each land-cover alternative uses its own same-profile " + reference_word + ". ")
                        + "Other support masks remain separate. Selected cases describe a sensitivity "
                        "set, not a probability distribution or confidence interval."),
                    "panels": panels, "source_record_count": len(subset),
                    "omitted_records": [], "common_support_sha256": support,
                    "detail_tables": _case_tables(field, subset, reference_label=reference_word.capitalize()),
                    "case_legend": [
                        "Exact support SHA256: " + support,
                        "Common valid cells: " + str(subset[0][1]["common_cells"])
                        + ". Negative change means lower annual export.",
                    ] + [
                        _case_key(field, index) + ": " + row["member_label"]
                        + "; profile " + row["profile_id"][:12]
                        + (("; reference " + str(row.get("reference_member_label") or "Reference")
                            + " / " + str(row.get("reference_profile_id") or "Unspecified")[:12])
                           if kind == "parameter" else "")
                        + "; " + reference_word + " valid/only " + str(row["baseline_valid_cells"]) + "/"
                        + str(row["baseline_only_cells"]) + "; alternative valid/only "
                        + str(row["alternative_valid_cells"]) + "/" + str(row["alternative_only_cells"])
                        for index, row in subset
                    ] + ["Profile IDs are abbreviated here; complete case identities and original "
                         "quantities remain in the report tables, numeric/report.json and coordinate CSV."]}
                drawing._validate_figure(figure)
                figures.append(figure)
    spec = {"schema": "upstate.scientific-figure-spec/v1", "version": VERSION,
            "ensemble_id": content["ensemble_id"], "figures": figures,
            "coverage": {"landcover_pairs": len(content["paired_rows"]),
                         "parameter_pairs": len(content["parameter_rows"]),
                         "omitted_records": omissions},
            "methods": ["Every plotted physical value is copied from numeric/report.json.",
                        "Cases, pollutants, units and exact common-support masks remain distinct.",
                        "LC/PS keys preserve the original row index across support groups and pages.",
                        "Ordinal case positions and axis bounds are presentation metadata."]}
    atomic_json(directory / SPEC, spec, immutable=True)
    choices = []
    for figure in figures:
        path = "figures/" + figure["id"] + ".svg"
        atomic_bytes(directory / path, _study_svg(figure).encode("utf-8"), immutable=True)
        choices.append({"id": figure["id"], "path": path})
    shared._csv(directory, COORDINATES, coordinates,
        ["kind", "figure_group", "page", "case", "case_key", "field", "value", "x", "y", "member_id", "member_label",
         "profile_id", "reference_profile_id", "scenario_id", "scenario_label",
         "baseline_run_id", "alternative_run_id", "comparison_id", "common_support_sha256", "common_cells",
         "baseline_valid_cells", "alternative_valid_cells", "baseline_only_cells", "alternative_only_cells",
         "total_units", "source"])
    return {"figure_spec": SPEC, "figures": choices, "coverage": spec["coverage"]}


def _sections(plan, content, profiles, scenarios, scope=None):
    report = content["report"]
    if report.get("scenario_reference"):
        from .ensemble_scenario_contrasts import sections
        return sections(plan, content, profiles, scenarios, scope)
    progress = report.get("progress", {})
    model_scope = report.get("model_scope", {})
    sections = [
        ["Saved native scenario and parameter study", [
            plan["reason"],
            "This edition freezes one saved native design and its original physical report. "
            "All numerical contrasts, coverage and case ranges come from the maintained ensemble producer.",
            _table(["Study state", "Native runs complete", "Selected parameter cases", "Report state"],
                   [[report["state"], str(progress.get("complete", 0)) + " / " + str(progress.get("total", 0)),
                     len(plan["members"]), report.get("report_state")]]),
            _table(["Selected physical output", "Original model scope"],
                   [[name, _plain(model_scope)] for name in model_scope.get("expected_artifacts", [])]),
            "Partial editions preserve completed comparisons and original errors. A later completed "
            "design creates another scientific source edition; it does not rewrite this saved one.",
        ]],
        ["Pairing, units and geographic support", [
            "Land-cover change is alternative minus baseline using the same profile and cells valid "
            "in both runs. Negative change means reduced modeled annual export. Parameter sensitivity "
            "holds the original land cover fixed and compares each varied profile with the first "
            "selected reference profile. Each full-valid total uses that run\'s own finite cells "
            "inside the reporting mask. These totals appear separately below; subtracting them "
            "cannot replace a paired common-support contrast.",
            "Nitrogen and phosphorus retain kg/year; sediment retains metric tonnes/year, displayed "
            "as t/year by the original paired report. No cross-constituent conversion or weighting is introduced.",
            "Percentage change uses the common-valid baseline; a zero baseline leaves percentage "
            "undefined. Matching cell counts alone do not establish matching geography. Every range "
            "and figure keeps the original exact common-support SHA256 and its cell count.",
        ]],
    ]
    scope_sections = source_scope.sections(scope) if scope is not None else []
    sections[1:1] = scope_sections[:1]
    for field, heading in (("paired_rows", "Land-cover contrasts on common valid cells"),
                           ("parameter_rows", "Parameter sensitivity with land cover held fixed")):
        rows = list(enumerate(content[field]))
        sections.append([heading, [
            "Pair keys identify unchanged rows of this original report edition: LC for land-cover "
            "pairs and PS for baseline parameter contrasts. The same key appears in the plots, "
            "case tables and exact coordinate CSV.",
            _table(["Pair", "Parameter case", "Scenario", "Constituent / unit"],
                   [[_case_key(field, index), row["member_label"], row["scenario_label"],
                     POLLUTANT_LABELS[row["pollutant"]] + " / " + row["total_units"]]
                    for index, row in rows]),
            _table(["Pair", "Unit", "Baseline on common cells", "Alternative on common cells",
                    "Signed change", "Change %"],
                   [[_case_key(field, index), row["total_units"], row["baseline_common"],
                     row["alternative_common"], row["delta_common"], _percentage(row)]
                    for index, row in rows]),
            "The signed change and percentage above are the original alternative-minus-baseline "
            "quantities on common-valid cells. A zero common baseline leaves percentage undefined "
            "even when a mass change exists. A legacy pair with no common cells has no defined "
            "paired mass or percentage result.",
        ]])
        coverage = _case_tables(field, rows)
        coverage[0]["caption"] = "Original case and reference identities"
        sections.append([heading + " — coverage and full-valid totals", [
            *coverage,
            _table(["Pair", "Unit", "Baseline own-valid total", "Alternative own-valid total",
                    "Pair masks identical"],
                   [[_case_key(field, index), row["total_units"], row["baseline_total"],
                     row["alternative_total"], _mask_agreement(row)] for index, row in rows]),
            "Full-valid totals each use their own run's finite, non-NoData cells inside the "
            "retained reporting mask. Baseline-only and alternative-only cells are excluded from "
            "the paired contrast. Those counts do not include cells invalid in both runs or cells "
            "outside the reporting mask. Identical pair masks do not establish complete catchment "
            "or reporting-area coverage.",
            _table(["Pair", "Exact common-support SHA256", "Grouped figure"],
                   [[_case_key(field, index), row.get("common_support_sha256") or "Not retained",
                     ("Omitted: no common valid cells" if not row["common_cells"] else
                      "Omitted: exact support identity not retained" if not row.get("common_support_sha256")
                      else "Included; use this pair key")] for index, row in rows]),
            "Every original row, full native run/comparison/profile identity and physical value "
            "remains in numeric/report.json and the original numeric CSV companions.",
        ]])
    sections.append(["Explored parameter ranges on matching support", [
        "The following minimum and maximum summarize only completed selected cases sharing the exact "
        "same scenario, pollutant, physical unit and common-valid mask. These are descriptive explored "
        "ranges. Incomplete cases and other masks are not pooled into a confidence interval.",
        _table(["Scenario", "Constituent / unit", "Completed cases", "Min change", "Max change",
                "Direction", "Support SHA256"],
               [[row["scenario_label"], POLLUTANT_LABELS[row["pollutant"]] + " / " + row["total_units"],
                 row["members"], row["minimum_delta"], row["maximum_delta"], row["direction"],
                 row["common_support_sha256"]] for row in content["support_groups"]]),
        _table(["Scenario / constituent", "Common cells", "Exact support SHA256", "Pair masks identical"],
               [[row["scenario_label"] + " / " + POLLUTANT_LABELS[row["pollutant"]],
                 row["common_cells"], row["common_support_sha256"],
                 "Yes" if row["coverage_complete"] else "No"] for row in content["support_groups"]]),
        "Pair masks identical means the original baseline-only and alternative-only counts are "
        "both zero for every completed pair in that group. It does not describe cells missing "
        "in both runs or establish whole-catchment coverage. Undefined percentages are omitted "
        "from the producer's percentage ranges while their defined mass changes remain included.",
    ]])
    profile_rows, parameter_rows, reference_rows, run_rows = [], [], [], []
    for member in plan["members"]:
        profile = profiles[member["profile_id"]]
        profile_rows.append([member["label"], member["profile_id"], member["parent_profile_id"],
                             profile.get("scientific_status", "working"),
                             profile.get("table_summary", {}).get("sha256")])
        for model in ("ndr", "sdr"):
            for name, value in member["parameters"].get(model, {}).items():
                parameter_rows.append([member["label"], model.upper(), name, value])
        references = profile.get("references", [])
        reference_rows.append([member["label"], references, member.get("assignments", [])])
        for selection in member["runs"]:
            run_rows.append([member["label"], selection["label"], selection["role"],
                             selection["run_id"], selection["scenario_id"]])
    sections.extend([
        ["Selected coefficient profiles and assumptions", [
            "The original profile references and scientific status remain explicit. Teaching or "
            "simulated inputs retain their original source labels and assumptions in these records. "
            "A parameter case is not independently calibrated merely because its model run completed.",
            _table(["Case", "Profile", "Parent profile", "Scientific status", "Original table SHA256"], profile_rows),
            _table(["Case", "Native model", "Parameter", "Original value"], parameter_rows),
            _table(["Case", "Original scientific references", "Selected parameter assignments"], reference_rows),
        ]],
        ["Original scenario definitions", [
            _table(["Scenario", "Kind", "Reason", "Original mapped changes"],
                   [[value["title"], value["kind"], value["reason"], value.get("patches", [])]
                    for value in scenarios.values()]),
            _table(["Case", "Scenario", "Role", "Native run", "Scenario identity"], run_rows),
        ]],
        ["Native completion and original messages", [
            _table(["Message kind", "Original record"],
                   [[name, item] for name in ("run_errors", "errors") for item in report.get(name, [])] +
                   ([["execution_error", report["execution_error"]]] if report.get("execution_error") else [])),
            "The complete original native states, selected model scope and artifact hashes are in "
            "original/native-runs.json and numeric/report.json. Continue the same saved native design "
            "to complete pending cases.",
        ]],
        ["Source records and independent reopening", [
            "This report package carries the original scalar report, all complete numeric tables, "
            "exact figure coordinates/specifications, saved design, selected profile/scenario/grid/"
            "run/comparison records and original coefficient-table bodies with companions. "
            "The native input inventory preserves exact original and aligned raster descriptors. "
            "Use the application's complete Workspace backup to transfer and resume the original "
            "model inputs, spatial masks, logs and physical raster outputs.",
            {"kind": "links", "items": [
                {"title": "Original full paired report", "path": "numeric/report.html"},
                {"title": "All land-cover pairs and coverage", "path": "numeric/pairs.csv"},
                {"title": "All baseline parameter contrasts", "path": "numeric/sensitivity.csv"},
                {"title": "Matching-support ranges", "path": "numeric/robustness.csv"},
                {"title": "Complete original report JSON", "path": "numeric/report.json"},
                {"title": "Exact figure coordinates", "path": COORDINATES},
                {"title": "Native inputs and artifact identities", "path": "native-input-inventory.json"},
                {"title": "Original scientific source editions", "path": "original-source-editions.json"},
            ]},
        ]],
    ])
    sections.extend(scope_sections[1:])
    return sections


def _manifest(directory, title, selection, sections, graphics):
    members = [describe_file(directory, path) for path in sorted(directory.rglob("*"))
               if path.is_file() and path not in {directory / "scientific-report.json", directory / "sources.json"}]
    recipe = {"schema": shared.RECIPE_SCHEMA, "title": title,
              "edition": "native-study-" + selection["report_id"], "basis": selection,
              "sections": sections, "figure_spec": graphics["figure_spec"],
              "figures": graphics["figures"], "figure_coverage": graphics["coverage"],
              "inputs": members, "source_links": [item["path"] for item in members]}
    atomic_json(directory / "scientific-report.json", recipe, immutable=True)
    manifest = {"schema": "upstate.sources/v1", "title": title, "entries": [{
        "id": SOURCE_ID, "kind": "document", "role": shared.ROLE, "title": title,
        "path": "scientific-report.json", "sha256": file_digest(directory / "scientific-report.json"),
        "uri": "urn:upstate:native-ensemble:" + selection["ensemble_id"] + ":" + selection["report_id"],
        "vintage": "Retained native design report " + selection["report_id"],
        "units": "Original kg/year and t/year, separated by physical constituent",
        "metadata": {"report_schema": shared.RECIPE_SCHEMA, "ensemble_id": selection["ensemble_id"],
                     "report_id": selection["report_id"], "source_basis": "saved_native_ensemble",
                     "workspace_id": selection["workspace_id"], "source_operation_id": digest(selection)},
        "companions": [{"path": item["path"], "sha256": item["sha256"]} for item in members],
    }]}
    atomic_json(directory / "sources.json", manifest, immutable=True)


def latest(workspace, ensemble_id, *, verify=False, scenario_contrast=False, source_operation_id=None):
    """Return the last prepared edition and its relationship to current native results."""
    key = identifier(ensemble_id)
    pointer_name = "latest-scenario-contrasts.json" if scenario_contrast else "latest-scientific-study.json"
    pointer = workspace.root / "ensemble_results" / key / pointer_name
    if source_operation_id is not None:
        record = {"ensemble_id": key, "source_operation_id": identifier(source_operation_id)}
    else:
        if not pointer.exists():
            return None
        record = read_json(pointer)
    if record.get("ensemble_id") != key:
        raise ValueError("Scientific study pointer belongs to another design")
    operation = read_json(workspace.root / DIRECTORY / identifier(record["source_operation_id"]) / "operation.json")
    if (operation.get("ensemble_id") != key or operation.get("workspace_id") != workspace.project["id"]
            or digest(operation["selection"]) != operation["id"]):
        raise ValueError("Scientific study source belongs to another saved Workspace design")
    current = Ensembles(workspace).report_data(key, refresh=False)
    source_current = (operation["selection"]["summary_signature"] == ensemble_report.summary_signature(current)
                      and current.get("report_state") in {"current", "partial"}
                      and operation["selection"]["producer_sha256"] == file_digest(Path(__file__))
                      and operation["selection"]["figure_helper_sha256"] == file_digest(Path(drawing.__file__))
                      and operation["selection"].get("source_scope_helper_sha256") == file_digest(Path(source_scope.__file__)))
    if operation["selection"].get("scenario_reference"):
        from . import ensemble_scenario_contrasts
        source_current = (
            ensemble_scenario_contrasts.current_signature(
                workspace, key, operation["selection"]["scenario_reference"])
            == operation["selection"]["summary_signature"]
            and operation["selection"].get("scenario_contrast_helper_sha256")
                == file_digest(Path(ensemble_scenario_contrasts.__file__))
            and operation["selection"]["producer_sha256"] == file_digest(Path(__file__))
            and operation["selection"]["figure_helper_sha256"] == file_digest(Path(drawing.__file__))
            and operation["selection"].get("source_scope_helper_sha256") == file_digest(Path(source_scope.__file__)))
    if verify:
        for item in operation.get("files", {}).values():
            verify_file(workspace.root, item)
        if operation.get("source"):
            workspace.source_file(operation["source"]["source_collection_id"], operation["source"]["source_id"])
    return {**operation, "source_state": "current" if source_current else "stale"}


def _remember_contrast(workspace, operation):
    if not operation["selection"].get("scenario_reference"):
        return
    directory = workspace.root / "ensemble_results" / operation["ensemble_id"]
    path = directory / "scenario-contrast-sources.json"
    with held(directory / ".contrast-history.lock", blocking=False):
        record = read_json(path) if path.exists() else {
            "ensemble_id": operation["ensemble_id"], "source_operation_ids": []}
        if record.get("ensemble_id") != operation["ensemble_id"]:
            raise ValueError("The scenario source history belongs to another ensemble")
        keys = record["source_operation_ids"]
        if operation["id"] not in keys:
            keys.append(operation["id"])
        atomic_json(path, record)


def prepare(workspace, ensemble_id, *, render=True, scenario_reference=None):
    """Freeze the original report, register its typed source and render ordinary exports."""
    if not isinstance(render, bool):
        raise ValueError("Render must be true or false")
    selection, plan, release, content, runs = _snapshot(workspace, ensemble_id, scenario_reference)
    pointer_name = "latest-scenario-contrasts.json" if scenario_reference is not None else "latest-scientific-study.json"
    key = digest(selection)
    directory = workspace.root / DIRECTORY / key
    directory.mkdir(parents=True, exist_ok=True)
    with held(directory / ".prepare.lock", blocking=False):
        operation_path = directory / "operation.json"
        operation = read_json(operation_path) if operation_path.exists() else {
            "schema": "upstate.ensemble-study-source/v1", "id": key, "selection": selection,
            "workspace_id": workspace.project["id"], "ensemble_id": plan["id"],
            "state": "preparing", "created_at": now(), "files": {}}
        if operation.get("selection") != selection:
            raise ValueError("Prepared scientific study has another original report identity")
        try:
            source_directory = directory / "source"
            source_directory.mkdir(parents=True, exist_ok=True)
            if not operation.get("source"):
                manifest = source_directory / "sources.json"
                if not manifest.exists():
                    source_records, profiles, scenarios, scope = _package(workspace, source_directory, plan, release, content, runs)
                    graphics = _figures(source_directory, content)
                    title = ("Scenario contrasts: " + content["report"]["title"]
                             if scenario_reference is not None else "Native study: " + plan["title"])
                    _manifest(source_directory, title, selection, _sections(plan, content, profiles, scenarios, scope), graphics)
                recipe = read_json(source_directory / "scientific-report.json")
                if recipe["basis"] != selection:
                    raise ValueError("Prepared report source has another native study basis")
                for item in recipe["inputs"]:
                    verify_file(source_directory, item)
                source_records = read_json(source_directory / "original-source-editions.json")
                collection = workspace.import_sources(manifest)
                operation.update(title=recipe["title"], source={"source_collection_id": collection["id"], "source_id": SOURCE_ID},
                                 source_records=source_records, state="source_ready",
                                 figure_count=len(recipe["figures"]),
                                 landcover_pairs=len(content["paired_rows"]), parameter_pairs=len(content["parameter_rows"]),
                                 native_state=content["report"]["state"], progress=content["report"].get("progress", {}))
                for name, path in (("source_manifest", "sources.json"), ("source_recipe", "scientific-report.json"),
                                   ("figure_specification", SPEC), ("figure_coordinates", COORDINATES),
                                   ("native_input_inventory", "native-input-inventory.json"),
                                   ("source_scope", source_scope.SCOPE_FILE)):
                    operation["files"][name] = describe_file(workspace.root, source_directory / path)
                atomic_json(operation_path, operation)
            else:
                workspace.source_file(operation["source"]["source_collection_id"], SOURCE_ID)
            if render:
                rendered = shared._render(workspace, directory, operation, operation["source_records"])
                operation["report"] = rendered
                operation["files"].update(rendered["files"])
                operation["state"] = "complete"
            operation["delivery_selection"] = shared.delivery_selection(operation["source"])
            operation.pop("error", None)
            operation["updated_at"] = now()
            atomic_json(operation_path, operation)
            _remember_contrast(workspace, operation)
            atomic_json(workspace.root / "ensemble_results" / plan["id"] / pointer_name,
                        {"ensemble_id": plan["id"], "source_operation_id": key})
            return latest(workspace, plan["id"], scenario_contrast=scenario_reference is not None,
                          source_operation_id=key)
        except BaseException as error:
            operation.update(state="source_ready" if operation.get("source") else "failed",
                             error={"type": type(error).__name__, "message": str(error)}, updated_at=now())
            atomic_json(operation_path, operation)
            if operation.get("source"):
                _remember_contrast(workspace, operation)
                atomic_json(workspace.root / "ensemble_results" / plan["id"] / pointer_name,
                            {"ensemble_id": plan["id"], "source_operation_id": key})
            raise
