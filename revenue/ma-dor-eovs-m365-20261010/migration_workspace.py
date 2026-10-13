"""Public operating API: one retained migration workspace, original rows and reviewed decisions."""
from __future__ import annotations
import csv
import io
import json
from pathlib import Path

from migration_store import Store, MigrationError, canonical, identity, parse_json, text, identifier, integer, page
from migration_formats import FORMATS, FIELDS, CLASSIFICATIONS, import_source, source_description, row_description
from migration_reconcile import CHECKS, reconcile, compare_reconciliations
import migration_cases
import financial_workspace
import property_workspace

EVIDENCE_FIELDS = ("path","expected_target_path","size_bytes","content_sha256","principals","label","classified_at","migrated_at")
MUTATIONS = ("workspace.update","source.import","round.create","mapping.create","evidence.link","reconciliation.create",
             "correction.create","correction.update","operation.resume","delivery.prepare")
READS = ("schema","state","entity.list","source.list","source.get","source.rows","row.get","round.list","round.get",
         "mapping.list","mapping.get","mapping.rows","evidence_link.list","evidence_link.get",
         "reconciliation.list","reconciliation.get","reconciliation.items","reconciliation.compare",
         "correction.list","correction.get","correction.history","operation.get","events","delivery.list","delivery.get")

MUTATIONS = MUTATIONS + migration_cases.MUTATIONS + financial_workspace.MUTATIONS + property_workspace.MUTATIONS
READS = READS + migration_cases.READS + financial_workspace.READS + property_workspace.READS

def schema():
    return {
      "schema":"ma-dor.operating-api/v1","runtime":"Linux Python 3.10+ standard library",
      "mutations":list(MUTATIONS),"reads":list(READS),"maximum_page_size":500,
      "mutation_envelope":{"expected_revision":"integer","operation_id":"flat identifier","actor":"text"},
      "source_formats":FORMATS,"inventory_fields":FIELDS,
      "source_context":{"required":["scope_id","identity_namespace","role","capture_kind","coverage"],
                        "coverage_modes":["complete","partial","failure_only","unknown"],
                        "capture_kinds":["customer_export","local_reference","public_reference"],
                        "optional":["task_id","round_label","job_id","snapshot_id","report_set_id","producer","observed_at","captured_at",
                                    "scan_job_id","scan_cycle_id","scan_mode","policy_only","encoding","delimiter","note"]},
      "entity_kinds":["source","round","mapping","evidence_link","reconciliation","correction","delivery","workspace_edit"]+list(migration_cases.ENTITY_KINDS)+list(financial_workspace.KINDS)+list(property_workspace.KINDS),
      "case_migration":migration_cases.schema(),
      "financial_reporting":financial_workspace.schema(),
      "property_continuity":property_workspace.schema(),
      "mapping_kinds":["identity","principal","status","evidence"],
      "mapping_entry_fields":{
          "identity":["source_row_id","target_row_id","reason"],
          "principal":["source_principal","target_principal","is_group","reason"],
          "status":["raw_status","classification","reason"],
          "evidence":["subject_row_id","evidence_row_id","fields","reason"]},
      "status_classifications":sorted(CLASSIFICATIONS),"entra_fallback":["enabled","disabled","unknown"],
      "identity_modes":["shared_source_id","explicit_map"],"target_bases":["target_inventory","migration_items"],
      "reconciliation_checks":list(CHECKS),"evidence_fields":list(EVIDENCE_FIELDS),
      "correction_statuses":["open","in_progress","waiting_evidence","resolved","accepted_variance","withdrawn"],
      "payloads":{
        "source.import":{"required":["file_sha256","bytes","filename","format","context"],"optional":["columns","header_mapping","column_mapping_note"]},
        "round.create":{"required":["title","scope_id","round_label","sources"],"source_selector":["source_id","task_id","round_label","job_id"],"optional":["task_id","parent_round_id","note"]},
        "mapping.create":{"required":["title","kind","review_note"],"one_of":["source_id","entries"],"optional":["parent_mapping_id","options"]},
        "evidence.link":{"required":["subject_row_id","evidence_row_id","fields","reason"]},
        "reconciliation.create":{"required":["title","round_id","identity_policy"],"optional":["target_basis","identity_mapping_id","principal_mapping_id","status_mapping_id","evidence_mapping_id","evidence_link_ids","checks"]},
        "correction.create":{"required":["reconciliation_id","item_id","title","note"],"optional":["assigned_to","evidence_row_ids"]},
        "correction.update":{"required":["id","status","note"],"optional":["evidence_row_ids","verification","assigned_to"]},
        "operation.resume":{"required":["target_operation_id","reason"]},
        "delivery.prepare":{"optional":["title","note"],"defaults":{"title":"Migration workbench handover","note":""}}},
      "meaning":"Original evidence and explicit reviewer decisions only; no tenant write, effective-access inference or compliance certification."}

def _ready_row(store, row_id):
    row = row_description(store,row_id)
    if row["source_ref"]["source_status"]!="READY":
        raise MigrationError("INCOMPLETE_SOURCE", "Only a completely parsed original source can join a reviewed operation", {"row_id":row_id})
    return row

def _row_filters(selector, alias="r"):
    where, args = [f"{alias}.source_id=?"], [selector["source_id"]]
    for key in ("task_id","round_label","job_id"):
        if key in selector:
            where.append(f"{alias}.{key}=?")
            args.append(selector[key])
    return " AND ".join(where),args

def _round(store, op):
    p = op["request"]
    entity_id = "round-"+identity({"operation":op["id"],"request":op["request_sha256"]})[:40]
    old = store.get_entity("round",entity_id,required=False)
    if old:
        return old
    for name in ("title","scope_id","round_label"):
        text(p.get(name),name)
    selectors = p.get("sources")
    if not isinstance(selectors,list) or not selectors or len(selectors)>10000:
        raise MigrationError("ROUND_SOURCES", "Select between 1 and 10,000 original source selectors")
    snapshots = []
    for selected in selectors:
        if not isinstance(selected,dict) or set(selected)-{"source_id","task_id","round_label","job_id"}:
            raise MigrationError("ROUND_SELECTOR", "Use original source_id and exact optional task/round/job fields")
        selector = dict(selected)
        source = source_description(store,selector.get("source_id"))
        if source["status"]!="READY":
            raise MigrationError("INCOMPLETE_SOURCE", "Round requires a complete original source import")
        if source["context"]["scope_id"]!=p["scope_id"]:
            raise MigrationError("ROUND_SCOPE", "Original source has a different declared scope", {"source_id":source["id"],"scope_id":source["context"]["scope_id"]})
        for key in ("task_id","round_label","job_id"):
            if key in selector:
                text(selector[key],key)
        where,args = _row_filters(selector)
        with store.transaction():
            store.conn.execute(f"INSERT OR IGNORE INTO round_members SELECT ?,r.id FROM rows r WHERE {where}",(entity_id,*args))
        selected_count = store.conn.execute(f"SELECT count(*) FROM rows r WHERE {where}",args).fetchone()[0]
        snapshots.append({"source_id":source["id"],"sha256":source["file_sha256"],"bytes":source["bytes"],
                          "format":source["format"],"role":source["context"]["role"],"context":source["context"],
                          "selector":selector,"selected_occurrences":selected_count,"summary":source["summary"]})
    if p.get("parent_round_id"):
        parent = store.get_entity("round",p["parent_round_id"])
        if parent["scope_id"]!=p["scope_id"]:
            raise MigrationError("ROUND_PARENT", "Previous round belongs to another scope")
    count = store.conn.execute("SELECT count(*) FROM round_members WHERE round_id=?", (entity_id,)).fetchone()[0]
    body = {"schema":"ma-dor.migration-round/v1","id":entity_id,"title":p["title"],"scope_id":p["scope_id"],
            "round_label":p["round_label"],"task_id":p.get("task_id"),"parent_round_id":p.get("parent_round_id"),
            "note":p.get("note"),"sources":snapshots,"selected_occurrences":count,
            "created_at":op["created_at"],"created_revision":op["reserved_revision"],"operation_id":op["id"],"actor":op["actor"],
            "meaning":"Explicit frozen selection of original occurrences. The label does not replace any reported task or incremental-round value."}
    return store.put_entity("round",entity_id,body,op["reserved_revision"])

def _validate_entry(store, kind, entry):
    if not isinstance(entry,dict):
        raise MigrationError("MAPPING_ENTRY", "Mapping entries must be objects")
    entry = dict(entry)
    if kind=="identity":
        left = _ready_row(store,entry.get("source_row_id"))
        right = _ready_row(store,entry.get("target_row_id"))
        if left["role"]!="source_inventory" or right["role"] not in ("target_inventory","migration_items","migration_failures"):
            raise MigrationError("IDENTITY_MAPPING_ROLE", "Link a source inventory occurrence to a target/report occurrence")
        text(entry.get("reason"),"entry.reason")
        entry["source_ref"],entry["target_ref"] = left["source_ref"],right["source_ref"]
    elif kind=="principal":
        text(entry.get("source_principal"),"source_principal",max_length=4096)
        text(entry.get("target_principal"),"target_principal",max_length=4096)
        if not isinstance(entry.get("is_group"),bool):
            raise MigrationError("PRINCIPAL_MAPPING", "is_group must explicitly be true or false")
    elif kind=="status":
        text(entry.get("raw_status"),"raw_status",max_length=4096)
        if entry.get("classification") not in CLASSIFICATIONS:
            raise MigrationError("STATUS_MAPPING", "Use an advertised reported-status classification")
    elif kind=="evidence":
        subject = _ready_row(store,entry.get("subject_row_id"))
        evidence = _ready_row(store,entry.get("evidence_row_id"))
        fields = entry.get("fields")
        if not isinstance(fields,list) or not fields or len(set(fields))!=len(fields) or any(f not in EVIDENCE_FIELDS for f in fields):
            raise MigrationError("EVIDENCE_FIELDS", "Select unique advertised evidence fields")
        text(entry.get("reason"),"reason")
        entry["subject_ref"],entry["evidence_ref"] = subject["source_ref"],evidence["source_ref"]
    if entry.get("reason") is not None:
        text(entry["reason"],"entry.reason")
    return entry

def _mapping(store, op):
    p = op["request"]
    mapping_id = "mapping-"+identity({"operation":op["id"],"request":op["request_sha256"]})[:40]
    old = store.get_entity("mapping",mapping_id,required=False)
    if old:
        return old
    text(p.get("title"),"title")
    text(p.get("review_note"),"review_note")
    kind = p.get("kind")
    if kind not in ("identity","principal","status","evidence"):
        raise MigrationError("MAPPING_KIND", "Unknown reviewed mapping kind")
    use_source = p.get("source_id") is not None
    if use_source == ("entries" in p):
        raise MigrationError("MAPPING_SOURCE", "Provide one original source_id or one inline entries array")
    source_snapshot = None
    if use_source:
        source_snapshot = source_description(store,p["source_id"])
        expected_format = {"identity":"identity_mapping_jsonl","principal":"user_mapping_csv","status":"status_mapping_jsonl","evidence":"evidence_mapping_jsonl"}[kind]
        if source_snapshot["status"]!="READY" or source_snapshot["format"]!=expected_format:
            raise MigrationError("MAPPING_SOURCE", "Mapping source format/status does not match selected kind")
        def entries():
            for saved in store.conn.execute("SELECT id,values_json,issues_json FROM rows WHERE source_id=? ORDER BY ordinal", (p["source_id"],)):
                issues = parse_json(saved["issues_json"])
                if kind=="principal" and any(issue.get("code")=="invalid_official_user_mapping_row" for issue in issues):
                    raise MigrationError("USER_MAPPING_SHAPE", "Invalid original headerless mapping row cannot become a reviewed map; retain and import an explicitly corrected source edition",
                                         {"source_row_id":saved["id"],"issues":issues})
                obj = parse_json(saved["values_json"]).get("mapping_entry")
                yield obj,{"row_id":saved["id"],"source_id":p["source_id"],"sha256":source_snapshot["file_sha256"]}
    else:
        inline = p.get("entries")
        if not isinstance(inline,list) or not inline or len(inline)>1000:
            raise MigrationError("MAPPING_ENTRIES", "Use 1–1,000 inline entries or a streamed original mapping file")
        def entries():
            for index,obj in enumerate(inline,1):
                yield obj,{"operation_id":op["id"],"inline_entry":index}
    options = p.get("options",{})
    if not isinstance(options,dict):
        raise MigrationError("MAPPING_OPTIONS", "Mapping options must be an object")
    if kind=="principal" and options.get("entra_fallback","unknown") not in ("enabled","disabled","unknown"):
        raise MigrationError("ENTRA_FALLBACK", "Retain enabled, disabled or unknown fallback")
    if p.get("parent_mapping_id"):
        parent = store.get_entity("mapping",p["parent_mapping_id"])
        if parent["kind"]!=kind:
            raise MigrationError("MAPPING_PARENT", "Previous mapping has a different kind")
    count, active = 0, False
    try:
        for count,(entry,source_ref) in enumerate(entries(),1):
            clean = _validate_entry(store,kind,entry)
            clean["id"] = "maprow-"+identity({"mapping_id":mapping_id,"ordinal":count})[:40]
            clean["source_record"] = source_ref
            if kind=="principal" and use_source:
                src = clean["source_principal"]
                dst = clean["target_principal"]
                if "\\" not in src or not all(src.split("\\",1)) or dst.count("@")!=1 or any(c.isspace() for c in dst):
                    raise MigrationError("USER_MAPPING_SHAPE", "Official mapping needs source DOMAIN\\user and a destination UPN", {"source_row_id":source_ref["row_id"]})
            record = (clean["id"],mapping_id,count,kind,canonical(clean),
                      clean.get("source_row_id") or clean.get("subject_row_id"),
                      clean.get("target_row_id") or clean.get("evidence_row_id"),
                      clean.get("source_principal"),clean.get("target_principal"),clean.get("raw_status"))
            prior = store.conn.execute("SELECT * FROM mapping_entries WHERE mapping_id=? AND ordinal=?", (mapping_id,count)).fetchone()
            if prior:
                if tuple(prior)!=record:
                    raise MigrationError("MAPPING_PREFIX_CHANGED", "Original mapping occurrence changed on continuation")
                continue
            if not active:
                store.conn.execute("BEGIN IMMEDIATE")
                active = True
            store.conn.execute("INSERT INTO mapping_entries VALUES(?,?,?,?,?,?,?,?,?,?)",record)
            if count%250==0:
                store.conn.execute("UPDATE operations SET checkpoint_json=? WHERE id=?", (canonical({"phase":"mapping","mapping_id":mapping_id,"entries_retained":count}),op["id"]))
                store.conn.execute("COMMIT")
                active = False
        if active:
            store.conn.execute("COMMIT")
            active = False
        if count==0:
            raise MigrationError("EMPTY_MAPPING", "Reviewed mapping has no entries")
        retained = store.conn.execute("SELECT count(*) FROM mapping_entries WHERE mapping_id=?", (mapping_id,)).fetchone()[0]
        if retained!=count:
            raise MigrationError("MAPPING_PREFIX_CHANGED", "Original mapping ends before retained rows")
        body = {"schema":"ma-dor.reviewed-mapping/v1","id":mapping_id,"title":p["title"],"kind":kind,"entry_count":count,
                "source_id":p.get("source_id"),"source_snapshot":source_snapshot,
                "review_note":p["review_note"],"options":options,"parent_mapping_id":p.get("parent_mapping_id"),
                "created_at":op["created_at"],"created_revision":op["reserved_revision"],"operation_id":op["id"],"actor":op["actor"],
                "meaning":"Explicit reviewer mapping of supplied evidence; no identity lookup, target write, group expansion or effective-ACL inference"}
        return store.put_entity("mapping",mapping_id,body,op["reserved_revision"])
    finally:
        if active and store.conn.in_transaction:
            store.conn.execute("ROLLBACK")

def _evidence_link(store, op):
    link_id = "evidence-"+identity({"operation":op["id"],"request":op["request_sha256"]})[:40]
    prior = store.get_entity("evidence_link",link_id,required=False)
    if prior:
        return prior
    p = op["request"]
    entry = _validate_entry(store,"evidence",{k:p.get(k) for k in ("subject_row_id","evidence_row_id","fields","reason")})
    body = {"schema":"ma-dor.reviewed-evidence-link/v1","id":link_id,**entry,
            "created_at":op["created_at"],"created_revision":op["reserved_revision"],"operation_id":op["id"],"actor":op["actor"]}
    return store.put_entity("evidence_link",link_id,body,op["reserved_revision"])

def _item(store, item_id, reconciliation_id=None):
    row = store.conn.execute("SELECT body_json,reconciliation_id FROM reconciliation_items WHERE id=?", (item_id,)).fetchone()
    if not row or (reconciliation_id is not None and row["reconciliation_id"]!=reconciliation_id):
        raise MigrationError("ITEM_NOT_FOUND", "Original reconciliation item not found in selected result")
    store.get_entity("reconciliation",row["reconciliation_id"])
    return parse_json(row["body_json"])

def _evidence_rows(store, ids):
    if not isinstance(ids,list) or len(ids)>1000 or len(set(ids))!=len(ids):
        raise MigrationError("EVIDENCE_ROWS", "Use unique original evidence occurrence IDs")
    return [{"row_id":r["id"],"source_ref":r["source_ref"]} for r in (_ready_row(store,i) for i in ids)]

def _correction_create(store, op):
    p = op["request"]
    correction_id = "correction-"+identity({"operation":op["id"],"request":op["request_sha256"]})[:40]
    old = store.get_entity("correction",correction_id,required=False)
    if old:
        return old
    rec = store.get_entity("reconciliation",p.get("reconciliation_id"))
    item = _item(store,p.get("item_id"),rec["id"])
    text(p.get("title"),"title")
    text(p.get("note"),"note")
    if p.get("assigned_to") is not None:
        text(p["assigned_to"],"assigned_to")
    refs = _evidence_rows(store,p.get("evidence_row_ids",[]))
    body = {"schema":"ma-dor.correction/v1","id":correction_id,"title":p["title"],"note":p["note"],
            "status":"open","assigned_to":p.get("assigned_to"),"reconciliation_id":rec["id"],"item_id":item["id"],
            "expected_row_id":item.get("expected_row_id"),"observed_row_id":item.get("observed_row_id"),
            "original_status":item["status"],"required_checks":rec["configuration"]["checks"],
            "original_problem_checks":[k for k,v in item["checks"].items() if v["status"]!="MATCH"],
            "evidence_rows":refs,"created_at":op["created_at"],"created_revision":op["reserved_revision"],
            "operation_id":op["id"],"actor":op["actor"]}
    return store.put_entity("correction",correction_id,body,op["reserved_revision"])

def _correction_update(store, op):
    p = op["request"]
    update_id = "correction-update-"+identity({"operation":op["id"],"request":op["request_sha256"]})[:40]
    prior = store.conn.execute("SELECT body_json FROM correction_updates WHERE id=?", (update_id,)).fetchone()
    if prior:
        return parse_json(prior[0])
    original = store.get_entity("correction",p.get("id"))
    status = p.get("status")
    if status not in ("open","in_progress","waiting_evidence","resolved","accepted_variance","withdrawn"):
        raise MigrationError("CORRECTION_STATUS", "Choose an advertised correction status")
    text(p.get("note"),"note")
    refs = _evidence_rows(store,p.get("evidence_row_ids",[]))
    if "assigned_to" in p and p["assigned_to"] is not None:
        text(p["assigned_to"],"assigned_to")
    latest = store.conn.execute("SELECT body_json FROM correction_updates WHERE correction_id=? ORDER BY revision DESC,id DESC LIMIT 1",(original["id"],)).fetchone()
    previous_assignment = parse_json(latest[0]).get("assigned_to") if latest else original.get("assigned_to")
    assigned_to = p["assigned_to"] if "assigned_to" in p else previous_assignment
    verification = p.get("verification")
    if status=="resolved":
        if not isinstance(verification,dict) or not original.get("expected_row_id"):
            raise MigrationError("VERIFICATION_REQUIRED", "Resolution needs a later MATCH for the same retained baseline occurrence; other closures can record accepted_variance with reasons")
        rec = store.get_entity("reconciliation",verification.get("reconciliation_id"))
        item = _item(store,verification.get("item_id"),rec["id"])
        old_rec = store.get_entity("reconciliation",original["reconciliation_id"])
        if rec["created_revision"]<=old_rec["created_revision"] or item["expected_row_id"]!=original["expected_row_id"] or item["status"]!="MATCH":
            raise MigrationError("VERIFICATION_REQUIRED", "Verification must be a later matching result for exactly the original baseline row")
        if not set(original["required_checks"]) <= set(rec["configuration"]["checks"]):
            raise MigrationError("VERIFICATION_WEAKENED", "Later result omitted original required checks")
        if any(item["checks"].get(k,{}).get("status")!="MATCH" for k in original["original_problem_checks"]):
            raise MigrationError("VERIFICATION_WEAKENED", "Later evidence did not resolve every original problem check")
        verification = {"reconciliation_id":rec["id"],"item_id":item["id"],"expected_row_id":item["expected_row_id"],
                        "status":item["status"],"original_source_ref":item.get("expected_source_ref"),"observed_source_ref":item.get("observed_source_ref")}
    elif verification is not None:
        rec = store.get_entity("reconciliation",verification.get("reconciliation_id"))
        item = _item(store,verification.get("item_id"),rec["id"])
        verification = {"reconciliation_id":rec["id"],"item_id":item["id"],"status":item["status"]}
    body = {"schema":"ma-dor.correction-update/v1","id":update_id,"correction_id":original["id"],"status":status,
            "note":p["note"],"assigned_to":assigned_to,"evidence_rows":refs,"verification":verification,
            "created_at":op["created_at"],"created_revision":op["reserved_revision"],"operation_id":op["id"],"actor":op["actor"],
            "meaning":"Reviewer history; original source rows and frozen reconciliation remain unchanged"}
    with store.transaction():
        store.conn.execute("INSERT INTO correction_updates VALUES(?,?,?,?)", (update_id,original["id"],op["reserved_revision"],canonical(body)))
    return body

def _workspace_update(store, op):
    p = op["request"]
    edit_id = "workspace-edit-"+identity({"operation":op["id"],"request":op["request_sha256"]})[:40]
    prior = store.get_entity("workspace_edit",edit_id,required=False)
    if prior:
        return prior
    title = text(p.get("title"),"title")
    with store.transaction():
        project = store.project
        old = project["title"]
        project["title"] = title
        store.conn.execute("UPDATE meta SET value_json=? WHERE key='project'", (canonical(project),))
        body = {"id":edit_id,"workspace_id":project["id"],"title":title,"previous_title":old,
                "created_at":op["created_at"],"created_revision":op["reserved_revision"],"actor":op["actor"]}
        store.put_entity("workspace_edit",edit_id,body,op["reserved_revision"])
    return body

class MigrationWorkspace(Store):
    def __init__(self, directory, *, create=False, title="Migration workbench"):
        super().__init__(directory,create=create,title=title)
        try:
            migration_cases.ensure(self)
            financial_workspace.ensure(self)
            property_workspace.ensure(self)
        except BaseException:
            self.close()
            raise

    def _handler(self, operation):
        if operation in property_workspace.HANDLERS:
            return lambda op:property_workspace.invoke(self,op)
        if operation in financial_workspace.HANDLERS:
            return lambda op:financial_workspace.invoke(self,op)
        if operation in migration_cases.HANDLERS:
            return lambda op:migration_cases.HANDLERS[operation](self,op)
        handlers = {"workspace.update":_workspace_update,"source.import":import_source,"round.create":_round,
                    "mapping.create":_mapping,"evidence.link":_evidence_link,"reconciliation.create":reconcile,
                    "correction.create":_correction_create,"correction.update":_correction_update}
        if operation in handlers:
            return lambda op:handlers[operation](self,op)
        if operation=="delivery.prepare":
            from migration_portable import continue_delivery
            return lambda op:continue_delivery(self,op)
        if operation=="operation.resume":
            def resume(op):
                p = op["request"]
                text(p.get("reason"),"reason")
                target = self._operation(p.get("target_operation_id"))
                if target["operation"]=="operation.resume" or target["id"]==op["id"]:
                    raise MigrationError("RESUME_TARGET", "Select the original local operation, not a resume-control request")
                handler = self._handler(target["operation"])
                result = self.resume_original(target["id"],actor=op["actor"],reason=p["reason"],
                                              expected_revision=self.project["revision"],handler=handler)
                return {"id":target["id"],"target_operation_id":target["id"],"original_operation":target["operation"],"resumed":result}
            return resume
        raise MigrationError("UNKNOWN_OPERATION", "Unknown mutation", {"operation":operation})

    def dispatch(self, operation, payload=None):
        p = {} if payload is None else payload
        if not isinstance(p,dict):
            raise MigrationError("INVALID_PAYLOAD", "Payload must be an object")
        with self._mutex:
            if operation=="delivery.prepare":
                from migration_portable import prepare_delivery
                return prepare_delivery(self,p)
            if operation in MUTATIONS:
                return self.execute(operation,p,self._handler(operation))
            if operation in migration_cases.READS:
                return migration_cases.read(self,operation,p)
            if operation in financial_workspace.READS:
                return financial_workspace.read(self,operation,p)
            if operation in property_workspace.READS:
                return property_workspace.read(self,operation,p)
            if operation=="schema":
                return schema()
            if operation=="state":
                return self.state()
            if operation=="source.get":
                return source_description(self,p.get("id"))
            if operation=="source.list":
                return self.entity_list({**p,"kind":"source"})
            if operation=="entity.list":
                return self.entity_list(p)
            if operation=="source.rows":
                return self.source_rows(p)
            if operation=="row.get":
                return row_description(self,p.get("id"))
            if operation=="mapping.rows":
                self.get_entity("mapping",p.get("id"))
                offset,limit = page(p)
                total = self.conn.execute("SELECT count(*) FROM mapping_entries WHERE mapping_id=?",(p["id"],)).fetchone()[0]
                rows = [parse_json(r[0]) for r in self.conn.execute("SELECT body_json FROM mapping_entries WHERE mapping_id=? ORDER BY ordinal LIMIT ? OFFSET ?",(p["id"],limit,offset))]
                return {"rows":rows,"total":total,"offset":offset,"limit":limit}
            if operation=="reconciliation.items":
                return self.reconciliation_items(p)
            if operation=="reconciliation.compare":
                offset,limit = page(p)
                return compare_reconciliations(self,p.get("before_id"),p.get("after_id"),offset=offset,limit=limit)
            if operation=="correction.get":
                return self.correction_get(p.get("id"))
            if operation=="correction.history":
                self.get_entity("correction",p.get("id"))
                offset,limit = page(p)
                total = self.conn.execute("SELECT count(*) FROM correction_updates WHERE correction_id=?",(p["id"],)).fetchone()[0]
                rows = [parse_json(r[0]) for r in self.conn.execute("SELECT body_json FROM correction_updates WHERE correction_id=? ORDER BY revision,id LIMIT ? OFFSET ?",(p["id"],limit,offset))]
                return {"rows":rows,"total":total,"offset":offset,"limit":limit}
            if operation=="operation.get":
                result = self._operation(p.get("id"),required=False)
                return {"found":bool(result),"operation":result}
            if operation=="events":
                offset,limit = page(p)
                total = self.conn.execute("SELECT count(*) FROM events").fetchone()[0]
                rows = []
                for saved in self.conn.execute("SELECT * FROM events ORDER BY revision LIMIT ? OFFSET ?",(limit,offset)):
                    row = dict(saved)
                    row["payload"] = parse_json(row.pop("payload_json"))
                    rows.append(row)
                return {"rows":rows,"total":total,"offset":offset,"limit":limit}
            for kind in ("round","mapping","evidence_link","reconciliation","correction","delivery"):
                if operation==kind+".get":
                    return self.get_entity(kind,p.get("id"))
                if operation==kind+".list":
                    offset,limit = page(p)
                    return self.entity_list({**p,"kind":kind})
            raise MigrationError("UNKNOWN_OPERATION", "Unknown read operation", {"operation":operation})

    def entity_list(self, p):
        kind = p.get("kind")
        kinds = ("source","round","mapping","evidence_link","reconciliation","correction","delivery","workspace_edit")
        kinds = kinds + migration_cases.ENTITY_KINDS + financial_workspace.KINDS + property_workspace.KINDS
        if kind not in kinds:
            raise MigrationError("ENTITY_KIND", "Choose an advertised retained entity kind", {"kinds":list(kinds)})
        offset,limit = page(p)
        query = p.get("query")
        if query is not None:
            text(query,"query",max_length=4096)
        if kind=="source":
            where,args = (" WHERE instr(lower(id||filename||context_json),lower(?))>0",[query]) if query else ("",[])
            total = self.conn.execute("SELECT count(*) FROM sources"+where,args).fetchone()[0]
            ids = [r[0] for r in self.conn.execute("SELECT id FROM sources"+where+" ORDER BY created_revision DESC,id LIMIT ? OFFSET ?",(*args,limit,offset))]
            rows = [source_description(self,i) for i in ids]
        else:
            where,args = " WHERE kind=?",[kind]
            if query:
                where += " AND instr(lower(id||body_json),lower(?))>0"
                args.append(query)
            total = self.conn.execute("SELECT count(*) FROM entities"+where,args).fetchone()[0]
            rows = [parse_json(r[0]) for r in self.conn.execute("SELECT body_json FROM entities"+where+" ORDER BY created_revision DESC,id LIMIT ? OFFSET ?",(*args,limit,offset))]
            if kind=="correction":
                rows = [self.correction_get(r["id"]) for r in rows]
        return {"rows":rows,"total":total,"offset":offset,"limit":limit}

    def source_rows(self, p):
        source_description(self,p.get("id"))
        offset,limit = page(p)
        where,params = ["r.source_id=?"],[p["id"]]
        for key in ("role","task_id","round_label","job_id"):
            if p.get(key) is not None:
                text(p[key],key)
                where.append(f"r.{key}=?")
                params.append(p[key])
        if p.get("query"):
            text(p["query"],"query",max_length=4096)
            where.append("instr(lower(r.raw_json),lower(?))>0")
            params.append(p["query"])
        clause = " AND ".join(where)
        total = self.conn.execute("SELECT count(*) FROM rows r WHERE "+clause,params).fetchone()[0]
        rows = [row_description(self,r) for r in self.conn.execute("SELECT r.* FROM rows r WHERE "+clause+" ORDER BY r.ordinal LIMIT ? OFFSET ?",(*params,limit,offset))]
        return {"rows":rows,"total":total,"offset":offset,"limit":limit}

    def reconciliation_items(self,p):
        self.get_entity("reconciliation",p.get("id"))
        offset,limit = page(p)
        where,params = ["reconciliation_id=?"],[p["id"]]
        if p.get("status"):
            if p["status"] not in ("MATCH","DIFFERENT","UNKNOWN","AMBIGUOUS","MISSING","UNEXPECTED"):
                raise MigrationError("ITEM_STATUS", "Unknown item status")
            where.append("status=?")
            params.append(p["status"])
        if p.get("query"):
            text(p["query"],"query",max_length=4096)
            where.append("instr(lower(body_json),lower(?))>0")
            params.append(p["query"])
        clause = " AND ".join(where)
        total = self.conn.execute("SELECT count(*) FROM reconciliation_items WHERE "+clause,params).fetchone()[0]
        rows = [parse_json(r[0]) for r in self.conn.execute("SELECT body_json FROM reconciliation_items WHERE "+clause+" ORDER BY id LIMIT ? OFFSET ?",(*params,limit,offset))]
        return {"rows":rows,"total":total,"offset":offset,"limit":limit}

    def correction_get(self, correction_id):
        original = self.get_entity("correction",correction_id)
        saved = self.conn.execute("SELECT body_json FROM correction_updates WHERE correction_id=? ORDER BY revision DESC,id DESC LIMIT 1",(correction_id,)).fetchone()
        current = parse_json(saved[0]) if saved else original
        history = [parse_json(r[0]) for r in self.conn.execute("SELECT body_json FROM correction_updates WHERE correction_id=? ORDER BY revision DESC,id DESC LIMIT 100",(correction_id,))]
        count = self.conn.execute("SELECT count(*) FROM correction_updates WHERE correction_id=?",(correction_id,)).fetchone()[0]
        return {**original,"current":current,"status":current["status"],"history":history,"history_total":count,"history_truncated":count>len(history)}

    def state(self):
        project = self.project
        collections, totals = {},{}
        source_count = self.conn.execute("SELECT count(*) FROM sources").fetchone()[0]
        sources = []
        for row in self.conn.execute("SELECT id FROM sources ORDER BY created_revision DESC,id LIMIT 100"):
            src = source_description(self,row[0])
            sources.append({k:src[k] for k in ("id","filename","format","status","file_sha256","bytes","context","row_count","issue_count","summary","created_revision","error")})
        collections["sources"],totals["sources"] = sources,source_count
        for kind,key in (("round","rounds"),("mapping","mappings"),("evidence_link","evidence_links"),("reconciliation","reconciliations"),("correction","corrections"),("delivery","deliveries")):
            found = self.list_entities(kind,limit=100)
            totals[key] = found["total"]
            keep = ("id","title","kind","scope_id","round_label","parent_round_id","round_id","entry_count","status","summary","created_revision","created_at","source_id","filename","sha256","bytes","subject_row_id","evidence_row_id","fields","reason","reconciliation_id","item_id",
                    "revision","archive_bytes","archive_sha256","file_count","manifest_sha256","assigned_to")
            summaries = []
            for item in found["rows"]:
                summary = {k:item[k] for k in keep if k in item}
                if kind=="correction":
                    current = self.correction_get(item["id"])
                    summary["status"] = current["status"]
                    summary["title"] = current["title"]
                    summary["assigned_to"] = current["current"].get("assigned_to")
                summaries.append(summary)
            collections[key] = summaries
        operations = []
        for saved in self.conn.execute("SELECT id,operation,actor,status,reserved_revision,created_at,finished_at,error_json,checkpoint_json FROM operations ORDER BY reserved_revision DESC LIMIT 30"):
            op = dict(saved)
            error,checkpoint = op.pop("error_json"),op.pop("checkpoint_json")
            op["error"] = parse_json(error) if error else None
            op["checkpoint"] = parse_json(checkpoint) if checkpoint else None
            operations.append(op)
        events = []
        for saved in self.conn.execute("SELECT * FROM events ORDER BY revision DESC LIMIT 30"):
            ev = dict(saved)
            ev["payload"] = parse_json(ev.pop("payload_json"))
            events.append(ev)
        return {"schema":"ma-dor.operating-state/v1","project":project,**collections,"collection_totals":totals,
                "operations":operations,"recent_events":events,"collection_limit":100}

    def iter_export(self, kind, entity_id, *, format="ndjson"):
        with self._mutex:
            yield from self._iter_export(kind,entity_id,format=format)

    def _iter_export(self, kind, entity_id, *, format="ndjson"):
        """Bounded file delivery through the original database; caller keeps this workspace open."""
        if kind in property_workspace.KINDS:
            yield from property_workspace.iter_export(self,kind,entity_id,format)
            return
        if kind in financial_workspace.KINDS:
            yield from financial_workspace.iter_export(self,kind,entity_id,format)
            return
        if kind.startswith("case."):
            from migration_reports import iter_case_export
            yield from iter_case_export(self,kind,entity_id,format=format)
            return
        if format not in ("ndjson","csv"):
            raise MigrationError("EXPORT_FORMAT", "Choose ndjson or csv")
        if kind=="mapping" and format=="csv":
            mapping = self.get_entity("mapping",entity_id)
            if mapping["kind"]!="principal":
                raise MigrationError("EXPORT_FORMAT", "Headerless Microsoft CSV export applies to principal mappings")
            cursor = self.conn.execute("SELECT body_json FROM mapping_entries WHERE mapping_id=? ORDER BY ordinal",(entity_id,))
            for saved in cursor:
                entry = parse_json(saved[0])
                out = io.StringIO(newline="")
                csv.writer(out,lineterminator="\r\n").writerow([entry["source_principal"],entry["target_principal"],"TRUE" if entry["is_group"] else "FALSE"])
                yield out.getvalue().encode("utf-8")
            return
        if kind=="source":
            source_description(self,entity_id)
            query,args = "SELECT * FROM rows WHERE source_id=? ORDER BY ordinal",(entity_id,)
            transform = lambda r:row_description(self,r)
        elif kind=="reconciliation":
            self.get_entity("reconciliation",entity_id)
            query,args = "SELECT body_json FROM reconciliation_items WHERE reconciliation_id=? ORDER BY id",(entity_id,)
            transform = lambda r:parse_json(r[0])
        elif kind=="mapping":
            self.get_entity("mapping",entity_id)
            query,args = "SELECT body_json FROM mapping_entries WHERE mapping_id=? ORDER BY ordinal",(entity_id,)
            transform = lambda r:parse_json(r[0])
        else:
            raise MigrationError("EXPORT_KIND", "Export source rows, reconciliation items or reviewed mapping rows")
        if format=="csv":
            header = io.StringIO(newline="")
            csv.writer(header,lineterminator="\r\n").writerow(["id","source_id","expected_row_id","observed_row_id","status","complete_original_record_json"])
            yield header.getvalue().encode("utf-8")
        for saved in self.conn.execute(query,args):
            obj = transform(saved)
            if format=="ndjson":
                yield (canonical(obj)+"\n").encode("utf-8")
            else:
                out = io.StringIO(newline="")
                csv.writer(out,lineterminator="\r\n").writerow([obj.get("id"),obj.get("source_id"),obj.get("expected_row_id"),
                                                               obj.get("observed_row_id"),obj.get("status"),canonical(obj)])
                yield out.getvalue().encode("utf-8")
