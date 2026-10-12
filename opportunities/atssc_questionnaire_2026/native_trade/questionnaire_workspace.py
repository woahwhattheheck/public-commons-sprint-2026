"""Persistent questionnaire editions, respondent revisions and disclosure reports."""
from __future__ import annotations

import base64
import csv
import hashlib
import html
import io
import json
import os
import re
import secrets
import sqlite3
import tempfile
import uuid
import zipfile
from contextlib import contextmanager
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from urllib.parse import urlparse

from workbooks import cell_parts, cell_value, col_letters, col_number, read_xlsx, workbook_diff

ID = re.compile(r"^[A-Za-z][A-Za-z0-9_.-]{0,79}$")
KINDS = {"text","number","integer","date","boolean","choice","table"}
SOURCE = Path(__file__).resolve().parent


class OperationError(ValueError):
    def __init__(self, code, message, detail=None):
        super().__init__(message)
        self.code, self.detail = code, detail


def now():
    return datetime.now(timezone.utc).isoformat()


def encoded(value):
    return json.dumps(value,ensure_ascii=False,separators=(",",":"),sort_keys=True)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def identifier():
    return str(uuid.uuid4())


def decimal(value):
    if isinstance(value,bool) or value in (None,""):
        raise OperationError("NUMBER_REQUIRED","A finite number is required")
    try:
        result = Decimal(str(value))
    except InvalidOperation:
        raise OperationError("NUMBER_REQUIRED","A finite number is required")
    if not result.is_finite() or len(str(value)) > 120:
        raise OperationError("NUMBER_REQUIRED","A finite number is required")
    return result


def plain(value):
    if isinstance(value,Decimal):
        return format(value,"f")
    if isinstance(value,list):
        return [plain(x) for x in value]
    if isinstance(value,dict):
        return {k:plain(v) for k,v in value.items()}
    return value


def csv_safe(value):
    text = "" if value is None else str(value)
    if text.lstrip().startswith(("=","+","-","@")):
        try:
            decimal(text)
        except OperationError:
            return "'"+text
    return text


def scalar(field,value):
    if value is None or value == "":
        if field.get("required"):
            raise OperationError("REQUIRED","An answer is required")
        return None
    kind = field["kind"]
    if kind in {"number","integer"}:
        number = decimal(value)
        if kind == "integer" and number != number.to_integral_value():
            raise OperationError("INTEGER_REQUIRED","A whole number is required")
        if "minimum" in field and number < decimal(field["minimum"]):
            raise OperationError("MINIMUM",f"Answer must be at least {field['minimum']}")
        if "maximum" in field and number > decimal(field["maximum"]):
            raise OperationError("MAXIMUM",f"Answer must be at most {field['maximum']}")
        return format(number,"f")
    if kind == "boolean":
        if value not in (True,False,"true","false","1","0") or type(value) is int:
            raise OperationError("BOOLEAN_REQUIRED","Choose true or false")
        return value is True or value in ("true","1")
    if kind == "date":
        try:
            return date.fromisoformat(str(value)).isoformat()
        except ValueError:
            raise OperationError("DATE_REQUIRED","Use an ISO date, YYYY-MM-DD")
    if not isinstance(value,str):
        raise OperationError("TEXT_REQUIRED","A text answer is required")
    if len(value) > int(field.get("max_length",10000)):
        raise OperationError("TEXT_LENGTH","Answer exceeds the field length")
    if kind == "choice" and value not in field.get("choices",[]):
        raise OperationError("CHOICE_REQUIRED","Choose a listed answer")
    return value


def expression(node,values,depth=0):
    if depth > 25 or not isinstance(node,dict):
        raise OperationError("EXPRESSION","Invalid calculation expression")
    if "field" in node:
        if node["field"] not in values:
            raise OperationError("CALCULATION_INPUT",f"Missing calculation input: {node['field']}")
        return values[node["field"]]
    if "constant" in node:
        return node["constant"]
    op = node.get("op")
    if op == "table_sum":
        rows = values.get(node.get("table"))
        if not isinstance(rows,list):
            raise OperationError("CALCULATION_INPUT","A table answer is required")
        column = node.get("column")
        numbers = [decimal(row[column]) for row in rows if row.get(column) is not None]
        return sum(numbers,Decimal(0)) if numbers else None
    args = [expression(x,values,depth+1) for x in node.get("args",[])]
    if op in {"equal","not_equal"} and len(args) == 2:
        try:
            a,b = decimal(args[0]),decimal(args[1])
        except OperationError:
            a,b = args
        return (a == b) if op == "equal" else (a != b)
    if op in {"and","or"} and args:
        if any(type(x) is not bool for x in args):
            raise OperationError("EXPRESSION","Logical operands must be true or false")
        return all(args) if op == "and" else any(args)
    if op == "not" and len(args) == 1 and type(args[0]) is bool:
        return not args[0]
    numbers = [decimal(x) for x in args]
    if op == "add" and numbers:
        return sum(numbers,Decimal(0))
    if op in {"subtract","multiply","divide","less_equal","greater_equal","less","greater"} and len(numbers) == 2:
        a,b = numbers
        if op == "subtract": return a-b
        if op == "multiply": return a*b
        if op == "divide":
            if b == 0: raise OperationError("DIVISION_BY_ZERO","Calculation denominator is zero")
            return a/b
        if op == "less_equal": return a<=b
        if op == "greater_equal": return a>=b
        if op == "less": return a<b
        if op == "greater": return a>b
    raise OperationError("EXPRESSION","Unknown or invalid calculation operation")


def expression_refs(node):
    if not isinstance(node,dict):
        raise OperationError("EXPRESSION","Calculation expressions must be objects")
    if "field" in node: return {node["field"]}
    if "constant" in node: return set()
    if node.get("op") == "table_sum": return {node.get("table")}
    if node.get("op") not in {"add","subtract","multiply","divide","equal","not_equal","less_equal","greater_equal","less","greater","and","or","not"}:
        raise OperationError("EXPRESSION","Unknown calculation operation")
    if not isinstance(node.get("args"),list) or len(node["args"]) > 100:
        raise OperationError("EXPRESSION","Invalid calculation operands")
    result = set()
    for child in node["args"]: result.update(expression_refs(child))
    return result


def validate_definition(definition):
    if not isinstance(definition,dict) or not isinstance(definition.get("questions"),list) or not 1 <= len(definition["questions"]) <= 3000:
        raise OperationError("DEFINITION","Define between 1 and 3,000 questions")
    known = set()
    for field in definition["questions"]:
        if not isinstance(field,dict) or not ID.fullmatch(str(field.get("id",""))) or field["id"] in known:
            raise OperationError("DEFINITION","Every question needs a unique stable identifier")
        known.add(field["id"])
        if field.get("kind") not in KINDS or not isinstance(field.get("label"),str) or not field["label"].strip():
            raise OperationError("DEFINITION","Every question needs a label and supported answer type")
        if field.get("disclosure","protected") not in {"public","protected"}:
            raise OperationError("DEFINITION","Choose public or protected disclosure for every question")
        if field["kind"] == "choice" and (not isinstance(field.get("choices"),list) or not field["choices"] or any(not isinstance(x,str) for x in field["choices"])):
            raise OperationError("DEFINITION","Choice questions need text choices")
        if "minimum" in field: decimal(field["minimum"])
        if "maximum" in field: decimal(field["maximum"])
        if "minimum" in field and "maximum" in field and decimal(field["minimum"]) > decimal(field["maximum"]):
            raise OperationError("DEFINITION","The minimum must not exceed the maximum")
        if field["kind"] == "table":
            columns = field.get("columns",[])
            if not isinstance(columns,list) or not 1 <= len(columns) <= 100:
                raise OperationError("DEFINITION","Table questions need 1 to 100 answer columns")
            column_ids = set()
            for column in columns:
                if not isinstance(column,dict) or not ID.fullmatch(str(column.get("id",""))) or column["id"] in column_ids or column.get("kind") not in KINDS-{ "table" }:
                    raise OperationError("DEFINITION","Table columns need unique identifiers and scalar answer types")
                column_ids.add(column["id"])
                if not isinstance(column.get("label"),str) or not column["label"].strip():
                    raise OperationError("DEFINITION","Every table column needs a label")
                if column.get("disclosure",field.get("disclosure","protected")) not in {"public","protected"}:
                    raise OperationError("DEFINITION","Table column disclosure must be public or protected")
    computations = {q["id"]:q["calculation"] for q in definition["questions"] if "calculation" in q}
    dependencies = {}
    for name,node in computations.items():
        refs = expression_refs(node)
        if not refs <= known: raise OperationError("DEFINITION",f"Unknown calculation input for {name}")
        dependencies[name] = refs & set(computations)
    remaining = dict(dependencies)
    while remaining:
        ready = [k for k,v in remaining.items() if not v & set(remaining)]
        if not ready: raise OperationError("DEFINITION","Question calculations contain a cycle")
        for key in ready: remaining.pop(key)
    for rule in definition.get("rules",[]):
        if not ID.fullmatch(str(rule.get("id",""))) or not rule.get("message") or not expression_refs(rule.get("when")) <= known:
            raise OperationError("DEFINITION","Validation rules need identifiers, messages and known question references")
    return definition


def validate_answers(definition,answers):
    questions = {x["id"]:x for x in definition["questions"]}
    values,issues = {},[]
    if not isinstance(answers,dict):
        raise OperationError("ANSWERS","Answers must be an object keyed by question identifier")
    for key in set(answers)-set(questions):
        issues.append({"field":key,"code":"UNKNOWN_FIELD","message":"Answer has no question in this published edition"})
    for key,field in questions.items():
        if "calculation" in field:
            if key in answers:
                issues.append({"field":key,"code":"CALCULATED_FIELD","message":"Calculated questions are read-only"})
            continue
        try:
            if field["kind"] != "table":
                values[key] = scalar(field,answers.get(key))
                continue
            rows = answers.get(key,[])
            if not isinstance(rows,list) or len(rows) > int(field.get("max_rows",10000)):
                raise OperationError("TABLE_REQUIRED","Provide a table within its configured row limit")
            if field.get("required") and not rows:
                raise OperationError("REQUIRED","At least one table row is required")
            columns = {c["id"]:c for c in field["columns"]}
            result = []
            for index,row in enumerate(rows):
                if not isinstance(row,dict) or set(row)-set(columns):
                    raise OperationError("TABLE_ROW","A table row contains unknown columns")
                item = {}
                for column,column_field in columns.items():
                    try: item[column] = scalar(column_field,row.get(column))
                    except OperationError as e: issues.append({"field":key,"row":index,"column":column,"code":e.code,"message":str(e)})
                result.append(item)
            values[key] = result
        except OperationError as e:
            issues.append({"field":key,"code":e.code,"message":str(e)})
    pending = {q["id"]:q for q in questions.values() if "calculation" in q}
    while pending:
        progressed = False
        for key,field in list(pending.items()):
            if expression_refs(field["calculation"]) & set(pending): continue
            try: values[key] = scalar(field,plain(expression(field["calculation"],values)))
            except OperationError as e: issues.append({"field":key,"code":e.code,"message":str(e)})
            pending.pop(key)
            progressed = True
        if not progressed: raise OperationError("DEFINITION","Question calculations contain a cycle")
    for rule in definition.get("rules",[]):
        try:
            outcome = expression(rule["when"],values)
            if type(outcome) is not bool: raise OperationError("EXPRESSION","A validation rule must return true or false")
            if not outcome: issues.append({"rule":rule["id"],"code":"RULE","message":rule["message"]})
        except OperationError as e: issues.append({"rule":rule["id"],"code":e.code,"message":str(e)})
    return {"valid":not issues,"issues":issues,"values":plain(values)}


class Workspace:
    def __init__(self,directory):
        self.directory = Path(directory).expanduser().resolve()
        self.directory.mkdir(parents=True,exist_ok=True,mode=0o700)
        self.db_path = self.directory/"questionnaires.sqlite3"
        with self.connection() as db:
            db.executescript("""
            CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS workbooks(sha TEXT PRIMARY KEY,name TEXT NOT NULL,source_url TEXT,created TEXT NOT NULL,summary TEXT NOT NULL,bytes BLOB NOT NULL);
            CREATE TABLE IF NOT EXISTS questionnaires(id TEXT PRIMARY KEY,name TEXT NOT NULL,version INTEGER NOT NULL,created TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS definitions(questionnaire_id TEXT NOT NULL,version INTEGER NOT NULL,definition TEXT NOT NULL,created TEXT NOT NULL,PRIMARY KEY(questionnaire_id,version),FOREIGN KEY(questionnaire_id) REFERENCES questionnaires(id));
            CREATE TABLE IF NOT EXISTS publications(id TEXT PRIMARY KEY,questionnaire_id TEXT NOT NULL,definition_version INTEGER NOT NULL,created TEXT NOT NULL,FOREIGN KEY(questionnaire_id,definition_version) REFERENCES definitions(questionnaire_id,version));
            CREATE TABLE IF NOT EXISTS respondents(id TEXT PRIMARY KEY,publication_id TEXT NOT NULL,name TEXT NOT NULL,key_hash TEXT NOT NULL,version INTEGER NOT NULL,accepted_revision TEXT,status TEXT NOT NULL,created TEXT NOT NULL,FOREIGN KEY(publication_id) REFERENCES publications(id));
            CREATE TABLE IF NOT EXISTS revisions(id TEXT PRIMARY KEY,respondent_id TEXT NOT NULL,number INTEGER NOT NULL,answers TEXT NOT NULL,validation TEXT NOT NULL,workbook_sha TEXT,comparison TEXT,created TEXT NOT NULL,UNIQUE(respondent_id,number),FOREIGN KEY(respondent_id) REFERENCES respondents(id),FOREIGN KEY(workbook_sha) REFERENCES workbooks(sha));
            CREATE TABLE IF NOT EXISTS reviews(id TEXT PRIMARY KEY,revision_id TEXT NOT NULL,decision TEXT NOT NULL,note TEXT NOT NULL,created TEXT NOT NULL,FOREIGN KEY(revision_id) REFERENCES revisions(id));
            CREATE TABLE IF NOT EXISTS reports(id TEXT PRIMARY KEY,publication_id TEXT NOT NULL,edition TEXT NOT NULL,created TEXT NOT NULL,released INTEGER NOT NULL DEFAULT 0,release_note TEXT,FOREIGN KEY(publication_id) REFERENCES publications(id));
            CREATE TABLE IF NOT EXISTS journal(sequence INTEGER PRIMARY KEY AUTOINCREMENT,method TEXT NOT NULL,identity TEXT NOT NULL,detail TEXT NOT NULL,created TEXT NOT NULL);
            """)
            if not db.execute("SELECT 1 FROM settings WHERE key='workspace_id'").fetchone():
                db.execute("INSERT INTO settings VALUES('workspace_id',?)",(identifier(),))
                key_path = self.directory/"operator-key.txt"
                key = key_path.read_text().strip() if key_path.exists() else secrets.token_urlsafe(36)
                if len(key) < 30:
                    raise OperationError("WORKSPACE_KEY","The retained operator access code is invalid")
                db.execute("INSERT INTO settings VALUES('operator_key_hash',?)",(digest(key.encode()),))
                if not key_path.exists(): self._private_file("operator-key.txt",key+"\n")
            db.commit()
        os.chmod(self.db_path,0o600)
        from respondent_operations import RespondentOperations
        self.outreach = RespondentOperations(self)

    @contextmanager
    def connection(self):
        db = sqlite3.connect(self.db_path,timeout=30)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        try: yield db
        finally: db.close()

    def _private_file(self,name,text):
        path = self.directory/name
        fd = os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(fd,"w",encoding="utf-8") as out:
            out.write(text)
            out.flush()
            os.fsync(out.fileno())

    def _row(self,db,table,key):
        allowed = {"questionnaires","publications","respondents","revisions","reports"}
        if table not in allowed: raise OperationError("INTERNAL","Unknown record type")
        row = db.execute(f"SELECT * FROM {table} WHERE id=?",(key,)).fetchone()
        if row is None: raise OperationError("NOT_FOUND",f"{table} record was not found")
        return dict(row)

    def _definition(self,db,publication_id):
        publication = self._row(db,"publications",publication_id)
        row = db.execute("SELECT definition FROM definitions WHERE questionnaire_id=? AND version=?",(publication["questionnaire_id"],publication["definition_version"])).fetchone()
        return publication,json.loads(row[0])

    def authorize(self,key,respondent_id=None):
        if not isinstance(key,str): return False
        with self.connection() as db:
            if respondent_id:
                row = db.execute("SELECT key_hash FROM respondents WHERE id=?",(respondent_id,)).fetchone()
            else:
                row = db.execute("SELECT value FROM settings WHERE key='operator_key_hash'").fetchone()
            return bool(row and secrets.compare_digest(row[0],digest(key.encode())))

    def workbook(self,sha):
        with self.connection() as db:
            row = db.execute("SELECT name,source_url,summary FROM workbooks WHERE sha=?",(sha,)).fetchone()
            if not row: raise OperationError("NOT_FOUND","Original workbook is not retained")
            return {**json.loads(row["summary"]),"name":row["name"],"source_url":row["source_url"]}

    def invoke(self,method,params=None):
        params = params or {}
        if isinstance(method,str) and method.startswith("outreach."):
            return self.outreach.invoke(method[len("outreach."):],params)
        function = getattr(self,"op_"+method,None)
        if function is None or not callable(function): raise OperationError("METHOD","Unknown native operation")
        return function(params)

    def _write(self,method,key,detail,action):
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            try:
                result = action(db)
                db.execute("INSERT INTO journal(method,identity,detail,created) VALUES(?,?,?,?)",(method,key,encoded(detail),now()))
                db.commit()
                return result
            except BaseException:
                db.rollback()
                raise

    def op_status(self,p):
        with self.connection() as db:
            return {"workspace_id":db.execute("SELECT value FROM settings WHERE key='workspace_id'").fetchone()[0],"questionnaires":[dict(x) for x in db.execute("SELECT * FROM questionnaires ORDER BY created")],"publications":[dict(x) for x in db.execute("SELECT * FROM publications ORDER BY created")],"workbooks":[dict(x) for x in db.execute("SELECT sha,name,source_url,created FROM workbooks ORDER BY created")],"respondents":[{k:v for k,v in dict(x).items() if k != 'key_hash'} for x in db.execute("SELECT * FROM respondents ORDER BY created")],"reports":[{k:v for k,v in dict(x).items() if k != 'edition'} for x in db.execute("SELECT * FROM reports ORDER BY created")],"journal_entries":db.execute("SELECT COUNT(*) FROM journal").fetchone()[0]}

    def op_import_workbook(self,p):
        try: data = base64.b64decode(p["data_base64"],validate=True)
        except (KeyError,ValueError): raise OperationError("WORKBOOK","Provide original workbook bytes as base64")
        book = read_xlsx(data)
        if p.get("expected_sha256") and book["sha256"] != p["expected_sha256"]:
            raise OperationError("SOURCE_HASH","Original workbook SHA256 does not match")
        name = Path(str(p.get("name","workbook.xlsx"))).name
        if not name.lower().endswith(".xlsx"): raise OperationError("WORKBOOK","An XLSX filename is required")
        source_url = p.get("source_url")
        if source_url and (urlparse(source_url).scheme not in {"http","https"} or not urlparse(source_url).hostname):
            raise OperationError("SOURCE_URL","Use the original HTTP or HTTPS source URL")
        def action(db):
            db.execute("INSERT OR IGNORE INTO workbooks VALUES(?,?,?,?,?,?)",(book["sha256"],name,source_url,now(),encoded(book),data))
            return {k:book[k] for k in ("sha256","bytes","sheetCount","cellCount","formulaCount","externalLinks","macroMembers")}
        return self._write("import_workbook",book["sha256"],{"name":name},action)

    def op_inspect_workbook(self,p):
        book = self.workbook(p["sha256"])
        if not p.get("sheet"):
            return {**{k:v for k,v in book.items() if k != 'sheets'},"sheets":[{k:v for k,v in s.items() if k != 'cells'}|{"cellCount":len(s['cells'])} for s in book['sheets']]}
        for sheet in book["sheets"]:
            if sheet["name"] == p["sheet"]:
                cells = sheet["cells"]
                if p.get("cells"): cells = {c:cells.get(c) for c in p["cells"]}
                return {**sheet,"cells":cells}
        raise OperationError("NOT_FOUND","Original worksheet was not found")

    def op_compare_workbooks(self,p):
        return workbook_diff(self.workbook(p["before_sha256"]),self.workbook(p["after_sha256"]))

    def op_create_questionnaire(self,p):
        name = str(p.get("name","")).strip()
        if not name: raise OperationError("NAME","A questionnaire name is required")
        key = identifier()
        def action(db):
            db.execute("INSERT INTO questionnaires VALUES(?,?,0,?)",(key,name,now()))
            return {"questionnaire_id":key,"version":0,"name":name}
        return self._write("create_questionnaire",key,{"name":name},action)

    def op_save_definition(self,p):
        definition = validate_definition(p["definition"])
        for sha in definition.get("source_workbooks",[]): self.workbook(sha)
        for field in definition["questions"]:
            binding = field.get("source")
            if not binding: continue
            if binding.get("workbook_sha256") not in definition.get("source_workbooks",[]):
                raise OperationError("DEFINITION","Every binding must name a retained source workbook in this definition")
            book = self.workbook(binding["workbook_sha256"])
            if binding.get("sheet") not in {s["name"] for s in book["sheets"]}:
                raise OperationError("DEFINITION","A question binding names an absent original worksheet")
            if field["kind"] == "table":
                for column in field["columns"]:
                    if "source_column" not in column: raise OperationError("DEFINITION","Bound table columns need their original workbook column")
                    cell_parts(str(column["source_column"])+"1")
                start,end = int(binding.get("start_row",0)),int(binding.get("end_row",0))
                if start < 1 or end < start or end > 1048576 or end-start > 10000:
                    raise OperationError("DEFINITION","Bound table row range is invalid")
            else: cell_parts(binding.get("cell",""))
        key = p["questionnaire_id"]
        def action(db):
            current = self._row(db,"questionnaires",key)
            if current["version"] != p.get("expected_version"):
                raise OperationError("VERSION_CONFLICT","The questionnaire definition changed; reopen its current edition",{"current_version":current["version"]})
            version = current["version"]+1
            db.execute("INSERT INTO definitions VALUES(?,?,?,?)",(key,version,encoded(definition),now()))
            db.execute("UPDATE questionnaires SET version=? WHERE id=?",(version,key))
            return {"questionnaire_id":key,"version":version,"definition":definition}
        return self._write("save_definition",key,{"expected_version":p.get("expected_version")},action)

    def op_get_definition(self,p):
        with self.connection() as db:
            questionnaire = self._row(db,"questionnaires",p["questionnaire_id"])
            version = p.get("version",questionnaire["version"])
            row = db.execute("SELECT definition,created FROM definitions WHERE questionnaire_id=? AND version=?",(questionnaire["id"],version)).fetchone()
            if row is None: raise OperationError("NOT_FOUND","The questionnaire has no saved definition at that version")
            return {"questionnaire_id":questionnaire["id"],"name":questionnaire["name"],"version":version,"definition":json.loads(row[0]),"created":row[1]}

    def op_publish(self,p):
        key = identifier()
        def action(db):
            questionnaire = self._row(db,"questionnaires",p["questionnaire_id"])
            if questionnaire["version"] != p.get("expected_version") or questionnaire["version"] < 1:
                raise OperationError("VERSION_CONFLICT","Publish the current saved definition version")
            db.execute("INSERT INTO publications VALUES(?,?,?,?)",(key,questionnaire["id"],questionnaire["version"],now()))
            return {"publication_id":key,"questionnaire_id":questionnaire["id"],"definition_version":questionnaire["version"]}
        return self._write("publish",key,{"questionnaire_id":p["questionnaire_id"]},action)

    def _invite_record(self,db,p,key,access):
        name = str(p.get("name","")).strip()
        if not name: raise OperationError("NAME","A respondent name is required")
        self._row(db,"publications",p["publication_id"])
        db.execute("INSERT INTO respondents VALUES(?,?,?,?,0,NULL,'invited',?)",(key,p["publication_id"],name,digest(access.encode()),now()))
        return {"respondent_id":key,"publication_id":p["publication_id"],"name":name,"version":0,"access_code":access,"entry_path":"/respondent/"+key}

    def op_invite(self,p):
        key,access = identifier(),secrets.token_urlsafe(30)
        name = str(p.get("name","")).strip()
        if not name: raise OperationError("NAME","A respondent name is required")
        def action(db):
            return self._invite_record(db,p,key,access)
        result = self._write("invite",key,{"publication_id":p["publication_id"],"name":name},action)
        self._private_file("respondent-"+key+".json",json.dumps(result,ensure_ascii=False,indent=2)+"\n")
        return result

    def op_get_respondent(self,p):
        with self.connection() as db:
            respondent = self._row(db,"respondents",p["respondent_id"])
            publication,definition = self._definition(db,respondent["publication_id"])
            revisions = [dict(x) for x in db.execute("SELECT * FROM revisions WHERE respondent_id=? ORDER BY number",(respondent["id"],))]
            for revision in revisions:
                for field in ("answers","validation","comparison"):
                    if revision[field] is not None: revision[field] = json.loads(revision[field])
                revision["reviews"] = [dict(x) for x in db.execute("SELECT * FROM reviews WHERE revision_id=? ORDER BY created",(revision["id"],))]
            return {"respondent":{k:v for k,v in respondent.items() if k != 'key_hash'},"publication":publication,"definition":definition,"revisions":revisions}

    def op_workbook_answers(self,p):
        with self.connection() as db:
            respondent = self._row(db,"respondents",p["respondent_id"])
            _,definition = self._definition(db,respondent["publication_id"])
        book = self.workbook(p["sha256"])
        answers,issues = {},[]
        for field in definition["questions"]:
            binding = field.get("source")
            if not binding or "calculation" in field: continue
            try:
                if field["kind"] == "table":
                    rows = []
                    for row in range(int(binding["start_row"]),int(binding["end_row"])+1):
                        values = {c["id"]:cell_value(book,binding["sheet"],c["source_column"]+str(row)) for c in field["columns"]}
                        if any(v is not None and v != "" for v in values.values()): rows.append(values)
                    answers[field["id"]] = rows
                else: answers[field["id"]] = cell_value(book,binding["sheet"],binding["cell"])
            except ValueError as e: issues.append({"field":field["id"],"code":"WORKBOOK_BINDING","message":str(e)})
        validation = validate_answers(definition,answers)
        if issues:
            validation["issues"].extend(issues)
            validation["valid"] = False
        return {"respondent_id":respondent["id"],"workbook_sha256":book["sha256"],"answers":answers,"validation":validation}

    def op_submit_revision(self,p):
        key = identifier()
        if p.get("workbook_sha256"):
            extracted = self.op_workbook_answers({"respondent_id":p["respondent_id"],"sha256":p["workbook_sha256"]})
            answers = extracted["answers"]
            if p.get("answers") is not None: raise OperationError("ANSWERS","Choose either native answers or a retained workbook revision")
        else: answers = p.get("answers",{})
        def action(db):
            respondent = self._row(db,"respondents",p["respondent_id"])
            if respondent["version"] != p.get("expected_version"):
                raise OperationError("VERSION_CONFLICT","This respondent has a newer revision; reopen before submitting",{"current_version":respondent["version"]})
            _,definition = self._definition(db,respondent["publication_id"])
            validation = validate_answers(definition,answers)
            previous = db.execute("SELECT * FROM revisions WHERE respondent_id=? ORDER BY number DESC LIMIT 1",(respondent["id"],)).fetchone()
            before = {} if previous is None else json.loads(previous["validation"])["values"]
            changes = [{"field":k,"before":before.get(k),"after":validation["values"].get(k)} for k in sorted(set(before)|set(validation["values"])) if before.get(k) != validation["values"].get(k)]
            comparison = {"answerChanges":changes,"answerChangeCount":len(changes)}
            if p.get("workbook_sha256") and previous is not None and previous["workbook_sha"]:
                comparison["workbook"] = workbook_diff(self.workbook(previous["workbook_sha"]),self.workbook(p["workbook_sha256"]))
            number = respondent["version"]+1
            db.execute("INSERT INTO revisions VALUES(?,?,?,?,?,?,?,?)",(key,respondent["id"],number,encoded(answers),encoded(validation),p.get("workbook_sha256"),encoded(comparison),now()))
            db.execute("UPDATE respondents SET version=?,status='received' WHERE id=?",(number,respondent["id"]))
            return {"revision_id":key,"respondent_id":respondent["id"],"number":number,"validation":validation,"comparison":comparison}
        return self._write("submit_revision",key,{"respondent_id":p["respondent_id"],"workbook_sha256":p.get("workbook_sha256")},action)

    def op_review_revision(self,p):
        decision = p.get("decision")
        if decision not in {"accept","changes_requested"}: raise OperationError("DECISION","Choose accept or changes_requested")
        def action(db):
            revision = self._row(db,"revisions",p["revision_id"])
            respondent = self._row(db,"respondents",revision["respondent_id"])
            if respondent["version"] != p.get("expected_version") or revision["number"] != respondent["version"]:
                raise OperationError("VERSION_CONFLICT","Review the latest respondent revision")
            validation = json.loads(revision["validation"])
            if decision == "accept" and not validation["valid"]:
                raise OperationError("VALIDATION","Resolve the revision's validation errors before accepting it",validation["issues"])
            review_id = identifier()
            db.execute("INSERT INTO reviews VALUES(?,?,?,?,?)",(review_id,revision["id"],decision,str(p.get("note","")),now()))
            if decision == "accept": db.execute("UPDATE respondents SET accepted_revision=?,status='accepted' WHERE id=?",(revision["id"],respondent["id"]))
            else: db.execute("UPDATE respondents SET status='changes_requested' WHERE id=?",(respondent["id"],))
            return {"review_id":review_id,"revision_id":revision["id"],"decision":decision,"accepted_revision":revision["id"] if decision == 'accept' else respondent["accepted_revision"]}
        return self._write("review_revision",p["revision_id"],{"decision":decision},action)

    def op_create_report(self,p):
        key = identifier()
        def action(db):
            publication,definition = self._definition(db,p["publication_id"])
            responses = []
            for row in db.execute("SELECT r.id,r.name,r.status,r.version,r.accepted_revision,v.number,v.validation,v.workbook_sha FROM respondents r JOIN revisions v ON v.id=r.accepted_revision WHERE r.publication_id=? ORDER BY r.created",(publication["id"],)):
                responses.append({"respondent_id":row["id"],"name":row["name"],"status":row["status"],"latest_version":row["version"],"revision_id":row["accepted_revision"],"accepted_number":row["number"],"workbook_sha256":row["workbook_sha"],"values":json.loads(row["validation"])["values"]})
            protected = {"schema":"atssc.report.protected.v1","report_id":key,"publication":publication,"definition":definition,"created":now(),"accepted_responses":responses}
            public_questions = []
            for q in definition["questions"]:
                if q.get("disclosure","protected") != "public": continue
                item = {k:q[k] for k in ("id","label","kind","unit") if k in q}
                if q["kind"] == "table":
                    item["columns"] = [{k:c[k] for k in ("id","label","kind","unit") if k in c} for c in q["columns"] if c.get("disclosure",q.get("disclosure","protected")) == "public"]
                public_questions.append(item)
            public_responses = []
            for index,response in enumerate(responses,1):
                values = {}
                for field in public_questions:
                    value = response["values"].get(field["id"])
                    if field["kind"] == "table" and value is not None:
                        columns = {c["id"] for c in field["columns"]}
                        value = [{k:v for k,v in row.items() if k in columns} for row in value]
                    values[field["id"]] = value
                public_responses.append({"response_number":index,"values":values})
            public = {"schema":"atssc.report.public.v1","report_id":key,"created":protected["created"],"questionnaire_title":definition.get("title","Questionnaire"),"questions":public_questions,"accepted_responses":public_responses}
            for edition,questions,records in ((public,public_questions,public_responses),(protected,definition["questions"],responses)):
                totals = {}
                for field in questions:
                    if field["kind"] not in {"number","integer"}: continue
                    numbers = [decimal(r["values"][field["id"]]) for r in records if r["values"].get(field["id"]) is not None]
                    totals[field["id"]] = {"answered":len(numbers),"sum":format(sum(numbers,Decimal(0)),"f") if numbers else None,"unit":field.get("unit")}
                edition["numeric_totals"] = totals
            edition = {"protected":protected,"public":public}
            db.execute("INSERT INTO reports VALUES(?,?,?, ?,0,NULL)",(key,publication["id"],encoded(edition),now()))
            return {"report_id":key,"accepted_respondents":len(responses),"public_questions":len(public_questions),"protected_questions":len(definition["questions"]),"released":False,"edition":edition}
        return self._write("create_report",key,{"publication_id":p["publication_id"]},action)

    def op_get_report(self,p):
        with self.connection() as db:
            report = self._row(db,"reports",p["report_id"])
            return {**report,"edition":json.loads(report["edition"])}

    def op_release_report(self,p):
        note = str(p.get("note","")).strip()
        if not note: raise OperationError("DISCLOSURE_REVIEW","Record the public disclosure review note")
        def action(db):
            report = self._row(db,"reports",p["report_id"])
            db.execute("UPDATE reports SET released=1,release_note=? WHERE id=?",(note,report["id"]))
            return {"report_id":report["id"],"released":True,"release_note":note,"public_path":"/public/reports/"+report["id"]}
        return self._write("release_report",p["report_id"],{"note":note},action)

    def public_report(self,report_id):
        result = self.op_get_report({"report_id":report_id})
        if not result["released"]: raise OperationError("NOT_FOUND","Public report was not found")
        return result["edition"]["public"]

    def report_bytes(self,report_id,edition,format_name,public=False):
        if edition not in {"public","protected"}: raise OperationError("EDITION","Choose public or protected report edition")
        report = self.public_report(report_id) if public else self.op_get_report({"report_id":report_id})["edition"][edition]
        if format_name == "json": return (json.dumps(report,ensure_ascii=False,indent=2)+"\n").encode()
        questions = report.get("questions",report.get("definition",{}).get("questions",[]))
        if format_name == "csv":
            out = io.StringIO(newline="")
            writer = csv.writer(out)
            writer.writerow(["response","question","row","column","answer"])
            for index,response in enumerate(report["accepted_responses"],1):
                for question in questions:
                    value = response["values"].get(question["id"])
                    if question["kind"] == "table":
                        for rowno,row in enumerate(value or [],1):
                            for column in question["columns"]: writer.writerow([index,question["id"],rowno,column["id"],csv_safe(row.get(column["id"]))])
                    else: writer.writerow([index,question["id"],"","",csv_safe(value)])
            return out.getvalue().encode("utf-8-sig")
        if format_name == "html":
            title = report.get("questionnaire_title",report.get("definition",{}).get("title","Questionnaire"))
            parts = ["<!doctype html><html lang='en'><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>"+html.escape(title)+"</title><style>body{font:15px system-ui;max-width:1100px;margin:32px auto;padding:0 20px;color:#20252b}table{border-collapse:collapse;width:100%}th,td{padding:9px;border:1px solid #bbb;vertical-align:top;text-align:left}h1{font-size:24px}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><h1>"+html.escape(title)+"</h1><p>"+edition.capitalize()+" report edition. Created "+html.escape(report["created"])+".</p>"]
            for index,response in enumerate(report["accepted_responses"],1):
                parts.append("<h2>Response "+str(index)+"</h2><table><thead><tr><th>Question</th><th>Answer</th></tr></thead><tbody>")
                for question in questions:
                    value = response["values"].get(question["id"])
                    text = json.dumps(value,ensure_ascii=False,indent=2) if isinstance(value,(list,dict)) else "" if value is None else str(value)
                    parts.append("<tr><td>"+html.escape(question["label"])+"</td><td><pre>"+html.escape(text)+"</pre></td></tr>")
                parts.append("</tbody></table>")
            parts.append("</html>")
            return "".join(parts).encode()
        raise OperationError("FORMAT","Choose JSON, CSV or HTML")

    def op_export_report(self,p):
        report = self.op_get_report({"report_id":p["report_id"]})
        directory = Path(p["directory"]).expanduser().resolve()
        directory.mkdir(parents=True,exist_ok=False)
        manifest = {"schema":"atssc.report-files.v1","report_id":report["id"],"released":bool(report["released"]),"files":[]}
        for edition in ("public","protected"):
            for fmt in ("json","csv","html"):
                name = edition+"."+fmt
                data = self.report_bytes(report["id"],edition,fmt)
                (directory/name).write_bytes(data)
                manifest["files"].append({"path":name,"bytes":len(data),"sha256":digest(data),"edition":edition})
        (directory/"manifest.json").write_text(json.dumps(manifest,indent=2)+"\n")
        return {"directory":str(directory),"manifest":manifest}

    def op_backup(self,p):
        path = Path(p["path"]).expanduser().resolve()
        if path.exists(): raise OperationError("DESTINATION_EXISTS","Choose a new backup path")
        path.parent.mkdir(parents=True,exist_ok=True)
        fd,pending = tempfile.mkstemp(prefix=".questionnaire-backup-",dir=path.parent)
        os.close(fd)
        try:
            with self.connection() as source,sqlite3.connect(pending) as destination:
                source.backup(destination)
                if destination.execute("PRAGMA integrity_check").fetchone()[0] != "ok": raise OperationError("BACKUP","SQLite backup failed integrity verification")
            os.chmod(pending,0o600)
            os.link(pending,path)
        finally: Path(pending).unlink(missing_ok=True)
        data = path.read_bytes()
        return {"path":str(path),"bytes":len(data),"sha256":digest(data),"integrity":"ok"}

    def op_export_project(self,p):
        path = Path(p["path"]).expanduser().resolve()
        if path.exists(): raise OperationError("DESTINATION_EXISTS","Choose a new project archive path")
        path.parent.mkdir(parents=True,exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="questionnaire-project-") as temp:
            temp = Path(temp)
            backup = self.op_backup({"path":str(temp/"questionnaires.sqlite3")})
            files = {"workspace/questionnaires.sqlite3":(temp/"questionnaires.sqlite3").read_bytes()}
            for source in sorted(SOURCE.iterdir()):
                if source.is_file() and (source.name == "LICENSE" or source.suffix in {".py",".mjs",".mts",".html",".css",".md",".json"}):
                    files["application/"+source.name] = source.read_bytes()
            for source in self.directory.glob("*.txt"):
                if source.name == "operator-key.txt": files["workspace/"+source.name] = source.read_bytes()
            for source in self.directory.glob("respondent-*.json"):
                files["workspace/"+source.name] = source.read_bytes()
            manifest = {"schema":"atssc.project.v1","workspace_id":self.op_status({})["workspace_id"],"created":now(),"files":[{"path":name,"bytes":len(data),"sha256":digest(data)} for name,data in sorted(files.items())]}
            files["MANIFEST.json"] = (json.dumps(manifest,indent=2)+"\n").encode()
            pending = temp/"project.zip"
            with zipfile.ZipFile(pending,"w",zipfile.ZIP_DEFLATED) as archive:
                for name,data in sorted(files.items()): archive.writestr(name,data)
            with zipfile.ZipFile(pending) as archive:
                if archive.testzip(): raise OperationError("ARCHIVE","Project archive CRC verification failed")
            data = pending.read_bytes()
            fd,staged = tempfile.mkstemp(prefix=".questionnaire-project-",dir=path.parent)
            try:
                with os.fdopen(fd,"wb") as out:
                    out.write(data);out.flush();os.fsync(out.fileno())
                os.chmod(staged,0o600)
                os.link(staged,path)
            finally: Path(staged).unlink(missing_ok=True)
            return {"path":str(path),"bytes":len(data),"sha256":digest(data),"manifest":manifest}


def receive_project(archive_path,destination,expected_sha256=None):
    archive_path,destination = Path(archive_path).resolve(),Path(destination).resolve()
    data = archive_path.read_bytes()
    if expected_sha256 and digest(data) != expected_sha256: raise OperationError("SOURCE_HASH","Project archive SHA256 does not match")
    if destination.exists(): raise OperationError("DESTINATION_EXISTS","Receive into a new workspace directory")
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)): raise OperationError("ARCHIVE","Project contains duplicate member paths")
        manifest = json.loads(archive.read("MANIFEST.json"))
        if manifest.get("schema") != "atssc.project.v1": raise OperationError("ARCHIVE","Unknown project archive format")
        expected = {x["path"] for x in manifest["files"]}|{"MANIFEST.json"}
        if set(names) != expected: raise OperationError("ARCHIVE","Project archive inventory differs from its manifest")
        for member in manifest["files"]:
            name = member["path"]
            if not name or name.startswith("/") or ".." in name.split("/") or "\\" in name: raise OperationError("ARCHIVE","Invalid project member path")
            raw = archive.read(name)
            if len(raw) != member["bytes"] or digest(raw) != member["sha256"]: raise OperationError("ARCHIVE","Project member does not match its manifest")
        with tempfile.TemporaryDirectory(prefix="questionnaire-receive-",dir=destination.parent) as temp:
            temp = Path(temp)
            for member in manifest["files"]:
                path = temp/member["path"]
                path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
                path.write_bytes(archive.read(member["path"]))
                os.chmod(path,0o600)
            with sqlite3.connect(f"file:{temp/'workspace/questionnaires.sqlite3'}?mode=ro&immutable=1",uri=True) as db:
                if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok": raise OperationError("ARCHIVE","Received native database failed integrity verification")
                for sha,raw in db.execute("SELECT sha,bytes FROM workbooks"):
                    if digest(raw) != sha: raise OperationError("ARCHIVE","Received original workbook bytes failed verification")
            os.mkdir(destination,0o700)
            for root in ("application","workspace"):
                os.rename(temp/root,destination/root)
    received_workspace = Workspace(destination/"workspace")
    received_workspace.outreach.verify_sources()
    result = received_workspace.op_status({})
    if result["workspace_id"] != manifest["workspace_id"]: raise OperationError("ARCHIVE","Received native workspace identity changed")
    return {"directory":str(destination),"workspace_id":result["workspace_id"],"integrity":"ok","verified_files":len(manifest["files"]),"sha256":digest(data)}
