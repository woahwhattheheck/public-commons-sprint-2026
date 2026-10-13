"""Additive transfer actions on the ORIGINAL operator queue and file tickets.

TokenJunkieLabs. No worker, scheduler, scientific engine or second project store
is created here. The transport cache sits in the original operator state directory.
"""
from __future__ import annotations
from pathlib import Path
import zipfile
import os
from model.project_transfer import TransferStore, TransferError, canonical, digest_id, file_hash, load_json, _atomic
from model.project_transfer_workspace import NativeProjectTransfer
from model.project_transfer_cli import export_report

ACTIONS = frozenset({"project.transfer.capture", "project.transfer.accept", "project.transfer.receive",
                     "project.transfer.parts", "project.transfer.archive", "project.transfer.restore",
                     "project.transfer.report", "project.transfer.inspect", "project.transfer.diff"})


class ProjectTransfers:
    def __init__(self, operator, fault):
        self.operator, self.Fault = operator, fault
        self.stores = {}

    def store(self, workspace_key):
        key = digest_id(workspace_key)
        self.operator.ws(key)
        if key not in self.stores:
            self.stores[key] = TransferStore(self.operator.root / "project-transfers" / key)
        return self.stores[key]

    def invoke(self, task):
        value, action, workspace_key = task["payload"], task["action"], task["workspace"]
        store = self.store(workspace_key)
        ws = self.operator.ws(workspace_key)
        out = self.operator.root / "outputs" / "project-transfers" / digest_id(task["id"])
        out.mkdir(parents=True, exist_ok=True)
        native = NativeProjectTransfer(ws, store.root)
        if action == "project.transfer.capture":
            captured = native.capture(task["id"], include_intermediates=value.get("include_intermediates", True),
                                      include_deliveries=value.get("include_deliveries", True),
                                      chunk_bytes=value.get("chunk_bytes", 4*1024**2))
            snapshot = captured["snapshot"]
            path = out / "project.transfer.json"
            _atomic(path, canonical(snapshot)+b"\n")
            return {"snapshot_id":snapshot["id"],"project":snapshot["archive"]["project"],
                    "files":len(snapshot["members"])-1,"artifacts":[self.describe(path,"Transfer manifest")]}
        if action in {"project.transfer.accept", "project.transfer.receive"}:
            uploaded = self.operator.upload(digest_id(value["upload_id"]))
            if action.endswith("accept"):
                return {"snapshot_id":store.accept_snapshot(load_json(Path(uploaded["path"])))}
            return store.receive_pack(uploaded["path"])
        if action == "project.transfer.parts":
            request = value.get("request")
            if value.get("request_upload_id"):
                if request is not None: raise TransferError("Choose one original receiver request")
                request = load_json(Path(self.operator.upload(digest_id(value["request_upload_id"]))["path"]))
            parts = store.write_parts(value["snapshot_id"],out,request=request,payload_bytes=value.get("payload_bytes",64*1024**2))
            artifacts=[self.describe(out/(value["snapshot_id"]+".transfer.json"),"Complete transfer manifest")]
            artifacts += [self.describe(p["path"],f"Transfer part {index+1}") for index,p in enumerate(parts)]
            return {"snapshot_id":value["snapshot_id"],"parts":len(parts),"payload_bytes":sum(p["payload_bytes"] for p in parts),"artifacts":artifacts}
        if action == "project.transfer.archive":
            result=store.materialize_archive(value["snapshot_id"],out/"scientific-workspace.zip")
            return {**result,"artifacts":[self.describe(result["path"],"Complete original workspace archive")]}
        if action == "project.transfer.restore":
            from model.workspace import Workspace
            result=native.restore(value["snapshot_id"],self.operator.restore_root/digest_id(task["id"]))
            key=self.operator.register(Workspace(result["workspace"]),received=result)
            return {**result,"workspace_key":key}
        if action == "project.transfer.inspect":
            if not value.get("snapshot_id"): return {"snapshots":store.list_snapshots()}
            report=store.report(value["snapshot_id"])
            manifest=out/"project.transfer.json";request=out/"receiver.missing.json"
            _atomic(manifest,canonical(store.snapshot(value["snapshot_id"]))+b"\n")
            _atomic(request,canonical(report["request"])+b"\n",replace=True)
            return {**{k:v for k,v in report.items() if k!="files"},
                    "artifacts":[self.describe(manifest,"Complete transfer manifest"),self.describe(request,"Missing-block request")]}
        if action == "project.transfer.diff":
            result=store.difference(value["before_id"],value["after_id"])
            path=out/"edition-difference.json";_atomic(path,canonical(result)+b"\n")
            return {**result,"artifacts":[self.describe(path,"Complete original-file difference")]}
        if action == "project.transfer.report":
            export_report(store,value["snapshot_id"],out/"report")
            path=out/"transfer-inventory.zip"
            if not path.exists():
                pending=out/".report.pending.zip"
                with zipfile.ZipFile(pending,"w",compression=zipfile.ZIP_DEFLATED) as z:
                    for p in sorted((out/"report").iterdir()): z.write(p,p.name)
                os.link(pending,path);pending.unlink()
            return {"snapshot_id":value["snapshot_id"],"artifacts":[self.describe(path,"Complete HTML, CSV and JSON file inventory")]}
        raise self.Fault("TRANSFER_ACTION", "Choose a supported project transfer operation")

    @staticmethod
    def describe(path, label):
        path=Path(path)
        return {"path":str(path),"bytes":path.stat().st_size,"sha256":file_hash(path),"filename":path.name,"label":label}

    def decorate_task(self, task):
        """Use the already-existing original authenticated download mechanism."""
        if task["action"] not in ACTIONS or task["state"] != "complete": return task
        artifacts=task["result"].get("artifacts",[])
        expected=self.operator.root/"outputs"/"project-transfers"/digest_id(task["id"])
        tickets=[]
        for row in artifacts:
            path=Path(row["path"])
            if path.is_symlink() or not path.resolve().is_relative_to(expected.resolve()):
                raise self.Fault("TRANSFER_FILE", "Select a retained output of the original transfer task",409)
            tickets.append(self.operator._ticket(task["workspace"],path,row,row["label"]))
        task["_downloads"]=tickets
        return task
