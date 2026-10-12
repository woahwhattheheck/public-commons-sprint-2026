"""Selected edition/management handovers and complete private continuation ZIPs."""
from __future__ import annotations

import hashlib
import io
import json
import re
import zipfile
from copy import deepcopy
from pathlib import PurePosixPath

if __package__:
    from . import engine
    from .workspace import json_read
else:
    import engine
    from workspace import json_read

PRIVATE_SCHEMA="standards-private-continuation/v1"
HANDOVER_SCHEMA="standards-selected-handover/v1"
MAX_ARCHIVE_BYTES=384*1024*1024

def safe_name(value):
    name=re.sub(r"[^A-Za-z0-9_.-]+","-",str(value)).strip(".-")
    return name[:120] or "standards"

def _publisher():
    if __package__:
        from . import publisher
    else:
        import publisher
    return publisher

def _safe_files(files):
    for name,raw in files.items():
        p=PurePosixPath(name)
        if not isinstance(name,str) or p.is_absolute() or ".." in p.parts or "\\" in name or str(p)!=name or any(ord(c)<32 for c in name):
            raise ValueError("Output path must be an ordinary safe relative file path.")
        if not isinstance(raw,bytes):raise ValueError("Output files must contain bytes.")
    if len(files)>8192 or sum(len(v) for v in files.values())>MAX_ARCHIVE_BYTES:
        raise ValueError("Selected archive exceeds the file/byte limit.")
    return files

def _zip(files,manifest):
    _safe_files(files)
    manifest["files"]={name:{"sha256":hashlib.sha256(raw).hexdigest(),"bytes":len(raw)} for name,raw in sorted(files.items())}
    output=io.BytesIO()
    with zipfile.ZipFile(output,"w",compression=zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
        for name,raw in sorted(files.items()):archive.writestr(name,raw)
        archive.writestr("manifest.json",(engine.canonical(manifest)+"\n").encode())
    return output.getvalue(),manifest

def public_edition(edition):
    """Project only the selected frozen public-facing text and source citations."""
    result=deepcopy(edition)
    result.pop("contributor_ids",None);result.pop("notes",None)
    snap=result["snapshot"]
    if snap.get("scope"):snap["scope"].pop("notes",None)
    public_sources=[s for s in snap["sources"] if s.get("citation_visibility")=="public"]
    allowed={s["id"] for s in public_sources}
    clean_sources=[]
    for s in public_sources:
        clean_sources.append({key:s.get(key) for key in ("id","title","url","publisher","version","language","representation","license","sha256","citation_visibility")})
    snap["sources"]=clean_sources
    for collection in ("clauses","references","cases"):
        for row in snap[collection]:
            row.pop("notes",None)
            row["source_ids"]=[s for s in row.get("source_ids",[]) if s in allowed]
    for case in snap["cases"]:
        retained=[]
        for source_row in case.get("source_rows",[]):
            if not isinstance(source_row,dict):
                continue
            source_id=source_row.get("source_id")
            # A case-level public citation does not authorize private or unbound cells.
            if source_id not in allowed:
                continue
            retained.append(source_row)
        case["source_rows"]=retained
    if snap.get("scope"):snap["scope"]["source_ids"]=[s for s in snap["scope"].get("source_ids",[]) if s in allowed]
    for row in snap["language_reviews"]:
        row.pop("review_id",None)
    result["source_edition_sha256"]=edition["sha256"]
    result["projection_sha256"]=engine.digest(snap)
    result["sha256"]=result["projection_sha256"]
    result["projection_note"]="Selected public text and public citations from the retained edition; contributor identities and internal notes are excluded."
    return result

def export_project(workspace,project_id,audience="private_restore",edition_id=None,publication_id=None,comparison_edition_id=None,include_source_ids=None):
    if audience not in ("private_restore","edition","management"):
        raise ValueError("Choose complete private restore, selected edition, or management handover.")
    state,events,requests,originals=workspace.snapshot(project_id)
    include_source_ids=list(dict.fromkeys(include_source_ids or []))
    files={};source_entries=[]
    manifest={"schema":PRIVATE_SCHEMA if audience=="private_restore" else HANDOVER_SCHEMA,
              "audience":audience,"project_id":project_id,"revision":state["revision"],"project_sha256":engine.digest(state)}
    if audience=="private_restore":
        files.update({"project.json":(engine.canonical(state)+"\n").encode(),
                      "history.json":(engine.canonical(events)+"\n").encode(),
                      "requests.json":(engine.canonical(requests)+"\n").encode()})
        for meta in state["files"]:
            name="originals/"+meta["id"]+"/"+meta["filename"]
            files[name]=originals[meta["id"]];source_entries.append({"file_id":meta["id"],"path":name})
    else:
        publisher=_publisher()
        if audience=="edition":
            if not edition_id:raise ValueError("Select the immutable edition to publish.")
            edition=engine.record(state,"editions",edition_id)
            publication=deepcopy(engine.record(state,"publications",publication_id)) if publication_id else None
            if publication and publication["edition_id"]!=edition_id:raise ValueError("Publication metadata identifies another edition.")
            if publication:
                for key in ("authority_source_ids","notes"):publication.pop(key,None)
            comparison=engine.record(state,"editions",comparison_edition_id) if comparison_edition_id else None
            projected=public_edition(edition)
            files["publication/edition.json"]=(engine.canonical(projected)+"\n").encode()
            files.update(publisher.edition_files(projected,publication=publication,
                          comparison_edition=public_edition(comparison) if comparison else None))
            manifest.update({"edition_id":edition_id,"source_edition_sha256":edition["sha256"],
                             "projection_sha256":projected["projection_sha256"],"comparison_edition_id":comparison_edition_id})
            allowed_sources={s["id"]:s for s in edition["snapshot"]["sources"] if s.get("citation_visibility")=="public"}
        else:
            files.update(publisher.delivery_files(state,engine.analyze(state)))
            files["management/analysis.json"]=(engine.canonical(engine.analyze(state))+"\n").encode()
            allowed_sources={s["id"]:s for s in state["sources"]}
        for source_id in include_source_ids:
            if source_id not in allowed_sources:
                raise ValueError("A selected original is outside this edition's public citation set.")
            source=allowed_sources[source_id]
            if audience=="edition" and not source["public_redistribution"]:
                raise ValueError("This source's original-byte redistribution is not enabled. Its public citation can remain in the document.")
            if not source["source_file_id"]:raise ValueError("Selected source has no retained original file.")
            meta=next(r for r in state["files"] if r["id"]==source["source_file_id"])
            name="sources/"+meta["id"]+"/"+meta["filename"]
            raw=originals[meta["id"]]
            if not source.get("sha256") or source["sha256"]!=meta["sha256"] or source["sha256"]!=hashlib.sha256(raw).hexdigest():
                raise ValueError("Selected source bytes differ from the edition-bound original identity.")
            files[name]=raw
            source_entries.append({"source_id":source_id,"file_id":meta["id"],"sha256":source["sha256"],"path":name})
        manifest["warning"]="This selected handover is not a complete workspace backup and cannot restore private development history."
    manifest["sources"]=source_entries
    return _zip(files,manifest)

def import_project(workspace,raw):
    if not isinstance(raw,bytes) or not raw or len(raw)>MAX_ARCHIVE_BYTES:raise ValueError("Private archive is empty or exceeds384MiB.")
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            entries=z.infolist()
            if len(entries)>8192 or len({r.filename for r in entries})!=len(entries) or sum(r.file_size for r in entries)>MAX_ARCHIVE_BYTES:
                raise ValueError("Archive repeats filenames or exceeds the expanded-file bound.")
            for row in entries:
                p=PurePosixPath(row.filename)
                if row.is_dir() or p.is_absolute() or ".." in p.parts or "\\" in row.filename or str(p)!=row.filename:
                    raise ValueError("Archive has an invalid path.")
            files={r.filename:z.read(r) for r in entries}
    except (zipfile.BadZipFile,RuntimeError,OSError) as exc:raise ValueError("The archive cannot be read as a complete ZIP.") from exc
    manifest=json_read(files.get("manifest.json",b"{}"))
    if manifest.get("schema")!=PRIVATE_SCHEMA or manifest.get("audience")!="private_restore":
        raise ValueError("Only a complete private continuation ZIP restores a project.")
    if set(manifest.get("files",{}))!=set(files)-{"manifest.json"}:raise ValueError("Archive does not match its full file manifest.")
    for name,meta in manifest["files"].items():
        rawfile=files[name]
        if meta.get("bytes")!=len(rawfile) or meta.get("sha256")!=hashlib.sha256(rawfile).hexdigest():
            raise ValueError("Archive file differs from its manifest: "+name)
    state=json_read(files["project.json"]);events=json_read(files["history.json"]);requests=json_read(files["requests.json"])
    if manifest.get("project_id")!=state["id"] or manifest.get("revision")!=state["revision"] or manifest.get("project_sha256")!=engine.digest(state):
        raise ValueError("Manifest and project identity differ.")
    originals={}
    expected=set()
    for row in manifest.get("sources",[]):
        if row["file_id"] in originals:raise ValueError("Archive repeats an original identity.")
        originals[row["file_id"]]=files[row["path"]];expected.add(row["path"])
    if set(files)-{"manifest.json","project.json","history.json","requests.json"}!=expected:
        raise ValueError("Private archive has files outside its explicit original register.")
    return workspace.restore(state,events,requests,originals)
