#!/usr/bin/env python3
"""Prepare the original Audit following-review selection from complete retained source."""
import argparse,copy,fcntl,hashlib,html,json,os,pathlib,sqlite3,stat,sys,tempfile
def sha(raw): return hashlib.sha256(raw).hexdigest()
def data(value): return (json.dumps(value,ensure_ascii=False,sort_keys=True,indent=2,allow_nan=False)+"\n").encode()
def read(path): return json.loads(pathlib.Path(path).read_bytes())
def ordinary(path):
    path=pathlib.Path(path)
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    with os.fdopen(fd,"rb") as stream:
        first=os.fstat(stream.fileno()); assert stat.S_ISREG(first.st_mode),str(path)
        body=stream.read(); last=os.fstat(stream.fileno())
    assert (first.st_dev,first.st_ino,first.st_size,first.st_mtime_ns,first.st_ctime_ns)==(last.st_dev,last.st_ino,last.st_size,last.st_mtime_ns,last.st_ctime_ns)
    assert len(body)==first.st_size
    return body
def identity(path):
    raw=ordinary(path);return {"path":str(pathlib.Path(path).absolute()),"bytes":len(raw),"sha256":sha(raw)}
def put(path,raw):
    path=pathlib.Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    if path.exists():
        assert ordinary(path)==raw,str(path)
    else:
        fd,name=tempfile.mkstemp(prefix="."+path.name+".",suffix=".pending",dir=path.parent)
        try:
            with os.fdopen(fd,"wb") as stream:stream.write(raw);stream.flush();os.fsync(stream.fileno())
            try:os.link(name,path,follow_symlinks=False)
            except FileExistsError:assert ordinary(path)==raw,str(path)
        finally:os.unlink(name)
    fd=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY)
    try:os.fsync(fd)
    finally:os.close(fd)
def main():
    p=argparse.ArgumentParser(description=__doc__)
    for name in ("application","queue","case","output","result","descriptors","lock-paths"):
        p.add_argument("--"+name,required=True)
    a=p.parse_args();app=pathlib.Path(a.application).resolve();case=pathlib.Path(a.case).resolve()
    queue=pathlib.Path(a.queue).resolve();out=pathlib.Path(a.output).resolve()
    fds=[int(v) for v in a.descriptors.split(",")];paths=a.lock_paths.split("\n")
    assert len(fds)==len(paths)==2
    for fd,path in zip(fds,paths):
        held=os.fstat(fd);selected=os.stat(path,follow_symlinks=False)
        assert stat.S_ISREG(held.st_mode) and (held.st_dev,held.st_ino)==(selected.st_dev,selected.st_ino)
        fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
    queue_fd=os.open(queue/"operation.lock",os.O_RDONLY|os.O_NOFOLLOW)
    try:
        fcntl.flock(queue_fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        completed=read(queue/"COMPLETE.json");run=read(queue/"RUN_RESULT.json")
        assert completed["operation"]==run["operation"]=="AUDIT-RECIPIENT-REVIEW-QUEUE-24EA-20261013"
        assert completed["input"]==run["input"] and run["native"]=="complete"
        assert {k:identity(completed["archive"]["path"])[k] for k in ("bytes","sha256")}=={k:completed["archive"][k] for k in ("bytes","sha256")}
        directory=pathlib.Path(run["input"]["workspace"]).resolve()
        assert directory==case/"workspaces"/"author"
        dbpath=directory/"audit-exchange.sqlite";assert dbpath.is_file() and not dbpath.is_symlink()
        sys.path.insert(0,str(app))
        from workspace import Workspace,APPLICATION_ID
        from review_transition import preview
        ws=Workspace.__new__(Workspace);ws.directory=directory;ws.database=dbpath
        db=sqlite3.connect(dbpath.as_uri()+"?mode=ro",uri=True,isolation_level=None)
        db.row_factory=sqlite3.Row
        try:
            db.execute("PRAGMA query_only=ON");db.execute("BEGIN")
            assert db.execute("PRAGMA application_id").fetchone()[0]==APPLICATION_ID
            meta=ws._meta(db);assert meta["workspaceId"]==run["input"]["workspaceId"]
            assert not any(r["status"] in {"queued","running"} for r in ws._all(db,"analysis"))
            sources=ws._all(db,"source");revisions={r["id"]:r for r in ws._all(db,"revision")};reviews=ws._all(db,"review")
            groups=[];objects={};source_rows=[]
            for source in sources:
                current=revisions[source["currentRevisionId"]]
                assert current["sourceId"]==source["id"]
                earlier=[r for r in reviews if r["sourceId"]==source["id"] and revisions[r["revisionId"]]["number"]<current["number"]]
                chosen_revisions={current["id"]}|{r["revisionId"] for r in earlier}
                full=[]
                for rid in sorted(chosen_revisions,key=lambda k:revisions[k]["number"]):
                    rev=revisions[rid];raw=ws._bytes(db,rev["sha256"])
                    assert len(raw)==rev["bytes"] and sha(raw)==rev["sha256"]
                    objects[rev["sha256"]]=raw
                    full.append(copy.deepcopy(rev))
                source_rows.append({"source":copy.deepcopy(source),"revisions":full,"earlierReviews":copy.deepcopy(earlier)})
                if earlier:
                    groups.append({"sourceId":source["id"],"toRevisionId":current["id"],"reviewIds":[r["id"] for r in earlier]})
            # These are this programme's authored editorial decisions for its actual
            # original case, not inferred field measurements or automatic closure.
            corrected_path=case/"colleague-return"/"result.json"
            corrected=read(corrected_path)
            assert corrected["operation"]=="AUDIT-EXCHANGE-NATIVE-6804-20261012" and corrected["status"]=="passed"
            assert corrected["workspaceId"]==meta["workspaceId"]
            source_id=corrected["selection"]["original"]["sourceId"]
            source=next((r for r in sources if r["id"]==source_id),None)
            chosen=next((r for r in groups if r["sourceId"]==source_id),None)
            policy={"id":"original-corrected-source-reassessment-v1","actor":run["input"]["specification"]["operator"],
                    "purpose":"Explicitly reopen the original source-bound findings for investigation after the completed native building-name corrections. Preserve original assertions, evidence and full earlier decisions; do not claim issue closure or new field observations.",
                    "colleagueResult":identity(corrected_path),"queueResult":identity(queue/"RUN_RESULT.json")}
            state="no-eligible-original-reviews";selection=None;comparison=None;reason=""
            if source is None:
                state="needs-explicit-source-selection";reason="The original corrected source is absent from the current author."
            elif chosen:
                target=revisions[chosen["toRevisionId"]];entities=target["model"]["entities"]
                buildings=[r for r in entities if r.get("semanticKind")=="building"]
                shared=[r for r in entities if r.get("semanticKind")=="system" and r.get("kind")=="HVACSystem"
                        and set(r.get("buildingKeys",[]))=={v["key"] for v in buildings}]
                if len(buildings)!=2 or len(shared)!=1 or len(chosen["reviewIds"])>250:
                    state="needs-explicit-source-selection";reason="The current source no longer has the uniquely identified original two-building shared-HVAC scope or exceeds one complete review selection."
                else:
                    comparison=preview(ws,db,chosen)
                    decisions=[]
                    for item in comparison["reviews"]:
                        old=item["review"];original_entity=item["beforeEntity"];key=old.get("entityKey","")
                        matches=[]
                        if key and original_entity and original_entity.get("xmlId"):
                            fields=("xmlId","namespace","kind")
                            matches=[r for r in entities if all(r.get(k)==original_entity.get(k) for k in fields)]
                            old_entities=revisions[old["revisionId"]]["model"]["entities"]
                            old_matches=[r for r in old_entities if all(r.get(k)==original_entity.get(k) for k in fields)]
                            if len(old_matches)!=1:matches=[]
                        if not key or len(matches)==1:
                            fields={k:copy.deepcopy(old.get(k,[] if k=="evidence" else "")) for k in ("entityKey","status","title","note","assignee","dueDate","evidence")}
                            fields["entityKey"]=matches[0]["key"] if key else ""
                            fields["status"]="investigating"
                            note="Reassess this original finding against the completed building-name corrections. Earlier decisions and evidence remain in its native history; this continuation asserts no new field observation or resolved condition."
                            fields["note"]=(old.get("note","")+"\n\n"+note).strip()
                            decisions.append({"reviewId":old["id"],"mode":"update","reason":policy["purpose"],"review":fields})
                        else:
                            decisions.append({"reviewId":old["id"],"mode":"retain","reason":"Keep this finding on its actual earlier revision: the selected original entity lacks a unique namespace/kind/XML-ID match in both complete native models. Deliberate current-entity selection is still required."})
                    selection={"workspaceId":meta["workspaceId"],**chosen,"decisions":decisions,
                        "title":"Original corrected Audit — explicit finding reassessment",
                        "note":policy["purpose"],"actor":policy["actor"]}
                    state="source-bound-selection-ready"
            snapshot={"format":"commons.audit-exchange.following-review-selection.v1","workspace":meta,
                "application":str(app),"predecessor":identity(queue/"COMPLETE.json"),
                "sourceGroups":groups,"sources":source_rows,"policy":policy,"status":state,"reason":reason,
                "preview":comparison,"selection":selection}
            raw=data(snapshot);destination=out/"observations"/sha(raw)
            put(destination/"complete-original-source-and-reviews.json",raw)
            for value,body in objects.items():put(destination/"sources"/(value+".xml"),body)
            if selection:put(destination/"SELECTION.json",data(selection))
            rows="".join("<tr><td>"+html.escape(r["source"]["name"])+"</td><td>"+html.escape(r["source"]["id"])+"</td><td>"+str(len(r["earlierReviews"]))+"</td></tr>" for r in source_rows)
            links="".join("<li><a href='sources/"+key+".xml'>Complete XML "+key+"</a></li>" for key in sorted(objects))
            selection_link="<p><a href='SELECTION.json'>Complete authored reassessment selection</a></p>" if selection else ""
            page=("<!doctype html><html lang='en'><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>Original Audit following review</title><style>body{font:16px/1.5 system-ui;color:#222;max-width:1100px;margin:2rem auto;padding:0 1rem}table{border-collapse:collapse;width:100%}th,td{border:1px solid #aaa;padding:.5rem;text-align:left;overflow-wrap:anywhere}a{color:#222}div{overflow:auto}</style><h1>Original Audit following review</h1><p>"+html.escape(state)+": "+html.escape(reason)+"</p><p>"+html.escape(policy["purpose"])+"</p><p><a href='complete-original-source-and-reviews.json'>Complete original models, validation, reviews, comparison and source selection</a></p>"+selection_link+"<div><table><tr><th>Source</th><th>Original identity</th><th>Earlier findings</th></tr>"+rows+"</table></div><h2>Complete original XML</h2><ul>"+links+"</ul><p>Use the installed Review following revisions controls for deliberate alternate decisions. The current source and earlier reviews must still match its native preview before any apply.</p></html>").encode()
            put(destination/"OPEN.html",page)
            names=["complete-original-source-and-reviews.json","OPEN.html"]+["sources/"+key+".xml" for key in sorted(objects)]+(["SELECTION.json"] if selection else [])
            manifest={"format":"commons.audit-exchange.review-selection-files.v1","files":[identity(destination/name) for name in names]}
            put(destination/"files.json",data(manifest))
            result={"status":state,"workspaceId":meta["workspaceId"],"version":meta["version"],
                    "source":identity(destination/"complete-original-source-and-reviews.json"),
                    "manifest":identity(destination/"files.json"),"open":identity(destination/"OPEN.html"),
                    "selection":identity(destination/"SELECTION.json") if selection else None}
            put(a.result,data(result));print(json.dumps(result),flush=True)
        finally:db.close()
    finally:os.close(queue_fd)
if __name__=="__main__":main()
