"""Regional decision context composed from retained receiving-water results.

The original receiving-water implementation owns geometry, raster quantities
and family unions. This module preserves those results and joins the declared
HUC relationships to retained source context for review and portable delivery.
"""
from __future__ import annotations

from collections import defaultdict
import csv
import gzip
import html
import io
import json
import math
import os
from pathlib import Path
import re
import shutil
import tempfile
import zipfile

from .common import (
    atomic_bytes, atomic_json, canonical, describe_file, digest, file_digest,
    held, identifier, now, read_json, relative_file, verify_file,
)

SCHEMA = "upstate.decision-context/v1"
METHOD = "upstate.regional-decision-context/1"
FOLDER = "decision-contexts"
TOTAL_UNITS = {
    "nitrogen_export": "kg/year",
    "phosphorus_export": "kg/year",
    "sediment_export": "metric_tonnes/year",
}
SOURCE_SCHEMAS = {
    "water_context": "upstate.water-context/v1",
    "crosswalk": "upstate.classified-water-crosswalk/v1",
}
SOURCE_ROLES = {
    "water_context": "NRCS state/HUC programme context",
    "crosswalk": "Classified-water geographic and original feature associations",
}
RFP = "https://www.upstateforever.org/files/files/20261002_FINAL_EC-SDC%20Mapping%20RFP%20APPENDIX%20COMBINED.pdf"


def _copy(value):
    return json.loads(canonical(value))


def _huc(value):
    if not isinstance(value, str) or not re.fullmatch(r"\d{12}", value) or value == "000000000000":
        raise ValueError("Keep the source HUC12 as its original 12-digit text.")
    return value


def _number(value):
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (float, int)) or not math.isfinite(value):
        raise ValueError("Retained physical quantities must be finite numbers or explicit nulls.")
    return value


def _record_hash(value):
    return digest({key: item for key, item in value.items()
                   if key not in {"record_sha256", "reused", "_downloads"}})


def _read_source_json(path):
    with Path(path).open("rb") as source:
        signature = source.read(2)
    opener = gzip.open if signature == b"\x1f\x8b" else open
    with opener(path, "rt", encoding="utf-8-sig") as source:
        return json.load(source)


def _source(workspace, selection, kind):
    if not isinstance(selection, dict):
        raise ValueError("Choose the retained " + kind.replace("_", " ") + " source.")
    collection = identifier(selection.get("source_collection_id"))
    source_id = selection.get("source_id")
    if not isinstance(source_id, str) or not source_id:
        raise ValueError("Choose the original context source ID.")
    path, entry = workspace.source_file(collection, source_id)
    value = _read_source_json(path)
    if not isinstance(value, dict) or value.get("schema") != SOURCE_SCHEMAS[kind]:
        raise ValueError("Select a source with schema " + SOURCE_SCHEMAS[kind] + ".")
    reference = {
        "role": SOURCE_ROLES[kind], "source_collection_id": collection,
        "source_id": source_id, "title": entry["title"], "uri": entry["uri"],
        "vintage": entry["vintage"], "source_role": entry.get("role"),
        "body": _copy(entry["body"]), "companions": _copy(entry.get("companions", [])),
    }
    return value, reference, path


def _water_index(value):
    if value is None:
        return {}, set()
    if value.get("schema") != SOURCE_SCHEMAS["water_context"]:
        raise ValueError("Use the retained water-context source schema.")
    domain = [_huc(item) for item in value.get("model_domain_huc12s", [])]
    if len(domain) != len(set(domain)):
        raise ValueError("The retained source-context domain contains duplicate HUCs.")
    indexed = {}
    for row in value.get("hucs", []):
        key = _huc(row.get("huc12"))
        if key in indexed:
            raise ValueError("A source-context HUC appears more than once: " + key)
        if key not in domain:
            raise ValueError("A source-context row is outside its declared retained domain.")
        states = set()
        for state in row.get("nrcs_state_rows", []):
            if _huc(state.get("huc12_code")) != key:
                raise ValueError("An NRCS state row belongs to another HUC.")
            state_id = state.get("st_usps")
            if not isinstance(state_id, str) or not re.fullmatch(r"[A-Z]{2}", state_id) or state_id in states:
                raise ValueError("Keep each original NRCS state/HUC row exactly once.")
            states.add(state_id)
        indexed[key] = row
    return indexed, set(domain)


def _crosswalk_index(value, statuses):
    by_huc, by_feature, cover = defaultdict(list), defaultdict(list), defaultdict(list)
    if value is None:
        return by_huc, by_feature, cover
    if value.get("schema") != SOURCE_SCHEMAS["crosswalk"]:
        raise ValueError("Use the retained classified-water-crosswalk source schema.")
    seen = set()
    for row in value.get("rows", []):
        if row.get("status") not in statuses:
            continue
        feature = row.get("feature_id")
        if not isinstance(feature, str) or not feature:
            raise ValueError("A classified-water association needs its original feature ID.")
        key = (feature, row.get("region_id"), row.get("status"))
        if key in seen:
            raise ValueError("The crosswalk repeats an original feature/region/status association.")
        seen.add(key)
        by_feature[feature].append(row)
        if row.get("region_kind") == "huc12":
            by_huc[_huc(row.get("huc12"))].append(row)
    for row in value.get("coverage_summary", []):
        if row.get("status") in statuses:
            cover[row["region_id"]].append(row)
    return by_huc, by_feature, cover


def _network_hucs(subject, receptors):
    if subject.get("kind") == "family_union":
        selected = [receptors[key] for key in subject.get("receptor_ids", []) if key in receptors]
    else:
        selected = [receptors.get(subject["id"], subject)]
    upstream, seeds = set(), set()
    for receptor in selected:
        relation = receptor.get("relation", {})
        if relation.get("method") != "upstream_huc":
            continue
        upstream.update(_huc(key) for key in relation.get("upstream_huc_ids", []))
        seeds.update(_huc(key) for key in relation.get("seed_huc_ids", []))
    return sorted(upstream | seeds), seeds


def _check_units(stats, pollutant):
    if stats and stats.get("sum_units") != TOTAL_UNITS[pollutant]:
        raise ValueError("Use the original receiving-water annual mass units for " + pollutant + ".")


def physical_rows(subject, analysis):
    """Preserve original and common-support sums; compute only report arithmetic."""
    if analysis is None:
        return []
    metrics = subject.get("metrics", {})
    result = []
    for pollutant in analysis.get("pollutants", TOTAL_UNITS):
        if pollutant not in TOTAL_UNITS:
            raise ValueError("Select a supported original physical export quantity.")
        baseline = metrics.get("baseline_physical", {}).get(pollutant, {})
        _check_units(baseline, pollutant)
        for run_id in analysis.get("alternative_run_ids", []) or [None]:
            alternative = metrics.get("alternatives", {}).get(run_id, {})
            own = alternative.get("physical", {}).get(pollutant, {})
            change = alternative.get("changes", {}).get(pollutant, {})
            _check_units(own, pollutant)
            _check_units(change, pollutant)
            if change and change.get("direction") != "alternative minus baseline":
                raise ValueError("Retain the original alternative-minus-baseline change direction.")
            paired_count = change.get("valid_cells", 0)
            paired_baseline = _number(change.get("baseline_sum_on_common_cells"))
            paired_alternative = _number(change.get("alternative_sum_on_common_cells"))
            delta = _number(change.get("sum"))
            if paired_count and any(value is None for value in (paired_baseline, paired_alternative, delta)):
                raise ValueError("The paired receiving-water summary is incomplete.")
            if not paired_count and any(value is not None for value in (paired_baseline, paired_alternative, delta)):
                raise ValueError("A change without paired cells must retain null physical sums.")
            reduction = -delta if delta is not None else None
            percent, percent_basis = None, "No paired physical quantities"
            if paired_count and paired_baseline is not None:
                percent_basis = "Baseline on common valid cells is zero or negative"
                if paired_baseline > 0:
                    candidate = 100.0 * (reduction / paired_baseline)
                    if math.isfinite(candidate):
                        percent = candidate
                        percent_basis = "Net reduction / baseline sum on common valid cells"
                    else:
                        percent_basis = "Ratio exceeds finite numeric range"
            result.append({
                "subject_id": subject["id"], "subject_title": subject["title"],
                "subject_kind": subject.get("kind", "receptor"), "family": subject["family"],
                "relationship_precision": subject.get("relationship_precision"),
                "analysis_id": analysis["id"], "baseline_run_id": analysis["baseline_run_id"],
                "alternative_run_id": run_id, "quantity_scope": analysis["quantity_scope"],
                "pollutant": pollutant, "units": TOTAL_UNITS[pollutant],
                "selected_cells": metrics.get("selected_cells"),
                "baseline_original_sum": _number(baseline.get("sum")),
                "baseline_valid_cells": baseline.get("valid_cells", 0),
                "baseline_coverage_fraction": baseline.get("coverage_fraction"),
                "alternative_original_sum": _number(own.get("sum")),
                "alternative_valid_cells": own.get("valid_cells", 0),
                "alternative_coverage_fraction": own.get("coverage_fraction"),
                "baseline_paired_sum": paired_baseline,
                "alternative_paired_sum": paired_alternative,
                "paired_valid_cells": paired_count,
                "paired_coverage_fraction": change.get("coverage_fraction"),
                "signed_change": delta, "net_reduction": reduction,
                "reduction_percent": percent, "reduction_percent_basis": percent_basis,
                "sum_increased_export": _number(change.get("sum_increased_export")),
                "sum_avoided_export": _number(change.get("sum_avoided_export")),
                "direction": change.get("direction"),
                "sum_basis": change.get("sum_basis"),
                "status": ("baseline" if run_id is None else "paired_full_support"
                           if paired_count and paired_count == metrics.get("selected_cells")
                           else "paired_partial_support" if paired_count else "no_common_valid_cells"),
            })
    return result


def compose(plan, analysis=None, *, water_context=None, crosswalk=None, statuses=("current",)):
    if plan.get("schema") != "upstate.receiving-water-plan/v1" or plan.get("state") != "complete":
        raise ValueError("Select a complete original receiving-water plan.")
    if analysis is not None and (
            analysis.get("schema") != "upstate.receiving-water-analysis/v1"
            or analysis.get("state") != "complete" or analysis.get("plan_id") != plan["id"]):
        raise ValueError("Select the complete original analysis for this receiving-water plan.")
    if not isinstance(statuses, (list, tuple)) or not statuses or set(statuses) - {"current", "proposed"}:
        raise ValueError("Choose current or proposed source editions, or retain both separately.")
    statuses = sorted(set(statuses))
    water, domain = _water_index(water_context)
    by_huc, by_feature, coverage = _crosswalk_index(crosswalk, statuses)
    declared_crosswalk_hucs = {
        row["region_id"] for row in (crosswalk or {}).get("coverage_summary", [])
        if re.fullmatch(r"\d{12}", row.get("region_id", ""))
    }
    receptors = {row["id"]: row for row in plan.get("receptors", [])}
    selected = analysis.get("subjects", []) if analysis else [
        {**row, "kind": "receptor"} for row in plan.get("receptors", [])]
    result = {
        "plan_id": plan["id"], "analysis_id": analysis["id"] if analysis else None,
        "baseline_run_id": analysis["baseline_run_id"] if analysis else None,
        "alternative_run_ids": analysis.get("alternative_run_ids", []) if analysis else [],
        "quantity_scope": analysis.get("quantity_scope") if analysis else None,
        "classified_statuses": statuses, "subjects": [], "physical_rows": [],
        "huc_context_rows": [], "nrcs_rows": [], "classified_rows": [], "coverage_rows": [],
        "regional_coverage_rows": [
            _copy(row) for region, items in coverage.items()
            if not re.fullmatch(r"\d{12}", region)
            for row in items
        ],
        "source_roles": {
            "physical": "Retained native receiving-water analysis" if analysis else None,
            "hydrologic_relationship": "Original receiving-water plan",
            "nrcs": "Categorical state/HUC programme context" if water_context else None,
            "classified": "Geographic membership and source feature associations" if crosswalk else None,
        },
        "measurement": _copy(analysis.get("measurement", {})) if analysis else {},
        "interpretation": {
            "physical": "Changes retain the original paired valid cells and stored signed Float32 difference sum.",
            "percentage": "Net reduction divided by the baseline sum on the same common valid cells; zero denominators remain null.",
            "overlap": "Family-union physical quantities are already deduplicated by the original geometry engine. Per-receptor quantities may overlap.",
            "nrcs": "Retain state rows, fiscal edition, source-water system and resource concern together.",
            "classified": "HUC intersection is geographic membership. Named legal reach candidates and explicit coextensive associations retain separate precision.",
            "coverage": "Source rows outside the selected context domain remain outside its coverage. A missing row differs from an explicit publisher status.",
            "areas": "State acreage is st_ac. Whole-HUC acreage huc12_ac repeats for every state row.",
            "classified_measures": "Each original region/class union retains its own measure; overlapping HUC and class views are not additive.",
        },
        "references": [{"role": "Buyer requirements", "title": "Upper Savannah mapping RFP", "uri": RFP}],
    }
    for subject in selected:
        hucs, seeds = _network_hucs(subject, receptors)
        summary = {key: _copy(subject[key]) for key in (
            "id", "kind", "title", "family", "relation", "relationship_precision",
            "interpretation", "source", "classification", "contribution_area_ha",
            "area_in_quantity_scope_ha", "area_fraction_in_quantity_scope", "receptor_ids"
        ) if key in subject}
        summary["huc12s"] = hucs
        result["subjects"].append(summary)
        result["physical_rows"].extend(physical_rows(subject, analysis))
        common = {"subject_id": subject["id"], "subject_title": subject["title"], "family": subject["family"]}
        for huc in hucs:
            nrcs = water.get(huc)
            membership = by_huc.get(huc, [])
            observed_crosswalk_huc = huc in coverage
            result["huc_context_rows"].append({
                **common, "huc12": huc, "huc_relation": "seed_huc" if huc in seeds else "upstream_huc",
                "nrcs_coverage": (nrcs.get("nrcs_coverage", "retained_source_row") if nrcs else
                                  "missing_context_row" if huc in domain else
                                  "outside_selected_context_domain" if water_context else "context_source_not_selected"),
                "classified_coverage": ("retained_crosswalk_region" if observed_crosswalk_huc else
                                        "selected_edition_status_absent" if huc in declared_crosswalk_hucs else
                                        "outside_selected_crosswalk_regions" if crosswalk else "crosswalk_not_selected"),
                "classified_feature_count": len({row["feature_id"] for row in membership if row.get("counted")})
                    if observed_crosswalk_huc else None,
                "classified_touch_count": len({row["feature_id"] for row in membership if row.get("touch_only")})
                    if observed_crosswalk_huc else None,
            })
            if nrcs:
                for row in nrcs.get("nrcs_state_rows", []):
                    result["nrcs_rows"].append({**_copy(row), **common, "huc12": huc,
                        "nrcs_edition": nrcs.get("nrcs_edition", water_context.get("nrcs_inventory", {}).get("edition")),
                        "source_role": "NRCS state/HUC programme context"})
            for row in membership:
                result["classified_rows"].append({**_copy(row), **common,
                    "association_role": "HUC spatial membership"})
            for row in coverage.get(huc, []):
                result["coverage_rows"].append({**_copy(row), **common, "huc12": huc})
        members = ([receptors[key] for key in subject.get("receptor_ids", []) if key in receptors]
                   if subject.get("kind") == "family_union"
                   else [receptors.get(subject["id"], {})])
        feature_members = defaultdict(list)
        for member in members:
            feature_ids = {
                item.get("properties", {}).get("feature_id")
                for item in member.get("original_features", [])
                if item.get("properties", {}).get("feature_id")
            }
            for feature_id in feature_ids:
                feature_members[feature_id].append({
                    "receptor_id": member["id"], "source": _copy(member.get("source", {})),
                })
        for feature_id, member_sources in sorted(feature_members.items()):
            # One association per native feature/region/edition within this subject.
            # The family union retains all members without repeating a shared reach.
            for row in by_feature.get(feature_id, []):
                result["classified_rows"].append({**_copy(row), **common,
                    "association_role": "Retained receptor feature identifier",
                    "member_receptor_ids": sorted({item["receptor_id"] for item in member_sources}),
                    "receptor_sources": sorted(member_sources, key=lambda item: item["receptor_id"])})
    result["counts"] = {key: len(result[key]) for key in (
        "subjects", "physical_rows", "huc_context_rows", "nrcs_rows",
        "classified_rows", "coverage_rows", "regional_coverage_rows")}
    return result


def _csv_bytes(values, required=()):
    names = list(dict.fromkeys(list(required) + sorted({key for row in values for key in row})))
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=names, lineterminator="\n")
    writer.writeheader()
    for row in values:
        writer.writerow({key: json.dumps(value, ensure_ascii=False, sort_keys=True)
                         if isinstance(value, (dict, list)) else value for key, value in row.items()})
    return output.getvalue().encode("utf-8-sig")


def _display(value):
    if value is None:
        return "—"
    if isinstance(value, float):
        return format(value, ".8g")
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, sort_keys=True)
    return str(value)


def report_html(record):
    escape = lambda value: html.escape(_display(value), quote=True)
    def table(headings, values):
        if not values:
            return '<p class="note">No rows in this selected source context.</p>'
        return "<div class='table'><table><thead><tr>" + "".join(
            "<th>" + escape(value) + "</th>" for value in headings
        ) + "</tr></thead><tbody>" + "".join(
            "<tr>" + "".join("<td>" + escape(value) + "</td>" for value in row) + "</tr>"
            for row in values
        ) + "</tbody></table></div>"
    physical = record["physical_rows"]
    sections = [
        "<h2>Original physical quantities</h2><p>Changes retain the same common valid cells. "
        "Positive net reduction means less export. Baseline-only rows retain their own valid-cell sums.</p>",
        table(["Receiving water", "Alternative", "Pollutant", "Unit",
               "Baseline (paired when comparing)", "Alternative, paired", "Net reduction",
               "Reduction %", "Paired cells", "Paired coverage"],
              [[row["subject_title"], row.get("alternative_title") or row["alternative_run_id"] or "Baseline",
                row["pollutant"], row["units"],
                row["baseline_paired_sum"] if row["alternative_run_id"] else row["baseline_original_sum"],
                row["alternative_paired_sum"], row["net_reduction"], row["reduction_percent"],
                row["paired_valid_cells"], row["paired_coverage_fraction"]]
               for row in physical]),
        "<h2>Receiving-water relationship</h2>",
        table(["Receiving water", "Family", "Relationship", "Retained HUC12 context", "Interpretation"],
              [[row["title"], row["family"], row.get("relationship_precision"),
                row["huc12s"], row.get("interpretation")] for row in record["subjects"]]),
        "<h2>NRCS state and HUC context</h2>",
        table(["Receiving water", "HUC12", "State", "Edition", "Priority",
               "System", "Concern", "State acres", "Whole HUC acres"],
              [[row["subject_title"], row["huc12"], row["st_usps"], row.get("nrcs_edition"),
                row.get("fy26_status"), row.get("system_type"), row.get("resource_concern"),
                row.get("st_ac"), row.get("huc12_ac")] for row in record["nrcs_rows"]]),
        "<h2>Context coverage</h2>",
        table(["Receiving water", "HUC12", "HUC relation", "NRCS coverage",
               "Classified-source coverage", "Positive-measure features", "Touch-only features"],
              [[row["subject_title"], row["huc12"], row["huc_relation"], row["nrcs_coverage"],
                row["classified_coverage"], row["classified_feature_count"], row["classified_touch_count"]]
               for row in record["huc_context_rows"]]),
        "<h2>Classified-water region measures</h2><p>Each row preserves its own original "
        "region and class union. HUCs, classes and source editions remain separate views.</p>",
        table(["Receiving water / region", "HUC / region", "Status", "Class scope",
               "Geometry", "Features", "Unique measure", "Unit"],
              [[row.get("subject_title", "Regional source context"), row["region_id"], row["status"],
                row["class_scope"], row["geometry_kind"], row["positive_feature_count"],
                row["unique_geometry_measure"], row["measure_unit"]]
               for row in record["coverage_rows"] + record["regional_coverage_rows"]]),
        "<h2>Classified reach associations</h2><p>" +
        escape(len(record["classified_rows"])) + " retained associations are included in "
        "classified-water-associations.csv. The table below shows the first 200 associations "
        "in report order.</p>",
        table(["Receiving water", "Member receptors", "Region", "Original feature", "Waterbody", "Class", "Status",
               "Association", "Coextensive legal records", "Partial legal records", "Candidate legal records"],
              [[row["subject_title"], row.get("member_receptor_ids"), row["region_id"], row["feature_id"], row.get("waterbody_name"),
                row.get("class_code"), row.get("status"), row.get("association_role"),
                row.get("coextensive_registry_ids"), row.get("partial_registry_ids"),
                row.get("candidate_registry_ids")] for row in record["classified_rows"][:200]]),
        "<h2>Reading the result</h2>" + "".join(
            "<p><strong>" + escape(key.replace("_", " ").capitalize()) + ".</strong> " +
            escape(value) + "</p>" for key, value in record["interpretation"].items()),
        "<h2>Selected source editions</h2>",
    ]
    for reference in record.get("references", []):
        uri = reference.get("uri") or reference.get("url")
        link = ("<a href='" + escape(uri) + "'>" + escape(uri) + "</a>"
                if isinstance(uri, str) and re.match(r"^https?://", uri, re.I) else escape(uri))
        sections.append("<p><strong>" + escape(reference.get("title") or reference.get("role")) +
                        "</strong><br>" + escape(reference.get("role")) + " · " +
                        escape(reference.get("vintage")) + "<br>" + link + "</p>")
    style = ("body{font:14px system-ui,sans-serif;color:#222;margin:36px;line-height:1.5}"
             "main{max-width:1450px;margin:auto}h1{font-size:27px}h2{font-size:19px;"
             "margin-top:32px;border-top:1px solid #aaa;padding-top:18px}.note,small{color:#555}"
             "table{border-collapse:collapse;width:100%;font-size:12px}"
             "th,td{border-bottom:1px solid #ccc;text-align:left;vertical-align:top;padding:8px}"
             "th{background:#eee}.table{overflow-x:auto}a{color:#222}"
             "@media print{body{margin:10mm;font-size:10pt}.table{overflow:visible}"
             "th,td{font-size:8pt;padding:5px}thead{display:table-header-group}tr{break-inside:avoid}}")
    return ("<!doctype html><html lang='en'><meta charset='utf-8'>"
            "<meta name='viewport' content='width=device-width,initial-scale=1'><title>" +
            escape(record["title"]) + "</title><style>" + style + "</style><main><h1>" +
            escape(record["title"]) + "</h1><p>" + escape(record["project"]["title"]) +
            "<br>Saved " + escape(record["created_at"]) + "<br>Quantity scope: " +
            escape(record["quantity_scope"] or "Source plan") + "</p>" +
            "".join(sections) + "</main></html>")


def _retain_input(workspace_root, source, target, expected=None):
    source, target = Path(source), Path(target)
    expected = expected or describe_file(workspace_root, source)
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists():
        try:
            os.link(source, target)
        except FileExistsError:
            pass
        except OSError:
            pending = None
            try:
                with tempfile.NamedTemporaryFile(dir=target.parent, prefix=".input-", delete=False) as output:
                    pending = Path(output.name)
                    with source.open("rb") as incoming:
                        shutil.copyfileobj(incoming, output, 1024 * 1024)
                    output.flush()
                    os.fsync(output.fileno())
                if pending.stat().st_size != expected["bytes"] or file_digest(pending) != expected["sha256"]:
                    raise ValueError("A retained decision-report input changed during its copy.")
                try:
                    os.link(pending, target)
                except FileExistsError:
                    pass
            finally:
                if pending is not None:
                    pending.unlink(missing_ok=True)
    if target.stat().st_size != expected["bytes"] or file_digest(target) != expected["sha256"]:
        raise ValueError("A retained decision-report input differs from its original.")
    return describe_file(workspace_root, target)


def _archive(target, members):
    pending = None
    try:
        with tempfile.NamedTemporaryFile(dir=target.parent, prefix=".archive-", delete=False) as output:
            pending = Path(output.name)
        with zipfile.ZipFile(pending, "w", compression=zipfile.ZIP_DEFLATED, allowZip64=True) as archive:
            for name, path in sorted(members):
                info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o100644 << 16
                with Path(path).open("rb") as source, archive.open(info, "w", force_zip64=True) as output:
                    shutil.copyfileobj(source, output, 1024 * 1024)
        with pending.open("rb") as source:
            os.fsync(source.fileno())
        if target.exists():
            if target.stat().st_size != pending.stat().st_size or file_digest(target) != file_digest(pending):
                raise ValueError("The immutable decision archive differs from its saved report.")
        else:
            os.link(pending, target)
    finally:
        if pending is not None:
            pending.unlink(missing_ok=True)


class DecisionContexts:
    def __init__(self, workspace):
        self.workspace = workspace

    def inspect(self, key, *, verify=True):
        key = identifier(key)
        result = read_json(self.workspace.root / FOLDER / key / "decision.json")
        if (result.get("schema") != SCHEMA or result.get("id") != key
                or digest(result.get("identity")) != key
                or result.get("record_sha256") != _record_hash(result)):
            raise ValueError("The saved regional decision report changed.")
        if result["identity"]["project_id"] != self.workspace.project["id"]:
            raise ValueError("This decision report belongs to another workspace.")
        if result.get("state") != "complete":
            raise ValueError("Complete the selected regional decision report.")
        if verify:
            for item in result.get("files", {}).values():
                verify_file(self.workspace.root, item)
        return result

    def list(self):
        return [self.inspect(path.parent.name, verify=False) for path in
                sorted((self.workspace.root / FOLDER).glob("*/decision.json"))]

    def build(self, selection):
        from . import receiving_waters

        selection = _copy(selection)
        title = selection.get("title")
        if not isinstance(title, str) or not title.strip() or len(title) > 160:
            raise ValueError("Supply a decision-report title of 1–160 characters.")
        selection["title"] = title.strip()
        selection["statuses"] = sorted(set(selection.get("statuses", ["current"])))
        analysis = receiving_waters.inspect(self.workspace, identifier(selection["analysis_id"]), verify=False) \
            if selection.get("analysis_id") else None
        plan_id = analysis["plan_id"] if analysis else selection.get("plan_id")
        if selection.get("plan_id") and selection["plan_id"] != plan_id:
            raise ValueError("The selected analysis and receiving-water plan differ.")
        selection["plan_id"] = identifier(plan_id)
        plan = receiving_waters.inspect_plan(self.workspace, selection["plan_id"], verify=False)
        sources = {kind: _source(self.workspace, selection[kind], kind)
                   for kind in SOURCE_SCHEMAS if selection.get(kind)}
        if not sources:
            raise ValueError("Select a retained NRCS context or classified-water crosswalk.")
        composed = compose(plan, analysis,
                           water_context=sources.get("water_context", (None,))[0],
                           crosswalk=sources.get("crosswalk", (None,))[0],
                           statuses=selection["statuses"])
        runs = {}
        if analysis:
            for run_id in [analysis["baseline_run_id"]] + analysis.get("alternative_run_ids", []):
                run = self.workspace.inspect_run(run_id)
                if run.get("state") != "complete":
                    raise ValueError("The original selected native run must be complete.")
                scenario = self.workspace._get("scenarios", run["selection"]["scenario_id"])
                runs[run_id] = {
                    "run_id": run_id, "selection": _copy(run["selection"]),
                    "scenario": _copy(scenario),
                    "profile": self.workspace._get("profiles", run["selection"]["profile_id"]),
                }
            for row in composed["physical_rows"]:
                if row["alternative_run_id"]:
                    row["alternative_title"] = runs[row["alternative_run_id"]]["scenario"].get("title") or row["alternative_run_id"]
        identity = {
            "method": METHOD, "implementation_sha256": file_digest(__file__),
            "project_id": self.workspace.project["id"], "selection": selection,
            "plan_record_sha256": plan["record_sha256"],
            "analysis_record_sha256": analysis["record_sha256"] if analysis else None,
            "sources": {kind: reference for kind, (_, reference, _) in sources.items()},
        }
        key = digest(identity)
        directory = self.workspace.root / FOLDER / key
        with held(directory / ".decision.lock", blocking=False):
            if (directory / "decision.json").exists():
                return {**self.inspect(key), "reused": True}
            prepared = directory / "prepared.json"
            if prepared.exists():
                preparation = read_json(prepared)
                if preparation.get("identity") != identity:
                    raise ValueError("A retained report preparation has another source selection.")
            else:
                preparation = {"identity": identity, "created_at": now()}
                atomic_json(prepared, preparation, immutable=True)
            record = {
                "schema": SCHEMA, "id": key, "state": "complete",
                "title": selection["title"], "created_at": preparation["created_at"],
                "identity": identity, "project": _copy(self.workspace.project),
                **composed, "native_runs": runs, "files": {},
            }
            record["references"].extend(reference for _, reference, _ in sources.values())
            report_root = directory / "report"
            report_root.mkdir(parents=True, exist_ok=True)
            files = {}
            def input_file(name, path, expected=None):
                files["input_" + name] = _retain_input(
                    self.workspace.root, path, report_root / "inputs" / name, expected)
            input_file("receiving-water-plan.json",
                       self.workspace.root / "receiving-water-plans" / plan["id"] / "plan.json")
            if analysis:
                input_file("receiving-water-analysis.json",
                           self.workspace.root / "receiving-water-analyses" / analysis["id"] / "analysis.json")
            for kind, (_, reference, _) in sources.items():
                # Preserve the native relative layout so provenance/document
                # references resolve after the portable report is extracted.
                for body in [reference["body"]] + reference["companions"]:
                    name = body.get("view_path", body["filename"])
                    member = Path(name)
                    if (member.is_absolute() or not member.parts or ".." in member.parts
                            or member.as_posix() != name or "\\" in name or "\0" in name):
                        raise ValueError("A context source member must retain a portable relative path.")
                    original = relative_file(self.workspace.root, body["object"])
                    target = report_root / "inputs" / kind / member
                    files["input_" + kind + "/" + name] = _retain_input(
                        self.workspace.root, original, target, body)
            for name, field, required in (
                ("physical-quantities.csv", "physical_rows", ("subject_id", "pollutant", "units")),
                ("huc-context.csv", "huc_context_rows", ("subject_id", "huc12")),
                ("nrcs-state-huc-context.csv", "nrcs_rows", ("subject_id", "huc12", "st_usps")),
                ("classified-water-associations.csv", "classified_rows", ("subject_id", "feature_id", "region_id")),
                ("classified-water-coverage.csv", "coverage_rows", ("subject_id", "region_id", "class_scope")),
                ("regional-classified-water-coverage.csv", "regional_coverage_rows", ("region_id", "class_scope")),
            ):
                path = report_root / name
                atomic_bytes(path, _csv_bytes(record[field], required), immutable=True)
                files[field] = describe_file(self.workspace.root, path)
            context_path = report_root / "context.json"
            atomic_json(context_path, record, immutable=True)
            files["context"] = describe_file(self.workspace.root, context_path)
            page = report_root / "index.html"
            atomic_bytes(page, report_html(record).encode("utf-8"), immutable=True)
            files["report"] = describe_file(self.workspace.root, page)
            archive = directory / "decision-context.zip"
            members = [(Path(item["path"]).relative_to(report_root.relative_to(self.workspace.root)).as_posix(),
                        self.workspace.root / item["path"]) for item in files.values()]
            _archive(archive, members)
            files["report_archive"] = describe_file(self.workspace.root, archive)
            record["files"] = files
            record["record_sha256"] = _record_hash(record)
            atomic_json(directory / "decision.json", record, immutable=True)
            return self.inspect(key)

    def _delivery(self, key):
        from .common import INVEST_VERSION

        key = identifier(key)
        row = read_json(self.workspace.root / "deliveries" / key / "delivery-state.json")
        selection = row.get("selection", {})
        expected = digest({"selection": selection, "baseline": selection.get("baseline_run_id"),
                           "version": INVEST_VERSION})
        if (row.get("schema") != "upstate.delivery/v1" or row.get("id") != key
                or row.get("state") != "complete" or expected != key):
            raise ValueError("Choose a complete original map delivery.")
        return row

    def compatible_deliveries(self, key):
        record = self.inspect(key, verify=False)
        if not record.get("analysis_id"):
            return []
        alternatives = set(record["alternative_run_ids"])
        result = []
        for path in sorted((self.workspace.root / "deliveries").glob("*/delivery-state.json")):
            value = read_json(path)
            selection = value.get("selection", {})
            if (value.get("state") == "complete" and
                    selection.get("baseline_run_id") == record["baseline_run_id"] and
                    alternatives <= set(selection.get("scenario_run_ids", []))):
                row = self._delivery(path.parent.name)
                result.append({"id": row["id"], "title": row["selection"].get("title"),
                               "completed_at": row.get("completed_at"),
                               "baseline_run_id": row["selection"]["baseline_run_id"],
                               "scenario_run_ids": row["selection"]["scenario_run_ids"]})
        return result

    def link_delivery(self, key, delivery_id):
        record = self.inspect(key)
        delivery_id = identifier(delivery_id)
        if delivery_id not in {row["id"] for row in self.compatible_deliveries(key)}:
            raise ValueError("Choose a complete map delivery with the report's baseline and alternatives.")
        delivery = self._delivery(delivery_id)
        original = verify_file(self.workspace.root / "deliveries" / delivery_id,
                               delivery["files"]["delivery_archive"])
        return self.workspace._save("decision-delivery-links", {
            "title": record["title"] + " · " + (delivery["selection"].get("title") or "Map delivery"),
            "state": "complete", "project_id": self.workspace.project["id"],
            "decision_id": record["id"], "decision_record_sha256": record["record_sha256"],
            "delivery_id": delivery_id, "delivery_state_sha256": digest(delivery),
            "baseline_run_id": record["baseline_run_id"],
            "alternative_run_ids": record["alternative_run_ids"],
            "quantity_scope": record["quantity_scope"],
            "geography_interpretation": "Decision quantities retain their selected scope; original delivery maps retain their reporting extent.",
            "files": {
                "decision_report": record["files"]["report_archive"],
                "map_delivery": describe_file(self.workspace.root, original),
            },
        })

    def verify_workspace(self):
        records = {row["id"]: self.inspect(row["id"]) for row in self.list()}
        links = self.workspace._list("decision-delivery-links")
        for link in links:
            record = records.get(link["decision_id"])
            if (record is None or link.get("project_id") != self.workspace.project["id"]
                    or link["decision_record_sha256"] != record["record_sha256"]):
                raise ValueError("A saved decision/map delivery link differs from its original report.")
            if digest(self._delivery(link["delivery_id"])) != link["delivery_state_sha256"]:
                raise ValueError("The linked original map delivery changed.")
            for item in link["files"].values():
                verify_file(self.workspace.root, item)
        return {"reports": len(records), "delivery_links": len(links)}
