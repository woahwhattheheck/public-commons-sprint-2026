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


def enrich(stations, source_bindings):
    """Return edition-specific links and enrich existing station rows in place."""
    bindings = {(source["collection_id"], source["source_id"]): source
                for source in source_bindings}
    links, edition_counts, sites_by_edition, changed_membership = [], Counter(), {}, []
    for station in stations:
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
            record = {
                "id": hashlib.sha256((station["station_id"] + "|" + key).encode()).hexdigest()[:24],
                "station_id": station["station_id"],
                "assessment_record_id": _value(original, "id"),
                "source_id": source_id,
                "source_vintage": edition,
                "publication_status": _value(original, "publication_status", str(metadata.get("publication_status") or "")),
                "evidence_kind": _value(original, "evidence_kind", str(metadata.get("evidence_kind") or "")),
                "source_uri": _value(original, "source_uri", source.get("uri") or ""),
                "source_sha256": _value(original, "source_sha256", reference.get("source_sha256") or ""),
                "publisher_huc12": published_huc,
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
            record["publisher_huc12"], "; ".join(record["geographic_huc12s"]),
            record["publisher_huc_relation"].replace("_", " "), record["source_page"],
            record["tmdl_report"], record["approval_date"])) + "</tr>")
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
    headers = ("Station", "Assessment edition", "Cause", "Use", "Support", "Publisher HUC12",
               "Mapped HUC12", "Membership relation", "Source page", "TMDL report", "Approval date")
    return ("<h2>Assessment editions on the original station geography</h2><p>" +
            str(len(records)) + " source assessment records are attached to their exact station identifiers. "
            "Each edition retains its original cause, use and publisher HUC. Geographic membership follows "
            "the retained point and polygon sources. Assessment TN is Total Nitrogen; classification TN is "
            "Trout Natural and remains a separate classified-reach field.</p><div class=\"scroll\"><table><thead><tr>" +
            "".join("<th>" + escape(value) + "</th>" for value in headers) +
            "</tr></thead><tbody>" + "".join(rows) + "</tbody></table></div>" + source_table)
