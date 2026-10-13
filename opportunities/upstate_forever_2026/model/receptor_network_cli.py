"""Receive original HUC12/ToHUC source data as an editable upstream inventory.

This entrypoint needs only Python's standard library and the retained graph
module. It accepts the original Upper Savannah domain ZIP, GZIP or Esri JSON.
"""
from __future__ import annotations

import argparse
import csv
import gzip
from html import escape
import io
import json
from pathlib import Path
import re
import sys
import zipfile

from .common import (atomic_bytes, atomic_json, describe_file, digest, file_digest,
                     held, now, read_json, verify_file)
from .receptor_network import upstream_memberships

SCHEMA = "upstate.receptor-network-product/v1"


def _read_source(path, member=None):
    path = Path(path).resolve(strict=True)
    input_sha256 = file_digest(path)
    selected_member = None
    if zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as archive:
            if member is None:
                candidates = [name for name in archive.namelist()
                              if Path(name).name in ("model-domain.esri.json.gz",
                                                     "model-domain.esri.json")]
                if len(candidates) != 1:
                    raise ValueError("Select the original domain JSON ZIP member with --member")
                selected_member = candidates[0]
            else:
                selected_member = member
            info = archive.getinfo(selected_member)
            if info.is_dir():
                raise ValueError("Select a regular original domain JSON member")
            retained = archive.read(info)
    else:
        if member is not None:
            raise ValueError("--member applies to a ZIP source")
        retained = path.read_bytes()
    decoded = gzip.decompress(retained) if retained[:2] == b"\x1f\x8b" else retained
    document = json.loads(decoded)
    if not isinstance(document, dict) or not isinstance(document.get("features"), list):
        raise ValueError("Select the retained original Esri feature JSON")
    fields = document.get("fields", [])
    oid_fields = [field["name"] for field in fields
                  if field.get("type") == "esriFieldTypeOID"]
    oid_field = document.get("objectIdFieldName")
    if not oid_field and len(oid_fields) == 1:
        oid_field = oid_fields[0]
    rows = []
    for index, feature in enumerate(document["features"]):
        properties = feature.get("attributes")
        if not isinstance(properties, dict):
            raise ValueError("Original Esri feature lacks its attribute record")
        native_id = properties.get(oid_field) if oid_field else None
        rows.append({"id": str(native_id if native_id is not None else index),
                     "properties": properties})
    if not rows:
        raise ValueError("Original domain contains no feature records")
    import hashlib
    binding = {
        "input_filename": path.name, "input_sha256": input_sha256,
        "zip_member": selected_member, "body_bytes": len(retained),
        "body_sha256": hashlib.sha256(retained).hexdigest(),
        "decoded_bytes": len(decoded),
        "decoded_sha256": hashlib.sha256(decoded).hexdigest(),
        "feature_count": len(rows), "feature_identity_field": oid_field,
        "spatial_reference": document.get("spatialReference"),
        "source_fields": fields,
    }
    return rows, binding, retained


def _csv(path, columns, rows):
    stream = io.StringIO(newline="")
    writer = csv.DictWriter(stream, fieldnames=columns, lineterminator="\n")
    writer.writeheader()
    for row in rows:
        writer.writerow({key: ("'" + value
                        if isinstance(value, str) and value.lstrip().startswith(("=", "+", "-", "@"))
                        else value)
                         for key in columns for value in (row.get(key),)})
    atomic_bytes(path, stream.getvalue().encode("utf-8"))


def _report(path, product, network, memberships):
    def text(value):
        return escape("" if value is None else str(value))

    def cells(values):
        return "".join("<td>" + text(value) + "</td>" for value in values)

    overview = ""
    for area in network["areas"]:
        shared = sum(key in network["shared_huc12s"] for key in area["huc12s"])
        overview += "<tr>" + cells((area["title"], area["role"].replace("_", " "),
            area["huc12_count"], shared, ", ".join(area["anchor_huc12s"]))) + "</tr>"
    detail = ""
    for row in memberships:
        detail += '<tr data-area="' + escape(row["receptor_id"], quote=True) + '">' + cells((
            row["receptor_title"], row["huc12"], row["name"],
            row["anchor_huc12"], row["links_to_anchor"], row["downstream_huc12"],
            row["tohuc_original"], row["hutype"])) + "</tr>"
    options = '<option value="">All areas</option>' + "".join(
        '<option value="' + escape(area["id"], quote=True) + '">' + text(area["title"]) + "</option>"
        for area in network["areas"])
    references = "".join("<li><strong>" + text(area["title"]) + "</strong>: "
        + text(area["reference"]["basis"]) + " "
        + ('<a href="' + escape(area["reference"]["uri"], quote=True) + '">Original selection source</a>'
           if re.match(r"^https?://", area["reference"]["uri"]) else text(area["reference"]["uri"]))
        + "</li>" for area in network["areas"])
    source = product["source_binding"]
    html = (
        '<!doctype html><html lang="en"><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        "<title>" + text(product["title"]) + "</title><style>"
        "body{font:15px system-ui,sans-serif;color:#222;background:#fff;max-width:1420px;margin:28px auto;padding:0 24px}"
        "h1{font-size:27px}h2{font-size:20px;margin-top:28px}p,li{line-height:1.5}"
        "a{color:inherit}section{overflow:auto}table{border-collapse:collapse;width:100%;margin:14px 0;font-variant-numeric:tabular-nums}"
        "th,td{border:1px solid #bbb;padding:8px;text-align:left;vertical-align:top}th{background:#eee}"
        ".filters{display:flex;gap:20px;flex-wrap:wrap}label{display:grid;gap:5px}"
        "select,input{font:inherit;border:1px solid #888;color:#222;background:#fff;padding:7px;max-width:420px}"
        "code{overflow-wrap:anywhere}tr[hidden]{display:none}footer{border-top:1px solid #999;margin-top:28px;padding-top:16px}"
        "@media print{body{font-size:9pt;margin:8mm;padding:0;max-width:none}th,td{padding:4px}tr{break-inside:avoid}.filters{display:none}}"
        "</style><body><h1>" + text(product["title"]) + "</h1>"
        "<p>" + str(network["network_huc12_count"]) + " original hydrologic units · "
        + str(network["selected_huc12_count"]) + " distinct contributing units · "
        + str(len(network["areas"])) + " selected receiving areas.</p>"
        "<p>The original downstream links identify contributing HUC12 units for each saved area. "
        "Each anchor and its upstream units appear once within that area's selection.</p>"
        '<p><a href="memberships.csv">Editable memberships</a> · <a href="areas.csv">Area selections</a> · '
        '<a href="network.csv">Original link table</a> · <a href="network.json">Complete network and selections</a> · '
        '<a href="source-profile.json">Saved source profile</a> · <a href="'
        + escape(product["source_body_filename"], quote=True) + '">Original source geometry and attributes</a></p>'
        "<section><h2>Selected areas</h2><table><thead><tr><th>Area</th><th>Purpose</th><th>Contributing units</th>"
        "<th>Shared with another area</th><th>Original anchors</th></tr></thead><tbody>"
        + overview + "</tbody></table></section>"
        '<h2>Upstream memberships</h2><div class="filters"><label>Receiving area<select id="area">'
        + options + '</select></label><label>Find a HUC12 or name<input id="search" type="search" placeholder="HUC12 or watershed name"></label></div>'
        '<p id="count"></p><section><table id="members"><thead><tr><th>Area</th><th>HUC12</th><th>Original name</th>'
        "<th>Selected anchor</th><th>Links to anchor</th><th>Next link toward anchor</th><th>Original ToHUC</th><th>Source unit type</th>"
        "</tr></thead><tbody>" + detail + "</tbody></table></section>"
        "<h2>Source relationships</h2><ul>" + references + "</ul>"
        "<p>Links to anchor counts original ToHUC edges. It is a network count, not a distance. "
        "The full HUC12 units supply the planning footprint. Original terminal labels, links outside the retained source, "
        "special hydrologic-unit types and shared memberships are available in network.json. "
        "Combine overlapping areas by their union when using the later GIS and physical-output inventory.</p>"
        "<footer><p>Captured source: " + text(source["input_filename"])
        + (" · member " + text(source["zip_member"]) if source["zip_member"] else "")
        + "<br>Original body SHA-256: <code>" + text(source["body_sha256"]) + "</code>"
        + "<br>Decoded source SHA-256: <code>" + text(source["decoded_sha256"]) + "</code>"
        + "<br>Saved " + text(product["created_at"]) + " · TokenJunkieLabs</p></footer>"
        '<script>const area=document.getElementById("area"),search=document.getElementById("search");'
        'const rows=[...document.querySelectorAll("#members tbody tr")];'
        'function apply(){let count=0;const q=search.value.trim().toLowerCase();for(const row of rows){'
        'row.hidden=(area.value&&row.dataset.area!==area.value)||(q&&!row.textContent.toLowerCase().includes(q));'
        'if(!row.hidden)count++;}document.getElementById("count").textContent=count+" memberships shown";}'
        'area.addEventListener("change",apply);search.addEventListener("input",apply);apply();</script></body></html>\n'
    )
    atomic_bytes(path, html.encode("utf-8"))


def build(source, receptor_spec, output, *, member=None, expected_decoded_sha256=None):
    """Retain original bytes, original links and all selected upstream memberships."""
    rows, binding, retained = _read_source(source, member)
    if expected_decoded_sha256 is not None:
        if not re.fullmatch(r"[0-9a-f]{64}", expected_decoded_sha256):
            raise ValueError("Use the complete original decoded source SHA-256")
        if binding["decoded_sha256"] != expected_decoded_sha256:
            raise ValueError("The selected source body differs from the retained decoded source")
    spec = json.loads(json.dumps(receptor_spec, ensure_ascii=False, allow_nan=False))
    identity = {"schema": SCHEMA, "source_body_sha256": binding["body_sha256"],
                "receptor_spec": spec}
    key = digest(identity)
    directory = Path(output).resolve() / key
    directory.mkdir(parents=True, exist_ok=True)
    with held(directory / ".network.lock", blocking=False):
        result_path = directory / "result.json"
        if result_path.exists():
            result = read_json(result_path)
            if result["id"] != key or result["schema"] != SCHEMA:
                raise ValueError("Retained network product belongs to another source selection")
            for item in result["files"].values():
                verify_file(directory, item)
            return {**result, "directory": str(directory), "reused": True}
        network = upstream_memberships(rows, spec["receptors"],
            huc12_field=spec.get("huc12_field"), tohuc_field=spec.get("tohuc_field"),
            name_field=spec.get("name_field"), type_field=spec.get("type_field"))
        network["source_binding"] = binding
        source_name = "source-domain.esri.json.gz" if retained[:2] == b"\x1f\x8b" else "source-domain.esri.json"
        atomic_bytes(directory / source_name, retained, immutable=True)
        atomic_json(directory / "source-profile.json", spec, immutable=True)
        atomic_json(directory / "network.json", network, immutable=True)
        original = {row["huc12"]: row for row in network["network"]}
        memberships = []
        for area in network["areas"]:
            for row in area["memberships"]:
                source_row = original[row["huc12"]]
                memberships.append({"receptor_id": area["id"], "receptor_title": area["title"],
                    **row, **{field: source_row[field] for field in
                              ("name", "tohuc_original", "hutype", "source_feature_id")}})
        _csv(directory / "memberships.csv",
             ("receptor_id", "receptor_title", "huc12", "name", "anchor_huc12",
              "links_to_anchor", "downstream_huc12", "is_anchor", "tohuc_original",
              "hutype", "source_feature_id"), memberships)
        _csv(directory / "areas.csv",
             ("id", "title", "role", "huc12_count", "anchor_huc12s", "huc12s"),
             [{**area, "anchor_huc12s": ";".join(area["anchor_huc12s"]),
               "huc12s": ";".join(area["huc12s"])} for area in network["areas"]])
        _csv(directory / "network.csv",
             ("huc12", "source_feature_id", "tohuc_original", "tohuc12", "name", "hutype"),
             network["network"])
        result = {"schema": SCHEMA, "id": key, "title": spec.get("title", "Upstream watershed memberships"),
            "created_at": now(), "source_binding": binding, "source_body_filename": source_name,
            "identity": identity, "network_huc12_count": network["network_huc12_count"],
            "selected_huc12_count": network["selected_huc12_count"],
            "areas": [{k: v for k, v in area.items() if k != "memberships"} for area in network["areas"]],
            "shared_huc12s": network["shared_huc12s"], "membership_rows": len(memberships), "files": {}}
        _report(directory / "index.html", result, network, memberships)
        for name, filename in (("source_body", source_name), ("profile", "source-profile.json"),
                               ("network", "network.json"), ("memberships", "memberships.csv"),
                               ("areas", "areas.csv"), ("original_links", "network.csv"),
                               ("report", "index.html")):
            result["files"][name] = describe_file(directory, directory / filename)
        atomic_json(result_path, result, immutable=True)
        return {**result, "directory": str(directory), "reused": False}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, help="Retained domain ZIP, GZIP or original Esri JSON")
    parser.add_argument("--profile", required=True, help="Original receptor specification JSON")
    parser.add_argument("--output", required=True, help="Directory receiving the complete retained source inventory")
    parser.add_argument("--member", help="Exact domain JSON ZIP member if the archive contains multiple domains")
    parser.add_argument("--expected-decoded-sha256", help="Optional original decoded source identity")
    args = parser.parse_args(argv)
    try:
        result = build(args.source, read_json(Path(args.profile)), args.output,
                       member=args.member, expected_decoded_sha256=args.expected_decoded_sha256)
        print(json.dumps({key: result[key] for key in
            ("id", "title", "directory", "network_huc12_count", "selected_huc12_count",
             "membership_rows", "areas", "shared_huc12s", "files", "reused")},
            ensure_ascii=False, allow_nan=False))
        return 0
    except Exception as error:
        print(json.dumps({"error": type(error).__name__, "message": str(error)}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
