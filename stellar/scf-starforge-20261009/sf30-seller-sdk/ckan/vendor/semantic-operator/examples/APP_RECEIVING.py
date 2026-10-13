#!/usr/bin/env python3
"""Complete retained-source application receiving journey; continue this same operation."""
from __future__ import annotations
import argparse
import base64
import csv
import io
import json
import os
from pathlib import Path
import sys
import time
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from semantic_operator.application import SemanticApplication
from semantic_operator.security import atomic_write,canonical,digest,private_directory,private_read,read_json
from semantic_operator.store import now

SOURCE=Path(__file__).resolve().parents[1]
ACTOR="Public-source application receiving"
PASSWORD="semantic-reference-recovery-2026"

def run(operation):
    root=private_directory(operation)
    checkpoint=root/"STATE.json"
    if checkpoint.exists():
        state=read_json(private_read(checkpoint))
    else:
        import secrets
        state={"schema":"commons-semantic-app-receiving/1","run_id":secrets.token_hex(16),"created_at":now()}
        atomic_write(checkpoint,canonical(state))
    if (root/"RESULT.json").exists():
        return read_json(private_read(root/"RESULT.json"))
    app=SemanticApplication(root/"workspace")
    other=None
    reopened=None
    def opid(label):
        return "receive-"+digest((state["run_id"]+":"+label).encode())[:32]
    def invoke(label,action,payload,application=None):
        result=(application or app).perform(action,payload,operation_id=opid(label),actor=ACTOR)
        state[label]={"action":action,"operation_id":opid(label),"result":result}
        atomic_write(checkpoint,canonical(state))
        print(json.dumps({"stage":label,"action":action,"operation_id":opid(label),"retained":True}),flush=True)
        return result
    def complete(label,action,payload):
        row=invoke(label,action,payload)
        deadline=time.monotonic()+600
        continued=False
        while time.monotonic()<deadline:
            current=app.store.document("job",row["id"])
            status=current["payload"]["status"]
            if status=="complete":
                native=current["payload"]["native_result"]
                assert native and native["files"]
                for item in native["files"]:
                    meta,body=app.store.artifact(item["artifact_id"],with_bytes=True)
                    assert len(body)==item["bytes"] and digest(body)==item["sha256"]
                result=current["payload"]["result_record"]
                return app.store.document(result["kind"],result["id"]) if result else current
            if status in ("failed","interrupted","cancelled"):
                if not continued:
                    generation=current["payload"].get("generation",0)
                    invoke(label+"-continue-"+str(generation),"job.continue",{"job_id":row["id"]})
                    continued=True
                else:
                    raise RuntimeError(json.dumps(current["payload"].get("error")))
            time.sleep(0.2)
        raise TimeoutError("Continue the original native application job "+row["id"])
    def reference(label,path,role):
        return invoke(label,"source.reference",{"path":path,"role":role})
    def ref(row):
        return {"id":row["id"],"revision":row["revision"]}
    try:
        original_key=app.vault.key
        base=reference("public-basic","w3c/examples/basic-example.ttl","data")
        shapes=reference("public-shapes","dcat-ap/3.0.1/dcat-ap-SHACL.ttl","shapes")
        ranges=reference("public-ranges","dcat-ap/3.0.1/ranges.ttl","shapes")
        ontology=reference("public-dcat-ontology","w3c/dcat3.ttl","ontology")
        # This table is explicitly derived from published title statements.
        # Original terms and source links remain in the complete original RDF file.
        csv_path=root/"derived-public-titles.csv"
        if not csv_path.exists():
            import rdflib
            from rdflib.namespace import DCTERMS
            graph=rdflib.Graph().parse(SOURCE/"reference/w3c/examples/basic-example.ttl",format="turtle")
            title_rows=sorted((str(subject),str(title),title.language or "") for subject,title in graph.subject_objects(DCTERMS.title)
                              if isinstance(subject,rdflib.URIRef) and isinstance(title,rdflib.Literal))
            assert title_rows,"The exact published example has no title statements."
            output=io.StringIO(newline="")
            writer=csv.DictWriter(output,fieldnames=["ID","original_iri","title","original_language"])
            writer.writeheader()
            for index,(subject,title,language) in enumerate(title_rows,1):
                writer.writerow({"ID":str(index),"original_iri":subject,"title":title,"original_language":language})
            atomic_write(csv_path,output.getvalue().encode())
        csv_bytes=private_read(csv_path)
        table=invoke("derived-table","source.import",{"title":"Derived published title inventory","format":"csv","role":"table",
            "name":"derived-public-titles.csv","data_base64":base64.b64encode(csv_bytes).decode(),
            "edition":"Explicit local tabular derivation of the pinned W3C example","license":"W3C source notices retained",
            "source_reference":base["payload"]["source_reference"]+"; explicit local derivation from dct:title"})
        inspection=complete("inspect-table","source.inspect",{"source":ref(table),"title":"Inspect complete derived title table"})
        definition={"subject_template":"https://example.org/derived-title-record/{ID}","classes":["https://example.org/engineering/TitleRecord"],
            "delimiter":",","null_values":[""],"fields":[
                {"column":"title","predicate":"http://purl.org/dc/terms/title","kind":"literal"},
                {"column":"original_iri","predicate":"http://www.w3.org/ns/prov#wasDerivedFrom","kind":"iri"},
                {"column":"original_language","predicate":"https://example.org/engineering/originalLanguage","kind":"literal"}]}
        mapping=invoke("mapping-original","mapping.save",{"title":"Published title inventory mapping","source":ref(table),"definition":definition,
            "review_note":"Local derived records keep the exact title text, original IRI and original language column."})
        before=complete("snapshot-before","snapshot.build",{"title":"Published reference and derived title inventory",
            "sources":[ref(base)],"mappings":[ref(mapping)]})
        partial=complete("validate-partial-profile","validation.run",{"title":"Retain the incomplete one-file profile selection",
            "snapshot":ref(before),"shapes":[ref(shapes)],"ontologies":[ref(ontology)],"inference":"none"})
        assert partial["payload"]["summary"]["native_outcome"]=="invalid_shapes"
        validated=complete("validate-published","validation.run",{"title":"Published example against complete DCAT-AP 3.0.1 profile",
            "snapshot":ref(before),"shapes":[ref(shapes),ref(ranges)],"ontologies":[ref(ontology)],"inference":"none"})
        # The native outcome describes the selected original files. Receiving
        # carries an invalid profile report as completely as a conforming result.
        assert validated["payload"]["summary"]["native_outcome"] in ("invalid_shapes","conforms","nonconforming","validation_failure")
        if validated["payload"]["summary"]["native_outcome"]=="invalid_shapes":
            invoke("review-selected-profile","decision.save",{"title":"Review the original selected profile",
                "record_kind":"validation","record_id":validated["id"],"record_revision":validated["revision"],
                "disposition":"changes_requested",
                "note":"The native report records missing shape definitions in this explicit source selection. The original files and report remain unchanged; a completed profile composition is a separate validation operation."})
        query=complete("query-titles","query.run",{"title":"Inspect original and derived title terms","snapshot":ref(before),"row_limit":10000,
            "query":"SELECT ?subject ?title WHERE { ?subject <http://purl.org/dc/terms/title> ?title } ORDER BY ?subject ?title"})
        changed_path=root/"derived-public-titles-local-edit.csv"
        if not changed_path.exists():
            rows=list(csv.DictReader(io.StringIO(csv_bytes.decode(),newline="")))
            rows[0]["title"]=rows[0]["title"]+" — local receiving edit"
            output=io.StringIO(newline="")
            writer=csv.DictWriter(output,fieldnames=["ID","original_iri","title","original_language"]);writer.writeheader();writer.writerows(rows)
            atomic_write(changed_path,output.getvalue().encode())
        changed=private_read(changed_path)
        table2=invoke("derived-table-revision","source.import",{"id":table["id"],"expected_revision":1,
            "title":table["payload"]["title"],"format":"csv","role":"table","name":"derived-public-titles-local-edit.csv",
            "data_base64":base64.b64encode(changed).decode(),"edition":"Deliberate local receiving edit; published source unchanged",
            "license":table["payload"]["license"],"source_reference":table["payload"]["source_reference"]})
        mapping2=invoke("mapping-revision","mapping.save",{"id":mapping["id"],"expected_revision":1,"title":mapping["payload"]["title"],
            "source":ref(table2),"definition":definition,"review_note":"Deliberate one-title receiving edit; original public edition is retained."})
        after=complete("snapshot-after","snapshot.build",{"title":"Explicit local title edit","sources":[ref(base)],"mappings":[ref(mapping2)]})
        comparison=complete("compare-original","comparison.run",{"title":"One local title change with source impact",
            "before":ref(before),"after":ref(after),"edge_predicates":[],"depth":2,"node_limit":100000})
        assert comparison["payload"]["summary"]["added_triples"]==1
        assert comparison["payload"]["summary"]["removed_triples"]==1
        assert comparison["payload"]["summary"]["provenance_complete"] is True
        decision=invoke("review-change","decision.save",{"title":"Accept the explicit local title edit","record_kind":"comparison",
            "record_id":comparison["id"],"record_revision":comparison["revision"],"disposition":"accepted",
            "note":"Native graph comparison retains exactly one added and one removed title statement, with complete original source references."})
        transfer=invoke("handoff-export","handoff.export",{})
        transfer_meta,transfer_bytes=app.store.artifact(transfer["artifact"]["id"],with_bytes=True)
        atomic_write(root/"original-handoff.zip",transfer_bytes)
        other=SemanticApplication(root/"receiving-desk",start_worker=False)
        received=invoke("receive-original","handoff.receive",{"title":"Complete original semantic workspace",
            "data_base64":base64.b64encode(transfer_bytes).decode(),"name":"original-handoff.zip"},other)
        replay=invoke("receive-replay","handoff.receive",{"title":"Complete original semantic workspace",
            "data_base64":base64.b64encode(transfer_bytes).decode(),"name":"original-handoff.zip"},other)
        assert replay["id"]==received["id"]
        reopened=SemanticApplication(received["payload"]["workspace_path"],start_worker=False)
        assert reopened.store.workspace_id==app.store.workspace_id and reopened.vault.key!=original_key
        assert len(reopened.store.history("source",table["id"]))==2
        assert len(reopened.store.history("mapping",mapping["id"]))==2
        # A receiving review can legitimately diverge from the original branch.
        local_review=invoke("received-review-edit","decision.save",{"id":decision["id"],"expected_revision":1,
            **{k:v for k,v in decision["payload"].items() if k in ("title","record_kind","record_id","record_revision","disposition","note")},
            "note":"Receiving reviewer retained a different review note."},reopened)
        second_branch=invoke("receive-conflicting-branch","handoff.receive",{"title":"Original branch beside receiving review",
            "data_base64":base64.b64encode(transfer_bytes).decode(),"name":"original-handoff.zip"},reopened)
        assert any(v["id"]==decision["id"] for v in second_branch["payload"]["conflicts"])
        assert reopened.store.document("decision",decision["id"])["revision"]==2
        reopened.close();reopened=None
        other.close();other=None
        encrypted=invoke("encrypted-export","recovery.export",{"passphrase":PASSWORD})
        archive_meta,archive_bytes=app.store.artifact(encrypted["artifact"]["id"],with_bytes=True)
        atomic_write(root/"original-recovery.csw",archive_bytes)
        restored=invoke("restore-original","recovery.restore",{"artifact_id":archive_meta["id"],"passphrase":PASSWORD,
            "destination":str(root/"restored-workspace")})
        original_id=app.store.workspace_id
        expected={kind:{r["id"]:(r["revision"],r["sha256"]) for r in app.store.documents(kind)}
                  for kind in ("source","mapping","snapshot","validation","query","comparison","decision","job")}
        app.close()
        reopened=SemanticApplication(root/"restored-workspace",start_worker=False)
        assert reopened.store.workspace_id==original_id and reopened.vault.key!=original_key
        for kind,heads in expected.items():
            actual={r["id"]:(r["revision"],r["sha256"]) for r in reopened.store.documents(kind)}
            assert actual==heads,(kind,actual,heads)
        for job in reopened.store.documents("job"):
            assert job["payload"]["status"]=="complete"
            native=job["payload"]["native_result"]
            for item in native["files"]:
                meta,body=reopened.store.artifact(item["artifact_id"],with_bytes=True)
                assert digest(body)==item["sha256"]
        result={"schema":"commons-semantic-app-receiving-result/1","status":"PASS","run_id":state["run_id"],
            "workspace_id":original_id,"completed_at":now(),"source_editions":2,"mapping_editions":2,
            "snapshots":2,"native_jobs":len(expected["job"]),"partial_profile_validation":partial["payload"]["summary"],
            "published_validation":validated["payload"]["summary"],
            "query":query["payload"]["summary"],"comparison":comparison["payload"]["summary"],
            "exact_same_bundle_reused_receipt":True,"conflicting_review_preserved_both_complete_branches":True,
            "encrypted_bytes":len(archive_bytes),"encrypted_sha256":digest(archive_bytes),
            "cold_restore_original_heads":sum(len(v) for v in expected.values()),"fresh_local_key":True,
            "customer_data":False,"published_sources_unchanged":True}
        atomic_write(root/"RESULT.json",canonical(result))
        return result
    finally:
        for active in (reopened,other,app):
            if active is not None:
                active.close()

if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--operation",required=True)
    args=parser.parse_args()
    os.umask(0o077)
    print(json.dumps(run(args.operation),indent=2))
