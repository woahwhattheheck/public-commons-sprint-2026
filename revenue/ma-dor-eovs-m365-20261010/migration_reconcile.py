"""Immutable round reconciliation using original SQLite row occurrences."""
from __future__ import annotations
from collections import Counter
from datetime import datetime
from pathlib import Path

from migration_store import MigrationError, canonical, identity, parse_json, text, file_hash
from migration_formats import row_description, source_description

ENGINE_VERSION = "ma-dor.supplied-evidence-reconciliation/1"
CHECKS = ("presence","path","size","hash","principals","label","classification_order")
FIELDS = {"path":("expected_target_path","path"),"size":("size_bytes","size_bytes"),
          "hash":("content_sha256","content_sha256"),"principals":("principals","principals"),
          "label":("label","label"),"classification_order":("classified_at","migrated_at")}

def _entity(store, kind, entity_id):
    return store.get_entity(kind, entity_id)

def _member(store, rec_id, side, row_id):
    return bool(store.conn.execute("SELECT 1 FROM reconciliation_members WHERE reconciliation_id=? AND side=? AND row_id=?", (rec_id,side,row_id)).fetchone())

def _group(store, rec_id, side, namespace, key):
    if key is None:
        return {"count":0,"rows":[]}
    params = (rec_id,side,namespace,key)
    query = """FROM reconciliation_members m JOIN rows r ON r.id=m.row_id
               WHERE m.reconciliation_id=? AND m.side=? AND r.namespace=? AND r.source_key=?"""
    count = store.conn.execute("SELECT count(*) "+query, params).fetchone()[0]
    rows = [r[0] for r in store.conn.execute("SELECT r.id "+query+" ORDER BY r.id LIMIT 20", params)]
    return {"count":count,"rows":rows,"rows_truncated":count>len(rows)}

def _ref(row):
    return {"row_id":row["id"],"source_id":row["source_id"],"original_file_sha256":row["source_ref"]["sha256"],
            "record_ordinal":row["ordinal"],"locator":row["locator"],
            "task_id":row.get("task_id"),"round_label":row.get("round_label"),"job_id":row.get("job_id"),
            "package_number":row["values"].get("package_number")}

def _evidence_candidates(store, row, field, config):
    candidates = [{"row_id":row["id"],"value":row["values"].get(field),"presence":row["presence"].get(field,"missing"),
                   "field":field,"basis":row["values"].get("field_basis",{}).get(field,"missing"),
                   "source_ref":_ref(row),"link_id":None}]
    links = []
    for link_id in config.get("evidence_link_ids", []):
        link = store.get_entity("evidence_link",link_id)
        if link["subject_row_id"] == row["id"] and field in link["fields"]:
            links.append(link)
    mapping_id = config.get("evidence_mapping_id")
    if mapping_id:
        for entry in store.conn.execute("SELECT body_json FROM mapping_entries WHERE mapping_id=? AND source_row_id=? ORDER BY ordinal",
                                        (mapping_id,row["id"])):
            link = parse_json(entry[0])
            if field in link.get("fields", []):
                links.append(link)
                if len(links)>100:
                    break
    if len(links)>100:
        return {"state":"AMBIGUOUS","value":None,"presence":"ambiguous","candidates":candidates,
                "reason":"more_than_100_explicit_evidence_links_for_field","evidence_preview_truncated":True}
    for link in links:
        evidence = row_description(store,link["evidence_row_id"])
        candidates.append({"row_id":evidence["id"],"value":evidence["values"].get(field),
                           "presence":evidence["presence"].get(field,"missing"),"field":field,
                           "basis":"reviewed_original_occurrence_link","source_ref":_ref(evidence),"link_id":link["id"]})
    known = [c for c in candidates if c["presence"]=="value"]
    variants = {canonical(sorted(set(c["value"])) if field=="principals" else c["value"]) for c in known}
    if len(variants)>1:
        return {"state":"AMBIGUOUS","value":None,"presence":"ambiguous","candidates":candidates,
                "reason":"conflicting_original_field_evidence"}
    if known:
        return {"state":"KNOWN","value":known[0]["value"],"presence":"value","candidates":candidates}
    return {"state":"UNKNOWN","value":None,"presence":candidates[0]["presence"],"candidates":candidates,
            "reason":"no_known_original_field_value"}

def _principals(store, expected, mapping_id):
    if expected["state"] != "KNOWN":
        return expected
    original = expected["value"]
    if not mapping_id:
        return {**expected,"value":sorted(set(original)),"comparison_basis":"literal_declared_principal_sets"}
    mapping = store.get_entity("mapping",mapping_id)
    missing, conflicts, converted, bindings = [], [], [], []
    for principal in original:
        records = [parse_json(r[0]) for r in store.conn.execute("SELECT body_json FROM mapping_entries WHERE mapping_id=? AND source_principal=? ORDER BY ordinal LIMIT 102", (mapping_id,principal))]
        distinct = {(r["target_principal"],r["is_group"]) for r in records}
        if not records:
            missing.append(principal)
        elif len(records)>100 or len(distinct)>1:
            conflicts.append(principal)
        else:
            target, group = next(iter(distinct))
            converted.append(target)
            bindings.append({"source_principal":principal,"target_principal":target,"is_group":group,
                             "mapping_entry_ids":[r["id"] for r in records]})
    if conflicts:
        return {**expected,"state":"AMBIGUOUS","value":None,"reason":"conflicting_reviewed_principal_mapping",
                "conflicting_principals":conflicts,"bindings":bindings,"mapping_id":mapping_id}
    if missing:
        return {**expected,"state":"UNKNOWN","value":None,"reason":"principal_mapping_not_observed",
                "unmapped_principals":missing,"entra_fallback":mapping.get("options",{}).get("entra_fallback","unknown"),
                "mapping_id":mapping_id,"bindings":bindings}
    return {**expected,"value":sorted(set(converted)),"mapping_id":mapping_id,"bindings":bindings,
            "comparison_basis":"reviewed_identity_mapping_of_declared_principals_not_effective_access"}

def _check(store, name, expected_row, observed_row, config):
    if name == "presence":
        if observed_row["role"] in ("migration_items","migration_failures"):
            return {"status":"UNKNOWN","meaning":"One original migration attempt is linked; a report occurrence alone does not verify independent target-inventory presence"}
        return {"status":"MATCH","meaning":"One selected original target inventory occurrence is linked to this source occurrence"}
    expected_field, observed_field = FIELDS[name]
    expected = _evidence_candidates(store,expected_row,expected_field,config)
    observed = _evidence_candidates(store,observed_row,observed_field,config)
    if name == "principals":
        expected = _principals(store,expected,config.get("principal_mapping_id"))
        if observed["state"]=="KNOWN":
            observed = {**observed,"value":sorted(set(observed["value"]))}
    out = {"expected":expected,"observed":observed}
    if "AMBIGUOUS" in (expected["state"],observed["state"]):
        return {**out,"status":"AMBIGUOUS","meaning":"Conflicting supplied evidence prevents a single comparison"}
    if "UNKNOWN" in (expected["state"],observed["state"]):
        return {**out,"status":"UNKNOWN","meaning":"One or both original field values are missing, null, invalid or unresolved"}
    if name == "classification_order":
        before = datetime.fromisoformat(expected["value"].replace("Z","+00:00"))
        after = datetime.fromisoformat(observed["value"].replace("Z","+00:00"))
        equal = before <= after
        out["meaning"] = "Ordering of supplied same-object timestamps; not enforced policy or compliance"
    else:
        equal = expected["value"] == observed["value"]
        out["meaning"] = {
            "path":"Explicit supplied expected target path versus original target item path; no path transformation inferred",
            "size":"Supplied declared item sizes; original byte counts are separately identified by report file",
            "hash":"Supplied content digest equality; retained report digests are not substituted",
            "principals":"Declared principal-set comparison only; roles, inheritance and group membership are not inferred",
            "label":"Supplied label metadata comparison only; no DLP or policy-effectiveness claim"
        }[name]
    return {**out,"status":"MATCH" if equal else "DIFFERENT"}

def _calculate_complete_scope(store, round_body, role, namespace):
    relevant = [entry for entry in round_body["sources"] if entry["role"]==role and entry["context"]["identity_namespace"]==namespace]
    if not relevant:
        return {"complete":False,"reason":"no_selected_inventory_for_namespace","sources":[]}
    reasons, refs = [], []
    for entry in relevant:
        source = source_description(store,entry["source_id"])
        ctx = source["context"]
        refs.append({"source_id":source["id"],"sha256":source["file_sha256"],"selector":entry["selector"]})
        if source["status"]!="READY" or ctx["coverage"]["mode"]!="complete":
            reasons.append("inventory_coverage_not_declared_complete")
        if source["summary"].get("issues"):
            reasons.append("original_capture_count_conflict")
        if source["format"] not in ("inventory_csv","inventory_jsonl"):
            reasons.append("report_is_not_independent_inventory")
        # A filter can only preserve a complete scope when that exact scope was declared in the source context.
        for key, value in entry["selector"].items():
            if key != "source_id" and ctx.get(key) != value:
                reasons.append("row_filter_has_no_matching_complete_source_scope")
        count = store.conn.execute("""SELECT count(*) FROM round_members m JOIN rows r ON r.id=m.row_id
                                      WHERE m.round_id=? AND r.source_id=? AND (r.source_key IS NULL OR r.source_key='')""",
                                   (round_body["id"],source["id"])).fetchone()[0]
        if count:
            reasons.append("inventory_has_unidentified_original_occurrences")
    return {"complete":not reasons,"reason":None if not reasons else sorted(set(reasons)),"sources":refs,
            "basis":"operator_declared_complete_selected_inventory"}

def _complete_scope(store, round_body, role, namespace):
    cache = getattr(store, "_migration_coverage_cache", None)
    if cache is None:
        cache = store._migration_coverage_cache = {}
    key = (round_body["id"],role,namespace)
    if key not in cache:
        cache[key] = _calculate_complete_scope(store,round_body,role,namespace)
    return cache[key]

def _status_context(store, row, mapping_id):
    raw = row["values"].get("status")
    result = {"original_status":raw,"result_category":row["values"].get("result_category"),
              "message":row["values"].get("message"),"error_code":row["values"].get("error_code"),
              "source_ref":_ref(row),"classification":None}
    if raw is None or not mapping_id:
        result["meaning"] = "Original provider vocabulary retained without an assumed classification"
        return result
    records = [parse_json(r[0]) for r in store.conn.execute("SELECT body_json FROM mapping_entries WHERE mapping_id=? AND raw_status=? ORDER BY ordinal LIMIT 102", (mapping_id,raw))]
    classes = {r["classification"] for r in records}
    if len(records)>100 or len(classes)>1:
        result["mapping_state"] = "AMBIGUOUS"
    elif len(classes)==1:
        result["classification"] = next(iter(classes))
        result["mapping_state"] = "EXPLICIT_REVIEWED_MAPPING"
    else:
        result["mapping_state"] = "UNKNOWN"
    result["mapping_entry_ids"] = [r["id"] for r in records[:100]]
    result["meaning"] = "Reported migration status is separate from verification of target fields"
    return result

def _identity_target(store, rec_id, expected, config):
    mapping_id = config.get("identity_mapping_id")
    bindings = []
    if mapping_id:
        records = [parse_json(r[0]) for r in store.conn.execute("SELECT body_json FROM mapping_entries WHERE mapping_id=? AND source_row_id=? ORDER BY ordinal LIMIT 102",(mapping_id,expected["id"]))]
        bindings = [r["id"] for r in records[:100]]
        targets = sorted({r["target_row_id"] for r in records})
        if records:
            outside = [t for t in targets if not _member(store,rec_id,"observed",t)]
            if len(records)>100 or len(targets)!=1 or outside:
                return {"state":"AMBIGUOUS","reason":"reviewed_link_is_multiple_or_outside_selected_target_scope",
                        "candidate_ids":targets[:20],"mapping_entry_ids":bindings,"outside_selected_scope":outside[:20]}
            target = targets[0]
            # A single target occurrence cannot silently satisfy multiple selected baseline occurrences.
            other_sources = [r[0] for r in store.conn.execute("""SELECT DISTINCT e.source_row_id FROM mapping_entries e
                     JOIN reconciliation_members m ON m.row_id=e.source_row_id
                     WHERE e.mapping_id=? AND e.target_row_id=? AND m.reconciliation_id=? AND m.side='expected' LIMIT 3""",
                     (mapping_id,target,rec_id))]
            if len(other_sources)>1:
                return {"state":"AMBIGUOUS","reason":"one_target_occurrence_has_multiple_selected_source_links",
                        "candidate_ids":[target],"mapping_entry_ids":bindings,"source_rows":other_sources}
            return {"state":"LINKED","target_id":target,"basis":"reviewed_exact_occurrence_link","mapping_entry_ids":bindings}
    if config["identity_policy"]["mode"]=="explicit_map":
        return {"state":"UNKNOWN","reason":"no_reviewed_exact_occurrence_link","mapping_entry_ids":bindings}
    key = expected.get("source_key")
    if not key:
        return {"state":"UNKNOWN","reason":"original_source_identifier_is_unavailable"}
    sources = _group(store,rec_id,"expected",expected["namespace"],key)
    targets = _group(store,rec_id,"observed",expected["namespace"],key)
    if sources["count"]!=1 or targets["count"]>1:
        return {"state":"AMBIGUOUS","reason":"repeated_original_occurrences_not_deduplicated",
                "source_group":sources,"target_group":targets}
    if not targets["count"]:
        return {"state":"ABSENT","reason":"no_selected_original_target_occurrence"}
    candidate = targets["rows"][0]
    if mapping_id:
        claimed = [r[0] for r in store.conn.execute("""SELECT DISTINCT e.source_row_id FROM mapping_entries e
            JOIN reconciliation_members m ON m.row_id=e.source_row_id
            WHERE e.mapping_id=? AND e.target_row_id=? AND m.reconciliation_id=? AND m.side='expected' AND e.source_row_id<>? LIMIT 3""",
            (mapping_id,candidate,rec_id,expected["id"]))]
        if claimed:
            return {"state":"AMBIGUOUS","reason":"shared_identifier_target_has_another_reviewed_source_occurrence_link",
                    "candidate_ids":[candidate],"source_rows":claimed}
    return {"state":"LINKED","target_id":candidate,"basis":"reviewed_shared_source_id_within_exact_namespace"}

def _reported_context(store, round_id, expected, mapping_id):
    if not expected.get("source_key"):
        return {"total":0,"rows":[],"meaning":"No source identifier for a reported-status join"}
    params = (round_id,expected["namespace"],expected["source_key"])
    query = """FROM round_members m JOIN rows r ON r.id=m.row_id WHERE m.round_id=?
               AND r.namespace=? AND r.source_key=? AND r.role IN ('migration_items','migration_failures')"""
    total = store.conn.execute("SELECT count(*) "+query,params).fetchone()[0]
    ids = [r[0] for r in store.conn.execute("SELECT r.id "+query+" ORDER BY r.source_id,r.ordinal LIMIT 20",params)]
    return {"total":total,"rows":[_status_context(store,row_description(store,i),mapping_id) for i in ids],
            "preview_truncated":total>len(ids),
            "meaning":"All retained task/round occurrences remain separate; no latest-event or success-over-failure preference is inferred"}

def _expected_item(store, rec_id, expected, config, round_body):
    match = _identity_target(store,rec_id,expected,config)
    body = {"schema":"ma-dor.reconciliation-item/v1","id":"item-"+identity({"reconciliation":rec_id,"expected":expected["id"]})[:40],
            "reconciliation_id":rec_id,"kind":"expected_occurrence","expected_row_id":expected["id"],"observed_row_id":None,
            "identity_key":{"namespace":expected["namespace"],"source_id":expected.get("source_key")},
            "expected_source_ref":_ref(expected),"identity":match,"checks":{},
            "limitations":["Supplied original evidence only; no tenant action or effective-permissions or policy certification."]}
    body["reported_status_context"] = _reported_context(store,round_body["id"],expected,config.get("status_mapping_id"))
    if match["state"]=="LINKED":
        observed = row_description(store,match["target_id"])
        body["observed_row_id"] = observed["id"]
        body["observed_source_ref"] = _ref(observed)
        body["reported_migration_status"] = _status_context(store,observed,config.get("status_mapping_id"))
        body["checks"] = {name:_check(store,name,expected,observed,config) for name in config["checks"]}
        statuses = {c["status"] for c in body["checks"].values()}
        body["status"] = "AMBIGUOUS" if "AMBIGUOUS" in statuses else "DIFFERENT" if "DIFFERENT" in statuses else "UNKNOWN" if "UNKNOWN" in statuses else "MATCH"
        reported = body["reported_migration_status"]
        if reported.get("classification")=="reported_success":
            body["checks"]["reported_migration_status"] = {"status":"MATCH","meaning":"Explicitly mapped original reported success; it does not supply missing target fields or independent target presence"}
        elif reported.get("classification")=="reported_failure":
            # A provider reports failure even when other supplied fields happen to agree.
            body["status"] = "DIFFERENT"
            body["checks"]["reported_migration_status"] = {"status":"DIFFERENT","meaning":"Explicitly mapped original provider failure; independent target-field checks remain above"}
        elif reported.get("classification") in ("reported_filtered","reported_in_progress"):
            body["checks"]["reported_migration_status"] = {"status":"UNKNOWN","meaning":"Original report describes filtering or work in progress, not completed migration"}
            if body["status"]=="MATCH":
                body["status"] = "UNKNOWN"
        if reported.get("mapping_state")=="AMBIGUOUS":
            body["status"] = "AMBIGUOUS"
            body["checks"]["reported_migration_status"] = {"status":"AMBIGUOUS","meaning":"The selected reviewed vocabulary has conflicting mappings for this original status"}
    elif match["state"]=="ABSENT":
        coverage = _complete_scope(store,round_body,"target_inventory",expected["namespace"])
        complete = config["target_basis"]=="target_inventory" and coverage["complete"]
        body["status"] = "MISSING" if complete else "UNKNOWN"
        body["checks"]["presence"] = {"status":"DIFFERENT" if complete else "UNKNOWN",
                                     "meaning":"No matching target occurrence in explicitly complete selected inventory" if complete else "No selected target occurrence; capture scope cannot prove absence",
                                     "coverage":coverage}
    else:
        body["status"] = match["state"]
        body["checks"]["presence"] = {"status":match["state"],"meaning":match["reason"]}
    return body

def _save_item(store, body):
    old = store.conn.execute("SELECT body_json FROM reconciliation_items WHERE id=?", (body["id"],)).fetchone()
    serialized = canonical(body)
    if old:
        if old[0] != serialized:
            raise MigrationError("RECONCILIATION_PREFIX_CHANGED", "Original frozen item differs on continuation", {"id":body["id"]})
        return
    store.conn.execute("INSERT INTO reconciliation_items VALUES(?,?,?,?,?,?,?)",
                       (body["id"],body["reconciliation_id"],body.get("expected_row_id"),body.get("observed_row_id"),
                        canonical(body["identity_key"]),body["status"],serialized))

def _observed_unpaired(store, rec_id, observed, config, round_body):
    used = store.conn.execute("SELECT 1 FROM reconciliation_items WHERE reconciliation_id=? AND observed_row_id=? AND expected_row_id IS NOT NULL LIMIT 1", (rec_id,observed["id"])).fetchone()
    if used:
        return None
    group = _group(store,rec_id,"expected",observed["namespace"],observed.get("source_key"))
    target_group = _group(store,rec_id,"observed",observed["namespace"],observed.get("source_key"))
    coverage = _complete_scope(store,round_body,"source_inventory",observed["namespace"])
    if group["count"] or target_group["count"]>1:
        status, reason = "AMBIGUOUS","Original occurrence could not be paired without collapsing or contradicting retained identity evidence"
    elif observed["role"] in ("migration_items","migration_failures"):
        status, reason = "UNKNOWN","Unpaired reported migration attempt outside the selected baseline; it does not establish an unexpected target item"
    elif config["identity_policy"]["mode"]=="shared_source_id" and observed.get("source_key") and coverage["complete"]:
        status, reason = "UNEXPECTED","Target inventory identifier is absent from the explicitly complete selected baseline inventory"
    else:
        status, reason = "UNKNOWN","Unlinked target occurrence; incomplete baseline or explicit identity evidence cannot prove it unexpected"
    return {"schema":"ma-dor.reconciliation-item/v1","id":"item-"+identity({"reconciliation":rec_id,"observed":observed["id"]})[:40],
            "reconciliation_id":rec_id,"kind":"unpaired_observed_occurrence","expected_row_id":None,"observed_row_id":observed["id"],
            "identity_key":{"namespace":observed["namespace"],"source_id":observed.get("source_key")},
            "status":status,"observed_role":observed["role"],"observed_source_ref":_ref(observed),"identity":{"reason":reason,"source_group":group,"target_group":target_group},
            "checks":{},"baseline_coverage":coverage,"reported_migration_status":_status_context(store,observed,config.get("status_mapping_id"))}

def _summarize(store, rec_id):
    expected_status, unpaired_status, field_status = Counter(), Counter(), {}
    known_expected, known_observed, known_expected_n, unknown_expected_n, known_observed_n, unknown_observed_n, pairs = 0,0,0,0,0,0,0
    for saved in store.conn.execute("SELECT body_json FROM reconciliation_items WHERE reconciliation_id=? ORDER BY id",(rec_id,)):
        item = parse_json(saved[0])
        if item["kind"]=="expected_occurrence":
            expected_status[item["status"]] += 1
            for name, check in item["checks"].items():
                field_status.setdefault(name,Counter())[check["status"]] += 1
            source = store.conn.execute("SELECT values_json,presence_json FROM rows WHERE id=?",(item["expected_row_id"],)).fetchone()
            values, presence = parse_json(source[0]), parse_json(source[1])
            if presence.get("size_bytes")=="value":
                known_expected += int(values["size_bytes"])
                known_expected_n += 1
            else:
                unknown_expected_n += 1
            if item.get("observed_row_id"):
                pairs += 1
                target = store.conn.execute("SELECT values_json,presence_json FROM rows WHERE id=?",(item["observed_row_id"],)).fetchone()
                values, presence = parse_json(target[0]), parse_json(target[1])
                if presence.get("size_bytes")=="value":
                    known_observed += int(values["size_bytes"])
                    known_observed_n += 1
                else:
                    unknown_observed_n += 1
        else:
            unpaired_status[item["status"]] += 1
    expected_n = store.conn.execute("SELECT count(*) FROM reconciliation_members WHERE reconciliation_id=? AND side='expected'", (rec_id,)).fetchone()[0]
    observed_n = store.conn.execute("SELECT count(*) FROM reconciliation_members WHERE reconciliation_id=? AND side='observed'", (rec_id,)).fetchone()[0]
    return {"expected_occurrences":expected_n,"observed_occurrences":observed_n,"linked_pairs":pairs,
            "expected_status_counts":dict(expected_status),"unpaired_observed_status_counts":dict(unpaired_status),
            "field_status_counts":{name:dict(counts) for name,counts in field_status.items()},
            "quantities":{"known_expected_occurrence_bytes":str(known_expected),"expected_size_known_occurrences":known_expected_n,
                          "expected_size_unknown_occurrences":unknown_expected_n,
                          "known_linked_observed_occurrence_bytes":str(known_observed),
                          "linked_observed_size_known_occurrences":known_observed_n,"linked_observed_size_unknown_occurrences":unknown_observed_n,
                          "basis":"Sums of known declared sizes over retained occurrences, not a deduplicated or independently verified content volume"},
            "item_count":sum(expected_status.values())+sum(unpaired_status.values())}

def reconcile(store, op):
    store._migration_coverage_cache = {}
    p = op["request"]
    rec_id = "reconciliation-"+identity({"operation":op["id"],"request":op["request_sha256"]})[:40]
    old = store.get_entity("reconciliation",rec_id,required=False)
    if old:
        return old
    round_body = store.get_entity("round",p.get("round_id"))
    text(p.get("title"),"title")
    policy = p.get("identity_policy")
    if not isinstance(policy,dict) or policy.get("mode") not in ("shared_source_id","explicit_map"):
        raise MigrationError("IDENTITY_POLICY", "Choose an explicit identity policy")
    text(policy.get("reason"),"identity_policy.reason")
    checks = p.get("checks",list(CHECKS))
    if not isinstance(checks,list) or not checks or len(set(checks))!=len(checks) or any(c not in CHECKS for c in checks):
        raise MigrationError("CHECK_SELECTION", "Choose unique advertised field checks")
    target_basis = p.get("target_basis","target_inventory")
    if target_basis not in ("target_inventory","migration_items"):
        raise MigrationError("TARGET_BASIS", "Choose target inventory or reported migration items")
    config = {"identity_policy":policy,"checks":checks,"target_basis":target_basis}
    for field, kind in (("identity_mapping_id","identity"),("principal_mapping_id","principal"),("status_mapping_id","status"),("evidence_mapping_id","evidence")):
        value = p.get(field)
        if value:
            mapping = store.get_entity("mapping",value)
            if mapping["kind"] != kind:
                raise MigrationError("MAPPING_KIND", "Selected mapping has the wrong kind", {"field":field})
            config[field] = value
    evidence_ids = p.get("evidence_link_ids",[])
    if not isinstance(evidence_ids,list) or len(evidence_ids)>1000 or len(set(evidence_ids))!=len(evidence_ids):
        raise MigrationError("EVIDENCE_LINKS", "Select unique retained evidence links; use an imported evidence mapping for larger collections")
    config["evidence_link_ids"] = evidence_ids
    for link_id in evidence_ids:
        link = store.get_entity("evidence_link",link_id)
        for row_id in (link["subject_row_id"],link["evidence_row_id"]):
            if not store.conn.execute("SELECT 1 FROM round_members WHERE round_id=? AND row_id=?", (round_body["id"],row_id)).fetchone():
                raise MigrationError("EVIDENCE_SCOPE", "Evidence links must bind original rows selected by this round", {"row_id":row_id})
    signature = {"engine":ENGINE_VERSION,"module_sha256":file_hash(Path(__file__))["sha256"]}
    previous = op.get("checkpoint")
    if previous and previous.get("engine") != signature:
        raise MigrationError("ENGINE_CHANGED", "Resume requires the original reconciliation engine bytes")
    with store.transaction():
        store.conn.execute("""INSERT OR IGNORE INTO reconciliation_members SELECT ?, 'expected',r.id
                              FROM round_members m JOIN rows r ON r.id=m.row_id WHERE m.round_id=? AND r.role='source_inventory'""",
                           (rec_id,round_body["id"]))
        roles = ("target_inventory",) if target_basis=="target_inventory" else ("migration_items","migration_failures")
        placeholders = ",".join("?" for _ in roles)
        store.conn.execute(f"""INSERT OR IGNORE INTO reconciliation_members SELECT ?, 'observed',r.id
                                FROM round_members m JOIN rows r ON r.id=m.row_id WHERE m.round_id=? AND r.role IN ({placeholders})""",
                           (rec_id,round_body["id"],*roles))
        # The immutable round includes all additional status, summary and classification source rows.
        store.conn.execute("UPDATE operations SET checkpoint_json=? WHERE id=?",
                           (canonical({"phase":"reconciling","reconciliation_id":rec_id,"engine":signature,"items_retained":0}),op["id"]))
    if config.get("evidence_mapping_id"):
        bad = store.conn.execute("""SELECT e.id FROM mapping_entries e
            LEFT JOIN round_members s ON s.round_id=? AND s.row_id=e.source_row_id
            LEFT JOIN round_members t ON t.round_id=? AND t.row_id=e.target_row_id
            WHERE e.mapping_id=? AND (s.row_id IS NULL OR t.row_id IS NULL) LIMIT 1""",
            (round_body["id"],round_body["id"],config["evidence_mapping_id"])).fetchone()
        if bad:
            raise MigrationError("EVIDENCE_SCOPE", "Imported evidence mapping includes rows outside the frozen round", {"entry_id":bad[0]})
    retained, active, batch = 0, False, 0
    try:
        for side in ("expected","observed"):
            # Keyset paging keeps only one bounded page and one original row in memory.
            last = ""
            while True:
                ids = [r[0] for r in store.conn.execute("SELECT row_id FROM reconciliation_members WHERE reconciliation_id=? AND side=? AND row_id>? ORDER BY row_id LIMIT 250", (rec_id,side,last))]
                if not ids:
                    break
                for row_id in ids:
                    row = row_description(store,row_id)
                    body = _expected_item(store,rec_id,row,config,round_body) if side=="expected" else _observed_unpaired(store,rec_id,row,config,round_body)
                    if body is not None:
                        if not active:
                            store.conn.execute("BEGIN IMMEDIATE")
                            active = True
                        _save_item(store,body)
                        retained += 1
                        batch += 1
                    if batch>=100:
                        store.conn.execute("UPDATE operations SET checkpoint_json=? WHERE id=?",
                                           (canonical({"phase":"reconciling","reconciliation_id":rec_id,"engine":signature,"items_retained":retained,"side":side,"last_row_id":row_id}),op["id"]))
                        store.conn.execute("COMMIT")
                        active,batch = False,0
                last = ids[-1]
            if active:
                store.conn.execute("COMMIT")
                active,batch = False,0
        summary = _summarize(store,rec_id)
        body = {"schema":"ma-dor.reconciliation/v1","id":rec_id,"title":p["title"],"round_id":round_body["id"],
                "created_at":op["created_at"],"created_revision":op["reserved_revision"],"operation_id":op["id"],"actor":op["actor"],
                "engine":signature,"configuration":config,"round_snapshot":round_body,"summary":summary,
                "claim_scope":"Matches and differences concern explicitly supplied original evidence; missing evidence remains unknown",
                "limitations":["No tenant verification, source migration, source deletion, effective-ACL certification or Purview/DLP policy approval.",
                               "Source and destination locations in Migration Manager reports are not assumed to be full item paths.",
                               "Repeated source or target occurrences remain explicit; no latest-row choice or silent deduplication.",
                               "Provider summary denominators and original task/round fields remain in their original rows; they are not subtracted into fabricated missing files."]}
        store.put_entity("reconciliation",rec_id,body,op["reserved_revision"])
        store.checkpoint(op["id"],{"phase":"complete","reconciliation_id":rec_id,"engine":signature,"items_retained":summary["item_count"]})
        return body
    except BaseException:
        if active and store.conn.in_transaction:
            store.conn.execute("ROLLBACK")
        raise
    finally:
        store._migration_coverage_cache = {}

def compare_reconciliations(store, before_id, after_id, *, offset=0, limit=100):
    before = store.get_entity("reconciliation",before_id)
    after = store.get_entity("reconciliation",after_id)
    counts = Counter()
    changes, ordinal, total = [],0,0
    query = """SELECT a.expected_row_id,a.body_json AS after_json,b.body_json AS before_json
               FROM reconciliation_items a LEFT JOIN reconciliation_items b
                 ON b.reconciliation_id=? AND b.expected_row_id=a.expected_row_id
               WHERE a.reconciliation_id=? AND a.expected_row_id IS NOT NULL ORDER BY a.expected_row_id"""
    for row in store.conn.execute(query,(before_id,after_id)):
        current = parse_json(row["after_json"])
        previous = parse_json(row["before_json"]) if row["before_json"] else None
        transition = (previous["status"] if previous else "BASELINE_NOT_SELECTED")+">"+current["status"]
        counts[transition]+=1
        if offset<=ordinal<offset+limit:
            changes.append({"expected_row_id":row["expected_row_id"],"before_item_id":previous["id"] if previous else None,
                            "after_item_id":current["id"],"before_status":previous["status"] if previous else None,
                            "after_status":current["status"],"transition":transition})
        ordinal+=1
    for row in store.conn.execute("""SELECT b.expected_row_id,b.body_json FROM reconciliation_items b
                 WHERE b.reconciliation_id=? AND b.expected_row_id IS NOT NULL
                 AND NOT EXISTS(SELECT 1 FROM reconciliation_items a WHERE a.reconciliation_id=? AND a.expected_row_id=b.expected_row_id)
                 ORDER BY b.expected_row_id""",(before_id,after_id)):
        previous = parse_json(row["body_json"])
        transition = previous["status"]+">BASELINE_NOT_SELECTED"
        counts[transition]+=1
        if offset<=ordinal<offset+limit:
            changes.append({"expected_row_id":row["expected_row_id"],"before_item_id":previous["id"],"after_item_id":None,
                            "before_status":previous["status"],"after_status":None,"transition":transition})
        ordinal+=1
    return {"schema":"ma-dor.reconciliation-comparison/v1","before_id":before_id,"after_id":after_id,
            "baseline_identity":"exact retained source-row occurrence; a new baseline is not silently remapped",
            "before_round_id":before["round_id"],"after_round_id":after["round_id"],
            "transitions":dict(counts),"rows":changes,"total":ordinal,"offset":offset,"limit":limit}
