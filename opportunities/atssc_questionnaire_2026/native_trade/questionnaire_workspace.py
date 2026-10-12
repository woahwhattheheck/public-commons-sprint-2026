"""Persistent questionnaire editions, respondent revisions and disclosure reports."""
from __future__ import annotations

import base64
import csv
import hashlib
import html
import io
import importlib
import json
import os
import re
import secrets
import sqlite3
import tempfile
import threading
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
EXTENSION_MODULES = ("respondent_operations","reporting_workbench","workbook_calculation")


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


def disclosure_projection(definition,values,disclosures=None,public_confirmed=False,final=True):
    """Project released values without exposing protected inputs or computed derivatives."""
    disclosures = disclosures or {}
    if not isinstance(disclosures,dict):
        raise OperationError("DISCLOSURE","Disclosure choices must be keyed by question identifier")
    questions = {q["id"]:q for q in definition["questions"]}
    if set(disclosures)-set(questions):
        raise OperationError("DISCLOSURE","A disclosure choice names an absent question")
    choices,public_values,alternatives,classifications = {},{},{},{}

    def selected(field,choice,default):
        if not isinstance(choice,dict) or set(choice)-{"classification","public_alternative","cells","derived_from_protected"}:
            raise OperationError("DISCLOSURE","Use a classification and optional public alternative")
        classification = default if choice.get("derived_from_protected") else choice.get("classification",default)
        if classification not in {"public","protected"} or default == "protected" and classification != "protected":
            raise OperationError("DISCLOSURE","A protected field cannot be changed to public; supply a public alternative")
        alternative = choice.get("public_alternative")
        if alternative is not None and (not isinstance(alternative,str) or len(alternative)>10000):
            raise OperationError("DISCLOSURE","A public alternative must be text of at most 10,000 characters")
        if alternative and classification != "protected":
            raise OperationError("DISCLOSURE","Public alternatives accompany protected answers")
        return {"classification":classification,**({"public_alternative":alternative} if alternative else {})}

    for key,field in questions.items():
        default = field.get("disclosure","protected")
        choice = disclosures.get(key,{})
        item = selected(field,choice,default)
        value = values.get(key)
        classifications[key] = item["classification"]
        if item.get("public_alternative"): alternatives[key] = item["public_alternative"]
        if field["kind"] == "table":
            cell_choices = choice.get("cells",[])
            if not isinstance(cell_choices,list) or len(cell_choices)>len(value or []):
                raise OperationError("DISCLOSURE","Table disclosure choices must follow the retained answer rows")
            columns = {c["id"]:c for c in field["columns"]}
            projected,cells = [],[]
            for index,row in enumerate(value or []):
                selected_row = cell_choices[index] if index<len(cell_choices) else {}
                if not isinstance(selected_row,dict) or set(selected_row)-set(columns):
                    raise OperationError("DISCLOSURE","A table disclosure choice names an absent column")
                projected_row,retained_row = {},{}
                for column_id,column in columns.items():
                    column_default = "protected" if item["classification"] == "protected" else column.get("disclosure",default)
                    cell_choice = selected_row.get(column_id,{})
                    if item["classification"] == "protected": cell_choice = {**cell_choice,"classification":"protected"}
                    cell = selected(column,cell_choice,column_default)
                    retained_row[column_id] = cell
                    projected_row[column_id] = row.get(column_id) if cell["classification"] == "public" else None
                projected.append(projected_row)
                cells.append(retained_row)
            item["cells"] = cells
            public_values[key] = projected if item["classification"] == "public" else None
        else:
            if "cells" in choice:
                raise OperationError("DISCLOSURE","Only table answers have cell disclosure choices")
            public_values[key] = value if item["classification"] == "public" else None
        choices[key] = item

    # A public calculated answer must not reveal a protected source answer.
    unresolved = {q["id"]:q for q in definition["questions"] if "calculation" in q}
    while unresolved:
        ready = [k for k,q in unresolved.items() if not expression_refs(q["calculation"]) & set(unresolved)]
        if not ready: raise OperationError("DISCLOSURE","Calculation dependencies contain a cycle")
        for key in ready:
            q = unresolved.pop(key)
            protected = False
            for dependency in expression_refs(q["calculation"]):
                dep = choices[dependency]
                if dep["classification"] == "protected" or any(cell["classification"] == "protected" for row in dep.get("cells",[]) for cell in row.values()):
                    protected = True
            if protected:
                choices[key]["classification"] = classifications[key] = "protected"
                choices[key]["derived_from_protected"] = True
                public_values[key] = None

    has_public = bool(alternatives) or any(v is not None and v != "" and v != [] for v in public_values.values()) or any(cell.get("public_alternative") for item in choices.values() for row in item.get("cells",[]) for cell in row.values())
    issues = []
    if final and has_public and public_confirmed is not True:
        issues.append({"field":"public_confirmation","code":"PUBLIC_CONFIRMATION","message":"Confirm that the public answers and public alternatives may be released publicly"})
    return {"disclosures":choices,"public_values":public_values,"public_alternatives":alternatives,"public_confirmed":public_confirmed is True,"disclosure_issues":issues}


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
        self.context = threading.local()
        with self.connection() as db:
            db.executescript("""
            CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS workbooks(sha TEXT PRIMARY KEY,name TEXT NOT NULL,source_url TEXT,created TEXT NOT NULL,summary TEXT NOT NULL,bytes BLOB NOT NULL);
            CREATE TABLE IF NOT EXISTS questionnaires(id TEXT PRIMARY KEY,name TEXT NOT NULL,version INTEGER NOT NULL,created TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS definitions(questionnaire_id TEXT NOT NULL,version INTEGER NOT NULL,definition TEXT NOT NULL,created TEXT NOT NULL,PRIMARY KEY(questionnaire_id,version),FOREIGN KEY(questionnaire_id) REFERENCES questionnaires(id));
            CREATE TABLE IF NOT EXISTS publications(id TEXT PRIMARY KEY,questionnaire_id TEXT NOT NULL,definition_version INTEGER NOT NULL,created TEXT NOT NULL,FOREIGN KEY(questionnaire_id,definition_version) REFERENCES definitions(questionnaire_id,version));
            CREATE TABLE IF NOT EXISTS respondents(id TEXT PRIMARY KEY,publication_id TEXT NOT NULL,name TEXT NOT NULL,key_hash TEXT NOT NULL,version INTEGER NOT NULL,accepted_revision TEXT,status TEXT NOT NULL,created TEXT NOT NULL,FOREIGN KEY(publication_id) REFERENCES publications(id));
            CREATE TABLE IF NOT EXISTS revisions(id TEXT PRIMARY KEY,respondent_id TEXT NOT NULL,number INTEGER NOT NULL,answers TEXT NOT NULL,validation TEXT NOT NULL,workbook_sha TEXT,comparison TEXT,created TEXT NOT NULL,UNIQUE(respondent_id,number),FOREIGN KEY(respondent_id) REFERENCES respondents(id),FOREIGN KEY(workbook_sha) REFERENCES workbooks(sha));
            CREATE TABLE IF NOT EXISTS drafts(respondent_id TEXT PRIMARY KEY,version INTEGER NOT NULL,answers TEXT NOT NULL,validation TEXT NOT NULL,updated TEXT NOT NULL,FOREIGN KEY(respondent_id) REFERENCES respondents(id));
            CREATE TABLE IF NOT EXISTS reviews(id TEXT PRIMARY KEY,revision_id TEXT NOT NULL,decision TEXT NOT NULL,note TEXT NOT NULL,created TEXT NOT NULL,FOREIGN KEY(revision_id) REFERENCES revisions(id));
            CREATE TABLE IF NOT EXISTS reports(id TEXT PRIMARY KEY,publication_id TEXT NOT NULL,edition TEXT NOT NULL,created TEXT NOT NULL,released INTEGER NOT NULL DEFAULT 0,release_note TEXT,FOREIGN KEY(publication_id) REFERENCES publications(id));
            CREATE TABLE IF NOT EXISTS journal(sequence INTEGER PRIMARY KEY AUTOINCREMENT,method TEXT NOT NULL,identity TEXT NOT NULL,detail TEXT NOT NULL,created TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS operation_requests(request_id TEXT PRIMARY KEY,method TEXT NOT NULL,payload_sha256 TEXT NOT NULL,result TEXT NOT NULL,created TEXT NOT NULL);
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
        self.extensions = {}
        self.extension_modules = []
        for name in EXTENSION_MODULES:
            try: module = importlib.import_module(name)
            except ModuleNotFoundError as error:
                if error.name == name: continue
                raise OperationError("DEPENDENCY","Install the native dependency required by "+name) from error
            operations = getattr(module,"OPERATIONS",{})
            if not isinstance(operations,dict) or any(not isinstance(k,str) or not callable(v) for k,v in operations.items()):
                raise OperationError("EXTENSION","The native extension operation map is invalid")
            for method,handler in operations.items():
                if method in self.extensions or callable(getattr(self,"op_"+method,None)):
                    raise OperationError("EXTENSION","An extension duplicates an original native operation")
                self.extensions[method] = handler
            installer = getattr(module,"install_schema",None)
            if installer: installer(self)
            self.extension_modules.append(name)

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

    def workbook_bytes(self,sha):
        with self.connection() as db:
            row = db.execute("SELECT bytes FROM workbooks WHERE sha=?",(sha,)).fetchone()
            if not row: raise OperationError("NOT_FOUND","Original workbook is not retained")
            return row[0]

    get_workbook_bytes = workbook_bytes

    def invoke(self,method,params=None):
        params = params or {}
        function = getattr(self,"op_"+method,None)
        if function is None and method in self.extensions:
            function = lambda p:self.extensions[method](self,p)
        if function is None or not callable(function): raise OperationError("METHOD","Unknown native operation")
        if not isinstance(params,dict): raise OperationError("PARAMS","Native parameters must be an object")
        request_id = params.get("request_id")
        if request_id is not None and (not isinstance(request_id,str) or not 1 <= len(request_id) <= 200):
            raise OperationError("REQUEST_ID","Use a stable request identifier of at most 200 characters")
        previous = getattr(self.context,"request",None)
        self.context.request = {"request_id":request_id,"payload_sha256":digest(encoded({k:v for k,v in params.items() if k not in {'request_id','_actor'}}).encode()),"actor":params.get("_actor",{"role":"native_operator"})}
        try: return function(params)
        finally: self.context.request = previous

    def _write(self,method,key,detail,action):
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            try:
                context = getattr(self.context,"request",None) or {"actor":{"role":"native_operator"},"request_id":None}
                request_id = context.get("request_id")
                if request_id:
                    previous = db.execute("SELECT * FROM operation_requests WHERE request_id=?",(request_id,)).fetchone()
                    if previous:
                        if previous["method"] != method or previous["payload_sha256"] != context["payload_sha256"]:
                            raise OperationError("REQUEST_CONFLICT","This request identifier belongs to different native inputs")
                        db.rollback()
                        return json.loads(previous["result"])
                result = action(db)
                event = {**detail,"actor":context["actor"],"outcome":"saved","request_id":request_id}
                db.execute("INSERT INTO journal(method,identity,detail,created) VALUES(?,?,?,?)",(method,key,encoded(event),now()))
                if request_id:
                    db.execute("INSERT INTO operation_requests VALUES(?,?,?,?,?)",(request_id,method,context["payload_sha256"],encoded(result),now()))
                db.commit()
                return result
            except BaseException:
                db.rollback()
                raise

    def op_status(self,p):
        with self.connection() as db:
            return {"workspace_id":db.execute("SELECT value FROM settings WHERE key='workspace_id'").fetchone()[0],"questionnaires":[dict(x) for x in db.execute("SELECT * FROM questionnaires ORDER BY created")],"publications":[dict(x) for x in db.execute("SELECT * FROM publications ORDER BY created")],"workbooks":[dict(x) for x in db.execute("SELECT sha,name,source_url,created FROM workbooks ORDER BY created")],"respondents":[{k:v for k,v in dict(x).items() if k != 'key_hash'} for x in db.execute("SELECT * FROM respondents ORDER BY created")],"reports":[{k:v for k,v in dict(x).items() if k != 'edition'} for x in db.execute("SELECT * FROM reports ORDER BY created")],"journal_entries":db.execute("SELECT COUNT(*) FROM journal").fetchone()[0],"extensions":self.extension_modules,"extension_operations":sorted(self.extensions)}

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

    def op_invite(self,p):
        key,access = identifier(),secrets.token_urlsafe(30)
        name = str(p.get("name","")).strip()
        if not name: raise OperationError("NAME","A respondent name is required")
        def action(db):
            self._row(db,"publications",p["publication_id"])
            db.execute("INSERT INTO respondents VALUES(?,?,?,?,0,NULL,'invited',?)",(key,p["publication_id"],name,digest(access.encode()),now()))
            return {"respondent_id":key,"publication_id":p["publication_id"],"name":name,"version":0,"access_code":access,"entry_path":"/respondent/"+key}
        result = self._write("invite",key,{"publication_id":p["publication_id"],"name":name},action)
        retained = "respondent-"+result["respondent_id"]+".json"
        invitation = json.dumps(result,ensure_ascii=False,indent=2)+"\n"
        path = self.directory/retained
        if path.exists():
            if path.read_text() != invitation: raise OperationError("INVITATION","The retained invitation differs from this native request")
        else: self._private_file(retained,invitation)
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
            draft = db.execute("SELECT * FROM drafts WHERE respondent_id=?",(respondent["id"],)).fetchone()
            draft = None if draft is None else dict(draft)
            if draft:
                draft["answers"] = json.loads(draft["answers"])
                draft["validation"] = json.loads(draft["validation"])
            return {"respondent":{k:v for k,v in respondent.items() if k != 'key_hash'},"publication":publication,"definition":definition,"revisions":revisions,"draft":draft}

    def op_save_progress(self,p):
        key = p["respondent_id"]
        def action(db):
            respondent = self._row(db,"respondents",key)
            if respondent["status"] == "accepted" and (getattr(self.context,"request",None) or {}).get("actor",{}).get("role") == "respondent":
                raise OperationError("RESPONSE_LOCKED","The accepted response is retained; the analyst can reopen it for a revised submission")
            if respondent["version"] != p.get("expected_version"):
                raise OperationError("VERSION_CONFLICT","This respondent has a newer sealed revision; reopen the current edition")
            previous = db.execute("SELECT version FROM drafts WHERE respondent_id=?",(key,)).fetchone()
            version = 0 if previous is None else previous[0]
            if version != p.get("expected_draft_version",0):
                raise OperationError("VERSION_CONFLICT","The saved response progress changed; reopen before editing",{"current_draft_version":version})
            _,definition = self._definition(db,respondent["publication_id"])
            answers = p.get("answers",{})
            validation = validate_answers(definition,answers)
            validation.update(disclosure_projection(definition,validation["values"],p.get("disclosures"),p.get("public_confirmed",False),final=False))
            stamp = now()
            db.execute("INSERT INTO drafts VALUES(?,?,?,?,?) ON CONFLICT(respondent_id) DO UPDATE SET version=excluded.version,answers=excluded.answers,validation=excluded.validation,updated=excluded.updated",(key,version+1,encoded(answers),encoded(validation),stamp))
            return {"respondent_id":key,"draft_version":version+1,"sealed_revision":respondent["version"],"validation":validation,"updated":stamp}
        return self._write("save_progress",key,{"expected_version":p.get("expected_version"),"expected_draft_version":p.get("expected_draft_version",0)},action)

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
            if respondent["status"] == "accepted" and (getattr(self.context,"request",None) or {}).get("actor",{}).get("role") == "respondent":
                raise OperationError("RESPONSE_LOCKED","The accepted response is retained; the analyst can reopen it for a revised submission")
            if respondent["version"] != p.get("expected_version"):
                raise OperationError("VERSION_CONFLICT","This respondent has a newer revision; reopen before submitting",{"current_version":respondent["version"]})
            _,definition = self._definition(db,respondent["publication_id"])
            validation = validate_answers(definition,answers)
            projection = disclosure_projection(definition,validation["values"],p.get("disclosures"),p.get("public_confirmed",False))
            validation.update(projection)
            validation["issues"].extend(projection["disclosure_issues"])
            validation["valid"] = not validation["issues"]
            previous = db.execute("SELECT * FROM revisions WHERE respondent_id=? ORDER BY number DESC LIMIT 1",(respondent["id"],)).fetchone()
            before = {} if previous is None else json.loads(previous["validation"])["values"]
            changes = [{"field":k,"before":before.get(k),"after":validation["values"].get(k)} for k in sorted(set(before)|set(validation["values"])) if before.get(k) != validation["values"].get(k)]
            comparison = {"answerChanges":changes,"answerChangeCount":len(changes)}
            before_disclosure = {} if previous is None else json.loads(previous["validation"]).get("disclosures",{})
            disclosure_changes = [{"field":k,"before":before_disclosure.get(k),"after":projection["disclosures"].get(k)} for k in sorted(set(before_disclosure)|set(projection["disclosures"])) if before_disclosure.get(k) != projection["disclosures"].get(k)]
            comparison["disclosureChanges"] = disclosure_changes
            comparison["disclosureChangeCount"] = len(disclosure_changes)
            if p.get("workbook_sha256") and previous is not None and previous["workbook_sha"]:
                comparison["workbook"] = workbook_diff(self.workbook(previous["workbook_sha"]),self.workbook(p["workbook_sha256"]))
            number = respondent["version"]+1
            db.execute("INSERT INTO revisions VALUES(?,?,?,?,?,?,?,?)",(key,respondent["id"],number,encoded(answers),encoded(validation),p.get("workbook_sha256"),encoded(comparison),now()))
            db.execute("UPDATE respondents SET version=?,status='received' WHERE id=?",(number,respondent["id"]))
            db.execute("DELETE FROM drafts WHERE respondent_id=?",(respondent["id"],))
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

    def compose_report(self,db,p,key):
        publication,definition = self._definition(db,p["publication_id"])
        selected_questions = p.get("question_ids")
        known_questions = {q["id"]:q for q in definition["questions"]}
        if selected_questions is not None and (not isinstance(selected_questions,list) or not selected_questions or len(selected_questions)!=len(set(selected_questions)) or not set(selected_questions)<=set(known_questions)):
            raise OperationError("REPORT_SELECTION","Select distinct question identifiers from the published definition")
        report_questions = definition["questions"] if selected_questions is None else [known_questions[q] for q in selected_questions]
        selected_respondents = p.get("respondent_ids")
        if selected_respondents is not None and (not isinstance(selected_respondents,list) or not selected_respondents or len(selected_respondents)!=len(set(selected_respondents))):
            raise OperationError("REPORT_SELECTION","Select distinct accepted respondent identifiers")
        responses = []
        for row in db.execute("SELECT r.id,r.name,r.status,r.version,r.accepted_revision,v.number,v.validation,v.workbook_sha FROM respondents r JOIN revisions v ON v.id=r.accepted_revision WHERE r.publication_id=? AND r.status='accepted' AND r.version=v.number ORDER BY r.created",(publication["id"],)):
            if selected_respondents is not None and row["id"] not in selected_respondents: continue
            validation = json.loads(row["validation"])
            projection = validation if "public_values" in validation else disclosure_projection(definition,validation["values"],final=False)
            responses.append({"respondent_id":row["id"],"name":row["name"],"status":row["status"],"latest_version":row["version"],"revision_id":row["accepted_revision"],"accepted_number":row["number"],"workbook_sha256":row["workbook_sha"],"values":validation["values"],"disclosures":projection["disclosures"],"public_values":projection["public_values"],"public_alternatives":projection["public_alternatives"],"public_confirmed":projection["public_confirmed"]})
        if selected_respondents is not None and set(selected_respondents)!={r["respondent_id"] for r in responses}:
            raise OperationError("REPORT_SELECTION","Every selected respondent needs an accepted revision in this publication")
        if not responses:
            raise OperationError("REPORT_EMPTY","Accept a respondent revision before consolidating a report")
        protected = {"schema":"atssc.report.protected.v1","report_id":key,"publication":publication,"definition":definition,"questions":report_questions,"created":now(),"accepted_responses":responses}
        public_questions = []
        for q in report_questions:
            item = {k:q[k] for k in ("id","label","kind","unit","disclosure") if k in q}
            if q["kind"] == "table":
                item["columns"] = [{k:c[k] for k in ("id","label","kind","unit","disclosure") if k in c} for c in q["columns"]]
            public_questions.append(item)
        public_responses = []
        for index,response in enumerate(responses,1):
            selected = {q["id"] for q in public_questions}
            public_responses.append({"response_number":index,"values":{k:v for k,v in response["public_values"].items() if k in selected},"public_alternatives":{k:v for k,v in response["public_alternatives"].items() if k in selected},"disclosures":{k:v for k,v in response["disclosures"].items() if k in selected}})
        public = {"schema":"atssc.report.public.v1","report_id":key,"created":protected["created"],"questionnaire_title":definition.get("title","Questionnaire"),"questions":public_questions,"accepted_responses":public_responses}
        for edition,questions,records in ((public,public_questions,public_responses),(protected,report_questions,responses)):
            totals = {}
            for field in questions:
                if field["kind"] not in {"number","integer"}: continue
                numbers = [decimal(r["values"][field["id"]]) for r in records if r["values"].get(field["id"]) is not None]
                total = sum(numbers,Decimal(0))
                totals[field["id"]] = {"answered":len(numbers),"sum":format(total,"f") if numbers else None,"mean":format(total/len(numbers),"f") if numbers else None,"minimum":format(min(numbers),"f") if numbers else None,"maximum":format(max(numbers),"f") if numbers else None,"unit":field.get("unit")}
            edition["numeric_totals"] = totals
        edition = {"protected":protected,"public":public}
        return edition

    def op_create_report(self,p):
        key = identifier()
        def action(db):
            edition = self.compose_report(db,p,key)
            db.execute("INSERT INTO reports VALUES(?,?,?, ?,0,NULL)",(key,p["publication_id"],encoded(edition),now()))
            return {"report_id":key,"accepted_respondents":len(edition["protected"]["accepted_responses"]),"public_questions":len(edition["public"]["questions"]),"protected_questions":len(edition["protected"]["questions"]),"released":False,"edition":edition}
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

    def response_edition(self,respondent_id,edition):
        if edition not in {"public","protected"}: raise OperationError("EDITION","Choose public or protected response edition")
        record = self.op_get_respondent({"respondent_id":respondent_id})
        current = record["draft"] or (record["revisions"][-1] if record["revisions"] else None)
        definition = record["definition"]
        answers = {} if current is None else current["answers"]
        validation = validate_answers(definition,answers) if current is None else current["validation"]
        projection = validation if "public_values" in validation else disclosure_projection(definition,validation["values"],final=False)
        public = edition == "public"
        questions = [{k:q[k] for k in ("id","label","kind","unit","disclosure","columns") if k in q} for q in definition["questions"]]
        if public:
            for q in questions:
                if "columns" in q: q["columns"] = [{k:c[k] for k in ("id","label","kind","unit","disclosure") if k in c} for c in q["columns"]]
        values = projection["public_values"] if public else {**answers,**validation["values"]}
        response = {"values":values,"public_alternatives":projection["public_alternatives"],"disclosures":projection["disclosures"]}
        if not public: response.update({"respondent_id":respondent_id,"name":record["respondent"]["name"]})
        stamp = record["respondent"]["created"] if current is None else current.get("updated",current.get("created"))
        return {"schema":"atssc.response-document."+edition+".v1","edition":edition,"questionnaire_title":definition.get("title","Questionnaire"),"created":now(),"updated":stamp,"questions":questions,"accepted_responses":[response],"state":"Saved draft" if record["draft"] else "Submitted revision" if current else "Empty questionnaire","document_state":"draft" if record["draft"] else "submitted" if current else "empty","sealed_revision":record["respondent"]["version"],"draft_version":None if not record["draft"] else record["draft"]["version"],"public_confirmed":projection["public_confirmed"],"validation_issues":validation["issues"] if not public else [],"numeric_totals":{}}

    def response_bytes(self,respondent_id,edition,format_name):
        if format_name not in {"pdf","docx"}: raise OperationError("FORMAT","Respondent downloads use PDF or Word")
        from document_exports import render_document
        return render_document(self.response_edition(respondent_id,edition),format_name)

    def op_export_response(self,p):
        directory = Path(p["directory"]).expanduser().resolve()
        directory.mkdir(parents=True,exist_ok=False)
        manifest = {"schema":"atssc.response-files.v1","respondent_id":p["respondent_id"],"files":[]}
        for edition in ("public","protected"):
            for fmt in ("pdf","docx"):
                name = edition+"."+fmt
                data = self.response_bytes(p["respondent_id"],edition,fmt)
                (directory/name).write_bytes(data)
                manifest["files"].append({"path":name,"bytes":len(data),"sha256":digest(data),"edition":edition})
        (directory/"manifest.json").write_text(json.dumps(manifest,indent=2)+"\n")
        return {"directory":str(directory),"manifest":manifest}

    def report_bytes(self,report_id,edition,format_name,public=False):
        if edition not in {"public","protected"}: raise OperationError("EDITION","Choose public or protected report edition")
        report = self.public_report(report_id) if public else self.op_get_report({"report_id":report_id})["edition"][edition]
        if format_name in {"pdf","docx"}:
            from document_exports import render_document
            return render_document({**report,"edition":edition},format_name)
        if format_name == "json": return (json.dumps(report,ensure_ascii=False,indent=2)+"\n").encode()
        questions = report.get("questions",report.get("definition",{}).get("questions",[]))
        if format_name == "csv":
            out = io.StringIO(newline="")
            writer = csv.writer(out)
            writer.writerow(["response","question","row","column","answer","disclosure","public_alternative"])
            for index,response in enumerate(report["accepted_responses"],1):
                for question in questions:
                    value = response["values"].get(question["id"])
                    choice = response.get("disclosures",{}).get(question["id"],{})
                    classification = choice.get("classification",question.get("disclosure","protected"))
                    if question["kind"] == "table":
                        if value is None:
                            writer.writerow([index,question["id"],"","","",classification,csv_safe(choice.get("public_alternative"))])
                        for rowno,row in enumerate(value or [],1):
                            for column in question["columns"]:
                                cells = choice.get("cells",[])
                                cell = cells[rowno-1].get(column["id"],{}) if rowno<=len(cells) else {}
                                writer.writerow([index,question["id"],rowno,column["id"],csv_safe(row.get(column["id"])),cell.get("classification",column.get("disclosure",classification)),csv_safe(cell.get("public_alternative"))])
                    else: writer.writerow([index,question["id"],"","",csv_safe(value),classification,csv_safe(choice.get("public_alternative"))])
            return out.getvalue().encode("utf-8-sig")
        if format_name == "html":
            title = report.get("questionnaire_title",report.get("definition",{}).get("title","Questionnaire"))
            parts = ["<!doctype html><html lang='en'><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>"+html.escape(title)+"</title><style>body{font:15px system-ui;max-width:1100px;margin:32px auto;padding:0 20px;color:#20252b}table{border-collapse:collapse;width:100%}th,td{padding:9px;border:1px solid #bbb;vertical-align:top;text-align:left}h1{font-size:24px}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><h1>"+html.escape(title)+"</h1><p>"+edition.capitalize()+" report edition. Created "+html.escape(report["created"])+".</p>"]
            for index,response in enumerate(report["accepted_responses"],1):
                parts.append("<h2>Response "+str(index)+"</h2><table><thead><tr><th>Question</th><th>Answer</th></tr></thead><tbody>")
                for question in questions:
                    value = response["values"].get(question["id"])
                    text = json.dumps(value,ensure_ascii=False,indent=2) if isinstance(value,(list,dict)) else "" if value is None else str(value)
                    choice = response.get("disclosures",{}).get(question["id"],{})
                    alternatives = []
                    if choice.get("public_alternative"): alternatives.append(choice["public_alternative"])
                    for rowno,row in enumerate(choice.get("cells",[]),1):
                        for column,cell in row.items():
                            if cell.get("public_alternative"): alternatives.append("Row "+str(rowno)+", "+column+": "+cell["public_alternative"])
                    alternative_html = "" if not alternatives else "<p>Public alternative</p><pre>"+html.escape("\n".join(alternatives))+"</pre>"
                    parts.append("<tr><td>"+html.escape(question["label"])+"</td><td><pre>"+html.escape(text)+"</pre>"+alternative_html+"</td></tr>")
                parts.append("</tbody></table>")
            parts.append("</html>")
            return "".join(parts).encode()
        raise OperationError("FORMAT","Choose JSON, CSV, HTML, PDF or DOCX")

    def op_export_report(self,p):
        report = self.op_get_report({"report_id":p["report_id"]})
        directory = Path(p["directory"]).expanduser().resolve()
        directory.mkdir(parents=True,exist_ok=False)
        manifest = {"schema":"atssc.report-files.v1","report_id":report["id"],"released":bool(report["released"]),"files":[]}
        for edition in ("public","protected"):
            for fmt in ("json","csv","html","pdf","docx"):
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
        if self.directory in path.parents: raise OperationError("EXPORT_DESTINATION","Export the project outside its native workspace directory")
        path.parent.mkdir(parents=True,exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="questionnaire-project-") as temp:
            temp = Path(temp)
            backup = self.op_backup({"path":str(temp/"questionnaires.sqlite3")})
            files = {"workspace/questionnaires.sqlite3":(temp/"questionnaires.sqlite3").read_bytes()}
            for source in sorted(SOURCE.rglob("*")):
                relative = source.relative_to(SOURCE)
                if source.is_file() and not source.is_symlink() and not any(part.startswith(".") or part in {"__pycache__","node_modules"} for part in relative.parts) and (source.name == "LICENSE" or source.suffix in {".py",".java",".mjs",".mts",".html",".css",".md",".json",".txt",".ttf",".otf"}):
                    files["application/"+relative.as_posix()] = source.read_bytes()
            for source in self.directory.glob("*.txt"):
                if source.name == "operator-key.txt": files["workspace/"+source.name] = source.read_bytes()
            for source in self.directory.glob("respondent-*.json"):
                files["workspace/"+source.name] = source.read_bytes()
            for folder in ("source-evidence","calculations","document-runtime","calculation-runtime"):
                base = self.directory/folder
                if folder.endswith("-runtime") and not base.exists(): base = self.directory.parent/folder
                for source in sorted(base.rglob("*")):
                    if source.is_symlink(): raise OperationError("PROJECT_FILE","Native project attachments must be retained files")
                    if not source.is_file(): continue
                    relative = Path(folder)/source.relative_to(base)
                    name = relative.as_posix() if folder.endswith("-runtime") else "workspace/"+relative.as_posix()
                    files[name] = source.read_bytes()
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
    destination.parent.mkdir(parents=True,exist_ok=True)
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
                if db.execute("PRAGMA foreign_key_check").fetchone(): raise OperationError("ARCHIVE","Received native relationships failed integrity verification")
                identity = db.execute("SELECT value FROM settings WHERE key='workspace_id'").fetchone()
                if not identity or identity[0] != manifest["workspace_id"]: raise OperationError("ARCHIVE","Received native workspace identity differs from its manifest")
                operator = temp/"workspace/operator-key.txt"
                key_hash = db.execute("SELECT value FROM settings WHERE key='operator_key_hash'").fetchone()
                if not operator.is_file() or not key_hash or digest(operator.read_text().strip().encode()) != key_hash[0]:
                    raise OperationError("ARCHIVE","Received operator access code differs from its native record")
                for sha,raw in db.execute("SELECT sha,bytes FROM workbooks"):
                    if digest(raw) != sha: raise OperationError("ARCHIVE","Received original workbook bytes failed verification")
            os.mkdir(destination,0o700)
            for root in ("application","workspace","document-runtime","calculation-runtime"):
                if (temp/root).exists(): os.rename(temp/root,destination/root)
    result = Workspace(destination/"workspace").op_status({})
    if result["workspace_id"] != manifest["workspace_id"]: raise OperationError("ARCHIVE","Received native workspace identity changed")
    return {"directory":str(destination),"workspace_id":result["workspace_id"],"integrity":"ok","verified_files":len(manifest["files"]),"sha256":digest(data)}
