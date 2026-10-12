#!/usr/bin/env python3
"""Read complete OOXML questionnaire structure without changing or executing it."""
import argparse, hashlib, json, pathlib, posixpath, re, xml.etree.ElementTree as ET, zipfile

MAIN="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG="http://schemas.openxmlformats.org/package/2006/relationships"
N={"s":MAIN}

def digest(raw):
    return hashlib.sha256(raw).hexdigest()

def text_value(node):
    if node is None:
        return None
    # Phonetic annotations are separate metadata, not duplicate visible text.
    direct=node.find("s:t",N)
    if direct is not None:
        return direct.text or ""
    return "".join((run.find("s:t",N).text or "") for run in node.findall("s:r",N) if run.find("s:t",N) is not None)

def inspect_workbook(path):
    path=pathlib.Path(path)
    raw=path.read_bytes()
    with zipfile.ZipFile(path) as book:
        members=book.namelist()
        if len(members)!=len(set(members)):
            raise ValueError("Duplicate OOXML members in "+path.name)
        for name in members:
            if name.startswith("/") or "\\" in name or any(part==".." for part in name.split("/")):
                raise ValueError("Invalid OOXML member path")
        workbook=ET.fromstring(book.read("xl/workbook.xml"))
        relationships=ET.fromstring(book.read("xl/_rels/workbook.xml.rels"))
        rels={element.attrib["Id"]:dict(element.attrib) for element in relationships}
        shared=[]
        if "xl/sharedStrings.xml" in members:
            shared=[text_value(element) for element in ET.fromstring(book.read("xl/sharedStrings.xml")).findall("s:si",N)]
        styles={"number_formats":[],"cell_styles":[]}
        if "xl/styles.xml" in members:
            style_root=ET.fromstring(book.read("xl/styles.xml"))
            styles["number_formats"]=[dict(x.attrib) for x in style_root.findall("s:numFmts/s:numFmt",N)]
            styles["cell_styles"]=[{"index":i,"attributes":dict(x.attrib),"protection":None if x.find("s:protection",N) is None else dict(x.find("s:protection",N).attrib)} for i,x in enumerate(style_root.findall("s:cellXfs/s:xf",N))]
        sheets=[]
        for element in workbook.findall("s:sheets/s:sheet",N):
            info=dict(element.attrib)
            relationship=rels.get(info.get("{"+REL+"}id"))
            if not relationship or relationship.get("TargetMode")=="External":
                raise ValueError("Worksheet must have its original internal relationship")
            target=relationship["Target"]
            part=posixpath.normpath(target.lstrip("/") if target.startswith("/") else posixpath.join("xl",target))
            if not part.startswith("xl/") or part not in members:
                raise ValueError("Worksheet part is unavailable: "+part)
            tree=ET.fromstring(book.read(part))
            cells=[];seen=set();row_metadata=[]
            for row in tree.findall("s:sheetData/s:row",N):
                if any(key!="r" for key in row.attrib):
                    row_metadata.append(dict(row.attrib))
                for cell in row.findall("s:c",N):
                    address=cell.attrib.get("r")
                    if not address or not re.fullmatch(r"[A-Z]+[1-9][0-9]*",address) or address in seen:
                        raise ValueError("Invalid or duplicate original worksheet cell: "+str(address))
                    seen.add(address)
                    value_node=cell.find("s:v",N)
                    value=None if value_node is None else (value_node.text or "")
                    type_code=cell.attrib.get("t","n")
                    resolved=None
                    if type_code=="s" and value is not None:
                        if not value.isdigit() or int(value)>=len(shared):
                            raise ValueError("Invalid original shared-string reference at "+address)
                        resolved=shared[int(value)]
                    elif type_code=="inlineStr":
                        resolved=text_value(cell.find("s:is",N))
                    elif type_code=="str":
                        resolved=value
                    formula=cell.find("s:f",N)
                    item={"address":address,"attributes":dict(cell.attrib),"raw_value":value}
                    if resolved is not None:item["text"]=resolved
                    if formula is not None:item["formula"]={"text":formula.text or "","attributes":dict(formula.attrib)}
                    cells.append(item)
            validations=[]
            for rule in tree.findall("s:dataValidations/s:dataValidation",N):
                validations.append({"attributes":dict(rule.attrib),"formula1":rule.findtext("s:formula1",None,N),"formula2":rule.findtext("s:formula2",None,N)})
            hyperlinks=[dict(x.attrib) for x in tree.findall("s:hyperlinks/s:hyperlink",N)]
            protection=tree.find("s:sheetProtection",N)
            dimension=tree.find("s:dimension",N)

            sheet_rels=[]
            sheet_rel_part=posixpath.join(posixpath.dirname(part),"_rels",posixpath.basename(part)+".rels")
            if sheet_rel_part in members:
                sheet_rels=[dict(x.attrib) for x in ET.fromstring(book.read(sheet_rel_part))]
            comments=[]
            for relation in sheet_rels:
                if relation.get("Type","").endswith("/comments") and relation.get("TargetMode")!="External":
                    target=relation["Target"]
                    comment_part=posixpath.normpath(target.lstrip("/") if target.startswith("/") else posixpath.join(posixpath.dirname(part),target))
                    if comment_part not in members:raise ValueError("Missing original cell comment part")
                    comment_root=ET.fromstring(book.read(comment_part))
                    authors=[x.text or "" for x in comment_root.findall("s:authors/s:author",N)]
                    for comment in comment_root.findall("s:commentList/s:comment",N):
                        comments.append({"attributes":dict(comment.attrib),"text":text_value(comment.find("s:text",N)),"authors":authors})
            sheets.append({
                "name":info["name"],"sheet_id":info.get("sheetId"),"state":info.get("state","visible"),"part":part,
                "dimension":None if dimension is None else dimension.attrib.get("ref"),
                "cells":cells,"rows":row_metadata,
                "columns":[dict(x.attrib) for x in tree.findall("s:cols/s:col",N)],
                "merged_ranges":[x.attrib.get("ref") for x in tree.findall("s:mergeCells/s:mergeCell",N)],
                "validations":validations,
                "sheet_protection":None if protection is None else dict(protection.attrib),
                "hyperlinks":hyperlinks,"relationships":sheet_rels,"comments":comments,
                "summary":{"defined_cells":len(cells),"formula_cells":sum("formula" in x for x in cells),"text_cells":sum("text" in x for x in cells),"validation_rules":len(validations)}
            })
        properties=workbook.find("s:workbookPr",N)
        calculation=workbook.find("s:calcPr",N)
        result={
            "schema":"tjlabs.atssc-original-workbook-structure.v1",
            "source":{"filename":path.name,"bytes":len(raw),"sha256":digest(raw)},
            "workbook_properties":None if properties is None else dict(properties.attrib),
            "calculation_properties":None if calculation is None else dict(calculation.attrib),
            "defined_names":[{"attributes":dict(x.attrib),"formula":x.text or ""} for x in workbook.findall("s:definedNames/s:definedName",N)],
            "relationships":list(rels.values()),"original_members":[{"path":item.filename,"bytes":item.file_size,"crc32":format(item.CRC,"08x")} for item in book.infolist()],
            "styles":styles,"worksheets":sheets,
            "summary":{"worksheets":len(sheets),"defined_cells":sum(x["summary"]["defined_cells"] for x in sheets),"formula_cells":sum(x["summary"]["formula_cells"] for x in sheets),"hidden_worksheets":[x["name"] for x in sheets if x["state"]!="visible"]},
            "interpretation":"Original XML values, formulas, mappings, styles and cached values are retained. Formula expressions are not evaluated by this reader."
        }
        return result

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workbooks",nargs="+",type=pathlib.Path)
    parser.add_argument("--output",required=True,type=pathlib.Path)
    args=parser.parse_args()
    result={"schema":"tjlabs.atssc-original-workbook-collection.v1","workbooks":[inspect_workbook(x) for x in args.workbooks]}
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(json.dumps({"output":str(args.output),"workbooks":[{"source":x["source"],"summary":x["summary"]} for x in result["workbooks"]]},ensure_ascii=False))
if __name__=="__main__":
    main()
