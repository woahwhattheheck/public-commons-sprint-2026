# SPDX-License-Identifier: MIT
"""Read and command joins for the existing QGIS analyst evidence pane."""
from __future__ import annotations
import copy
from pathlib import Path
from .model import require, member
from . import parcel_evidence as domain
from . import address_review

ACTIONS = ("address.analyze", "source.inspect", "source.save", "case.save", "finding.save", "source.compare", "succession.save", "report.build")
def normalize(action, value):
    require(action in ACTIONS and isinstance(value, dict), "EVIDENCE_ACTION", "Choose a complete original evidence action.")
    value = copy.deepcopy(value)
    if action == "address.analyze":
        address_review.normalize_payload(value)
        return value
    keys = {
        "source.inspect": (("file",), ("file",)),
        "source.save": (("file","bytes","sha256","definition"), ("file","bytes","sha256","definition")),
        "case.save": (("caseId","previousId","definition"), ("definition",)),
        "finding.save": (("caseId","caseVersionId","findingId","previousId","definition"), ("caseId","caseVersionId","definition")),
        "source.compare": (("caseId","leftSourceId","rightSourceId"), ("caseId","leftSourceId","rightSourceId")),
        "succession.save": (("caseId","leftSourceId","rightSourceId","comparisonSha256","decisions","note"),
                            ("caseId","leftSourceId","rightSourceId","comparisonSha256","decisions","note")),
        "report.build": (("caseId","caseVersionId","title","interpretation","mapRequestIds"), ("caseId","caseVersionId","title","interpretation")),
    }
    domain.exact(value, *keys[action])
    if "file" in value:
        require(isinstance(value["file"], str) and Path(value["file"]).expanduser().is_absolute() and "\0" not in value["file"],
                "EVIDENCE_SOURCE_FILE", "Choose the complete original file on this host.")
        value["file"] = str(Path(value["file"]).expanduser().absolute())
    return value

def execute(workspace, action, value, common, progress=None):
    value = normalize(action, value)
    if action == "address.analyze":
        return address_review.analyze(workspace, value, common)
    if action == "source.inspect":
        return domain.inspect_file(value["file"])
    if action == "source.compare":
        return domain.compare(workspace.read(), value["caseId"], value["leftSourceId"], value["rightSourceId"])
    functions = {"source.save":domain.save_source, "case.save":domain.save_case,
                 "finding.save":domain.save_finding, "succession.save":domain.save_succession,
                 "report.build":domain.build_report}
    return functions[action](workspace, value, common)

def parameter(query, name, default=None):
    values = query.get(name, [default])
    require(len(values) == 1, "EVIDENCE_QUERY", "Select each query field once.")
    return values[0]

def pagination(query):
    try:
        offset, limit = int(parameter(query,"offset","0")), int(parameter(query,"limit","25"))
    except (ValueError, TypeError):
        require(False, "EVIDENCE_PAGE", "Use complete integer page fields.")
    require(0 <= offset <= 10000000 and 1 <= limit <= 100, "EVIDENCE_PAGE", "Read one to 100 original rows.")
    return offset, limit

def paged(rows, query):
    offset, limit = pagination(query)
    return {"items": rows[offset:offset+limit], "offset":offset, "limit":limit, "total":len(rows),
            "complete":offset+limit>=len(rows)}

def read_route(workspace, path, query):
    if path.startswith("/api/evidence/address/"):
        return address_review.read_route(workspace, path, query)
    state = workspace.read()
    saved = domain.data(state)
    if path == "/api/evidence":
        require(not query, "EVIDENCE_QUERY", "Open the original evidence catalogue.")
        return {"schema":domain.SCHEMA,"workspaceId":state["id"],"revision":state["revision"],
            "roles":list(domain.ROLES),"classifications":list(domain.CLASSES),"statuses":list(domain.STATUSES),
            "sources":[{k:v for k,v in row.items() if k not in ("notes",)} for row in saved["sources"]],
            "cases":[{k:row[k] for k in ("id","caseId","title","jurisdiction","asOf","createdAt","actor")}
                     for row in domain.heads(state,"cases")],
            "counts":{kind:len(saved[kind]) for kind in domain.KINDS},
            "nativeProjects":[{"id":p["id"],"file":p["file"],"layers":copy.deepcopy(p.get("layers",[]))}
                              for p in state["projects"]]}
    if path == "/api/evidence/features":
        require(set(query)<= {"sourceId","offset","limit"}, "EVIDENCE_QUERY", "Choose the exact source feature page.")
        return domain.source_rows(workspace, parameter(query,"sourceId"), *pagination(query))
    parts = path.strip("/").split("/")
    if len(parts) == 5 and parts[:3] == ["api","evidence","records"]:
        require(not query and parts[3] in domain.KINDS, "EVIDENCE_QUERY", "Select an original complete record.")
        return copy.deepcopy(domain.get(state,parts[3],parts[4]))
    if len(parts) == 5 and parts[:3] == ["api","evidence","cases"]:
        require(set(query)<= {"offset","limit","history"}, "EVIDENCE_QUERY", "Choose an original case page.")
        case = domain.current(state,"cases",parts[3])
        kind = parts[4]
        if kind == "snapshot":
            require(not query,"EVIDENCE_QUERY","Open the complete selected case.")
            return domain.case_snapshot(state,case["caseId"])
        require(kind in ("findings","successions","reports","observations","history"),
                "EVIDENCE_ROUTE","Select the case findings, source reviews, reports, observations or history.")
        if kind == "history":
            rows = [r for r in saved["cases"] if r["caseId"]==case["caseId"]]
        elif kind == "findings" and parameter(query,"history","0")=="0":
            rows = domain.heads(state,"findings",case["caseId"])
        else:
            rows = [r for r in saved[kind] if r["caseId"]==case["caseId"]]
        return {"caseId":case["caseId"],"caseVersionId":case["id"],"revision":state["revision"],**paged(rows,query)}
    return None

def download_route(workspace, path, query):
    require(not query,"EVIDENCE_QUERY","Select the original complete evidence file.")
    parts = path.strip("/").split("/")
    state = workspace.read()
    if len(parts) == 4 and parts[:3] == ["download","evidence","sources"]:
        row = domain.get(state,"sources",parts[3])
        return {"record":row["file"],"name":row["filename"],"type":row["mediaType"]}
    if len(parts) == 5 and parts[:3] == ["download","evidence","reports"]:
        row = domain.get(state,"reports",parts[3])
        if parts[4] == "zip":
            return {"record":row["archive"],"name":"parcel-evidence-"+row["id"]+".zip","type":"application/zip"}
        names={"html":("OPEN.html","text/html; charset=utf-8"),"json":("case.json","application/json"),
               "findings":("findings.csv","text/csv; charset=utf-8"),"actions":("actions.csv","text/csv; charset=utf-8")}
        require(parts[4] in names,"EVIDENCE_DOWNLOAD","Choose the frozen report or a complete matrix.")
        filename,mime=names[parts[4]]
        found=next((r for r in row["files"] if r["path"].endswith("/"+filename)),None)
        require(found is not None,"EVIDENCE_DOWNLOAD","The frozen original report file is missing.")
        return {"record":found,"name":row["id"]+"-"+filename,"type":mime}
    return None
