"""Source-bound SSURGO component/horizon K variants beside the native SDA rating.

Original provider rows and response bodies remain intact. This module never
changes the native Dominant Condition / Surface Layer capture or its geometry.
"""
from __future__ import annotations

import argparse
import csv
import html
import io
from collections import Counter, defaultdict
from decimal import Decimal, InvalidOperation, localcontext
import json
from pathlib import Path
import re

from model.common import (atomic_bytes, atomic_json, canonical, describe_file, digest,
                          file_digest, held, read_json, verify_file)
from source_tools.soil_sources import Sda, SERVICE, K_FACTOR, K_UNITS, ATTR_QUERY
from source_tools import soil_region

SCHEMA = "upstate.soil-component-capture/v1"
PROJECTION_SCHEMA = "upstate.soil-component-projection/v1"
TABLE_KEYS = {"mapunit": "mukey", "legend": "lkey", "sacatalog": "areasymbol",
              "component": "cokey", "chorizon": "chkey"}
DEFAULT_SELECTION = {
    "attribute": "kwfact", "component_method": "weighted_mean",
    "weight_field": "comppct_r", "component_filter": "all",
    "horizon_method": "surface", "missing_policy": "strict",
    "tie_break": "higher"}
REFERENCES = [
    "https://www.nrcs.usda.gov/sites/default/files/2022-09/Soil-Data-Viewer-6-2-User-Guide.pdf",
    "https://sdmdataaccess.nrcs.usda.gov/documents/FundamentalQuery.pdf",
    "https://www.nrcs.usda.gov/sites/default/files/2022-08/SSURGO-Metadata-Table-Column-Descriptions-Report.pdf"]


def _copy(value):
    return json.loads(canonical(value))


def _key(value):
    text = str(value)
    if not re.fullmatch(r"[1-9][0-9]*", text):
        raise ValueError("Retain the exact nonzero decimal SSURGO key: " + text)
    return text


def _decimal(value):
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return None
    try:
        result = Decimal(str(value).strip())
    except (InvalidOperation, ValueError):
        return None
    return result if result.is_finite() else None


def _text(value):
    if value is None:
        return None
    if value == 0:
        return "0"
    return format(value.normalize(), "f")


def selection(value):
    if not isinstance(value, dict):
        raise ValueError("Choose a complete component interpretation object")
    result = _copy(value)
    fields = {
        "attribute": ("kwfact", "kffact"),
        "component_method": ("weighted_mean", "dominant_component", "dominant_condition"),
        "weight_field": ("comppct_r", "comppct_l", "comppct_h"),
        "component_filter": ("all", "major"),
        "horizon_method": ("surface", "depth"),
        "missing_policy": ("strict", "available"),
        "tie_break": ("lower", "higher")}
    for name, choices in fields.items():
        if result.get(name) not in choices:
            raise ValueError("Choose " + name + " from " + ", ".join(choices))
    if result["horizon_method"] == "depth":
        top, bottom = (_decimal(result.get(k)) for k in ("depth_top_cm", "depth_bottom_cm"))
        if top is None or bottom is None or top < 0 or bottom <= top:
            raise ValueError("Choose a finite nonnegative top and deeper bottom in centimetres")
        result.update(depth_top_cm=_text(top), depth_bottom_cm=_text(bottom))
    elif result.get("depth_top_cm") is not None or result.get("depth_bottom_cm") is not None:
        raise ValueError("Surface interpretation has no authored depth interval")
    return result


def _index(rows, name):
    if not isinstance(rows, list) or any(not isinstance(r, dict) for r in rows):
        raise ValueError("Retain the complete " + name + " row collection")
    key = TABLE_KEYS[name]
    result = {}
    for row in rows:
        identity = str(row.get(key)) if name == "sacatalog" else _key(row.get(key))
        if not identity or identity == "None":
            raise ValueError("Original survey identity is missing")
        if identity in result:
            raise ValueError("Duplicate original " + key + ": " + identity)
        result[identity] = row
    return result


def relations(tables):
    if not isinstance(tables, dict):
        raise ValueError("Retain all five original SSURGO tables")
    indexed = {name: _index(tables.get(name), name) for name in TABLE_KEYS}
    for row in indexed["mapunit"].values():
        if _key(row.get("lkey")) not in indexed["legend"]:
            raise ValueError("Original mapunit references an absent legend")
    for row in indexed["legend"].values():
        if str(row.get("areasymbol")) not in indexed["sacatalog"]:
            raise ValueError("Original legend references an absent survey")
    for row in indexed["component"].values():
        if _key(row.get("mukey")) not in indexed["mapunit"]:
            raise ValueError("Original component references an absent mapunit")
    for row in indexed["chorizon"].values():
        if _key(row.get("cokey")) not in indexed["component"]:
            raise ValueError("Original horizon references an absent component")
    return indexed


def _component(row, horizons, chosen):
    reasons = []
    layers = []
    attribute = chosen["attribute"]
    for source in horizons:
        top, bottom = _decimal(source.get("hzdept_r")), _decimal(source.get("hzdepb_r"))
        rating = _decimal(source.get(attribute))
        if rating is not None and rating < 0:
            rating = None
        item = {"chkey": _key(source["chkey"]), "name": source.get("hzname"),
                "top_cm": _text(top), "bottom_cm": _text(bottom),
                "original_choice": source.get(attribute), "value_customary": _text(rating),
                "source_sha256": digest(source), "selected_overlap_cm": "0"}
        layers.append(item)
        if top is None or bottom is None or top < 0 or bottom <= top:
            item["issue"] = "invalid_or_missing_representative_depth"
            reasons.append(item["issue"])
        elif source.get(attribute) not in (None, "") and rating is None:
            item["issue"] = "invalid_nonnegative_numeric_choice"
    valid = sorted([x for x in layers if "issue" not in x or
                    x["issue"] == "invalid_nonnegative_numeric_choice"],
                   key=lambda x: (Decimal(x["top_cm"]), Decimal(x["bottom_cm"]), x["chkey"]))
    requested = covered = rated = Decimal(0)
    value = None
    selected_keys = []
    if not layers:
        reasons.append("no_horizons")
    if chosen["horizon_method"] == "surface":
        if valid:
            minimum = Decimal(valid[0]["top_cm"])
            first = [x for x in valid if Decimal(x["top_cm"]) == minimum]
            if minimum != 0:
                reasons.append("surface_does_not_start_at_zero")
            elif len(first) != 1:
                reasons.append("ambiguous_surface_horizons")
            elif any(Decimal(x["top_cm"]) < Decimal(first[0]["bottom_cm"]) for x in valid[1:]):
                reasons.append("overlapping_surface_horizons")
            elif not reasons:
                item = first[0]
                requested = covered = Decimal(item["bottom_cm"]) - minimum
                item["selected_overlap_cm"] = _text(requested)
                selected_keys = [item["chkey"]]
                value = _decimal(item["value_customary"])
                if value is None:
                    reasons.append("surface_choice_missing_or_invalid")
                else:
                    rated = requested
    else:
        top, bottom = Decimal(chosen["depth_top_cm"]), Decimal(chosen["depth_bottom_cm"])
        requested = bottom - top
        spans = []
        numerator = Decimal(0)
        for item in valid:
            left = max(top, Decimal(item["top_cm"]))
            right = min(bottom, Decimal(item["bottom_cm"]))
            if right <= left:
                continue
            overlap = right - left
            item["selected_overlap_cm"] = _text(overlap)
            selected_keys.append(item["chkey"])
            spans.append((left, right))
            coefficient = _decimal(item["value_customary"])
            if coefficient is not None:
                numerator += coefficient * overlap
                rated += overlap
        previous_end = top
        union = Decimal(0)
        overlap_found = False
        for left, right in sorted(spans):
            overlap_found |= left < previous_end
            union += max(Decimal(0), right - max(previous_end, left))
            previous_end = max(previous_end, right)
        covered = union
        if overlap_found:
            reasons.append("overlapping_selected_horizons")
        if covered < requested:
            reasons.append("selected_depth_gap")
        if rated < covered:
            reasons.append("selected_horizon_choice_missing_or_invalid")
        fatal = any(x in reasons for x in
                    ("invalid_or_missing_representative_depth", "overlapping_selected_horizons"))
        if rated > 0 and not fatal and (
                chosen["missing_policy"] == "available" or rated == requested):
            value = numerator / rated
    return {
        "cokey": _key(row["cokey"]), "name": row.get("compname"),
        "major_flag": row.get("majcompflag"), "source_sha256": digest(row),
        "value_customary": _text(value),
        "value_si": _text(value * K_FACTOR) if value is not None else None,
        "requested_depth_cm": _text(requested), "covered_depth_cm": _text(covered),
        "rated_depth_cm": _text(rated),
        "depth_coverage_fraction": _text(rated / requested) if requested else None,
        "selected_horizon_keys": selected_keys, "horizons": layers,
        "issues": sorted(set(reasons))}


def _choose_tied(values, rule):
    known = [v for v in values if v is not None]
    if not known:
        return None
    return min(known) if rule == "lower" else max(known)


def project(tables, value):
    """Pure complete relation projection; no source/network/workspace mutation."""
    chosen = selection(value)
    indexed = relations(tables)
    components = defaultdict(list)
    horizons = defaultdict(list)
    for row in indexed["component"].values():
        components[_key(row["mukey"])].append(row)
    for row in indexed["chorizon"].values():
        horizons[_key(row["cokey"])].append(row)
    results = []
    with localcontext() as context:
        context.prec = 40
        for mukey in sorted(indexed["mapunit"], key=int):
            source = indexed["mapunit"][mukey]
            rows = []
            issues = []
            for row in sorted(components[mukey], key=lambda x: int(_key(x["cokey"]))):
                item = _component(row, horizons[_key(row["cokey"])], chosen)
                flag = str(row.get("majcompflag") or "").casefold()
                included = chosen["component_filter"] == "all" or flag == "yes"
                if chosen["component_filter"] == "major" and flag not in ("yes", "no"):
                    issues.append("component_major_flag_unknown")
                weight = _decimal(row.get(chosen["weight_field"]))
                if weight is not None and (weight < 0 or weight > 100):
                    weight = None
                item.update(included=included, weight_field=chosen["weight_field"],
                            original_weight=row.get(chosen["weight_field"]),
                            weight_percent=_text(weight))
                rows.append(item)
            selected = [r for r in rows if r["included"]]
            unknown = [r for r in selected if r["weight_percent"] is None]
            weighted = [r for r in selected if r["weight_percent"] is not None
                        and Decimal(r["weight_percent"]) > 0]
            rated_rows = [r for r in weighted if r["value_customary"] is not None]
            known_weight = sum((Decimal(r["weight_percent"]) for r in weighted), Decimal(0))
            rated_weight = sum((Decimal(r["weight_percent"]) for r in rated_rows), Decimal(0))
            all_known = sum((Decimal(r["weight_percent"]) for r in rows
                             if r["weight_percent"] is not None), Decimal(0))
            if not selected:
                issues.append("no_selected_components")
            if unknown:
                issues.append("selected_component_weight_unknown")
            if rated_weight < known_weight:
                issues.append("selected_component_value_missing")
            if chosen["weight_field"] == "comppct_r" and all_known > 100:
                issues.append("representative_component_percent_exceeds_100")
            coefficient = None
            chosen_keys = []
            tied_keys = []
            tie_contains_missing = False
            tie = False
            if chosen["component_method"] == "weighted_mean":
                if rated_weight:
                    coefficient = sum((Decimal(r["weight_percent"]) *
                                       Decimal(r["value_customary"]) for r in rated_rows),
                                      Decimal(0)) / rated_weight
                    chosen_keys = [r["cokey"] for r in rated_rows]
            elif chosen["component_method"] == "dominant_component" and weighted:
                largest = max(Decimal(r["weight_percent"]) for r in weighted)
                candidates = [r for r in weighted if Decimal(r["weight_percent"]) == largest]
                tie = len(candidates) > 1
                tied_keys = [r["cokey"] for r in candidates]
                tie_contains_missing = tie and any(r["value_customary"] is None for r in candidates)
                coefficient = _choose_tied([_decimal(r["value_customary"]) for r in candidates],
                                          chosen["tie_break"])
                chosen_keys = [r["cokey"] for r in candidates
                               if _decimal(r["value_customary"]) == coefficient]
            elif chosen["component_method"] == "dominant_condition" and weighted:
                groups = defaultdict(lambda: Decimal(0))
                for row in weighted:
                    groups[_decimal(row["value_customary"])] += Decimal(row["weight_percent"])
                largest = max(groups.values())
                candidates = [rating for rating, weight in groups.items() if weight == largest]
                tie = len(candidates) > 1
                tied_keys = [r["cokey"] for r in weighted if _decimal(r["value_customary"]) in candidates]
                tie_contains_missing = tie and None in candidates
                coefficient = _choose_tied(candidates, chosen["tie_break"])
                chosen_keys = [r["cokey"] for r in weighted
                               if _decimal(r["value_customary"]) == coefficient]
            if tie_contains_missing:
                issues.append("tied_missing_rating_native_nonnull_preference")
            if ("representative_component_percent_exceeds_100" in issues or
                (unknown and chosen["component_method"] != "weighted_mean") or
                (chosen["missing_policy"] == "strict" and
                 (unknown or rated_weight < known_weight or
                  "component_major_flag_unknown" in issues))):
                coefficient = None
                chosen_keys = []
            results.append({
                "mukey": mukey, "name": source.get("muname"), "symbol": source.get("musym"),
                "source_sha256": digest(source), "components": rows,
                "component_count": len(rows), "selected_component_count": len(selected),
                "unknown_selected_weight_count": len(unknown),
                "all_known_component_percent": _text(all_known),
                "selected_known_component_percent": _text(known_weight),
                "rated_component_percent": _text(rated_weight),
                "rated_fraction_of_selected_known_weight":
                    _text(rated_weight / known_weight) if known_weight else None,
                "rated_percent_of_mapunit": _text(rated_weight)
                    if chosen["weight_field"] == "comppct_r" else None,
                "value_customary": _text(coefficient),
                "value_si": _text(coefficient * K_FACTOR) if coefficient is not None else None,
                "selected_component_keys": chosen_keys, "tie": tie,
                "all_tied_component_keys": tied_keys if tie else [],
                "tie_contains_missing": tie_contains_missing,
                "issues": sorted(set(issues))})
    report = {
        "schema": PROJECTION_SCHEMA, "selection": chosen,
        "source_tables_sha256": digest(tables),
        "source_rows": {name: len(rows) for name, rows in indexed.items()},
        "units": {"original": "customary RUSLE K", "derived": K_UNITS,
                  "factor": str(K_FACTOR), "applications": 1},
        "method_status": "Explicit analyst interpretation; preserved native SDA baseline is separate",
        "spatial_meaning": "Component proportions describe a mapunit, not located subpixel components",
        "uncertainty_meaning": "Method and component-weight sensitivities are not probability intervals",
        "mapunits": results,
        "summary": {"mapunits": len(results),
                    "rated_mapunits": sum(r["value_customary"] is not None for r in results),
                    "unrated_mapunits": sum(r["value_customary"] is None for r in results),
                    "mapunits_with_ties": sum(r["tie"] for r in results),
                    "mapunit_issues": dict(Counter(x for r in results for x in r["issues"])),
                    "component_issues": dict(Counter(x for r in results for c in r["components"]
                                                     for x in c["issues"]))},
        "references": REFERENCES}
    report["projection_sha256"] = digest(report)
    return report


def _query_counted(client, name, sql, count_sql):
    counted = client.query(name + "-count", count_sql)
    if len(counted) != 1 or not str(counted[0].get("row_count", "")).isdecimal():
        raise ValueError("Retain the original exact SDA row count")
    count = int(counted[0]["row_count"])
    rows = client.query(name, sql)
    if len(rows) != count:
        raise ValueError("SDA result length differs from its retained count; choose a smaller capture batch")
    return rows


def _queries(keys):
    chosen = ",".join(_key(k) for k in keys)
    mu = "SELECT mukey FROM mapunit WHERE mukey IN (" + chosen + ")"
    co = "SELECT cokey FROM component WHERE mukey IN (" + mu + ")"
    le = "SELECT lkey FROM mapunit WHERE mukey IN (" + chosen + ")"
    areas = "SELECT areasymbol FROM legend WHERE lkey IN (" + le + ")"
    # Select each entity once. Separate full tables retain absent children
    # without repeating component weights once per joined horizon.
    return {
        "mapunit": ("mapunit mu", "mu", "mu.mukey",
                    " WHERE mu.mukey IN (" + chosen + ")"),
        "component": ("component c", "c", "c.mukey,c.cokey",
                      " WHERE c.mukey IN (" + mu + ")"),
        "chorizon": ("chorizon h", "h", "h.cokey,h.chkey",
                     " WHERE h.cokey IN (" + co + ")"),
        "legend": ("legend l", "l", "l.lkey", " WHERE l.lkey IN (" + le + ")"),
        "sacatalog": ("sacatalog s", "s", "s.areasymbol",
                      " WHERE s.areasymbol IN (" + areas + ")")}


def _table_batch(client, name, relation, alias, order, where):
    sql = "SELECT " + alias + ".* FROM " + relation + where
    count = "SELECT CAST(COUNT_BIG(*) AS varchar(30)) AS row_count FROM " + relation + where
    return _query_counted(client, name, sql + " ORDER BY " + order, count)


def _merge(destination, rows, table):
    key_name = TABLE_KEYS[table]
    for row in rows:
        key = str(row.get(key_name)) if table == "sacatalog" else _key(row.get(key_name))
        if key in destination and destination[key] != row:
            raise ValueError("Conflicting original repeated " + key_name + ": " + key)
        destination[key] = row


def verify_capture(directory):
    root = Path(directory).resolve(strict=True)
    record = read_json(root / "capture.json")
    if record.get("schema") != SCHEMA or record.get("state") != "complete":
        raise ValueError("Finish the selected complete component/horizon capture")
    for member in record["files"]:
        verify_file(root, member)
    plan = read_json(root / "plan.json")
    if digest(plan) != record["plan_sha256"]:
        raise ValueError("Original component source plan changed")
    if record.get("regional_capture"):
        native_record, _ = soil_region.verify_capture(root / record["regional_capture"])
        if (file_digest(root / record["regional_capture"] / "capture.json") != plan["regional_capture_sha256"] or
                native_record["plan_sha256"] != plan["regional_plan_sha256"]):
            raise ValueError("Component tables name another original regional capture")
    elif record.get("reference_capture"):
        from source_tools.soil_component_reference import verify_reference
        reference = verify_reference(root / record["reference_capture"] / record["reference_filename"])
        if reference != plan["reference"]:
            raise ValueError("Component tables name another original interpretation reference")
        baseline = read_json(root / record["native_baseline"])
        if digest(baseline) != record["native_baseline_sha256"] or baseline != reference["baseline"]:
            raise ValueError("Original reference baseline changed")
    else:
        raise ValueError("Component capture has no original native source binding")
    tables = read_json(root / record["tables"])
    indexed = relations(tables)
    if set(indexed["mapunit"]) != set(plan["mapunit_keys"]):
        raise ValueError("Component tables differ from the original selected mapunit set")
    if digest(tables) != record["tables_sha256"]:
        raise ValueError("Original component source tables changed")
    if digest(read_json(root / record["attribute_metadata"])) != record["attribute_metadata_sha256"]:
        raise ValueError("Original Kw/Kf attribute metadata changed")
    return record, plan


def _capture_tables(client, keys, batch_size, root, plan):
    metadata = client.query("component-attribute-metadata", ATTR_QUERY)
    for field in ("kwfact", "kffact"):
        candidates = [r for r in metadata if r.get("attributetablename") == "chorizon"
                      and r.get("attributecolumnname") == field]
        if (len(candidates) != 1 or
                candidates[0].get("attributelogicaldatatype") != "Choice"):
            raise ValueError("Retain one original chorizon Choice metadata record for " + field)
    atomic_json(root / "attribute-metadata.json", metadata, immutable=True)
    merged = {name: {} for name in TABLE_KEYS}
    before = {}
    for start in range(0, len(keys), batch_size):
        selected = keys[start:start + batch_size]
        queries = _queries(selected)
        label = "relations/batch-" + str(start).zfill(7)
        relation, alias, order, where = queries["sacatalog"]
        initial = _table_batch(client, label + "-survey-before", relation, alias, order, where)
        _merge(before, initial, "sacatalog")
        for name, (relation, alias, order, where) in queries.items():
            rows = _table_batch(client, label + "-" + name, relation, alias, order, where)
            _merge(merged[name], rows, name)
        if set(merged["mapunit"]) != set(keys[:start + len(selected)]):
            raise ValueError("SDA mapunits differ from the exact original regional selection")
        atomic_json(root / "progress.json", {"plan_sha256": digest(plan),
                    "completed_mapunits": start + len(selected),
                    "rows": {name: len(rows) for name, rows in merged.items()}})
    after = {}
    for start in range(0, len(keys), batch_size):
        queries = _queries(keys[start:start + batch_size])
        relation, alias, order, where = queries["sacatalog"]
        rows = _table_batch(client, "relations/batch-" + str(start).zfill(7) +
                            "-survey-after", relation, alias, order, where)
        _merge(after, rows, "sacatalog")
    if before != after or before != merged["sacatalog"]:
        raise ValueError("Original survey catalogue changed during component capture")
    return metadata, merged, before, after


def capture(regional_capture, output, *, vintage, batch_size=100, resume=False):
    regional_root = Path(regional_capture).resolve(strict=True)
    regional_record, regional_plan = soil_region.verify_capture(regional_root)
    if not isinstance(vintage, str) or not vintage.strip():
        raise ValueError("Name this actual component/horizon source edition")
    if type(batch_size) is not int or not 1 <= batch_size <= 1000:
        raise ValueError("Choose an original mapunit request batch from 1 to 1000")
    root = Path(output).resolve()
    if root == regional_root or regional_root in root.parents or root in regional_root.parents:
        raise ValueError("Use a distinct source directory beside the original regional capture")
    root.mkdir(parents=True, exist_ok=True)
    keys = [str(k) for k in read_json(regional_root / "geometry-capture.json")["mapunit_keys"]]
    if not keys or len(set(keys)) != len(keys):
        raise ValueError("Original regional capture has no unique mapunit set")
    keys = sorted((_key(k) for k in keys), key=int)
    plan = {"schema": "upstate.soil-component-capture-plan/v1",
            "regional_capture_sha256": file_digest(regional_root / "capture.json"),
            "regional_plan_sha256": regional_record["plan_sha256"],
            "geometry_source_id": regional_record["source_id"], "mapunit_keys": keys,
            "vintage": vintage, "batch_size": batch_size, "source": SERVICE,
            "source_tables": list(TABLE_KEYS), "references": REFERENCES}
    with held(root / "capture.lock", blocking=False):
        atomic_json(root / "plan.json", plan, immutable=True)
        if (root / "capture.json").exists():
            record, _ = verify_capture(root)
            return record
        client = Sda(root, resume=resume)
        metadata, merged, before, after = _capture_tables(client, keys, batch_size, root, plan)
        # Keep the original spatial-vintage baseline alongside the newly observed
        # full catalogue. An edition mismatch is explicit, not silently rewritten.
        old_surveys = read_json(regional_root / "survey-editions.json")
        for original in old_surveys["surveys"]:
            current = before.get(str(original["areasymbol"]))
            if current is None or any(str(current.get(k)) != str(original.get(k))
                                      for k in ("areasymbol", "saverest")):
                raise ValueError("Component tables differ from the original geometry survey edition")
        tables = {name: [rows[k] for k in sorted(rows)] for name, rows in merged.items()}
        relations(tables)
        atomic_json(root / "tables.json", tables, immutable=True)
        atomic_json(root / "survey-binding.json",
                    {"original_regional": old_surveys, "before": before, "after": after},
                    immutable=True)
        for member in regional_record["files"]:
            soil_region._copy(verify_file(regional_root, member),
                              root / "regional" / member["path"], member)
        soil_region._copy(regional_root / "capture.json", root / "regional" / "capture.json")
        for name in ("source-entry.json", "source-manifest.json"):
            if (regional_root / name).is_file():
                soil_region._copy(regional_root / name, root / "regional" / name)
        record = {"schema": SCHEMA, "state": "complete", "plan_sha256": digest(plan),
                  "source_id": "usda-soil-components-" + digest(plan)[:16],
                  "regional_capture": "regional", "tables": "tables.json",
                  "tables_sha256": digest(tables),
                  "attribute_metadata": "attribute-metadata.json",
                  "attribute_metadata_sha256": digest(metadata),
                  "rows": {name: len(rows) for name, rows in tables.items()},
                  "files": soil_region._members(root, {"capture.json"})}
        atomic_json(root / "capture.json", record, immutable=True)
        return record


def _csv(rows):
    rows = list(rows)
    fields = sorted({key for row in rows for key in row})
    out = io.StringIO(newline="")
    writer = csv.DictWriter(out, fieldnames=fields, lineterminator="\n")
    writer.writeheader()
    for row in rows:
        writer.writerow({k: json.dumps(v, ensure_ascii=False, sort_keys=True)
                         if isinstance(v, (dict, list)) else v for k, v in row.items()})
    return out.getvalue().encode("utf-8")


def write_report(root, tables, document):
    """Complete human-readable projection and exact original/contribution exports."""
    root = Path(root)
    report = document["projection"]
    for name, rows in tables.items():
        if name in TABLE_KEYS:
            atomic_bytes(root / ("original-" + name + ".csv"), _csv(rows), immutable=True)
    mapunits, components, horizons = [], [], []
    for row in report["mapunits"]:
        mapunits.append({k: v for k, v in row.items() if k != "components"})
        for component in row["components"]:
            components.append({"mukey": row["mukey"],
                               **{k: v for k, v in component.items() if k != "horizons"}})
            horizons.extend({"mukey": row["mukey"], "cokey": component["cokey"], **h}
                            for h in component["horizons"])
    for name, rows in (("mapunit-results", mapunits), ("component-contributions", components),
                       ("horizon-contributions", horizons),
                       ("native-comparison", document["native_comparison"])):
        atomic_bytes(root / (name + ".csv"), _csv(rows), immutable=True)
    def esc(value):
        return html.escape("" if value is None else str(value))
    def grid(rows, columns):
        return ('<div class="table"><table><thead><tr>' +
                "".join("<th>" + esc(label) + "</th>" for _, label in columns) +
                "</tr></thead><tbody>" + "".join("<tr>" + "".join(
                    "<td>" + esc(row.get(key)) + "</td>" for key, _ in columns) + "</tr>"
                    for row in rows) + "</tbody></table></div>")
    links = ["projection.json", "mapunit-results.csv", "component-contributions.csv",
             "horizon-contributions.csv", "native-comparison.csv"]
    links += ["original-" + name + ".csv" for name in TABLE_KEYS]
    content = ['<!doctype html><html lang="en"><meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width,initial-scale=1">',
        '<title>Soil component interpretation</title><style>',
        'body{font:16px/1.5 system-ui,sans-serif;color:#202020;background:white;margin:0;padding:24px;max-width:1200px}',
        'h1,h2{line-height:1.2}table{border-collapse:collapse;width:100%}th,td{padding:8px;border:1px solid #bbb;text-align:left;vertical-align:top}',
        '.table{overflow:auto;margin:16px 0}summary{cursor:pointer;padding:12px;border:1px solid #aaa}',
        'details{margin:12px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere}a{color:#222}li{margin:6px 0}',
        '@media(max-width:500px){body{padding:12px}th,td{padding:6px}}</style>',
        '<h1>Soil component interpretation</h1><p>Explicit source-bound analyst variant. ',
        'The original native SDA Dominant Condition / Surface Layer result remains separate.</p>',
        '<h2>Selected method</h2>' + grid(
            [{"choice": key.replace("_", " ").capitalize(), "value": value}
             for key, value in report["selection"].items()],
            [("choice", "Choice"), ("value", "Selected value")]),
        '<p>Mapunit component percentages describe composition, not the physical location of ',
        'subpixel soils. Available-data means expose omitted weights and depth. Method differences ',
        'and low/high component-weight alternatives are sensitivities, not confidence intervals.</p>',
        '<h2>Coverage</h2>' + grid(
            [{"measure": key.replace("_", " ").capitalize(), "value": value}
             for key, value in report["summary"].items() if not isinstance(value, dict)],
            [("measure", "Measure"), ("value", "Count")]) +
            grid([{"scope": scope.replace("_", " "), "issue": issue.replace("_", " "), "count": count}
                  for scope in ("mapunit_issues", "component_issues")
                  for issue, count in report["summary"][scope].items()],
                 [("scope", "Scope"), ("issue", "Recorded issue"), ("count", "Count")]) +
            '<details><summary>Complete method and coverage JSON</summary><pre>' +
            esc(json.dumps({"selection": report["selection"], "summary": report["summary"]}, indent=2)) +
            '</pre></details>',
        '<h2>Complete files</h2><ul>' + ''.join(
            '<li><a href="' + esc(name) + '" download>' + esc(name) + '</a></li>'
            for name in links) + '</ul>',
        '<h2>Mapunits and contributing original rows</h2>']
    for row in report["mapunits"]:
        content.append('<details><summary>' + esc(row["mukey"]) + ' — ' + esc(row["name"]) +
                       ' — K ' + esc(row["value_si"] if row["value_si"] is not None else "missing") +
                       '</summary><p>Rated component percent: ' + esc(row["rated_component_percent"]) +
                       '; selected known percent: ' + esc(row["selected_known_component_percent"]) +
                       '; unknown selected weights: ' + esc(row["unknown_selected_weight_count"]) +
                       '. Issues: ' + esc(", ".join(row["issues"]) or "none") + '</p>')
        content.append(grid(row["components"], [
            ("cokey", "Component"), ("name", "Name"), ("included", "Selected"),
            ("weight_percent", "Weight %"), ("value_customary", "Customary K"),
            ("value_si", "SI K"), ("requested_depth_cm", "Requested cm"),
            ("covered_depth_cm", "Covered cm"), ("rated_depth_cm", "Rated cm"),
            ("issues", "Issues")]))
        for component in row["components"]:
            content.append('<details><summary>Horizons for ' + esc(component["cokey"]) +
                           '</summary>' + grid(component["horizons"], [
                ("chkey", "Horizon"), ("name", "Name"), ("top_cm", "Top cm"),
                ("bottom_cm", "Bottom cm"), ("original_choice", "Original K choice"),
                ("selected_overlap_cm", "Selected cm"), ("issue", "Issue")]) + '</details>')
        content.append('</details>')
    content.append('<h2>Source identities and units</h2><pre>' + esc(json.dumps({
        "capture_sha256": document["capture_sha256"],
        "source_tables_sha256": report["source_tables_sha256"],
        "projection_sha256": report["projection_sha256"], "units": report["units"]},
        indent=2)) + '</pre></html>')
    atomic_bytes(root / "report.html", "".join(content).encode("utf-8"), immutable=True)


def prepare_projection(component_capture, value, output):
    source = Path(component_capture).resolve(strict=True)
    record, plan = verify_capture(source)
    return _prepare_projection_verified(source, record, plan, value, output)


def _prepare_projection_verified(source, record, plan, value, output):
    """Use only inside this original operation after verify_capture completed."""
    root = Path(output).resolve()
    if root == source or source in root.parents or root in source.parents:
        raise ValueError("Use a distinct immutable projection directory")
    root.mkdir(parents=True, exist_ok=True)
    with held(root / "projection.lock", blocking=False):
        report = project(read_json(source / record["tables"]), value)
        native = (soil_region._coefficients(read_json(source / "regional" / "ratings.json")["batches"])
                  if record.get("regional_capture") else
                  {int(k): _decimal(v) for k, v in read_json(source / record["native_baseline"]).items()})
        comparison = []
        for row in report["mapunits"]:
            original = native[int(row["mukey"])]
            current = _decimal(row["value_customary"])
            comparison.append({"mukey": row["mukey"], "native_customary": _text(original),
                "variant_customary": _text(current),
                "difference_si": _text((current - original) * K_FACTOR)
                    if current is not None and original is not None else None,
                "same_support": current is not None and original is not None})
        document = {"schema": "upstate.soil-component-prepared-projection/v1",
                    "capture_sha256": file_digest(source / "capture.json"),
                    "capture_plan_sha256": record["plan_sha256"],
                    "source_id": record["source_id"], "vintage": plan["vintage"],
                    "attribute_metadata_sha256": record["attribute_metadata_sha256"],
                    "attribute_metadata": read_json(source / record["attribute_metadata"]),
                    "projection": report, "native_comparison": comparison}
        document["sha256"] = digest(document)
        atomic_json(root / "projection.json", document, immutable=True)
        write_report(root, read_json(source / record["tables"]), document)
        return document


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    capture_parser = commands.add_parser("capture")
    capture_parser.add_argument("--regional-capture", required=True)
    capture_parser.add_argument("--output", required=True)
    capture_parser.add_argument("--vintage", required=True)
    capture_parser.add_argument("--batch-size", type=int, default=100)
    capture_parser.add_argument("--resume", action="store_true")
    projection = commands.add_parser("project")
    projection.add_argument("--capture", required=True)
    projection.add_argument("--selection", required=True)
    projection.add_argument("--output", required=True)
    args = parser.parse_args(argv)
    if args.command == "capture":
        result = capture(args.regional_capture, args.output, vintage=args.vintage,
                         batch_size=args.batch_size, resume=args.resume)
    else:
        result = prepare_projection(args.capture, read_json(args.selection), args.output)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
