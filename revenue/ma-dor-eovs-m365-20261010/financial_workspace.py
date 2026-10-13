"""Financial reporting in the existing Store, objects and original operation journal."""
from __future__ import annotations
import csv
import io
import json
from migration_store import MigrationError, canonical, identity, parse_json, text, digest, page, integer
import financial_domain as domain

KINDS = ("finance.dataset", "finance.definition", "finance.run", "finance.reconciliation",
         "finance.review", "finance.control", "finance.release")
MUTATIONS = tuple(k + ".create" for k in KINDS)
READS = ("finance.schema", "finance.list", "finance.get", "finance.rows", "finance.verify", "finance.preview")
MAX_SOURCE_BYTES = 64 * 1024 * 1024
DDL = """CREATE TABLE IF NOT EXISTS financial_rows(
 dataset_id TEXT NOT NULL,ordinal INTEGER NOT NULL,body_json TEXT NOT NULL,
 PRIMARY KEY(dataset_id,ordinal));
CREATE TABLE IF NOT EXISTS financial_items(
 owner_id TEXT NOT NULL,kind TEXT NOT NULL,ordinal INTEGER NOT NULL,body_json TEXT NOT NULL,
 PRIMARY KEY(owner_id,kind,ordinal));"""

def ensure(store):
    store.conn.executescript(DDL)

def schema():
    return {"schema": domain.SCHEMA, "mutations": list(MUTATIONS), "reads": list(READS),
            "kinds": list(KINDS), "formats": ["csv", "json-table"], "roles": list(domain.ROLES),
            "period_modes": ["movement", "balance"], "maximum_source_bytes": MAX_SOURCE_BYTES,
            "meaning": "Original export and native-definition evidence in the existing workspace. No tenant request, vendor deployment or financial approval is performed."}

def file_refs(store, refs, *, required=False):
    domain.require(isinstance(refs, list) and (refs or not required), "FINANCE_FILES", "Select original retained evidence files.")
    selected = []
    for ref in refs:
        domain.strict_object(ref, ("sha256", "filename"), ("purpose",))
        info = store.file_info(digest(ref["sha256"]))
        text(ref["filename"], "filename", max_length=240)
        with store.open_file(ref["sha256"]) as held:
            from migration_store import file_hash
            actual = file_hash(held)
        domain.require(actual["sha256"] == info["sha256"] and actual["bytes"] == info["bytes"],
                       "FINANCE_FILE_BYTES", "Retained evidence changed.")
        selected.append({**ref, "bytes": info["bytes"]})
    return selected

def request_body(op, fields):
    p = op["request"]
    domain.require(not set(p) - set(fields) - {"operation_id", "actor", "expected_revision"},
                   "FINANCE_REQUEST", "Unknown financial request fields.", fields=list(p))
    return p

def base(op, kind, title):
    return {"schema": domain.SCHEMA, "id": kind.replace(".", "-") + "-" + identity({"op": op["id"], "sha": op["request_sha256"]})[:40],
            "kind": kind, "title": text(title, "title"), "operation_id": op["id"],
            "created_at": op["created_at"], "created_revision": op["reserved_revision"], "actor": op["actor"]}

def record(store, op, kind, title, value, children=None):
    body = {**base(op, kind, title), **value}
    with store.transaction():
        if children:
            for key, rows in children.items():
                for i, row in enumerate(rows):
                    store.conn.execute("INSERT OR IGNORE INTO financial_items VALUES(?,?,?,?)", (body["id"], key, i, canonical(row)))
                actual = list(iter_items(store, body["id"], key))
                domain.require(actual == rows, "FINANCE_RESULT_CONFLICT", "Original result rows differ on continuation.")
        return store.put_entity(kind, body["id"], body, op["reserved_revision"])

def iter_rows(store, dataset_id):
    for row in store.conn.execute("SELECT body_json FROM financial_rows WHERE dataset_id=? ORDER BY ordinal", (dataset_id,)):
        yield parse_json(row[0])

def iter_items(store, owner_id, kind):
    for row in store.conn.execute("SELECT body_json FROM financial_items WHERE owner_id=? AND kind=? ORDER BY ordinal", (owner_id, kind)):
        yield parse_json(row[0])

def get(store, kind, entity_id):
    domain.require(kind in KINDS, "FINANCE_KIND", "Select an advertised financial record.")
    return store.get_entity(kind, entity_id)

def previous(store, kind, parent_id, context):
    if parent_id is None:
        return None
    old = get(store, kind, parent_id)
    domain.require(all(old.get(k) == v for k, v in context.items()), "FINANCE_PARENT", "Previous edition belongs to another selected scope.")
    later = store.conn.execute("SELECT body_json FROM entities WHERE kind=?", (kind,))
    domain.require(not any(parse_json(row[0]).get("parent_id") == parent_id for row in later),
                   "FINANCE_HEAD", "Select the current head; a later edition already exists.")
    return old

def source_preview(store, p):
    info = store.file_info(digest(p.get("file_sha256")))
    domain.require(info["bytes"] <= MAX_SOURCE_BYTES, "FINANCE_SOURCE_SIZE", "Original source exceeds the explicit complete-parser limit.")
    with store.open_file(info["sha256"]) as stream:
        raw = stream.read(MAX_SOURCE_BYTES + 1)
    columns, rows = domain.original_rows(raw, p.get("format"), p.get("dialect", {}))
    return {"sha256": info["sha256"], "bytes": info["bytes"], "columns": columns,
            "row_count": len(rows), "sample": rows[:5], "preview_only": True}

def dataset_create(store, op):
    p = request_body(op, ("title", "file_sha256", "filename", "format", "dialect", "context", "mapping", "parent_id"))
    context = domain.validate_context(p.get("context"))
    info = store.file_info(digest(p.get("file_sha256")))
    domain.require(info["bytes"] <= MAX_SOURCE_BYTES, "FINANCE_SOURCE_SIZE", "Original source exceeds the complete-parser bound.")
    with store.open_file(info["sha256"]) as stream:
        raw = stream.read(MAX_SOURCE_BYTES + 1)
    columns, original = domain.original_rows(raw, p.get("format"), p.get("dialect", {}))
    mapping = domain.validate_mapping(p.get("mapping"), columns)
    rows = domain.normalize(original, mapping)
    parent = previous(store, "finance.dataset", p.get("parent_id"), {})
    if parent:
        domain.require(domain.basis(parent["context"]) == domain.basis(context), "FINANCE_PARENT", "Keep the original dataset financial basis.")
    evidence = file_refs(store, context["review"]["evidence_files"])
    body = {**base(op, "finance.dataset", p.get("title")), "file_sha256": info["sha256"], "bytes": info["bytes"],
            "filename": text(p.get("filename"), "filename", max_length=240), "format": p["format"],
            "dialect": p.get("dialect", {}), "columns": columns, "context": context, "mapping": mapping,
            "row_count": len(rows), "issue_count": sum(bool(r["issues"]) for r in rows),
            "normalized_sha256": identity(rows), "parent_id": p.get("parent_id"), "evidence_files": evidence}
    with store.transaction():
        for row in rows:
            store.conn.execute("INSERT OR IGNORE INTO financial_rows VALUES(?,?,?)", (body["id"], row["ordinal"], canonical(row)))
        domain.require(list(iter_rows(store, body["id"])) == rows, "FINANCE_ROW_CONFLICT", "Original normalized rows changed on continuation.")
        return store.put_entity("finance.dataset", body["id"], body, op["reserved_revision"])

def definition_create(store, op):
    p = request_body(op, ("definition",))
    definition = domain.validate_definition(p.get("definition"))
    native = file_refs(store, definition["native_files"], required=True)
    evidence = file_refs(store, definition["review"]["evidence_files"])
    previous(store, "finance.definition", definition.get("parent_id"),
             {"company": definition["company"], "family": definition["family"]})
    if definition.get("parent_id"):
        change = get(store, "finance.control", definition.get("change_id"))
        domain.require(change["category"] == "change" and change["status"] == "approved" and
                       definition["parent_id"] in change["related_ids"],
                       "FINANCE_CHANGE", "A definition change requires the original approved change and previous definition binding.")
        domain.require(not any(parse_json(r[0]).get("parent_id") == change["id"] for r in store.conn.execute(
            "SELECT body_json FROM entities WHERE kind='finance.control'")), "FINANCE_CHANGE_SUPERSEDED",
            "A later control edition supersedes or withdraws this change approval.")
    return record(store, op, "finance.definition", definition["title"],
                  {"definition": definition, "definition_sha256": identity(definition), "company": definition["company"],
                   "family": definition["family"], "parent_id": definition.get("parent_id"),
                   "native_files": native, "evidence_files": evidence})

def run_value(store, definition, dataset, period, opening_id=None):
    opened = None
    if opening_id:
        opening = get(store, "finance.dataset", opening_id)
        opened = (opening, list(iter_rows(store, opening_id)))
    calculation = domain.calculate(definition["definition"], dataset, list(iter_rows(store, dataset["id"])), period, opened)
    return calculation

def run_full(store, run_id):
    saved = get(store, "finance.run", run_id)
    calc = dict(saved["calculation"])
    for key in ("rows", "population", "exclusions", "issues"):
        calc[key] = list(iter_items(store, run_id, key))
    return {**saved, "calculation": calc}

def run_create(store, op):
    p = request_body(op, ("title", "definition_id", "dataset_id", "period", "opening_dataset_id", "note"))
    definition = get(store, "finance.definition", p.get("definition_id"))
    dataset = get(store, "finance.dataset", p.get("dataset_id"))
    period = domain.validate_period(p.get("period"))
    calc = run_value(store, definition, dataset, period, p.get("opening_dataset_id"))
    children = {key: calc[key] for key in ("rows", "population", "exclusions", "issues")}
    return record(store, op, "finance.run", p.get("title"),
                  {"definition_id": definition["id"], "definition_sha256": definition["definition_sha256"],
                   "dataset_id": dataset["id"], "opening_dataset_id": p.get("opening_dataset_id"),
                   "company": definition["company"], "family": definition["family"], "period": period,
                   "calculation": {k: v for k, v in calc.items() if k not in children},
                   "calculation_sha256": identity(calc), "note": p.get("note", "")}, children)

def reconciliation_create(store, op):
    p = request_body(op, ("title", "run_id", "output_dataset_id", "native_binding", "note"))
    run = run_full(store, p.get("run_id"))
    definition = get(store, "finance.definition", run["definition_id"])
    output = get(store, "finance.dataset", p.get("output_dataset_id"))
    binding = domain.strict_object(p.get("native_binding"),
                                   ("definition_sha256", "period", "actor", "note", "evidence_files"))
    domain.require(binding["definition_sha256"] == run["definition_sha256"] and binding["period"] == run["period"],
                   "FINANCE_OUTPUT_BINDING", "Bind the actual native output to the exact original definition and complete period.")
    text(binding["actor"], "native-output reviewer"); text(binding["note"], "native-output review")
    evidence = file_refs(store, binding["evidence_files"], required=True)
    value = domain.compare_output(definition["definition"], run, output, list(iter_rows(store, output["id"])))
    return record(store, op, "finance.reconciliation", p.get("title"),
                  {"run_id": run["id"], "output_dataset_id": output["id"], "definition_id": definition["id"],
                   "company": definition["company"], "family": definition["family"], "period": run["period"],
                   "native_binding": binding, "evidence_files": evidence,
                   "comparison": {k: v for k, v in value.items() if k != "items"},
                   "comparison_sha256": identity(value), "note": p.get("note", "")},
                  {"items": value["items"]})

def review_create(store, op):
    p = request_body(op, ("title", "reconciliation_id", "parent_id", "decisions", "reviewer_role", "note", "evidence_files"))
    reconciliation = get(store, "finance.reconciliation", p.get("reconciliation_id"))
    previous(store, "finance.review", p.get("parent_id"), {"reconciliation_id": reconciliation["id"]})
    text(p.get("reviewer_role"), "actual reviewer role"); text(p.get("note"), "review note")
    evidence = file_refs(store, p.get("evidence_files"), required=True)
    items = {i["id"]: i for i in iter_items(store, reconciliation["id"], "items")}
    decisions = p.get("decisions")
    domain.require(isinstance(decisions, list), "FINANCE_DECISIONS", "Retain an explicit decision for every unmatched original key.")
    checked, seen = [], set()
    for decision in decisions:
        domain.strict_object(decision, ("item_id", "status", "owner", "note", "evidence_files"), ("correction_reconciliation_id",))
        item_id = decision["item_id"]
        domain.require(item_id in items and item_id not in seen and items[item_id]["status"] != "MATCH",
                       "FINANCE_DECISION", "Decide each original nonmatching key once.")
        seen.add(item_id); text(decision["owner"], "discrepancy owner"); text(decision["note"], "discrepancy explanation")
        domain.require(decision["status"] in ("open", "accepted_variance", "resolved"), "FINANCE_DISPOSITION", "Use an explicit disposition.")
        refs = file_refs(store, decision["evidence_files"], required=decision["status"] != "open")
        if decision["status"] == "resolved":
            correction = get(store, "finance.reconciliation", decision.get("correction_reconciliation_id"))
            domain.require(correction["company"] == reconciliation["company"] and correction["family"] == reconciliation["family"] and
                           correction["period"] == reconciliation["period"] and correction["definition_id"] == reconciliation["definition_id"] and correction["comparison"]["complete"],
                           "FINANCE_CORRECTION_SCOPE", "Correction evidence must use the same exact definition and complete company/family/period.")
            match = next((i for i in iter_items(store, correction["id"], "items") if i["id"] == item_id), None)
            domain.require(match is not None and match["status"] == "MATCH", "FINANCE_CORRECTION", "The original key must actually match in the corrected result.")
        checked.append({**decision, "evidence_files": refs})
    required = {i["id"] for i in items.values() if i["status"] != "MATCH"}
    domain.require(seen == required, "FINANCE_REVIEW_POPULATION", "Review the entire nonmatching population.", missing=sorted(required-seen))
    return record(store, op, "finance.review", p.get("title"),
                  {"reconciliation_id": reconciliation["id"], "parent_id": p.get("parent_id"),
                   "reviewer_role": p["reviewer_role"], "note": p["note"], "evidence_files": evidence,
                   "decisions": checked, "ready": reconciliation["comparison"]["complete"] and
                     all(d["status"] != "open" for d in checked)})

def control_create(store, op):
    p = request_body(op, ("title", "category", "status", "owner", "note", "external_reference",
                         "parent_id", "related_ids", "evidence_files", "authority"))
    domain.require(p.get("category") in ("audit", "change", "access", "installation", "training", "continia", "receiving"),
                   "FINANCE_CONTROL", "Select an audit, change, access, installation, training, Continia or receiving record.")
    domain.require(p.get("status") in ("proposed", "approved", "executed", "rejected", "withdrawn"),
                   "FINANCE_CONTROL_STATUS", "Retain the actual status, not an inferred completion.")
    for name in ("owner", "note", "external_reference"): text(p.get(name), name)
    related = p.get("related_ids")
    domain.require(isinstance(related, list) and related and len(set(related)) == len(related),
                   "FINANCE_CONTROL_SCOPE", "Bind the complete affected original records.")
    for entity_id in related:
        domain.require(store.conn.execute("SELECT 1 FROM entities WHERE id=?", (entity_id,)).fetchone() is not None,
                       "FINANCE_CONTROL_SCOPE", "Control references a missing original record.")
    old = previous(store, "finance.control", p.get("parent_id"), {"category": p["category"]})
    evidence = file_refs(store, p.get("evidence_files"), required=p["status"] != "proposed")
    authority = p.get("authority")
    if p["status"] != "proposed":
        domain.strict_object(authority, ("actor", "role", "decision_reference"))
        for value in authority.values(): text(value, "actual authority")
    if p["status"] == "executed":
        domain.require(old is not None and old["status"] == "approved", "FINANCE_CONTROL_APPROVAL", "Execution follows its retained original approval.")
        domain.require(set(related) == set(old["related_ids"]), "FINANCE_CONTROL_APPROVED_SCOPE",
                       "Execution must retain the complete originally approved scope; scope changes require their own approved edition.")
    return record(store, op, "finance.control", p.get("title"),
                  {key: p.get(key) for key in ("category", "status", "owner", "note", "external_reference",
                                              "parent_id", "related_ids", "authority")} | {"evidence_files": evidence})

def release_create(store, op):
    p = request_body(op, ("title", "company", "inventory_files", "families", "periods", "review_ids", "control_ids",
                         "acceptance", "note", "parent_id"))
    text(p.get("company"), "company"); text(p.get("note"), "release note")
    inventory = file_refs(store, p.get("inventory_files"), required=True)
    families, periods = p.get("families"), p.get("periods")
    domain.require(isinstance(families, list) and families and len(set(families)) == len(families),
                   "FINANCE_RELEASE_FAMILIES", "Select the full agreed report-family inventory.")
    domain.require(isinstance(periods, list) and len(periods) >= 2, "FINANCE_RELEASE_PERIODS", "Select at least two complete reporting periods.")
    period_ids = [identity(domain.validate_period(x)) for x in periods]
    domain.require(len(set(period_ids)) == len(period_ids), "FINANCE_RELEASE_PERIODS", "Select distinct complete periods.")
    dates = [(x["start"], x["end"]) for x in periods]
    domain.require(len(set(dates)) == len(dates), "FINANCE_RELEASE_PERIODS", "A changed label is not a second reporting period.")
    selected, coverage = [], set()
    later_review_parents = {parse_json(r[0]).get("parent_id") for r in store.conn.execute(
        "SELECT body_json FROM entities WHERE kind='finance.review'")}
    for review_id in p.get("review_ids", []):
        review = get(store, "finance.review", review_id)
        domain.require(review_id not in later_review_parents, "FINANCE_REVIEW_SUPERSEDED",
                       "Select the current review head; a later review may reopen earlier discrepancies.")
        rec = get(store, "finance.reconciliation", review["reconciliation_id"])
        domain.require(review["ready"] and rec["company"] == p["company"], "FINANCE_RELEASE_REVIEW", "Release needs completed original scope reviews.")
        key = (rec["family"], identity(rec["period"]))
        domain.require(key not in coverage, "FINANCE_RELEASE_DUPLICATE", "Select one controlling reviewed result per family and period.")
        coverage.add(key); selected.append({"review_id": review_id, "reconciliation_id": rec["id"], "definition_id": rec["definition_id"]})
    wanted = {(family, period) for family in families for period in period_ids}
    domain.require(coverage == wanted, "FINANCE_RELEASE_COVERAGE", "Every agreed family needs complete reviewed results in both periods.",
                   missing=[list(x) for x in sorted(wanted-coverage)])
    controls = [get(store, "finance.control", x) for x in p.get("control_ids", [])]
    domain.require(all(c["status"] == "executed" for c in controls), "FINANCE_RELEASE_CONTROLS", "Select actual executed control records.")
    later_control_parents = {parse_json(r[0]).get("parent_id") for r in store.conn.execute(
        "SELECT body_json FROM entities WHERE kind='finance.control'")}
    domain.require(not any(c["id"] in later_control_parents for c in controls),
                   "FINANCE_CONTROL_SUPERSEDED", "A later control edition supersedes or withdraws selected evidence.")
    scope_ids = {x[key] for x in selected for key in ("review_id", "reconciliation_id", "definition_id")}
    domain.require(all(set(c["related_ids"]) & scope_ids for c in controls),
                   "FINANCE_CONTROL_RELEASE_SCOPE", "Each selected control must bind an actual reviewed release record.")
    categories = {c["category"] for c in controls}
    domain.require({"audit", "installation", "training", "receiving"} <= categories,
                   "FINANCE_RELEASE_EVIDENCE", "Retain actual selected audit, approved installation, training and independent receiving results.")
    acceptance = domain.strict_object(p.get("acceptance"),
                                     ("finance_actor", "prime_actor", "receiving_actor", "reference", "evidence_files"))
    for key in ("finance_actor", "prime_actor", "receiving_actor", "reference"): text(acceptance[key], key)
    domain.require(acceptance["receiving_actor"] != op["actor"], "FINANCE_INDEPENDENT_RECEIVER",
                   "Record the actual independent receiving operator, not the release author.")
    accepted_files = file_refs(store, acceptance["evidence_files"], required=True)
    previous(store, "finance.release", p.get("parent_id"), {"company": p["company"]})
    return record(store, op, "finance.release", p.get("title"),
                  {"company": p["company"], "families": families, "periods": periods, "inventory_files": inventory,
                   "selections": selected, "control_ids": p["control_ids"], "acceptance": acceptance,
                   "acceptance_files": accepted_files, "parent_id": p.get("parent_id"), "note": p["note"],
                   "meaning": "Recorded external approvals and independent receiving evidence; this application does not grant tenant authority."})

def invoke(store, op):
    kind = op["operation"].removesuffix(".create")
    entity_id = kind.replace(".", "-") + "-" + identity({"op": op["id"], "sha": op["request_sha256"]})[:40]
    existing = store.get_entity(kind, entity_id, required=False)
    if existing is not None:
        return existing
    return HANDLERS[op["operation"]](store, op)

HANDLERS = {"finance.dataset.create": dataset_create, "finance.definition.create": definition_create,
            "finance.run.create": run_create, "finance.reconciliation.create": reconciliation_create,
            "finance.review.create": review_create, "finance.control.create": control_create,
            "finance.release.create": release_create}

def verify(store, entity_id=None):
    # Recompute from full original object bytes. No provider request or native replay.
    selected = [parse_json(row[0]) for row in store.conn.execute(
        "SELECT body_json FROM entities WHERE kind LIKE 'finance.%' ORDER BY created_revision,id")]
    verified = []
    for value in selected:
        kind = value["kind"]
        if kind == "finance.dataset":
            with store.open_file(value["file_sha256"]) as stream: raw = stream.read(MAX_SOURCE_BYTES + 1)
            columns, original = domain.original_rows(raw, value["format"], value["dialect"])
            actual = domain.normalize(original, domain.validate_mapping(value["mapping"], columns))
            domain.require(identity(actual) == value["normalized_sha256"] and actual == list(iter_rows(store, value["id"])),
                           "FINANCE_VERIFY_SOURCE", "Received source normalization differs.", id=value["id"])
        elif kind == "finance.run":
            definition = get(store, "finance.definition", value["definition_id"])
            dataset = get(store, "finance.dataset", value["dataset_id"])
            actual = run_value(store, definition, dataset, value["period"], value["opening_dataset_id"])
            domain.require(identity(actual) == value["calculation_sha256"] and actual == run_full(store, value["id"])["calculation"],
                           "FINANCE_VERIFY_RUN", "Received report calculation differs.", id=value["id"])
        elif kind == "finance.reconciliation":
            run = run_full(store, value["run_id"])
            definition = get(store, "finance.definition", value["definition_id"])
            output = get(store, "finance.dataset", value["output_dataset_id"])
            actual = domain.compare_output(definition["definition"], run, output, list(iter_rows(store, output["id"])))
            domain.require(identity(actual) == value["comparison_sha256"] and actual == {**value["comparison"], "items": list(iter_items(store, value["id"], "items"))},
                           "FINANCE_VERIFY_COMPARISON", "Received reconciliation differs.", id=value["id"])
        verified.append({"id": value["id"], "kind": kind})
    if entity_id:
        domain.require(any(r["id"] == entity_id for r in verified), "FINANCE_VERIFY_ID", "Selected original record was not found.")
    return {"schema": "commons.financial-verification/v1", "workspace_id": store.project["id"],
            "revision": store.project["revision"], "records": verified, "count": len(verified),
            "provider_calls": 0, "meaning": "Recomputed retained datasets, calculations and reconciliations; approvals remain original evidence."}

def read(store, operation, p):
    if operation == "finance.schema": return schema()
    if operation == "finance.preview": return source_preview(store, p)
    if operation == "finance.verify": return verify(store, p.get("id"))
    if operation == "finance.list":
        kind = p.get("kind")
        domain.require(kind in KINDS, "FINANCE_KIND", "Choose an advertised financial record kind.")
        offset, limit = page(p); return store.list_entities(kind, offset=offset, limit=limit)
    if operation == "finance.get":
        return get(store, p.get("kind"), p.get("id"))
    if operation == "finance.rows":
        kind, entity_id = p.get("kind"), p.get("id")
        get(store, kind, entity_id)
        offset, limit = page(p)
        if kind == "finance.dataset":
            table, where, args = "financial_rows", "dataset_id=?", [entity_id]
        else:
            section = p.get("section", "items" if kind == "finance.reconciliation" else "rows")
            domain.require(section in ("rows", "population", "exclusions", "issues", "items"), "FINANCE_SECTION", "Select a complete result section.")
            table, where, args = "financial_items", "owner_id=? AND kind=?", [entity_id, section]
        if p.get("status"):
            domain.require(p["status"] in ("MATCH", "DIFFERENT", "UNKNOWN", "AMBIGUOUS", "MISSING", "UNEXPECTED"),
                           "FINANCE_STATUS", "Select an actual reconciliation status.")
            where += " AND instr(body_json,?)>0"
            args.append('"status":' + canonical(p["status"]))
        if p.get("query"):
            text(p["query"], "query", max_length=2000)
            where += " AND instr(lower(body_json),lower(?))>0"
            args.append(p["query"])
        total = store.conn.execute("SELECT count(*) FROM " + table + " WHERE " + where, args).fetchone()[0]
        rows = [parse_json(r[0]) for r in store.conn.execute(
            "SELECT body_json FROM " + table + " WHERE " + where + " ORDER BY ordinal LIMIT ? OFFSET ?",
            (*args, limit, offset))]
        return {"rows": rows, "total": total, "offset": offset, "limit": limit}
    raise MigrationError("FINANCE_READ", "Unknown financial read.")

def iter_export(store, kind, entity_id, format_name="ndjson"):
    value = get(store, kind, entity_id)
    if kind == "finance.dataset": rows = iter_rows(store, entity_id)
    elif kind == "finance.run": rows = iter_items(store, entity_id, "rows")
    elif kind == "finance.reconciliation": rows = iter_items(store, entity_id, "items")
    else: rows = iter([value])
    if format_name == "ndjson":
        yield (canonical({"record": value}) + "\n").encode("utf-8")
        for row in rows: yield (canonical(row) + "\n").encode("utf-8")
    else:
        domain.require(format_name == "csv", "FINANCE_EXPORT", "Use CSV or NDJSON.")
        buffer = io.StringIO(newline="")
        writer = csv.writer(buffer)
        writer.writerow(["original_record", "ordinal", "complete_json"])
        yield buffer.getvalue().encode("utf-8"); buffer.seek(0); buffer.truncate()
        for i, row in enumerate(rows, 1):
            writer.writerow([entity_id, i, canonical(row)])
            yield buffer.getvalue().encode("utf-8"); buffer.seek(0); buffer.truncate()
