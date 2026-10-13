#!/usr/bin/env python3
"""Expand original ATSSC shared formulas and map structural groups and dependencies."""
import argparse,array,collections,csv,hashlib,json,pathlib,re,sys,zipfile
import openpyxl
from openpyxl.formula import Tokenizer
from openpyxl.formula.translate import Translator

EXPECTED_ARCHIVE="f31ec3fef4ee808ada65afb66cfbf67114c7be8016ca6307bf664c56bffcab8e"
PREFIX="ATSSC_Original_Annexes/"
CATALOGUE=PREFIX+"derived/ATSSC_Original_Workbook_Collection.json"
MAX_ROW=1048576
MAX_COL=16384
CELL=re.compile(r"^(\$?)([A-Za-z]{1,3})(\$?)([1-9][0-9]*)$")
COLUMN=re.compile(r"^(\$?)([A-Za-z]{1,3})$")
ROW=re.compile(r"^(\$?)([1-9][0-9]*)$")
DYNAMIC={"INDIRECT","OFFSET"}
def canonical(value):
    return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(",",":"))
def identity(value):
    return hashlib.sha256(canonical(value).encode("utf-8")).hexdigest()
def sha_file(path):
    digest=hashlib.sha256()
    with pathlib.Path(path).open("rb") as stream:
        for block in iter(lambda:stream.read(1048576),b""):
            digest.update(block)
    return digest.hexdigest()
def write_json(path,value):
    with path.open("w",encoding="utf-8") as out:
        json.dump(value,out,ensure_ascii=False,indent=2);out.write("\n")
def write_csv(path,fields,rows):
    with path.open("w",encoding="utf-8",newline="") as out:
        writer=csv.DictWriter(out,fieldnames=fields,extrasaction="raise")
        writer.writeheader();writer.writerows(rows)
def col_number(text):
    value=0
    for char in text.upper():value=value*26+ord(char)-64
    return value
def address_parts(text):
    match=CELL.fullmatch(text)
    if not match:return None
    col=col_number(match[2]);row=int(match[4])
    if not 1<=col<=MAX_COL or not 1<=row<=MAX_ROW:return None
    return {"column":col,"row":row,"absolute_column":bool(match[1]),"absolute_row":bool(match[3])}
def range_parts(text):
    parts=text.split(":")
    if len(parts)==1:
        p=address_parts(parts[0])
        if p:return {"kind":"cell","bounds":[p["column"],p["row"],p["column"],p["row"]],"ends":[p]}
    if len(parts)==2:
        a,b=[address_parts(x) for x in parts]
        if a and b:
            return {"kind":"range","bounds":[min(a["column"],b["column"]),min(a["row"],b["row"]),max(a["column"],b["column"]),max(a["row"],b["row"])],"ends":[a,b]}
        a,b=[COLUMN.fullmatch(x) for x in parts]
        if a and b:
            ca,cb=col_number(a[2]),col_number(b[2])
            if 1<=ca<=MAX_COL and 1<=cb<=MAX_COL:
                return {"kind":"columns","bounds":[min(ca,cb),1,max(ca,cb),MAX_ROW],"ends":[{"column":ca,"absolute_column":bool(a[1])},{"column":cb,"absolute_column":bool(b[1])}]}
        a,b=[ROW.fullmatch(x) for x in parts]
        if a and b:
            ra,rb=int(a[2]),int(b[2])
            if 1<=ra<=MAX_ROW and 1<=rb<=MAX_ROW:
                return {"kind":"rows","bounds":[1,min(ra,rb),MAX_COL,max(ra,rb)],"ends":[{"row":ra,"absolute_row":bool(a[1])},{"row":rb,"absolute_row":bool(b[1])}]}
    return None
def broken_reference(token):
    outside=re.sub(r"'(?:[^']|'')*'","",token)
    return "#REF!" in outside.upper()
def split_sheet(token):
    if "!" not in token:return None,token
    sheet,tail=token.rsplit("!",1)
    if sheet.startswith("'") and sheet.endswith("'"):sheet=sheet[1:-1].replace("''","'")
    return sheet,tail
def in_bounds(cell,bounds):
    p=address_parts(cell)
    return bool(p and bounds[0]<=p["column"]<=bounds[2] and bounds[1]<=p["row"]<=bounds[3])
def normalize_endpoint(point,origin):
    output={}
    for axis in ("row","column"):
        if axis in point:
            absolute=point["absolute_"+axis]
            output[axis]=["absolute" if absolute else "relative",point[axis] if absolute else point[axis]-origin[axis]]
    return output
def parse_tokens(expression):
    return Tokenizer("="+expression.lstrip("=")).items
def token_signature(tokens):
    # WSPACE may represent an intersection; retain it in the normalized token stream.
    return [(t.type,t.subtype,t.value) for t in tokens]

class WorkbookModel:
    def __init__(self,workbook):
        self.workbook=workbook
        self.source=workbook["source"]
        self.sheets=workbook["worksheets"]
        self.by_name={s["name"]:s for s in self.sheets}
        self.sheet_lookup={s["name"].casefold():s["name"] for s in self.sheets}
        self.sheet_index={s["name"]:i for i,s in enumerate(self.sheets)}
        self.names={}
        for item in workbook["defined_names"]:
            scope=item["attributes"].get("localSheetId")
            key=(None if scope is None else int(scope),item["attributes"]["name"].casefold())
            if key in self.names:raise ValueError("Duplicate original defined-name scope")
            self.names[key]=item
        self.records=[]
        self.formulas_by_sheet=collections.defaultdict(list)
        self.index_by_address={}
        self.name_rows=[]
        self.issues=[]
        self.reference_rows=[]
        self.dependencies=[]
        self._expand()
    def _expand(self):
        for sheet in self.sheets:
            masters=collections.defaultdict(list)
            for cell in sheet["cells"]:
                formula=cell.get("formula")
                if formula and formula["attributes"].get("t")=="shared" and formula["text"]:
                    masters[formula["attributes"].get("si")].append(cell)
            for cell in sheet["cells"]:
                if "formula" not in cell:continue
                formula=cell["formula"];attrs=formula["attributes"];raw=formula["text"]
                effective=raw;status="original";anchor=None;error=None
                if attrs.get("t")=="shared":
                    candidates=masters.get(attrs.get("si"),[])
                    if len(candidates)!=1:
                        status="shared_master_ambiguous" if candidates else "shared_master_missing"
                        error="Expected one text-bearing shared master in the original worksheet"
                    else:
                        master=candidates[0];anchor=master["address"]
                        master_range=range_parts(master["formula"]["attributes"].get("ref",""))
                        if not master_range or not in_bounds(cell["address"],master_range["bounds"]):
                            status="shared_member_outside_range";error="Original master range does not contain this member"
                        elif raw:
                            status="shared_master"
                        else:
                            try:
                                effective=Translator("="+master["formula"]["text"],origin=anchor).translate_formula(cell["address"])[1:]
                                status="shared_expanded"
                                # Reverse translation checks actual inherited references and anchored axes.
                                back=Translator("="+effective,origin=cell["address"]).translate_formula(anchor)[1:]
                                if token_signature(parse_tokens(back))!=token_signature(parse_tokens(master["formula"]["text"])):
                                    raise ValueError("Shared formula translation did not return its original token sequence")
                            except Exception as exception:
                                effective=None;status="shared_translation_error";error=str(exception)
                index=len(self.records)
                item={"source_key":identity([self.source["sha256"],sheet["name"],cell["address"]]),
                    "workbook":self.source["filename"],"workbook_sha256":self.source["sha256"],
                    "role":self.workbook.get("questionnaire_role"),"worksheet":sheet["name"],"sheet_state":sheet["state"],
                    "cell":cell["address"],"original_formula":raw,"formula_attributes":attrs,
                    "effective_formula":effective,"expansion_status":status,"shared_anchor":anchor,
                    "cached_value":cell.get("raw_value"),"cached_type":cell["attributes"].get("t","n"),
                    "cell_attributes":cell["attributes"],"tokenization_error":error,"tokens":[],
                    "normalized_tokens":None,"shape_key":None,"group_key":None,"functions":[],
                    "dynamic_reference":False,"contains_reference_error":False,"contains_named_ref_error":False,"direct_formula_dependencies":[]}
                self.records.append(item)
                point=address_parts(cell["address"])
                self.formulas_by_sheet[sheet["name"]].append((point["column"],point["row"],index))
                self.index_by_address[(sheet["name"],cell["address"])]=index
                if error:self.issues.append({"source_key":item["source_key"],"kind":status,"detail":error})
    def selected_sheets(self,qualifier,current):
        if qualifier is None:return [current],None
        if "[" in qualifier or "]" in qualifier:return [],"external_workbook_reference"
        if ":" in qualifier:
            ends=qualifier.split(":")
            if len(ends)!=2:return [],"unresolved_sheet_span"
            names=[self.sheet_lookup.get(x.casefold()) for x in ends]
            if any(x is None for x in names):return [],"missing_sheet_span_endpoint"
            a,b=[self.sheet_index[x] for x in names]
            return [s["name"] for s in self.sheets[min(a,b):max(a,b)+1]],None
        name=self.sheet_lookup.get(qualifier.casefold())
        return ([name],None) if name is not None else ([], "missing_worksheet")
    def range_reference(self,token,current,origin,name_stack=()):
        qualifier,tail=split_sheet(token)
        if broken_reference(token):
            return {"reference":"broken_reference","token":token},[{"token":token,"kind":"broken_reference","worksheets":[],
                "bounds":None,"via_names":list(name_stack),"status":"original_reference_error","qualifier":qualifier}]
        selected,error=self.selected_sheets(qualifier,current)
        direct=range_parts(tail)
        if direct:
            signature={"reference":direct["kind"],"sheets":["SELF"] if qualifier is None else selected or [qualifier],
                "endpoints":[normalize_endpoint(p,origin) for p in direct["ends"]]}
            entries=[{"token":token,"kind":direct["kind"],"worksheets":selected,"bounds":direct["bounds"],
                "via_names":list(name_stack),"status":error or "resolved","qualifier":qualifier}]
            return signature,entries
        if any(x in tail for x in "[]") or error:
            return {"reference":"unresolved","token":token},[{"token":token,"kind":"unresolved","worksheets":selected,
                "bounds":None,"via_names":list(name_stack),"status":error or "structured_or_external_reference","qualifier":qualifier}]
        scope_sheet=selected[0] if len(selected)==1 else current
        scope=self.sheet_index[scope_sheet]
        binding=self.names.get((scope,tail.casefold())) or self.names.get((None,tail.casefold()))
        if not binding:
            return {"reference":"unresolved_name","token":token},[{"token":token,"kind":"name","worksheets":selected,
                "bounds":None,"via_names":list(name_stack),"status":"undefined_name","qualifier":qualifier}]
        name_key=identity([self.source["sha256"],"defined_name",binding["attributes"].get("localSheetId"),binding["attributes"]["name"]])
        signature={"reference":"defined_name","name":binding["attributes"]["name"],
            "scope":binding["attributes"].get("localSheetId"),"definition":binding["formula"]}
        entry={"token":token,"kind":"name","worksheets":selected,"bounds":None,"via_names":list(name_stack),
            "status":"resolved_name","name_key":name_key,"definition":binding["formula"],"qualifier":qualifier}
        entries=[entry]
        if name_key in name_stack:
            entry["status"]="defined_name_cycle";return signature,entries
        try:
            tokens=parse_tokens(binding["formula"])
            for part in tokens:
                if part.type=="OPERAND" and part.subtype=="RANGE":
                    q,t=split_sheet(part.value);p=range_parts(t)
                    if p and (q is None or any(not e.get("absolute_"+axis,True) for e in p["ends"] for axis in ("row","column") if axis in e)):
                        entries.append({"token":part.value,"kind":"name_dependency","worksheets":selected,"bounds":None,
                            "via_names":list(name_stack)+( [name_key] ),"status":"relative_name_requires_definition_context","qualifier":q})
                    else:
                        _,children=self.range_reference(part.value,scope_sheet,origin,(*name_stack,name_key));entries.extend(children)
                elif part.type=="OPERAND" and part.subtype=="ERROR":
                    entries.append({"token":part.value,"kind":"name_error","worksheets":selected,"bounds":None,
                        "via_names":list(name_stack)+[name_key],"status":"original_named_error","qualifier":None})
                elif part.type=="FUNC" and part.subtype=="OPEN" and part.value[:-1].upper() in DYNAMIC:
                    entry["status"]="dynamic_defined_name"
        except Exception as exception:
            entry["status"]="defined_name_parse_error";entry["error"]=str(exception)
        return signature,entries
    def build(self):
        for index,item in enumerate(self.records):
            expression=item["effective_formula"]
            if expression is None or item["tokenization_error"]:
                self.dependencies.append(array.array("I"));continue
            try:tokens=parse_tokens(expression)
            except Exception as exception:
                item["tokenization_error"]=str(exception)
                self.issues.append({"source_key":item["source_key"],"kind":"formula_parse_error","detail":str(exception)})
                self.dependencies.append(array.array("I"));continue
            item["tokens"]=[{"type":t.type,"subtype":t.subtype,"value":t.value} for t in tokens]
            normalized=[];edges=set();origin=address_parts(item["cell"])
            for token_index,token in enumerate(tokens):
                value=token.value
                if token.type=="OPERAND" and token.subtype=="RANGE":
                    signature,references=self.range_reference(value,item["worksheet"],origin)
                    normalized.append([token.type,token.subtype,signature])
                    for reference in references:
                        if reference["status"]=="original_named_error" and reference["token"]=="#REF!":item["contains_named_ref_error"]=True
                        if reference["status"]=="original_reference_error":item["contains_reference_error"]=True
                        direct_indices=[]
                        if reference["bounds"] is not None and reference["status"]=="resolved":
                            x1,y1,x2,y2=reference["bounds"]
                            for sheet in reference["worksheets"]:
                                for x,y,target in self.formulas_by_sheet[sheet]:
                                    if x1<=x<=x2 and y1<=y<=y2:
                                        edges.add(target);direct_indices.append(target)
                        self.reference_rows.append({"source_key":item["source_key"],"workbook":item["workbook"],
                            "worksheet":item["worksheet"],"cell":item["cell"],"token_index":token_index,
                            "token":reference["token"],"kind":reference["kind"],
                            "status":reference["status"],"target_worksheets_json":canonical(reference["worksheets"]),
                            "bounds_json":canonical(reference["bounds"]),"via_names_json":canonical(reference["via_names"]),
                            "referenced_formula_count":len(direct_indices)})
                        if reference["status"] not in ("resolved","resolved_name"):
                            self.issues.append({"source_key":item["source_key"],"kind":reference["status"],
                                "detail":canonical({"token":reference["token"],"via_names":reference["via_names"]})})
                else:
                    normalized.append([token.type,token.subtype,value.upper() if token.type=="FUNC" else value])
                if token.type=="FUNC" and token.subtype=="OPEN":item["functions"].append(value[:-1].upper())
                if token.type=="OPERAND" and token.subtype=="ERROR" and value=="#REF!":item["contains_reference_error"]=True
            item["dynamic_reference"]=any(x in DYNAMIC for x in item["functions"])
            item["normalized_tokens"]=normalized
            item["shape_key"]=identity(normalized)
            item["group_key"]=identity([self.source["sha256"],normalized])
            item["direct_formula_dependencies"]=[self.records[target]["source_key"] for target in sorted(edges)]
            self.dependencies.append(array.array("I",sorted(edges)))
        reverse=[array.array("I") for _ in self.records]
        for source,targets in enumerate(self.dependencies):
            for target in targets:reverse[target].append(source)
        # Reachability from the complete visible questionnaire is a conservative static dependency closure.
        visible={i for i,item in enumerate(self.records) if item["sheet_state"]=="visible"}
        reachable=set(visible);pending=list(visible)
        while pending:
            for target in self.dependencies[pending.pop()]:
                if target not in reachable:reachable.add(target);pending.append(target)
        inherited={i for i,item in enumerate(self.records) if item["contains_reference_error"]}
        named_ref_errors={i for i,item in enumerate(self.records) if item["contains_named_ref_error"]}
        affected=set(inherited)|named_ref_errors;pending=list(affected)
        while pending:
            for dependent in reverse[pending.pop()]:
                if dependent not in affected:affected.add(dependent);pending.append(dependent)
        groups={}
        for i,item in enumerate(self.records):
            item["referenced_by_visible_formula"]=i in reachable
            item["reference_error_dependency"]=i in affected
            key=item["group_key"]
            if key is not None:
                group=groups.setdefault(key,{"group_key":key,"shape_key":item["shape_key"],
                    "normalized_tokens":item["normalized_tokens"],"workbook":item["workbook"],"role":item["role"],
                    "members":[],"worksheets":set(),"functions":set(),"reference_error_members":0,"visible_members":0})
                group["members"].append({"source_key":item["source_key"],"worksheet":item["worksheet"],"cell":item["cell"]})
                group["worksheets"].add(item["worksheet"]);group["functions"].update(item["functions"])
                group["reference_error_members"]+=int(item["contains_reference_error"]);group["visible_members"]+=int(item["sheet_state"]=="visible")
        for group in groups.values():
            group["worksheets"]=sorted(group["worksheets"]);group["functions"]=sorted(group["functions"])
        sheet_summary=[]
        for sheet in self.sheets:
            indices=[index for _,_,index in self.formulas_by_sheet[sheet["name"]]]
            sheet_summary.append({"worksheet":sheet["name"],"state":sheet["state"],"formulas":len(indices),
                "structural_groups":len({self.records[i]["group_key"] for i in indices if self.records[i]["group_key"]}),
                "reachable_from_visible_formula":sum(i in reachable for i in indices),
                "original_reference_error_formulas":sum(i in inherited for i in indices),
                "formula_depends_on_original_ref_error":sum(i in affected for i in indices)})
        summary={"role":self.workbook.get("questionnaire_role"),"source":self.source,"formulas":len(self.records),
            "shared_expanded":sum(x["expansion_status"]=="shared_expanded" for x in self.records),
            "shared_masters":sum(x["expansion_status"]=="shared_master" for x in self.records),
            "parsed_formulas":sum(x["group_key"] is not None for x in self.records),
            "structural_groups":len(groups),"reference_tokens":len(self.reference_rows),
            "direct_formula_edges":sum(len(x) for x in self.dependencies),"visible_formulas":len(visible),
            "hidden_formulas_reachable_from_visible":len(reachable-visible),
            "original_reference_error_formulas":len(inherited),"original_named_ref_error_formulas":len(named_ref_errors),
            "visible_formulas_with_ref_dependency":sum(i in affected for i in visible),
            "issues_by_kind":dict(collections.Counter(x["kind"] for x in self.issues)),"sheets":sheet_summary,
            "functions":sorted({f for item in self.records for f in item["functions"]})}
        return summary,list(groups.values())

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("original_archive",type=pathlib.Path)
    parser.add_argument("--output",required=True,type=pathlib.Path)
    args=parser.parse_args()
    if sha_file(args.original_archive)!=EXPECTED_ARCHIVE:raise ValueError("Select the exact original Annex source archive")
    args.output.mkdir(parents=True,exist_ok=True)
    with zipfile.ZipFile(args.original_archive) as archive:
        if len(archive.namelist())!=len(set(archive.namelist())):raise ValueError("Duplicate original source members")
        with archive.open(CATALOGUE) as stream:catalog=json.load(stream)
        for workbook in catalog["workbooks"]:
            source=workbook["source"];raw=archive.read(PREFIX+"originals/"+source["filename"])
            if len(raw)!=source["bytes"] or hashlib.sha256(raw).hexdigest()!=source["sha256"]:raise ValueError("Original workbook identity differs")
    summaries=[];all_shapes=set();artifact_records=[]
    for workbook in catalog["workbooks"]:
        model=WorkbookModel(workbook);summary,groups=model.build();summaries.append(summary)
        all_shapes.update(x["shape_key"] for x in groups)
        slug=re.sub("[^a-z0-9]+","-",workbook.get("questionnaire_role","workbook").lower()).strip("-")
        target=args.output/slug;target.mkdir()
        write_json(target/"formula_occurrences.json",{"source":workbook["source"],"records":model.records})
        write_json(target/"structural_groups.json",{"source":workbook["source"],"groups":groups})
        write_json(target/"source_issues.json",{"source":workbook["source"],"issues":model.issues})
        source_text={"source":workbook["source"],"worksheets":[{"name":sheet["name"],"state":sheet["state"],"text_cells":[{"cell":cell["address"],"text":cell["text"]} for cell in sheet["cells"] if cell.get("text")],"original_error_cells":[cell for cell in sheet["cells"] if cell["attributes"].get("t")=="e"]} for sheet in workbook["worksheets"]]}
        write_json(target/"questionnaire_source_text.json",source_text)
        if workbook["source"]["sha256"]=="649106f345787fb9f3154b5f2fcd418503e4bbfe5b46b191e714c1d7370df8c4":
            selected=[sheet for sheet in source_text["worksheets"] if sheet["state"]=="visible" and (sheet["name"].startswith("Prod") or "Con - WT" in sheet["name"] or "Public Summary" in sheet["name"])]
            print(json.dumps({"stage":"ATSSC_C1_REMAINING_ORIGINAL_TEXT","worksheets":selected},ensure_ascii=False),flush=True)
            wanted={("Public",cell) for cell in ("B48","B73","B77","B81")}|{("Prod",cell) for cell in ("B129","B133","B137")}
            prompts=[item for item in model.records if (item["worksheet"],item["cell"]) in wanted]
            representatives=[]
            for sheet_name in ("Prod","Con - WT | ME","Public Summary | Résumé pub INT"):
                group_seen=set()
                for item in model.records:
                    if item["worksheet"]==sheet_name and item["group_key"] not in group_seen:
                        group_seen.add(item["group_key"])
                        representatives.append({key:item[key] for key in ("source_key","worksheet","cell","original_formula","effective_formula","cached_value","cached_type","group_key","functions")})
            pilot={"source":workbook["source"],"prompts":prompts,"rule_representatives":representatives,
                "visible_issues":[issue for issue in model.issues if any(item["source_key"]==issue["source_key"] and item["sheet_state"]=="visible" for item in model.records)],
                "hidden_formula_closure":[{key:item[key] for key in ("source_key","worksheet","cell","effective_formula")} for item in model.records if item["sheet_state"]!="visible" and item["referenced_by_visible_formula"]]}
            write_json(target/"C1_First_Family_Calculation_Boundary.json",pilot)
            print(json.dumps({"stage":"ATSSC_C1_FIRST_FAMILY_RULES","pilot":pilot},ensure_ascii=False),flush=True)
        external=[{key:item[key] for key in ("source_key","worksheet","cell","original_formula","effective_formula")} for item in model.records if any(ref["source_key"]==item["source_key"] and ref["status"]=="external_workbook_reference" for ref in model.reference_rows)]
        original_names=[item for item in workbook["defined_names"] if not item["attributes"]["name"].startswith("_xlnm.")]
        print(json.dumps({"stage":"ATSSC_ORIGINAL_EXTERNAL_AND_NAME_CASES","role":workbook.get("questionnaire_role"),"external_formula_cells":external,"defined_names":original_names},ensure_ascii=False),flush=True)
        ref_fields=["source_key","workbook","worksheet","cell","token_index","token","kind","status","target_worksheets_json","bounds_json","via_names_json","referenced_formula_count"]
        write_csv(target/"formula_references.csv",ref_fields,model.reference_rows)
        write_csv(target/"formula_dependency_edges.csv",["source_key","dependent_worksheet","dependent_cell","dependency_key","dependency_worksheet","dependency_cell"],
            ({"source_key":item["source_key"],"dependent_worksheet":item["worksheet"],"dependent_cell":item["cell"],
                "dependency_key":model.records[j]["source_key"],"dependency_worksheet":model.records[j]["worksheet"],"dependency_cell":model.records[j]["cell"]}
             for i,item in enumerate(model.records) for j in model.dependencies[i]))
        write_csv(target/"worksheet_dependencies.csv",["worksheet","state","formulas","structural_groups","reachable_from_visible_formula","original_reference_error_formulas","formula_depends_on_original_ref_error"],summary["sheets"])
        for path in sorted(target.iterdir()):
            artifact_records.append({"path":str(path.relative_to(args.output)),"bytes":path.stat().st_size,"sha256":sha_file(path)})
        print(json.dumps({"stage":"ATSSC_FORMULA_WORKBOOK_COMPLETE","summary":summary},ensure_ascii=False),flush=True)
        del model,groups
    result={"schema":"tjlabs.atssc.original-formula-dependencies.v1","analysis_revision":2,"original_archive_sha256":EXPECTED_ARCHIVE,
        "parser":{"package":"openpyxl","version":openpyxl.__version__,"method":"Read-only Tokenizer and A1 Translator; original workbook files remain byte-identical."},
        "workbooks":summaries,"totals":{"formula_occurrences":sum(x["formulas"] for x in summaries),
            "shared_followers_expanded":sum(x["shared_expanded"] for x in summaries),"shared_masters":sum(x["shared_masters"] for x in summaries),
            "parsed_formulas":sum(x["parsed_formulas"] for x in summaries),
            "workbook_structural_groups":sum(x["structural_groups"] for x in summaries),
            "cross_workbook_structural_shapes":len(all_shapes),"dependency_edges":sum(x["direct_formula_edges"] for x in summaries),
            "reference_tokens":sum(x["reference_tokens"] for x in summaries)},"files":artifact_records,
        "interpretation":{
            "grouping":"Structural token equality with anchored and relative reference axes preserved. A group is a migration candidate, not a certified equivalent business rule.",
            "dependencies":"Static formula references include cells, ranges, whole rows/columns, worksheet spans and resolvable absolute defined names. Source formulas and unresolved names/dynamic references remain explicit.",
            "visibility":"Visible-formula reachability is conservative static closure. Absence from that closure does not establish a hidden sheet is obsolete: external report consumers, named outputs and intended future inputs require separate source mapping.",
            "errors":"Original #REF! errors, including qualified broken references and retained named errors, are separate from original cached error values. Dependency reachability does not imply the affected branch executes for every answer.",
            "calculation":"This source projection expands inherited formula references and records dependencies; it does not execute the questionnaire or calculate respondent answers."}}
    if result["totals"]["formula_occurrences"]!=7661:raise ValueError("Every original formula occurrence must be retained")
    write_json(args.output/"ATSSC_Formula_Dependency_Inventory.json",result)
    print(json.dumps({"stage":"ATSSC_FORMULA_COLLECTION_COMPLETE","result":result},ensure_ascii=False),flush=True)
if __name__=="__main__":main()
