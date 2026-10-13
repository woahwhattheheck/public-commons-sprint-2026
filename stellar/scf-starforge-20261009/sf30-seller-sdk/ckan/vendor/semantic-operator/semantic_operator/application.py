"""Versioned semantic engineering workspace and its single native worker."""
from __future__ import annotations
import base64
import contextlib
import fcntl
import hashlib
import hmac
import os
from pathlib import Path
import re
import secrets
import shutil
import sqlite3
import subprocess
import sys
import threading
import time
from .security import (atomic_write, canonical, digest, private_directory, private_read, read_json,
                       PrivateVault, pack_files, unpack_files, encrypt_recovery, decrypt_recovery, MAX_FILE)
from .store import ApplicationStore, identifier, now, standalone_database
from .worker import load_state, verified_result, relative, JOB_SCHEMA, DATASET_JOB_SCHEMA, job_schema
from .dataset_application import DatasetOperations

ROOT = Path(__file__).resolve().parent.parent
KINDS = ("source", "mapping", "snapshot", "validation", "query", "comparison", "decision", "job", "receiving", "recovery")
FORMATS = {"turtle":"text/turtle", "nt":"application/n-triples", "xml":"application/rdf+xml",
           "json-ld":"application/ld+json", "csv":"text/csv", "json":"application/json",
           "trig":"application/trig", "nquads":"application/n-quads"}
ROLES = {"data", "table", "ontology", "shapes"}
TERMINAL = {"complete", "failed", "cancelled", "interrupted"}
NATIVE_ACTIONS = {"source.inspect":"inspect", "snapshot.build":"snapshot",
                  "validation.run":"validate", "query.run":"query", "comparison.run":"compare"}

def text(value, label, maximum=8000, *, empty=False):
    if not isinstance(value, str) or (not empty and not value.strip()) or len(value)>maximum or "\0" in value:
        raise ValueError(label + " is missing or exceeds its supported length.")
    return value.strip()

def integer(value, label, low, high):
    if type(value) is not int or not low <= value <= high:
        raise ValueError(label + " must be an integer from " + str(low) + " to " + str(high) + ".")
    return value

def decoded(value):
    if not isinstance(value, str):
        raise ValueError("Keep the exact original file bytes in data_base64.")
    try:
        data = base64.b64decode(value, validate=True)
    except (ValueError, TypeError) as exc:
        raise ValueError("The original file bytes are not valid base64.") from exc
    if len(data)>MAX_FILE:
        raise ValueError("A source or native result file exceeds 64 MiB.")
    return data

def iri(value, label):
    if not isinstance(value, str) or not re.match(r"^[A-Za-z][A-Za-z0-9+.-]*:", value) or any(c.isspace() for c in value):
        raise ValueError(label + " must be an absolute IRI.")
    return value

class SemanticApplication(DatasetOperations):
    def __init__(self, root, *, start_worker=True):
        self.root = private_directory(root)
        self.lock = threading.RLock()
        self._owner = os.open(self.root/"workspace.lock", os.O_CREAT|os.O_RDWR|getattr(os,"O_NOFOLLOW",0), 0o600)
        try:
            fcntl.flock(self._owner, fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError as exc:
            os.close(self._owner)
            raise ValueError("This workspace already has a running operator. Use its original local address.") from exc
        self.store = ApplicationStore(self.root)
        self.vault = PrivateVault(self.root/"private")
        self.jobs_root = private_directory(self.root/"native-jobs")
        self.receiving_root = private_directory(self.root/"receiving")
        self.stop = threading.Event()
        self.wake = threading.Event()
        self.child = None
        self.child_job = None
        self.child_started = None
        self.child_log = None
        self.thread = None
        self.closed = False
        self.received_hosts = {}
        if start_worker:
            self.thread = threading.Thread(target=self._supervise, name="semantic-native-worker", daemon=True)
            self.thread.start()

    def _id(self, kind, operation_id):
        return kind+"-"+digest(canonical({"workspace":self.store.workspace_id,"operation_id":operation_id}))[:28]

    def _revision(self, kind, key, revision=None):
        identifier(key)
        current = self.store.document(kind, key)
        if revision is None or revision == current["revision"]:
            return current
        integer(revision, "Source revision", 1, current["revision"])
        for row in self.store.history(kind, key):
            if row["revision"] == revision:
                return row
        raise KeyError("The original selected revision does not exist.")

    def _write(self, kind, key, payload, operation_id, actor, expected_revision=0):
        # A business revision can commit before its HTTP result is delivered.
        # Reconcile that exact original revision before checking a retry's stale revision.
        for row in self.store.history(kind, key):
            if row["payload"].get("_operation_id") == operation_id:
                return row
        return self.store.save(kind, key, {**payload, "_operation_id":operation_id},
                               actor=actor, expected_revision=expected_revision)

    def _fingerprint(self, payload):
        value = dict(payload)
        if "data_base64" in value:
            value["data_base64"] = {"sha256":digest(decoded(value["data_base64"]))}
        if value.get("catalog_data_base64"):
            value["catalog_data_base64"] = {"sha256":digest(decoded(value["catalog_data_base64"]))}
        if "passphrase" in value:
            secret = value["passphrase"]
            if not isinstance(secret,str):
                raise ValueError("Enter the recovery passphrase.")
            value["passphrase"] = {"private_hmac":hmac.new(self.vault.key,secret.encode(),hashlib.sha256).hexdigest()}
        return value

    def perform(self, action, payload, *, operation_id, actor):
        identifier(operation_id, "Operation ID")
        text(actor, "Local operator", 200)
        if not isinstance(payload, dict):
            raise ValueError("Operation inputs must be a JSON object.")
        actions = {
            "source.import":self._source_import, "source.reference":self._source_reference, "source.profile":self._source_profile,
            "source.inspect":self._source_inspect, "mapping.save":self._mapping_save,
            "snapshot.build":self._snapshot_build, "validation.run":self._validation_run,
            "query.run":self._query_run, "comparison.run":self._comparison_run,
            "decision.save":self._decision_save, "job.continue":self._job_continue,
            "job.cancel":self._job_cancel, "handoff.export":self._handoff_export,
            "handoff.receive":self._handoff_receive, "recovery.export":self._recovery_export,
            "recovery.restore":self._recovery_restore, "workspace.open":self._workspace_open,
        }
        if action not in actions:
            raise ValueError("Choose a supported semantic operation.")
        with self.lock:
            if self.closed:
                raise ValueError("This operator has closed.")
            original = self.store.begin(operation_id, action, self._fingerprint(payload), actor)
            if original is not None:
                return original
            try:
                result = self._resume_pinned_job(NATIVE_ACTIONS[action], payload, operation_id, actor) if action in NATIVE_ACTIONS else None
                if result is None:
                    result = actions[action](payload, operation_id, actor)
                return self.store.finish(operation_id, result)
            except BaseException as exc:
                self.store.interrupted(operation_id, exc)
                raise
            finally:
                self.wake.set()

    def _source_import(self, p, op, actor):
        data = decoded(p["data_base64"])
        if not data:
            raise ValueError("Choose a nonempty original source file.")
        format = p.get("format")
        role = p.get("role")
        if format not in FORMATS or role not in ROLES or (format=="csv") != (role=="table"):
            raise ValueError("Choose the original RDF format and role, or CSV with the table role.")
        key = p.get("id") or self._id("source",op)
        if p.get("id") and "expected_revision" not in p:
            raise ValueError("A source edit requires its current expected_revision.")
        artifact = self.store.add_artifact(data, name=text(p["name"],"Source filename",240),
            media_type=FORMATS[format], role="source",
            source_reference=text(p["source_reference"],"Original source reference"))
        record = {"title":text(p["title"],"Source title",300), "format":format, "role":role,
                  "edition":text(p.get("edition",""),"Source edition",500,empty=True),
                  "license":text(p.get("license",""),"Source license",2000,empty=True),
                  "source_reference":artifact["source_reference"], "artifact_id":artifact["id"],
                  "sha256":artifact["sha256"], "bytes":artifact["bytes"]}
        if p.get("catalog_data_base64"):
            if format != "nquads":
                raise ValueError("A graph catalogue companion belongs to an N-Quads source.")
            catalogue = decoded(p["catalog_data_base64"])
            value = read_json(catalogue)
            if not isinstance(value,dict) or value.get("schema") != "commons-semantic-graph-catalog/1":
                raise ValueError("Choose the original dataset graph catalogue JSON.")
            if value.get("nquads_sha256") != record["sha256"]:
                raise ValueError("The companion catalogue belongs to different N-Quads bytes.")
            catalog = self.store.add_artifact(catalogue,
                name=text(p.get("catalog_name","graph-catalog.json"),"Catalogue filename",240),
                media_type="application/json",role="source-graph-catalog",
                source_reference=record["source_reference"]+" / retained graph catalogue")
            record["dataset_catalog"]={k:catalog[k] for k in ("id","sha256","bytes","name")}
        return self._write("source",key,record,op,actor,p.get("expected_revision",0))

    def references(self):
        manifest = read_json((ROOT/"reference/SOURCE-MANIFEST.json").read_bytes())
        return manifest

    def _source_reference(self, p, op, actor):
        name = relative(p["path"])
        original = next((f for f in self.references()["files"] if f["path"] == name), None)
        if original is None:
            raise KeyError("Choose one of the bundled original reference sources.")
        data = (ROOT/"reference"/name).read_bytes()
        if len(data) != original["bytes"]:
            raise ValueError("The bundled original reference size changed.")
        if original.get("git_blob_sha"):
            actual = hashlib.sha1(b"blob "+str(len(data)).encode()+b"\0"+data).hexdigest()
            if actual != original["git_blob_sha"]:
                raise ValueError("The bundled original reference differs from its upstream Git object.")
        ext = Path(name).suffix
        format = {".ttl":"turtle",".nt":"nt",".rdf":"xml",".jsonld":"json-ld",".trig":"trig",".nq":"nquads"}.get(ext)
        if not format:
            raise ValueError("Choose a supported original RDF graph or dataset source.")
        role = p.get("role","data")
        return self._source_import({"data_base64":base64.b64encode(data).decode(), "title":p.get("title",Path(name).name),
            "name":Path(name).name,"format":format,"role":role,"license":original.get("license") or "",
            "source_reference":original.get("git_blob_url") or original.get("source_url") or original.get("repo","")+" / "+original.get("source_path",name),
            "edition":original.get("git_blob_sha") or self.references().get("retrieved_at","")},op,actor)

    def _source_profile(self, p, op, actor):
        profile=next((item for item in self.references().get("profiles",[]) if item["id"]==p.get("profile_id")),None)
        if profile is None:
            raise ValueError("Choose one of the retained documented reference profiles.")
        rows=[]
        for role,paths in (("shapes",profile["shape_paths"]),("ontology",profile.get("ontology_paths",[]))):
            for index,path in enumerate(paths):
                # Each source has its own stable original sub-operation. A disk
                # interruption can resume the full profile without duplicate rows.
                child="profile-source-"+digest(canonical({"operation":op,"role":role,"path":path}))[:32]
                row=self._source_reference({"path":path,"role":role,
                    "title":profile["title"]+" / "+Path(path).name},child,actor)
                rows.append(row)
        return {"profile_id":profile["id"],"title":profile["title"],
                "source_reference":profile["source_reference"],"note":profile["note"],
                "sources":rows,"original_files_retained":True}

    def _source_input(self, ref, key=None):
        if not isinstance(ref,dict):
            raise ValueError("Keep each selected source ID and revision together.")
        row = self._revision("source",ref["id"],ref.get("revision"))
        p = row["payload"]
        meta = self.store.artifact(p["artifact_id"])
        return {"key":key or "source-"+row["id"]+"-r"+str(row["revision"]), "artifact_id":meta["id"],
                "sha256":meta["sha256"], "bytes":meta["bytes"], "format":p["format"],
                "role":p["role"],"source_id":row["id"], "revision":row["revision"],
                "title":p["title"], "source_reference":p["source_reference"]}

    def _source_inspect(self, p, op, actor):
        source = self._source_input(p["source"],"selected")
        if p.get("data_model") == "dataset" or source["format"] in ("trig","nquads"):
            return self._dataset_inspect(p,op,actor)
        return self._new_job("inspect",[source],{"input_key":"selected"},p,op,actor)

    def _mapping_save(self, p, op, actor):
        source = self._source_input(p["source"])
        if source["format"]!="csv":
            raise ValueError("A declarative mapping uses an original CSV source.")
        definition = p.get("definition")
        if not isinstance(definition,dict) or set(definition)-{"subject_template","classes","delimiter","null_values","fields"}:
            raise ValueError("Choose the supported explicit CSV mapping fields.")
        definition = read_json(canonical(definition))
        text(definition.get("subject_template"),"Subject IRI template",2000)
        iri(definition["subject_template"],"Subject IRI template")
        if not isinstance(definition.get("classes",[]),list):
            raise ValueError("Mapped RDF classes must be an array.")
        for c in definition.setdefault("classes",[]): iri(c,"Mapped RDF class")
        delimiter=definition.setdefault("delimiter",",")
        if not isinstance(delimiter,str) or len(delimiter)!=1 or delimiter in "\r\n\0":
            raise ValueError("A CSV delimiter must be one character.")
        nulls=definition.setdefault("null_values",[""])
        if not isinstance(nulls,list) or any(not isinstance(n,str) for n in nulls):
            raise ValueError("Declare the exact CSV null strings.")
        fields=definition.get("fields")
        if not isinstance(fields,list) or not fields:
            raise ValueError("Map at least one CSV column.")
        for field in fields:
            if not isinstance(field,dict) or set(field)-{"column","predicate","kind","datatype","language","iri_template"}:
                raise ValueError("A mapping field contains unsupported properties.")
            text(field.get("column"),"CSV column",500)
            iri(field.get("predicate"),"Mapped predicate")
            if field.get("kind") not in ("literal","iri"):
                raise ValueError("Choose literal or IRI for each field.")
            if field.get("datatype"): iri(field["datatype"],"Literal datatype")
            if field.get("datatype") and field.get("language"):
                raise ValueError("A literal may have a datatype or language.")
            if field.get("language") and not re.fullmatch(r"[A-Za-z]+(?:-[A-Za-z0-9]+)*",field["language"]):
                raise ValueError("Choose a valid literal language tag.")
            if field["kind"]=="iri" and (field.get("datatype") or field.get("language")):
                raise ValueError("IRI mappings do not carry literal datatypes or language tags.")
            if field.get("iri_template"): iri(field["iri_template"],"Object IRI template")
        key=p.get("id") or self._id("mapping",op)
        if p.get("id") and "expected_revision" not in p:
            raise ValueError("A mapping edit requires its current expected_revision.")
        return self._write("mapping",key,{"title":text(p["title"],"Mapping title",300),
            "source":{"id":source["source_id"],"revision":source["revision"],"sha256":source["sha256"]},
            "definition":definition,"review_note":text(p.get("review_note",""),"Mapping review note",8000,empty=True)},
            op,actor,p.get("expected_revision",0))

    def _snapshot_build(self, p, op, actor):
        if p.get("data_model") == "dataset":
            return self._dataset_build(p,op,actor)
        if p.get("data_model","graph") != "graph":
            raise ValueError("Choose graph or dataset snapshot mode.")
        inputs, data_keys, mappings = [], [], []
        for index, ref in enumerate(p.get("sources",[])):
            item=self._source_input(ref,"data-"+str(index))
            if item["format"] not in ("turtle","nt","xml","json-ld") or item["role"]!="data":
                raise ValueError("Snapshot data must use original RDF data sources.")
            inputs.append(item); data_keys.append(item["key"])
        for index, ref in enumerate(p.get("mappings",[])):
            row=self._revision("mapping",ref["id"],ref.get("revision"))
            item=self._source_input(row["payload"]["source"],"table-"+str(index))
            if item["sha256"]!=row["payload"]["source"]["sha256"]:
                raise ValueError("The mapping's original table identity changed.")
            inputs.append(item)
            mappings.append({**row["payload"]["definition"],"mapping_id":row["id"],"revision":row["revision"],"input_key":item["key"]})
        if not inputs:
            raise ValueError("Choose at least one RDF source or CSV mapping.")
        return self._new_job("snapshot",inputs,{"data_keys":data_keys,"mappings":mappings},p,op,actor)

    def _snapshot_input(self, ref, key="graph", role="graph"):
        row=self._revision("snapshot",ref["id"],ref.get("revision"))
        item=next((v for v in row["payload"]["files"] if v["role"]==role),None)
        if item is None:
            raise KeyError("The selected snapshot has no complete "+role+" output.")
        meta=self.store.artifact(item["artifact_id"])
        return {"key":key,"artifact_id":meta["id"],"sha256":meta["sha256"],"bytes":meta["bytes"],
                "format":{"graph":"nt","dataset":"nquads"}.get(role,"json"),
                "role":"snapshot" if role in ("graph","dataset") else role,
                "source_id":row["id"],"revision":row["revision"],"title":row["payload"]["title"],
                "source_reference":"Original snapshot "+row["id"]+" revision "+str(row["revision"])}

    def _validation_run(self,p,op,actor):
        if self._dataset_snapshot(p["snapshot"]):
            return self._dataset_validate(p,op,actor)
        inputs=[self._snapshot_input(p["snapshot"])]
        shapes,ontologies=[],[]
        for role,refs,keys in (("shapes",p.get("shapes",[]),shapes),("ontology",p.get("ontologies",[]),ontologies)):
            for index,ref in enumerate(refs):
                item=self._source_input(ref,role+"-"+str(index))
                if item["role"]!=role or item["format"] not in ("turtle","nt","xml","json-ld"):
                    raise ValueError("Choose original RDF "+role+" inputs.")
                inputs.append(item);keys.append(item["key"])
        if not shapes:
            raise ValueError("Select the SHACL shapes that define this validation.")
        inference=p.get("inference","none")
        if inference not in ("none","rdfs","owlrl","both"):
            raise ValueError("Choose an explicit inference mode.")
        for name in ("allow_infos","allow_warnings"):
            if name in p and type(p[name]) is not bool:
                raise ValueError(name+" must be true or false.")
        return self._new_job("validate",inputs,{"graph_key":"graph","shape_keys":shapes,"ontology_keys":ontologies,
            "inference":inference,"allow_infos":p.get("allow_infos",False),"allow_warnings":p.get("allow_warnings",False)},p,op,actor)

    def _query_run(self,p,op,actor):
        if self._dataset_snapshot(p["snapshot"]):
            return self._dataset_query(p,op,actor)
        query=text(p.get("query"),"SPARQL query",100000)
        limit=integer(p.get("row_limit",10000),"Query row limit",1,100000)
        return self._new_job("query",[self._snapshot_input(p["snapshot"])],{"graph_key":"graph","query":query,"row_limit":limit},p,op,actor)

    def _comparison_run(self,p,op,actor):
        if self._dataset_snapshot(p["before"]) or self._dataset_snapshot(p["after"]):
            return self._dataset_compare(p,op,actor)
        inputs=[self._snapshot_input(p["before"],"before"),self._snapshot_input(p["after"],"after")]
        params={"before_graph_key":"before","after_graph_key":"after",
                "before_provenance_key":None,"after_provenance_key":None}
        for side in ("before","after"):
            with contextlib.suppress(KeyError):
                item=self._snapshot_input(p[side],side+"-provenance","provenance")
                inputs.append(item);params[side+"_provenance_key"]=item["key"]
        edges=p.get("edge_predicates",[])
        if not isinstance(edges,list): raise ValueError("Impact predicates must be an array of IRIs.")
        for value in edges: iri(value,"Impact predicate")
        params.update(edge_predicates=edges,depth=integer(p.get("depth",2),"Impact depth",0,8),
                      node_limit=integer(p.get("node_limit",100000),"Impact node limit",1,100000))
        return self._new_job("compare",inputs,params,p,op,actor)

    def _decision_save(self,p,op,actor):
        target_kind=p.get("record_kind")
        if target_kind not in ("mapping","snapshot","validation","query","comparison"):
            raise ValueError("Link a decision to an exact engineering record.")
        target=self._revision(target_kind,p["record_id"],p.get("record_revision"))
        disposition=p.get("disposition")
        if disposition not in ("accepted","changes_requested","reviewed"):
            raise ValueError("Choose an explicit review disposition.")
        key=p.get("id") or self._id("decision",op)
        if p.get("id") and "expected_revision" not in p:
            raise ValueError("A decision edit requires its current expected_revision.")
        return self._write("decision",key,{"title":text(p["title"],"Decision title",300),
            "record_kind":target_kind,"record_id":target["id"],"record_revision":target["revision"],
            "record_sha256":target["sha256"],"disposition":disposition,
            "note":text(p["note"],"Review decision",16000)},op,actor,p.get("expected_revision",0))

    def _resume_pinned_job(self, action, p, op, actor):
        # job.json can commit before the application row under interruption or
        # ENOSPC. It is the original selection, even if mutable source heads have
        # since advanced. begin() already checked the original request fingerprint.
        key = self._id("job", op)
        path = self.jobs_root / key / "job.json"
        if not path.exists():
            return None
        raw = private_read(path)
        original = read_json(raw)
        if job_schema(original) not in (JOB_SCHEMA,DATASET_JOB_SCHEMA):
            raise ValueError("The retained job has an unsupported graph or dataset contract.")
        expected = {"job_id":key, "action":action,
                    "operation_id":op, "actor":actor, "workspace_id":self.store.workspace_id,
                    "input_storage":"workspace-content-addressed/1"}
        if not isinstance(original, dict) or any(original.get(k) != v for k,v in expected.items()):
            raise ValueError("The retained native job belongs to another original request or workspace.")
        prior = self.store.history("job", key)
        if prior:
            if prior[0]["payload"].get("job_sha256") != digest(raw):
                raise ValueError("The original retained native job no longer matches its application history.")
            return prior[0]
        return self._new_job(action, original["inputs"], original["parameters"], p, op, actor)

    def _new_job(self,action,inputs,parameters,p,op,actor):
        key=self._id("job",op)
        prior=self.store.history("job",key)
        if prior:
            return prior[0]
        timeout=integer(p.get("timeout_seconds",120),"Native timeout",5,600)
        memory=integer(p.get("memory_mib",1024),"Native memory budget",256,4096)
        title=text(p.get("title",action.title()+" operation"),"Operation title",300)
        schema=DATASET_JOB_SCHEMA if parameters.get("data_model")=="dataset" else JOB_SCHEMA
        original={"schema":schema,"job_id":key,"action":action,"inputs":inputs,"parameters":parameters,
                  "limits":{"timeout_seconds":timeout,"memory_mib":memory},
                  "operation_id":op,"actor":actor,"workspace_id":self.store.workspace_id,"input_storage":"workspace-content-addressed/1"}
        raw=canonical(original)
        directory=private_directory(self.jobs_root/key)
        for item in inputs:
            identifier(item["key"],"Native input key")
            meta,data=self.store.artifact(item["artifact_id"],with_bytes=True)
            if meta["sha256"]!=item["sha256"] or len(data)!=item["bytes"]:
                raise ValueError("The selected native input changed before capture.")
        if (directory/"job.json").exists():
            if private_read(directory/"job.json")!=raw:
                raise ValueError("The original native job belongs to different pinned inputs.")
        else:
            atomic_write(directory/"job.json",raw,replace=False)
        return self._write("job",key,{"title":title,"action":action,"status":"queued","job_sha256":digest(raw),
            "spec":original,"generation":0,"native_result":None,"result_record":None,
            "created_by":actor,"original_operation_id":op},op,actor)

    def _job_continue(self,p,op,actor):
        key=identifier(p["job_id"])
        row=self.store.document("job",key)
        self._adopt_completed(row)
        row=self.store.document("job",key)
        if row["payload"]["status"]=="complete":
            return row
        if row["payload"]["status"] in ("running","queued","cancelling"):
            return row
        directory=self.jobs_root/key
        if self.child_job==key and self.child and self.child.poll() is None:
            raise ValueError("The original native worker is still closing.")
        raw=private_read(directory/"job.json")
        if digest(raw)!=row["payload"]["job_sha256"]:
            raise ValueError("Continue requires the original job and its unchanged pinned inputs.")
        marker=directory/"cancel.json"
        if marker.exists():
            private_read(marker)
            marker.unlink()
        return self._write("job",key,{**row["payload"],"status":"queued","error":None,
            "continued_at":now(),"continued_by":actor},op,actor,row["revision"])

    def _job_cancel(self,p,op,actor):
        key=identifier(p["job_id"])
        row=self.store.document("job",key)
        self._adopt_completed(row)
        row=self.store.document("job",key)
        if row["payload"]["status"] in TERMINAL:
            return row
        directory=self.jobs_root/key
        marker=directory/"cancel.json"
        if not marker.exists():
            atomic_write(marker,canonical({"job_id":key,"operation_id":op,"actor":actor,"at":now()}),replace=False)
        live=self.child_job==key and self.child and self.child.poll() is None
        status="cancelling" if live else "cancelled"
        result=self._write("job",key,{**row["payload"],"status":status,"cancelled_by":actor},op,actor,row["revision"])
        if live:
            self.child.terminate()
        return result

    def _save_job_status(self,row,changes):
        payload={**row["payload"],**changes}
        if canonical(payload)==canonical(row["payload"]):
            return row
        return self.store.save("job",row["id"],payload,actor="local native worker",expected_revision=row["revision"])

    def _adopt_completed(self,row):
        result=verified_result(self.jobs_root/row["id"])
        if result is None:
            return False
        if row["payload"]["status"]=="complete":
            if row["payload"]["native_result"]["job_sha256"]!=result["job_sha256"]:
                raise ValueError("The original adopted native result changed.")
            return True
        outputs=self.jobs_root/row["id"]/"attempts"/str(result["generation"])/"outputs"
        retained=[]
        for item in result["files"]:
            meta=self.store.add_artifact(private_read(outputs/item["path"]),name=Path(item["path"]).name,
                media_type=item["media_type"],role="native-"+item["role"],
                source_reference="Original native job "+row["id"]+" / "+item["path"])
            retained.append({**item,"artifact_id":meta["id"]})
        kind={"inspect":None,"snapshot":"snapshot","validate":"validation","query":"query","compare":"comparison"}[result["action"]]
        record=None
        if kind:
            key=kind+"-"+digest(row["id"].encode())[:28]
            adoption="adopt-"+row["id"]
            record=self._write(kind,key,{"title":row["payload"]["title"],"job_id":row["id"],
                "summary":result["summary"],"warnings":result.get("warnings",[]),"files":retained,
                "inputs":row["payload"]["spec"]["inputs"],"parameters":row["payload"]["spec"]["parameters"],
                "native_generation":result["generation"],"completed_at":result["completed_at"]},
                adoption,"local native worker")
        native={**result,"files":retained}
        self._save_job_status(self.store.document("job",row["id"]),{"status":"complete",
            "generation":result["generation"],"native_result":native,
            "result_record":{"kind":kind,"id":record["id"],"revision":record["revision"]} if record else None,
            "completed_at":result["completed_at"],"error":None})
        return True

    def _stop_owned_child(self):
        if self.child is not None and self.child.poll() is None:
            self.child.terminate()
            try:
                self.child.wait(timeout=3)
            except subprocess.TimeoutExpired:
                self.child.kill()
                self.child.wait(timeout=3)

    def _poll_native(self):
        if self.child is not None:
            row=self.store.document("job",self.child_job)
            timeout=row["payload"]["spec"]["limits"]["timeout_seconds"]
            if self.child.poll() is None and time.monotonic()-self.child_started>timeout+5:
                self._stop_owned_child()
            if self.child.poll() is None:
                return
            code=self.child.returncode
            if self.child_log is not None:
                self.child_log.close()
            self.child=None;self.child_job=None;self.child_log=None;self.child_started=None
            if not self._adopt_completed(row):
                native=load_state(self.jobs_root/row["id"]) or {}
                status=native.get("status")
                if status not in ("failed","cancelled","interrupted"):
                    status="cancelled" if (self.jobs_root/row["id"]/"cancel.json").exists() else "interrupted"
                self._save_job_status(self.store.document("job",row["id"]),{"status":status,
                    "generation":native.get("generation",row["payload"].get("generation",0)),
                    "error":native.get("error") or {"type":"NativeProcessExit","message":"Original worker exited with status "+str(code)+". Continue this job with its retained inputs."},
                    "native_exit_code":code})
        # Reconcile an already completed worker before any possible new dispatch.
        for row in self.store.documents("job"):
            if row["payload"]["status"]=="complete":
                continue
            if self._adopt_completed(row):
                continue
            if row["payload"]["status"] in ("running","cancelling"):
                native=load_state(self.jobs_root/row["id"]) or {}
                self._save_job_status(row,{"status":"cancelled" if (self.jobs_root/row["id"]/"cancel.json").exists() else "interrupted",
                    "generation":native.get("generation",row["payload"].get("generation",0)),
                    "error":native.get("error") or {"type":"OriginalSupervisorClosed","message":"Continue the original job to finish from its pinned inputs."}})

    def advance(self):
        with self.lock:
            self._poll_native()
            if self.stop.is_set() or self.child is not None:
                return
            queued=sorted((r for r in self.store.documents("job") if r["payload"]["status"]=="queued"),key=lambda r:(r["created_at"],r["id"]))
            if not queued:
                return
            row=queued[0]
            directory=self.jobs_root/row["id"]
            raw=private_read(directory/"job.json")
            if digest(raw)!=row["payload"]["job_sha256"]:
                self._save_job_status(row,{"status":"failed","error":{"type":"PinnedJobChanged","message":"The original native job bytes changed."}})
                return
            log_dir=private_directory(directory/"logs")
            self.child_log=os.fdopen(os.open(log_dir/("worker-"+secrets.token_hex(8)+".log"),os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600),"wb",buffering=0)
            self._save_job_status(row,{"status":"running","dispatched_at":now()})
            env={key:value for key,value in os.environ.items() if key in ("PATH","LANG","LC_ALL","PYTHONPATH","SYSTEMROOT")}
            env["PYTHONDONTWRITEBYTECODE"]="1"
            env["PYTHONUNBUFFERED"]="1"
            temporary=private_directory(directory/"temporary")
            env["TMPDIR"]=str(temporary)
            try:
                self.child=subprocess.Popen([sys.executable,"-B","-m","semantic_operator.worker","--operation",str(directory)],
                    cwd=ROOT,env=env,stdin=subprocess.DEVNULL,stdout=self.child_log,stderr=subprocess.STDOUT)
                self.child_job=row["id"];self.child_started=time.monotonic()
            except BaseException:
                self.child_log.close();self.child_log=None
                self._save_job_status(self.store.document("job",row["id"]),{"status":"interrupted",
                    "error":{"type":"NativeDispatchInterrupted","message":"Continue the original pinned native job."}})
                raise

    def _supervise(self):
        while not self.stop.is_set():
            try:
                self.advance()
                self.worker_error=None
            except Exception as exc:
                self.worker_error={"type":type(exc).__name__,"message":str(exc)[:2000]}
            self.wake.wait(0.35)
            self.wake.clear()

    def state(self):
        with self.lock:
            state={"schema":"commons-semantic-operator-state/1","workspace_id":self.store.workspace_id,
                   "workspace_path":str(self.root),"engine_contract":"commons-semantic-native-job/1",
                   "engine_contracts":[JOB_SCHEMA,DATASET_JOB_SCHEMA],
                   "capabilities":{"graph":True,"dataset":True,"dataset_algorithm":"URDNA2015"},
                   "worker_error":getattr(self,"worker_error",None),
                   "records":{kind:self.store.documents(kind) for kind in KINDS},
                   "artifacts":self.store.artifacts(),"operations":self.store.operations(),
                   "native_worker":{"running":self.child is not None and self.child.poll() is None,"job_id":self.child_job}}
            return state

    def close(self):
        if self.closed:
            return
        self.stop.set();self.wake.set()
        if self.thread:
            self.thread.join(timeout=5)
        with self.lock:
            try:
                self._stop_owned_child()
                self._poll_native()
            finally:
                self.closed=True
                if self.child_log is not None:
                    self.child_log.close()
                for child,stream,ready in self.received_hosts.values():
                    if child.poll() is None:
                        child.terminate()
                        try: child.wait(timeout=3)
                        except subprocess.TimeoutExpired:
                            child.kill();child.wait(timeout=3)
                    stream.close()
                self.received_hosts.clear()
                self.store.close()
                fcntl.flock(self._owner,fcntl.LOCK_UN)
                os.close(self._owner)

    def _workspace_files(self):
        self._poll_native()
        if self.child is not None and self.child.poll() is None:
            raise ValueError("Finish or cancel the original native job before exporting a consistent workspace.")
        files=self.store.snapshot()
        for row in self.store.documents("job"):
            directory=self.jobs_root/row["id"]
            for path in directory.rglob("*"):
                if not path.is_file():
                    continue
                name=str(path.relative_to(directory))
                if path.is_symlink():
                    raise ValueError("Native recovery cannot include symbolic links.")
                if name=="native.lock" or name.startswith("temporary/") or any(p.startswith(".write-") for p in Path(name).parts):
                    continue
                files["native-jobs/"+row["id"]+"/"+name]=private_read(path)
        metadata={"schema":"commons-semantic-workspace/1","workspace_id":self.store.workspace_id,
                  "created_at":now(),"contains_private_key":False,"scope":"Complete original source and engineering history"}
        return files,metadata

    def _handoff_export(self,p,op,actor):
        files,metadata=self._workspace_files()
        body,manifest=pack_files(files,metadata)
        name="Semantic-Workspace-"+self.store.workspace_id[:8]+".zip"
        artifact=self.store.add_artifact(body,name=name,media_type="application/zip",role="workspace-handoff",
            source_reference="Complete original semantic workspace "+self.store.workspace_id,include_in_backup=False)
        return {"artifact":artifact,"workspace_id":self.store.workspace_id,
                "files":len(manifest["files"]),"uncompressed_bytes":sum(v["bytes"] for v in manifest["files"]),
                "scope":metadata["scope"],"encrypted":False}

    def _intake_transfer(self,p,*,encrypted=False):
        if p.get("artifact_id"):
            meta,data=self.store.artifact(p["artifact_id"],with_bytes=True)
            return meta,data
        body=decoded(p["data_base64"])
        meta=self.store.add_artifact(body,name=p.get("name","Semantic-Workspace.csw" if encrypted else "Semantic-Workspace.zip"),
            media_type="application/octet-stream" if encrypted else "application/zip",
            role="received-recovery" if encrypted else "received-handoff",
            source_reference=text(p.get("source_reference","Local operator's complete workspace transfer"),"Transfer source"),
            include_in_backup=not encrypted)
        return meta,body

    def _handoff_receive(self,p,op,actor):
        from .portable import receive_workspace,validate_workspace
        artifact,body=self._intake_transfer(p)
        for row in self.store.documents("receiving"):
            if row["payload"].get("archive_sha256")==artifact["sha256"]:
                return row
        files,manifest=unpack_files(body)
        summary=validate_workspace(files,manifest)
        key=self._id("receiving",op)
        destination=self.receiving_root/key
        current={(kind,row["id"]):row for kind in KINDS for row in self.store.documents(kind)}
        conflicts=[{"kind":head["kind"],"id":head["id"],
                    "current_revision":current[(head["kind"],head["id"])]["revision"],
                    "received_revision":head["revision"],"current_sha256":current[(head["kind"],head["id"])]["sha256"],
                    "received_sha256":head["sha256"]} for head in summary["heads"]
                   if (head["kind"],head["id"]) in current and current[(head["kind"],head["id"])]["sha256"]!=head["sha256"]]
        receive_workspace(files,manifest,destination,archive_sha256=artifact["sha256"],operation_id=op)
        return self._write("receiving",key,{"title":text(p.get("title","Received semantic workspace"),"Receiving title",300),
            "artifact_id":artifact["id"],"archive_sha256":artifact["sha256"],"source_workspace_id":summary["workspace_id"],
            "workspace_path":str(destination),"local_workspace_root":str(self.root),"location_status":"local",
            "receiving_operation_id":op,"summary":summary,"conflicts":conflicts,
            "resolution":"Independent received workspace; both complete branches and original IDs are retained.",
            "received_at":now()},op,actor)

    def _recovery_export(self,p,op,actor):
        files,metadata=self._workspace_files()
        body,manifest=pack_files(files,metadata)
        encrypted=encrypt_recovery(body,p["passphrase"])
        artifact=self.store.add_artifact(encrypted,name="Semantic-Recovery-"+self.store.workspace_id[:8]+".csw",
            media_type="application/octet-stream",role="encrypted-recovery",
            source_reference="Encrypted complete semantic workspace "+self.store.workspace_id,include_in_backup=False)
        return {"artifact":artifact,"workspace_id":self.store.workspace_id,"files":len(manifest["files"]),
                "encrypted":True,"algorithm":"AES-256-GCM / PBKDF2-HMAC-SHA256 / 600000 iterations",
                "original_ids_retained":True,"local_key_excluded":True}

    def _recovery_restore(self,p,op,actor):
        from .portable import receive_workspace
        artifact,body=self._intake_transfer(p,encrypted=True)
        raw=decrypt_recovery(body,p["passphrase"])
        files,manifest=unpack_files(raw)
        destination=Path(text(p["destination"],"New private recovery directory",4000)).expanduser().absolute()
        if destination==self.root or self.root in destination.parents:
            raise ValueError("Choose a new recovery workspace outside this original workspace.")
        summary=receive_workspace(files,manifest,destination,archive_sha256=artifact["sha256"],operation_id=op)
        return self._write("recovery",self._id("recovery",op),{"title":"Restored original semantic workspace",
            "artifact_id":artifact["id"],"archive_sha256":artifact["sha256"],"workspace_path":str(destination),
            "local_workspace_root":str(self.root),"location_status":"local","restoring_operation_id":op,
            "source_workspace_id":summary["workspace_id"],"summary":summary,"restored_at":now(),
            "original_ids_retained":True,"fresh_local_key_on_open":True},op,actor)

    def _workspace_open(self,p,op,actor):
        kind=p.get("kind")
        if kind not in ("receiving","recovery"):
            raise ValueError("Choose one of this operator's received or recovered workspaces.")
        row=self.store.document(kind,p["id"])
        value=row["payload"]
        if kind=="receiving":
            # Always use this receiver's own destination. Never follow a path
            # serialized by another host, even when that old path still exists.
            from .portable import receive_workspace
            meta,body=self.store.artifact(value["artifact_id"],with_bytes=True)
            if meta["sha256"]!=value["archive_sha256"]:
                raise ValueError("The retained receiving archive changed.")
            files,manifest=unpack_files(body)
            target=self.receiving_root/identifier(row["id"])
            origin=value.get("receiving_operation_id") or self.store.history(kind,row["id"])[0]["payload"]["_operation_id"]
            receive_workspace(files,manifest,target,archive_sha256=meta["sha256"],operation_id=origin)
            if value.get("workspace_path")!=str(target) or value.get("local_workspace_root")!=str(self.root):
                row=self._write(kind,row["id"],{**value,"workspace_path":str(target),
                    "local_workspace_root":str(self.root),"location_status":"local",
                    "receiving_operation_id":origin,"located_at":now()},op,actor,row["revision"])
        else:
            if value.get("location_status")!="local" or value.get("local_workspace_root")!=str(self.root):
                raise ValueError("This transferred recovery record needs its original encrypted archive. Restore that archive into a new local directory.")
            target=private_directory(value["workspace_path"],create=False)
            origin=read_json(private_read(target/"RECEIVED.json"))
            if (origin.get("archive_sha256")!=value["archive_sha256"]
                    or origin.get("workspace_id")!=value["source_workspace_id"]
                    or origin.get("operation_id")!=value["restoring_operation_id"]
                    or origin.get("destination")!=str(target)):
                raise ValueError("The original local recovery destination no longer matches this record.")
        target=private_directory(target,create=False)
        existing=self.received_hosts.get(str(target))
        if existing and existing[0].poll() is None:
            return existing[2]
        log_dir=private_directory(self.root/"received-hosts")
        ready_path=log_dir/(op+".ready.json")
        log=os.fdopen(os.open(log_dir/(op+".log"),os.O_WRONLY|os.O_CREAT|os.O_APPEND|os.O_NOFOLLOW,0o600),"ab",buffering=0)
        env={key:value for key,value in os.environ.items() if key in ("PATH","LANG","LC_ALL","PYTHONPATH","SYSTEMROOT")}
        env["PYTHONDONTWRITEBYTECODE"]="1"
        child=subprocess.Popen([sys.executable,"-B",str(ROOT/"run.py"),"serve","--workspace",str(target),
            "--ready-file",str(ready_path),"--parent-pid",str(os.getpid())],
            cwd=ROOT,env=env,stdin=subprocess.DEVNULL,stdout=log,stderr=subprocess.STDOUT)
        try:
            deadline=time.monotonic()+15
            while time.monotonic()<deadline:
                if child.poll() is not None:
                    raise ValueError("The received operator could not open; its original workspace remains intact.")
                if ready_path.exists():
                    ready=read_json(private_read(ready_path))
                    if ready.get("pid")==child.pid and ready.get("workspace_id")==row["payload"]["source_workspace_id"]:
                        self.received_hosts[str(target)]=(child,log,ready)
                        return ready
                time.sleep(0.05)
            raise ValueError("The received operator has not opened within 15 seconds; its original workspace remains intact.")
        except BaseException:
            if child.poll() is None:
                child.terminate()
                try: child.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    child.kill();child.wait(timeout=3)
            log.close()
            raise
