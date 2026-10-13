"""Prepare source-bound assessment geographic context from a saved station study.

Published watershed labels and computed point/polygon memberships remain distinct.
This derived context describes where selected assessment records are associated.
"""
from __future__ import annotations
import argparse
from collections import Counter
import csv
import html
import io
import json
import os
from pathlib import Path
import shutil
import stat
import tempfile
import zipfile
from .common import (atomic_bytes, atomic_json, canonical, describe_file, digest,
                     file_digest, held, identifier, now, read_json, relative_file, verify_file)
from . import station_geography as geography

VERSION = "1.1.0"
KIND = "assessment-contexts"
SCHEMA = "upstate.assessment-geographic-context/v1"
PACKAGE = "upstate.assessment-context-package/v1"
SOURCE_ID = "assessment-geographic-context"
PARCEL_KIND = "assessment-parcel-contexts"
KNOWN_ASSESSMENT_SHA = "545a4e1413012b8f17c81c8afe815dd1e225ade5f5b9792ca22e83ef8723307f"
KNOWN_ASSESSMENT = {"title":"South Carolina 2026 draft integrated assessment",
                    "status":"draft","vintage":"2026",
                    "reference":"https://apps.des.sc.gov/PublicNotices/SearchAndDisplay/PDF/302110"}
RELATION = ("Geographic context of selected original assessment records. Polygon association "
            "does not designate every location in the polygon as impaired or establish "
            "hydrologic contribution from an intersecting parcel.")

def _copy(value):
    return json.loads(canonical(value))

def _text(value, label):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(label + " must be a nonempty string")
    return value.strip()

def _key(reference):
    return (reference.get("collection_id"), reference.get("source_id"))

def _source_ref(value):
    if not isinstance(value, dict):
        raise ValueError("Select a retained source reference")
    return {"collection_id": identifier(value.get("collection_id")),
            "source_id": _text(value.get("source_id"), "Original source ID")}

def _field(value):
    return "" if value is None else str(value)

def _table_record(study, selection):
    table = _source_ref(selection["table"])
    permitted = {_key(row) for row in study["selection"].get("site_tables", [])}
    if _key(table) not in permitted:
        raise ValueError("Select an original station inventory retained by this geography edition")
    matches = [row for row in study["sources"] if _key(row) == _key(table)]
    if len(matches) != 1:
        raise ValueError("The original assessment source binding is absent or ambiguous")
    return table, matches[0]

def _rows(study, table):
    records = {}
    for station in study["result"]["stations"]:
        for ref in station.get("source_references", []):
            if _key(ref) != _key(table):
                continue
            if not isinstance(ref.get("original"), dict) or type(ref.get("row_number")) is not int:
                raise ValueError("Original assessment rows need their retained row numbers and fields")
            identity = (_key(ref), ref["row_number"])
            linked=[item for item in station.get("assessment_records",[])
                    if _key(item.get("inventory_source_ref",{}))==_key(ref)
                    and item.get("inventory_source_ref",{}).get("row_number")==ref["row_number"]]
            native={key:linked[0].get(key) for key in
                    ("assessment_record_id","source_id","source_sha256","source_vintage",
                     "publication_status","evidence_kind","source_uri")} if len(linked)==1 else {}
            row = {"station_id": station["station_id"], "row_number": ref["row_number"],
                   "original": _copy(ref["original"]), "native_assessment":native, "source_ref": {k:v for k,v in ref.items() if k != "original"},
                   "location_status": station["status"], "watershed_status": station["watershed_status"],
                   "computed_memberships": _copy(station.get("watersheds", []))}
            if identity in records and canonical(records[identity]) != canonical(row):
                raise ValueError("An assessment row is assigned to more than one study station")
            records[identity] = row
    return sorted(records.values(), key=lambda row: row["row_number"])


def _row_id(row):
    """Stable original record identity across destination Workspace rebinding."""
    reference = row["source_ref"]
    checksum = identifier(reference.get("source_sha256"))
    return digest({"source_sha256":checksum,
                   "row_number":row["row_number"],
                   "record_pointer":reference.get("record_pointer") or reference.get("original_record_pointer")})

def _source_assessment(binding):
    if binding["source_sha256"] == KNOWN_ASSESSMENT_SHA:
        return _copy(KNOWN_ASSESSMENT), list(KNOWN_ASSESSMENT)
    source = binding["source_metadata"]
    metadata = source.get("metadata") or {}
    values = {"title":binding.get("title") or "",
              "status":source.get("publication_status") or metadata.get("assessment_status") or "",
              "vintage":source.get("vintage") or "",
              "reference":binding.get("uri") or ""}
    return values, [name for name,value in values.items() if value]

def _summary_assessment(inventories):
    values = {}
    for name in ("title","status","vintage","reference"):
        original = list(dict.fromkeys(item["assessment"][name] for item in inventories))
        values[name] = original[0] if len(original)==1 else " | ".join(original)
    return values

def _normalize_inventory(study, value):
    table, binding = _table_record(study, value)
    fields = value.get("fields")
    allowed = {"watershed","cause","use","county","support","assessment_edition","assessment_title",
               "assessment_status","assessment_vintage","assessment_reference"}
    if not isinstance(fields,dict) or not {"watershed","cause","use"} <= set(fields):
        raise ValueError("Select each inventory's original watershed, cause and use fields")
    if set(fields)-allowed:
        raise ValueError("Unknown original assessment field binding")
    fields = {key:_text(value,"Original "+key+" field") for key,value in fields.items()}
    available = {name for row in _rows(study,table) for name in row["original"]}
    if set(fields.values())-available:
        raise ValueError("A selected field is absent from this original assessment inventory")
    assessment = value.get("assessment") or {}
    if not isinstance(assessment,dict):
        raise ValueError("Retain the original source assessment metadata")
    defaults, locked = _source_assessment(binding)
    assessment = {name:_text(defaults[name] if name in locked else assessment.get(name),
                            "Assessment "+name) for name in ("title","status","vintage","reference")}
    return {"table":table,"fields":fields,"assessment":assessment,
            "table_source_sha256":binding["source_sha256"]}, binding

def _selected_rows(study, selection, bindings):
    records = {}
    for inventory,binding in zip(selection["inventories"],bindings):
        fields = inventory["fields"]
        for row in _rows(study,inventory["table"]):
            original = row["original"]
            required = [fields[name] for name in ("watershed","cause","use")]
            if any(name not in original for name in required):
                raise ValueError("A required original field is absent from the selected inventory row")
            def value(name):
                return original.get(fields[name]) if name in fields else None
            native = row["native_assessment"]
            assessment = {}
            native_names = {"status":"publication_status","vintage":"source_vintage","reference":"source_uri"}
            for name in ("title","status","vintage","reference"):
                selected = native.get(native_names.get(name,"assessment_title"))
                if selected is None or _field(selected).strip()=="":
                    selected = value("assessment_"+name)
                assessment[name] = selected if selected is not None and _field(selected).strip() else inventory["assessment"][name]
            if binding["source_sha256"] == KNOWN_ASSESSMENT_SHA:
                assessment = _copy(KNOWN_ASSESSMENT)
            edition = (value("assessment_edition") if binding["source_sha256"]==KNOWN_ASSESSMENT_SHA
                       else native.get("source_vintage") or value("assessment_edition"))
            if edition is None or _field(edition).strip()=="":
                edition = assessment["vintage"]
            item = {**row,"assessment_row_id":_row_id(row),
                    "original_watershed_value":value("watershed"),
                    "cause":value("cause"),"impaired_use":value("use"),
                    "county":value("county"),"use_support":value("support"),
                    "assessment":assessment,"assessment_edition":edition,
                    "original_edition_source":{name:original.get(name,native.get(name)) for name in
                        ("source_id","source_sha256","evidence_kind","assessment_period","status_date")},
                    "assessment_record_id":original.get("id",native.get("assessment_record_id"))}
            identity = item["assessment_row_id"]
            if identity in records:
                # Duplicate references to identical original bytes are one record.
                left = {k:v for k,v in records[identity].items() if k!="source_ref"}
                right = {k:v for k,v in item.items() if k!="source_ref"}
                if canonical(left)!=canonical(right):
                    raise ValueError("One original assessment record has conflicting inventory bindings")
            else:
                records[identity] = item
    rows = list(records.values())
    axes = {"causes":"cause","uses":"impaired_use","counties":"county",
            "editions":"assessment_edition","supports":"use_support"}
    for category,field in axes.items():
        wanted = selection["filters"].get(category,[])
        if set(wanted)-{_field(row[field]) for row in rows}:
            raise ValueError("A filter value is absent from the selected original "+category)
    rows = [row for row in rows if all(not selection["filters"].get(category) or
            _field(row[field]) in selection["filters"][category] for category,field in axes.items())]
    if not rows:
        raise ValueError("The selected original assessment filters contain no study rows")
    return rows


def options(workspace, geography_id, table=None):
    study = geography.inspect(workspace, geography_id, include_result=True)
    tables = []
    for reference in study["selection"].get("site_tables", []):
        binding = next(row for row in study["sources"] if _key(row) == _key(reference))
        records = _rows(study, reference)
        fields = sorted({key for row in records for key in row["original"]})
        values = {key: sorted({_field(row["original"].get(key)) for row in records}) for key in fields}
        aliases={"watershed":("publisher_huc12","huc12"),"cause":("cause_code","cause_raw","cause"),
                 "use":("use","impaired_use"),"county":("county",),"support":("use_support",),
                 "assessment_edition":("assessment_edition","source_vintage"),
                 "assessment_title":("assessment_title",),
                 "assessment_status":("assessment_status","publication_status"),
                 "assessment_vintage":("assessment_vintage","source_vintage"),
                 "assessment_reference":("assessment_reference","source_uri")}
        defaults={key:next(name for name in names if name in fields)
                  for key,names in aliases.items() if any(name in fields for name in names)}
        cause_candidates=[name for name in aliases["cause"] if name in fields]
        if cause_candidates:
            # Some original editions omit cause_code while retaining cause_raw.
            # Choose the most complete original column; keep alias order on ties.
            defaults["cause"]=max(cause_candidates,key=lambda name:sum(
                bool(_field(row["original"].get(name)).strip()) for row in records))
        assessment_defaults, locked_fields = _source_assessment(binding)
        tables.append({"reference": _source_ref(reference), "title": binding.get("title"),
                       "uri": binding.get("uri"), "vintage": binding["source_metadata"].get("vintage"),
                       "source_sha256": binding["source_sha256"], "row_count": len(records),
                       "assessment_locked":binding["source_sha256"]==KNOWN_ASSESSMENT_SHA,
                       "assessment_defaults": assessment_defaults,
                       "assessment_locked_fields": locked_fields,
                       "fields": fields, "values": values, "default_fields": defaults})
    watersheds = []
    for reference in study["selection"].get("watersheds", []):
        binding = next(row for row in study["sources"] if _key(row) == _key(reference))
        watersheds.append({"reference": _source_ref(reference), "title": binding.get("title"),
                           "source_sha256": binding["source_sha256"],
                           "id_field": reference.get("id_field")})
    return {"geography_id": study["id"], "title": study["title"], "tables": tables,
            "watershed_sources": watersheds}

def catalog(workspace):
    from . import conservation
    return {"version": VERSION, "geographies": [
        {key:row.get(key) for key in ("id","title","summary","created_at")}
        for row in workspace._list(geography.KIND)],
        "editions": [{key:row.get(key) for key in ("id","title","summary","created_at","selection")}
                     for row in workspace._list(KIND)],
        "parcel_editions": [{key:row.get(key) for key in ("id","title","summary","context_id","study_id","created_at")}
                            for row in workspace._list(PARCEL_KIND)],
        "parcel_studies": [row for row in conservation.overview(workspace)["studies"]
                          if row.get("unit_type") == "parcel"]}

def _selection(study, value):
    if not isinstance(value,dict):
        raise ValueError("Choose a complete assessment context selection")
    result = _copy(value)
    result["station_geography_id"] = study["id"]
    result["title"] = _text(result.get("title"),"Context title")
    requested = result.get("inventories")
    if requested is None:
        requested = [{key:result.get(key) for key in ("table","fields","assessment")}]
    if not isinstance(requested,list) or not requested:
        raise ValueError("Select one or more retained original assessment inventories")
    inventories, bindings, seen = [], [], set()
    for item in requested:
        if not isinstance(item,dict):
            raise ValueError("Each selected inventory needs its source, fields and assessment metadata")
        inventory,binding = _normalize_inventory(study,item)
        identity = _key(inventory["table"])
        if identity in seen:
            raise ValueError("Select each retained assessment inventory once")
        seen.add(identity); inventories.append(inventory); bindings.append(binding)
    result["inventories"] = inventories
    # The full edition metadata remains on each inventory and each result row.
    result["assessment"] = _summary_assessment(inventories)
    for name in ("table","fields","table_source_sha256"):
        result.pop(name,None)
    if len(inventories)==1:
        result.update({name:_copy(inventories[0][name]) for name in ("table","fields","table_source_sha256")})
    result["watershed_source"] = _source_ref(result["watershed_source"])
    if _key(result["watershed_source"]) not in {_key(row) for row in study["selection"].get("watersheds",[])}:
        raise ValueError("Select a watershed source retained by this study")
    basis = result.get("relationship_basis","published_watershed")
    if basis not in ("published_watershed","station_membership"):
        raise ValueError("Choose published_watershed or station_membership")
    result["relationship_basis"] = basis
    filters = result.get("filters") or {}
    if not isinstance(filters,dict) or set(filters)-{"causes","uses","counties","editions","supports"}:
        raise ValueError("Choose exact original cause, use, county, edition and support filters")
    for name,values in filters.items():
        if not isinstance(values,list) or any(not isinstance(item,str) for item in values):
            raise ValueError("Assessment filters must list exact original text values")
        filters[name] = sorted(set(values))
    result["filters"] = filters
    return result,bindings

def _csv(rows, columns):
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=columns, lineterminator="\n", extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        rendered = {}
        for key in columns:
            value = row.get(key)
            if isinstance(value,(list,dict)):
                value = json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False)
            if isinstance(value,str) and value.startswith(("=","+","-","@","\t","\r")):
                value = "'" + value
            rendered[key] = value
        writer.writerow(rendered)
    return output.getvalue().encode("utf-8")


def _assessment_groups(rows):
    groups={}
    for row in rows:
        identity={"assessment":row["assessment"],"edition":row["assessment_edition"],
                  "cause":row["cause"],"impaired_use":row["impaired_use"],
                  "original_edition_source":row["original_edition_source"],"use_support":row.get("use_support")}
        key=digest(identity)
        group=groups.setdefault(key,{"id":key,**_copy(identity),"station_ids":set(),"row_numbers":[],"row_ids":[]})
        group["station_ids"].add(row["station_id"]);group["row_numbers"].append(row["row_number"])
        group["row_ids"].append(row.get("assessment_row_id") or _row_id(row))
    return [{**value,"station_ids":sorted(value["station_ids"]),"row_numbers":sorted(value["row_numbers"]),"row_ids":sorted(value["row_ids"]),
             "station_count":len(value["station_ids"]),"assessment_row_count":len(value["row_numbers"])}
            for key,value in sorted(groups.items())]

def _source_references(result):
    references = []
    for group in result.get("assessment_groups", []):
        reference = group.get("assessment", {}).get("reference")
        if isinstance(reference, str) and reference.strip() and reference not in references:
            references.append(reference)
    if not references and result.get("assessment", {}).get("reference"):
        references.append(result["assessment"]["reference"])
    return references

def _report(result):
    esc = lambda value: html.escape(str(value), quote=True)
    source_links = []
    for reference in _source_references(result):
        if reference.lower().startswith(("https://", "http://")) and not any(
                character.isspace() or character == "|" for character in reference):
            source_links.append('<a href="' + esc(reference) +
                                '" target="_blank" rel="noopener noreferrer">' + esc(reference) + '</a>')
        else:
            source_links.append(esc(reference))
    rows = "".join("<tr>" + "".join("<td>" + esc(row.get(key,"")) + "</td>" for key in
                  ("watershed_id","station_count","assessment_row_count","causes","uses")) + "</tr>"
                  for row in result["watersheds"])
    groups = "".join("<tr>"+"".join("<td>"+esc(value)+"</td>" for value in
              (row["edition"],row["assessment"]["title"],row["assessment"]["status"],
               row["assessment"]["vintage"],row["cause"],row["impaired_use"],row.get("use_support"),row["assessment_row_count"]))+
              "</tr>" for row in result["assessment_groups"])
    issues = "".join("<li>" + esc(row["station_id"]) + " / original row " +
                     str(row["row_number"]) + ": " + esc(row["geographic_status"]) + "</li>"
                     for row in result["rows"] if row["geographic_status"] != "matched")
    return ("<!doctype html><html lang=en><meta charset=utf-8><meta name=viewport "
            "content='width=device-width,initial-scale=1'><title>" + esc(result["title"]) +
            "</title><style>body{font:15px system-ui;color:#222;background:#fff;max-width:1300px;"
            "margin:2rem}table{border-collapse:collapse;width:100%}td,th{padding:.6rem;border:1px solid #bbb;"
            "text-align:left;overflow-wrap:anywhere}th{background:#eee}p{line-height:1.5}</style><h1>" +
            esc(result["title"]) + "</h1><p>" + esc(result["assessment"]["title"]) + " · " +
            esc(result["assessment"]["status"]) + " · " + esc(result["assessment"]["vintage"]) +
            "</p><p>" + esc(RELATION) + "</p><p>Association basis: " +
            esc(result["relationship_basis"]) + ". Absence is unknown under this selected station inventory.</p>" +
            "<p>Original sources: " + " · ".join(source_links) +
            "</p><h2>Selected watershed context</h2><table><thead><tr><th>Original watershed ID</th>"
            "<th>Distinct stations</th><th>Assessment rows</th><th>Original causes</th><th>Original uses</th>"
            "</tr></thead><tbody>" + rows + "</tbody></table><h2>Unresolved or multiple associations</h2><ul>" +
            issues + "</ul><h2>Original assessment editions and cause/use groups</h2><table><tr>"
            "<th>Edition</th><th>Title</th><th>Status</th><th>Vintage</th><th>Cause</th><th>Use</th><th>Original support</th><th>Rows</th>"
            "</tr>"+groups+"</table><p>Complete original rows, both association methods and source identities accompany "
            "this report in JSON and CSV.</p></html>").encode("utf-8")

def _context_binding(collection_id, selection):
    assessment = selection["assessment"]
    filters = selection["filters"]
    reference = (assessment["title"] + "; status " + assessment["status"] + "; vintage " +
                 assessment["vintage"] + "; " + assessment["reference"] + "; exact original filters " +
                 json.dumps(filters, sort_keys=True, ensure_ascii=False))
    return {"source_collection_id": collection_id, "source_id": SOURCE_ID, "id_field":"context_id",
            "reference": reference, "relation": RELATION + " Basis: " + selection["relationship_basis"],
            "meaning":"Selected assessment geographic association; unlisted geographic areas remain unknown."}

def build(workspace, value):
    study = geography.inspect(workspace, identifier(value.get("station_geography_id")),
                              verify=True, include_result=True)
    selection, bindings = _selection(study, value)
    rows = _selected_rows(study,selection,bindings)
    polygons = [feature for feature in study["watershed_geojson"]["features"]
                if _key(feature["properties"]["source_ref"]) == _key(selection["watershed_source"])]
    if not polygons:
        raise ValueError("The selected retained watershed source contains no study polygons")
    by_published = {}
    for feature in polygons:
        native = feature["properties"]["watershed_id"]
        by_published.setdefault(_field(native), []).append(feature)
    associations, selected_rows = {}, []
    for row in rows:
        original_id = _field(row["original_watershed_value"])
        memberships = [m for m in row["computed_memberships"]
                       if _key(m["source_ref"]) == _key(selection["watershed_source"])]
        published = by_published.get(original_id, []) if original_id else []
        computed_ids = {digest(m["source_ref"]) for m in memberships}
        computed = [feature for feature in polygons if feature["id"] in computed_ids]
        chosen = published if selection["relationship_basis"] == "published_watershed" else computed
        item = {**row,
                "published_polygon_ids":[feature["id"] for feature in published],
                "computed_polygon_ids":[feature["id"] for feature in computed],
                "selected_polygon_ids":[feature["id"] for feature in chosen],
                "geographic_status":"unmatched" if not chosen else "multiple" if len(chosen)>1 else "matched",
                "association_agreement":(set(f["id"] for f in published) == set(computed_ids)) if published and computed else None,
                "association_status":("both_resolved_agree" if set(f["id"] for f in published)==set(computed_ids)
                                      else "both_resolved_differ") if published and computed else
                                     "published_only" if published else "computed_only" if computed else "neither_resolved",
                "computed_boundary_or_overlap":row["watershed_status"] in ("boundary","overlap")}
        selected_rows.append(item)
        for feature in chosen:
            associations.setdefault(feature["id"], []).append(item)
    features, summaries = [], []
    for feature in polygons:
        members = associations.get(feature["id"], [])
        if not members:
            continue
        native = feature["properties"]
        summary = {"context_id":feature["id"], "watershed_id":native["watershed_id"],
                   "station_count":len({row["station_id"] for row in members}),
                   "assessment_row_count":len(members),
                   "causes":sorted({_field(row["cause"]) for row in members}),
                   "uses":sorted({_field(row["impaired_use"]) for row in members}),
                   "station_ids":sorted({row["station_id"] for row in members}),
                   "source_ref":native["source_ref"],
                   "assessment_row_numbers":sorted({row["row_number"] for row in members}),
                   "assessment_row_ids":sorted({row["assessment_row_id"] for row in members}),
                   "assessment_groups":_assessment_groups(members)}
        summaries.append(summary)
        properties = {key:summary[key] for key in
                      ("context_id","watershed_id","station_count","assessment_row_count")}
        properties.update(inventory_title=selection["assessment"]["title"],
            assessment_groups_json=json.dumps(summary["assessment_groups"],ensure_ascii=False,sort_keys=True),
            inventory_status=selection["assessment"]["status"],
            inventory_vintage=selection["assessment"]["vintage"],
            relationship_basis=selection["relationship_basis"], relation=RELATION,
            causes_json=json.dumps(summary["causes"],ensure_ascii=False),
            uses_json=json.dumps(summary["uses"],ensure_ascii=False),
            station_ids_json=json.dumps(summary["station_ids"],ensure_ascii=False),
            original_polygon_reference_json=json.dumps(native["source_ref"],sort_keys=True))
        features.append({"type":"Feature","id":feature["id"],"geometry":feature["geometry"],
                         "properties":properties})
    if not features:
        raise ValueError("No selected assessment association matches the retained polygon source")
    build_id = digest({"version":VERSION,"selection":selection,"geography_build_id":study["build_id"]})
    destination = workspace.root / "assessment-context" / build_id
    destination.mkdir(parents=True, exist_ok=True)
    with held(destination / ".build.lock"):
        saved_path = destination / "edition.json"
        if saved_path.exists():
            return inspect(workspace, read_json(saved_path)["id"], verify=True)
        start = destination / "started.json"
        if not start.exists():
            atomic_json(start,{"created_at":now(),"build_id":build_id},immutable=True)
        created = read_json(start)["created_at"]
        summary = {"inventory_count":len(selection["inventories"]),
                   "assessment_row_count":len(selected_rows),
                   "station_count":len({row["station_id"] for row in selected_rows}),
                   "watershed_count":len(features),
                   "unmatched_row_count":sum(row["geographic_status"]=="unmatched" for row in selected_rows),
                   "multiple_association_row_count":sum(row["geographic_status"]=="multiple" for row in selected_rows),
                   "differing_association_row_count":sum(row["association_agreement"] is False for row in selected_rows),
                   "unresolved_comparison_row_count":sum(row["association_agreement"] is None for row in selected_rows)}
        result = {"schema":SCHEMA,"version":VERSION,"title":selection["title"],"created_at":created,
                  "build_id":build_id,"selection":selection,"assessment":selection["assessment"],
                  "relationship_basis":selection["relationship_basis"],"relation":RELATION,
                  "coverage":{"negative_association":"unknown","basis":"Selected station assessment inventory",
                              "selected_source_polygon_count":len(polygons)},
                  "summary":summary,"rows":selected_rows,"watersheds":summaries,
                  "assessment_groups":_assessment_groups(selected_rows),
                  "original_geography_id":study["id"],"original_geography_build_id":study["build_id"],
                  "assessment_source":bindings[0] if len(bindings)==1 else None,
                  "assessment_sources":bindings}
        atomic_json(destination/"selection.json",selection,immutable=True)
        atomic_json(destination/"context.json",result,immutable=True)
        atomic_json(destination/"context.geojson",{"type":"FeatureCollection","features":features},immutable=True)
        atomic_bytes(destination/"assessment-rows.csv",_csv(selected_rows,[
            "station_id","row_number","assessment_row_id","cause","impaired_use","county","use_support","original_watershed_value",
            "location_status","watershed_status","geographic_status","association_agreement","association_status",
            "computed_boundary_or_overlap","published_polygon_ids","computed_polygon_ids",
            "selected_polygon_ids","computed_memberships","assessment","assessment_edition","assessment_record_id",
            "original_edition_source","native_assessment","source_ref","original"]),immutable=True)
        atomic_bytes(destination/"watershed-context.csv",_csv(summaries,[
            "context_id","watershed_id","station_count","assessment_row_count","causes","uses",
            "station_ids","assessment_row_numbers","assessment_row_ids","assessment_groups","source_ref"]),immutable=True)
        atomic_bytes(destination/"OPEN_ASSESSMENT_CONTEXT.html",_report(result),immutable=True)
        original_archive = next(item for item in study["files"]
                                if Path(item["path"]).name=="station-geography.zip")
        original = verify_file(workspace.root,original_archive)
        archive_copy = destination/"original-station-geography.zip"
        if not archive_copy.exists():
            pending = archive_copy.with_suffix(".pending")
            shutil.copyfile(original,pending)
            if file_digest(pending)!=original_archive["sha256"]:
                raise ValueError("Original station geography changed during context packaging")
            os.replace(pending,archive_copy)
        elif file_digest(archive_copy)!=original_archive["sha256"]:
            raise ValueError("Retained original station geography archive changed")
        companion_names = ["selection.json","context.json","assessment-rows.csv",
                           "watershed-context.csv","OPEN_ASSESSMENT_CONTEXT.html","original-station-geography.zip"]
        original_references = _source_references(result)
        derived_uri = (original_references[0] if len(original_references) == 1 else
                       "urn:upstate:assessment-context:" + build_id)
        entry = {"id":SOURCE_ID,"title":selection["title"],"kind":"vector",
                 "role":"ASSESSMENT_GEOGRAPHIC_CONTEXT","uri":derived_uri,
                 "vintage":selection["assessment"]["vintage"]+" ("+selection["assessment"]["status"]+")",
                 "path":"context.geojson","sha256":file_digest(destination/"context.geojson"),
                 "id_field":"context_id","source_crs":"EPSG:4326",
                 "metadata":{"assessment":selection["assessment"],"relation":RELATION,
                             "original_source_references":original_references,
                             "negative_coverage":"unknown","original_station_geography":study["id"],
                             "geographic_context":{key:value for key,value in _context_binding("",selection).items()
                                               if key in ("reference","relation","meaning")}},
                 "companions":[{"path":name,"sha256":file_digest(destination/name)} for name in companion_names]}
        manifest = {"schema":"upstate.sources/v1","title":selection["title"],"captured_at":created,
                    "entries":[entry],"notes":[RELATION]}
        atomic_json(destination/"sources.json",manifest,immutable=True)
        imported = workspace.import_sources(destination/"sources.json")
        context_binding = _context_binding(imported["id"],selection)
        atomic_json(destination/"geographic-context-binding.json",context_binding,immutable=True)
        exported_names = ["started.json","selection.json","context.json","context.geojson",
                          "assessment-rows.csv","watershed-context.csv","OPEN_ASSESSMENT_CONTEXT.html",
                          "original-station-geography.zip","sources.json","geographic-context-binding.json"]
        inventory = [describe_file(destination,destination/name) for name in exported_names]
        package = {"schema":PACKAGE,"version":VERSION,"selection":selection,
                   "table_sources":[{"reference":item["table"],"sha256":binding["source_sha256"]}
                                    for item,binding in zip(selection["inventories"],bindings)],
                   "watershed_source_sha256":next(s["source_sha256"] for s in study["sources"]
                      if _key(s)==_key(selection["watershed_source"])),
                   "files":inventory}
        atomic_json(destination/"package.json",package,immutable=True)
        archive_path = destination/"assessment-context.zip"
        pending = destination/"assessment-context.zip.pending"
        with zipfile.ZipFile(pending,"w",compression=zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
            for name in exported_names+["package.json"]:
                archive.write(destination/name,name,compress_type=zipfile.ZIP_STORED if name.endswith(".zip") else zipfile.ZIP_DEFLATED)
        os.replace(pending,archive_path)
        files = [describe_file(workspace.root,destination/name,label=name)
                 for name in exported_names+["package.json","assessment-context.zip"]]
        saved = workspace._save(KIND,{"version":VERSION,"title":selection["title"],"created_at":created,
            "selection":selection,"build_id":build_id,"summary":summary,"files":files,
            "source_collection_id":imported["id"],"source_id":SOURCE_ID,
            "context_source_binding":context_binding})
        atomic_json(saved_path,{"id":saved["id"],"build_id":build_id},immutable=True)
        return saved

def inspect(workspace, key, *, verify=False, include_result=False):
    row = workspace._get(KIND,identifier(key))
    if verify:
        for item in row["files"]:
            verify_file(workspace.root,item)
        workspace.source_file(row["source_collection_id"],row["source_id"])
    if include_result:
        for name,key in (("context.json","result"),("context.geojson","geojson")):
            item = next(item for item in row["files"] if Path(item["path"]).name==name)
            row[key] = read_json(verify_file(workspace.root,item))
    return row

def parcel_associations(workspace, context_id, study_id):
    """Retain parcel/context geometry associations independently of impairment scoring."""
    from . import conservation
    from pyproj import Transformer
    from shapely.geometry import shape, mapping
    from shapely.ops import transform, unary_union
    try:
        from shapely import STRtree
    except ImportError:
        from shapely.strtree import STRtree
    context = inspect(workspace,context_id,verify=True,include_result=True)
    for row in context["result"]["rows"]:
        row.setdefault("assessment_row_id",_row_id(row))
    study = conservation.inspect(workspace,identifier(study_id),include_candidates=False)
    if study["selection"]["spec"]["unit_type"]!="parcel":
        raise ValueError("Choose an original parcel study")
    crs, reporting, units, _, _ = conservation._geometry_inputs(workspace,study)
    to_metric = Transformer.from_crs("EPSG:4326",crs,always_xy=True)
    to_wgs = Transformer.from_crs(crs,"EPSG:4326",always_xy=True)
    originals = context["geojson"]["features"]
    shapes = [transform(to_metric.transform,shape(feature["geometry"])) for feature in originals]
    if any(p.is_empty or not p.is_valid for p in shapes):
        raise ValueError("Use valid retained assessment-context polygon geometry")
    tree=STRtree(shapes)
    summary_by_id={row["context_id"]:row for row in context["result"]["watersheds"]}
    key=digest({"version":VERSION,"context_id":context["id"],"study_id":study["id"],
                "study_selection":study["selection"],"method":"reporting-parcel polygon intersection"})
    directory=workspace.root/"assessment-parcel-context"/key
    directory.mkdir(parents=True,exist_ok=True)
    with held(directory/".association.lock"):
        if (directory/"edition.json").exists():
            return inspect_parcels(workspace,read_json(directory/"edition.json")["id"],verify=True)
        started=directory/"started.json"
        if not started.exists():
            atomic_json(started,{"created_at":now()},immutable=True)
        rows,relationships,features=[],[],[]
        for unit in units:
            zone=unit["clipped"];pieces=[];linked=[];hits=[];station_ids=set();row_numbers=set();row_ids=set()
            for found in tree.query(zone):
                if hasattr(found,"geom_type"):
                    indices=[i for i,p in enumerate(shapes) if p is found]
                else:
                    indices=[int(found)]
                for index in indices:
                    overlap=zone.intersection(shapes[index])
                    if overlap.is_empty:
                        continue
                    area=float(overlap.area);feature=originals[index]
                    native=summary_by_id[feature["id"]]
                    relation="area_overlap" if area>0 else "boundary_contact"
                    hit={"parcel_id":unit["id"],"context_id":feature["id"],
                         "watershed_id":native["watershed_id"],"relation":relation,
                         "overlap_area_ha":area/10000.0,"reporting_parcel_fraction":area/zone.area,
                         "station_ids":native["station_ids"],"assessment_row_numbers":native["assessment_row_numbers"],
                         "assessment_row_ids":native.get("assessment_row_ids") or sorted(
                            _row_id(row) for row in context["result"]["rows"] if feature["id"] in row["selected_polygon_ids"]),
                         "original_watershed_source":native["source_ref"]}
                    relationships.append(hit);hits.append(hit);linked.append(feature["id"])
                    station_ids.update(native["station_ids"]);row_numbers.update(native["assessment_row_numbers"]);row_ids.update(hit["assessment_row_ids"])
                    if area>0:
                        pieces.append(overlap)
            union_area=float(unary_union(pieces).area) if pieces else 0.0
            row={"parcel_id":unit["id"],"label":unit["label"],
                 "full_parcel_area_ha":float(unit["geometry"].area)/10000.0,
                 "reporting_parcel_area_ha":float(zone.area)/10000.0,
                 "context_overlap_area_ha":union_area/10000.0,
                 "reporting_context_fraction":union_area/zone.area,
                 "association_status":"area_overlap" if union_area>0 else "boundary_contact" if linked else "no_selected_context_intersection",
                 "context_ids":sorted(set(linked)),"station_ids":sorted(station_ids),
                 "assessment_row_numbers":sorted(row_numbers),"assessment_row_ids":sorted(row_ids),"context_count":len(set(linked)),
                 "station_count":len(station_ids),"assessment_row_count":len(row_ids),
                 "original_parcel_attributes":_copy(unit["properties"]),
                 "geometry_corrections":_copy(unit.get("geometry_corrections",[])),
                 "source_axes":_copy(unit.get("source_axes")),
                 "source_array_index":unit.get("source_array_index")}
            rows.append(row)
            properties={name:row[name] for name in ("parcel_id","label","full_parcel_area_ha",
                "reporting_parcel_area_ha","context_overlap_area_ha","reporting_context_fraction",
                "association_status","context_count","station_count","assessment_row_count")}
            properties["original_attributes_json"]=json.dumps(row["original_parcel_attributes"],ensure_ascii=False,sort_keys=True)
            features.append({"type":"Feature","id":unit["id"],"geometry":mapping(transform(to_wgs.transform,zone)),
                             "properties":properties})
        created=read_json(started)["created_at"]
        summary={"parcel_count":len(rows),"area_association_parcel_count":sum(r["association_status"]=="area_overlap" for r in rows),
                 "boundary_contact_parcel_count":sum(r["association_status"]=="boundary_contact" for r in rows),
                 "without_selected_context_count":sum(r["association_status"]=="no_selected_context_intersection" for r in rows),
                 "relationship_count":len(relationships)}
        result={"schema":"upstate.assessment-parcel-context/v1","version":VERSION,
                "title":context["title"]+" — "+study["title"],"created_at":created,
                "context_id":context["id"],"study_id":study["id"],"summary":summary,
                "assessment":context["result"]["assessment"],"assessment_groups":context["result"]["assessment_groups"],"relation":RELATION,
                "method":"Positive polygon area overlap and boundary-only contact recorded separately; area is the union within each reporting-clipped parcel",
                "analysis_crs_wkt":crs.to_wkt(),"study_selection":study["selection"],
                "rows":rows,"relationships":relationships,
                "assessment_rows":context["result"]["rows"],
                "score_effect":"Independent geographic association; no published impairment criterion or score is changed."}
        atomic_json(directory/"parcel-context.json",result)
        atomic_json(directory/"parcel-context.geojson",{"type":"FeatureCollection","features":features})
        columns=["parcel_id","label","association_status","full_parcel_area_ha","reporting_parcel_area_ha",
                 "context_overlap_area_ha","reporting_context_fraction","context_count","station_count",
                 "assessment_row_count","context_ids","station_ids","assessment_row_numbers","assessment_row_ids",
                 "original_parcel_attributes","geometry_corrections","source_axes","source_array_index"]
        atomic_bytes(directory/"parcel-context.csv",_csv(rows,columns))
        atomic_bytes(directory/"parcel-context-relationships.csv",_csv(relationships,[
            "parcel_id","context_id","watershed_id","relation","overlap_area_ha","reporting_parcel_fraction",
            "station_ids","assessment_row_numbers","assessment_row_ids","original_watershed_source"]))
        atomic_json(directory/"original-parcel-study.json",study)
        context_archive=next(item for item in context["files"] if Path(item["path"]).name=="assessment-context.zip")
        shutil.copyfile(verify_file(workspace.root,context_archive),directory/"assessment-context.zip")
        spec=study["selection"]["spec"]
        bindings=[]
        for choice in [spec["parcels"]]+([spec["reporting_area"]] if spec.get("reporting_area") else []):
            _,_,binding=geography._source(workspace,{"collection_id":choice["source_collection_id"],
                                                   "source_id":choice["source_id"]})
            bindings.append(binding)
        manifests,_=geography._package_inputs(workspace,directory,bindings,[])
        if study["selection"]["bindings"].get("grid"):
            grid=study["selection"]["bindings"]["grid"]
            source=verify_file(workspace.root/"grids"/grid["id"],grid["reporting_area"])
            shutil.copyfile(source,directory/("original-reporting-boundary"+source.suffix))
            atomic_json(directory/"original-grid-binding.json",grid)
        atomic_json(directory/"retained-source-manifests.json",manifests)
        esc=lambda value:html.escape(str(value),quote=True)
        document=("<!doctype html><html lang=en><meta charset=utf-8><title>"+esc(result["title"])+
            "</title><style>body{font:15px system-ui;margin:2rem;color:#222}table{border-collapse:collapse}"
            "td,th{padding:.5rem;border:1px solid #bbb;text-align:left}</style><h1>"+esc(result["title"])+
            "</h1><p>"+esc(RELATION)+"</p><p>"+esc(result["score_effect"])+
            "</p><p>Area is measured in the original study metric CRS. Per-parcel overlap unions avoid double counting "
            "overlapping context polygons; overlapping source parcels remain independent.</p><table><tr><th>Original parcel</th>"
            "<th>Association</th><th>Context overlap ha</th><th>Reporting fraction</th><th>Stations</th></tr>"+
            "".join("<tr>"+"".join("<td>"+esc(row[key])+"</td>" for key in
                    ("parcel_id","association_status","context_overlap_area_ha","reporting_context_fraction","station_count"))+
                    "</tr>" for row in rows)+"</table></html>")
        atomic_bytes(directory/"OPEN_PARCEL_CONTEXT.html",document.encode("utf-8"))
        names=[path.relative_to(directory).as_posix() for path in sorted(directory.rglob("*"))
               if path.is_file() and path.relative_to(directory).as_posix() not in
               (".association.lock","parcel-context.zip","parcel-context.zip.pending","edition.json","package.json")]
        package={"schema":"upstate.assessment-parcel-context-package/v1",
                 "context_id":context["id"],"study_id":study["id"],
                 "files":[describe_file(directory,directory/name) for name in names]}
        atomic_json(directory/"package.json",package)
        pending=directory/"parcel-context.zip.pending"
        with zipfile.ZipFile(pending,"w",compression=zipfile.ZIP_DEFLATED) as archive:
            for name in names+["package.json"]:
                archive.write(directory/name,name,compress_type=zipfile.ZIP_STORED if name.endswith(".zip") else zipfile.ZIP_DEFLATED)
        os.replace(pending,directory/"parcel-context.zip")
        exported=["parcel-context.json","parcel-context.geojson","parcel-context.csv",
                  "parcel-context-relationships.csv","OPEN_PARCEL_CONTEXT.html","package.json","parcel-context.zip"]
        saved=workspace._save(PARCEL_KIND,{"version":VERSION,"title":result["title"],
             "context_id":context["id"],"study_id":study["id"],"created_at":created,"summary":summary,
             "files":[describe_file(workspace.root,directory/name,label=name) for name in exported]})
        atomic_json(directory/"edition.json",{"id":saved["id"]},immutable=True)
        return saved

def inspect_parcels(workspace,key,*,verify=False,include_result=False):
    row=workspace._get(PARCEL_KIND,identifier(key))
    if verify:
        for item in row["files"]:
            verify_file(workspace.root,item)
    if include_result:
        item=next(item for item in row["files"] if Path(item["path"]).name=="parcel-context.json")
        row["result"]=read_json(verify_file(workspace.root,item))
    return row

def _restore_package(path, target, schema, max_extracted_bytes):
    with zipfile.ZipFile(path) as archive:
        members = {}
        for item in archive.infolist():
            name = geography._safe_member(item.filename).as_posix()
            mode = item.external_attr>>16
            if item.is_dir() or item.flag_bits&1 or (stat.S_IFMT(mode) not in (0,stat.S_IFREG)):
                raise ValueError("Context archive needs ordinary unencrypted file members")
            if name.casefold() in {key.casefold() for key in members}:
                raise ValueError("Context archive repeats a member")
            members[name]=item
        if sum(item.file_size for item in members.values())>max_extracted_bytes or len(members)>20000:
            raise ValueError("Context archive exceeds the receiving extraction limit")
        if "package.json" not in members or members["package.json"].file_size>16*1024**2:
            raise ValueError("Context archive has no usable complete inventory")
        package = json.loads(archive.read("package.json"))
        if package.get("schema")!=schema:
            raise ValueError("Choose an assessment geographic-context archive")
        declared = {item["path"]:item for item in package["files"]}
        if len(declared)!=len(package["files"]) or set(declared)!=set(members)-{"package.json"}:
            raise ValueError("Context archive and its complete inventory differ")
        for name,item in declared.items():
            if item["bytes"]!=members[name].file_size:
                raise ValueError("Context archive member length differs")
        restored = target/"original"
        if not restored.exists():
            with tempfile.TemporaryDirectory(prefix=".context-",dir=target) as temporary:
                stage = Path(temporary)/"original"
                stage.mkdir()
                for name,item in members.items():
                    out=stage.joinpath(*geography._safe_member(name).parts)
                    out.parent.mkdir(parents=True,exist_ok=True)
                    with archive.open(item) as stream,out.open("wb") as dest:
                        shutil.copyfileobj(stream,dest,1024*1024)
                    if name in declared and file_digest(out)!=declared[name]["sha256"]:
                        raise ValueError("Context archive member hash differs")
                os.rename(stage,restored)
        if read_json(restored/"package.json")!=package:
            raise ValueError("Retained package inventory changed")
        for name,item in declared.items():
            if (restored/name).stat().st_size!=item["bytes"] or file_digest(restored/name)!=item["sha256"]:
                raise ValueError("Retained received context member changed")
    return restored,package

def receive(workspace, path, *, max_extracted_bytes=2*1024**3):
    path = Path(path).resolve(strict=True)
    target = workspace.root/"assessment-context-received"/file_digest(path)
    target.mkdir(parents=True,exist_ok=True)
    with held(target/".receive.lock"):
        receipt = target/"received.json"
        if receipt.exists():
            return inspect(workspace,read_json(receipt)["id"],verify=True)
        restored,package=_restore_package(path,target,PACKAGE,max_extracted_bytes)
        study = geography.receive(workspace,restored/"original-station-geography.zip",
                                   max_extracted_bytes=max_extracted_bytes)
        selection = _copy(package["selection"])
        selection["station_geography_id"]=study["id"]
        def rebind(reference, expected):
            matches=[row for row in study["sources"] if row["source_sha256"]==expected
                     and row["source_id"]==reference["source_id"]]
            if len(matches)!=1:
                raise ValueError("Received original context source is absent or ambiguous")
            return _source_ref(matches[0])
        if "inventories" in selection:
            expected=package.get("table_sources")
            if not isinstance(expected,list) or len(expected)!=len(selection["inventories"]):
                raise ValueError("The context package must retain every original inventory identity")
            for inventory,original in zip(selection["inventories"],expected):
                if _key(original["reference"])!=_key(inventory["table"]):
                    raise ValueError("The context inventory source order changed")
                inventory["table"]=rebind(inventory["table"],original["sha256"])
                if inventory.get("table_source_sha256")!=original["sha256"]:
                    raise ValueError("The context inventory source identity changed")
        else:
            selection["table"]=rebind(selection["table"],package["table_source_sha256"])
        selection["watershed_source"]=rebind(selection["watershed_source"],package["watershed_source_sha256"])
        result=build(workspace,selection)
        atomic_json(receipt,{"id":result["id"],"original_selection":package["selection"]},immutable=True)
        return result


def receive_parcels(workspace,path,*,max_extracted_bytes=2*1024**3):
    """Reopen a complete saved parcel association and retain its original inputs."""
    path=Path(path).resolve(strict=True)
    archive_sha=file_digest(path)
    target=workspace.root/"assessment-parcel-context-received"/archive_sha
    target.mkdir(parents=True,exist_ok=True)
    with held(target/".receive.lock"):
        receipt_path=target/"received.json"
        receipt=read_json(receipt_path) if receipt_path.exists() else {"source_map":{}}
        if receipt.get("id"):
            return inspect_parcels(workspace,receipt["id"],verify=True)
        restored,package=_restore_package(path,target,"upstate.assessment-parcel-context-package/v1",
                                           max_extracted_bytes)
        result=read_json(restored/"parcel-context.json")
        if result.get("schema")!="upstate.assessment-parcel-context/v1":
            raise ValueError("Choose a complete original parcel geographic-association package")
        if result["context_id"]!=package["context_id"] or result["study_id"]!=package["study_id"]:
            raise ValueError("Parcel context package references changed")
        context=receive(workspace,restored/"assessment-context.zip",
                        max_extracted_bytes=max_extracted_bytes)
        for item in read_json(restored/"retained-source-manifests.json"):
            old=identifier(item["original_collection_id"])
            if old not in receipt["source_map"]:
                manifest=relative_file(restored,geography._safe_member(item["path"]).as_posix())
                receipt["source_map"][old]=workspace.import_sources(manifest)["id"]
                atomic_json(receipt_path,receipt)
            else:
                workspace._get("sources",receipt["source_map"][old])
        original=target/"parcel-context.zip"
        if not original.exists():
            shutil.copyfile(path,original)
        if file_digest(original)!=archive_sha:
            raise ValueError("Retained original parcel context archive changed")
        names=["parcel-context.json","parcel-context.geojson","parcel-context.csv",
               "parcel-context-relationships.csv","OPEN_PARCEL_CONTEXT.html","package.json"]
        saved=workspace._save(PARCEL_KIND,{"version":VERSION,"title":result["title"],
            "context_id":context["id"],"study_id":result["study_id"],"created_at":result["created_at"],
            "summary":result["summary"],
            "received_from":{"archive_sha256":archive_sha,"original_context_id":result["context_id"],
                             "original_study_id":result["study_id"],
                             "source_collection_map":receipt["source_map"],
                             "study_state":"Original saved study retained; select a destination study to calculate a new association"},
            "files":[describe_file(workspace.root,restored/name,label=name) for name in names]+
                    [describe_file(workspace.root,original,label="parcel-context.zip")]})
        receipt["id"]=saved["id"];receipt["received_at"]=now()
        atomic_json(receipt_path,receipt)
        return saved

def verify_workspace(workspace):
    for row in workspace._list(KIND):
        inspect(workspace,row["id"],verify=True)
    for row in workspace._list(PARCEL_KIND):
        inspect_parcels(workspace,row["id"],verify=True)
    return {"assessment_contexts":len(workspace._list(KIND)),
            "assessment_parcel_contexts":len(workspace._list(PARCEL_KIND))}

def main(argv=None):
    from .workspace import Workspace
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace",required=True)
    commands=parser.add_subparsers(dest="command",required=True)
    commands.add_parser("catalog")
    command=commands.add_parser("options");command.add_argument("geography_id")
    command=commands.add_parser("build");command.add_argument("selection")
    command=commands.add_parser("inspect");command.add_argument("id")
    command=commands.add_parser("receive");command.add_argument("archive")
    command=commands.add_parser("receive-parcels");command.add_argument("archive")
    command=commands.add_parser("inspect-parcels");command.add_argument("id")
    command=commands.add_parser("parcels");command.add_argument("context_id");command.add_argument("study_id")
    args=parser.parse_args(argv);ws=Workspace(args.workspace)
    if args.command=="catalog": result=catalog(ws)
    elif args.command=="options": result=options(ws,args.geography_id)
    elif args.command=="build": result=build(ws,read_json(Path(args.selection)))
    elif args.command=="inspect": result=inspect(ws,args.id,verify=True,include_result=True)
    elif args.command=="receive": result=receive(ws,args.archive)
    elif args.command=="receive-parcels": result=receive_parcels(ws,args.archive)
    elif args.command=="inspect-parcels": result=inspect_parcels(ws,args.id,verify=True,include_result=True)
    else: result=parcel_associations(ws,args.context_id,args.study_id)
    print(json.dumps(result,ensure_ascii=False,indent=2,allow_nan=False))

if __name__=="__main__":
    main()
