"""Property continuity in the original SQLite Store and operation journal.

This module retains original cross-platform exports and decisions. It performs no
vendor request, financial posting, geometry update or inferred customer approval.
"""
from __future__ import annotations
import csv
import io
import json
from financial_domain import unique_pairs
from collections import Counter
from migration_store import MigrationError, canonical, identity, parse_json, text, digest, page
from financial_workspace import file_refs as _file_refs
from contextvars import ContextVar
from functools import wraps
import property_domain as domain

KINDS = tuple("property." + name for name in
              ("contract", "dataset", "edition", "reconciliation", "review", "control", "release"))
MUTATIONS = tuple(kind + ".create" for kind in KINDS)
READS = ("property.schema", "property.preview", "property.list", "property.get",
         "property.rows", "property.verify", "property.request_status")
CATEGORIES = ("baseline", "mapping", "access", "cutover", "recovery", "receiving")
MAX_SOURCE_BYTES = 64 * 1024 * 1024
DDL = """CREATE TABLE IF NOT EXISTS property_rows(
 dataset_id TEXT NOT NULL,ordinal INTEGER NOT NULL,body_json TEXT NOT NULL,
 PRIMARY KEY(dataset_id,ordinal));
CREATE TABLE IF NOT EXISTS property_items(
 owner_id TEXT NOT NULL,kind TEXT NOT NULL,ordinal INTEGER NOT NULL,status TEXT,body_json TEXT NOT NULL,
 PRIMARY KEY(owner_id,kind,ordinal));
CREATE INDEX IF NOT EXISTS property_items_status ON property_items(owner_id,kind,status,ordinal);"""

_EVIDENCE_CACHE = ContextVar("property_evidence_cache", default=None)

def with_evidence_cache(fn):
    @wraps(fn)
    def run(store, *args, **kwargs):
        current = _EVIDENCE_CACHE.get()
        if current is not None and current[0] is store:
            return fn(store, *args, **kwargs)
        token = _EVIDENCE_CACHE.set((store, {}))
        try: return fn(store, *args, **kwargs)
        finally: _EVIDENCE_CACHE.reset(token)
    return run

def file_refs(store, refs, *, required=False):
    # Hash each distinct immutable object once in this original operation/read.
    # Every descriptor is still independently validated and preserved verbatim.
    domain.require(isinstance(refs, list) and (refs or not required), "PROPERTY_FILES",
                   "Select complete original evidence file identities.")
    current = _EVIDENCE_CACHE.get()
    if current is None or current[0] is not store:
        return _file_refs(store, refs, required=required)
    cache, result = current[1], []
    for ref in refs:
        domain.obj(ref, ("sha256", "filename"), ("purpose", "bytes"))
        sha = digest(ref["sha256"]); text(ref["filename"], "filename", max_length=240)
        request = {k:v for k,v in ref.items() if k != "bytes"}
        if sha not in cache: cache[sha] = _file_refs(store, [request], required=True)[0]["bytes"]
        domain.require("bytes" not in ref or ref["bytes"] == cache[sha],
                       "PROPERTY_FILE_LENGTH", "Retained evidence descriptor length differs.")
        result.append({**request, "bytes":cache[sha]})
    return result

def ensure(store):
    store.conn.executescript(DDL)

def schema():
    return {"schema": domain.SCHEMA, "kinds": list(KINDS), "mutations": list(MUTATIONS),
            "reads": list(READS), "formats": ["csv", "json-table"], "control_categories": list(CATEGORIES),
            "maximum_source_bytes": MAX_SOURCE_BYTES,
            "review_dispositions": ["open", "accepted_variance", "resolved"],
            "meaning": "Retained originals and independently acquired returns; no platform writes or automatic acceptance."}

def request_body(op, fields):
    p = op["request"]
    domain.require(not set(p) - set(fields) - {"operation_id", "actor", "expected_revision"},
                   "PROPERTY_REQUEST", "Unknown property request fields.", fields=list(p))
    return p

def base(op, kind, title):
    return {"schema": domain.SCHEMA,
            "id": kind.replace(".", "-") + "-" + identity({"op": op["id"], "sha": op["request_sha256"]})[:40],
            "kind": kind, "title": text(title, "title"), "operation_id": op["id"],
            "created_at": op["created_at"], "created_revision": op["reserved_revision"], "actor": op["actor"]}

def get(store, kind, entity_id):
    domain.require(kind in KINDS, "PROPERTY_KIND", "Select a retained property record kind.")
    return store.get_entity(kind, entity_id)

def records(store, kind, before=None):
    sql, args = "SELECT body_json FROM entities WHERE kind=?", [kind]
    if before is not None:
        sql += " AND created_revision<?"; args.append(before)
    for row in store.conn.execute(sql + " ORDER BY created_revision,id", args):
        yield parse_json(row[0])

def previous(store, kind, parent_id, context, *, unique_scope=False, before=None):
    values = list(records(store, kind, before))
    matching = [x for x in values if all(x.get(k) == v for k,v in context.items())]
    if parent_id is None:
        domain.require(not unique_scope or not matching, "PROPERTY_PARENT_REQUIRED",
                       "Select the current original head rather than creating a second decision chain.")
        return None
    old = get(store, kind, parent_id)
    domain.require(all(old.get(k) == v for k,v in context.items()), "PROPERTY_PARENT_SCOPE",
                   "The previous edition belongs to another selected original scope.")
    domain.require(before is None or old["created_revision"] < before, "PROPERTY_PARENT_TIME",
                   "The selected parent did not exist at this original operation.")
    domain.require(not any(x.get("parent_id") == parent_id for x in values),
                   "PROPERTY_HEAD", "Select the current original head; a later edition already exists.")
    return old

def require_head(store, kind, entity_id, before=None):
    domain.require(not any(x.get("parent_id") == entity_id for x in records(store, kind, before)),
                   "PROPERTY_SUPERSEDED", "A later original decision supersedes this selected head.", id=entity_id)

def descends(store, kind, candidate, original):
    seen = set()
    while candidate:
        if candidate == original: return True
        domain.require(candidate not in seen, "PROPERTY_ANCESTRY", "Original edition ancestry contains a cycle.")
        seen.add(candidate)
        candidate = get(store, kind, candidate).get("parent_id")
    return False

def iter_rows(store, dataset_id):
    for row in store.conn.execute("SELECT body_json FROM property_rows WHERE dataset_id=? ORDER BY ordinal", (dataset_id,)):
        yield parse_json(row[0])

def iter_items(store, owner_id, section):
    for row in store.conn.execute("SELECT body_json FROM property_items WHERE owner_id=? AND kind=? ORDER BY ordinal",
                                  (owner_id, section)):
        yield parse_json(row[0])

def record(store, op, kind, title, value, children=None):
    body = {**base(op, kind, title), **value}
    with store.transaction():
        for section, rows in (children or {}).items():
            for index, row in enumerate(rows):
                store.conn.execute("INSERT OR IGNORE INTO property_items VALUES(?,?,?,?,?)",
                                   (body["id"], section, index, row.get("status"), canonical(row)))
            domain.require(list(iter_items(store, body["id"], section)) == rows,
                           "PROPERTY_RESULT_CONFLICT", "Original complete result differs on continuation.")
        return store.put_entity(kind, body["id"], body, op["reserved_revision"])

def contract_create(store, op):
    p = request_body(op, ("title", "contract", "parent_id"))
    value = domain.validate_contract(p.get("contract"))
    parent_id = p.get("parent_id", value.get("parent_id"))
    domain.require(not value.get("parent_id") or value["parent_id"] == parent_id,
                   "PROPERTY_CONTRACT_PARENT", "Keep one exact reviewed parent contract.")
    previous(store, "property.contract", parent_id, {"scope_id": value["scope_id"]},
             unique_scope=True, before=op["reserved_revision"])
    evidence = file_refs(store, value["review"]["evidence_files"], required=True)
    if parent_id:
        text(value.get("change_reference"), "actual reviewed contract change reference")
    return record(store, op, "property.contract", p.get("title", value["title"]),
                  {"contract": value, "contract_sha256": identity(value), "scope_id": value["scope_id"],
                   "parent_id": parent_id, "evidence_files": evidence})

def original_source(store, p, contract=None, family=None):
    info = store.file_info(digest(p.get("file_sha256")))
    domain.require(info["bytes"] <= MAX_SOURCE_BYTES, "PROPERTY_SOURCE_SIZE",
                   "The complete original exceeds the explicit parser bound.")
    with store.open_file(info["sha256"]) as held:
        raw = held.read(MAX_SOURCE_BYTES + 1)
    mapping = p.get("mapping")
    columns = list(dict.fromkeys(x for x in mapping.values() if isinstance(x, str) and x)) if isinstance(mapping, dict) else None
    names, rows = domain.original_rows(raw, p.get("format"), p.get("dialect", {}), columns)
    return info, names, rows

def source_preview(store, p):
    contract = get(store, "property.contract", p.get("contract_id"))
    family = domain.family_for(contract["contract"], p.get("family"))
    info, columns, rows = original_source(store, p, contract, family)
    sample = [{"raw": row, "raw_types": {k:domain.original_kind(v) for k,v in row.items()}} for row in rows[:5]]
    return {"sha256": info["sha256"], "bytes": info["bytes"], "columns": columns, "row_count": len(rows),
            "sample": sample, "preview_only": True, "contract_id": contract["id"], "family": family["id"]}

def dataset_create(store, op):
    p = request_body(op, ("title", "contract_id", "family", "file_sha256", "filename", "format", "dialect",
                          "mapping", "context", "parent_id"))
    contract = get(store, "property.contract", p.get("contract_id"))
    family = domain.family_for(contract["contract"], p.get("family"))
    context = domain.validate_context(p.get("context"), contract["contract"], family)
    evidence = file_refs(store, context["review"]["evidence_files"], required=True)
    info, columns, original = original_source(store, p, contract, family)
    mapping = domain.validate_mapping(p.get("mapping"), columns, family)
    rows = domain.normalize(original, mapping, family)
    old = previous(store, "property.dataset", p.get("parent_id"),
                   {"contract_id": contract["id"], "family": family["id"], "role": context["role"]},
                   before=op["reserved_revision"])
    value = {"contract_id": contract["id"], "contract_sha256": contract["contract_sha256"],
             "scope_id": contract["scope_id"], "family": family["id"], "role": context["role"],
             "file_sha256": info["sha256"], "bytes": info["bytes"],
             "filename": text(p.get("filename"), "filename", max_length=240), "format": p["format"],
             "dialect": p.get("dialect", {}), "columns": columns, "mapping": mapping, "context": context,
             "row_count": len(rows), "issue_count": sum(bool(r["issues"]) for r in rows),
             "normalized_sha256": identity(rows), "parent_id": old["id"] if old else None, "evidence_files": evidence}
    value["input_sha256"] = identity({k:value[k] for k in
        ("contract_id", "family", "role", "file_sha256", "format", "dialect", "mapping", "context")})
    body = {**base(op, "property.dataset", p.get("title")), **value}
    with store.transaction():
        for row in rows:
            store.conn.execute("INSERT OR IGNORE INTO property_rows VALUES(?,?,?)",
                               (body["id"], row["ordinal"], canonical(row)))
        domain.require(list(iter_rows(store, body["id"])) == rows, "PROPERTY_ROW_CONFLICT",
                       "Original complete normalized source changed on continuation.")
        return store.put_entity("property.dataset", body["id"], body, op["reserved_revision"])

def edition_create(store, op):
    p = request_body(op, ("title", "contract_id", "role", "cutoff", "dataset_ids", "note", "parent_id"))
    contract = get(store, "property.contract", p.get("contract_id"))
    domain.require(p.get("role") in ("source", "target"), "PROPERTY_EDITION_ROLE", "Select source or target.")
    cutoff = domain.time_value(p.get("cutoff"), contract["contract"]["lease_rule"]["time_kind"])
    ids = domain.names(p.get("dataset_ids"), "retained datasets")
    families = {f["id"] for f in contract["contract"]["families"]}
    selected = {}
    for entity_id in ids:
        dataset = get(store, "property.dataset", entity_id)
        domain.require(dataset["contract_id"] == contract["id"] and dataset["role"] == p["role"],
                       "PROPERTY_EDITION_SCOPE", "Select datasets from this exact contract and side.")
        domain.require(dataset["family"] not in selected, "PROPERTY_EDITION_DUPLICATE", "Select each family once.")
        domain.require(domain.time_value(dataset["context"]["cutoff"], contract["contract"]["lease_rule"]["time_kind"]) == cutoff,
                       "PROPERTY_EDITION_CUTOFF", "Every family shares the exact reviewed effective cutoff.")
        selected[dataset["family"]] = dataset
    domain.require(set(selected) == families, "PROPERTY_EDITION_POPULATION",
                   "Retain every contracted family, including genuine empty populations.",
                   missing=sorted(families-set(selected)), extra=sorted(set(selected)-families))
    old = previous(store, "property.edition", p.get("parent_id"),
                   {"contract_id": contract["id"], "role": p["role"]}, before=op["reserved_revision"])
    if old:
        for family, dataset in selected.items():
            domain.require(descends(store, "property.dataset", dataset["id"], old["families"][family]),
                           "PROPERTY_EDITION_ANCESTRY", "A later edition retains each original dataset or its explicit descendant.")
    return record(store, op, "property.edition", p.get("title"),
                  {"contract_id": contract["id"], "contract_sha256": contract["contract_sha256"],
                   "scope_id": contract["scope_id"], "role": p["role"], "cutoff": p["cutoff"],
                   "dataset_ids": ids, "families": {family:selected[family]["id"] for family in sorted(selected)},
                   "input_sha256": identity({family:selected[family]["input_sha256"] for family in sorted(selected)}),
                   "parent_id": old["id"] if old else None, "note": p.get("note", "")})

def edition_value(store, edition):
    return {family: {"dataset": get(store, "property.dataset", entity_id), "rows": list(iter_rows(store, entity_id))}
            for family, entity_id in edition["families"].items()}

def assessment_value(store, source, target):
    domain.require(source["role"] == "source" and target["role"] == "target" and source["contract_id"] == target["contract_id"],
                   "PROPERTY_RECONCILIATION_SCOPE", "Compare complete original source and target editions under one exact contract.")
    contract = get(store, "property.contract", source["contract_id"])
    return domain.assess(contract["contract"], edition_value(store, source), edition_value(store, target), source["cutoff"])

def assessment_full(store, entity_id):
    saved = get(store, "property.reconciliation", entity_id)
    return {**saved["assessment"], "items": list(iter_items(store, entity_id, "items")),
            "checks": list(iter_items(store, entity_id, "checks"))}

def reconciliation_create(store, op):
    p = request_body(op, ("title", "source_edition_id", "target_edition_id", "note"))
    source = get(store, "property.edition", p.get("source_edition_id"))
    target = get(store, "property.edition", p.get("target_edition_id"))
    value = assessment_value(store, source, target)
    return record(store, op, "property.reconciliation", p.get("title"),
                  {"contract_id": source["contract_id"], "contract_sha256": source["contract_sha256"],
                   "scope_id": source["scope_id"], "cutoff": source["cutoff"],
                   "source_edition_id": source["id"], "target_edition_id": target["id"],
                   "assessment": {k:v for k,v in value.items() if k not in ("items", "checks")},
                   "assessment_sha256": identity(value), "note": p.get("note", "")},
                  {k:value[k] for k in ("items", "checks")})

def correction_for(store, original, correction_id):
    corrected = get(store, "property.reconciliation", correction_id)
    domain.require(corrected["contract_id"] == original["contract_id"] and
                   corrected["contract_sha256"] == original["contract_sha256"],
                   "PROPERTY_CORRECTION_CONTRACT", "Resolve under the same exact reviewed contract.")
    contract = get(store, "property.contract", original["contract_id"])["contract"]
    domain.require(domain.time_value(corrected["cutoff"], contract["lease_rule"]["time_kind"]) ==
                   domain.time_value(original["cutoff"], contract["lease_rule"]["time_kind"]),
                   "PROPERTY_CORRECTION_CUTOFF", "Correction must preserve the original effective cutoff.")
    for field in ("source_edition_id", "target_edition_id"):
        domain.require(descends(store, "property.edition", corrected[field], original[field]),
                       "PROPERTY_CORRECTION_ANCESTRY", "Corrected evidence must descend from the original source and target selections.")
    domain.require(corrected["assessment"]["complete"] and corrected["assessment"]["ready"],
                   "PROPERTY_CORRECTION_RESULT", "One complete corrected result must match every item and pass every check.")
    return corrected

def review_create(store, op):
    p = request_body(op, ("title", "reconciliation_id", "parent_id", "decisions", "reviewer_role", "note", "evidence_files", "decisions_file"))
    rec = get(store, "property.reconciliation", p.get("reconciliation_id"))
    previous(store, "property.review", p.get("parent_id"), {"reconciliation_id": rec["id"]},
             unique_scope=True, before=op["reserved_revision"])
    text(p.get("reviewer_role"), "actual reviewer role"); text(p.get("note"), "review note")
    evidence = file_refs(store, p.get("evidence_files"), required=True)
    original = {}
    for subject, section, success in (("item", "items", "MATCH"), ("check", "checks", "PASS")):
        for item in iter_items(store, rec["id"], section):
            if item["status"] != success: original[(subject, item["id"])] = item
    domain.require(("decisions" in p) != ("decisions_file" in p), "PROPERTY_DECISION_INPUT",
                   "Select either the complete decision array or one retained complete JSON decision file.")
    decision_file = None
    if "decisions_file" in p:
        domain.obj(p["decisions_file"], ("sha256", "filename"))
        decision_file = file_refs(store, [p["decisions_file"]], required=True)[0]
        domain.require(decision_file["bytes"] <= MAX_SOURCE_BYTES, "PROPERTY_DECISION_SIZE",
                       "Complete decision file exceeds the explicit 64 MiB bound.")
        with store.open_file(decision_file["sha256"]) as stream:
            try:
                decisions = json.loads(stream.read(MAX_SOURCE_BYTES + 1).decode("utf-8-sig"),
                                       object_pairs_hook=unique_pairs,
                                       parse_constant=lambda x: (_ for _ in ()).throw(ValueError(x)))
            except (ValueError, UnicodeError) as exc:
                raise MigrationError("PROPERTY_DECISION_JSON", "Retain one complete JSON decision array with unique object keys.") from exc
    else:
        decisions = p.get("decisions")
    domain.require(isinstance(decisions, list), "PROPERTY_DECISIONS", "Review every nonmatching item and failed/unknown check.")
    seen, checked, corrections = set(), [], set()
    corrected_result, corrected_items = None, None
    for decision in decisions:
        domain.obj(decision, ("subject", "id", "status", "owner", "note", "evidence_files"), ("correction_reconciliation_id",))
        key = (decision["subject"], decision["id"])
        domain.require(key in original and key not in seen, "PROPERTY_DECISION_POPULATION",
                       "Decide each original unresolved item/check exactly once.")
        seen.add(key)
        text(decision["owner"], "actual issue owner"); text(decision["note"], "decision note")
        status = decision["status"]
        domain.require(status in ("open", "accepted_variance", "resolved"), "PROPERTY_DISPOSITION", "Choose an explicit disposition.")
        refs = file_refs(store, decision["evidence_files"], required=status != "open")
        if status == "accepted_variance":
            domain.require(key[0] == "item" and original[key]["status"] == "DIFFERENT",
                           "PROPERTY_NONWAIVABLE", "Only a factual DIFFERENT item can have an evidenced accepted variance; unknown/absence/structural checks need corrected originals.")
        if status == "resolved":
            correction_id = decision.get("correction_reconciliation_id")
            if corrected_result is None:
                corrected_result = correction_for(store, rec, correction_id)
                corrected_items = {x["id"]:x for x in iter_items(store, corrected_result["id"], "items")}
            domain.require(correction_id == corrected_result["id"], "PROPERTY_MIXED_CORRECTIONS",
                           "All resolved decisions must use one coherent complete corrected result.")
            corrected = corrected_result
            corrections.add(corrected["id"])
            if key[0] == "item":
                match = corrected_items.get(key[1])
                domain.require(match is not None and match["status"] == "MATCH", "PROPERTY_CORRECTED_ITEM",
                               "The same original key must actually match in the full corrected result.")
        else:
            domain.require(not decision.get("correction_reconciliation_id"), "PROPERTY_CORRECTION_DISPOSITION",
                           "A correction reference belongs only to an explicit resolved decision.")
        checked.append({**decision, "evidence_files": refs})
    domain.require(seen == set(original), "PROPERTY_REVIEW_POPULATION", "Review the entire unresolved population.",
                   missing=[list(k) for k in sorted(set(original)-seen)])
    domain.require(len(corrections) <= 1, "PROPERTY_MIXED_CORRECTIONS",
                   "Resolve against one coherent complete target edition, not successful fragments from different returns.")
    effective = corrected_result if corrections else rec
    no_open = all(x["status"] != "open" for x in checked)
    if corrections:
        ready = no_open and effective["assessment"]["ready"]
    else:
        ready = no_open and rec["assessment"]["complete"] and all(x["status"] == "PASS" for x in iter_items(store, rec["id"], "checks"))
    return record(store, op, "property.review", p.get("title"),
                  {"contract_id": rec["contract_id"], "scope_id": rec["scope_id"], "reconciliation_id": rec["id"],
                   "effective_reconciliation_id": effective["id"], "parent_id": p.get("parent_id"),
                   "decision_count": len(checked), "decision_statuses": dict(Counter(x["status"] for x in checked)),
                   "decisions_sha256": identity(checked), "decisions_file": decision_file,
                   "reviewer_role": p["reviewer_role"], "note": p["note"],
                   "evidence_files": evidence, "ready": bool(ready)}, {"decisions": checked})

def control_create(store, op):
    p = request_body(op, ("title", "contract_id", "category", "status", "owner", "note", "external_reference",
                          "parent_id", "related_ids", "evidence_files", "authority"))
    contract = get(store, "property.contract", p.get("contract_id"))
    domain.require(p.get("category") in CATEGORIES, "PROPERTY_CONTROL_CATEGORY", "Select an advertised control category.")
    domain.require(p.get("status") in ("proposed", "approved", "executed", "rejected", "withdrawn"),
                   "PROPERTY_CONTROL_STATUS", "Retain the actual external status.")
    for name in ("owner", "note", "external_reference"): text(p.get(name), name)
    related = domain.names(p.get("related_ids"), "affected original property records")
    for entity_id in related:
        row = store.conn.execute("SELECT kind,body_json FROM entities WHERE id=?", (entity_id,)).fetchone()
        domain.require(row is not None and row["kind"] in KINDS, "PROPERTY_CONTROL_SCOPE", "Bind retained property records.")
        saved = parse_json(row["body_json"])
        domain.require((saved["id"] if saved["kind"] == "property.contract" else saved["contract_id"]) == contract["id"],
                       "PROPERTY_CONTROL_CONTRACT", "Bind this exact original contract.")
    old = previous(store, "property.control", p.get("parent_id"),
                   {"contract_id": contract["id"], "category": p["category"]}, before=op["reserved_revision"])
    evidence = file_refs(store, p.get("evidence_files"), required=p["status"] != "proposed")
    authority = p.get("authority")
    if p["status"] != "proposed":
        domain.obj(authority, ("actor", "role", "decision_reference"))
        for name, value in authority.items(): text(value, name)
    if p["status"] == "executed":
        domain.require(old is not None and old["status"] == "approved", "PROPERTY_CONTROL_APPROVAL",
                       "Execution follows its retained approval.")
        domain.require(set(related) == set(old["related_ids"]), "PROPERTY_CONTROL_APPROVED_SCOPE",
                       "Execution must preserve the complete approved scope; changed scope requires a separate approval.")
    return record(store, op, "property.control", p.get("title"),
                  {"contract_id": contract["id"], "scope_id": contract["scope_id"],
                   **{k:p.get(k) for k in ("category", "status", "owner", "note", "external_reference",
                                          "parent_id", "related_ids", "authority")}, "evidence_files": evidence})

def capture_identity(store, edition_id):
    edition = get(store, "property.edition", edition_id)
    # Identical business values can be a genuine later capture. Names and local
    # operation IDs cannot turn a copied extraction into a second rehearsal.
    selected = {}
    for family, entity_id in edition["families"].items():
        context = get(store, "property.dataset", entity_id)["context"]
        selected[family] = {"extraction_reference": context["extraction_reference"],
                            "captured_at": domain.instant(context["captured_at"]),
                            "authority": context["authority"], "system": context["system"]}
    return selected

def release_create(store, op):
    p = request_body(op, ("title", "contract_id", "review_ids", "control_ids", "acceptance",
                          "inventory_files", "note", "parent_id"))
    contract = get(store, "property.contract", p.get("contract_id"))
    require_head(store, "property.contract", contract["id"], op["reserved_revision"])
    text(p.get("note"), "release note")
    inventory = file_refs(store, p.get("inventory_files"), required=True)
    review_ids = domain.names(p.get("review_ids"), "controlling rehearsal reviews")
    domain.require(len(review_ids) >= 2, "PROPERTY_REHEARSALS", "Select at least two complete independent rehearsals.")
    selected, effective_ids, capture_pairs = [], set(), set()
    captures = []
    for review_id in review_ids:
        review = get(store, "property.review", review_id)
        require_head(store, "property.review", review_id, op["reserved_revision"])
        rec = get(store, "property.reconciliation", review["effective_reconciliation_id"])
        domain.require(review["ready"] and rec["assessment"]["complete"] and rec["contract_id"] == contract["id"],
                       "PROPERTY_RELEASE_REVIEW", "Select ready current reviews of this exact contract.")
        domain.require(rec["id"] not in effective_ids, "PROPERTY_REHEARSAL_DUPLICATE", "A corrected result cannot count twice.")
        effective_ids.add(rec["id"])
        pair = (identity(capture_identity(store, rec["source_edition_id"])),
                identity(capture_identity(store, rec["target_edition_id"])))
        domain.require(pair not in capture_pairs, "PROPERTY_REHEARSAL_CAPTURE", "Retain distinct actual source/return captures.")
        capture_pairs.add(pair)
        captures.append({"source": capture_identity(store, rec["source_edition_id"]),
                         "target": capture_identity(store, rec["target_edition_id"])})
        selected.append({"review_id": review_id, "reconciliation_id": rec["id"],
                         "source_edition_id": rec["source_edition_id"], "target_edition_id": rec["target_edition_id"],
                         "cutoff": rec["cutoff"]})
    for side in ("source", "target"):
        for family in captures[0][side]:
            extraction_refs = [c[side][family]["extraction_reference"] for c in captures]
            times = [c[side][family]["captured_at"] for c in captures]
            domain.require(len(set(extraction_refs)) == len(captures) and len(set(times)) == len(captures),
                           "PROPERTY_REHEARSAL_CAPTURE",
                           "Every family needs a distinct actual extraction and capture time in each source and target rehearsal.",
                           side=side, family=family)
    controls = [get(store, "property.control", x) for x in domain.names(p.get("control_ids"), "executed control records")]
    scope = {x[k] for x in selected for k in ("review_id", "reconciliation_id", "source_edition_id", "target_edition_id")}
    for control in controls:
        require_head(store, "property.control", control["id"], op["reserved_revision"])
        domain.require(control["contract_id"] == contract["id"] and control["status"] == "executed" and
                       bool(set(control["related_ids"]) & scope), "PROPERTY_RELEASE_CONTROL",
                       "Each executed control must bind the actual reviewed release scope.")
    domain.require(set(CATEGORIES) <= {x["category"] for x in controls}, "PROPERTY_RELEASE_EVIDENCE",
                   "Retain actual baseline, mapping, access, cutover, recovery and independent receiving controls.")
    acceptance = domain.obj(p.get("acceptance"), ("actor", "role", "reference", "evidence_files"))
    for k in ("actor", "role", "reference"): text(acceptance[k], k)
    files = file_refs(store, acceptance["evidence_files"], required=True)
    previous(store, "property.release", p.get("parent_id"), {"contract_id": contract["id"]},
             unique_scope=True, before=op["reserved_revision"])
    return record(store, op, "property.release", p.get("title"),
                  {"contract_id": contract["id"], "contract_sha256": contract["contract_sha256"],
                   "scope_id": contract["scope_id"], "selections": selected, "captures": captures,
                   "control_ids": p["control_ids"], "acceptance": acceptance, "acceptance_files": files,
                   "inventory_files": inventory, "note": p["note"], "parent_id": p.get("parent_id"),
                   "meaning": "Recorded scope-bound external evidence. No vendor writes, invoice posting or inferred customer acceptance."})

HANDLERS = {"property.contract.create": contract_create, "property.dataset.create": dataset_create,
            "property.edition.create": edition_create, "property.reconciliation.create": reconciliation_create,
            "property.review.create": review_create, "property.control.create": control_create,
            "property.release.create": release_create}

@with_evidence_cache
def invoke(store, op):
    kind = op["operation"].removesuffix(".create")
    entity_id = kind.replace(".", "-") + "-" + identity({"op": op["id"], "sha": op["request_sha256"]})[:40]
    existing = store.get_entity(kind, entity_id, required=False)
    if existing is not None:
        return existing
    # Original reservation precedes this transaction. Each result and all its
    # normalized rows become visible together or remain absent on interruption.
    with store.transaction():
        return HANDLERS[op["operation"]](store, op)

@with_evidence_cache
def verify(store, entity_id=None):
    checked = []
    for kind in KINDS:
        for value in records(store, kind):
            op = store._operation(value["operation_id"])
            domain.require(op["operation"] == kind + ".create" and value["id"] ==
                           base(op, kind, value["title"])["id"], "PROPERTY_VERIFY_OPERATION",
                           "Record is not bound to its original admitted operation.")
            domain.require(op["status"] == "SUCCEEDED" and op["result"]["result"] == value,
                           "PROPERTY_VERIFY_COMPLETION", "Original operation result and retained record differ.")
            if kind == "property.contract":
                domain.validate_contract(value["contract"])
                domain.require(identity(value["contract"]) == value["contract_sha256"], "PROPERTY_VERIFY_CONTRACT", "Contract bytes changed.")
            elif kind == "property.dataset":
                contract = get(store, "property.contract", value["contract_id"])
                family = domain.family_for(contract["contract"], value["family"])
                domain.validate_context(value["context"], contract["contract"], family)
                _, columns, original = original_source(store, value, contract, family)
                rows = domain.normalize(original, domain.validate_mapping(value["mapping"], columns, family), family)
                domain.require(rows == list(iter_rows(store, value["id"])) and identity(rows) == value["normalized_sha256"] and
                               len(rows) == value["row_count"], "PROPERTY_VERIFY_SOURCE", "Complete source normalization differs.")
            elif kind == "property.edition":
                contract = get(store, "property.contract", value["contract_id"])
                actual = edition_value(store, value)
                domain.require(set(actual) == {f["id"] for f in contract["contract"]["families"]} and
                               set(value["dataset_ids"]) == {m["dataset"]["id"] for m in actual.values()},
                               "PROPERTY_VERIFY_EDITION", "Original family inventory differs.")
                domain.require(value["input_sha256"] == identity({f:actual[f]["dataset"]["input_sha256"] for f in sorted(actual)}),
                               "PROPERTY_VERIFY_EDITION", "Original family inputs differ.")
            elif kind == "property.reconciliation":
                actual = assessment_value(store, get(store,"property.edition",value["source_edition_id"]),
                                          get(store,"property.edition",value["target_edition_id"]))
                domain.require(identity(actual) == value["assessment_sha256"] and actual == assessment_full(store, value["id"]),
                               "PROPERTY_VERIFY_ASSESSMENT", "Full source/return comparison differs.")
            for name in ("evidence_files", "inventory_files", "acceptance_files"):
                if name in value: file_refs(store, value[name])
            if kind == "property.review":
                decisions = list(iter_items(store, value["id"], "decisions"))
                domain.require(identity(decisions) == value["decisions_sha256"] and len(decisions) == value["decision_count"] and
                               dict(Counter(x["status"] for x in decisions)) == value["decision_statuses"],
                               "PROPERTY_VERIFY_DECISIONS", "Complete retained decisions differ.")
                for decision in decisions: file_refs(store, decision["evidence_files"])
                if value.get("decisions_file"): file_refs(store, [value["decisions_file"]])
            checked.append({"id":value["id"], "kind":kind})
    if entity_id:
        domain.require(any(x["id"] == entity_id for x in checked), "PROPERTY_VERIFY_ID", "Selected original record is absent.")
    return {"schema":"commons.property-verification/v1", "workspace_id":store.project["id"], "revision":store.project["revision"],
            "records":checked, "count":len(checked), "provider_calls":0,
            "meaning":"Recomputed original normalization and full assessments, operation/result bindings and evidence bytes; external decisions remain retained originals."}

# These are the explicit local input/selection errors in the maintained handlers.
# Unknown infrastructure errors and committed results always retain original recovery.
DRAFT_VALIDATION_CODES = frozenset(["ENTITY_NOT_FOUND","FILE_NOT_FOUND","FINANCE_COLUMN","FINANCE_COLUMNS","FINANCE_DELIMITER","FINANCE_DIALECT","FINANCE_DUPLICATE_KEY","FINANCE_ENCODING","FINANCE_FIELDS","FINANCE_FORMAT","FINANCE_HEADER","FINANCE_JSON","FINANCE_NESTING","FINANCE_OBJECT","FINANCE_ROW_LIMIT","FINANCE_ROW_WIDTH","INVALID_FIELD","INVALID_FILENAME","INVALID_ID","INVALID_INTEGER","INVALID_SHA256","PROPERTY_AUTHORITY","PROPERTY_BOOLEAN","PROPERTY_CARDINALITY","PROPERTY_CONTEXT","PROPERTY_CONTRACT_PARENT","PROPERTY_CONTROL_APPROVAL","PROPERTY_CONTROL_APPROVED_SCOPE","PROPERTY_CONTROL_CATEGORY","PROPERTY_CONTROL_CONTRACT","PROPERTY_CONTROL_SCOPE","PROPERTY_CONTROL_STATUS","PROPERTY_CORRECTED_ITEM","PROPERTY_CORRECTION_ANCESTRY","PROPERTY_CORRECTION_CONTRACT","PROPERTY_CORRECTION_CUTOFF","PROPERTY_CORRECTION_DISPOSITION","PROPERTY_CORRECTION_RESULT","PROPERTY_CUTOFF","PROPERTY_DATASET_REUSE","PROPERTY_DATE","PROPERTY_DECIMAL","PROPERTY_DECISIONS","PROPERTY_DECISION_INPUT","PROPERTY_DECISION_JSON","PROPERTY_DECISION_POPULATION","PROPERTY_DECISION_SIZE","PROPERTY_DISPOSITION","PROPERTY_DUPLICATE","PROPERTY_EDITION","PROPERTY_EDITION_ANCESTRY","PROPERTY_EDITION_CUTOFF","PROPERTY_EDITION_DUPLICATE","PROPERTY_EDITION_INVENTORY","PROPERTY_EDITION_POPULATION","PROPERTY_EDITION_ROLE","PROPERTY_EDITION_SCOPE","PROPERTY_ENCODING","PROPERTY_END","PROPERTY_FAMILIES","PROPERTY_FAMILY","PROPERTY_FIELDS","PROPERTY_FIELD_TYPE","PROPERTY_FILES","PROPERTY_FILE_LENGTH","PROPERTY_HEAD","PROPERTY_IDENTITY","PROPERTY_INSTANT","PROPERTY_INTERVAL","PROPERTY_INTERVAL_FIELDS","PROPERTY_INTERVAL_POLICY","PROPERTY_KIND","PROPERTY_LEASE_FAMILY","PROPERTY_LEASE_STATUS","PROPERTY_MAPPING","PROPERTY_MAPPING_COLUMN","PROPERTY_MIXED_CORRECTIONS","PROPERTY_NAMES","PROPERTY_NONWAIVABLE","PROPERTY_OBJECT","PROPERTY_PARAMETERS","PROPERTY_PARENT_REQUIRED","PROPERTY_PARENT_SCOPE","PROPERTY_PARENT_TIME","PROPERTY_PLATFORM","PROPERTY_PLATFORMS","PROPERTY_RECONCILIATION_SCOPE","PROPERTY_REHEARSALS","PROPERTY_REHEARSAL_CAPTURE","PROPERTY_REHEARSAL_DUPLICATE","PROPERTY_RELATION","PROPERTY_RELATIONS","PROPERTY_RELATION_IDENTITY","PROPERTY_RELATION_TYPES","PROPERTY_RELEASE_CONTROL","PROPERTY_RELEASE_EVIDENCE","PROPERTY_RELEASE_REVIEW","PROPERTY_REQUEST","PROPERTY_REVIEW","PROPERTY_REVIEW_POPULATION","PROPERTY_ROW_FAMILY","PROPERTY_SCOPE","PROPERTY_SOURCE_ECHO","PROPERTY_SOURCE_SIZE","PROPERTY_SPACE_FIELDS","PROPERTY_SPACE_IDENTITY","PROPERTY_SPACE_TYPES","PROPERTY_START","PROPERTY_SUPERSEDED","PROPERTY_TEXT"])

def request_status(store, operation_id):
    from migration_store import identifier
    identifier(operation_id, "operation_id")
    # One original SQLite snapshot checks the operation and every kind of owned
    # property output. This observation neither cancels nor rewrites the request.
    with store.transaction():
        op = store._operation(operation_id, required=False)
        result = {"schema": "commons.property-request-status/v1", "operation_id": operation_id,
                  "workspace_id": store.project["id"], "revision": store.project["revision"],
                  "found": op is not None, "can_return_to_draft": False}
        if op is None:
            return {**result, "status": None, "reason": "The original request is not admitted."}
        result.update(operation=op["operation"], status=op["status"], request_sha256=op["request_sha256"],
                      error=op["error"], original_request=op["request"])
        if op["operation"] not in MUTATIONS:
            return {**result, "reason": "Only original local property requests use this disposition."}
        kind = op["operation"].removesuffix(".create")
        record_id = kind.replace(".", "-") + "-" + identity({"op": op["id"], "sha": op["request_sha256"]})[:40]
        effects = {"record": store.get_entity(kind, record_id, required=False) is not None,
                   "rows": store.conn.execute("SELECT count(*) FROM property_rows WHERE dataset_id=?", (record_id,)).fetchone()[0],
                   "items": store.conn.execute("SELECT count(*) FROM property_items WHERE owner_id=?", (record_id,)).fetchone()[0],
                   "result": op["result"] is not None, "checkpoint": op["checkpoint"] is not None}
        code = op["error"].get("code") if isinstance(op["error"], dict) else None
        known_validation = code in DRAFT_VALIDATION_CODES
        allowed = op["status"] == "INTERRUPTED" and known_validation and not any(effects.values())
        return {**result, "record_id": record_id, "effects": effects,
                "known_validation_failure": known_validation, "can_return_to_draft": allowed,
                "reason": ("The retained local validation rejection has no committed property outputs; retain this observation and edit a new draft."
                           if allowed else "Keep the original request recovery: its outcome is active, unknown, successful or has retained outputs."),
                "meaning": "A read-only observation of the original transaction and owned rows. It does not cancel the original request or grant a platform action."}

def read(store, operation, p):
    if operation == "property.request_status": return request_status(store, p.get("operation_id"))
    if operation == "property.schema": return schema()
    if operation == "property.preview": return source_preview(store, p)
    if operation == "property.verify": return verify(store, p.get("id"))
    if operation == "property.get": return get(store, p.get("kind"), p.get("id"))
    if operation == "property.list":
        kind = p.get("kind")
        domain.require(kind in KINDS, "PROPERTY_KIND", "Select an advertised record kind.")
        offset, limit = page(p); return store.list_entities(kind, offset=offset, limit=limit)
    if operation == "property.rows":
        kind, entity_id = p.get("kind"), p.get("id")
        get(store, kind, entity_id); offset, limit = page(p)
        if kind == "property.dataset":
            table, where, args = "property_rows", "dataset_id=?", [entity_id]
        else:
            domain.require(kind in ("property.reconciliation", "property.review"), "PROPERTY_ROWS_KIND",
                           "Rows belong to a dataset, full reconciliation or review decisions.")
            section = p.get("section", "decisions" if kind == "property.review" else "items")
            allowed = ("decisions",) if kind == "property.review" else ("items", "checks")
            domain.require(section in allowed, "PROPERTY_SECTION", "Select the complete record section.")
            table, where, args = "property_items", "owner_id=? AND kind=?", [entity_id, section]
        if p.get("status"):
            domain.require(p["status"] in tuple(domain.STATUSES) + ("PASS","FAIL","open","accepted_variance","resolved"), "PROPERTY_STATUS", "Select an actual status.")
            domain.require(kind != "property.dataset", "PROPERTY_STATUS_KIND", "Status filtering selects assessment or decision rows.")
            where += " AND status=?"; args.append(p["status"])
        if p.get("query"):
            text(p["query"],"query",max_length=2000)
            where += " AND instr(lower(body_json),lower(?))>0"; args.append(p["query"])
        count = store.conn.execute("SELECT count(*) FROM "+table+" WHERE "+where,args).fetchone()[0]
        rows = [parse_json(r[0]) for r in store.conn.execute("SELECT body_json FROM "+table+" WHERE "+where+
                " ORDER BY ordinal LIMIT ? OFFSET ?",(*args,limit,offset))]
        return {"rows":rows, "total":count, "offset":offset, "limit":limit}
    raise MigrationError("PROPERTY_READ", "Unknown property read.")

def iter_export(store, kind, entity_id, format_name="ndjson"):
    value = get(store, kind, entity_id)
    def rows():
        if kind == "property.dataset":
            for row in iter_rows(store, entity_id): yield {"section":"rows","value":row}
        elif kind == "property.reconciliation":
            for section in ("items","checks"):
                for row in iter_items(store, entity_id, section): yield {"section":section,"value":row}
        elif kind == "property.review":
            for row in iter_items(store, entity_id, "decisions"): yield {"section":"decisions","value":row}
        else: yield {"section":"record","value":value}
    if format_name == "ndjson":
        yield (canonical({"record":value})+"\n").encode("utf-8")
        for row in rows(): yield (canonical(row)+"\n").encode("utf-8")
    else:
        domain.require(format_name == "csv", "PROPERTY_EXPORT", "Use CSV or NDJSON.")
        buffer=io.StringIO(newline=""); writer=csv.writer(buffer)
        writer.writerow(["original_record","section","ordinal","complete_json"])
        yield buffer.getvalue().encode("utf-8"); buffer.seek(0); buffer.truncate()
        for i,row in enumerate(rows(),1):
            writer.writerow([entity_id,row["section"],i,canonical(row["value"])])
            yield buffer.getvalue().encode("utf-8"); buffer.seek(0); buffer.truncate()
