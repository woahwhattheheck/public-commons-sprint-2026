"""Native workbook calculation joined to the original questionnaire workspace.

Source packages, formulas and presentation are preserved. A separate native
export supplies calculated caches and actual UNO precedent ranges. All results
use the existing retained workbook BLOBs and the same questionnaire authority.
"""
from __future__ import annotations

import base64
import contextlib
import fcntl
import hashlib
import io
import json
import re
import uuid
from datetime import datetime,timezone
from decimal import Decimal
from datetime import date,timedelta
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape
from xml.etree import ElementTree as ET

from native_calculation import calculate_original_workbooks
from workbooks import read_xlsx, cell_parts, range_cells, col_letters, MAIN


def digest(data):
    return hashlib.sha256(data).hexdigest()

def encoded(value):
    return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(",",":"))

def timestamp():
    return datetime.now(timezone.utc).isoformat()

def install_schema(workspace):
    with workspace.connection() as db:
        db.executescript('''
        CREATE TABLE IF NOT EXISTS calculations(
          id TEXT PRIMARY KEY, source_sha TEXT NOT NULL REFERENCES workbooks(sha),
          request_id TEXT, payload_sha TEXT NOT NULL, params TEXT NOT NULL,
          state TEXT NOT NULL, created TEXT NOT NULL, updated TEXT NOT NULL,
          result TEXT, error TEXT);
        CREATE UNIQUE INDEX IF NOT EXISTS calculation_request ON calculations(request_id) WHERE request_id IS NOT NULL;
        ''')

@contextlib.contextmanager
def _without_request_cache(workspace):
    previous=getattr(workspace.context,"request",None)
    workspace.context.request={**(previous or {}),"request_id":None}
    try:yield
    finally:workspace.context.request=previous

def _runtime(workspace):
    candidates=[workspace.directory/"calculation-runtime",workspace.directory.parent/"calculation-runtime"]
    for folder in candidates:
        jar=folder/"libreoffice-26.2.2.jar"
        if jar.is_file():return jar
    return None

def _validate_files(workspace,result):
    for item in result.get("files",[]):
        path=workspace.directory/item["path"]
        if not path.resolve().is_relative_to(workspace.directory):raise ValueError("Calculation attachment leaves this workspace.")
        if path.is_symlink() or not path.is_file() or path.stat().st_size!=item["bytes"] or digest(path.read_bytes())!=item["sha256"]:
            raise ValueError("A retained calculation attachment differs from its immutable edition.")
    if result.get("calculated_path"):
        descriptor=(workspace.directory/result["calculated_path"]).parent/"calculation-result.json"
        if not descriptor.is_file() or json.loads(descriptor.read_text())!=result:
            raise ValueError("The retained calculation descriptor differs from the original database edition.")
    return result


CELL_ELEMENT = re.compile(rb'<(?P<prefix>[A-Za-z_][\w.-]*:)c\b(?P<attributes>[^>]*?)(?<!/)>(?P<body>.*?)</(?P=prefix)c>',re.S)
# A default namespace has no textual prefix; its closing tag cannot use a
# backreference to an unmatched optional group in Python's regex engine.
PLAIN_CELL = re.compile(rb'<c\b(?P<attributes>[^>]*?)(?<!/)>(?P<body>.*?)</c>',re.S)
EMPTY_CELL = re.compile(rb'<(?P<prefix>[A-Za-z_][\w.-]*:)?c\b(?P<attributes>[^>]*?)/>')
ADDRESS = re.compile(rb'\br="([A-Z]{1,3}[1-9][0-9]*)"')
TYPE = re.compile(rb'\s+t="[^"]*"')


def _cache(record):
    kind = record["kind"]
    value = record["value"]
    if kind in {"s","inlineStr"}:
        kind = "str"
    if kind == "b":
        value = "1" if value is True else "0"
    elif kind == "n":
        value = record["raw"]
    return [kind, value]

def _patch_cells(source,records):
    def open_empty(match):
        found=ADDRESS.search(match.group("attributes"))
        if found is None or found.group(1).decode() not in records:return match.group(0)
        prefix=match.group("prefix") or b""
        return b'<'+prefix+b'c'+match.group("attributes")+b'></'+prefix+b'c>'
    def replace(match):
        attributes=match.group("attributes");found=ADDRESS.search(attributes)
        if found is None or found.group(1).decode() not in records:return match.group(0)
        kind,value=_cache(records[found.group(1).decode()]);prefix=match.groupdict().get("prefix") or b""
        body=match.group("body")
        body=re.sub(rb'<'+prefix+rb'v\b[^>]*(?:/>|>.*?</'+prefix+rb'v>)',b'',body,flags=re.S)
        body=re.sub(rb'<'+prefix+rb'is\b[^>]*(?:/>|>.*?</'+prefix+rb'is>)',b'',body,flags=re.S)
        attributes=TYPE.sub(b'',attributes)
        if kind!="n":attributes+=b' t="'+kind.encode()+b'"'
        cache=b'' if value is None else b'<'+prefix+b'v>'+escape(str(value)).encode()+b'</'+prefix+b'v>'
        return b'<'+prefix+b'c'+attributes+b'>'+body+cache+b'</'+prefix+b'c>'
    return PLAIN_CELL.sub(replace,CELL_ELEMENT.sub(replace,EMPTY_CELL.sub(open_empty,source)))

def _replace_members(original_bytes,replacements):
    target=io.BytesIO();members=[]
    with zipfile.ZipFile(io.BytesIO(original_bytes)) as source,zipfile.ZipFile(target,"w") as successor:
        successor.comment=source.comment
        for info in source.infolist():
            before=source.read(info.filename);after=replacements.get(info.filename,before)
            successor.writestr(info,after)
            members.append({"member":info.filename,"original_sha256":digest(before),"successor_sha256":digest(after),
                "original_bytes":len(before),"successor_bytes":len(after),"unchanged":before==after})
    return target.getvalue(),members

def apply_declared_inputs(original_bytes,staged_bytes,edits):
    """Consume explicitly authored cells without importing staging formatting."""
    original=read_xlsx(original_bytes);staged=read_xlsx(staged_bytes)
    sheets={s["name"]:s for s in original["sheets"]};staging={s["name"]:s for s in staged["sheets"]}
    selected={};seen=set()
    for edit in edits:
        sheet,address=edit["sheet"],edit["cell"];cell_parts(address)
        if (sheet,address) in seen:raise ValueError("A declared input occurs more than once.")
        seen.add((sheet,address))
        source=sheets.get(sheet,{}).get("cells",{}).get(address)
        if source is None or source["formula"] is not None:raise ValueError("Select an existing original answer cell, preserving every original formula.")
        value=staging.get(sheet,{}).get("cells",{}).get(address)
        if value is None or value["formula"] is not None or value["kind"]=="e":raise ValueError("The staged input is not an authored scalar answer.")
        actual=value["value"];expected=edit["value"]
        equal=(Decimal(str(actual))==Decimal(str(expected))) if type(expected) in {int,float} else actual==expected
        if not equal:raise ValueError("The staged answer differs from its declared input.")
        selected.setdefault(sheet,{})[address]=value
    replacements={}
    with zipfile.ZipFile(io.BytesIO(original_bytes)) as archive:
        for name,records in selected.items():
            member=sheets[name]["member"];replacements[member]=_patch_cells(archive.read(member),records)
    body,members=_replace_members(original_bytes,replacements)
    reopened=read_xlsx(body)
    for before,after in zip(original["sheets"],reopened["sheets"]):
        if before["name"]!=after["name"] or set(before["cells"])!=set(after["cells"]):raise RuntimeError("The original worksheet/cell catalogue changed.")
        for address,cell in before["cells"].items():
            other=after["cells"][address]
            if cell["formula"]!=other["formula"] or cell["style"]!=other["style"]:raise RuntimeError("An original formula or style changed.")
            if (before["name"],address) not in seen and cell!=other:raise RuntimeError("An undeclared original cell changed.")
            if (before["name"],address) in seen and _cache(other)!=_cache(selected[before["name"]][address]):
                raise RuntimeError("An authored declared input was not written faithfully.")
    return body,{"schema":"atssc.original-declared-input-edition.v1","source_sha256":original["sha256"],
        "staging_sha256":staged["sha256"],"answered_sha256":digest(body),"input_edits":edits,"members":members}


def overlay_native_caches(original_bytes, native_bytes):
    """Keep every original ZIP member and original formula; update cache cells.

    All unrelated member bytes, sheet XML, cell styles, formula expressions and
    shared/array formula attributes retain their original identities. Native
    dynamic array results outside the original declared array window remain in
    the complete native export and are explicitly listed rather than changing
    the original author's array definition.
    """
    original, native = read_xlsx(original_bytes), read_xlsx(native_bytes)
    if [(s["name"],s["state"]) for s in original["sheets"]] != [(s["name"],s["state"]) for s in native["sheets"]]:
        raise ValueError("Native calculation changed the original worksheet identity or visibility.")
    native_sheets = {s["name"]:s for s in native["sheets"]}
    replacements, changes, statuses, arrays = {}, [], [], []
    for sheet in original["sheets"]:
        calculated = native_sheets[sheet["name"]]
        selected = {a for a,c in sheet["cells"].items() if c["formula"] is not None}
        for address in list(selected):
            f = sheet["cells"][address]["formula"]
            if f["attributes"].get("t") == "array":
                declared = set(range_cells(f["attributes"].get("ref",address)))
                selected.update(declared & set(sheet["cells"]))
                native_f = calculated["cells"].get(address,{}).get("formula")
                native_ref = (native_f or {}).get("attributes",{}).get("ref",address)
                arrays.append({"sheet":sheet["name"],"cell":address,"original_ref":f["attributes"].get("ref",address),
                    "native_ref":native_ref,"additional_native_cells":sorted(set(range_cells(native_ref))-declared,key=cell_parts)})
        records = {}
        for address in sorted(selected,key=cell_parts):
            before = sheet["cells"][address]
            after = calculated["cells"].get(address)
            if after is None:
                raise ValueError("Native export omitted an original formula result cell.")
            records[address] = after
            statuses.append({"sheet":sheet["name"],"cell":address,"original_formula":before["formula"],
                "native_formula":after["formula"],"original_cache":{"kind":before["kind"],"value":before["value"]},
                "native_cache":{"kind":after["kind"],"value":after["value"]},
                "status":"formula_error" if after["kind"]=="e" else "empty" if after["value"] in {None,""} else "calculated"})
            if _cache(before) != _cache(after): changes.append({"sheet":sheet["name"],"cell":address,"before":_cache(before),"after":_cache(after)})

        with zipfile.ZipFile(io.BytesIO(original_bytes)) as archive:
            replacements[sheet["member"]] = _patch_cells(archive.read(sheet["member"]),records)
    body,members = _replace_members(original_bytes,replacements)
    reopened = read_xlsx(body)
    # A successful overlay changes caches, never source formulas or sheet structure.
    if original["formulaCount"] != reopened["formulaCount"]:raise RuntimeError("Original formula count changed.")
    for before,after in zip(original["sheets"],reopened["sheets"]):
        if set(before["cells"]) != set(after["cells"]):raise RuntimeError("Original cell catalogue changed.")
        for address,cell in before["cells"].items():
            edition = after["cells"][address]
            if cell["formula"] != edition["formula"] or cell["style"] != edition["style"]:
                raise RuntimeError("Original formula or cell style changed.")
            if cell["formula"] is not None and _cache(edition)!=_cache(native_sheets[before["name"]]["cells"][address]):
                raise RuntimeError("An original formula result differs from the actual native cache.")
    return body,{"schema":"atssc.original-formula-cache-edition.v1","source_sha256":original["sha256"],
        "native_sha256":native["sha256"],"calculated_sha256":digest(body),"formula_count":original["formulaCount"],
        "cache_change_count":len(changes),"cache_changes":changes,"formula_results":statuses,"arrays":arrays,"members":members}


def project_answers(definition,book,source_sha256=None):
    """Project native caches with exact original question IDs and row windows."""
    sheets = {s["name"]:s for s in book["sheets"]}
    answers,issues = {},[]
    for field in definition["questions"]:
        source = field.get("source")
        if not source or "calculation" in field:continue
        if source_sha256 and source.get("workbook_sha256") != source_sha256:continue
        sheet = sheets.get(source["sheet"])
        if sheet is None:
            issues.append({"field":field["id"],"code":"WORKBOOK_BINDING","message":"Original worksheet is absent"});continue
        def value(address,field_spec,column=None,row=None):
            cell = sheet["cells"].get(address,{})
            if cell.get("kind")=="e":
                issues.append({"field":field["id"],"code":"NATIVE_FORMULA_ERROR","sheet":source["sheet"],"cell":address,
                    "error":cell["value"],**({"column":column,"row":row} if column else {})})
                return None
            result=cell.get("value")
            if result in {None,""}:return result
            if field_spec.get("source_calculated") and result in field_spec.get("native_empty_markers",[]):
                issues.append({"field":field["id"],"code":"NATIVE_VALUE_UNAVAILABLE","sheet":source["sheet"],"cell":address,
                    "original_native_value":result,"reason":"Original numeric formula returned its retained no-data display marker"})
                return None
            if field_spec.get("kind")=="date" and cell.get("kind")=="n":
                serial=int(Decimal(result))
                if not book["date1904"] and serial==60:
                    issues.append({"field":field["id"],"code":"NATIVE_DATE_UNAVAILABLE","sheet":source["sheet"],"cell":address,"original_serial":result});return None
                epoch=date(1904,1,1) if book["date1904"] else date(1899,12,30) if serial>=61 else date(1899,12,31)
                return (epoch+timedelta(days=serial)).isoformat()
            if field_spec.get("kind") in {"number","integer"} and field_spec.get("workbook_scale"):
                return format(Decimal(str(result))*Decimal(field_spec["workbook_scale"]),"f")
            return result
        if field["kind"]=="table":
            rows = []
            for row in source_rows(source):
                result = {c["id"]:value(c["source_column"]+str(row),c,c["id"],row) for c in field["columns"]}
                rows.append(result)
            # Preserve physical positions when a later source row is answered.
            # Removing an empty middle row would write the next answer back to
            # a different original country or period on the return journey.
            answers[field["id"]] = rows if any(v not in {None,""} for row in rows for v in row.values()) else []
        else:answers[field["id"]] = value(source["cell"],field)
    return {"answers":answers,"issues":issues}

def source_rows(source):
    rows=source.get("rows")
    if rows is None:return list(range(int(source["start_row"]),int(source["end_row"])+1))
    if not isinstance(rows,list) or not rows or any(type(x) is not int or x<int(source.get("start_row",1)) or x>int(source.get("end_row",1048576)) for x in rows) or len(set(rows))!=len(rows):
        raise ValueError("Exact original source rows must be distinct and inside the retained row window.")
    return rows

def verify_source_successor(original_bytes,successor_bytes):
    """Validate the published original template while retaining changed answers."""
    original,successor=read_xlsx(original_bytes),read_xlsx(successor_bytes)
    if [(s["name"],s["state"]) for s in original["sheets"]]!=[(s["name"],s["state"]) for s in successor["sheets"]]:
        raise ValueError("The uploaded workbook changed the published original worksheet identity")
    with zipfile.ZipFile(io.BytesIO(original_bytes)) as a,zipfile.ZipFile(io.BytesIO(successor_bytes)) as b:
        styles=a.read("xl/styles.xml")
        if styles!=b.read("xl/styles.xml"):
            raise ValueError("The uploaded workbook changed original styles or number formats")
        style_root=ET.fromstring(styles)
        unlocked=[(item.find(MAIN+"protection") is not None and item.find(MAIN+"protection").get("locked")=="0") for item in style_root.find(MAIN+"cellXfs")]
        def names(archive):
            root=ET.fromstring(archive.read("xl/workbook.xml"))
            return [(dict(x.attrib),x.text or "") for x in root.findall(MAIN+"definedNames/"+MAIN+"definedName")]
        if names(a)!=names(b) or original["date1904"]!=successor["date1904"]:
            raise ValueError("The uploaded workbook changed an original named reference or date system")
    for before,after in zip(original["sheets"],successor["sheets"]):
        if set(before["cells"])!=set(after["cells"]) or any(before.get(k)!=after.get(k) for k in ("mergedRanges","validations","protection")):
            raise ValueError("The uploaded workbook changed the published original cell/validation/merge structure")
        followers=set();array_results=set()
        for merged in before["mergedRanges"]:followers.update(range_cells(merged)[1:])
        for address,cell in before["cells"].items():
            formula=cell["formula"]
            if formula and formula["attributes"].get("t")=="array":array_results.update(range_cells(formula["attributes"].get("ref",address)))
        for address,cell in before["cells"].items():
            formula=cell["formula"]
            if cell["formula"]!=after["cells"][address]["formula"] or cell["style"]!=after["cells"][address]["style"]:
                raise ValueError("The uploaded workbook changed an original formula or style")
            if formula is None and address not in array_results and (not unlocked[int(cell["style"] or 0)] or address in followers):
                if _cache(cell)!=_cache(after["cells"][address]):raise ValueError("The uploaded workbook changed a locked original label, variable or source-context value")
    return {"source_sha256":original["sha256"],"successor_sha256":successor["sha256"],"original_template_verified":True}

def source_report_mapping(original,graph,cache_manifest):
    """Retain exact hidden/public report formula bindings and native outcomes."""
    refs={(f["sheet"],f["cell"]):f for f in graph["formulas"]}
    results={(f["sheet"],f["cell"]):f for f in cache_manifest["formula_results"]}
    mapping=[]
    for sheet in original["sheets"]:
        markers=[str(sheet["cells"].get("B"+str(row),{}).get("value") or "").strip().upper() for row in range(1,4)]
        public="PUBLIC" in markers
        protected=any("PROTECTED" in text or "CONFIDENTIAL" in text for text in markers)
        if sheet["state"]=="visible" and not public and "SUMMARY" not in sheet["name"].upper() and "RÉSUMÉ" not in sheet["name"].upper():continue
        for address,cell in sheet["cells"].items():
            if cell["formula"] is None:continue
            result=results[(sheet["name"],address)]
            mapping.append({"binding_id":digest((sheet["name"]+"\0"+address).encode())[:20],
                "source_workbook_sha256":original["sha256"],"sheet":sheet["name"],"cell":address,
                "sheet_state":sheet["state"],"source_disclosure":"public" if public else "protected" if protected else "operator",
                "original_formula":cell["formula"],"native_cache":result["native_cache"],"status":result["status"],
                "native_references":refs.get((sheet["name"],address),{}).get("ranges",[])})
    return mapping

def definition_native_bindings(definition,source_sha256,graph):
    """Join native formula dependencies to the owner's published question IDs.

    Ranges are resolved by the native token engine, including relative/shared
    references and cross-sheet references. No formula text regex or replacement
    numeric evaluator is used for disclosure lineage.
    """
    formulas={(f["sheet"],f["cell"]):f for f in graph["formulas"]}
    by_sheet={}
    for (sheet,cell),formula in formulas.items():by_sheet.setdefault(sheet,[]).append((cell_parts(cell),formula))
    bindings=[]
    for field in definition["questions"]:
        source=field.get("source",{})
        if source.get("workbook_sha256")!=source_sha256:continue
        if field["kind"]=="table":
            for column in field["columns"]:
                col=cell_parts(column["source_column"]+"1")[1]
                for row in source_rows(source):
                    bindings.append({"question":field["id"],"column":column["id"],"sheet":source["sheet"],
                        "r1":row,"r2":row,"c1":col,"c2":col})
        else:
            row,col=cell_parts(source["cell"])
            bindings.append({"question":field["id"],"sheet":source["sheet"],"cell":source["cell"],"r1":row,"r2":row,"c1":col,"c2":col})
    def intersects(binding,ref):
        return binding["sheet"]==ref["sheet"] and binding["r1"]<=ref["end_row"] and binding["r2"]>=ref["start_row"] and binding["c1"]<=ref["end_column"] and binding["c2"]>=ref["start_column"]
    joined=[]
    for output in bindings:
        sources=[]
        if "cell" in output:
            node=formulas.get((output["sheet"],output["cell"]))
            if node:sources=[node]
        else:
            sources=[f for (row,col),f in by_sheet.get(output["sheet"],[]) if output["r1"]<=row<=output["r2"] and output["c1"]<=col<=output["c2"]]
        if not sources:continue
        stack=list(sources);visited=set();dependencies=set();references=[]
        while stack:
            node=stack.pop();identity=(node["sheet"],node["cell"])
            if identity in visited:continue
            visited.add(identity)
            for ref in node["ranges"]:
                references.append(ref)
                dependencies.update(b["question"] for b in bindings if intersects(b,ref) and b["question"]!=output["question"])
                for (row,col),child in by_sheet.get(ref["sheet"],[]):
                    if ref["start_row"]<=row<=ref["end_row"] and ref["start_column"]<=col<=ref["end_column"]:stack.append(child)
        joined.append({"question_id":output["question"],**({"column_id":output["column"]} if output.get("column") else {}),
            "source_sha256":source_sha256,"native_dependencies":sorted(dependencies),
            "source_formula_cells":[{"sheet":f["sheet"],"cell":f["cell"]} for f in sources],
            "native_reference_ranges":references})
    return joined


def calculate_retained_workbook(workspace, workbook_sha256, output_directory, report_mapping=None, definition=None, source_binding_sha256=None):
    """Calculate a workbook retained by this same workspace and import its edition."""
    source = workspace.get_workbook_bytes(workbook_sha256)
    if digest(source)!=workbook_sha256:raise ValueError("The retained source bytes differ.")
    original = workspace.workbook(workbook_sha256)
    output = Path(output_directory).resolve()
    if not output.is_relative_to(workspace.directory/"calculations"):
        raise ValueError("Retain complete calculation jobs inside this original workspace.")
    output.mkdir(parents=True,exist_ok=True)
    saved=output/"calculation-result.json"
    if saved.is_file():
        result=json.loads(saved.read_text())
        if result["source_sha256"]!=workbook_sha256:raise ValueError("This calculation edition belongs to another original source.")
        return _validate_files(workspace,result)
    native=None
    for attempt in sorted(output.glob("native-attempt-*"),reverse=True):
        manifest=attempt/"native-calculation.json"
        if not manifest.is_file():continue
        candidate=json.loads(manifest.read_text())
        if len(candidate["workbooks"])!=1 or candidate["workbooks"][0]["source_sha256"]!=workbook_sha256:
            raise ValueError("The retained native attempt names another workbook.")
        item=candidate["workbooks"][0]
        for key in ("native","precedents"):
            path=attempt/Path(item[key+"_path"]).name
            if digest(path.read_bytes())!=item[key+"_sha256"]:raise ValueError("The completed native attempt's source differs.")
            item[key+"_path"]=str(path)
        native=candidate;break
    if native is None:
        attempt=output/("native-attempt-"+str(len(list(output.glob("native-attempt-*")))+1).zfill(4))
        native=calculate_original_workbooks([{"name":original["name"],"workbook_bytes":source,"workbook_sha256":workbook_sha256}],
            attempt,uno_jar=_runtime(workspace))
    item = native["workbooks"][0]
    body,manifest = overlay_native_caches(source,Path(item["native_path"]).read_bytes())
    path = output/("calculated-"+original["name"])
    path.write_bytes(body)
    imported = workspace.invoke("import_workbook",{"name":path.name,"data_base64":base64.b64encode(body).decode(),
        "source_url":original.get("source_url"),"expected_sha256":manifest["calculated_sha256"]})
    (output/"original-cache-edition.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+"\n")
    graph_path=Path(item["precedents_path"])
    graph=json.loads(graph_path.read_text())
    result = {"schema":"atssc.retained-workbook-calculation.v1","workspace_id":workspace.invoke("status")["workspace_id"],
        "source_sha256":workbook_sha256,"calculated_sha256":imported["sha256"],"native":native,
        "cache_manifest":manifest,"report_mapping":report_mapping if report_mapping is not None else source_report_mapping(read_xlsx(source),graph,manifest),
        "calculated_path":path.relative_to(workspace.directory).as_posix(),"native_precedents":graph}
    if definition:
        binding_sha=source_binding_sha256 or workbook_sha256
        result.update(project_answers(definition,read_xlsx(body),binding_sha))
        result["source_binding_sha256"]=binding_sha
        result["definition_native_bindings"]=definition_native_bindings(definition,binding_sha,graph)
    result["files"]=[]
    for file in sorted(output.rglob("*")):
        if file.is_file():
            file_body=file.read_bytes()
            result["files"].append({"path":file.relative_to(workspace.directory).as_posix(),"bytes":len(file_body),"sha256":digest(file_body)})
    result=json.loads(encoded(result))
    (output/"calculation-result.json").write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n")
    return result


def calculate_workbook(workspace,params):
    """Persist and resume one native calculation in the original authority DB."""
    from questionnaire_workspace import OperationError
    request=getattr(workspace.context,"request",None) or {}
    request_id=request.get("request_id")
    payload_sha=request.get("payload_sha256") or digest(encoded(params).encode())
    key=digest(("native-calculation:"+request_id).encode()) if request_id else str(uuid.uuid4())
    root=workspace.directory/"calculations";root.mkdir(parents=True,exist_ok=True)
    with (root/"operation.lease").open("a+") as lease:
        fcntl.flock(lease,fcntl.LOCK_EX)
        with workspace.connection() as db:
            if request_id:
                cached=db.execute("SELECT * FROM operation_requests WHERE request_id=?",(request_id,)).fetchone()
                if cached:
                    if cached["method"]!="calculate_workbook" or cached["payload_sha256"]!=payload_sha:
                        raise OperationError("REQUEST_CONFLICT","This request identifier belongs to different native inputs")
                    return _validate_files(workspace,json.loads(cached["result"]))
            existing=db.execute("SELECT * FROM calculations WHERE id=?",(key,)).fetchone()
            if existing and existing["payload_sha"]!=payload_sha:
                raise OperationError("REQUEST_CONFLICT","This calculation job belongs to different native inputs")
            if existing and existing["state"]=="complete":
                return _validate_files(workspace,json.loads(existing["result"]))
        source_sha=params["workbook_sha256"]
        workspace.workbook(source_sha)
        definition=params.get("definition")
        if params.get("respondent_id"):
            definition=workspace.invoke("get_respondent",{"respondent_id":params["respondent_id"]})["definition"]
        binding=params.get("source_binding_sha256")
        if binding:
            if definition is None or binding not in definition.get("source_workbooks",[]):
                raise OperationError("WORKBOOK_BINDING","The original source binding is absent from this published questionnaire")
            verify_source_successor(workspace.get_workbook_bytes(binding),workspace.get_workbook_bytes(source_sha))
        def claim(db):
            db.execute("INSERT INTO calculations VALUES(?,?,?,?,?,'running',?,?,NULL,NULL) ON CONFLICT(id) DO UPDATE SET state='running',updated=excluded.updated,error=NULL",
                (key,source_sha,request_id,payload_sha,encoded(params),timestamp(),timestamp()))
            return {"calculation_id":key,"state":"running"}
        with _without_request_cache(workspace):
            workspace._write("calculate_workbook_start",key,{"source_sha256":source_sha},claim)
        directory=root/key
        directory.mkdir(exist_ok=True)
        retained_input=directory/"request.json"
        if retained_input.exists() and retained_input.read_text()!=encoded(params)+"\n":
            raise OperationError("REQUEST_CONFLICT","The retained calculation input differs")
        retained_input.write_text(encoded(params)+"\n")
        try:
            result=calculate_retained_workbook(workspace,source_sha,directory,params.get("report_mapping"),definition,params.get("source_binding_sha256"))
            result.update({"calculation_id":key,"state":"complete","respondent_id":params.get("respondent_id")})
            # Retain the same finished descriptor beside native sources. Its own
            # identity is pinned by the DB result, avoiding a self-hash cycle.
            (directory/"calculation-result.json").write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n")
            def finish(db):
                db.execute("UPDATE calculations SET state='complete',updated=?,result=?,error=NULL WHERE id=?",
                    (timestamp(),encoded(result),key))
                return result
            return workspace._write("calculate_workbook",key,{"source_sha256":source_sha,"calculated_sha256":result["calculated_sha256"]},finish)
        except BaseException as error:
            def fail(db):
                db.execute("UPDATE calculations SET state='failed',updated=?,error=? WHERE id=?",(timestamp(),str(error),key))
                return {"calculation_id":key,"state":"failed","error":str(error)}
            with _without_request_cache(workspace):workspace._write("calculate_workbook_failed",key,{"source_sha256":source_sha},fail)
            raise

def get_calculation(workspace,params):
    from questionnaire_workspace import OperationError
    with workspace.connection() as db:
        row=db.execute("SELECT * FROM calculations WHERE id=?",(params["calculation_id"],)).fetchone()
        if row is None:raise OperationError("NOT_FOUND","The calculation is not retained")
        result={**dict(row),"params":json.loads(row["params"]),"result":None if row["result"] is None else json.loads(row["result"])}
        if result["result"]:_validate_files(workspace,result["result"])
        return result


def _answer_record(value,field,book):
    if value is None or value=="":return {"kind":"n","raw":None,"value":None}
    kind=field["kind"]
    if kind in {"number","integer"}:
        number=Decimal(str(value))/Decimal(field.get("workbook_scale","1"))
        return {"kind":"n","raw":format(number,"f"),"value":format(number,"f")}
    if kind=="date":
        day=date.fromisoformat(value)
        epoch=date(1904,1,1) if book["date1904"] else date(1899,12,31)
        serial=(day-epoch).days+(1 if not book["date1904"] and day>=date(1900,3,1) else 0)
        return {"kind":"n","raw":str(serial),"value":str(serial)}
    if kind=="boolean":return {"kind":"b","raw":"1" if value else "0","value":bool(value)}
    if kind=="choice" and field.get("choice_native_number"):
        number=format(Decimal(value),"f")
        return {"kind":"n","raw":number,"value":number}
    return {"kind":"str","raw":value,"value":value}

def write_response_inputs(original_bytes,definition,answers,source_sha256):
    """Write only declared original input cells, retaining all original formula XML."""
    from questionnaire_workspace import scalar
    book=read_xlsx(original_bytes);sheets={s["name"]:s for s in book["sheets"]};selected={};writes=[]
    def put(sheet,address,value,field):
        cell=sheets.get(sheet,{}).get("cells",{}).get(address)
        if cell is None or cell["formula"] is not None:raise ValueError("A response input must bind an existing original nonformula cell.")
        converted=scalar(field,value)
        selected.setdefault(sheet,{})[address]=_answer_record(converted,field,book)
        writes.append({"sheet":sheet,"cell":address,"value":converted,"kind":field["kind"]})
    for field in definition["questions"]:
        source=field.get("source",{})
        if source.get("workbook_sha256")!=source_sha256 or field.get("source_calculated") or "calculation" in field or field.get("source_readonly"):continue
        value=answers.get(field["id"])
        if field["kind"]=="table":
            rows=source_rows(source);values=value or []
            if not isinstance(values,list) or len(values)>len(rows):raise ValueError("Response rows exceed the exact original source row positions.")
            for index,row in enumerate(rows):
                entered=values[index] if index<len(values) else {}
                for column in field["columns"]:
                    if column.get("source_readonly"):continue
                    put(source["sheet"],column["source_column"]+str(row),entered.get(column["id"]),column)
        else:put(source["sheet"],source["cell"],value,field)
    replacements={}
    with zipfile.ZipFile(io.BytesIO(original_bytes)) as archive:
        for sheet,records in selected.items():
            member=sheets[sheet]["member"];replacements[member]=_patch_cells(archive.read(member),records)
    body,members=_replace_members(original_bytes,replacements)
    updated=read_xlsx(body)
    for before,after in zip(book["sheets"],updated["sheets"]):
        if set(before["cells"])!=set(after["cells"]):raise RuntimeError("Original response cell catalogue changed")
        for address,cell in before["cells"].items():
            changed=after["cells"][address]
            if cell["formula"]!=changed["formula"] or cell["style"]!=changed["style"]:raise RuntimeError("Original response formula/style changed")
            if address not in selected.get(before["name"],{}) and cell!=changed:raise RuntimeError("An undeclared original response cell changed")
    return body,{"schema":"atssc.original-response-inputs.v1","canonical_source_sha256":source_sha256,
        "answered_sha256":digest(body),"declared_cell_writes":writes,"members":members}

def calculate_response(workspace,params):
    """Authoritative native computed values before the original revision transaction."""
    respondent=workspace.invoke("get_respondent",{"respondent_id":params["respondent_id"]})
    definition=respondent["definition"];answers=params.get("answers",{})
    if not isinstance(answers,dict):raise ValueError("Native response answers must be keyed by original question identifier")
    computed={q["id"] for q in definition["questions"] if q.get("source_calculated")}
    if set(answers)&computed:raise ValueError("Original computed questions are readonly; native values come from the retained engine")
    selected_source=params.get("source_binding_sha256")
    if params.get("workbook_sha256"):
        if selected_source is None and len(definition.get("source_workbooks",[]))==1:selected_source=definition["source_workbooks"][0]
        if selected_source not in definition.get("source_workbooks",[]):raise ValueError("Select the original published source for this retained uploaded workbook")
    input_hash=digest(encoded({"respondent_id":params["respondent_id"],"publication_id":respondent["publication"]["id"],"definition":definition,"answers":answers,
        "workbook_sha256":params.get("workbook_sha256"),"source_binding_sha256":selected_source}).encode())
    successors=[];values={};issues=[];ids=[]
    for original_sha in definition.get("source_workbooks",[]):
        relevant=[q for q in definition["questions"] if q.get("source",{}).get("workbook_sha256")==original_sha]
        if not relevant:continue
        original=workspace.get_workbook_bytes(original_sha);name=workspace.workbook(original_sha)["name"]
        selected=original
        if params.get("workbook_sha256") and original_sha==selected_source:
            selected=workspace.get_workbook_bytes(params["workbook_sha256"])
            verify_source_successor(original,selected)
        answered,input_manifest=write_response_inputs(selected,definition,answers,original_sha)
        if selected is not original:input_manifest["retained_uploaded_sha256"]=params["workbook_sha256"]
        imported=workspace.invoke("import_workbook",{"name":"response-"+name,"data_base64":base64.b64encode(answered).decode(),"expected_sha256":digest(answered)})
        request={"request_id":"atssc-response-"+input_hash+"-"+original_sha[:12],"workbook_sha256":imported["sha256"],
            "source_binding_sha256":original_sha,"respondent_id":params["respondent_id"]}
        calculated=workspace.invoke("calculate_workbook",request);ids.append(calculated["calculation_id"])
        values.update({q:v for q,v in calculated.get("answers",{}).items() if q in computed})
        issues.extend(issue for issue in calculated.get("issues",[]) if issue["field"] in computed)
        directory=workspace.directory/"calculations"/calculated["calculation_id"]
        manifest_path=directory/"original-response-inputs.json"
        if manifest_path.exists() and json.loads(manifest_path.read_text())!=input_manifest:raise ValueError("The native response's declared input edition differs")
        manifest_path.write_text(json.dumps(input_manifest,ensure_ascii=False,indent=2)+"\n")
        successors.append({"source_sha256":original_sha,"answered_sha256":imported["sha256"],"calculated_sha256":calculated["calculated_sha256"],
            "calculation_id":calculated["calculation_id"],"original_input_manifest":manifest_path.relative_to(workspace.directory).as_posix()})
    result={"schema":"atssc.authoritative-native-response.v1","respondent_id":params["respondent_id"],"input_hash":input_hash,
        "computed_values":values,"formula_issues":issues,"calculation_ids":ids,"source_successor_bindings":successors}
    return result

OPERATIONS = {"calculate_workbook":calculate_workbook,"get_calculation":get_calculation,"calculate_response":calculate_response}
