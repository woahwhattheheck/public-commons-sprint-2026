"""Full-population source/target reconciliation on the maintained discovery engine.

Every selected source and target record is retained. The index is disk-backed;
JSONL and CSV exports stream every comparison. No source-system writes occur.
"""
from __future__ import annotations
import argparse
from collections import Counter
import csv
from contextlib import closing
from fractions import Fraction
import json
import os
from pathlib import Path
import shutil
import sqlite3
import tempfile
from discovery_engine import (
    DiscoveryError, require, json_bytes, parse_json_bytes, read_json, write_json,
    digest, file_digest, finite_decimal, safe_relative, run_manifest,
    record_database, verify_original_sources, create_handover, receive_handover,
)

SCHEMA = "tjlabs.migration-reconciliation.selection.v1"
RESULT = "tjlabs.migration-reconciliation.result.v1"
KINDS = {"text", "integer", "decimal", "date", "boolean"}

def exact(value):
    require(isinstance(value, str) and value and len(value) <= 1000,
            "Exact numbers must be nonempty base-ten strings")
    try:
        n = finite_decimal(value)
        require(n.is_finite() and abs(n.as_tuple().exponent) <= 1000,
                "Nonfinite or excessive decimal")
        return Fraction(n)
    except (ValueError, ArithmeticError) as error:
        raise DiscoveryError("Invalid exact decimal") from error

def number(value):
    if value is None:
        return None
    # Display only; equality and tolerances use the complete fraction.
    scale = 10 ** 12
    q, r = divmod(abs(value.numerator) * scale, value.denominator)
    if 2*r > value.denominator or (2*r == value.denominator and q % 2):
        q += 1
    digits = str(q).rjust(13, "0")
    return {"numerator": str(value.numerator), "denominator": str(value.denominator),
            "decimal": ("-" if value < 0 and q else "") + digits[:-12]+"."+digits[-12:],
            "display_rounding": "HALF_EVEN_12_PLACES"}

def key_text(values):
    return json_bytes(values).decode("utf-8").strip()

def reference(table, record):
    return {"table": table, "record": record}

def problem(code, detail, refs):
    return {"code": code, "detail": detail, "source_records": refs}

def validate(selection, manifest):
    require(selection.get("schema") == SCHEMA, "Unsupported migration selection")
    require(selection.get("interpretation_reference") and selection.get("population_reference"),
            "Retain complete population and interpretation references")
    tables = {t["id"]: t for t in manifest["tables"]}
    pairs = selection.get("pairs")
    require(isinstance(pairs, list) and 0 < len(pairs) <= 100,
            "Select 1 through 100 complete source/target table pairs")
    ids = set()
    for pair in pairs:
        pid = pair.get("id")
        require(isinstance(pid, str) and pid and len(pid) <= 96 and pid not in ids,
                "Each pair needs a unique stable ID")
        ids.add(pid)
        require(pair.get("comparison_reference"), "Each pair needs its reviewed semantic interpretation")
        side_types = {}
        for side in ("source", "target"):
            binding = pair.get(side, {})
            require(binding.get("table") in tables, "Pair identifies an undeclared original table")
            table = tables[binding["table"]]
            cols = {c["name"]: c for c in table["columns"]}
            keys = binding.get("keys")
            require(isinstance(keys, list) and keys and len(set(keys)) == len(keys) and
                    all(k in cols for k in keys), "Select explicit distinct ordered key columns")
            side_types[side] = [cols[k]["type"] for k in keys]
        mapping = pair.get("key_mapping")
        if mapping:
            require(mapping.get("table") in tables and mapping.get("reference"),
                    "A key crosswalk needs its original table and interpretation")
            cols = {c["name"]: c for c in tables[mapping["table"]]["columns"]}
            for side in ("source", "target"):
                keys = mapping.get(side+"_columns")
                require(isinstance(keys, list) and keys and all(k in cols for k in keys) and
                        [cols[k]["type"] for k in keys] == side_types[side],
                        "Crosswalk columns must match the corresponding side key types and arity")
        else:
            require(side_types["source"] == side_types["target"],
                    "Unmapped key types and arity must agree")
        fields = pair.get("fields")
        require(isinstance(fields, list) and fields, "Select explicit field comparisons")
        fids = set()
        for field in fields:
            fid, kind = field.get("id"), field.get("kind")
            require(isinstance(fid, str) and fid and fid not in fids and kind in KINDS,
                    "Field IDs must be unique with declared semantics")
            fids.add(fid)
            require(type(field.get("allow_both_null")) is bool, "Declare both-null treatment")
            if kind == "decimal":
                require(exact(field["tolerance"]) >= 0, "Declare a nonnegative exact tolerance")
            for side in ("source", "target"):
                cols = {c["name"]: c for c in tables[pair[side]["table"]]["columns"]}
                bind = field.get(side, {})
                require(bind.get("column") in cols, "Compared field must name an original column")
                original_type = cols[bind["column"]]["type"]
                require(original_type in ("integer", "decimal") if kind == "decimal"
                        else original_type == kind, "Field type differs from its declared original column")
                if kind == "decimal":
                    multiplier = exact(bind.get("multiplier", "1"))
                    divisor = exact(bind.get("divisor", "1"))
                    offset = exact(bind.get("offset", "0"))
                    require(divisor != 0 and multiplier != 0, "Numeric scale must be nonzero")
                    require((multiplier == 1 and divisor == 1 and offset == 0) or bind.get("reference"),
                            "Changed unit/sign/scale needs its explicit reviewed reference")
                else:
                    require(not (set(bind) & {"multiplier", "divisor", "offset"}),
                            "Nondecimal fields compare their exact normalized original values")
        dimensions = pair.get("dimensions", [])
        require(isinstance(dimensions, list) and len(dimensions) == len(set(dimensions)) and
                all(any(f["id"] == d and f["kind"] != "decimal" for f in fields) for d in dimensions),
                "Comparison dimensions must identify nondecimal fields")
    return tables

def original_rows(db, manifest, table_id):
    i, table = next((i,t) for i,t in enumerate(manifest["tables"]) if t["id"] == table_id)
    names = [c["name"] for c in table["columns"]]
    for row in db.execute("SELECT _row,_valid,"+",".join("n%d"%i for i in range(len(names)))+" FROM t%d"%i):
        yield row[0], bool(row[1]), dict(zip(names, row[2:]))

def transform(field, side, values):
    bind = field[side]
    value = values[bind["column"]]
    if value is None:
        return None
    if field["kind"] == "decimal":
        return (exact(value)*exact(bind.get("multiplier","1"))/exact(bind.get("divisor","1"))
                +exact(bind.get("offset","0")))
    return value

def columns_key(values, columns):
    key = [values[c] for c in columns]
    return None if any(x is None for x in key) else key_text(key)

def field_results(pair, source, target, comparable):
    output = []
    dimensions_match = comparable and all(
        transform(f, "source", source) is not None and
        transform(f, "source", source) == transform(f, "target", target)
        for f in pair["fields"] if f["id"] in pair.get("dimensions", []))
    for field in pair["fields"]:
        kind = field["kind"]
        left = transform(field, "source", source) if source is not None else None
        right = transform(field, "target", target) if target is not None else None
        item = {"id": field["id"], "kind": kind,
                "source_value": source.get(field["source"]["column"]) if source is not None else None,
                "target_value": target.get(field["target"]["column"]) if target is not None else None,
                "source_exact": number(left) if kind == "decimal" else None,
                "target_exact": number(right) if kind == "decimal" else None,
                "difference": None, "tolerance": number(exact(field["tolerance"])) if kind == "decimal" else None,
                "status": "UNCOMPUTED", "reason": None}
        if not comparable:
            item["reason"] = "The full key group needs one valid source and one valid target record."
        elif kind == "decimal" and not dimensions_match:
            item["reason"] = "A required nonnull currency, period, unit or other selected dimension differs."
        elif left is None and right is None:
            item["status"] = "BOTH_NULL" if field["allow_both_null"] else "UNCOMPUTED"
            if not field["allow_both_null"]:
                item["reason"] = "Both-null equivalence was not selected."
        elif left is None or right is None:
            item["status"] = "NULL_MISMATCH"
            item["reason"] = "A missing value remains missing."
        elif kind == "decimal":
            delta = right-left
            item["difference"] = number(delta)
            item["status"] = "MATCHED" if abs(delta) <= exact(field["tolerance"]) else "DIFFERENCE"
        else:
            item["status"] = "MATCHED" if left == right else "DIFFERENCE"
        output.append(item)
    return output

class Output:
    def __init__(self, directory):
        self.root = Path(directory)
        self.db = sqlite3.connect(self.root/"comparisons.sqlite")
        self.db.execute("CREATE TABLE comparisons(row_id INTEGER PRIMARY KEY,pair TEXT NOT NULL,classification TEXT NOT NULL,key_text TEXT NOT NULL,payload TEXT NOT NULL)")
        self.jsonl = open(self.root/"rows.jsonl", "w", encoding="utf-8", newline="\n")
        self.csv = open(self.root/"rows.csv", "w", encoding="utf-8", newline="")
        self.writer = csv.writer(self.csv)
        self.writer.writerow(["row_id","pair","classification","key_json","source_records","target_records","fields_json","issues_json"])
        self.count = 0
        self.total_count = 0
        self.db.execute("CREATE TABLE totals(total_id INTEGER PRIMARY KEY,pair TEXT NOT NULL,field TEXT NOT NULL,status TEXT NOT NULL,dimensions TEXT NOT NULL,payload TEXT NOT NULL)")
        self.totals_jsonl = open(self.root/"totals.jsonl","w",encoding="utf-8",newline="\n")
        self.totals_csv = open(self.root/"totals.csv","w",encoding="utf-8",newline="")
        self.totals_writer = csv.writer(self.totals_csv)
        self.totals_writer.writerow(["total_id","pair","field","dimensions","status","source","target","difference"])
    def emit_total(self,pid,row):
        self.total_count += 1
        row = {"total_id":self.total_count,"pair":pid,**row}
        payload = json.dumps(row,ensure_ascii=False,separators=(",",":"),allow_nan=False)
        dimensions = json.dumps(row["dimensions"],ensure_ascii=False)
        self.totals_jsonl.write(payload+"\n")
        self.db.execute("INSERT INTO totals VALUES(?,?,?,?,?,?)",
                        (self.total_count,pid,row["field"],row["status"],dimensions,payload))
        values = [str(self.total_count),pid,row["field"],dimensions,row["status"]]+[
            json.dumps(row[x],ensure_ascii=False,separators=(",",":")) for x in ("source","target","difference")]
        self.totals_writer.writerow(["'"+v if v.lstrip().startswith(("=","+","-","@")) else v for v in values])
        if self.total_count % 10000 == 0:
            self.db.commit()
    def emit(self, pid, row):
        self.count += 1
        row = {"row_id": self.count, "pair": pid, **row}
        payload = json.dumps(row, ensure_ascii=False, separators=(",",":"), allow_nan=False)
        self.jsonl.write(payload+"\n")
        key = json.dumps(row.get("key"), ensure_ascii=False)
        self.db.execute("INSERT INTO comparisons VALUES(?,?,?,?,?)",
                        (self.count,pid,row["classification"],key,payload))
        values = [str(self.count),pid,row["classification"],key] + [
            json.dumps(row[x],ensure_ascii=False,separators=(",",":")) for x in
            ("source_records","target_records","fields","issues")]
        self.writer.writerow(["'"+v if v.lstrip().startswith(("=","+","-","@")) else v for v in values])
        if self.count % 10000 == 0:
            self.db.commit()
    def close(self):
        self.jsonl.close()
        self.csv.close()
        self.totals_jsonl.close()
        self.totals_csv.close()
        self.db.execute("CREATE INDEX totals_pair ON totals(pair,field,status,total_id)")
        self.db.execute("CREATE INDEX comparison_pair ON comparisons(pair,classification,row_id)")
        self.db.execute("CREATE INDEX comparison_class ON comparisons(classification,row_id)")
        self.db.commit()
        self.db.close()

def index_pair(db, manifest, pair, emit, output):
    db.execute("DROP TABLE IF EXISTS temp.migration_rows")
    db.execute("DROP TABLE IF EXISTS temp.migration_map")
    db.execute("DROP TABLE IF EXISTS temp.migration_map_source_counts")
    db.execute("DROP TABLE IF EXISTS temp.migration_map_target_counts")
    db.execute("CREATE TEMP TABLE migration_rows(side TEXT NOT NULL,record INTEGER NOT NULL,own_key TEXT,mapped_key TEXT,valid INTEGER NOT NULL,payload TEXT NOT NULL,problem TEXT,PRIMARY KEY(side,record))")
    db.execute("CREATE TEMP TABLE migration_map(record INTEGER PRIMARY KEY,source_key TEXT,target_key TEXT,valid INTEGER NOT NULL)")
    mapping = pair.get("key_mapping")
    mapping_issue_counts = Counter()
    def map_problem(code, detail, refs):
        mapping_issue_counts[code] += 1
        emit({"key":None,"source_key":None,"source_records":refs,"target_records":[],
              "classification":"CROSSWALK_ISSUE","issues":[problem(code,detail,refs)],"fields":[]})
    if mapping:
        for record, valid, values in original_rows(db, manifest, mapping["table"]):
            left = columns_key(values, mapping["source_columns"])
            right = columns_key(values, mapping["target_columns"])
            db.execute("INSERT INTO migration_map VALUES(?,?,?,?)", (record,left,right,int(valid)))
            if not valid or left is None or right is None:
                map_problem("INVALID_CROSSWALK_ROW",
                    "The original crosswalk row is invalid or has an incomplete source/target key.",
                    [reference(mapping["table"],record)])
        db.execute("CREATE INDEX temp.migration_map_source ON migration_map(source_key)")
        db.execute("CREATE INDEX temp.migration_map_target ON migration_map(target_key)")
        db.execute("CREATE TEMP TABLE migration_map_source_counts AS SELECT source_key,COUNT(*) n,SUM(valid=0 OR target_key IS NULL) bad,MIN(target_key) target_key FROM migration_map GROUP BY source_key")
        db.execute("CREATE UNIQUE INDEX temp.migration_map_source_count_key ON migration_map_source_counts(source_key)")
        db.execute("CREATE TEMP TABLE migration_map_target_counts AS SELECT target_key,COUNT(*) n FROM migration_map GROUP BY target_key")
        db.execute("CREATE UNIQUE INDEX temp.migration_map_target_count_key ON migration_map_target_counts(target_key)")
    db.execute("DROP TABLE IF EXISTS temp.migration_totals")
    db.execute("CREATE TEMP TABLE migration_totals(dimensions TEXT NOT NULL,field TEXT NOT NULL,side TEXT NOT NULL,numerator TEXT NOT NULL,denominator TEXT NOT NULL,n INTEGER NOT NULL,incomplete INTEGER NOT NULL,PRIMARY KEY(dimensions,field,side))")
    count = {"source":0,"target":0}
    for side in ("source", "target"):
        table = pair[side]["table"]
        for record, valid, values in original_rows(db, manifest, table):
            count[side] += 1
            own = columns_key(values, pair[side]["keys"])
            mapped, code = own, None
            if own is None:
                mapped, code = None, "UNKEYED"
            elif side == "source" and mapping:
                # Count first, so a corrupt repeated crosswalk cannot expand a row into millions of Python objects.
                counted = db.execute("SELECT n,bad,target_key FROM migration_map_source_counts WHERE source_key=?", (own,)).fetchone()
                n,bad,mapped_target = counted if counted else (0,0,None)
                if n == 0:
                    mapped, code = None, "UNMAPPED_KEY"
                elif n != 1 or bad:
                    mapped, code = None, "AMBIGUOUS_CROSSWALK"
                else:
                    mapped = mapped_target
                    inverse = db.execute("SELECT n FROM migration_map_target_counts WHERE target_key=?", (mapped,)).fetchone()[0]
                    if inverse != 1:
                        mapped, code = None, "AMBIGUOUS_CROSSWALK"
            db.execute("INSERT INTO migration_rows VALUES(?,?,?,?,?,?,?)",
                       (side,record,own,mapped,int(valid),json.dumps(values,ensure_ascii=False),code))
            dimension_fields = [f for d in pair.get("dimensions",[]) for f in pair["fields"] if f["id"] == d]
            dimensions = [transform(f,side,values) for f in dimension_fields]
            dimensions_valid = valid and all(x is not None for x in dimensions)
            dim_key = key_text(dimensions)
            for field in pair["fields"]:
                if field["kind"] != "decimal":
                    continue
                value = transform(field,side,values)
                incomplete = not dimensions_valid or value is None
                prior = db.execute("SELECT numerator,denominator,n,incomplete FROM migration_totals WHERE dimensions=? AND field=? AND side=?",(dim_key,field["id"],side)).fetchone()
                amount = (Fraction(int(prior[0]),int(prior[1])) if prior else Fraction(0))
                if not incomplete:
                    amount += value
                n = (prior[2] if prior else 0)+1
                missing = (prior[3] if prior else 0)+int(incomplete)
                db.execute("INSERT OR REPLACE INTO migration_totals VALUES(?,?,?,?,?,?,?)",
                           (dim_key,field["id"],side,str(amount.numerator),str(amount.denominator),n,missing))
            if count[side] % 10000 == 0:
                db.commit()
    db.execute("CREATE INDEX temp.migration_rows_key ON migration_rows(mapped_key,side)")
    db.execute("CREATE INDEX temp.migration_rows_own ON migration_rows(side,own_key)")
    if mapping:
        for record,left,right,valid in db.execute("SELECT record,source_key,target_key,valid FROM migration_map ORDER BY record"):
            refs = [reference(mapping["table"],record)]
            source_count = db.execute("SELECT n FROM migration_map_source_counts WHERE source_key=?",(left,)).fetchone()[0] if left is not None else 0
            target_count = db.execute("SELECT n FROM migration_map_target_counts WHERE target_key=?",(right,)).fetchone()[0] if right is not None else 0
            if source_count > 1 or target_count > 1:
                map_problem("AMBIGUOUS_CROSSWALK_ROW",
                    "Original mapping row belongs to repeated source-key rows (%d) or colliding target-key rows (%d). No mapping is selected."%(source_count,target_count),refs)
            if left is not None and not db.execute("SELECT 1 FROM migration_rows WHERE side='source' AND own_key=? LIMIT 1",(left,)).fetchone():
                map_problem("CROSSWALK_SOURCE_ABSENT",
                    "This crosswalk source key has no record in the selected complete source table.",refs)
            if right is not None and not db.execute("SELECT 1 FROM migration_rows WHERE side='target' AND own_key=? LIMIT 1",(right,)).fetchone():
                map_problem("CROSSWALK_TARGET_ABSENT",
                    "This crosswalk target key has no record in the selected complete target table.",refs)
    total_start = output.total_count+1
    total_statuses = Counter()
    for dim_key,fid in db.execute("SELECT DISTINCT dimensions,field FROM migration_totals ORDER BY dimensions,field"):
        dimensions = json.loads(dim_key)
        sides = {}
        for side in ("source","target"):
            entry = db.execute("SELECT numerator,denominator,n,incomplete FROM migration_totals WHERE dimensions=? AND field=? AND side=?",(dim_key,fid,side)).fetchone()
            sides[side] = {"sum":Fraction(int(entry[0]),int(entry[1])) if entry else Fraction(0),
                           "rows":entry[2] if entry else 0,"uncomputed_rows":entry[3] if entry else 0}
        left,right = sides["source"],sides["target"]
        complete = not left["uncomputed_rows"] and not right["uncomputed_rows"] and all(x is not None for x in dimensions)
        status = "COMPUTED" if complete else "UNCOMPUTED"
        total_statuses[status] += 1
        output.emit_total(pair["id"],{"dimensions":dimensions,"field":fid,
            "source":{**left,"sum":number(left["sum"])},"target":{**right,"sum":number(right["sum"])},
            "difference":number(right["sum"]-left["sum"]) if complete else None,"status":status,
            "meaning":"Full original population totals. Incomplete subtotal and excluded-row count remain explicit; totals do not resolve key or individual-row exceptions."})
    count_totals = output.total_count-total_start+1
    descriptor = {"count":count_totals,"first_total_id":total_start if count_totals else None,
                  "last_total_id":output.total_count if count_totals else None,"status_counts":dict(total_statuses)}
    return count,descriptor,dict(mapping_issue_counts)

def analyse(db, manifest, report, selection, output):
    validate(selection,manifest)
    pairs = []
    for pair in selection["pairs"]:
        statuses = Counter()
        issues_count = 0
        groups = 0
        first_row = output.count+1
        def emit(row):
            nonlocal issues_count
            statuses[row["classification"]] += 1
            issues_count += len(row["issues"])
            output.emit(pair["id"],row)
        counts, totals, mapping_issue_counts = index_pair(db,manifest,pair,emit,output)
        for side,record,own,payload,valid,code in db.execute(
                "SELECT side,record,own_key,payload,valid,problem FROM migration_rows WHERE mapped_key IS NULL ORDER BY side,record"):
            values = json.loads(payload)
            refs = [reference(pair[side]["table"],record)]
            emit({"key":None,"source_key":json.loads(own) if own else None,
                  "source_records":refs if side=="source" else [],
                  "target_records":refs if side=="target" else [],
                  "classification":code or "UNKEYED",
                  "issues":[problem(code or "UNKEYED","The original row cannot be assigned a unique complete migration key.",refs)],
                  "fields":field_results(pair,values if side=="source" and valid else None,
                                         values if side=="target" and valid else None,False)})
        keys = db.execute("SELECT mapped_key,SUM(side='source'),SUM(side='target'),SUM(valid=0) FROM migration_rows WHERE mapped_key IS NOT NULL GROUP BY mapped_key ORDER BY mapped_key")
        for key,left_count,right_count,bad in keys:
            groups += 1
            if left_count > 1 or right_count > 1:
                for side,record,own,valid,payload in db.execute(
                        "SELECT side,record,own_key,valid,payload FROM migration_rows WHERE mapped_key=? ORDER BY side,record",(key,)):
                    refs = [reference(pair[side]["table"],record)]
                    values = json.loads(payload)
                    emit({"key":json.loads(key),"source_key":json.loads(own),
                        "source_records":refs if side=="source" else [],
                        "target_records":refs if side=="target" else [],
                        "group_source_rows":left_count,"group_target_rows":right_count,
                        "classification":"AMBIGUOUS_KEY",
                        "issues":[problem("AMBIGUOUS_KEY","The complete business-key group contains duplicate source or target rows. Every member is exported separately; no row is selected arbitrarily.",refs)],
                        "fields":field_results(pair,values if side=="source" and valid else None,
                                              values if side=="target" and valid else None,False)})
                continue
            selected = {row[0]:row for row in db.execute(
                "SELECT side,record,own_key,valid,payload FROM migration_rows WHERE mapped_key=? ORDER BY side",(key,))}
            left,right = selected.get("source"),selected.get("target")
            lrefs = [reference(pair["source"]["table"],left[1])] if left else []
            rrefs = [reference(pair["target"]["table"],right[1])] if right else []
            lv = json.loads(left[4]) if left and left[3] else None
            rv = json.loads(right[4]) if right and right[3] else None
            comparable = left is not None and right is not None and bad == 0
            fields = field_results(pair,lv,rv,comparable)
            problems = []
            if left is None:
                classification = "TARGET_ONLY"
                problems.append(problem("TARGET_ONLY","No selected source record maps to this target key.",rrefs))
            elif right is None:
                classification = "SOURCE_ONLY"
                problems.append(problem("SOURCE_ONLY","This source key has no selected target record.",lrefs))
            elif bad:
                classification = "INVALID_SOURCE_ROW" if not left[3] else "INVALID_TARGET_ROW"
                problems.append(problem(classification,"At least one original row fails its declared source schema; its key group remains unresolved.",lrefs+rrefs))
            else:
                classification = "MATCHED"
                for field in fields:
                    if field["status"] not in ("MATCHED","BOTH_NULL"):
                        classification = "DIFFERENCE"
                        problems.append(problem("FIELD_"+field["status"],field["id"]+": "+(field["reason"] or "Selected source and target values differ."),lrefs+rrefs))
            emit({"key":json.loads(key),"source_key":json.loads(left[2]) if left else None,
                "source_records":lrefs,"target_records":rrefs,"classification":classification,
                "issues":problems,"fields":fields})
        pairs.append({"id":pair["id"],"label":pair.get("label",pair["id"]),
            "source_table":pair["source"]["table"],"target_table":pair["target"]["table"],
            "key_fields":{s:pair[s]["keys"] for s in ("source","target")},
            "key_mapping":pair.get("key_mapping"),"dimensions":pair.get("dimensions",[]),
            "fields":[{"id":f["id"],"kind":f["kind"],"source":f["source"],"target":f["target"],
                       "allow_both_null":f["allow_both_null"],
                       "tolerance":number(exact(f["tolerance"])) if f["kind"]=="decimal" else None} for f in pair["fields"]],
            "comparison_reference":pair["comparison_reference"],
            "summary":{"source_rows":counts["source"],"target_rows":counts["target"],
                       "key_groups":groups,"comparison_records":output.count-first_row+1,
                       "status_counts":dict(statuses),"issue_count":issues_count},
            "first_row_id":first_row if output.count >= first_row else None,
            "last_row_id":output.count if output.count >= first_row else None,
            "totals":totals,"crosswalk_issue_counts":mapping_issue_counts,
            "crosswalk_issues":"Every original crosswalk issue is in the full comparison population with classification CROSSWALK_ISSUE."})
    return {"schema":RESULT,"source_run_identity":report["run_identity"],
        "data_class":report["data_class"],"edition":report["edition"],
        "label":selection.get("label","Complete source and target reconciliation"),
        "selection_sha256":digest(json_bytes(selection)),
        "source_inputs":report["lineage"]["inputs"],"pairs":pairs,
        "comparison_records":output.count,
        "source_quality":{"quality_status":report["quality_status"],
                          "tables":report["tables"],"foreign_keys":report["foreign_keys"]},
        "interpretation_reference":selection["interpretation_reference"],
        "population_reference":selection["population_reference"],
        "meaning":"Every row in each selected frozen source and target table is represented. Exact source meanings, keys and comparison dimensions govern results; differences and incomplete rows remain explicit."}

def run_migration(manifest_path, selection_path, output, input_root=None):
    output = Path(output).resolve()
    require(not output.exists(),"Choose a new complete migration case directory")
    selected_bytes = Path(selection_path).read_bytes()
    selection = parse_json_bytes(selected_bytes)
    output.parent.mkdir(parents=True,exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix="."+output.name+"-",dir=output.parent))
    try:
        case = stage/"case"
        original = run_manifest(manifest_path,case,root=input_root)
        report = original["report"]
        manifest = verify_original_sources(case,report)
        migration = case/"migration"
        migration.mkdir()
        (migration/"selection.original.json").write_bytes(selected_bytes)
        write_json(migration/"selection.json",selection)
        writer = Output(migration)
        try:
            with record_database(case,report) as (database,mode):
                with closing(sqlite3.connect(Path(database).as_uri()+"?mode=ro",uri=True)) as db:
                    db.execute("PRAGMA temp_store=FILE")
                    result = analyse(db,manifest,report,selection,writer)
        finally:
            writer.close()
        result["database_mode"] = mode
        result["selection_original_sha256"] = digest(selected_bytes)
        here = Path(__file__).resolve().parent
        result["recipe_files"] = [{"path":n,"bytes":(here/n).stat().st_size,"sha256":file_digest(here/n)}
                                  for n in ("migration_reconciliation.py","migration_report.py","migration_server.py")]
        result["totals"] = {"jsonl":{"path":"totals.jsonl","bytes":(migration/"totals.jsonl").stat().st_size,"sha256":file_digest(migration/"totals.jsonl")},
                            "csv":{"path":"totals.csv","bytes":(migration/"totals.csv").stat().st_size,"sha256":file_digest(migration/"totals.csv")},
                            "count":writer.total_count}
        result["rows"] = {"jsonl":{"path":"rows.jsonl","bytes":(migration/"rows.jsonl").stat().st_size,"sha256":file_digest(migration/"rows.jsonl")},
                          "csv":{"path":"rows.csv","bytes":(migration/"rows.csv").stat().st_size,"sha256":file_digest(migration/"rows.csv")},
                          "index":{"path":"comparisons.sqlite","bytes":(migration/"comparisons.sqlite").stat().st_size,"sha256":file_digest(migration/"comparisons.sqlite")},
                          "count":writer.count}
        from migration_report import render_html
        write_json(migration/"result.json",result)
        (migration/"report.html").write_text(render_html(result,report,manifest),encoding="utf-8")
        write_json(migration/"delivery.json",{"schema":"tjlabs.migration-reconciliation.delivery.v1",
                   "source_run_identity":report["run_identity"],
                   "files":[{"path":p.relative_to(migration).as_posix(),"bytes":p.stat().st_size,
                             "sha256":file_digest(p)} for p in sorted(migration.rglob("*")) if p.is_file()]})
        os.rename(case,output)
        return {"output":str(output),"source_run_identity":report["run_identity"],
                "comparison_records":writer.count,"pairs":len(result["pairs"])}
    finally:
        shutil.rmtree(stage,ignore_errors=True)

def verify_case(run_directory):
    root = Path(run_directory).resolve()
    report = read_json(root/"report.json")
    verify_original_sources(root,report)
    migration = root/"migration"
    delivery = read_json(migration/"delivery.json")
    require(delivery.get("schema")=="tjlabs.migration-reconciliation.delivery.v1" and
            delivery["source_run_identity"]==report["run_identity"],"Wrong migration delivery identity")
    declared = delivery["files"]
    names = [x["path"] for x in declared]
    actual = [p.relative_to(migration).as_posix() for p in migration.rglob("*") if p.is_file() and p != migration/"delivery.json"]
    require(len(names)==len(set(names)) and set(names)==set(actual),"Complete migration member set changed")
    for item in declared:
        p = migration/safe_relative(item["path"])
        require(p.is_file() and not p.is_symlink() and p.resolve().is_relative_to(migration.resolve()) and
                p.stat().st_size==item["bytes"] and file_digest(p)==item["sha256"],
                "Migration member changed: "+item["path"])
    selection_bytes = (migration/"selection.original.json").read_bytes()
    selection = parse_json_bytes(selection_bytes)
    result = read_json(migration/"result.json")
    require(selection==read_json(migration/"selection.json"),"Original and normalized interpretation differ")
    require(result["schema"]==RESULT and result["source_run_identity"]==report["run_identity"] and
            result["source_inputs"]==report["lineage"]["inputs"] and
            result["selection_sha256"]==digest(json_bytes(selection)) and
            result["selection_original_sha256"]==digest(selection_bytes),"Migration source/selection binding changed")
    return root,report,result

def pack_migration(run_directory,destination):
    root,report,result = verify_case(run_directory)
    here = Path(__file__).resolve().parent
    selected = {r["path"]:r for r in result["recipe_files"]}
    require(set(selected)=={"migration_reconciliation.py","migration_report.py","migration_server.py"},
            "Restore complete original application source")
    for name,identity in selected.items():
        require((here/name).is_file() and (here/name).stat().st_size==identity["bytes"] and
                file_digest(here/name)==identity["sha256"],"Selected source changed after calculation: "+name)
    required = ("discovery_engine.py","discovery_cli.py","README.md","OPERATOR_GUIDE.md",
                "migration_reconciliation.py","migration_report.py","migration_server.py",
                "MIGRATION_RECONCILIATION.md","MIGRATION_SELECTION_API.json","MIGRATION_HTTP_API.json",
                "MIGRATION_RESULT_API.json","MIGRATION_SOURCE_PROVENANCE.json","LICENSE")
    require(all((here/n).is_file() for n in required),"Complete source and operating guides are required")
    return create_handover(root,destination,[here/n for n in required])

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command",required=True)
    run = commands.add_parser("run")
    run.add_argument("--manifest",required=True)
    run.add_argument("--selection",required=True)
    run.add_argument("--output",required=True)
    run.add_argument("--input-root")
    pack = commands.add_parser("pack")
    pack.add_argument("--run",required=True)
    pack.add_argument("--output",required=True)
    receive = commands.add_parser("receive")
    receive.add_argument("--archive",required=True)
    receive.add_argument("--output",required=True)
    args = parser.parse_args(argv)
    try:
        if args.command=="run":
            answer = run_migration(args.manifest,args.selection,args.output,args.input_root)
        elif args.command=="pack":
            answer = pack_migration(args.run,args.output)
        else:
            answer = receive_handover(args.archive,args.output)
        print(json.dumps({"status":"COMPLETE",**answer},ensure_ascii=False))
        return 0
    except (DiscoveryError,ValueError,OSError,sqlite3.Error,KeyError,TypeError) as error:
        print(json.dumps({"status":"ERROR","type":type(error).__name__,"message":str(error)},ensure_ascii=False))
        return 2

if __name__=="__main__":
    raise SystemExit(main())
