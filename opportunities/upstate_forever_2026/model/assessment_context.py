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

VERSION = "1.0.0"
KIND = "assessment-contexts"
SCHEMA = "upstate.assessment-geographic-context/v1"
PACKAGE = "upstate.assessment-context-package/v1"
SOURCE_ID = "assessment-geographic-context"
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
            row = {"station_id": station["station_id"], "row_number": ref["row_number"],
                   "original": _copy(ref["original"]), "source_ref": {k:v for k,v in ref.items() if k != "original"},
                   "location_status": station["status"], "watershed_status": station["watershed_status"],
                   "computed_memberships": _copy(station.get("watersheds", []))}
            if identity in records and canonical(records[identity]) != canonical(row):
                raise ValueError("An assessment row is assigned to more than one study station")
            records[identity] = row
    return sorted(records.values(), key=lambda row: row["row_number"])

def options(workspace, geography_id, table=None):
    study = geography.inspect(workspace, geography_id, include_result=True)
    tables = []
    for reference in study["selection"].get("site_tables", []):
        binding = next(row for row in study["sources"] if _key(row) == _key(reference))
        records = _rows(study, reference)
        fields = sorted({key for row in records for key in row["original"]})
        values = {key: sorted({_field(row["original"].get(key)) for row in records}) for key in fields}
        defaults = {key: name for key,name in (("watershed","huc12"),("cause","cause"),
                    ("use","impaired_use"),("county","county")) if name in fields}
        tables.append({"reference": _source_ref(reference), "title": binding.get("title"),
                       "uri": binding.get("uri"), "vintage": binding["source_metadata"].get("vintage"),
                       "source_sha256": binding["source_sha256"], "row_count": len(records),
                       "assessment_defaults": ({"title":"South Carolina 2026 draft integrated assessment",
                           "status":"draft","vintage":"2026","reference":binding.get("uri")}
                           if binding["source_sha256"]=="545a4e1413012b8f17c81c8afe815dd1e225ade5f5b9792ca22e83ef8723307f"
                           else {"title":binding.get("title") or "",
                                 "status":(binding["source_metadata"].get("metadata") or {}).get("assessment_status",""),
                                 "vintage":binding["source_metadata"].get("vintage") or "",
                                 "reference":binding.get("uri") or ""}),
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
        "parcel_studies": [row for row in conservation.overview(workspace)["studies"]
                          if row.get("unit_type") == "parcel"]}

def _selection(study, value):
    result = _copy(value)
    result["station_geography_id"] = study["id"]
    result["title"] = _text(result.get("title"), "Context title")
    table, binding = _table_record(study, result)
    result["table"] = table
    result["watershed_source"] = _source_ref(result["watershed_source"])
    if _key(result["watershed_source"]) not in {
            _key(row) for row in study["selection"].get("watersheds", [])}:
        raise ValueError("Select a watershed source retained by this study")
    basis = result.get("relationship_basis", "published_watershed")
    if basis not in ("published_watershed", "station_membership"):
        raise ValueError("Choose published_watershed or station_membership")
    result["relationship_basis"] = basis
    fields = result.get("fields")
    if not isinstance(fields, dict) or not {"watershed","cause","use"} <= set(fields):
        raise ValueError("Select original watershed, cause and impaired-use fields")
    if set(fields) - {"watershed","cause","use","county"}:
        raise ValueError("Unknown assessment field binding")
    fields = {key:_text(value, "Original " + key + " field") for key,value in fields.items()}
    result["fields"] = fields
    filters = result.get("filters") or {}
    if not isinstance(filters, dict) or set(filters) - {"causes","uses","counties"}:
        raise ValueError("Choose exact original cause, use and county filters")
    for key, values in filters.items():
        if not isinstance(values, list) or any(not isinstance(item,str) for item in values):
            raise ValueError("Assessment filters must list exact original text values")
        filters[key] = sorted(set(values))
    result["filters"] = filters
    assessment = result.get("assessment")
    if not isinstance(assessment, dict):
        raise ValueError("Retain the selected assessment title, status, vintage and reference")
    result["assessment"] = {key:_text(assessment.get(key), "Assessment " + key)
                            for key in ("title","status","vintage","reference")}
    result["table_source_sha256"] = binding["source_sha256"]
    return result, binding

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

def _report(result):
    esc = lambda value: html.escape(str(value), quote=True)
    rows = "".join("<tr>" + "".join("<td>" + esc(row.get(key,"")) + "</td>" for key in
                  ("watershed_id","station_count","assessment_row_count","causes","uses")) + "</tr>"
                  for row in result["watersheds"])
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
            "<p>Original source: " + esc(result["assessment"]["reference"]) +
            "</p><h2>Selected watershed context</h2><table><thead><tr><th>Original watershed ID</th>"
            "<th>Distinct stations</th><th>Assessment rows</th><th>Original causes</th><th>Original uses</th>"
            "</tr></thead><tbody>" + rows + "</tbody></table><h2>Unresolved or multiple associations</h2><ul>" +
            issues + "</ul><p>Complete original rows, both association methods and source identities accompany "
            "this report in JSON and CSV.</p></html>").encode("utf-8")

def _criteria_binding(collection_id, selection):
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
    selection, binding = _selection(study, value)
    rows = _rows(study, selection["table"])
    fields, filters = selection["fields"], selection["filters"]
    field_names = set(fields.values())
    if any(field_names - set(row["original"]) for row in rows):
        raise ValueError("A selected original field is absent from an assessment row")
    for category, field in (("causes","cause"),("uses","use"),("counties","county")):
        wanted = filters.get(category, [])
        if wanted and field not in fields:
            raise ValueError("Select the original county field before filtering counties")
        if wanted:
            available = {_field(row["original"].get(fields[field])) for row in rows}
            if set(wanted) - available:
                raise ValueError("A filter value is absent from the selected original " + category)
            rows = [row for row in rows if _field(row["original"].get(fields[field])) in wanted]
    if not rows:
        raise ValueError("The selected original assessment filters contain no study rows")
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
        original_id = _field(row["original"][fields["watershed"]])
        memberships = [m for m in row["computed_memberships"]
                       if _key(m["source_ref"]) == _key(selection["watershed_source"])]
        published = by_published.get(original_id, []) if original_id else []
        computed_ids = {digest(m["source_ref"]) for m in memberships}
        computed = [feature for feature in polygons if feature["id"] in computed_ids]
        chosen = published if selection["relationship_basis"] == "published_watershed" else computed
        item = {**row, "original_watershed_value": row["original"][fields["watershed"]],
                "published_polygon_ids":[feature["id"] for feature in published],
                "computed_polygon_ids":[feature["id"] for feature in computed],
                "selected_polygon_ids":[feature["id"] for feature in chosen],
                "cause":row["original"][fields["cause"]], "impaired_use":row["original"][fields["use"]],
                "geographic_status":"unmatched" if not chosen else "multiple" if len(chosen)>1 else "matched",
                "association_agreement":set(f["id"] for f in published) == set(computed_ids),
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
                   "assessment_row_numbers":sorted({row["row_number"] for row in members})}
        summaries.append(summary)
        properties = {key:summary[key] for key in
                      ("context_id","watershed_id","station_count","assessment_row_count")}
        properties.update(assessment_title=selection["assessment"]["title"],
            assessment_status=selection["assessment"]["status"],
            assessment_vintage=selection["assessment"]["vintage"],
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
        summary = {"assessment_row_count":len(selected_rows),
                   "station_count":len({row["station_id"] for row in selected_rows}),
                   "watershed_count":len(features),
                   "unmatched_row_count":sum(row["geographic_status"]=="unmatched" for row in selected_rows),
                   "multiple_association_row_count":sum(row["geographic_status"]=="multiple" for row in selected_rows),
                   "differing_association_row_count":sum(not row["association_agreement"] for row in selected_rows)}
        result = {"schema":SCHEMA,"version":VERSION,"title":selection["title"],"created_at":created,
                  "build_id":build_id,"selection":selection,"assessment":selection["assessment"],
                  "relationship_basis":selection["relationship_basis"],"relation":RELATION,
                  "coverage":{"negative_association":"unknown","basis":"Selected station assessment inventory",
                              "selected_source_polygon_count":len(polygons)},
                  "summary":summary,"rows":selected_rows,"watersheds":summaries,
                  "original_geography_id":study["id"],"original_geography_build_id":study["build_id"],
                  "assessment_source":binding}
        atomic_json(destination/"selection.json",selection,immutable=True)
        atomic_json(destination/"context.json",result,immutable=True)
        atomic_json(destination/"context.geojson",{"type":"FeatureCollection","features":features},immutable=True)
        atomic_bytes(destination/"assessment-rows.csv",_csv(selected_rows,[
            "station_id","row_number","cause","impaired_use","original_watershed_value",
            "location_status","watershed_status","geographic_status","association_agreement",
            "computed_boundary_or_overlap","published_polygon_ids","computed_polygon_ids",
            "selected_polygon_ids","computed_memberships","source_ref","original"]),immutable=True)
        atomic_bytes(destination/"watershed-context.csv",_csv(summaries,[
            "context_id","watershed_id","station_count","assessment_row_count","causes","uses",
            "station_ids","assessment_row_numbers","source_ref"]),immutable=True)
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
        entry = {"id":SOURCE_ID,"title":selection["title"],"kind":"vector",
                 "role":"ASSESSMENT_GEOGRAPHIC_CONTEXT","uri":selection["assessment"]["reference"],
                 "vintage":selection["assessment"]["vintage"]+" ("+selection["assessment"]["status"]+")",
                 "path":"context.geojson","sha256":file_digest(destination/"context.geojson"),
                 "id_field":"context_id","source_crs":"EPSG:4326",
                 "metadata":{"assessment":selection["assessment"],"relation":RELATION,
                             "negative_coverage":"unknown","original_station_geography":study["id"],
                             "parcel_criteria":{key:value for key,value in _criteria_binding("",selection).items()
                                               if key in ("reference","relation","meaning")}},
                 "companions":[{"path":name,"sha256":file_digest(destination/name)} for name in companion_names]}
        manifest = {"schema":"upstate.sources/v1","title":selection["title"],"captured_at":created,
                    "entries":[entry],"notes":[RELATION]}
        atomic_json(destination/"sources.json",manifest,immutable=True)
        imported = workspace.import_sources(destination/"sources.json")
        parcel_binding = _criteria_binding(imported["id"],selection)
        atomic_json(destination/"parcel-criteria-binding.json",{"sources":{"impairments":parcel_binding}},immutable=True)
        exported_names = ["started.json","selection.json","context.json","context.geojson",
                          "assessment-rows.csv","watershed-context.csv","OPEN_ASSESSMENT_CONTEXT.html",
                          "original-station-geography.zip","sources.json","parcel-criteria-binding.json"]
        inventory = [describe_file(destination,destination/name) for name in exported_names]
        package = {"schema":PACKAGE,"version":VERSION,"selection":selection,
                   "table_source_sha256":binding["source_sha256"],
                   "watershed_source_sha256":next(s["source_sha256"] for s in study["sources"]
                      if _key(s)==_key(selection["watershed_source"])),
                   "files":inventory}
        atomic_json(destination/"package.json",package,immutable=True)
        archive_path = destination/"assessment-context.zip"
        pending = destination/"assessment-context.zip.pending"
        with zipfile.ZipFile(pending,"w",compression=zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
            for name in exported_names+["package.json"]:
                archive.write(destination/name,name)
        os.replace(pending,archive_path)
        files = [describe_file(workspace.root,destination/name,label=name)
                 for name in exported_names+["package.json","assessment-context.zip"]]
        saved = workspace._save(KIND,{"version":VERSION,"title":selection["title"],"created_at":created,
            "selection":selection,"build_id":build_id,"summary":summary,"files":files,
            "source_collection_id":imported["id"],"source_id":SOURCE_ID,
            "parcel_criteria_binding":parcel_binding})
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

def prepare_parcel_criteria(workspace, context_id, study_id, *, settings=None, sources=None):
    from source_tools import parcel_criteria
    context = inspect(workspace,context_id,verify=True)
    selected = _copy(sources or {})
    if "impairments" in selected and selected["impairments"]!=context["parcel_criteria_binding"]:
        raise ValueError("Parcel selection already contains another assessment association")
    selected["impairments"] = context["parcel_criteria_binding"]
    value = {"study_id":identifier(study_id),"sources":selected}
    if settings is not None:
        value["settings"] = _copy(settings)
    return parcel_criteria.prepare(workspace,value)

def receive(workspace, path, *, max_extracted_bytes=2*1024**3):
    path = Path(path).resolve(strict=True)
    target = workspace.root/"assessment-context-received"/file_digest(path)
    target.mkdir(parents=True,exist_ok=True)
    with held(target/".receive.lock"):
        receipt = target/"received.json"
        if receipt.exists():
            return inspect(workspace,read_json(receipt)["id"],verify=True)
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
            if package.get("schema")!=PACKAGE:
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
            for name,item in declared.items():
                if (restored/name).stat().st_size!=item["bytes"] or file_digest(restored/name)!=item["sha256"]:
                    raise ValueError("Retained received context member changed")
        study = geography.receive(workspace,restored/"original-station-geography.zip",
                                   max_extracted_bytes=max_extracted_bytes)
        selection = _copy(package["selection"])
        selection["station_geography_id"]=study["id"]
        for field,hash_name in (("table","table_source_sha256"),("watershed_source","watershed_source_sha256")):
            matches=[row for row in study["sources"] if row["source_sha256"]==package[hash_name]
                     and row["source_id"]==selection[field]["source_id"]]
            if len(matches)!=1:
                raise ValueError("Received original context source is absent or ambiguous")
            selection[field]=_source_ref(matches[0])
        result=build(workspace,selection)
        atomic_json(receipt,{"id":result["id"],"original_selection":package["selection"]},immutable=True)
        return result

def verify_workspace(workspace):
    for row in workspace._list(KIND):
        inspect(workspace,row["id"],verify=True)
    return {"assessment_contexts":len(workspace._list(KIND))}

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
    command=commands.add_parser("criteria");command.add_argument("context_id");command.add_argument("study_id")
    args=parser.parse_args(argv);ws=Workspace(args.workspace)
    if args.command=="catalog": result=catalog(ws)
    elif args.command=="options": result=options(ws,args.geography_id)
    elif args.command=="build": result=build(ws,read_json(Path(args.selection)))
    elif args.command=="inspect": result=inspect(ws,args.id,verify=True,include_result=True)
    elif args.command=="receive": result=receive(ws,args.archive)
    else: result=prepare_parcel_criteria(ws,args.context_id,args.study_id)
    print(json.dumps(result,ensure_ascii=False,indent=2,allow_nan=False))

if __name__=="__main__":
    main()
