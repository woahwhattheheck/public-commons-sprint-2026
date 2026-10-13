#!/usr/bin/env python3
"""Stream complete staff review files through the original workspace transaction."""
from __future__ import annotations
import contextlib, csv, hashlib, json, os, pathlib, sqlite3, tempfile
from arches_workspace import Conflict, canonical, digest, file_hash, now

FIELDS = ("workspace_id","snapshot","revision","context_hash","parent_release",
          "graph_id_json","resource_id_json","change_kind","before_hash","after_hash",
          "blocking","prior_decision_json","selection_sha256","labels_json","issues_json",
          "decision","reason")
SCHEMA = "commons.arches-review-exchange.v1"
csv.field_size_limit(16*1024*1024)
QUERY = """SELECT ch.*,d.decision prior_decision,d.reason prior_reason,d.actor prior_actor,
 d.at prior_at,r.labels,r.issues FROM changes ch
 LEFT JOIN decisions d ON d.snapshot=ch.snapshot AND d.graph_id=ch.graph_id AND d.resource_id=ch.resource_id
 LEFT JOIN records r ON r.snapshot=ch.snapshot AND r.graph_id=ch.graph_id AND r.resource_id=ch.resource_id
 WHERE ch.snapshot=?"""

def _selection(c,snapshot):
    snap=c.execute("SELECT * FROM snapshots WHERE id=?",(snapshot,)).fetchone()
    if not snap:raise KeyError("Unknown edition")
    if c.execute("SELECT 1 FROM releases WHERE snapshot=?",(snapshot,)).fetchone():
        raise Conflict("This edition has already been released")
    meta=dict(c.execute("SELECT key,value FROM meta"))
    return {"workspace_id":meta["workspace_id"],"snapshot":snapshot,"revision":int(meta["revision"]),
            "context_hash":snap["context_hash"],"parent_release":snap["parent_release"]}

def _original(row,selection):
    prior=None if row["prior_decision"] is None else {
        "decision":row["prior_decision"],"reason":row["prior_reason"],
        "actor":row["prior_actor"],"at":row["prior_at"]}
    immutable={**selection,"graph_id":row["graph_id"],"resource_id":row["resource_id"],
               "change_kind":row["kind"],"before_hash":row["before_hash"],
               "after_hash":row["after_hash"],"blocking":bool(row["blocking"]),"prior_decision":prior}
    return {"workspace_id":selection["workspace_id"],"snapshot":selection["snapshot"],
        "revision":str(selection["revision"]),"context_hash":selection["context_hash"],
        "parent_release":selection["parent_release"] or "",
        "graph_id_json":canonical(row["graph_id"]),"resource_id_json":canonical(row["resource_id"]),
        "change_kind":row["kind"],"before_hash":row["before_hash"] or "",
        "after_hash":row["after_hash"] or "","blocking":"yes" if row["blocking"] else "no",
        "prior_decision_json":canonical(prior),"selection_sha256":digest(immutable),
        "labels_json":row["labels"] or "{}","issues_json":row["issues"] or "[]",
        "decision":"","reason":""}

def export_review(workspace,snapshot,destination,kind=None,only_open=True):
    if kind not in (None,"added","changed","removed","meaning"):raise ValueError("Unknown change kind")
    if type(only_open) is not bool:raise ValueError("only_open must be boolean")
    path=pathlib.Path(destination);path.parent.mkdir(parents=True,exist_ok=True)
    count=0;summary={};blocking=0
    with contextlib.closing(workspace.connect()) as c:
        c.execute("BEGIN")
        selection=_selection(c,snapshot)
        query=QUERY;args=[snapshot]
        if kind:query+=" AND ch.kind=?";args.append(kind)
        if only_open:query+=" AND (d.decision IS NULL OR d.decision='defer')"
        with path.open("x",encoding="utf-8",newline="") as out:
            writer=csv.DictWriter(out,fieldnames=FIELDS,lineterminator="\n")
            writer.writeheader()
            for row in c.execute(query+" ORDER BY ch.graph_id,ch.resource_id",args):
                writer.writerow(_original(row,selection));count+=1;blocking+=bool(row["blocking"])
                summary[row["kind"]]=summary.get(row["kind"],0)+1
            out.flush();os.fsync(out.fileno())
        c.rollback()
    sha,size=file_hash(path)
    return {"schema":SCHEMA,**selection,"rows":count,"change_kinds":summary,
            "blocking":blocking,"path":str(path),"bytes":size,"sha256":sha}

@contextlib.contextmanager
def _prepared(workspace,path,snapshot,expected_revision):
    path=pathlib.Path(path)
    if path.is_symlink() or not path.is_file():raise ValueError("Review must be an ordinary CSV file")
    before=file_hash(path)
    if before[1]>2*1024**3:raise ValueError("Review file exceeds 2 GiB")
    # The incoming file is fully parsed before any authoritative mutation.
    # SQLite indexes retain duplicate detection and selected decisions without a giant list.
    with tempfile.TemporaryDirectory(prefix="arches-review-",dir=workspace.root) as temp:
        with contextlib.closing(sqlite3.connect(pathlib.Path(temp)/"review.sqlite3")) as stage:
            stage.row_factory=sqlite3.Row
            stage.execute("CREATE TABLE rows(graph_id TEXT,resource_id TEXT,decision TEXT,reason TEXT,before_hash TEXT,after_hash TEXT,PRIMARY KEY(graph_id,resource_id))")
            selected=0;rows=0;summary={};samples=[]
            with contextlib.closing(workspace.connect()) as c:
                c.execute("BEGIN")
                selection=_selection(c,snapshot)
                if type(expected_revision) is not int or selection["revision"]!=expected_revision:
                    raise Conflict("Workspace changed; export or preview the current edition")
                with path.open("r",encoding="utf-8-sig",newline="") as incoming:
                    reader=csv.DictReader(incoming,strict=True)
                    if reader.fieldnames!=list(FIELDS):raise ValueError("Review columns differ from the original exported file")
                    for row in reader:
                        rows+=1;line=reader.line_num
                        if None in row or any(v is None for v in row.values()):
                            raise ValueError("Incomplete review row at line "+str(line))
                        try:
                            graph=json.loads(row["graph_id_json"]);resource=json.loads(row["resource_id_json"])
                        except (TypeError,ValueError) as e:raise ValueError("Original identity JSON differs at line "+str(line)) from e
                        if not isinstance(graph,str) or not isinstance(resource,str):raise ValueError("Original resource identifiers must remain JSON strings")
                        original=c.execute(QUERY+" AND ch.graph_id=? AND ch.resource_id=?",(snapshot,graph,resource)).fetchone()
                        if not original:raise Conflict("Review names a resource outside this changed edition at line "+str(line))
                        fixed=_original(original,selection)
                        for field in FIELDS[:-2]:
                            if row[field]!=fixed[field]:raise Conflict("Original review field "+field+" changed at line "+str(line))
                        decision=row["decision"].strip()
                        reason=row["reason"].strip()
                        if decision:
                            if decision not in ("approve","reject","defer"):raise ValueError("Decision must approve, reject or defer at line "+str(line))
                            if not reason or len(reason)>4000:raise ValueError("A staff reason of at most 4000 characters is required at line "+str(line))
                            if decision=="approve" and original["blocking"]:
                                raise Conflict("A source-contract issue prevents approval at line "+str(line))
                            selected+=1;summary[decision]=summary.get(decision,0)+1
                            if len(samples)<16:samples.append({"graph_id":graph,"resource_id":resource,"change_kind":original["kind"],"decision":decision,"reason":reason})
                        elif reason:raise ValueError("A reason without a decision is ambiguous at line "+str(line))
                        try:stage.execute("INSERT INTO rows VALUES(?,?,?,?,?,?)",(graph,resource,decision,reason,original["before_hash"],original["after_hash"]))
                        except sqlite3.IntegrityError as e:raise ValueError("Duplicate resource in review at line "+str(line)) from e
                c.rollback()
            if file_hash(path)!=before:raise Conflict("Review file changed while receiving")
            if not selected:raise ValueError("The review contains no staff decisions")
            stage.commit()
            receipt={"schema":SCHEMA,**selection,"source_sha256":before[0],"source_bytes":before[1],
                     "rows":rows,"selected":selected,"decisions":summary}
            receipt["preview_sha256"]=digest(receipt)
            yield stage,{**receipt,"samples":samples}

def preview_review(workspace,path,*,snapshot,expected_revision):
    with _prepared(workspace,path,snapshot,expected_revision) as (_,receipt):return receipt

def apply_review(workspace,path,*,snapshot,preview_sha256,actor,operation_id,expected_revision):
    actor=workspace._validate_actor(actor);sha,size=file_hash(path)
    request={"action":"review-exchange","snapshot":snapshot,"source_sha256":sha,"source_bytes":size,
             "preview_sha256":preview_sha256,"actor":actor}
    # A lost response reopens the original completed operation before requiring
    # the old preview's revision. It never applies the decisions a second time.
    with contextlib.closing(workspace.connect()) as c:
        prior=c.execute("SELECT request_hash,result FROM operations WHERE id=?",(operation_id,)).fetchone()
        if prior:
            if prior["request_hash"]!=digest(request):raise Conflict("This operation ID belongs to a different request")
            return json.loads(prior["result"])
    with _prepared(workspace,path,snapshot,expected_revision) as (stage,receipt):
        if receipt["preview_sha256"]!=preview_sha256:raise Conflict("Preview differs; review the complete current decision file again")
        source=workspace._retain(path,"staff-review")
        if (source["sha256"],source["bytes"])!=(sha,size):raise Conflict("Review source changed before commit")
        with workspace._mutation(operation_id,request,expected_revision) as (c,prior):
            if prior:return prior
            if c.execute("SELECT 1 FROM releases WHERE snapshot=?",(snapshot,)).fetchone():raise Conflict("A released edition cannot be reviewed again")
            at=now()
            for row in stage.execute("SELECT * FROM rows WHERE decision<>'' ORDER BY graph_id,resource_id"):
                c.execute("INSERT OR REPLACE INTO decisions VALUES(?,?,?,?,?,?,?,?,?)",
                    (snapshot,row["graph_id"],row["resource_id"],row["decision"],row["reason"],actor,at,row["before_hash"],row["after_hash"]))
            result={"snapshot":snapshot,"decisions_saved":receipt["selected"],"decisions":receipt["decisions"],
                    "review_source":source,"preview_sha256":preview_sha256}
            c.execute("INSERT INTO review_exchanges VALUES(?,?,?,?,?)",
                      (operation_id,snapshot,canonical(source),canonical(receipt),at))
            return workspace._finish(c,operation_id,request,result,actor,"review-file-received")
