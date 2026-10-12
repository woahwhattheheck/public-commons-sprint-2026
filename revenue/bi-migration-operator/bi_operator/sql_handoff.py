"""Portable BI/SQL delivery with exact history, complete source custody and atomic receiving."""
from __future__ import annotations
import base64
import copy
import json
import re
from .store import Conflict, digest, encoded, identifier, now
from .sql_server import packed, unpacked, record_ref, worker

SCHEMA = "commons-bi-sql-workspace-handoff/1"
KINDS = frozenset(("source", "dataset", "plan", "artifact", "capture", "comparison",
    "rollout", "support", "usage", "server_report", "server_bundle", "server_job", "server_result",
    "sql_profile", "sql_query", "sql_job", "sql_capture", "sql_mapping"))
SHA = re.compile(r"^[0-9a-f]{64}$")
MAX_REVISIONS = 50000

def key(record):
    return record["kind"], record["id"], int(record["revision"])

def ref_values(value):
    if isinstance(value, dict):
        if set(value) == {"kind", "id", "revision"} and value.get("kind") in KINDS and isinstance(value.get("id"), str) and type(value.get("revision")) is int:
            yield value["kind"], value["id"], value["revision"]
        for child in value.values():
            yield from ref_values(child)
    elif isinstance(value, list):
        for child in value:
            yield from ref_values(child)

def hashes(value):
    if isinstance(value, str) and SHA.fullmatch(value):
        yield value
    elif isinstance(value, dict):
        for child in value.values():
            yield from hashes(child)
    elif isinstance(value, list):
        for child in value:
            yield from hashes(child)

def blob_refs(value):
    if isinstance(value, dict):
        if "digest" in value:
            if not isinstance(value["digest"], str) or not SHA.fullmatch(value["digest"]):
                raise ValueError("A source object reference has an invalid digest.")
            yield value
        for child in value.values():
            yield from blob_refs(child)
    elif isinstance(value, list):
        for child in value:
            yield from blob_refs(child)

def build_handoff(engine, request):
    store, service = engine.store, engine.service
    engine.prepare_backup()
    selections = request.get("records")
    if selections is None:
        selections = [record_ref(r) for kind in sorted(KINDS) for r in store.list(kind)]
    if not isinstance(selections, list) or not selections:
        raise ValueError("Select the complete workstream or at least one retained SQL/report record.")
    retained, maximums, queue = {}, {}, []
    for reference in selections:
        if reference.get("kind") not in KINDS:
            raise ValueError("Select domain work, not access settings or prior encrypted backups.")
        record = store.get(reference["kind"], reference["id"], reference.get("revision"))
        queue.append(key(record))
    while queue:
        kind, ident, maximum = queue.pop()
        if maximum <= maximums.get((kind, ident), 0):
            continue
        history = [r for r in store.history(kind, ident) if r["revision"] <= maximum]
        if [r["revision"] for r in sorted(history, key=lambda r:r["revision"])] != list(range(1, maximum + 1)):
            raise ValueError("A selected record is missing its original revision history.")
        maximums[kind, ident] = maximum
        for record in history:
            item_key = key(record)
            if item_key in retained:
                continue
            retained[item_key] = record
            if len(retained) > MAX_REVISIONS:
                raise ValueError("Choose a smaller complete workstream; this handoff exceeds 50,000 revisions.")
            # Immutable provider job documents keep their original source IDs, including
            # when a received local branch has assigned distinct workspace identities.
            payload = {k:v for k,v in record["payload"].items() if k != "document"}
            queue.extend(ref_values(payload))
            if kind == "sql_query" and (record["payload"].get("review") or {}).get("preflight_job"):
                original = store.get("sql_job", record["payload"]["review"]["preflight_job"])
                queue.append(key(original))
    objects = {r["digest"]: dict(r) for r in store.db.execute("SELECT digest,size,name,media_type FROM blobs")}
    selected_objects = set()
    for record in retained.values():
        selected_objects.update(sha for sha in hashes(record["payload"]) if sha in objects)
        for reference in blob_refs(record["payload"]):
            if reference["digest"] not in objects:
                raise ValueError("A referenced original object is absent from the workspace.")
    files = {}
    object_manifest = []
    for sha in sorted(selected_objects):
        body = store.bytes(sha)
        meta = objects[sha]
        if len(body) != meta["size"]:
            raise ValueError("An immutable source object differs from its retained size.")
        files["objects/" + sha] = body
        object_manifest.append({"sha256": sha, "bytes": len(body), "name": meta["name"], "media_type": meta["media_type"]})
    records = [retained[k] for k in sorted(retained)]
    snapshot = {"schema": SCHEMA, "workspace_id": store.setting("workspace_id"), "captured_at": now(),
        "label": str(request.get("label", "SQL Server migration workstream"))[:300],
        "notes": str(request.get("notes", ""))[:50000],
        "records": records, "heads": [{"kind": k, "id": i, "revision": r} for (k,i),r in sorted(maximums.items())],
        "objects": object_manifest,
        "receiving": "Retain exact histories and original native job inputs. Review any conflicting local branch; portable receiving never starts database work."}
    files["snapshot.json"] = encoded(snapshot).encode() + b"\n"
    files["OPEN_FIRST.txt"] = (
        "COMMONS BI / SQL SERVER WORKSTREAM\n\n"
        "Open the Commons BI Operator, choose SQL Server, then Receiving. Preview this complete ZIP and adopt it. "
        "Original source/query/catalog metadata, committed native pages and CSVs, model mappings, comparisons and "
        "selected historical revisions remain together. Exact repeated bundles are replayed. Competing versions "
        "can be retained as a separate complete local branch. No password or workspace access token is transferred.\n\n"
        "Receiving does not issue a database query. Open an original unfinished job and explicitly choose Continue "
        "only after selecting this host as its continuation. A received completed job needs no database access. "
        "Use the prepared job's original worker files on a separately equipped host; import its returned result ZIP. "
        "A SQL collection is one observed native statement per page; it does not assert a shared cross-page snapshot.\n"
    ).encode()
    data = packed(files, SCHEMA)
    # A complete validation happens before it is advertised as a usable receiving package.
    read_handoff(data)
    package = store.blob(data, "SQL-Server-Workstream-" + service.operation_id + ".zip", "application/zip")
    return service.write("sql_delivery", {"label": snapshot["label"], "package": package,
        "original_workspace_id": snapshot["workspace_id"], "records": len(snapshot["heads"]),
        "revisions": len(records), "objects": len(object_manifest), "selected": selections,
        "notes": snapshot["notes"], "captured_at": snapshot["captured_at"]})

def read_handoff(data):
    files = unpacked(data, SCHEMA)
    snapshot = json.loads(files["snapshot.json"].decode("utf-8"))
    if snapshot.get("schema") != SCHEMA or not isinstance(snapshot.get("workspace_id"), str):
        raise ValueError("The complete workspace handoff snapshot is absent.")
    records, heads, objects = snapshot.get("records"), snapshot.get("heads"), snapshot.get("objects")
    if not isinstance(records, list) or not records or len(records) > MAX_REVISIONS:
        raise ValueError("Select a nonempty complete revision collection within its declared limit.")
    if not isinstance(heads, list) or not isinstance(objects, list):
        raise ValueError("The original head/object manifests are absent.")
    seen, histories, head_map = {}, {}, {}
    for record in records:
        if (not isinstance(record, dict) or set(record) != {"kind", "id", "revision", "created", "actor", "payload"}
            or record.get("kind") not in KINDS or type(record.get("revision")) is not int
            or record["revision"] < 1 or not isinstance(record.get("payload"), dict)
            or not isinstance(record.get("created"), str) or not isinstance(record.get("actor"), str)):
            raise ValueError("A receiving revision has an invalid original record shape.")
        identifier(record["id"])
        item = key(record)
        if item in seen or len(encoded(record["payload"]).encode()) > 24 * 1024 * 1024:
            raise ValueError("A receiving revision is repeated or excessive.")
        seen[item] = record
        histories.setdefault(item[:2], []).append(item[2])
    for head in heads:
        if (not isinstance(head, dict) or set(head) != {"kind", "id", "revision"} or key(head) not in seen
            or key(head)[:2] in head_map):
            raise ValueError("The original record head manifest differs.")
        head_map[key(head)[:2]] = head["revision"]
    if set(head_map) != set(histories):
        raise ValueError("A receiving record has no selected head.")
    for ident, revisions in histories.items():
        if sorted(revisions) != list(range(1, head_map[ident] + 1)):
            raise ValueError("Every selected history must retain each original revision through its head.")
    object_map = {}
    for item in objects:
        sha = item.get("sha256")
        if (not isinstance(sha, str) or not SHA.fullmatch(sha) or sha in object_map
            or type(item.get("bytes")) is not int or item["bytes"] < 0
            or not isinstance(item.get("name"), str) or not isinstance(item.get("media_type"), str)):
            raise ValueError("The receiving object metadata is invalid.")
        name = "objects/" + sha
        if name not in files or len(files[name]) != item["bytes"] or digest(files[name]) != sha:
            raise ValueError("An original handoff source object differs.")
        object_map[sha] = item
    if {n for n in files if n.startswith("objects/")} != {"objects/" + sha for sha in object_map}:
        raise ValueError("The complete source object inventory differs.")
    for record in records:
        payload = record["payload"]
        for reference in ref_values({k:v for k,v in payload.items() if k != "document"}):
            if reference not in seen:
                raise ValueError("A retained source/mapping reference lacks its original revision.")
        for reference in blob_refs(payload):
            sha = reference["digest"]
            if sha not in object_map or ("bytes" in reference and reference["bytes"] != object_map[sha]["bytes"]):
                raise ValueError("A record's original file reference differs from receiving custody.")
        if record["kind"] == "sql_job":
            package = unpacked(files["objects/" + payload["package"]["digest"]], "commons-bi-sql-job-files/1")
            if digest(package["job.json"]) != payload["job_sha256"] or json.loads(package["job.json"]) != payload["document"]:
                raise ValueError("A prepared native job differs from its immutable original worker bundle.")
            for field in ("result_bundle", "checkpoint"):
                if payload.get(field):
                    result, job, state, result_files = worker().read_result(files["objects/" + payload[field]["digest"]])
                    if result_files["job.json"] != package["job.json"]:
                        raise ValueError("A native result/checkpoint belongs to another prepared job.")
        elif record["kind"] == "sql_capture":
            result, job, state, result_files = worker().read_result(files["objects/" + payload["bundle"]["digest"]])
            if (result.get("capture", {}).get("sha256") != payload["file"]["digest"]
                or result.get("rows") != payload["rows"] or result.get("complete") != payload["complete"]
                or result.get("column_types") != payload["column_types"]):
                raise ValueError("A received SQL capture differs from its complete native source result.")
        elif record["kind"] == "dataset" and payload.get("sql_capture") and not payload.get("parent"):
            capture = seen[tuple(payload["sql_capture"][k] for k in ("kind", "id", "revision"))]["payload"]
            if not capture["complete"] or payload["file"]["digest"] != capture["file"]["digest"]:
                raise ValueError("A complete SQL dataset differs from its original capture.")
    return snapshot, files

def plan_receiving(store, snapshot):
    rows, groups = [], {}
    for record in snapshot["records"]:
        groups.setdefault(key(record)[:2], []).append(record)
    for head in snapshot["heads"]:
        ident = key(head)[:2]
        incoming = groups[ident]
        current = store.history(*ident)
        current_by_rev = {r["revision"]:r for r in current}
        conflicts = [{"revision":r["revision"], "current_sha256":digest(encoded(current_by_rev[r["revision"]]).encode()),
                      "incoming_sha256":digest(encoded(r).encode())}
                     for r in incoming if r["revision"] in current_by_rev and encoded(current_by_rev[r["revision"]]) != encoded(r)]
        local_head = current[0]["revision"] if current else 0
        rows.append({"kind": ident[0], "id": ident[1], "incoming_revision": head["revision"], "current_revision": local_head,
                     "current_head_sha256": digest(encoded(current[0]).encode()) if current else None,
                     "status": "conflict" if conflicts else "new" if not current else "advance" if head["revision"] > local_head else "retained",
                     "conflicts": conflicts})
    value = {"rows": rows, "conflicts": sum(r["status"] == "conflict" for r in rows),
             "new": sum(r["status"] == "new" for r in rows), "advance": sum(r["status"] == "advance" for r in rows),
             "retained": sum(r["status"] == "retained" for r in rows)}
    value["sha256"] = digest(encoded(value).encode())
    return value

def preview_handoff(engine, request):
    data = base64.b64decode(request["base64"], validate=True)
    snapshot, files = read_handoff(data)
    bundle_hash = digest(data)
    receipt_id = "sqlreceipt-" + bundle_hash[:40]
    try:
        previous = engine.store.get("sql_receipt", receipt_id)
    except KeyError:
        previous = None
    if previous and previous["payload"].get("status") == "accepted":
        return previous
    plan = plan_receiving(engine.store, snapshot)
    package = engine.store.blob(data, "received-SQL-workstream.zip", "application/zip")
    payload = {"label": snapshot.get("label", "Received SQL workstream"), "status": "preview",
               "bundle": package, "bundle_sha256": bundle_hash, "original_workspace_id": snapshot["workspace_id"],
               "plan": plan, "records": len(snapshot["heads"]), "revisions": len(snapshot["records"]),
               "objects": len(snapshot["objects"]), "received_at": now()}
    return engine.service.write("sql_receipt", payload, receipt_id, previous["revision"] if previous else 0)

def branch_ids(snapshot, bundle_hash):
    mapping = {(head["kind"],head["id"]): "received-" + digest((head["kind"] + "\0" + head["id"] + "\0" + bundle_hash).encode())[:40]
               for head in snapshot["heads"]}
    # Preserve each native job's stable derived capture/dataset identities in the
    # received local branch, while leaving its raw provider job ID unchanged.
    for record in snapshot["records"]:
        if record["kind"] != "sql_job":
            continue
        payload, new_job = record["payload"], mapping["sql_job",record["id"]]
        if payload.get("capture_id") and ("sql_capture",payload["capture_id"]) in mapping:
            mapping["sql_capture",payload["capture_id"]] = "sqlcap-" + digest(new_job.encode())[:32]
        if payload.get("dataset_id") and ("dataset",payload["dataset_id"]) in mapping:
            mapping["dataset",payload["dataset_id"]] = "sqldata-" + digest(new_job.encode())[:32]
    return mapping

def rewrite_refs(value, mapping, *, at_root=False):
    if isinstance(value, list):
        return [rewrite_refs(v, mapping) for v in value]
    if not isinstance(value, dict):
        return copy.deepcopy(value)
    result = {}
    for name, child in value.items():
        if at_root and name == "document":
            result[name] = copy.deepcopy(child)
        elif name == "preflight_job" and isinstance(child, str):
            result[name] = mapping.get(("sql_job",child), child)
        elif at_root and name in ("capture_id", "dataset_id") and isinstance(child, str):
            result[name] = mapping.get(("sql_capture" if name == "capture_id" else "dataset", child), child)
        else:
            result[name] = rewrite_refs(child, mapping)
    if set(result) == {"kind", "id", "revision"} and result.get("kind") in KINDS and isinstance(result.get("id"), str) and type(result.get("revision")) is int:
        result["id"] = mapping.get((result["kind"],result["id"]), result["id"])
    return result

def apply_handoff(engine, request):
    store, service = engine.store, engine.service
    receipt = store.get("sql_receipt", request["id"])
    p = receipt["payload"]
    if p["status"] == "accepted":
        return receipt
    if receipt["revision"] != int(request["expected"]):
        raise Conflict("Reload the receiving preview before adoption.")
    snapshot, files = read_handoff(store.bytes(p["bundle"]["digest"]))
    plan = plan_receiving(store, snapshot)
    if plan["sha256"] != p["plan"]["sha256"] or request.get("plan_sha256") != plan["sha256"]:
        raise Conflict("The destination changed after preview. Preview this original bundle again before adopting it.")
    choice = request.get("choice", "preserve")
    if choice not in ("preserve", "keep_both") or plan["conflicts"] and choice != "keep_both":
        raise ValueError("Keep the original local branch and explicitly retain both complete branches for conflicting work.")
    reason = str(request.get("reason", "")).strip()
    if plan["conflicts"] and not reason:
        raise ValueError("Describe why this competing workstream is retained as a separate branch.")
    mapping = branch_ids(snapshot, p["bundle_sha256"]) if plan["conflicts"] else {}
    selected = []
    for original in snapshot["records"]:
        record = copy.deepcopy(original)
        if mapping:
            record["id"] = mapping[original["kind"],original["id"]]
            record["payload"] = rewrite_refs(original["payload"], mapping, at_root=True)
            record["payload"]["_received_original"] = {
                "workspace_id": snapshot["workspace_id"], "kind": original["kind"], "id": original["id"],
                "revision": original["revision"], "record_sha256": digest(encoded(original).encode()),
                "bundle_sha256": p["bundle_sha256"]}
        selected.append(record)
    heads = [{"kind":h["kind"],"id":mapping.get((h["kind"],h["id"]),h["id"]),"revision":h["revision"]} for h in snapshot["heads"]]
    # Full source validation and all competing revisions precede every business write.
    for record in selected:
        existing = next((r for r in store.history(record["kind"],record["id"]) if r["revision"] == record["revision"]), None)
        if existing and encoded(existing) != encoded(record):
            raise Conflict("A receiving target revision already contains other bytes.")
    for item in snapshot["objects"]:
        store.blob(files["objects/" + item["sha256"]], item["name"], item["media_type"])
    received_ids = [h["id"] for h in heads if h["kind"] == "sql_job"]
    adoption = {**p, "status": "accepted", "accepted_at": now(), "reviewer": service.actor,
                "choice": "keep_both" if mapping else "preserve", "reason": reason,
                "adopted_heads": heads, "id_mapping": [
                    {"kind":k, "original_id":i, "local_id":n} for (k,i),n in sorted(mapping.items())],
                "_operation_id": service.operation_id}
    with store.lock, store.db:
        store.db.execute("BEGIN IMMEDIATE")
        if store.get("sql_receipt", receipt["id"])["revision"] != receipt["revision"] or plan_receiving(store, snapshot)["sha256"] != plan["sha256"]:
            raise Conflict("The receiving workspace changed before the atomic adoption.")
        for record in selected:
            old = store.db.execute("SELECT * FROM revisions WHERE kind=? AND id=? AND revision=?", key(record)).fetchone()
            if old:
                if encoded(store._record(old)) != encoded(record):
                    raise Conflict("An original revision changed during receiving.")
                continue
            store.db.execute("INSERT INTO revisions VALUES(?,?,?,?,?,?)",
                (record["kind"],record["id"],record["revision"],encoded(record["payload"]),record["created"],record["actor"]))
        for head in heads:
            store.db.execute("INSERT INTO heads VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET revision=MAX(heads.revision,excluded.revision)",
                             (head["kind"],head["id"],head["revision"]))
        detached = json.loads(store.setting("sql_detached_jobs") or "[]")
        store.db.execute("INSERT OR REPLACE INTO settings VALUES('sql_detached_jobs',?)",
                         (encoded(sorted(set(detached + received_ids))),))
        store.db.execute("INSERT INTO revisions VALUES(?,?,?,?,?,?)",
            ("sql_receipt",receipt["id"],receipt["revision"]+1,encoded(adoption),now(),service.actor))
        store.db.execute("UPDATE heads SET revision=? WHERE kind='sql_receipt' AND id=?", (receipt["revision"]+1,receipt["id"]))
        store.event("sql_workstream_received", receipt["id"], {"bundle_sha256":p["bundle_sha256"],
            "records":len(heads),"revisions":len(selected),"choice":adoption["choice"],"native_started":False})
    return store.get("sql_receipt", receipt["id"])
