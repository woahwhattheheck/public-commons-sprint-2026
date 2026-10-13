"""Complete original-cell questionnaire intake for retained native workbooks.

Source styles, merged anchors, validations and disclosure markers determine
editable answer fields. Every original cell and hidden/operator origin remains
in the source catalogue. Original native calculated metrics use native tokens.
"""
from __future__ import annotations
import csv
import copy
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
        fonts=list(root.find(MAIN+"fonts"))
        for item in root.findall(MAIN+"numFmts/"+MAIN+"numFmt"):formats[int(item.get("numFmtId"))]=item.get("formatCode")
        result=[]
        for item in root.find(MAIN+"cellXfs"):
            protection=item.find(MAIN+"protection")
            font=fonts[int(item.get("fontId","0"))]
            result.append({"attributes":dict(item.attrib),"unlocked":protection is not None and protection.get("locked")=="0",
                "number_format":formats.get(int(item.get("numFmtId","0")),"General"),"bold":font.find(MAIN+"b") is not None,
                "font_size":font.find(MAIN+"sz").get("val") if font.find(MAIN+"sz") is not None else None})
        book=ET.fromstring(archive.read("xl/workbook.xml"))
        names=[{"attributes":dict(x.attrib),"formula":x.text or ""} for x in book.findall(MAIN+"definedNames/"+MAIN+"definedName")]
        return result,names

def _class(sheet):
    markers=[str(sheet["cells"].get("B"+str(row),{}).get("value") or "").strip().upper() for row in range(1,4)]
    if "PUBLIC" in markers:return "public","source-public-marker"
    if any("PROTECTED" in v or "CONFIDENTIAL" in v for v in markers):return "protected","source-protected-marker"
    return "protected","operator-classification-required"

def _source_text(cell,allow_year=False):
    if not cell:return ""
    value=cell.get("value")
    if not isinstance(value,str) or not value.strip() or set(value.strip())=={"A"}:return ""
    if value.strip() in {"-","–","—","X","x","%"} or re.fullmatch(r"[-+]?[0-9]+(?:\.[0-9]+)?",value.strip()) and not (allow_year and YEAR_HEADER.fullmatch(value.strip())):return ""
    if cell.get("kind") not in {"s","str","inlineStr"}:
        if not allow_year or not re.fullmatch(r"(?:19|20|21)[0-9]{2}",value.strip()):return ""
    return value.strip()

def _label_context(sheet,row):
    def text(address):
        return _source_text(sheet["cells"].get(address),True)
    label=text("B"+str(row));label_row=row
    if not label:
        for earlier in range(row-1,max(0,row-7),-1):
            candidate=text("B"+str(earlier))
            if candidate and not re.fullmatch(r"Question\s+\d+(?:\s*\([^)]*\))?",candidate,re.I):label=candidate;label_row=earlier;break
    french="";french_cell=None
    styles=sheet.get("_source_styles",[])
    heading_rows=[r for r in sheet.get("_heading_rows",[]) if r<=label_row]
    start=heading_rows[-1] if heading_rows else 1
    period_rows=[r for r in sheet.get("_period_headers",{}) if start<=r<=label_row]
    answer_columns=set(sheet["_period_headers"][max(period_rows)]) if period_rows else set()
    # Translations align with the original label/prompt row. Confirmation
    # answers are often on the next row (for example B44/E44 -> D45).
    row_cells=sheet.get("_row_cells",{}).get(label_row)
    if row_cells is None:row_cells=[(a,c) for a,c in sheet["cells"].items() if cell_parts(a)[0]==label_row]
    for address,cell in row_cells:
        r,c=cell_parts(address)
        if c<3 or c in answer_columns:continue
        if styles and styles[int(cell["style"] or 0)]["unlocked"]:continue
        value=_source_text(cell)
        if value and not YEAR_HEADER.fullmatch(value):french=value;french_cell=address;break
    return {"label":label or "Original answer at row "+str(row),"french":french,
        "english_cell":"B"+str(label_row) if label else None,"french_cell":french_cell}

def _labels(sheet,row):
    resolved=_label_context(sheet,row)
    return resolved["label"],resolved["french"]

def _context(sheet,row):
    heading=None;prompt="";french=""
    candidates=[r for r in sheet.get("_heading_rows",[]) if r<=row]
    for earlier in reversed(candidates) if candidates else range(row,max(0,row-80),-1):
        value=sheet["cells"].get("B"+str(earlier),{}).get("value")
        if isinstance(value,str) and re.match(r"^Question\s+\d+",value.strip(),re.I):
            heading={"cell":"B"+str(earlier),"text":value.strip()}
            for line in range(earlier+1,min(row,earlier+6)+1):
                text=sheet["cells"].get("B"+str(line),{}).get("value")
                if _source_text(sheet["cells"].get("B"+str(line))) and len(text.strip())>35 and not re.match(r"^Question\s+\d+",text,re.I):prompt=text.strip();break
            break
    if prompt:
        for address,cell in sheet.get("_row_cells",{}).get(cell_parts(heading["cell"])[0]+1,[]):
            r,c=cell_parts(address)
            if heading and heading["cell"]=="B"+str(r-1) and c>=3 and _source_text(cell) and len(cell["value"].strip())>35:
                french=cell["value"].strip();break
    return heading,prompt,french

YEAR_HEADER=re.compile(r"^(?:(?:FY|Fiscal year)\s*)?(?:19|20|21)[0-9]{2}(?:\s*[-/]\s*(?:[0-9]{2}|(?:19|20|21)[0-9]{2}))?$",re.I)
PERIOD_BAND=re.compile(r"\b(?:jan(?:uary|vier)?|june?|juin|dec(?:ember)?|déc(?:embre)?|mar(?:ch|s)?|sept(?:ember|embre)?|fiscal|interim|annual|annuel|quarter|trimestre|calendar|civil)\b",re.I)

def _presentation_sheet(original,native,styles):
    display={**original,"cells":native["cells"],"_source_styles":styles}
    display["_row_cells"]={}
    for address,cell in native["cells"].items():display["_row_cells"].setdefault(cell_parts(address)[0],[]).append((address,cell))
    for cells in display["_row_cells"].values():cells.sort(key=lambda item:cell_parts(item[0])[1])
    display["_heading_rows"]=sorted(cell_parts(a)[0] for a,c in native["cells"].items() if cell_parts(a)[1]==2 and re.match(r"^Question\s+[0-9]",_source_text(c),re.I))
    years={};merged=[]
    for address,cell in native["cells"].items():
        value=str(cell.get("value") or "").strip();row,col=cell_parts(address)
        style=styles[int(cell["style"] or 0)]
        if not style["unlocked"] and (YEAR_HEADER.fullmatch(value) or _source_text(cell) and style["bold"] and len(value)<=60 and PERIOD_BAND.search(value) and re.search(r"(?:19|20|21)[0-9]{2}",value)):
            years.setdefault(row,{})[col]=address
    display["_period_headers"]={r:cs for r,cs in years.items() if len(cs)>=2}
    for area in original["mergedRanges"]:
        a,b=area.split(":") if ":" in area else (area,area);r1,c1=cell_parts(a);r2,c2=cell_parts(b)
        cell=native["cells"].get(a);text=_source_text(cell)
        if not cell or not text:continue
        style=styles[int(cell["style"] or 0)]
        if style["unlocked"]:continue
        merged.append({"row":r1,"end_row":r2,"start_column":c1,"end_column":c2,"cell":a,"range":area,"text":text,
            "bold":style["bold"],"style_identity":(style["attributes"].get("fontId"),style["attributes"].get("fillId"))})
    display["_merged_context"]=sorted(merged,key=lambda x:(x["row"],x["start_column"]))
    return display

def _header_context(sheet,row,columns):
    selected=set(columns);headings=[r for r in sheet["_heading_rows"] if r<=row];start=headings[-1] if headings else 1
    candidates=[r for r,cs in sheet["_period_headers"].items() if start<=r<row and len(selected&set(cs))>=min(2,len(selected))]
    header=max(candidates) if candidates else None;result={};groups=[]
    for col in columns:
        if header is not None and col in sheet["_period_headers"][header]:
            address=sheet["_period_headers"][header][col];year=str(sheet["cells"][address]["value"])
            bands=[m for m in sheet["_merged_context"] if max(start,header-3)<=m["row"]<header and m["start_column"]<=col<=m["end_column"]
                and m["bold"] and PERIOD_BAND.search(m["text"]) and len(m["text"])<=80]
            label=year+"".join(" — "+m["text"] for m in bands)
            result[col]={"label":label,"header_cell":address,"year":year,"period_bands":[{k:m[k] for k in ("cell","range","text")} for m in bands]}
        else:
            for earlier in range(row-1,start-1,-1):
                address=col_letters(col)+str(earlier);cell=sheet["cells"].get(address)
                merge=next((m for m in sheet["_merged_context"] if m["row"]==earlier and m["start_column"]<=col<=m["end_column"]),None)
                if merge and len(selected&set(range(merge["start_column"],merge["end_column"]+1)))==len(selected):continue
                if merge:address=merge["cell"];cell=sheet["cells"].get(address)
                if not cell or sheet["_source_styles"][int(cell["style"] or 0)]["unlocked"]:continue
                value=_source_text(cell)
                if not value and sheet["_source_styles"][int(cell["style"] or 0)]["bold"] and sheet["_source_styles"][int(cell["style"] or 0)]["number_format"]=="General":
                    numeric=str(cell.get("value") or "")
                    if re.fullmatch(r"[1-9][0-9]?",numeric):value=numeric
                if value and len(value)<=120:
                    result[col]={"label":value,"header_cell":address,"period_bands":[]};break
    # Original merged bands use repeatable font/fill identities to express
    # parent and child groups. A newer sibling replaces its previous sibling;
    # the original country/measure remains distinct from the period header.
    levels={};stack=[]
    group_start=max(start,header-3) if header else start
    for band in sheet["_merged_context"]:
        if not group_start<=band["row"]<row or not band["bold"] or len(band["text"])>180:continue
        overlap=len(selected&set(range(band["start_column"],band["end_column"]+1)))
        if not overlap or overlap<len(selected)*.75 or YEAR_HEADER.fullmatch(band["text"]) or PERIOD_BAND.search(band["text"]) or re.match(r"^Question\s+[0-9]",band["text"],re.I):continue
        identity=band["style_identity"];level=levels.setdefault(identity,len(levels))
        stack=[s for s in stack if s[0]<level];stack.append((level,band))
    groups=[{k:b[k] for k in ("cell","range","text")} for _,b in stack]
    # Left-hand measure and subgroup labels are separate original cells, not
    # column headers. In particular, domestic production distinguishes tolling
    # from production without a tolling agreement beneath the same periods.
    if header:
        named_groups={}
        for earlier in range(header,row):
            address="B"+str(earlier);cell=sheet["cells"].get(address);text=_source_text(cell)
            if not text or len(text)>180:continue
            style=sheet["_source_styles"][int(cell["style"] or 0)]
            name_group=re.match(r"^(Exporter|Customer|Supplier|Producer|Purchaser|Importer|Distributor)\s*[0-9]*\s*[-–:]?\s*Name\b",text,re.I)
            if style["bold"] and not style["unlocked"] and (earlier==header or name_group or not any(sheet["_source_styles"][int(c["style"] or 0)]["unlocked"] for a,c in sheet["_row_cells"].get(earlier,[]) if cell_parts(a)[1] in selected)):
                # Subsequent original subtotal labels contain formula values
                # and do not become the next entered row's subgroup heading.
                if earlier!=header and any(c.get("formula") and cell_parts(a)[1] in selected for a,c in sheet["_row_cells"].get(earlier,[])):continue
                entry={"cell":address,"text":text}
                if name_group:named_groups[name_group[1].casefold()]=entry
                else:groups.append(entry)
        groups.extend(named_groups.values())
    return {"header_row":header,"columns":result,"groups":groups}

def _context_pair(sheet,entry):
    text=entry["text"].strip();french=""
    if "|" in text:
        text,french=(x.strip() for x in text.split("|",1))
    else:
        row,col=cell_parts(entry["cell"])
        for address,cell in sheet["_row_cells"].get(row,[]):
            r,c=cell_parts(address)
            if c<max(5,col+1) or sheet["_source_styles"][int(cell["style"] or 0)]["unlocked"]:continue
            candidate=_source_text(cell)
            if candidate and candidate!=text:
                french=candidate;break
    return {"text":text,"french_text":french}

def _question_display(sheet,question):
    source=question["source"]
    row=cell_parts(source["cell"])[0] if source.get("cell") else (source.get("rows") or [source["start_row"]])[0]
    columns=[cell_parts(source["cell"])[1]] if source.get("cell") else [cell_parts(c["source_column"]+"1")[1] for c in question["columns"]]
    label,french=_labels(sheet,row);heading,prompt,context_french=_context(sheet,row)
    context=_header_context(sheet,row,columns);groups=[]
    for entry in context["groups"]:
        pair=_context_pair(sheet,entry)
        if pair["text"]!=label and pair not in groups:groups.append(pair)
    display={"section":sheet["name"],"original_question_text":prompt or label,"original_row_label":label,
        "original_row_french_label":french,"original_french_text":context_french or french,"original_context":groups,
        "original_display_source":{"schema":"atssc.original-display-context.v4","row":row,"headers":context,"row_labels":_label_context(sheet,row)}}
    if heading:display["original_question_heading"]=heading
    parts=[g["text"] for g in groups]+[label]
    if question.get("source_calculated"):
        period=context["columns"].get(columns[0])
        if period:
            text=period["label"];en,fr=(x.strip() for x in text.split("|",1)) if "|" in text else (text,text)
            # Bilingual bands begin after the year. Retain the original year
            # in both locales instead of displaying a bare translated band.
            if re.match(r"^(?:19|20|21)[0-9]{2}\s*—",text) and "|" in text:fr=text[:4]+" — "+fr
            display["original_period_context"]={"label":en,"french_label":fr}
            display["original_context"]=[*groups,{"text":en,"french_text":fr,"kind":"period"}]
            parts.append(en)
        parts.append(source["cell"])
    display["label"]=" — ".join(dict.fromkeys(x for x in parts if x))
    if question["kind"]=="table":
        display["columns"]=[]
        for column in question["columns"]:
            col=cell_parts(column["source_column"]+"1")[1];period=context["columns"].get(col)
            label=(period or {}).get("label") or "Original column "+column["source_column"]
            display["columns"].append({"id":column["id"],"label":label})
    elif question["kind"]=="choice" and source.get("cell"):
        column=columns[0];english=sheet["cells"].get(col_letters(column-1)+str(row));translated=sheet["cells"].get(col_letters(column+1)+str(row))
        option=_source_text(english);french_option=_source_text(translated)
        if option.casefold() in {"yes","no"} and french_option.casefold() in {"oui","non"}:
            display["original_answer_option"]={"label":option,"french_label":french_option}
            display["label"]+=" — "+option
            # A source checkmark has its original X value. Its labelled Yes/No
            # row supplies presentation only and does not change the key.
            if question.get("choices")==["X"]:
                display["original_choice_labels"]={"X":option};display["original_choice_french_labels"]={"X":french_option}
            display["original_display_source"]["answer_option"]={"english_cell":col_letters(column-1)+str(row),"french_cell":col_letters(column+1)+str(row)}
    return display

def source_display_definition(workspace,definition):
    """Overlay source-owned static presentation without changing a publication.

    Original answer schemas, coordinates, native dependencies and accepted
    editions remain intact. Each complete original/native source presentation
    is reusable after receiving the entire project, with pinned source hashes.
    """
    if (definition.get("source_intake") or {}).get("schema")!="atssc.original-family-definition.v1":return definition
    result=copy.deepcopy(definition);source=definition["source_intake"]["source_sha256"]
    source_questions=[q for q in definition["questions"] if q.get("source",{}).get("workbook_sha256")==source]
    implementation_sha256=digest(Path(__file__).read_bytes())
    identity=digest(encoded({"version":4,"implementation_sha256":implementation_sha256,"source":source,"questions":[{"id":q["id"],"source":q["source"],"columns":q.get("columns"),"calculated":q.get("source_calculated")} for q in source_questions]}).encode())
    root=workspace.directory/"source-evidence"/"native-presentations"/source;root.mkdir(parents=True,exist_ok=True)
    path=root/("context-v4-"+identity+".json")
    if path.exists():
        retained=json.loads(path.read_text());body=encoded(retained["questions"]).encode()
        if retained.get("identity")!=identity or digest(body)!=retained.get("sha256"):raise ValueError("The retained original display context differs")
        displays=retained["questions"]
    else:
        original=read_xlsx(workspace.get_workbook_bytes(source));styles,_=_styles(workspace.get_workbook_bytes(source))
        with workspace.connection() as db:
            row=db.execute("SELECT result FROM calculations WHERE source_sha=? AND state='complete' ORDER BY created LIMIT 1",(source,)).fetchone()
        if row is None:raise ValueError("The original complete native source calculation is required for display context")
        calculated=json.loads(row["result"])["calculated_sha256"];native=workspace.workbook(calculated)
        native_sheets={s["name"]:s for s in native["sheets"]}
        sheets={s["name"]:_presentation_sheet(s,native_sheets[s["name"]],styles) for s in original["sheets"]}
        displays={q["id"]:_question_display(sheets[q["source"]["sheet"]],q) for q in source_questions}
        # JSON object keys are strings after receiving. Normalize the geometry
        # keys before hashing so columns J+ retain the same canonical identity.
        displays=json.loads(encoded(displays))
        retained={"schema":"atssc.original-display-context.v4","identity":identity,"source_sha256":source,"native_source_sha256":calculated,
            "implementation_sha256":implementation_sha256,"sha256":digest(encoded(displays).encode()),"questions":displays}
        _atomic_file(path,(json.dumps(retained,ensure_ascii=False,indent=2)+"\n").encode())
    for question in result["questions"]:
        display=displays.get(question["id"])
        if display is None:continue
        for key,value in display.items():
            if key!="columns":question[key]=value
        if "columns" in display:
            labels={c["id"]:c for c in display["columns"]}
            for column in question["columns"]:column["label"]=labels[column["id"]]["label"]
    result["source_display_context"]={"schema":"atssc.original-display-context.v4","identity":identity,"source_sha256":source}
    return result

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
    elif cell["kind"] in {"s","str","inlineStr"} and cell["value"] not in {None,""}:
        result.update(kind="text",source_type_provenance={"method":"original-text-cell","original_kind":cell["kind"]})
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
        presentation=_presentation_sheet(sheet,native_sheets[sheet["name"]],styles)
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
            entries.sort(key=lambda x:cell_parts(x[0])[1]);label,french=_labels(presentation,row)
            heading,prompt,context_french=_context(presentation,row)
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
            display=_question_display(presentation,question)
            for key,value in display.items():
                if key!="columns":question[key]=value
            if "columns" in display:
                headers={c["id"]:c["label"] for c in display["columns"]}
                for column in question["columns"]:column["label"]=headers[column["id"]]
            if len(entries)==1 and entries[0][3].get("label"):question["label"]=entries[0][3]["label"]
            questions.append(question);input_coordinates.update((sheet["name"],e[0]) for e in entries)
        # Native metric outputs are readonly. Source headers/navigation remain
        # in the full catalogue, including original metadata and template years.
        if sheet["state"]=="visible":
            for address,cell in sheet["cells"].items():
                if cell["formula"] is None or address in followers:continue
                row,column=cell_parts(address);style=styles[int(cell["style"] or 0)];label,french=_labels(presentation,row)
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
                question.update(_question_display(presentation,question))
                questions.append(question)
    definition={"title":role+" — original NQ-2023-001 questionnaire","source_workbooks":[source_sha256],"questions":questions,"rules":[],
        "source_intake":{"schema":"atssc.original-family-definition.v1","compiler_version":5,"source_sha256":source_sha256,"original_name":name,
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
