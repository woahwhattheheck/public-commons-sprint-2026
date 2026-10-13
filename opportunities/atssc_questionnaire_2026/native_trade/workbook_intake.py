"""Complete original-cell questionnaire intake for retained native workbooks.

Source styles, merged anchors, validations and disclosure markers determine
editable answer fields. Every original cell and hidden/operator origin remains
in the source catalogue. Original native calculated metrics use native tokens.
"""
from __future__ import annotations
import csv
import fcntl
import hashlib
import io
import json
import re
import uuid
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET
from workbooks import read_xlsx,MAIN,cell_parts,col_letters,range_cells
from workbook_calculation import definition_native_bindings,encoded,timestamp,digest

ROLES={"c1":"Foreign producers","c2":"Importers and purchasers","c3":"Domestic producers","c4":"Unions","c5":"Certification and attestation"}
BUILTIN_FORMATS={0:"General",1:"0",2:"0.00",3:"#,##0",4:"#,##0.00",9:"0%",10:"0.00%",14:"mm-dd-yy",15:"d-mmm-yy",16:"d-mmm",17:"mmm-yy",18:"h:mm AM/PM",19:"h:mm:ss AM/PM",20:"h:mm",21:"h:mm:ss",22:"m/d/yy h:mm"}

def _id(sha,sheet,identity):
    return "s_"+sha[:10]+"_"+hashlib.sha256(sheet.encode()).hexdigest()[:8]+"_"+identity.lower().replace(":","_")

def _atomic_file(path,body):
    pending=path.with_name(path.name+".pending-"+uuid.uuid4().hex)
    pending.write_bytes(body);pending.replace(path)

def _styles(body):
    with zipfile.ZipFile(io.BytesIO(body)) as archive:
        root=ET.fromstring(archive.read("xl/styles.xml"));formats=dict(BUILTIN_FORMATS)
        for item in root.findall(MAIN+"numFmts/"+MAIN+"numFmt"):formats[int(item.get("numFmtId"))]=item.get("formatCode")
        result=[]
        for item in root.find(MAIN+"cellXfs"):
            protection=item.find(MAIN+"protection")
            result.append({"attributes":dict(item.attrib),"unlocked":protection is not None and protection.get("locked")=="0",
                "number_format":formats.get(int(item.get("numFmtId","0")),"General")})
        book=ET.fromstring(archive.read("xl/workbook.xml"))
        names=[{"attributes":dict(x.attrib),"formula":x.text or ""} for x in book.findall(MAIN+"definedNames/"+MAIN+"definedName")]
        return result,names

def _class(sheet):
    markers=[str(sheet["cells"].get("B"+str(row),{}).get("value") or "").strip().upper() for row in range(1,4)]
    if "PUBLIC" in markers:return "public","source-public-marker"
    if any("PROTECTED" in v or "CONFIDENTIAL" in v for v in markers):return "protected","source-protected-marker"
    return "protected","operator-classification-required"

def _labels(sheet,row):
    def text(address):
        value=sheet["cells"].get(address,{}).get("value")
        return value.strip() if isinstance(value,str) and value.strip() and set(value.strip())!={"A"} else ""
    label=text("B"+str(row))
    if not label:
        for earlier in range(row-1,max(0,row-7),-1):
            candidate=text("B"+str(earlier))
            if candidate and not re.fullmatch(r"Question\s+\d+(?:\s*\([^)]*\))?",candidate,re.I):label=candidate;break
    return label or "Original answer at row "+str(row),text("J"+str(row)) or text("K"+str(row))

def _context(sheet,row):
    heading=None;prompt="";french=""
    for earlier in range(row,max(0,row-80),-1):
        value=sheet["cells"].get("B"+str(earlier),{}).get("value")
        if isinstance(value,str) and re.match(r"^Question\s+\d+",value.strip(),re.I):
            heading={"cell":"B"+str(earlier),"text":value.strip()}
            for line in range(earlier+1,min(row,earlier+6)+1):
                text=sheet["cells"].get("B"+str(line),{}).get("value")
                if isinstance(text,str) and len(text.strip())>35 and not re.match(r"^Question\s+\d+",text,re.I):prompt=text.strip();break
            break
    if prompt:
        for address,cell in sheet["cells"].items():
            r,c=cell_parts(address)
            if heading and heading["cell"]=="B"+str(r-1) and c>=6 and isinstance(cell["value"],str) and len(cell["value"].strip())>35:
                french=cell["value"].strip();break
    return heading,prompt,french

def _validation(sheet,address):
    row,col=cell_parts(address)
    for value in sheet["validations"]:
        for part in value.get("sqref","").split():
            ends=part.replace("$","").split(":")
            try:r1,c1=cell_parts(ends[0]);r2,c2=cell_parts(ends[-1])
            except ValueError:continue
            if r1<=row<=r2 and c1<=col<=c2:return value
    return None

def _choices(validation,book,names,sheet):
    if isinstance(sheet,dict):sheet=sheet["name"]
    formula=((validation or {}).get("formula1") or "").lstrip("=")
    if formula.startswith('"') and formula.endswith('"'):
        return next(csv.reader([formula[1:-1]]))
    local=re.fullmatch(r"\$?([A-Z]+)\$?([1-9][0-9]*):\$?([A-Z]+)\$?([1-9][0-9]*)",formula)
    if local:formula="'"+sheet.replace("'","''")+"'!"+formula
    match=re.fullmatch(r"(?:'((?:[^']|'')+)'|([^!]+))!\$?([A-Z]+)\$?([1-9][0-9]*):\$?([A-Z]+)\$?([1-9][0-9]*)",formula)
    if match:
        target=(match[1] or match[2]).replace("''", "'")
        original=next((x for x in book["sheets"] if x["name"]==target),None)
        if original:
            addresses=range_cells(match[3]+match[4]+":"+match[5]+match[6])
            values=[original["cells"].get(a,{}).get("value") for a in addresses]
            return list(dict.fromkeys(v for v in values if isinstance(v,str) and v))
    # Named validators are retained even when the original named reference is
    # unavailable; the operator sees its exact original definition in catalogue.
    return []

def _type(cell,style,validation,label,book,names,sheet):
    result={"kind":"text","source_number_format":style["number_format"]}
    choices=_choices(validation,book,names,sheet)
    if choices:result.update(kind="choice",choices=choices)
    elif validation and validation.get("type") in {"whole","decimal"}:result["kind"]="integer" if validation["type"]=="whole" else "number"
    elif validation and validation.get("type")=="date":result["kind"]="date"
    elif cell["kind"]=="b":result["kind"]="boolean"
    elif style["number_format"]!="General":
        result["kind"]="date" if re.search(r"[dy]",style["number_format"],re.I) and not any(t in style["number_format"] for t in ("#","0")) else "number"
    elif not re.search(r"explain|describe|comment|reason|names?|addresses?|website|signature",label,re.I) and re.search(r"volume|value|cost|price|employees|hours|wages|percentage|percent|capacity|quantit|number of|minimum|maximum|revenue|sales|production",label,re.I) and cell["kind"]=="n":result["kind"]="number"
    elif cell["value"] is not None and cell["kind"]=="n":result["kind"]="number"
    if "%" in style["number_format"] and result["kind"]=="number":result.update(unit="%",workbook_scale="100")
    if validation:
        result["original_validation"]=validation
        if validation.get("type") in {"whole","decimal"}:
            try:
                from decimal import Decimal
                a=validation.get("formula1");b=validation.get("formula2");Decimal(a)
                if validation.get("operator")=="between" and b is not None:Decimal(b);result.update(minimum=a,maximum=b)
                elif validation.get("operator")=="greaterThanOrEqual":result["minimum"]=a
                elif validation.get("operator")=="lessThanOrEqual":result["maximum"]=a
            except Exception:pass
    if choices and not (validation.get("formula1") or "").startswith('"'):
        try:
            from decimal import Decimal
            for value in choices:Decimal(value)
            result["choice_native_number"]=True
        except Exception:pass
    return result

def _source_unit(sheet,address):
    row,column=cell_parts(address)
    for earlier in range(row-1,max(0,row-5),-1):
        candidate=col_letters(column)+str(earlier)
        value=sheet["cells"].get(candidate,{}).get("value")
        if isinstance(value,str) and value.strip() in {"%","Percent","Percentage","Pourcentage"}:
            return {"cell":candidate,"text":value.strip()}
    return None

def compile_definition(workspace,source_sha256,classifications=None):
    body=workspace.get_workbook_bytes(source_sha256);book=read_xlsx(body);styles,names=_styles(body)
    with workspace.connection() as db:
        row=db.execute("SELECT result FROM calculations WHERE source_sha=? AND state='complete' ORDER BY created LIMIT 1",(source_sha256,)).fetchone()
    if row is None:raise ValueError("Calculate this complete original workbook before compiling its native source fields.")
    calculation=json.loads(row["result"]);graph=calculation["native_precedents"]
    native_book=workspace.workbook(calculation["calculated_sha256"])
    native_sheets={x["name"]:x for x in native_book["sheets"]}
    name=workspace.workbook(source_sha256)["name"];role=next((v for k,v in ROLES.items() if "annex-"+k+"-" in name.lower()),"Original questionnaire")
    questions=[];catalogue=[];operator_sources=[];classifications=classifications or {};input_coordinates=set()
    for sheet in book["sheets"]:
        disclosure,provenance=_class(sheet)
        followers=set()
        for merged in sheet["mergedRanges"]:
            addresses=range_cells(merged);followers.update(addresses[1:])
        editable={}
        for address,cell in sheet["cells"].items():
            style=styles[int(cell["style"] or 0)];row,column=cell_parts(address)
            classification=classifications.get(sheet["name"]+"!"+address,{})
            marker=classification.get("disclosure",disclosure)
            if marker not in {"public","protected"}:raise ValueError("Original-cell classification must be public or protected.")
            category="formula" if cell["formula"] else "input" if style["unlocked"] and address not in followers else "merged-follower" if address in followers else "source-label-or-layout"
            record={"sheet":sheet["name"],"cell":address,"state":sheet["state"],"category":category,
                "source_disclosure":marker,"classification_provenance":"operator-classification" if classification else provenance,
                "style":cell["style"],"number_format":style["number_format"],"formula":cell["formula"],"value":cell["value"],
                "original_validation":_validation(sheet,address)}
            catalogue.append(record)
            if category=="input" and sheet["state"]=="visible":editable.setdefault(row,[]).append((address,cell,style,classification,marker))
        if sheet["state"]!="visible":
            operator_sources.append({"sheet":sheet["name"],"state":sheet["state"],"cells":[x for x in catalogue if x["sheet"]==sheet["name"]],
                "source_kind":"variable-template" if sheet["name"]=="Variables" else "original-hidden-calculation-or-report"})
        for row,entries in sorted(editable.items()):
            entries.sort(key=lambda x:cell_parts(x[0])[1]);label,french=_labels(sheet,row)
            heading,prompt,context_french=_context(sheet,row)
            def field(address,cell,style,override,marker):
                value=_type(cell,style,_validation(sheet,address),label,book,names,sheet)
                unit=_source_unit(sheet,address)
                if unit and style["number_format"]=="General" and value["kind"]=="text" and cell["value"] in {None,""}:
                    value.update(kind="number",unit="%",source_type_provenance={"method":"original-unit-header",**unit})
                value.update({k:v for k,v in override.items() if k in {"kind","choices","minimum","maximum","unit"}})
                return {**value,"label":override.get("label",label),"disclosure":marker,"required":False}
            base={"section":sheet["name"],"original_question_text":prompt or label,"original_row_label":label,"original_french_text":context_french or french,
                "classification_provenance":provenance,"source_workbook_name":name}
            if heading:base["original_question_heading"]=heading
            if len(entries)==1:
                address,cell,style,override,marker=entries[0]
                question={**base,**field(*entries[0]),"id":_id(source_sha256,sheet["name"],address),
                    "source":{"workbook_sha256":source_sha256,"sheet":sheet["name"],"cell":address}}
            else:
                columns=[]
                for entry in entries:
                    address=entry[0];column=col_letters(cell_parts(address)[1]);header=""
                    for earlier in range(row-1,max(0,row-9),-1):
                        value=sheet["cells"].get(column+str(earlier),{}).get("value")
                        if value not in {None,""} and str(value).strip() not in {"A","AA","AAA","AAAA"}:header=str(value);break
                    columns.append({**field(*entry),"id":"c_"+column.lower(),"source_column":column,"label":header or "Original column "+column})
                question={**base,"id":_id(source_sha256,sheet["name"],entries[0][0]+"_"+entries[-1][0]),
                    "kind":"table","label":label,"disclosure":disclosure,"columns":columns,"max_rows":1,"required":False,
                    "source":{"workbook_sha256":source_sha256,"sheet":sheet["name"],"start_row":row,"end_row":row,"rows":[row]}}
            questions.append(question);input_coordinates.update((sheet["name"],e[0]) for e in entries)
        # Native metric outputs are readonly. Source headers/navigation remain
        # in the full catalogue, including original metadata and template years.
        if sheet["state"]=="visible":
            for address,cell in sheet["cells"].items():
                if cell["formula"] is None or address in followers:continue
                row,column=cell_parts(address);style=styles[int(cell["style"] or 0)];label,french=_labels(sheet,row)
                if column<3:continue
                metric=(style["number_format"]!="General" or "SUMMARY" in sheet["name"].upper() and row>=16 or "RÉSUMÉ" in sheet["name"].upper() and row>=16)
                if not metric:continue
                value=native_sheets[sheet["name"]]["cells"][address]
                # Numeric source formats remain numeric when a blank source
                # uses a display marker (for example IFERROR(...,"-")).
                # Classifying that original marker as text would discard later
                # numeric native values from consolidation and numeric totals.
                numeric_format=style["number_format"]!="General" and bool(re.search(r"[0#]",style["number_format"]))
                indicator=bool(re.search(r'"X"',cell["formula"].get("text","") or "",re.I))
                textual=value["kind"] in {"str","s","inlineStr"} and value["value"] not in {None,"","-","–","—"}
                kind="text" if indicator or textual else "boolean" if value["kind"]=="b" else "number" if value["kind"]=="n" or numeric_format else "text"
                question={"id":_id(source_sha256,sheet["name"],address),"label":label+" — "+address,"kind":kind,"required":False,
                    "disclosure":disclosure,"section":sheet["name"],"source_calculated":True,"source_number_format":style["number_format"],
                    "original_formula":cell["formula"],"original_french_text":french,"original_native_status":"formula_error" if value["kind"]=="e" else "calculated",
                    "source":{"workbook_sha256":source_sha256,"sheet":sheet["name"],"cell":address}}
                if kind=="number" and "%" in style["number_format"]:question.update(unit="%",workbook_scale="100")
                if kind=="number" and value["value"] in {"-","–","—"}:question["native_empty_markers"]=[value["value"]]
                questions.append(question)
    definition={"title":role+" — original NQ-2023-001 questionnaire","source_workbooks":[source_sha256],"questions":questions,"rules":[],
        "source_intake":{"schema":"atssc.original-family-definition.v1","compiler_version":3,"source_sha256":source_sha256,"original_name":name,
            "original_sheet_count":book["sheetCount"],"original_cell_count":book["cellCount"],"original_formula_count":book["formulaCount"],
            "source_role":role,"defined_names":names,"hidden_operator_origins":[{"sheet":x["sheet"],"state":x["state"],"source_kind":x["source_kind"]} for x in operator_sources]}}
    joined=definition_native_bindings(definition,source_sha256,graph);by_id={q["id"]:q for q in questions}
    input_by_sheet={}
    for sheet,address in input_coordinates:input_by_sheet.setdefault(sheet,[]).append((cell_parts(address),address))
    for binding in joined:
        question=by_id[binding["question_id"]]
        if not question.get("source_calculated"):continue
        question["native_dependencies"]=binding["native_dependencies"]
        question["native_source_coordinates"]=binding["native_reference_ranges"]
        # A protected source input outside the selected answer fields still
        # propagates into a public cached metric's disclosure classification.
        protected=False
        for ref in binding["native_reference_ranges"]:
            original=next(s for s in book["sheets"] if s["name"]==ref["sheet"])
            if _class(original)[0]!="protected":continue
            for address,cell in original["cells"].items():
                r,c=cell_parts(address)
                if ref["start_row"]<=r<=ref["end_row"] and ref["start_column"]<=c<=ref["end_column"] and not cell["formula"] and styles[int(cell["style"] or 0)]["unlocked"]:
                    if (original["name"],address) not in input_coordinates:protected=True
        question["native_protected_dependencies"]=protected
    from questionnaire_workspace import validate_definition
    validate_definition(definition)
    return {"definition":definition,"catalogue":{"schema":"atssc.complete-original-cell-classification.v1","source_sha256":source_sha256,
        "cells":catalogue,"operator_sources":operator_sources,"defined_names":names,"styles":styles},
        "summary":{"role":role,"question_count":len(questions),"input_cell_count":len(input_coordinates),
            "calculated_question_count":sum(bool(q.get("source_calculated")) for q in questions),"original_cell_count":book["cellCount"],
            "classification_required_cell_count":sum(x["classification_provenance"]=="operator-classification-required" for x in catalogue)}}

def import_workbook_definition(workspace,params):
    # Compilation and normal nested API writes run outside any SQL lock. Each
    # nested mutation has its own stable identity, so an interrupted HTTP call
    # resumes its original questionnaire rather than creating another one.
    source=params["workbook_sha256"]
    request=getattr(workspace.context,"request",None) or {}
    operation=digest(("original-intake:"+(request.get("request_id") or str(uuid.uuid4()))).encode())
    root=workspace.directory/"source-evidence"/"workbook-intakes";root.mkdir(parents=True,exist_ok=True)
    with (root/"operation.lease").open("a+") as lease:
        fcntl.flock(lease,fcntl.LOCK_EX)
        cached=workspace._cached_mutation("import_workbook_definition")
        if cached is not None:return cached
        directory=root/source/("operation-"+operation);directory.mkdir(parents=True,exist_ok=True)
        retained=directory/"request.json"
        identity=encoded({k:v for k,v in params.items() if k not in {"request_id","_actor"}})+"\n"
        if retained.exists() and retained.read_text()!=identity:
            from questionnaire_workspace import OperationError
            raise OperationError("REQUEST_CONFLICT","The retained original intake request belongs to different inputs")
        _atomic_file(retained,identity.encode())
        manifest_path=directory/"compiled-manifest.json"
        if manifest_path.exists():
            manifest=json.loads(manifest_path.read_text());compiled={}
            for item in manifest["files"]:
                body=(directory/item["path"]).read_bytes()
                if len(body)!=item["bytes"] or digest(body)!=item["sha256"]:raise ValueError("The retained original intake source differs")
                compiled[item["name"]]=json.loads(body)
        else:
            compiled=compile_definition(workspace,source,params.get("classifications"));files=[]
            for name,value in compiled.items():
                body=(json.dumps(value,ensure_ascii=False,indent=2)+"\n").encode()
                _atomic_file(directory/(name+".json"),body)
                files.append({"name":name,"path":name+".json","bytes":len(body),"sha256":digest(body)})
            _atomic_file(manifest_path,(json.dumps({"schema":"atssc.compiled-original-intake.v1","source_sha256":source,"files":files},indent=2)+"\n").encode())
        key=params.get("questionnaire_id")
        if not key:key=workspace.invoke("create_questionnaire",{"name":compiled["definition"]["title"],"request_id":"source-intake-create-"+operation})["questionnaire_id"]
        saved=workspace.invoke("save_definition",{"questionnaire_id":key,"expected_version":params.get("expected_version",0),
            "definition":compiled["definition"],"request_id":"source-intake-definition-"+operation})
        result={"questionnaire_id":key,"version":saved["version"],"definition":compiled["definition"],"summary":compiled["summary"],
            "catalogue_path":(directory/"catalogue.json").relative_to(workspace.directory).as_posix()}
        return workspace._write("import_workbook_definition",key,{"source_sha256":source,"definition_version":saved["version"]},lambda db:result)

OPERATIONS={"import_workbook_definition":import_workbook_definition}
