"""Frozen reports, original folder deliveries and complete same-identity restore."""
from __future__ import annotations
import csv
import html
import io
import json
import os
from pathlib import Path
import shutil
import sqlite3
import stat
import zipfile

from .common import (Problem, Lock, atomic_bytes, contained, digest, file_info, inventory,
                     json_bytes, json_text, now, read_json, relative, sync_directory,
                     text, verify_file, verify_inventory, write_json, zip_directory)

def _body(record):
    return {k:v for k,v in record.items() if k not in ("id","project_id","created","updated")}

def _report_root(workspace,report_id):
    return workspace.directory/"reports"/report_id

def _csv(snapshot):
    stream=io.StringIO(newline="")
    writer=csv.writer(stream)
    writer.writerow(["kind","engine","kstp_zero_based","kper_zero_based","native_totim","native_time_unit","layer_zero_based","row_zero_based","column_zero_based","value","mask","native_length_unit","term","flow_in","flow_out","flow_net","rate_units"])
    for engine,content in snapshot["result"]["engines"].items():
        for step in content["heads"]:
            for k,plane in enumerate(step["values"]):
                for i,row in enumerate(plane):
                    for j,value in enumerate(row):
                        writer.writerow(["head",engine,step["kstp"],step["kper"],step["totim"],content["units"]["time"],k,i,j,value,step["mask"][k][i][j],content["units"]["length"],"","","","",""])
        for step in content["budgets"]:
            for term in step["terms"]:
                writer.writerow(["budget_rate",engine,step["kstp"],step["kper"],step["totim"],content["units"]["time"],"","","","","",content["units"]["length"],term["canonical"],term["in"],term["out"],term["net"],step["rate_units"]])
    return stream.getvalue().encode("utf-8")

def _html(snapshot):
    esc=lambda x:html.escape(str(x))
    result=snapshot["result"]
    parts=["<!doctype html><html lang='en'><meta charset='utf-8'><title>"+esc(snapshot["title"])+"</title><style>body{font:15px system-ui,sans-serif;color:#192a36;max-width:1150px;margin:40px auto;padding:0 25px}h1,h2{letter-spacing:-.02em}table{border-collapse:collapse;width:100%;margin:20px 0}th,td{padding:9px;border:1px solid #bcc7ce;text-align:left;vertical-align:top}th{background:#eef2f4}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f1f4f6;padding:16px}img{max-width:100%}.fact{color:#46596a}@media print{body{margin:0}h2{break-after:avoid}table,img{break-inside:avoid}}</style><body>",
           "<p class='fact'>Groundwater scenario report · Frozen original files</p><h1>"+esc(snapshot["title"])+"</h1>",
           "<p>"+esc(snapshot["project"]["name"])+" · "+esc(snapshot["edition"]["name"])+"</p>",
           "<table><tr><th>Original workspace</th><td>"+esc(snapshot["workspace_id"])+"</td></tr><tr><th>Run / edition</th><td>"+esc(result["run_id"])+" / "+esc(result["edition_id"])+"</td></tr><tr><th>Source SHA256</th><td>"+esc(result["source_sha256"])+"</td></tr><tr><th>Result SHA256</th><td>"+esc(digest(result))+"</td></tr><tr><th>Time semantics</th><td>"+esc(result["time_semantics"])+"</td></tr></table>",
           "<h2>Native results and declared units</h2><p>The unchanged publisher numeric comparison and physical unit compatibility are separate. Grid coordinates are model-local; no map CRS has been inferred.</p><table><tr><th>Engine</th><th>Model</th><th>Declared length</th><th>Declared time</th><th>Output steps</th></tr>"]
    for engine,row in result["engines"].items():
        parts.append("<tr><td>"+esc(engine)+"</td><td>"+esc(row["model_id"])+"</td><td>"+esc(row["units"]["length"])+"</td><td>"+esc(row["units"]["time"])+"</td><td>"+esc(len(row["heads"]))+"</td></tr>")
    parts.append("</table><h2>Selected changes</h2><pre>"+esc(json.dumps(snapshot["edition"]["changes"],indent=2))+"</pre><h2>Source and result findings</h2>")
    if snapshot["run"].get("reference_basis") is not None:
        parts.append("<h3>Reference inspection used by this run</h3><p>The original import findings remain in the source record. This run froze the separately attributed inspection below.</p><pre>"+esc(json.dumps(snapshot["run"]["reference_basis"],indent=2))+"</pre><h3>Original import findings</h3><pre>"+esc(json.dumps(snapshot["source"]["findings"],indent=2))+"</pre>")
    for finding in result["findings"]:
        parts.append("<p><strong>"+esc(finding["id"])+"</strong> — "+esc(finding["message"])+"</p>")
    parts.append("<h2>Named review</h2><pre>"+esc(json.dumps(snapshot["review"],indent=2))+"</pre><h2>Paired native aquifers</h2><pre>"+esc(json.dumps(result["cross_engine"],indent=2))+"</pre>")
    for engine in ("mf6","mf2005"):
        parts.append("<h2>"+esc(engine)+" head map</h2><img alt='Native head maps by selected aquifer layer' src='native/analysis/"+engine+"-heads.png'>")
    parts.append("<h2>Budget rates and cumulative volumes</h2><p>Budget rates retain the native length³/time basis. Cumulative volumes are the separately printed native listing values. Internal face flow and normalized specific-discharge vectors are not external inflow terms.</p>")
    for engine,row in result["engines"].items():
        parts.append("<h3>"+esc(engine)+"</h3><pre>"+esc(json.dumps({"budgets":row["budgets"],"listing":row["listing"]},indent=2))+"</pre>")
    parts.append("<h2>Frozen scenario comparisons</h2><pre>"+esc(json.dumps(snapshot["comparisons"],indent=2))+"</pre><h2>Original numerical execution</h2><pre>"+esc(json.dumps(result["native_executions"],indent=2))+"</pre><p>File delivery and this technical review do not record a receiver's acceptance. That decision is appended to the original delivered package separately.</p></body></html>")
    return "".join(parts).encode("utf-8")

def freeze_report(workspace,db,p,actor,op,request_sha):
    from .native import completed_result, _attempt
    from .analysis import compare_results
    run=workspace._record(db,p["run_id"],"run")
    result=completed_result(workspace,run)
    review=workspace._latest_review(db,"run",run["id"],digest(result))
    if not review or review["decision"]!="approved":
        raise Problem("run_review","Approve the exact completed native result before freezing its report.")
    project_id=run["project_id"]
    comparisons=[]
    comparison_runs=[]
    selected=p.get("comparison_run_ids",[])
    if not isinstance(selected,list) or len(selected)>20 or len(selected)!=len(set(selected)):
        raise Problem("comparison_selection","Select up to 20 distinct original comparison runs.",400)
    for comparison_id in selected:
        comparison_run=workspace._record(db,comparison_id,"run")
        if comparison_run["project_id"]!=project_id:
            raise Problem("comparison_project","Comparison run belongs to another project.")
        comparison_result=completed_result(workspace,comparison_run)
        comparisons.append(compare_results(comparison_result,result))
        comparison_runs.append({"run":comparison_run,"edition":workspace._record(db,comparison_run["edition_id"],"edition"),"source":workspace._record(db,comparison_run["source_id"],"source"),"result":comparison_result,"review":workspace._latest_review(db,"run",comparison_id,digest(comparison_result))})
    report_id=workspace._id("report",op)
    root=_report_root(workspace,report_id)
    root.mkdir(parents=True,exist_ok=True)
    request_file=root/"frozen-request.json"
    if request_file.exists():
        prepared=read_json(request_file)
        if prepared["request_sha256"]!=request_sha:
            raise Problem("frozen_request_mismatch","The retained partial report belongs to another original request.")
        snapshot=prepared["snapshot"]
        if snapshot["result"]!=result or snapshot["review"]!=review:
            raise Problem("frozen_basis_changed","The original report preparation is retained; its review or result basis has changed.")
    else:
        edition=workspace._record(db,run["edition_id"],"edition")
        source=workspace._record(db,run["source_id"],"source")
        snapshot={"schema":"starforge.groundwater-report.v1","id":report_id,"title":text(p.get("title"),"Report title",500,True),"workspace_id":workspace._meta(db)["id"],"project":workspace._project(db,project_id),"source":source,"edition":edition,"run":run,"result":result,"review":review,"comparisons":comparisons,"comparison_runs":comparison_runs,"actor":actor,"reason":text(p.get("reason"),"Report purpose",8000,True),"frozen_at":now()}
        write_json(request_file,{"request_sha256":request_sha,"operation_id":op,"snapshot":snapshot},create_only=True)
    native_root=_attempt(workspace,run)
    for row in result["files"]:
        path=contained(native_root,row["path"])
        verify_file(path,row)
        atomic_bytes(contained(root,"native/"+row["path"]),path.read_bytes(),create_only=True)
    for row in snapshot["source"]["files"]:
        atomic_bytes(contained(root,"source/"+row["path"]),workspace.objects.bytes(row),create_only=True)
    for comparison in snapshot.get("comparison_runs",[]):
        selected_root=_attempt(workspace,comparison["run"])
        target="comparisons/"+comparison["run"]["id"]
        for row in comparison["result"]["files"]:
            selected_path=contained(selected_root,row["path"])
            verify_file(selected_path,row)
            atomic_bytes(contained(root,target+"/native/"+row["path"]),selected_path.read_bytes(),create_only=True)
        write_json(contained(root,target+"/result.json"),comparison["result"],create_only=True)
        for row in comparison["source"]["files"]:
            atomic_bytes(contained(root,target+"/source/"+row["path"]),workspace.objects.bytes(row),create_only=True)
    write_json(root/"report.json",snapshot,create_only=True)
    atomic_bytes(root/"report.html",_html(snapshot),create_only=True)
    atomic_bytes(root/"results.csv",_csv(snapshot),create_only=True)
    manifest={"schema":"starforge.groundwater-package.v1","kind":"report","workspace_id":snapshot["workspace_id"],"project_id":project_id,"report_id":report_id,"run_id":run["id"],"source_sha256":run["source_sha256"],"edition_sha256":run["edition_sha256"],"result_sha256":digest(result),"report_sha256":digest(snapshot),"request_sha256":request_sha,"files":inventory(root,excluded=("manifest.json",))}
    write_json(root/"manifest.json",manifest,create_only=True)
    archive_path=workspace.directory/"reports"/(report_id+".zip")
    archive_rows=[*manifest["files"],{"path":"manifest.json",**file_info(root/"manifest.json")}]
    if archive_path.exists():
        package=inspect_package(archive_path)
        if package["manifest"]!=manifest:
            raise Problem("frozen_archive_mismatch","The original report ZIP belongs to different frozen content.")
        archive=package["archive"]
    else:
        archive=zip_directory(root,archive_path,archive_rows)
    body={"run_id":run["id"],"title":snapshot["title"],"sha256":digest(snapshot),"manifest":file_info(root/"manifest.json"),"archive":archive,"operation_id":op,"request_sha256":request_sha,"downloads":{key:f"/api/reports/{report_id}/export?format={key}" for key in ("zip","json","html","csv")}}
    workspace._put(db,report_id,"report",body,project_id)
    return {"id":report_id,"project_id":project_id,"sha256":body["sha256"],"archive":archive}

def verify_report(workspace,report):
    root=_report_root(workspace,report["id"])
    verify_file(root/"manifest.json",report["manifest"])
    manifest=read_json(root/"manifest.json")
    if manifest["report_id"]!=report["id"] or manifest["report_sha256"]!=report["sha256"]:
        raise Problem("report_identity","The frozen report manifest differs from its original record.")
    verify_inventory(root,manifest["files"],exact=True,excluded=("manifest.json",))
    verify_file(workspace.directory/"reports"/(report["id"]+".zip"),report["archive"])
    return manifest

def report_detail(workspace,report_id):
    report=workspace.record(report_id,"report")
    manifest=verify_report(workspace,report)
    with workspace.connect() as db:
        deliveries=[x for x in workspace._list(db,"delivery",report["project_id"]) if x["report_id"]==report_id]
        ids={x["id"] for x in deliveries}
        acknowledgments=[x for x in workspace._list(db,"acknowledgment",report["project_id"]) if x["delivery_id"] in ids]
    return {"report":report,"snapshot":read_json(_report_root(workspace,report_id)/"report.json"),"manifest":manifest,"deliveries":deliveries,"acknowledgments":acknowledgments}

def report_export(workspace,report_id,format):
    report=workspace.record(report_id,"report")
    manifest=verify_report(workspace,report)
    if format=="zip":
        return workspace._file(workspace.directory/"reports"/(report_id+".zip"),report["archive"])
    names={"json":"report.json","html":"report.html","csv":"results.csv"}
    if format not in names:
        raise Problem("export_format","Select zip, json, html or csv.",400)
    name=names[format]
    row=next(x for x in manifest["files"] if x["path"]==name)
    return workspace._file(_report_root(workspace,report_id)/name,row)

def inspect_package(path):
    path=Path(path)
    identity=file_info(path)
    with zipfile.ZipFile(path) as archive:
        infos=archive.infolist()
        names=[]
        expanded=0
        for info in infos:
            if info.is_dir():
                relative(info.filename.rstrip("/"));continue
            relative(info.filename)
            mode=(info.external_attr>>16)&0xFFFF
            if stat.S_ISLNK(mode) or (mode and stat.S_IFMT(mode) not in (0,stat.S_IFREG)):
                raise Problem("archive_special","Frozen package has a link or special member.")
            names.append(info.filename);expanded+=info.file_size
        if len(names)>10000 or expanded>2*1024**3 or len(names)!=len(set(names)) or "manifest.json" not in names:
            raise Problem("package_members","Frozen package requires unique paths, one manifest and supported bounds.")
        manifest_raw=archive.read("manifest.json")
        manifest=json.loads(manifest_raw)
        if manifest.get("schema")!="starforge.groundwater-package.v1":
            raise Problem("package_schema","This is not a groundwater original-file package.")
        rows=manifest.get("files",[])
        reserved={"manifest.json","receiving-request.json","receiving.json",".receiving.lock"}
        if not isinstance(rows,list) or any(row.get("path") in reserved for row in rows if isinstance(row,dict)):
            raise Problem("package_members","Manifest members cannot replace the original receiving control files.")
        expected={relative(row["path"]):row for row in rows}
        if len(expected)!=len(rows) or set(expected)|{"manifest.json"}!=set(names):
            raise Problem("package_members","Frozen ZIP and manifest member sets differ.")
        import hashlib
        for name,row in expected.items():
            h=hashlib.sha256();size=0
            with archive.open(name) as stream:
                while chunk:=stream.read(1024*1024):
                    h.update(chunk);size+=len(chunk)
            if size!=row["bytes"] or h.hexdigest()!=row["sha256"]:
                raise Problem("package_identity","Frozen ZIP member differs from its exact manifest.",path=name)
    verify_file(path,identity)
    return {"archive":identity,"manifest_sha256":digest(manifest_raw),"manifest":manifest,"files":len(expected),"expanded_bytes":expanded}

def _publish_destination_request(root,name,request,lock_name):
    """Called under the original destination lock before any extraction."""
    marker=root/name
    if marker.is_symlink():
        raise Problem("receiving_destination","The original receiving marker is linked.")
    if marker.exists():
        if read_json(marker)!=request:
            raise Problem("receiving_destination","This destination retains a different original request.")
        return
    pending=sorted(root.glob("."+name+".*.tmp"))
    allowed={lock_name}
    if pending:
        if len(pending)!=1 or pending[0].is_symlink() or not pending[0].is_file() or pending[0].stat().st_size>65536:
            raise Problem("receiving_pending_ambiguous","Preserve the ambiguous original receiving publication.")
        try:
            retained=read_json(pending[0])
        except (OSError,ValueError) as exc:
            raise Problem("receiving_pending_incomplete","The original receiving request temporary is incomplete and was preserved.",detail=str(exc)) from exc
        if retained!=request:
            raise Problem("receiving_destination","The pending original request names a different archive or destination.")
        allowed.add(pending[0].name)
    if any(path.name not in allowed for path in root.iterdir()):
        raise Problem("receiving_destination","Choose an empty destination or its same original request; unbound files were preserved.")
    write_json(marker,request,create_only=True)
    if pending:
        pending[0].unlink()
        from .common import sync_directory
        sync_directory(root)

def receive_package(path,destination):
    path,destination=Path(path),Path(destination).resolve()
    package=inspect_package(path)
    request={"archive":package["archive"],"manifest_sha256":package["manifest_sha256"],"kind":package["manifest"]["kind"]}
    destination.mkdir(parents=True,exist_ok=True)
    with Lock(destination/".receiving.lock"):
        _publish_destination_request(destination,"receiving-request.json",request,".receiving.lock")
        with zipfile.ZipFile(path) as archive:
            for row in [*package["manifest"]["files"],{"path":"manifest.json","bytes":len(archive.read("manifest.json")),"sha256":package["manifest_sha256"]}]:
                raw=archive.read(row["path"])
                if len(raw)!=row["bytes"] or digest(raw)!=row["sha256"]:
                    raise Problem("package_changed","The selected archive changed during receiving.")
                atomic_bytes(contained(destination,row["path"]),raw,create_only=True)
        verify_file(path,package["archive"])
        verify_inventory(destination,package["manifest"]["files"])
        receipt_path=destination/"receiving.json"
        if receipt_path.exists():
            receipt=read_json(receipt_path)
            if receipt["archive_sha256"]!=package["archive"]["sha256"]:
                raise Problem("receiving_identity","The original receiving receipt has a different archive identity.")
        else:
            receipt={"schema":"starforge.groundwater-receiving.v1","workspace_id":package["manifest"].get("workspace_id"),"report_id":package["manifest"].get("report_id"),"archive_sha256":package["archive"]["sha256"],"archive_bytes":package["archive"]["bytes"],"manifest_sha256":package["manifest_sha256"],"received_at":now(),"files":package["files"],"decision":"unreviewed"}
            write_json(receipt_path,receipt,create_only=True)
    return {"receipt":receipt,"directory":str(destination),"manifest":package["manifest"]}

def deliver(workspace,delivery_id):
    delivery=workspace.record(delivery_id,"delivery")
    folder=Path(delivery["receiver"]["directory"])
    if not folder.is_dir() or folder.is_symlink():
        raise Problem("receiver_unavailable","The original selected receiving directory is unavailable.")
    target=folder/delivery["filename"]
    with Lock(workspace.directory/"deliveries"/(delivery_id+".lock")):
        try:
            if target.exists():
                verify_file(target,delivery)
            else:
                source=report_export(workspace,delivery["report_id"],"zip")
                atomic_bytes(target,source["path"].read_bytes(),create_only=True)
                verify_file(target,delivery)
            receipt={"schema":"starforge.groundwater-folder-delivery.v1","delivery_id":delivery_id,"report_id":delivery["report_id"],"report_sha256":delivery["report_sha256"],"sha256":delivery["sha256"],"bytes":delivery["bytes"],"filename":delivery["filename"],"delivered_at":now(),"receiving_decision":"unreviewed"}
            receipt_path=folder/(delivery_id+".receipt.json")
            if receipt_path.exists():
                old=read_json(receipt_path)
                if any(old.get(key)!=receipt[key] for key in ("delivery_id","report_id","report_sha256","sha256","bytes","filename")):
                    raise Problem("receipt_identity","The existing receiving receipt differs from this original delivery.")
                receipt=old
            else:
                write_json(receipt_path,receipt,create_only=True)
            with Lock(workspace.directory/"workspace.lock"),workspace.connect() as db:
                db.execute("BEGIN IMMEDIATE")
                current=workspace._record(db,delivery_id,"delivery")
                workspace._put(db,delivery_id,"delivery",{**_body(current),"state":"complete","receipt":receipt,"issue":None},current["project_id"])
        except BaseException as exc:
            issue=exc.as_dict() if isinstance(exc,Problem) else {"code":type(exc).__name__,"message":str(exc)}
            with Lock(workspace.directory/"workspace.lock"),workspace.connect() as db:
                current=workspace._record(db,delivery_id,"delivery")
                workspace._put(db,delivery_id,"delivery",{**_body(current),"state":"uncertain","issue":issue},current["project_id"])
            raise
    return workspace.record(delivery_id,"delivery")

def reconcile_delivery(workspace,db,delivery):
    folder=Path(delivery["receiver"]["directory"])
    path=folder/delivery["filename"]
    verify_file(path,delivery)
    package=inspect_package(path)
    if package["manifest"]["report_id"]!=delivery["report_id"] or package["manifest"]["report_sha256"]!=delivery["report_sha256"]:
        raise Problem("delivery_identity","The received package does not match the original report.")
    receipt_path=folder/(delivery["id"]+".receipt.json")
    if not receipt_path.exists():
        raise Problem("delivery_receipt_missing","The original bytes are present; resume this same delivery to complete its receipt.")
    receipt=read_json(receipt_path)
    if receipt.get("delivery_id")!=delivery["id"] or receipt.get("sha256")!=delivery["sha256"]:
        raise Problem("delivery_identity","The original folder receipt differs.")
    workspace._put(db,delivery["id"],"delivery",{**_body(delivery),"state":"complete","receipt":receipt,"issue":None},delivery["project_id"])
    return {"id":delivery["id"],"project_id":delivery["project_id"],"state":"complete","receipt":receipt}

def finish_backup(workspace,backup_id):
    record=workspace.record(backup_id,"backup")
    output=workspace.directory/"backups"/backup_id
    archive=workspace.directory/"backups"/(backup_id+".zip")
    if record["status"]=="complete":
        backup_file(workspace,backup_id)
        return record
    try:
        with Lock(workspace.directory/"native.lock",blocking=False),Lock(workspace.directory/"workspace.lock"):
            output.mkdir(parents=True,exist_ok=True)
            request_path=output/"backup-request.json"
            marker={"workspace_id":workspace.state()["workspace"]["id"],"backup_id":backup_id,"request_sha256":record["request_sha256"],"operation_id":record["operation_id"]}
            if request_path.exists() and read_json(request_path)!=marker:
                raise Problem("backup_identity","The original backup preparation differs.")
            write_json(request_path,marker,create_only=True)
            snapshot_path=output/"workspace"/"groundwater.sqlite"
            snapshot_path.parent.mkdir(parents=True,exist_ok=True)
            capture_path=output/"capture.json"
            if not capture_path.exists():
                if snapshot_path.exists():
                    raise Problem("backup_capture_ambiguous","The original SQLite snapshot exists without its captured file manifest; preserve it for inspection.")
                with workspace.connect() as source,sqlite3.connect(snapshot_path) as destination:
                    source.backup(destination)
                rows=[]
                for root_name in ("objects","runs","reports","deliveries"):
                    for row in inventory(workspace.directory/root_name):
                        rows.append({"path":"workspace/"+root_name+"/"+row["path"],"source":root_name+"/"+row["path"],"bytes":row["bytes"],"sha256":row["sha256"]})
                for initial_name in ("initialization.json","initialization-publication.json","initialization-complete.json"):
                    if (workspace.directory/initial_name).is_file():
                        rows.append({"path":"workspace/"+initial_name,"source":initial_name,**file_info(workspace.directory/initial_name)})
                app_rows=[]
                for row in inventory(workspace.application):
                    if "__pycache__" in row["path"] or any(x in row["path"].split("/") for x in (".git",".venv","node_modules","build","dist")):
                        continue
                    app_rows.append({"path":"application/"+row["path"],"source":row["path"],"bytes":row["bytes"],"sha256":row["sha256"]})
                capture={"workspace":rows,"application":app_rows,"database":file_info(snapshot_path),"captured_at":now()}
                write_json(capture_path,capture,create_only=True)
            capture=read_json(capture_path)
            verify_file(snapshot_path,capture["database"])
            for key,source_root in (("workspace",workspace.directory),("application",workspace.application)):
                for row in capture[key]:
                    source=contained(source_root,row["source"])
                    target=contained(output,row["path"])
                    if target.exists():
                        verify_file(target,row)
                    else:
                        verify_file(source,row)
                        atomic_bytes(target,source.read_bytes(),create_only=True)
            manifest={"schema":"starforge.groundwater-package.v1","kind":"workspace_backup","workspace_id":marker["workspace_id"],"backup_id":backup_id,"captured_at":capture["captured_at"],"files":inventory(output,excluded=("manifest.json",))}
            write_json(output/"manifest.json",manifest,create_only=True)
            if archive.exists():
                package=inspect_package(archive)
                if package["manifest"]!=manifest:
                    raise Problem("backup_archive_identity","The retained archive differs from this original backup.")
                identity=package["archive"]
            else:
                identity=zip_directory(output,archive,[*manifest["files"],{"path":"manifest.json",**file_info(output/"manifest.json")}])
            with workspace.connect() as db:
                current=workspace._record(db,backup_id,"backup")
                workspace._put(db,backup_id,"backup",{**_body(current),"status":"complete","filename":archive.name,**identity,"manifest_sha256":digest(json_bytes(manifest)),"captured_at":capture["captured_at"],"files":len(manifest["files"]),"issue":None})
            return workspace.record(backup_id,"backup")
    except BaseException as exc:
        issue=exc.as_dict() if isinstance(exc,Problem) else {"code":type(exc).__name__,"message":str(exc)}
        with workspace.connect() as db:
            current=workspace._record(db,backup_id,"backup")
            workspace._put(db,backup_id,"backup",{**_body(current),"status":"failed","issue":issue})
        raise

def backup_file(workspace,backup_id):
    record=workspace.record(backup_id,"backup")
    if record["status"]!="complete":
        raise Problem("backup_unavailable","The selected backup has no locally available completed archive.",status=409,backup_status=record["status"])
    path=workspace.directory/"backups"/record["filename"]
    verify_file(path,record)
    package=inspect_package(path)
    if package["manifest"]["workspace_id"]!=workspace.state()["workspace"]["id"] or package["manifest"]["backup_id"]!=backup_id:
        raise Problem("backup_identity","The archive is not this original workspace backup.")
    return workspace._file(path,record)

def restore_workspace(archive,destination):
    package=inspect_package(archive)
    if package["manifest"]["kind"]!="workspace_backup":
        raise Problem("restore_kind","Select a complete workspace backup.")
    root=Path(destination).resolve()
    request={"archive_sha256":package["archive"]["sha256"],"workspace_id":package["manifest"]["workspace_id"]}
    root.mkdir(parents=True,exist_ok=True)
    with Lock(root/".restore.lock"):
        _publish_destination_request(root,"restore-request.json",request,".restore.lock")
        received=receive_package(archive,root/"received")
        restored_marker=root/"restored.json"
        if restored_marker.exists():
            result=read_json(restored_marker)
            if result["archive_sha256"]!=request["archive_sha256"]:
                raise Problem("restore_identity","The original restore marker names another archive.")
            return result
        workspace_dir=root/"workspace"
        working_marker=root/"working-copy.json"
        if not working_marker.exists():
            for row in package["manifest"]["files"]:
                if row["path"].startswith("workspace/"):
                    source=contained(root/"received",row["path"])
                    verify_file(source,row)
                    atomic_bytes(contained(root,row["path"]),source.read_bytes(),create_only=True)
            write_json(working_marker,request,create_only=True)
        from .store import Workbench
        restored=Workbench(workspace_dir,root/"received"/"application",existing_only=True)
        with Lock(workspace_dir/"workspace.lock"),restored.connect() as db:
            meta=restored._meta(db)
            if meta["id"]!=request["workspace_id"]:
                raise Problem("restore_identity","The restored SQLite ID differs from the original archive.")
            if meta.get("restored_from")!=request["archive_sha256"]:
                for backup in restored._list(db,"backup"):
                    restored._put(db,backup["id"],"backup",{**_body(backup),"status":"external_archive","original_archive_history":{k:backup.get(k) for k in ("status","filename","sha256","bytes","manifest_sha256")},"restored_from":request["archive_sha256"]})
                for run in restored._list(db,"run"):
                    if run["state"]=="running":
                        restored._put(db,run["id"],"run",{**_body(run),"state":"interrupted","issue":{"code":"restored_interrupted","message":"Original run is restored without an automatic restart. Inspect its retained attempt and configure an identical runtime before explicit continuation."}},run["project_id"])
                db.execute("INSERT INTO meta VALUES('restored_from',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",(request["archive_sha256"],))
        result={"schema":"starforge.groundwater-restore.v1","workspace_id":request["workspace_id"],"workspace":str(workspace_dir),"application":str(root/"received"/"application"),"archive_sha256":request["archive_sha256"],"original_operations_preserved":True,"automatic_run":False,"restored_at":now()}
        write_json(restored_marker,result,create_only=True)
        return result
