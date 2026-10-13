"""Exact first field-issue publication and retained returned files in the original workspace.

No secondary database or provider operation. The existing Workspace owns all
blob bytes, first commands, revision checks and full-history receiving.
"""
import base64, copy
from pathlib import Path
from .common import *
from . import field_exchange
from .exchange import source_inventory

def _descriptor(data):
    return {"sha256":sha(data),"bytes":len(data)}

def _raw_blob(workspace, descriptor):
    require(isinstance(descriptor,dict) and set(descriptor)=={"sha256","bytes"},
            "FIELD_DESCRIPTOR","Use the complete original field-file identity.")
    data=workspace.read_blob(sha_id(descriptor["sha256"]))
    require(type(descriptor["bytes"]) is int and len(data)==descriptor["bytes"],
            "FIELD_FILE_CHANGED","The saved field-file byte length differs.")
    return data

def render_field_html(document, source_root, selection):
    root,files=source_inventory(source_root,selection)
    inventory={item["path"]:item for item in files}
    assets={}
    for name in ("field-copy.html","field-copy.js","field-copy.css"):
        path="public/"+name
        require(path in inventory,"FIELD_EDITOR_SOURCE","The complete field editor is absent from this selected source.")
        raw=read_regular(root/path)
        item=inventory[path]
        require(len(raw)==item["bytes"] and sha(raw)==item["sha256"],
                "SOURCE_CHANGED","The selected field-editor source changed.")
        try: assets[name]=raw.decode("utf-8")
        except UnicodeError:fail("FIELD_EDITOR_SOURCE","Field-editor source must be complete UTF-8.")
    template=assets["field-copy.html"]
    replacements={"__HIGHWAY_FIELD_CSS__":assets["field-copy.css"],
                  "__HIGHWAY_FIELD_JS__":assets["field-copy.js"],
                  "__HIGHWAY_FIELD_RETURN__":canonical(document).decode("utf-8").replace("<",r"\u003c")}
    for token in replacements:
        require(template.count(token)==1,"FIELD_EDITOR_SOURCE","Field-editor template marker is missing or repeated.")
    require("</script" not in assets["field-copy.js"].lower() and
            "</style" not in assets["field-copy.css"].lower(),
            "FIELD_EDITOR_SOURCE","Field-editor source would escape its embedded element.")
    # Replace the document last, so source strings cannot be confused with user data.
    result=template.replace("__HIGHWAY_FIELD_CSS__",replacements["__HIGHWAY_FIELD_CSS__"])
    result=result.replace("__HIGHWAY_FIELD_JS__",replacements["__HIGHWAY_FIELD_JS__"])
    result=result.replace("__HIGHWAY_FIELD_RETURN__",replacements["__HIGHWAY_FIELD_RETURN__"])
    data=result.encode("utf-8")
    require(len(data)<=MAX_BLOB,"FIELD_FILE_LIMIT","The complete editable field file exceeds its 64 MiB allowance.")
    return data

def issue_field(workspace, request, expected_revision, source_root, selection):
    """Retain the complete request externally before invoking this original writer."""
    require(isinstance(request,dict),"FIELD_REQUEST","Use the complete field issue request.")
    require(set(request)=={"id","recipient","inspectionIds","workspaceRevision","stateSha256","note","actor","at"},
            "FIELD_REQUEST","Retain every original field-issue input.")
    identifier(request.get("id"))
    require(type(expected_revision) is int and expected_revision>=0,
            "REVISION","Retain the exact original workspace revision.")
    original=copy.deepcopy(request)
    with workspace.lock:
        workspace._active()
        old=workspace.request(original["id"])
        if old is not None:
            envelope=old["envelope"];command=envelope["command"]
            require(envelope["expectedRevision"]==expected_revision and command["kind"]=="field.issue" and
                    command["body"]["id"]==original["id"],
                    "REQUEST_CONFLICT","This original issue UUID belongs to another request.")
            raw=_raw_blob(workspace,command["body"]["document"])
            issued=loads(raw)
            retained={key:issued[key] for key in original if key in issued}
            require(canonical(retained)==canonical(original) and
                    command["actor"]==original.get("actor") and command["at"]==original.get("at"),
                    "REQUEST_CONFLICT","Original issue inputs cannot be replaced on retry.")
            _raw_blob(workspace,command["body"]["html"])
            result=workspace.execute(command,expected_revision)
            return {**result,"issue":{"id":original["id"],"document":command["body"]["document"],
                                     "html":command["body"]["html"]}}
        current=workspace.current()
        require(current["revision"]==expected_revision,"REVISION_CONFLICT",
                "The workspace changed. Retain this issue request and review the current source before issuing another.")
        require(original.get("workspaceRevision")==expected_revision and
                original.get("stateSha256")==current["sha256"],
                "FIELD_SOURCE_CHANGED","The issue must select the exact original workspace state.")
        issued=field_exchange.prepare_issue(current["state"],original,workspace.read_blob)
        raw=canonical(issued)
        require(len(raw)<=MAX_BLOB,"FIELD_FILE_LIMIT","The complete selected field issue exceeds its 64 MiB allowance.")
        html_raw=render_field_html(field_exchange.initial_return(raw),source_root,selection)
        document=_descriptor(raw);html=_descriptor(html_raw)
        # Capacity is checked for the full selected pair before either object is added.
        unique={document["sha256"]:raw,html["sha256"]:html_raw}
        needed=sum(len(data) for key,data in unique.items()
                   if workspace.db.execute("SELECT 1 FROM blobs WHERE sha256=?",(key,)).fetchone() is None)
        used=workspace.db.execute("SELECT COALESCE(SUM(bytes),0) FROM blobs").fetchone()[0]
        require(used+needed<=MAX_BLOBS,"WORKSPACE_CAPACITY","The complete field issue and editable file exceed the original workspace capacity.")
        for key,data in unique.items():workspace.put_blob(data,key)
        command={"requestId":original["id"],"kind":"field.issue","actor":original["actor"],
                 "at":original["at"],"body":{"id":original["id"],"document":document,"html":html}}
        result=workspace.execute(command,expected_revision)
        return {**result,"issue":{"id":original["id"],"document":document,"html":html}}

def retain_return(workspace, raw, expected_sha256=None):
    """Receive the complete original file and its added bytes; no review is adopted."""
    require(isinstance(raw,bytes) and len(raw)<=MAX_BLOB,
            "FIELD_FILE_LIMIT","Choose a complete field JSON or editable HTML no larger than 64 MiB.")
    identity=_descriptor(raw)
    if expected_sha256 is not None:
        require(identity["sha256"]==sha_id(expected_sha256),
                "FIELD_FILE_CHANGED","Selected field-file bytes differ from their original hash.")
    with workspace.lock:
        workspace._active()
        prepared=field_exchange.prepare_return(workspace.current()["state"],raw,workspace.read_blob)
        document=prepared["document"]
        payloads={identity["sha256"]:raw}
        for key,data in prepared["blobs"].items():
            require(isinstance(data,bytes) and sha(data)==key and len(data)<=MAX_BLOB,
                    "FIELD_ATTACHMENT","Original field preparation returned changed source bytes.")
            require(key not in payloads or payloads[key]==data,"FIELD_ATTACHMENT","Repeated source identity differs.")
            payloads[key]=data
        needed=sum(len(data) for key,data in payloads.items()
                   if workspace.db.execute("SELECT 1 FROM blobs WHERE sha256=?",(key,)).fetchone() is None)
        used=workspace.db.execute("SELECT COALESCE(SUM(bytes),0) FROM blobs").fetchone()[0]
        require(used+needed<=MAX_BLOBS,"WORKSPACE_CAPACITY","All returned files must fit before intake.")
        for key,data in payloads.items():workspace.put_blob(data,key)
    return {**identity,"issueId":document.get("issueId"),
            "selectedEditionId":document.get("selectedEditionId"),
            "editions":[{key:edition.get(key) for key in ("id","parentId","label","actor","at")}
                        for edition in document.get("editions",[])],
            "attachmentCount":len(document["blobs"]),"draftRetained":document.get("draft") is not None}


def field_file(workspace, kind, identity, format="original"):
    """Read exact issued/returned bytes after independent whole-workspace receiving."""
    require(kind in ("issues","returns"),"FIELD_KIND","Choose an issued or returned field file.")
    with workspace.lock:
        current=workspace.current()
        record=field_exchange.read_document(current["state"],kind,identity,workspace.read_blob)["record"]
        if kind=="issues":
            require(format in ("original","json","html"),"FIELD_FORMAT","Choose original JSON or editable HTML.")
            descriptor=record["html"] if format=="html" else record["document"]
        else:
            require(format=="original","FIELD_FORMAT","Returned files are downloaded in their exact original format.")
            descriptor=record["document"]
        raw=_raw_blob(workspace,descriptor)
        is_json=raw.lstrip().startswith(b"{")
        media="application/json" if is_json else "text/html"
        filename=("Highway_Field_Issue_" if kind=="issues" else "Highway_Field_Return_")+identity+(".json" if is_json else ".html")
        return raw,media,filename

def compare_field(workspace, return_id, edition_id=None, adoption_id=None):
    """Reopen current or exact historical review using the original retained states."""
    with workspace.lock:
        current=workspace.current()
        if adoption_id is None:
            comparison=field_exchange.compare_return(current["state"],return_id,workspace.read_blob,edition_id)
            return {**comparison,"workspaceRevision":current["revision"],"currentWorkspaceRevision":current["revision"],"readOnly":False}
        records=current["state"].get("fieldExchange",{}).get("adoptions",[])
        adoption=next((row for row in records if row["id"]==adoption_id),None)
        require(adoption is not None and adoption["returnId"]==return_id,
                "FIELD_ADOPTION","Choose the original adoption of this returned file.")
        require(edition_id is None or adoption["editionId"]==edition_id,
                "FIELD_ADOPTION","The saved review used another named field edition.")
        original=workspace.db.execute("SELECT revision,body FROM states WHERE sha256=? ORDER BY revision LIMIT 1",
                                     (adoption["sourceStateSha256"],)).fetchone()
        require(original is not None,"FIELD_HISTORY","The complete original review state is absent.")
        require(sha(original["body"])==adoption["sourceStateSha256"],
                "FIELD_HISTORY","The retained original review state bytes differ.")
        comparison=field_exchange.compare_return(loads(original["body"]),return_id,
                                                   workspace.read_blob,adoption["editionId"])
        require(comparison["sha256"]==adoption["reviewSha256"],
                "FIELD_HISTORY","The original receiving comparison differs from its saved decision.")
        return {**comparison,"workspaceRevision":original["revision"],"currentWorkspaceRevision":current["revision"],"readOnly":True,
                "historicalAdoption":copy.deepcopy(adoption)}
