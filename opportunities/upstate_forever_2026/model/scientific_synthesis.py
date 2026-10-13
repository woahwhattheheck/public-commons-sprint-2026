"""Scientist-authored source editions, retained only through Workspace.import_sources."""
from __future__ import annotations
import copy
import hashlib
import json
from pathlib import Path
import re
import shutil
import tempfile
from .common import atomic_json, describe_file, digest, file_digest, held, read_json
from . import scientific_synthesis_catalog as references

SCHEMA = "upstate.scientific-synthesis-record/v1"
DOCUMENT_SCHEMA = "upstate.scientific-synthesis-document/v1"
MARKER = "upstate.scientific-synthesis-source/v1"
KINDS = ("finding", "interpretation", "limitation", "next-work")
LIMIT = 8 * 1024 * 1024

def _text(value, label, required=False):
    if not isinstance(value, str) or "\0" in value or len(value) > 1000000:
        raise ValueError(label + " must be ordinary text")
    if required and not value.strip():
        raise ValueError("Enter " + label)
    return value

def _id(value, label):
    if not isinstance(value, str) or not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}", value):
        raise ValueError(label + " is invalid")
    return value

def _sha(value, label):
    if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{64}", value):
        raise ValueError(label + " is invalid")
    return value

def document(value):
    if not isinstance(value, dict) or value.get("schema") != DOCUMENT_SCHEMA:
        raise ValueError("Select an original scientist-authored document")
    value = copy.deepcopy(value)
    _id(value.get("series_id"), "Series identity")
    for name in ("title", "revision_name", "question", "scope", "change_note"):
        _text(value.get(name), name, name in ("title", "revision_name", "question"))
    author = value.get("author")
    if not isinstance(author, dict):
        raise ValueError("Retain the attributed author")
    for name in ("name", "organization", "email"):
        _text(author.get(name), "author " + name, name == "name")
    sources = value.get("sources")
    if not isinstance(sources, list) or not sources:
        raise ValueError("Select the original scientific studies")
    seen = set()
    for choice in sources:
        if not isinstance(choice, dict):
            raise ValueError("Source choice must retain its original identities")
        _sha(choice.get("source_collection_id"), "Source collection")
        _text(choice.get("source_id"), "source ID", True)
        pair = (choice["source_collection_id"], choice["source_id"])
        if pair in seen:
            raise ValueError("Select each original source once")
        seen.add(pair)
    if not isinstance(value.get("sections"), list):
        raise ValueError("Retain the authored sections")
    seen, findings = set(), 0
    for row in value["sections"]:
        if not isinstance(row, dict):
            raise ValueError("Authored sections must be objects")
        _id(row.get("id"), "Section identity")
        if row["id"] in seen or row.get("kind") not in KINDS:
            raise ValueError("Retain distinct sections with an explicit kind")
        seen.add(row["id"])
        _text(row.get("heading"), "section heading", True)
        _text(row.get("text"), "section text", True)
        ids = row.get("reference_ids")
        if (not isinstance(ids, list) or any(not isinstance(x, str) or not x for x in ids)
                or len(set(ids)) != len(ids)):
            raise ValueError("Retain distinct original reference IDs")
        if row["kind"] == "finding":
            findings += 1
            if not ids:
                raise ValueError("Each finding needs an exact original source reference")
    if value.get("fork_origin") is not None:
        origin = value["fork_origin"]
        if not isinstance(origin, dict):
            raise ValueError("Retain the explicit original fork source")
        _sha(origin.get("collection_id"), "Original fork collection")
        _sha(origin.get("revision_id"), "Original fork revision")
    if not findings:
        raise ValueError("Write at least one source-linked finding")
    if len(json.dumps(value, ensure_ascii=False).encode("utf-8")) > LIMIT:
        raise ValueError("An authored document supports up to 8 MiB of UTF-8 text")
    return value

def _selected_entry(collection):
    rows = [row for row in collection["entries"]
            if isinstance(row.get("metadata"), dict)
            and row["metadata"].get("scientific_synthesis_schema") == MARKER]
    if len(rows) != 1:
        raise ValueError("Choose a complete original scientist-authored source edition")
    return rows[0]

def _member(root, entry, name):
    rows = [row for row in [entry["body"], *entry.get("companions", [])]
            if row.get("view_path", row["filename"]) == name]
    if len(rows) != 1:
        raise ValueError("The authored source companion is absent: " + name)
    row = rows[0]
    path = root / name
    if not path.is_file() or path.stat().st_size != row["bytes"] or file_digest(path) != row["sha256"]:
        raise ValueError("The authored source companion changed: " + name)
    return path

def inspect(workspace, collection_id):
    collection = workspace.retained_item("sources", _sha(collection_id, "Authored collection"))
    entry = _selected_entry(collection)
    body, retained_entry = workspace.source_file(collection_id, entry["id"])
    root = body.parent
    record = read_json(_member(root, retained_entry, "synthesis-record.json"))
    history = read_json(_member(root, retained_entry, "synthesis-history.json"))
    current_catalog = read_json(_member(root, retained_entry, "source-catalog.json"))
    if record.get("schema") != SCHEMA or digest({k:v for k,v in record.items() if k != "revision_id"}) != record.get("revision_id"):
        raise ValueError("The authored revision identity changed")
    document(record["document"])
    marker = {"schema":MARKER,"series_id":record["document"]["series_id"],"revision":record["revision"],
              "revision_id":record["revision_id"],"operation_id":record["operation_id"],"request_sha256":record["request_sha256"]}
    if collection.get("scope", {}).get("scientific_synthesis") != marker:
        raise ValueError("The authored collection marker differs from its retained revision")
    if entry["metadata"].get("series_id") != marker["series_id"] or entry["metadata"].get("revision_id") != marker["revision_id"]:
        raise ValueError("The source entry metadata differs from its authored edition")
    if (not isinstance(history, list) or not history or history[-1] != record
            or len(history) != record["revision"]):
        raise ValueError("The full authored revision history differs")
    previous = None
    for index, item in enumerate(history, 1):
        if (item.get("schema") != SCHEMA or item.get("revision") != index
                or item.get("project_id") != record["project_id"]
                or item.get("document", {}).get("series_id") != record["document"]["series_id"]
                or item.get("previous_revision_id") != previous
                or digest({k:v for k,v in item.items() if k != "revision_id"}) != item.get("revision_id")):
            raise ValueError("The retained authored history is not one complete revision chain")
        document(item["document"])
        request = item.get("request")
        if (not isinstance(request, dict) or digest(request) != item["request_sha256"]
                or request.get("document") != item["document"]
                or request.get("operation_id") != item["operation_id"]
                or request.get("catalog_sha256") != item["catalog"].get("catalog_sha256")
                or request.get("base_collection_id") != item["previous_collection_id"]):
            raise ValueError("The complete original authored request differs")
        references.bind_references(item["catalog"], list(dict.fromkeys(key for row in item["document"]["sections"] for key in row["reference_ids"])))
        previous = item["revision_id"]
    if record["catalog"] != current_catalog:
        raise ValueError("The retained authored reference catalog differs")
    return {"collection_id": collection_id, "source_id": entry["id"], "record": record,
            "history": history, "catalog": current_catalog,
            "source": {"source_collection_id": collection_id, "source_id": entry["id"]},
            "foreign_project": record["project_id"] != workspace.project["id"]}

def list_editions(workspace, series_id=None):
    result = []
    for collection in workspace.sources():
        scope = collection.get("scope")
        marker = scope.get("scientific_synthesis") if isinstance(scope, dict) else None
        if not isinstance(marker, dict) or marker.get("schema") != MARKER:
            continue
        if series_id is not None and marker.get("series_id") != series_id:
            continue
        _id(marker.get("series_id"), "Retained series identity")
        _id(marker.get("operation_id"), "Retained operation identity")
        _sha(marker.get("revision_id"), "Retained revision identity")
        _sha(marker.get("request_sha256"), "Retained original request identity")
        if isinstance(marker.get("revision"), bool) or not isinstance(marker.get("revision"), int) or marker["revision"] < 1:
            raise ValueError("The retained authored revision number is invalid")
        entry = _selected_entry(collection)
        result.append({**marker, "collection_id": collection["id"], "source_id": entry["id"],
                       "title": entry["title"], "vintage": entry["vintage"]})
    return sorted(result, key=lambda row:(row["series_id"], row["revision"], row["collection_id"]))

def _recipe(record, archives):
    doc = record["document"]
    refs = {row["id"]: row for row in record["catalog"]["references"]}
    sections = [
        ["Scientist-authored synthesis", [
            doc["title"], "Edition: " + doc["revision_name"],
            "Prepared by " + doc["author"]["name"] + (" · " + doc["author"]["organization"] if doc["author"]["organization"] else ""),
            "Produced with the TJLabs scientific workspace. Scientific conclusions below are attributed to the named author.",
        ]],
        ["Decision question and scope", [doc["question"], doc["scope"]]],
    ]
    for row in doc["sections"]:
        blocks = [row["text"]]
        if row["reference_ids"]:
            blocks.append({"kind": "table", "columns": ["Original study", "Reference", "Location", "Retained body SHA-256"],
                           "rows": [[refs[key].get("source_title") or refs[key]["source_id"],
                                     refs[key]["title"], refs[key].get("pointer", refs[key].get("member_path", "")),
                                     refs[key]["body_sha256"]] for key in row["reference_ids"]]})
        sections.append([{"finding":"Finding", "interpretation":"Interpretation", "limitation":"Limitation",
                          "next-work":"Next work"}[row["kind"]] + " · " + row["heading"], blocks])
    sections.append(["Authored revision history", [{"kind":"table",
        "columns":["Edition","Author","Change note","Original request"],
        "rows":[[r["document"]["revision_name"],r["document"]["author"]["name"],
                 r["document"]["change_note"],r["operation_id"]] for r in record["_history"]]}]])
    links = [{"title":"Complete editable authored revision and exact source catalog", "path":"synthesis-record.json"},
             {"title":"Full attributed revision history", "path":"synthesis-history.json"},
             {"title":"Complete original source archive identities", "path":"original-source-archives.json"}]
    links += [{"title": row["title"] + " — complete original source edition ZIP", "path":row["path"]} for row in archives]
    sections.append(["Complete original sources and editable authorship", [{"kind":"links","items":links}]])
    return {"schema":"upstate.observed-report/v1", "title":doc["title"],
            "report_context_kind":"scientist-authored-synthesis", "sections":sections,
            "figures":[], "source_links":links}

def save(workspace, payload, *, archive_source, staging_root, created_at):
    """Publish one immutable native source collection; replay precedes current-head CAS."""
    if not isinstance(payload, dict):
        raise ValueError("Retain the original synthesis save request")
    operation_id = _id(payload.get("operation_id"), "Original operation ID")
    doc = document(payload.get("document"))
    expected_catalog = _sha(payload.get("catalog_sha256"), "Original catalog identity")
    base_id = payload.get("base_collection_id")
    if base_id is not None:
        _sha(base_id, "Prior authored source collection")
    request_sha = digest(payload)
    with held(workspace.root / ".workspace.lock", blocking=False):
        all_rows = list_editions(workspace)
        rows = [row for row in all_rows if row["series_id"] == doc["series_id"]]
        matching = [row for row in all_rows if row["operation_id"] == operation_id]
        if matching:
            if any(row["request_sha256"] != request_sha for row in matching):
                raise ValueError("The original operation ID already names a different complete request")
            result = inspect(workspace, matching[0]["collection_id"])
            return {**result, "replayed":True}
        head_revision = max((row["revision"] for row in rows), default=0)
        heads = [row for row in rows if row["revision"] == head_revision]
        if len({row["revision_id"] for row in heads}) > 1:
            raise ValueError("This series contains different native heads; select a new explicitly attributed series")
        if heads and base_id not in {row["collection_id"] for row in heads}:
            raise ValueError("The authored series advanced. Reopen its current edition and preserve this working copy before making a revision")
        if not heads and base_id is not None:
            raise ValueError("The original prior authored edition is not registered")
        base = inspect(workspace, base_id) if base_id else None
        if base and base["foreign_project"]:
            raise ValueError("This original chapter belongs to another project. Explicitly fork a new authored series")
        if base and base["record"]["document"]["series_id"] != doc["series_id"]:
            raise ValueError("The prior edition belongs to another authored series")
        if base and not doc["change_note"].strip():
            raise ValueError("Describe this revision's change")
        origin = doc.get("fork_origin")
        if origin:
            original = inspect(workspace, origin["collection_id"])
            if original["record"]["revision_id"] != origin["revision_id"] or original["record"]["document"]["series_id"] == doc["series_id"]:
                raise ValueError("An explicit fork must retain its actual original edition and a new series identity")
        catalog = references.catalog(workspace, doc["sources"])
        if catalog["catalog_sha256"] != expected_catalog:
            raise ValueError("Original reference selection changed; reopen the complete source catalog")
        used = list(dict.fromkeys(key for row in doc["sections"] for key in row["reference_ids"]))
        references.bind_references(catalog, used)
        record = {"schema":SCHEMA, "project_id":workspace.project["id"],
                  "document":doc, "catalog":catalog, "revision":head_revision+1,
                  "previous_collection_id":base_id,
                  "previous_revision_id":base["record"]["revision_id"] if base else None,
                  "operation_id":operation_id, "request_sha256":request_sha,
                  "request":copy.deepcopy(payload), "saved_at":created_at}
        record["revision_id"] = digest(record)
        history = (base["history"] if base else []) + [record]
        collections = {}
        for edition in history:
            for choice in edition["document"]["sources"]:
                collections.setdefault(choice["source_collection_id"], choice)
        for edition in history:
            origin = edition["document"].get("fork_origin")
            if origin:
                collections.setdefault(origin["collection_id"], origin)
        stage_parent = Path(staging_root)
        stage_parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="synthesis-", dir=stage_parent) as temporary:
            folder = Path(temporary)
            archives = []
            for collection_id in collections:
                result = archive_source(collection_id)
                source = Path(result["path"])
                expected = result["descriptor"]
                if source.stat().st_size != expected["bytes"] or file_digest(source) != expected["sha256"]:
                    raise ValueError("The original source archive changed before retention")
                relative = "original-sources/" + collection_id + ".zip"
                target = folder / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(source, target)
                if file_digest(target) != expected["sha256"] or target.stat().st_size != expected["bytes"]:
                    raise ValueError("The complete original source archive changed during retention")
                archives.append({"original_collection_id":collection_id, "path":relative,
                                 "title":result["title"], **{k:expected[k] for k in ("bytes","sha256")},
                                 "source_ids":result["source_ids"],"manifest_member":result["manifest_member"],
                                 "original_manifest_sha256":result["original_manifest_sha256"],
                                 "receiving":"Reimport this complete ZIP through the original Sources workflow; retain its actual new collection receipt if its manifest filename produces a new ID."})
            atomic_json(folder/"synthesis-record.json",record)
            atomic_json(folder/"synthesis-history.json",history)
            atomic_json(folder/"source-catalog.json",catalog)
            atomic_json(folder/"original-source-archives.json",archives)
            recipe = _recipe({**record, "_history":history},archives)
            companions = [describe_file(folder,path) for path in sorted(folder.rglob("*")) if path.is_file()]
            recipe["inputs"] = [{key:row[key] for key in ("path","bytes","sha256")} for row in companions]
            atomic_json(folder/"observed-report.json",recipe)
            marker = {"schema":MARKER,"series_id":doc["series_id"],"revision":record["revision"],
                      "revision_id":record["revision_id"],"operation_id":operation_id,"request_sha256":request_sha}
            manifest = {"schema":"upstate.sources/v1","title":doc["title"]+" · "+doc["revision_name"],
                        "captured_at":created_at,"scope":{"scientific_synthesis":marker},
                        "notes":["Attributed authored interpretation; original scientific quantities are retained in their complete source editions."],
                        "entries":[{"id":"scientific-synthesis-"+doc["series_id"],"kind":"document","role":"OBSERVED_CONTEXT",
                            "title":doc["title"]+" · "+doc["revision_name"],"uri":"urn:tjlabs:scientific-synthesis:"+record["revision_id"],
                            "vintage":doc["revision_name"],"path":"observed-report.json","sha256":file_digest(folder/"observed-report.json"),
                            "metadata":{"scientific_synthesis_schema":MARKER,"report_schema":"upstate.observed-report/v1",
                                        "series_id":doc["series_id"],"revision_id":record["revision_id"]},
                            "companions":[{"path":row["path"],"sha256":row["sha256"]} for row in companions]}]}
            atomic_json(folder/"sources.json",manifest)
            collection = workspace.import_sources(folder/"sources.json")
        return {**inspect(workspace,collection["id"]),"replayed":False}
