# MIT. HUD domain projection using the ORIGINAL maintained public XLSX reader.
# FD 3: immutable workbook; FD 4: exclusive JSONL index; FD 5: trusted reader source.
import os, sys, json, hashlib, re
def main():
    raw=sys.stdin.buffer.read(262145)
    if len(raw)>262144: raise ValueError("HUD_REQUEST_CAPACITY")
    request=json.loads(raw)
    with os.fdopen(os.dup(5),"r",encoding="utf-8") as source: reader=source.read(262145)
    if len(reader.encode())>262144: raise ValueError("HUD_READER_CAPACITY")
    namespace={"__name__":"hud_original_workbook_reader"}
    exec(compile(reader,"maintained-workbook-reader.py","exec"),namespace)
    Workbook=namespace["Workbook"]
    with os.fdopen(os.dup(3),"rb") as source:
        workbook=Workbook(source,request["source"])
        year=request["fiscalYear"]
        if type(year) is not int or not 2000<=year<=2099: raise ValueError("HUD_FISCAL_YEAR_REQUIRED")
        sheet_name="Section8-FY"+str(year)[-2:]
        sheet=workbook.sheet(sheet_name)
        expected=["fips","stusps","state","state_name","hud_area_code","hud_area_name","county","County_Name","county_town_name","metro","median"+str(year)]
        expected += ["l50_"+str(n) for n in range(1,9)]+["ELI_"+str(n) for n in range(1,9)]+["l80_"+str(n) for n in range(1,9)]
        meta=sheet["metadata"]
        if meta["state"]!="visible" or sheet["merged"] or sheet["hidden"] or any(x["hidden"] for x in meta["columnRanges"]):
            raise ValueError("HUD_WORKSHEET_VISIBILITY_REVIEW")
        if sheet["bounds"] is None or sheet["bounds"][0:2]!=(1,1) or sheet["bounds"][2]!=35:
            raise ValueError("HUD_WORKSHEET_COLUMNS_CHANGED")
        columns={}
        for c,label in enumerate(expected,1):
            cell=sheet["cells"].get((c,1),{})
            if cell.get("formula") or cell.get("type")!="string" or cell.get("value")!=label:
                raise ValueError("HUD_HEADER_CHANGED:"+namespace["column_label"](c)+"1")
            columns[label]=namespace["column_label"](c)
        source_rows=sheet["bounds"][3]-1
        if source_rows<1 or source_rows>100000: raise ValueError("HUD_LOCALITY_CAPACITY")
        seen=set();state_counts={};county_counts={};areas=set();digest=hashlib.sha256();size=0
        with os.fdopen(os.dup(4),"wb") as dest:
            for r in range(2,sheet["bounds"][3]+1):
                values={}
                for c,label in enumerate(expected,1):
                    cell=sheet["cells"].get((c,r),{})
                    value=cell.get("value")
                    if cell.get("formula") or cell.get("type") not in ("string","number") or not isinstance(value,str) or not value:
                        raise ValueError("HUD_PUBLISHED_CELL_INVALID:"+columns[label]+str(r))
                    if c<=9 and cell["type"]!="string":
                        raise ValueError("HUD_IDENTIFIER_MUST_REMAIN_TEXT:"+columns[label]+str(r))
                    if c>=10 and (cell["type"]!="number" or not re.fullmatch(r"0|[1-9][0-9]*",value) or int(value)>9007199254740991):
                        raise ValueError("HUD_PUBLISHED_INTEGER_INVALID:"+columns[label]+str(r))
                    values[label]=value
                if not re.fullmatch(r"[0-9]{10}",values["fips"]) or not re.fullmatch(r"[0-9]{2}",values["state"]) or not re.fullmatch(r"[0-9]{3}",values["county"]):
                    raise ValueError("HUD_LOCALITY_IDENTIFIER_CHANGED")
                if values["metro"] not in ("0","1"): raise ValueError("HUD_METRO_VALUE_CHANGED")
                if values["fips"][:5]!=values["state"]+values["county"]: raise ValueError("HUD_COUNTY_IDENTITY_CHANGED")
                if values["fips"] in seen: raise ValueError("HUD_DUPLICATE_LOCALITY")
                seen.add(values["fips"]);areas.add(values["hud_area_code"])
                state_counts[values["state"]]=state_counts.get(values["state"],0)+1
                county=values["state"]+values["county"];county_counts[county]=county_counts.get(county,0)+1
                line=(json.dumps({"row":r,"values":values},ensure_ascii=False,separators=(",",":"))+"\n").encode()
                size+=len(line)
                if size>64*1024**2: raise ValueError("HUD_INDEX_CAPACITY")
                dest.write(line);digest.update(line)
            dest.flush();os.fsync(dest.fileno())
        return {"schema":"stellar-forge.hud-workbook-index.v1","parser":namespace["PARSER"],
            "parserSha256":hashlib.sha256(reader.encode()).hexdigest(),"sheet":sheet_name,"columns":columns,
            "localityRows":source_rows,"countyCount":len(county_counts),"hudAreaCount":len(areas),
            "states":state_counts,"multiLocalityCounties":{k:v for k,v in county_counts.items() if v>1},
            "indexSha256":digest.hexdigest(),"indexBytes":size,"workbook":workbook.describe()}
if __name__=="__main__":
    try: print(json.dumps({"ok":True,"result":main()},separators=(",",":")))
    except Exception as error:
        print(json.dumps({"ok":False,"error":getattr(error,"code","HUD_WORKBOOK_REVIEW_REQUIRED"),"message":str(error)[:2000]}))
        sys.exit(2)
