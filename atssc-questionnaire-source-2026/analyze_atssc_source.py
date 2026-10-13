#!/usr/bin/env python3
"""Build implementation tables from the complete original CITT workbook catalogue."""
import argparse, collections, csv, hashlib, json, pathlib, re, zipfile

EXPECTED_ARCHIVE_SHA256="f31ec3fef4ee808ada65afb66cfbf67114c7be8016ca6307bf664c56bffcab8e"
PREFIX="ATSSC_Original_Annexes/"
CATALOGUE=PREFIX+"derived/ATSSC_Original_Workbook_Collection.json"

def canonical(value):
    return json.dumps(value,ensure_ascii=False,separators=(",",":"),sort_keys=True)

def identity(parts):
    return hashlib.sha256(canonical(parts).encode("utf-8")).hexdigest()

def sha_file(path):
    result=hashlib.sha256()
    with pathlib.Path(path).open("rb") as source:
        for block in iter(lambda:source.read(1024*1024),b""):
            result.update(block)
    return result.hexdigest()

def write_json(path,value):
    path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")

def write_csv(path,fields,rows):
    with path.open("w",encoding="utf-8",newline="") as target:
        writer=csv.DictWriter(target,fieldnames=fields,extrasaction="raise")
        writer.writeheader()
        for row in rows:
            writer.writerow(row)

def function_names(formula):
    # Excel string literals and quoted sheet names are not executable function tokens.
    outside=re.sub(r'"(?:[^"]|"")*"|\'(?:[^\']|\'\')*\'',"",formula)
    return re.findall(r"(?<![A-Za-z0-9_.])([A-Za-z_][A-Za-z0-9_.]*)\s*(?=\()",outside)

def question_index(pages):
    records=[];current=None;occurrences=collections.Counter()
    start=re.compile(r"^\s*(\d+\.\d+(?:\.\d+)*|\d+\.\d+\s+\d+)(?=\s|[A-Za-z])\s*(.*)$")
    for page in pages:
        for line_number,line in enumerate(page["text"].splitlines(),1):
            # One actual issuer label is written '4.5 16'; preserve that printed form.
            match=re.match(r"^\s*(4\.5 16)\s+(.*)$",line) or start.match(line)
            if match:
                label=match.group(1);body=match.group(2)
                occurrences[label]+=1
                current={"source_key":f"annex-a:p{page['page']}:line{line_number}:{label}","printed_label":label,
                    "occurrence":occurrences[label],"page":page["page"],"line":line_number,
                    "kind":"section" if re.fullmatch(r"\d+\.0",label) else "question",
                    "text_lines":[body],"source_pages":[page["page"]]}
                records.append(current)
            elif current is not None and line.strip() and not re.fullmatch(r"\s*\d+\s*",line):
                current["text_lines"].append(line.rstrip())
                if page["page"] not in current["source_pages"]:
                    current["source_pages"].append(page["page"])
    for row in records:
        row["source_text"]="\n".join(row.pop("text_lines")).strip()
    return records

def inspect_source(archive_path,output):
    archive_path=pathlib.Path(archive_path);output=pathlib.Path(output)
    if sha_file(archive_path)!=EXPECTED_ARCHIVE_SHA256:
        raise ValueError("Select the complete original acquired Annex edition")
    output.mkdir(parents=True,exist_ok=True)
    with zipfile.ZipFile(archive_path) as archive:
        if len(archive.namelist())!=len(set(archive.namelist())):
            raise ValueError("Duplicate original source archive members")
        with archive.open(CATALOGUE) as source:
            catalog=json.load(source)
        if catalog.get("schema")!="tjlabs.atssc-original-workbook-collection.v1":
            raise ValueError("Receive the full original workbook catalogue")
        manifest=json.loads(archive.read(PREFIX+"ATSSC_Original_Annex_Source_Manifest.json"))
        for workbook in catalog["workbooks"]:
            source=workbook["source"];raw=archive.read(PREFIX+"originals/"+source["filename"])
            if len(raw)!=source["bytes"] or hashlib.sha256(raw).hexdigest()!=source["sha256"]:
                raise ValueError("The original workbook and catalogue differ")
        annex=next(row for row in manifest["sources"] if row["role"]=="annex_a")
    formula_rows=[];name_rows=[];sheet_rows=[];error_rows=[];function_rows=[]
    sheet_case=[]
    for workbook in catalog["workbooks"]:
        source=workbook["source"];role=workbook["questionnaire_role"];wb_sha=source["sha256"]
        summary={"role":role,"source":source,"worksheets":len(workbook["worksheets"]),"defined_cells":0,
            "empty_styled_cells":0,"literal_values":0,"text_cells":0,"formula_cells":0,
            "formula_expressions_with_ref_error":0,"cached_error_cells":0,"array_formula_cells":0,
            "shared_formula_cells":0,"defined_names":len(workbook["defined_names"]),"broken_defined_names":0,
            "hidden_worksheets":[],"functions":{}}
        names=collections.Counter()
        for item in workbook["defined_names"]:
            attributes=item["attributes"];scope=attributes.get("localSheetId")
            row={"source_key":identity([wb_sha,"defined_name",scope,attributes["name"]]),"role":role,
                "workbook":source["filename"],"workbook_sha256":wb_sha,"local_sheet_id_json":canonical(scope),
                "name":attributes["name"],"formula":item["formula"],"attributes_json":canonical(attributes),
                "contains_ref_error":"true" if "#REF!" in item["formula"] else "false"}
            name_rows.append(row)
            summary["broken_defined_names"]+=int(row["contains_ref_error"]=="true")
        for sheet in workbook["worksheets"]:
            state=sheet["state"]
            if state!="visible":summary["hidden_worksheets"].append(sheet["name"])
            formulas=[cell for cell in sheet["cells"] if "formula" in cell]
            source_errors=[cell for cell in sheet["cells"] if cell["attributes"].get("t")=="e"]
            empty_styled=sum(cell.get("raw_value") is None and "text" not in cell and "formula" not in cell for cell in sheet["cells"])
            summary["defined_cells"]+=len(sheet["cells"]);summary["empty_styled_cells"]+=empty_styled
            summary["formula_cells"]+=len(formulas);summary["cached_error_cells"]+=len(source_errors)
            summary["text_cells"]+=sum("text" in cell for cell in sheet["cells"])
            summary["literal_values"]+=sum("formula" not in cell and cell.get("raw_value") is not None for cell in sheet["cells"])
            sheet_rows.append({"source_key":identity([wb_sha,"sheet",sheet["name"]]),"role":role,
                "workbook":source["filename"],"workbook_sha256":wb_sha,"worksheet":sheet["name"],"state":state,
                "dimension":sheet.get("dimension") or "","defined_cells":len(sheet["cells"]),
                "empty_styled_cells":empty_styled,"formula_cells":len(formulas),"cached_error_cells":len(source_errors),
                "validation_rules":len(sheet["validations"]),"comments":len(sheet.get("comments",[])),
                "sheet_protection_json":canonical(sheet["sheet_protection"])})
            for cell in formulas:
                raw_formula=cell["formula"]["text"];attrs=cell["formula"]["attributes"]
                functions=function_names(raw_formula)
                names.update(functions)
                summary["formula_expressions_with_ref_error"]+=int("#REF!" in raw_formula)
                summary["array_formula_cells"]+=int(attrs.get("t")=="array")
                summary["shared_formula_cells"]+=int(attrs.get("t")=="shared")
                formula_rows.append({"source_key":identity([wb_sha,sheet["name"],cell["address"]]),"role":role,
                    "workbook":source["filename"],"workbook_sha256":wb_sha,"worksheet":sheet["name"],"sheet_state":state,
                    "cell":cell["address"],"formula":raw_formula,"formula_attributes_json":canonical(attrs),
                    "cached_value_json":canonical(cell.get("raw_value")),"cached_type":cell["attributes"].get("t","n"),
                    "cell_attributes_json":canonical(cell["attributes"]),"functions_json":canonical(functions),
                    "contains_ref_error":"true" if "#REF!" in raw_formula else "false"})
            for cell in source_errors:
                error_rows.append({"source_key":identity([wb_sha,sheet["name"],cell["address"]]),"role":role,
                    "workbook":source["filename"],"workbook_sha256":wb_sha,"worksheet":sheet["name"],"sheet_state":state,
                    "cell":cell["address"],"original_error":cell.get("raw_value"),"formula_json":canonical(cell.get("formula")),
                    "cell_attributes_json":canonical(cell["attributes"])})
        summary["functions"]=dict(sorted(names.items()))
        summary["distinct_original_formula_texts"]=len(set(row["formula"] for row in formula_rows if row["workbook_sha256"]==wb_sha))
        for function,count in sorted(names.items()):
            function_rows.append({"role":role,"workbook":source["filename"],"workbook_sha256":wb_sha,"function":function,"occurrences":count})
        sheet_case.append(summary)
    fields=[
        ("workbook_sheets.csv",list(sheet_rows[0]),sheet_rows),
        ("workbook_formulas.csv",list(formula_rows[0]),formula_rows),
        ("workbook_defined_names.csv",list(name_rows[0]),name_rows),
        ("original_cached_errors.csv",list(error_rows[0]) if error_rows else ["source_key","role","workbook","workbook_sha256","worksheet","sheet_state","cell","original_error","formula_json","cell_attributes_json"],error_rows),
        ("formula_function_inventory.csv",list(function_rows[0]),function_rows)]
    for filename,columns,rows in fields:
        write_csv(output/filename,columns,rows)
    questions=question_index(annex["pages"])
    write_json(output/"annex_a_numbered_source_index.json",{"source":{key:annex["response"][key] for key in ("bytes","sha256","resolved_url")},"entries":questions})
    duplicates={}
    for record in questions:
        duplicates.setdefault(record["printed_label"],[]).append({"source_key":record["source_key"],"page":record["page"],"line":record["line"]})
    duplicates={key:value for key,value in duplicates.items() if len(value)>1}
    summary={
        "schema":"tjlabs.atssc.workbook-implementation-inventory.v1",
        "operation_id":"ATSSC-QUESTIONNAIRE-PARTNER-WORKSHARE-6CF6-20261012",
        "original_archive":{"filename":archive_path.name,"bytes":archive_path.stat().st_size,"sha256":EXPECTED_ARCHIVE_SHA256},
        "workbooks":sheet_case,
        "totals":{"workbooks":len(sheet_case),"worksheets":len(sheet_rows),"defined_cells":sum(row["defined_cells"] for row in sheet_case),
            "empty_styled_cells":sum(row["empty_styled_cells"] for row in sheet_case),
            "formula_cells":len(formula_rows),"original_cached_error_cells":len(error_rows),
            "formula_expressions_with_ref_error":sum(row["formula_expressions_with_ref_error"] for row in sheet_case)},
        "annex_a":{"physical_pages":len(annex["pages"]),"numbered_entries":len(questions),"duplicate_printed_labels":duplicates,
            "preserved_irregular_labels":[row["printed_label"] for row in questions if " " in row["printed_label"]]},
        "tables":[{"filename":filename,"rows":len(rows),"columns":columns,"sha256":sha_file(output/filename),"bytes":(output/filename).stat().st_size} for filename,columns,rows in fields],
        "interpretation":[
            "Defined cells include formatted blank cells; they are not a count of respondent questions.",
            "Formula rows retain original expressions and cached values. Cached errors belong to the received example edition.",
            "Formula function inventory is lexical classification; it does not calculate, translate or repair the original expressions.",
            "Keys use exact JSON tuples before hashing, preserving worksheet spaces, pipes and locally scoped defined names.",
            "Numbered Annex A entries retain page and line identity, including repeated or irregular printed labels.",
            "Use the original source catalogue for full cell text, styles, validations, relationships and comments; the implementation tables are complete focused projections."
        ]
    }
    write_json(output/"ATSSC_Workbook_Implementation_Inventory.json",summary)
    return summary

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive",type=pathlib.Path)
    parser.add_argument("--output",type=pathlib.Path,required=True)
    args=parser.parse_args()
    print(json.dumps(inspect_source(args.archive,args.output),ensure_ascii=False))
if __name__=="__main__":
    main()
