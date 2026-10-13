"""Edition-aware assessment records on the retained station-geography path.

Original location candidates and polygon memberships remain owned by
station_geography. This module attaches source assessment rows to those stations.
"""
from __future__ import annotations

import hashlib
import html
import json
from collections import Counter

CAUSE_LABELS = {
    "BIO": "Biological assessment", "CU": "Copper", "PB": "Lead",
    "LEAD": "Lead", "TURB": "Turbidity", "TURBIDITY": "Turbidity",
    "PH": "pH", "DO": "Dissolved oxygen", "CHLA": "Chlorophyll a",
    "TP": "Total phosphorus", "NI": "Nickel", "ECOLI": "E. coli",
    "ZN": "Zinc", "PCB": "Polychlorinated biphenyls in fish tissue",
    "PCBS": "Polychlorinated biphenyls", "TN": "Total nitrogen",
    "HGF": "Mercury in fish tissue", "HG": "Mercury in water column",
    "NH3": "Ammonia nitrogen", "FC": "Fecal coliform",
    "ENTERO": "Enterococci", "CR": "Chromium", "CD": "Cadmium",
}
KNOWN_DRAFT_ASSESSMENT_SHA = "545a4e1413012b8f17c81c8afe815dd1e225ade5f5b9792ca22e83ef8723307f"

FIELD_ALIASES = {
    "source_vintage": ("source_vintage", "assessment_edition", "vintage"),
    "publisher_huc12": ("publisher_huc12", "huc12", "source_huc12"),
    "cause_code": ("cause_code", "cause_raw", "cause"),
    "description": ("description", "station_description"),
    "use": ("use", "impaired_use"),
    "priority_ranking": ("priority_ranking", "priority_rank"),
}


def _value(row, key, default=""):
    for name in FIELD_ALIASES.get(key, (key,)):
        value = row.get(name)
        if value is not None and str(value).strip():
            return str(value).strip()
    return default


def _cause_label(code, supplied=""):
    if supplied:
        return supplied
    if code in CAUSE_LABELS:
        return CAUSE_LABELS[code]
    # Older retained study inventories may retain a whole combined cause cell.
    parts = code.replace(";", ",").split(",")
    return "; ".join(CAUSE_LABELS.get(part.strip(), part.strip()) for part in parts)


def _station_publisher_hucs(station):
    """Read declared original attributes on the exact selected point candidate."""
    selected = next((item for item in station.get("candidates", [])
                     if item.get("candidate_id") == station.get("selected_candidate_id")), None)
    if selected is None:
        return {"huc12": "", "huc8": "", "fields": {}}
    properties = selected.get("properties") or {}
    source = selected.get("source_ref") or {}
    fields = {}
    # Exact original Atlas layer9 field, confirmed by its retained source edition.
    if source.get("source_sha256") == "14b1a945ee8d5f172f63435b4fd955e9dada6894fcbca2964160c6e2e52d79f0":
        if "HUC_12" in properties:
            fields["HUC_12"] = properties["HUC_12"]
    # Exact WQP station-page/CSV field; keep its eight-digit resolution.
    if str(properties.get("MonitoringLocationIdentifier", "")).startswith("21SC60WQ_WQX-"):
        if "HUCEightDigitCode" in properties:
            fields["HUCEightDigitCode"] = properties["HUCEightDigitCode"]
    huc12, huc8 = fields.get("HUC_12"), fields.get("HUCEightDigitCode")
    return {"huc12": huc12 if isinstance(huc12, str) and len(huc12) == 12 and huc12.isdigit() else "",
            "huc8": huc8 if isinstance(huc8, str) and len(huc8) == 8 and huc8.isdigit() else "",
            "fields": fields}


def _station_huc_relation(assessment_huc12, station_hucs):
    if not assessment_huc12:
        return "assessment_publisher_huc_missing"
    if station_hucs["huc12"]:
        return "same_huc12" if assessment_huc12 == station_hucs["huc12"] else "different_huc12"
    if station_hucs["huc8"]:
        return "same_huc8" if assessment_huc12[:8] == station_hucs["huc8"] else "different_huc8"
    return "station_publisher_huc_missing"


def _record_locator(reference, original, binding):
    """Keep a normalized-record locator separate from the selected CSV position."""
    if reference.get("record_pointer") is not None:
        return {"record_pointer": reference["record_pointer"],
                "record_index": reference.get("record_index"),
                "sha256": reference.get("source_sha256"),
                "record_id": original.get("id")}
    metadata = binding.get("source_metadata", {}).get("metadata", {})
    if metadata.get("schema") != "upstate.native-assessment-review-preparation/v1" or metadata.get("version") != 2:
        return {}
    checksum = _value(original, "original_normalized_sha256")
    pointer = _value(original, "original_record_pointer")
    index = _value(original, "original_record_index")
    path = _value(original, "original_record_path")
    if len(checksum) != 64 or any(c not in "0123456789abcdef" for c in checksum) or not index.isdigit() or pointer != "/records/" + str(int(index)) or not path:
        raise ValueError("Retain the selected assessment's complete original record locator")
    editions = [row for row in metadata.get("source_editions", [])
                if row.get("source_sha256") == checksum
                and row.get("publisher_source_id") == original.get("source_id")
                and row.get("publisher_source_sha256") == original.get("source_sha256")]
    members = [row for row in binding.get("companions", []) if row.get("sha256") == checksum]
    if len(editions) != 1 or not members:
        raise ValueError("The selected assessment lost its retained normalized source edition")
    member = sorted(members, key=lambda row: row.get("view_path") or row["filename"])[0]
    retained = {"path": member.get("view_path") or member["filename"],
                "sha256": member["sha256"], "bytes": member["bytes"]}
    return {"record_pointer": pointer, "record_index": int(index), "sha256": checksum,
            "path": path, "record_id": original.get("id"), "retained_source_member": retained}


def enrich(stations, source_bindings):
    """Return edition-specific links and enrich existing station rows in place."""
    bindings = {(source["collection_id"], source["source_id"]): source
                for source in source_bindings}
    links, edition_counts, sites_by_edition, changed_membership = [], Counter(), {}, []
    for station in stations:
        station_hucs = _station_publisher_hucs(station)
        records, seen = [], set()
        for reference in station.get("source_references", []):
            original = reference.get("original")
            if not isinstance(original, dict):
                continue
            key = json.dumps([reference.get("source_sha256"), reference.get("row_number"),
                              original], sort_keys=True, ensure_ascii=False, separators=(",", ":"))
            if key in seen:
                continue
            seen.add(key)
            source = bindings.get((reference.get("collection_id"), reference.get("source_id")), {})
            metadata = source.get("source_metadata", {})
            # This retained CSV identifies its draft source but carries publication
            # status in its original source edition rather than in each row.
            known_draft = reference.get("source_sha256") == KNOWN_DRAFT_ASSESSMENT_SHA
            publication = str(metadata.get("publication_status") or ("draft" if known_draft else ""))
            evidence = str(metadata.get("evidence_kind") or "")
            if known_draft:
                evidence = _value(original, "section", evidence)
            cause = _value(original, "cause_code")
            if not cause:
                continue
            edition = _value(original, "source_vintage", str(metadata.get("vintage") or ""))
            published_huc = _value(original, "publisher_huc12")
            spatial_hucs = sorted({str(item["watershed_id"]) for item in station.get("watersheds", [])
                                   if len(str(item.get("watershed_id", ""))) == 12
                                   and str(item["watershed_id"]).isdigit()})
            if not published_huc:
                membership = "source_huc_missing"
            elif not station.get("coordinates"):
                membership = "location_unresolved"
            elif station.get("watershed_status") == "not_selected":
                membership = "watersheds_not_selected"
            elif not spatial_hucs:
                membership = "no_selected_huc_membership"
            else:
                membership = ("matches_spatial_membership" if published_huc in spatial_hucs
                              else "differs_from_spatial_membership")
            source_id = _value(original, "source_id", reference.get("source_id", ""))
            locator = _record_locator(reference, original, source)
            record = {
                "id": hashlib.sha256((station["station_id"] + "|" + key).encode()).hexdigest()[:24],
                "station_id": station["station_id"],
                "assessment_record_id": _value(original, "id"),
                "source_id": source_id,
                "source_vintage": edition,
                "publication_status": _value(original, "publication_status", publication),
                "evidence_kind": _value(original, "evidence_kind", evidence),
                "source_uri": _value(original, "source_uri", source.get("uri") or ""),
                "source_sha256": _value(original, "source_sha256", reference.get("source_sha256") or ""),
                "publisher_huc12": published_huc,
                "station_publisher_huc12": station_hucs["huc12"],
                "station_publisher_huc8": station_hucs["huc8"],
                "station_publisher_huc_fields": station_hucs["fields"],
                "station_publisher_huc_relation": _station_huc_relation(published_huc, station_hucs),
                "inventory_body_sha256": reference.get("source_sha256"),
                "original_record_pointer": locator.get("record_pointer"),
                "original_record_index": locator.get("record_index"),
                "inventory_row_number": reference.get("row_number"),
                "cause_code": cause,
                "cause_label": _cause_label(cause, _value(original, "cause_label")),
                "cause_source_cell": _value(original, "cause_source_cell", cause),
                "use": _value(original, "use"),
                "use_support": _value(original, "use_support"),
                "priority_ranking": _value(original, "priority_ranking"),
                "description": _value(original, "description"),
                "county": _value(original, "county"),
                "source_page": original.get("source_page"),
                "tmdl_report": _value(original, "tmdl_report"),
                "approval_date": _value(original, "approval_date"),
                "location_status": station["status"],
                "coordinates_wgs84": station.get("coordinates"),
                "geographic_huc12s": spatial_hucs,
                "publisher_huc_relation": membership,
                "station_source_ref": station.get("selected_source_ref"),
                "inventory_source_ref": {key: value for key, value in reference.items() if key != "original"},
                "original": original,
            }
            if locator:
                record["original_record_locator"] = locator
            records.append(record)
            links.append(record)
            edition_key = (source_id, edition, record["publication_status"], record["evidence_kind"])
            edition_counts[edition_key] += 1
            sites_by_edition.setdefault(edition_key, set()).add(station["station_id"])
        station["assessment_records"] = records
        station["assessment_record_count"] = len(records)
        station["assessment_editions"] = sorted({record["source_vintage"] for record in records if record["source_vintage"]})
        station["assessment_cause_codes"] = sorted({record["cause_code"] for record in records})
        station["assessment_cause_labels"] = sorted({record["cause_label"] for record in records})
        station["publisher_huc12s"] = sorted({record["publisher_huc12"] for record in records if record["publisher_huc12"]})
        if len(station["publisher_huc12s"]) > 1:
            changed_membership.append({"station_id": station["station_id"],
                "publisher_huc12s": station["publisher_huc12s"],
                "assignments": [{"source_id": record["source_id"], "source_vintage": record["source_vintage"],
                                 "publisher_huc12": record["publisher_huc12"],
                                 "assessment_record_id": record["assessment_record_id"]} for record in records]})
    summary = {
        "assessment_record_count": len(links),
        "assessment_station_count": sum(bool(station["assessment_record_count"]) for station in stations),
        "assessment_editions": [{"source_id": key[0], "source_vintage": key[1],
            "publication_status": key[2], "evidence_kind": key[3],
            "record_count": count, "station_count": len(sites_by_edition[key])}
            for key, count in sorted(edition_counts.items())],
        "stations_with_multiple_publisher_hucs": changed_membership,
        "assessment_huc_relation_counts": dict(sorted(Counter(record["publisher_huc_relation"] for record in links).items())),
        "station_publisher_huc_relation_counts": dict(sorted(Counter(record["station_publisher_huc_relation"] for record in links).items())),
        "station_assessment_publisher_huc_differences": [
            {key: record[key] for key in ("station_id", "assessment_record_id", "source_vintage",
                "publisher_huc12", "station_publisher_huc12", "station_publisher_huc8",
                "station_publisher_huc_relation", "geographic_huc12s", "publisher_huc_relation",
                "original_record_pointer", "inventory_body_sha256")}
            for record in links if record["station_publisher_huc_relation"] in ("different_huc12", "different_huc8")],
    }
    return links, summary


def geojson(records):
    """Point records retain each assessment edition's HUC separately from geometry."""
    features = []
    for record in records:
        xy = record["coordinates_wgs84"]
        properties = {key: value for key, value in record.items()
                      if key not in ("id", "coordinates_wgs84", "original", "inventory_source_ref")}
        features.append({"type": "Feature", "id": record["id"],
            "geometry": {"type": "Point", "coordinates": xy} if xy else None,
            "properties": properties})
    return {"type": "FeatureCollection", "features": features}


def report_section(result):
    escape = lambda value: html.escape(str(value if value is not None else ""))
    records = result.get("assessment_links", [])
    if not records:
        return ""
    rows = []
    for record in records:
        rows.append("<tr>" + "".join("<td>" + escape(value) + "</td>" for value in (
            record["station_id"], record["source_vintage"],
            record["cause_label"] + " (" + record["cause_code"] + ")",
            record["use"], record["use_support"].replace("_", " "),
            record["publisher_huc12"], record.get("station_publisher_huc12") or record.get("station_publisher_huc8"),
            record.get("station_publisher_huc_relation", "").replace("_", " "),
            "; ".join(record["geographic_huc12s"]),
            record["publisher_huc_relation"].replace("_", " "), record["source_page"],
            record["tmdl_report"], record["approval_date"], record.get("original_record_pointer") or
            ("CSV row " + str(record["inventory_row_number"]) if record.get("inventory_row_number") else ""))) + "</tr>")
    sources = sorted({(record["source_id"], record["source_vintage"],
                       record["source_uri"], record["source_sha256"]) for record in records})
    source_rows = []
    for source_id, vintage, uri, sha in sources:
        link = ('<a href="' + escape(uri) + '" rel="noopener noreferrer">' + escape(uri) + '</a>'
                if uri.startswith(("https://", "http://")) else escape(uri))
        source_rows.append("<tr><td>" + escape(source_id) + "</td><td>" + escape(vintage) +
                           "</td><td>" + link + "</td><td><code>" + escape(sha) + "</code></td></tr>")
    source_table = ('<h3>Assessment publisher sources</h3><div class="scroll"><table><thead><tr>'
                    '<th>Source edition</th><th>Vintage</th><th>Publisher</th><th>Retained source SHA-256</th>'
                    '</tr></thead><tbody>' + "".join(source_rows) + '</tbody></table></div>')
    headers = ("Station", "Assessment edition", "Cause", "Use", "Support", "Assessment HUC12",
               "Station publisher HUC", "Publisher comparison", "Mapped HUC12", "Spatial comparison",
               "Source page", "TMDL report", "Approval date", "Original record location")
    return ("<h2>Assessment editions on the original station geography</h2><p>" +
            str(len(records)) + " source assessment records are attached to their exact station identifiers. "
             "Each edition retains its original cause, use and publisher HUC. Station publisher HUCs remain "
            "separate from assessment publisher HUCs. Geographic membership follows "
            "the retained point and polygon sources. Assessment TN is Total Nitrogen; classification TN is "
            "Trout Natural and remains a separate classified-reach field. Original normalized-bank JSON "
            "pointers identify distinct records even when extracted publisher row numbers repeat.</p>" +
            "<div class=\"scroll\"><table><thead><tr>" +
            "".join("<th>" + escape(value) + "</th>" for value in headers) +
            "</tr></thead><tbody>" + "".join(rows) + "</tbody></table></div>" + source_table)
