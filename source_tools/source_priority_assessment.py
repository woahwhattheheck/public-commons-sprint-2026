"""Source-preserving FY26 NRCS and SCDES assessment crosswalk.

This module uses original publisher HUC identifiers. It requires no GIS package.
The output keeps each state-HUC designation and each assessment edition intact.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from html import escape
import csv
import io
import json
import re

SCHEMA = "upstate.source-priority-assessment-crosswalk/v2"


def _huc(value):
    if not isinstance(value, str) or not re.fullmatch(r"\d{12}", value):
        raise ValueError(f"Expected an original 12-character HUC identifier: {value!r}")
    return value


def _json(value):
    return (json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n").encode("utf-8")


def _csv(rows, fields):
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=fields, extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        writer.writerow({field: (
            "; ".join(str(v) for v in row[field]) if isinstance(row.get(field), list)
            else row.get(field, "")
        ) for field in fields})
    return output.getvalue().encode("utf-8-sig")


def build_priority_crosswalk(domain_hucs, nrcs_context, assessment_banks, focus=None):
    """Join complete retained input editions by exact publisher HUC12 values."""
    ordered = sorted(_huc(value) for value in domain_hucs)
    if len(ordered) != len(set(ordered)):
        raise ValueError("Selected domain contains duplicate HUC12 identifiers")
    if not ordered:
        raise ValueError("Select at least one original HUC identifier")
    selected = set(ordered)
    focus = focus or {}
    nrcs_by_huc = {}
    native_ids = set()
    for item in nrcs_context["hucs"]:
        hid = _huc(item["huc12"])
        if hid not in selected:
            continue
        if hid in nrcs_by_huc:
            raise ValueError(f"Duplicate NRCS HUC group: {hid}")
        rows = item["nrcs_state_rows"]
        for row in rows:
            if _huc(row["huc12_code"]) != hid:
                raise ValueError("NRCS row/group identifier disagreement")
            identity = row["OBJECTID"]
            if identity in native_ids:
                raise ValueError(f"Duplicate NRCS original OBJECTID: {identity}")
            native_ids.add(identity)
        nrcs_by_huc[hid] = rows
    if set(nrcs_by_huc) != selected:
        raise ValueError("NRCS context does not cover the complete selected domain")

    sources = []
    all_records = []
    source_coverage = []
    records_by_huc = defaultdict(list)
    seen_sources, seen_records = set(), set()
    for bank in assessment_banks:
        if bank.get("complete") is not True or bank.get("unparsed_rows"):
            raise ValueError("Crosswalk requires a complete normalized publisher edition")
        meta = bank["source"]
        source_key = (meta["source_id"], meta["source_sha256"])
        if source_key in seen_sources:
            raise ValueError("The same original assessment edition was selected twice")
        seen_sources.add(source_key)
        source_records = bank["records"]
        matched = []
        for record in source_records:
            hid = _huc(record["huc12"])
            key = (source_key, record["id"])
            if key in seen_records:
                raise ValueError(f"Duplicate assessment record identity: {record['id']}")
            seen_records.add(key)
            if hid in selected:
                matched.append(record)
                records_by_huc[hid].append(record)
                all_records.append(record)
        sources.append(meta)
        source_coverage.append({
            "source_id": meta["source_id"],
            "source_sha256": meta["source_sha256"],
            "source_vintage": meta["source_vintage"],
            "evidence_kind": meta["evidence_kind"],
            "publication_status": meta["publication_status"],
            "complete_source_records": len(source_records),
            "selected_domain_records": len(matched),
            "selected_domain_sites": len({r["site"] for r in matched}),
            "selected_domain_hucs": len({r["huc12"] for r in matched}),
            "source_assessment_rows": bank.get("source_assessment_row_count"),
            "source_notes": bank.get("source_notes", []),
        })

    rows = []
    for hid in ordered:
        nrcs_rows = nrcs_by_huc[hid]
        priority = [row for row in nrcs_rows if row["fy26_status"] == "High Priority Area"]
        records = records_by_huc[hid]
        listed = [r for r in records if r["evidence_kind"] == "303d_listing"]
        tmdl = [r for r in records if r["evidence_kind"] == "tmdl_attainment"]
        nonattaining = [r for r in tmdl if r["use_support"] == "not_supported"]
        fully_supported = [r for r in tmdl if r["use_support"] == "fully_supported"]
        names = sorted({r["huc12_name"] for r in nrcs_rows})
        editions = []
        for meta in sources:
            own = [r for r in records if (r["source_id"], r["source_sha256"]) ==
                   (meta["source_id"], meta["source_sha256"])]
            editions.append({
                "source_id": meta["source_id"], "source_vintage": meta["source_vintage"],
                "publication_status": meta["publication_status"], "evidence_kind": meta["evidence_kind"],
                "record_count": len(own), "site_count": len({r["site"] for r in own}),
                "sites": sorted({r["site"] for r in own}),
                "cause_counts": dict(sorted(Counter(r.get("cause_code") or r["cause_raw"] for r in own).items())),
                "cause_families": sorted({r["cause_family"] for r in own}),
                "use_support_counts": dict(sorted(Counter(r["use_support"] for r in own).items())),
                "assessment_ids": [r["id"] for r in own],
            })
        listed_sites = {r["site"] for r in listed}
        tmdl_sites = {r["site"] for r in tmdl}
        rows.append({
            "huc12": hid, "name": names[0] if len(names) == 1 else " / ".join(names),
            "publisher_names": names, "focus": focus.get(hid),
            "nrcs_state_rows": nrcs_rows,
            "nrcs_priority_state_rows": priority,
            "nrcs_priority_states": sorted({r["st_usps"] for r in priority}),
            "nrcs_priority_system_types": sorted({r["system_type"] for r in priority if r.get("system_type")}),
            "nrcs_priority_resource_concerns": sorted({r["resource_concern"] for r in priority if r.get("resource_concern")}),
            "assessment_record_count": len(records),
            "assessment_site_count": len({r["site"] for r in records}),
            "listed_303d_record_count": len(listed),
            "listed_303d_sites": sorted(listed_sites),
            "listed_303d_cause_counts": dict(sorted(Counter(r.get("cause_code") or r["cause_raw"] for r in listed).items())),
            "tmdl_record_count": len(tmdl),
            "tmdl_sites": sorted(tmdl_sites),
            "tmdl_not_supported_sites": sorted({r["site"] for r in nonattaining}),
            "tmdl_fully_supported_sites": sorted({r["site"] for r in fully_supported}),
            "sites_in_both_selected_editions": sorted(listed_sites & tmdl_sites),
            "source_editions": editions,
        })

    priority_rows = [r for r in rows if r["nrcs_priority_state_rows"]]
    nrcs_states = [state_row for row in rows for state_row in row["nrcs_state_rows"]]
    priorities = [state_row for row in priority_rows for state_row in row["nrcs_priority_state_rows"]]
    summary = {
        "domain_huc_count": len(rows),
        "nrcs_state_huc_rows": len(nrcs_states),
        "nrcs_priority_huc_count": len(priority_rows),
        "nrcs_priority_state_huc_rows": len(priorities),
        "nrcs_state_row_counts": dict(sorted(Counter(r["st_usps"] for r in nrcs_states).items())),
        "nrcs_priority_state_row_counts": dict(sorted(Counter(r["st_usps"] for r in priorities).items())),
        "assessment_records": len(all_records),
        "assessment_sites": len({r["site"] for r in all_records}),
        "hucs_with_assessments": sum(bool(r["assessment_record_count"]) for r in rows),
        "priority_hucs_with_303d_records": [r["huc12"] for r in priority_rows if r["listed_303d_record_count"]],
        "priority_hucs_with_tmdl_records": [r["huc12"] for r in priority_rows if r["tmdl_record_count"]],
        "priority_hucs_with_not_supported_tmdl_sites": [r["huc12"] for r in priority_rows if r["tmdl_not_supported_sites"]],
        "focus": [r for r in rows if r["focus"]],
        "source_coverage": source_coverage,
    }
    return {
        "schema": SCHEMA,
        "title": "Upper Savannah source-water priority and published water-quality context",
        "method": "Exact retained publisher HUC12 identifiers; complete selected domain; editions kept separate",
        "domain_huc12s": ordered,
        "source_reference": nrcs_context["source_reference"],
        "assessment_sources": sources,
        "interpretation": [
            "NRCS FY26 status describes source-water protection resource priorities for the stated system type and state portion.",
            "South Carolina 2024 impairment listings and the July 2026 TMDL status table retain their individual assessment editions and causes.",
            "Counts of assessment records, unique sites, unique HUCs and state-HUC designations use distinct denominators.",
            "A HUC with zero records has no matching record in the selected source editions; assessed condition follows the original site record.",
            "Publisher HUC membership supplies geographic context. Reach classification, intake geography and modelled export remain separate product layers.",
            "State acres describe a state portion. Whole-HUC acres repeat in multi-state rows and are retained without summing.",
        ],
        "summary": summary, "watersheds": rows, "records": all_records,
    }


def export_priority_crosswalk(result):
    """Return complete JSON, human-readable HTML and normalised CSV tables as bytes."""
    rows = result["watersheds"]
    summary = result["summary"]
    flat = [{
        "huc12": row["huc12"], "name": row["name"],
        "utility": (row["focus"] or {}).get("utility", ""),
        "nrcs_priority_states": row["nrcs_priority_states"],
        "nrcs_priority_system_types": row["nrcs_priority_system_types"],
        "nrcs_priority_resource_concerns": row["nrcs_priority_resource_concerns"],
        "nrcs_state_row_count": len(row["nrcs_state_rows"]),
        "listed_303d_record_count": row["listed_303d_record_count"],
        "listed_303d_sites": row["listed_303d_sites"],
        "listed_303d_cause_counts": json.dumps(row["listed_303d_cause_counts"], sort_keys=True),
        "tmdl_record_count": row["tmdl_record_count"],
        "tmdl_sites": row["tmdl_sites"],
        "tmdl_not_supported_sites": row["tmdl_not_supported_sites"],
        "tmdl_fully_supported_sites": row["tmdl_fully_supported_sites"],
        "sites_in_both_selected_editions": row["sites_in_both_selected_editions"],
    } for row in rows]
    state_rows = [dict(row) for watershed in rows for row in watershed["nrcs_state_rows"]]
    edition_rows = [{
        "huc12": row["huc12"], "name": row["name"],
        **{k: value for k, value in edition.items() if k != "cause_counts"},
        "cause_counts": json.dumps(edition["cause_counts"], sort_keys=True),
        "use_support_counts": json.dumps(edition["use_support_counts"], sort_keys=True),
    } for row in rows for edition in row["source_editions"]]

    def esc(value):
        return escape(str(value), quote=True)

    def table(selected_rows):
        output = ['<table><thead><tr><th>HUC12 / watershed</th><th>NRCS state / system</th>',
                  '<th>2024 listed sites / causes</th><th>July 2026 TMDL sites</th>',
                  '<th>TMDL sites not supporting use</th></tr></thead><tbody>']
        for row in selected_rows:
            priority = "; ".join(f'{r["st_usps"]}: {r["system_type"]} ({r["resource_concern"]})'
                                 for r in row["nrcs_priority_state_rows"]) or "Not selected"
            causes = "; ".join(f"{key}: {value}" for key, value in row["listed_303d_cause_counts"].items())
            output.append("<tr><td><code>" + esc(row["huc12"]) + "</code><br>" + esc(row["name"]) +
                          "</td><td>" + esc(priority) +
                          "</td><td>" + esc(len(row["listed_303d_sites"])) + " sites; " +
                          esc(row["listed_303d_record_count"]) + " cause records<br>" + esc(causes) +
                          "</td><td>" + esc(len(row["tmdl_sites"])) + " sites</td><td>" +
                          esc("; ".join(row["tmdl_not_supported_sites"]) or "0 matching sites") + "</td></tr>")
        return "".join(output) + "</tbody></table>"

    provenance = []
    for source in result["assessment_sources"]:
        uri = source["source_uri"]
        provenance.append("<li><a href='" + esc(uri) + "'>" + esc(source["source_id"]) +
                          "</a> — " + esc(source["source_vintage"]) + "; " +
                          esc(source["publication_status"]) + "<br><code>" +
                          esc(source["source_sha256"]) + "</code></li>")
    nrcs_source = result["source_reference"].get("nrcs", {})
    nrcs_uri = nrcs_source.get("uri", "")
    provenance.append("<li>NRCS FY26: <a href='" + esc(nrcs_uri) + "'>publisher service</a></li>")
    html = """<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Upper Savannah water-quality context</title><style>
body{font:15px/1.55 system-ui,sans-serif;color:#202020;background:#fff;max-width:1260px;margin:40px auto;padding:0 24px}
h1,h2{line-height:1.2}h2{margin-top:2em}table{border-collapse:collapse;width:100%;font-size:13px}
th,td{padding:10px;text-align:left;vertical-align:top;border:1px solid #c9c9c9}th{background:#eee}
code{font-size:12px;overflow-wrap:anywhere}a{color:inherit;text-decoration:underline}
.summary{border:1px solid #aaa;padding:16px}li{margin:.5em 0}@media print{body{margin:0;max-width:none}tr{break-inside:avoid}thead{display:table-header-group}}
</style><h1>Upper Savannah water-quality context</h1>"""
    html += "<p class='summary'>" + esc(summary["domain_huc_count"]) + " watersheds · " + \
        esc(summary["nrcs_state_huc_rows"]) + " NRCS state–watershed rows · " + \
        esc(summary["nrcs_priority_huc_count"]) + " priority watersheds · " + \
        esc(summary["nrcs_priority_state_huc_rows"]) + " priority state–watershed rows.</p>"
    html += "<h2>Four utility focus watersheds</h2>" + table([r for r in rows if r["focus"]])
    html += "<h2>All NRCS priority watersheds</h2>" + table([r for r in rows if r["nrcs_priority_state_rows"]])
    html += "<h2>Reading the crosswalk</h2><ul>" + "".join("<li>" + esc(v) + "</li>" for v in result["interpretation"]) + "</ul>"
    html += "<h2>Publisher editions and original files</h2><ul>" + "".join(provenance) + "</ul>"
    html += "<h2>Complete watershed comparison</h2>" + table(rows) + "</html>"
    return {
        "source-priority-assessment-domain217.json": _json(result),
        "source-priority-assessment-domain217.csv": _csv(flat, list(flat[0])),
        "nrcs-state-huc-domain217.csv": _csv(state_rows, list(state_rows[0])),
        "assessment-editions-domain217.csv": _csv(edition_rows, list(edition_rows[0])),
        "source-priority-assessment-domain217.html": html.encode("utf-8"),
        "source-priority-assessment-summary.json": _json(summary),
    }


def main(argv=None):
    import argparse
    import hashlib
    from pathlib import Path

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--domain-hucs", required=True, help="Retained JSON array of original HUC12 values")
    parser.add_argument("--nrcs-context", required=True, help="Complete publisher-bound NRCS context JSON")
    parser.add_argument("--assessment", action="append", required=True, help="Complete native normalized assessment JSON bank")
    parser.add_argument("--output", required=True)
    args = parser.parse_args(argv)
    from source_tools.water_quality_context import FOCUS
    domain_path, nrcs_path = Path(args.domain_hucs), Path(args.nrcs_context)
    domain = json.loads(domain_path.read_text())
    nrcs = json.loads(nrcs_path.read_text())
    banks = [json.loads(Path(name).read_text()) for name in args.assessment]
    result = build_priority_crosswalk(domain, nrcs, banks, FOCUS)
    result["selected_input_files"] = [
        {"filename": path.name, "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "bytes": path.stat().st_size}
        for path in [domain_path, nrcs_path, *map(Path, args.assessment)]
    ]
    files = export_priority_crosswalk(result)
    manifest = {"schema": "commons.artifacts/v1", "files": [
        {"path": name, "bytes": len(body), "sha256": hashlib.sha256(body).hexdigest()}
        for name, body in files.items()
    ]}
    files["source-priority-artifact-manifest.json"] = _json(manifest)
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    for name, body in files.items():
        path = output / name
        if path.exists() and path.read_bytes() != body:
            raise ValueError(f"Existing export differs; choose a new output directory: {path}")
    for name, body in files.items():
        (output / name).write_bytes(body)
    print(json.dumps({"output": str(output), "summary": result["summary"], "files": manifest["files"]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
