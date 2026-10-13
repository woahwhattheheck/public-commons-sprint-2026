"""Prepare source-bound scalar Maximo load files and receive original outcomes.

This module never sends a target mutation. The selected prime runs the retained
exact request through its own authorized integration, then returns the complete
original response. A fresh complete target capture verifies resulting values.
"""
from __future__ import annotations
import base64
import json
import time
from .adapters import InvalidData, canonical
from .engine import SHA, Conflict
from .maximo_target import (need, original, wire, key, pointer, parse_capture, load_job, carrier,
                            profile_read, bound_url, schema_check, endpoint, NAME)

def initialize(workspace):
    with workspace.connection(write=True) as db:
        db.execute("""CREATE TABLE IF NOT EXISTS maximo_loads(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,
          request_sha256 TEXT NOT NULL,body BLOB NOT NULL,created_at REAL NOT NULL,summary TEXT)""")
        db.execute("""CREATE TABLE IF NOT EXISTS maximo_load_returns(id TEXT PRIMARY KEY,load_id TEXT NOT NULL,
          body BLOB NOT NULL,report TEXT NOT NULL,actor TEXT NOT NULL,at REAL NOT NULL,summary TEXT)""")
        for table in ("maximo_loads", "maximo_load_returns"):
            if "summary" not in {row["name"] for row in db.execute("PRAGMA table_info("+table+")")}:
                db.execute("ALTER TABLE "+table+" ADD COLUMN summary TEXT")

def prepared_summary(document):
    return {"id": document["id"], "rows": len(document["rows"]), "body_sha256": document["body_sha256"],
            "request_sha256": document["request_sha256"], "created_at": document["prepared_at"]}

def received_summary(report):
    counts = {}
    for row in report["rows"]: counts[row["outcome"]] = counts.get(row["outcome"], 0)+1
    return {k:report[k] for k in ("schema", "load_id", "receive_id", "body_sha256", "http_status", "allornothing", "findings", "verification")} | {
        "row_count": len(report["rows"]), "outcomes": counts}

def scalar(value, definition, field):
    kind = definition.get("type")
    if value is None:
        need(definition.get("nullable") is True or isinstance(kind, list) and "null" in kind,
             "Null is not explicitly permitted by target schema: "+field)
        return
    types = kind if isinstance(kind, list) else [kind]
    from decimal import Decimal
    valid = ("string" in types and isinstance(value, str) or
             "boolean" in types and type(value) is bool or
             "integer" in types and (type(value) is int or isinstance(value, Decimal) and value == value.to_integral()) or
             "number" in types and isinstance(value, (int, Decimal)) and not isinstance(value, bool))
    need(valid, "Source value does not match actual target scalar type: "+field)
    if isinstance(value, str) and "maxLength" in definition:
        need(len(value) <= definition["maxLength"], "Target value exceeds schema maxLength: "+field)
    if "enum" in definition: need(value in definition["enum"], "Target value is outside actual schema enum: "+field)
    if isinstance(value, (int, Decimal)) and not isinstance(value, bool):
        if "minimum" in definition: need(value >= definition["minimum"], "Target number is below schema minimum: "+field)
        if "maximum" in definition: need(value <= definition["maximum"], "Target number exceeds schema maximum: "+field)

def load(workspace, identity):
    initialize(workspace)
    with workspace.connection() as db:
        row = db.execute("SELECT * FROM maximo_loads WHERE id=?", (identity,)).fetchone()
    if not row: raise KeyError(identity)
    return original(row["body"])

def prepare(workspace, project_id, revision, actor, operation, capture_operation, mapping):
    initialize(workspace)
    need(isinstance(operation, str) and NAME.fullmatch(operation), "Use one saved load-preparation operation")
    need(isinstance(actor, str) and actor.strip(), "Name the preparing operator")
    need(isinstance(mapping, dict) and set(mapping) <= {"action", "fields", "constants", "source_ids", "allornothing", "review_reference"},
         "Use the complete selected scalar load mapping")
    need(mapping.get("action") in ("Add", "Update"), "Select Add or Update for this reviewed load")
    need(type(mapping.get("allornothing")) is bool, "Select explicit whole-transaction or per-resource commit semantics")
    need(isinstance(mapping.get("review_reference"), str) and mapping["review_reference"].strip(), "Retain the prime's mapping/rehearsal review reference")
    request = {"project_id": project_id, "revision": revision, "actor": actor,
               "capture_operation": capture_operation, "mapping": mapping}
    request_hash = SHA(canonical(request).encode())
    with workspace.connection() as db:
        prior = db.execute("SELECT request_sha256,body FROM maximo_loads WHERE id=?", (operation,)).fetchone()
    if prior:
        need(prior["request_sha256"] == request_hash, "Original preparation ID belongs to a different source request")
        return original(prior["body"])
    job = load_job(workspace, capture_operation)
    need(job["project_id"] == project_id and job["state"] in ("READY", "RECEIVED"), "Select the complete original target capture")
    target_body = carrier(workspace, job)
    target = json.loads(target_body)
    profile = profile_read(target["profile"])
    schema_item = next(x for x in target["originals"] if x["step"] == "schema")
    schema = original(base64.b64decode(schema_item["body_base64"]))
    schema_check(profile, schema)
    properties = schema["properties"]
    fields, constants = mapping.get("fields", {}), mapping.get("constants", {})
    need(isinstance(fields, dict) and isinstance(constants, dict) and fields,
         "Map at least one source field and optional explicit constants")
    need(not set(fields) & set(constants), "A target field cannot be both mapped and constant")
    names = set(fields) | set(constants)
    for name in names:
        need(name in properties and name not in ("href", "_action", "_rowstamp") and not properties[name].get("readOnly")
             and properties[name].get("type") not in ("object", "array"),
             "Use writable actual root scalar fields only: "+name)
    for selector in fields.values(): pointer({}, selector)
    source_ids = mapping.get("source_ids")
    need(source_ids is None or isinstance(source_ids, list) and source_ids and
         len(source_ids) == len(set(source_ids)) and all(isinstance(x, str) for x in source_ids),
         "Select unique original source IDs or null for the complete nonexcluded population")
    with workspace.connection() as db:
        project = workspace.project(project_id, db)
        if project["revision"] != revision: raise Conflict("Current project changed before load preparation")
        data, issues = workspace._data(project["state"])
    need(not issues, "Resolve current mapping issues before native load preparation")
    source = data.get("source_assets", [])
    need(source and project["state"]["mappings"].get("source_assets", {}).get("confirmed"), "Confirm the original source mapping first")
    source = [row for row in source if row["id"] not in project["state"]["exclusions"]]
    need(len({row["id"] for row in source}) == len(source), "Original source IDs are repeated")
    if source_ids is not None:
        need(set(source_ids).issubset({r["id"] for r in source}), "Selection refers to missing or excluded original source rows")
        source = [row for row in source if row["id"] in set(source_ids)]
    parsed = parse_capture(target)
    native = {row["id"]: original(row["attributes"]["maximo_original_json"].encode()) for row in parsed["rows"]}
    native_key_set = {key([raw.get(field) for field in profile["identity_fields"]]) for raw in native.values()}
    operations, binding, keys = [], [], set()
    for row in source:
        raw_source = dict(row)
        if row.get("attributes"):
            raw_source["attributes"] = original(row["attributes"].encode())
        values = dict(constants)
        for name, selector in fields.items():
            current = raw_source
            tokens = selector[1:].split("/")
            present = True
            for token in tokens:
                token = token.replace("~1", "/").replace("~0", "~")
                if isinstance(current, dict) and token in current: current = current[token]
                else: present = False; break
            need(present, "Mapped source field is absent in "+row["id"]+": "+selector)
            values[name] = current
        for name, value in values.items(): scalar(value, properties[name], name)
        for name, expected in profile["scope_equals"].items():
            need(values.get(name) == expected, "Prepared org/site fields must match the original selected capture")
        identity = key([values.get(name) for name in profile["identity_fields"]])
        need(identity not in keys, "Prepared rows collide on the actual target compound key")
        keys.add(identity)
        payload = {**values, "_action": mapping["action"]}
        if mapping["action"] == "Add":
            need(row["id"] not in native and identity not in native_key_set, "An Add conflicts with an observed native target record")
            required = set(schema.get("required", [])) if isinstance(schema.get("required", []), list) else set()
            required |= {name for name, value in properties.items() if value.get("required") is True}
            need(required.issubset(values), "Required original target fields are absent: "+", ".join(sorted(required-set(values))))
        else:
            need(row["id"] in native, "Update needs the explicit source-to-native binding from the selected capture")
            target_row = native[row["id"]]
            need(key([target_row.get(name) for name in profile["identity_fields"]]) == identity,
                 "Update cannot change the original native compound identity")
            payload["href"] = bound_url(profile, target_row["href"])
            stamp = target_row.get("_rowstamp")
            need(isinstance(stamp, str) and stamp, "Update requires the original native string _rowstamp; refresh the selected capture")
            payload["_rowstamp"] = stamp
        operations.append(payload)
        binding.append({"position": len(binding), "source_id": row["id"], "native_key": identity,
                        "native_href": payload.get("href"), "original_rowstamp": payload.get("_rowstamp"), "original_target_sha256": SHA(wire(native[row["id"]])) if row["id"] in native else None})
    body = wire(operations, maximum=8*1024*1024)
    document = {"schema": "municipal.maximo-load.v1", "id": operation, "request": request,
                "source_binding": {"project_id": project_id, "revision": revision,
                   "source_input": project["state"]["inputs"]["source_assets"],
                   "source_sha256": workspace.input(project["state"]["inputs"]["source_assets"], project_id)["sha256"],
                   "source_mapping": project["state"]["mappings"]["source_assets"],
                   "target_capture": capture_operation, "target_sha256": SHA(target_body),
                   "schema_sha256": schema_item["meta"]["sha256"]},
                "target": {"api_base": profile["api_base"], "object_structure": profile["object_structure"],
                           "scope_equals": profile["scope_equals"]},
                "method": "POST", "url": endpoint(profile, "os/"+profile["object_structure"], {"lean":"1"}),
                "headers": {"Content-Type":"application/json", "x-method-override":"BULK",
                            "allornothing":"1" if mapping["allornothing"] else "0", "transactionid": operation,
                            **({"patchtype":"MERGE"} if mapping["action"] == "Update" else {})},
                "body_base64": base64.b64encode(body).decode(), "body_sha256": SHA(body),
                "rows": binding, "prepared_at": time.time(),
                "dispatch": "Prepared original request for the prime's selected integration; no provider mutation executed"}
    document["request_sha256"] = SHA(wire({k:document[k] for k in ("method", "url", "headers", "body_sha256")}))
    encoded = wire(document, maximum=16*1024*1024)
    with workspace.connection(write=True) as db:
        current = workspace.project(project_id, db)
        if current["revision"] != revision: raise Conflict("The source project changed; prepare from its current revision")
        prior = db.execute("SELECT request_sha256,body FROM maximo_loads WHERE id=?", (operation,)).fetchone()
        if prior:
            need(prior["request_sha256"] == request_hash, "Load operation was used concurrently")
            return original(prior["body"])
        db.execute("INSERT INTO maximo_loads(id,project_id,request_sha256,body,created_at,summary) VALUES(?,?,?,?,?,?)",
                   (operation, project_id, request_hash, encoded, time.time(), canonical(prepared_summary(document))))
    return document

def receive(workspace, project_id, load_id, operation, actor, returned):
    saved = load(workspace, load_id)
    need(saved["request"]["project_id"] == project_id, "Receive the load in its original project")
    need(isinstance(operation, str) and NAME.fullmatch(operation), "Use the original result-receiving operation")
    need(isinstance(actor, str) and actor.strip(), "Name the receiving operator")
    need(isinstance(returned, dict) and set(returned) == {"prepared_request_sha256", "request_body_sha256", "http_status", "headers", "body_base64", "observed_at", "provider_reference"},
         "Retain the complete original HTTP result and exact request binding")
    need(returned["prepared_request_sha256"] == saved["request_sha256"], "Returned result belongs to a different method, target or header contract")
    need(returned["request_body_sha256"] == saved["body_sha256"], "Returned result belongs to a different request body")
    need(type(returned["http_status"]) is int and 100 <= returned["http_status"] <= 599, "Retain the actual HTTP status")
    need(isinstance(returned["headers"], dict) and all(isinstance(k, str) and isinstance(v, str) for k,v in returned["headers"].items()),
         "Retain original provider response header strings")
    need(isinstance(returned["observed_at"], str) and returned["observed_at"], "Retain the original result observation time")
    need(isinstance(returned["provider_reference"], str) and returned["provider_reference"], "Retain the original source/provider receipt reference")
    raw = base64.b64decode(returned["body_base64"], validate=True)
    need(len(raw) <= 8*1024*1024, "Retain a bounded complete bulk response")
    findings, results, parsed = [], [], None
    try: parsed = original(raw)
    except InvalidData as error: findings.append(str(error))
    if returned["http_status"] != 200: findings.append("Original HTTP status is "+str(returned["http_status"]))
    if not isinstance(parsed, list) or len(parsed) != len(saved["rows"]):
        findings.append("Original per-resource response population does not match the prepared request")
    for position, expected in enumerate(saved["rows"]):
        response = parsed[position] if isinstance(parsed, list) and position < len(parsed) else None
        meta = response.get("_responsemeta", {}) if isinstance(response, dict) else {}
        if not isinstance(meta, dict): meta = {}
        supplied = meta.get("status")
        status = int(supplied) if isinstance(supplied, (int, str)) and str(supplied).isdigit() else None
        data = response.get("_responsedata") if isinstance(response, dict) else None
        error = data.get("Error") if isinstance(data, dict) else None
        outcome = "accepted_pending" if status == 202 and not error else "reported_success" if status is not None and 200 <= status < 300 and not error else "reported_rejection" if status is not None and status >= 400 else "unknown"
        results.append({**expected, "reported_status": status, "outcome": outcome,
                        "resource_location": meta.get("Location", meta.get("location")), "original_response": response})
    all_or_nothing = saved["headers"]["allornothing"] == "1"
    if returned["http_status"] != 200 or findings:
        for row in results: row["outcome"] = "unknown"
    elif all_or_nothing and any(row["outcome"] == "reported_rejection" for row in results):
        for row in results: row["outcome"] = "transaction_not_committed"
    elif all_or_nothing and any(row["outcome"] == "unknown" for row in results):
        for row in results: row["outcome"] = "unknown"
    elif all_or_nothing and any(row["outcome"] == "accepted_pending" for row in results):
        for row in results: row["outcome"] = "accepted_pending"
    report = {"schema": "municipal.maximo-load-result.v1", "load_id": load_id, "receive_id": operation,
              "body_sha256": SHA(raw), "http_status": returned["http_status"],
              "allornothing": all_or_nothing, "rows": results, "findings": findings,
              "verification": "Capture the complete current target again and compare in the same project; a reported mutation is not a verified target population"}
    encoded = canonical(returned).encode()
    with workspace.connection(write=True) as db:
        old = db.execute("SELECT * FROM maximo_load_returns WHERE id=?", (operation,)).fetchone()
        if old:
            need(old["load_id"] == load_id and old["body"] == encoded and old["actor"] == actor,
                 "Original receiving operation belongs to a different result")
            return json.loads(old["report"])
        db.execute("INSERT INTO maximo_load_returns(id,load_id,body,report,actor,at,summary) VALUES(?,?,?,?,?,?,?)",
                   (operation, load_id, encoded, wire(report, maximum=16*1024*1024).decode(), actor, time.time(),
                    canonical(received_summary(report))))
    return report

def list_loads(workspace, project_id):
    initialize(workspace)
    # Older retained editions are summarized once. Routine state reads select no BLOBs.
    with workspace.connection(write=True) as db:
        missing = list(db.execute("SELECT id,body FROM maximo_loads WHERE project_id=? AND summary IS NULL", (project_id,)))
        for row in missing:
            doc = original(row["body"])
            if "request_sha256" not in doc:
                doc["request_sha256"] = SHA(wire({k:doc[k] for k in ("method","url","headers","body_sha256")}))
            db.execute("UPDATE maximo_loads SET summary=? WHERE id=?", (canonical(prepared_summary(doc)),row["id"]))
        missing_returns = list(db.execute("""SELECT r.id,r.report FROM maximo_load_returns r JOIN maximo_loads l ON l.id=r.load_id
             WHERE l.project_id=? AND r.summary IS NULL""", (project_id,)))
        for row in missing_returns:
            db.execute("UPDATE maximo_load_returns SET summary=? WHERE id=?",
                       (canonical(received_summary(json.loads(row["report"]))),row["id"]))
        values = list(db.execute("SELECT id,summary FROM maximo_loads WHERE project_id=? ORDER BY created_at DESC", (project_id,)))
        result = []
        for row in values:
            item = json.loads(row["summary"])
            item["returns"] = [{"id": x["id"], "actor": x["actor"], "at": x["at"], "report": json.loads(x["summary"])}
               for x in db.execute("SELECT id,actor,at,summary FROM maximo_load_returns WHERE load_id=? ORDER BY at", (row["id"],))]
            result.append(item)
    return result

def result_view(workspace, project_id, receive_id, offset=0, limit=100):
    initialize(workspace)
    need(type(offset) is int and offset >= 0 and type(limit) is int and 1 <= limit <= 250, "Select a bounded original result page")
    with workspace.connection() as db:
        row = db.execute("""SELECT r.report FROM maximo_load_returns r JOIN maximo_loads l ON l.id=r.load_id
             WHERE r.id=? AND l.project_id=?""", (receive_id,project_id)).fetchone()
    if not row: raise KeyError(receive_id)
    report = original(row["report"].encode())
    items = [{k:v for k,v in item.items() if k != "original_response"} for item in report["rows"][offset:offset+limit]]
    return {**received_summary(report), "offset":offset, "limit":limit, "total":len(report["rows"]), "rows":items}

def result_document(workspace, project_id, receive_id):
    initialize(workspace)
    with workspace.connection() as db:
        row = db.execute("""SELECT r.body FROM maximo_load_returns r JOIN maximo_loads l ON l.id=r.load_id
             WHERE r.id=? AND l.project_id=?""", (receive_id,project_id)).fetchone()
    if not row: raise KeyError(receive_id)
    return row["body"]

def export(workspace, project_id):
    initialize(workspace)
    output = {}
    with workspace.connection() as db:
        loads = list(db.execute("SELECT * FROM maximo_loads WHERE project_id=?", (project_id,)))
        for row in loads:
            # Paths use stable content-derived IDs, never caller-controlled filenames.
            name = SHA(row["id"].encode())[:24]
            output["maximo-loads/"+name+"/prepared.json"] = row["body"]
            doc = original(row["body"])
            output["maximo-loads/"+name+"/request.json"] = base64.b64decode(doc["body_base64"])
            for returned in db.execute("SELECT * FROM maximo_load_returns WHERE load_id=?", (row["id"],)):
                rid = SHA(returned["id"].encode())[:24]
                output["maximo-loads/"+name+"/"+rid+"-original.json"] = returned["body"]
                output["maximo-loads/"+name+"/"+rid+"-report.json"] = returned["report"].encode()
    return output
