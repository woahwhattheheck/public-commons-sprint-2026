"""MIT. Native XLSX/UTF-8 CSV interchange. Original packages are retained separately.

This engine changes only explicitly selected value cells. It does not calculate
Excel formulas, execute workbook code, follow external relationships, or infer
review decisions. Formula text and all other original package parts are retained.
"""
from __future__ import annotations
import base64, csv, hashlib, io, json, os, posixpath, re, sys, zipfile
import xml.etree.ElementTree as ET
from decimal import Decimal
from xml.parsers import expat

SCHEMA = "sf88-template-workbook/v1"
NS = {"http://schemas.openxmlformats.org/spreadsheetml/2006/main",
      "http://purl.oclc.org/ooxml/spreadsheetml/main"}
MAX_FILE = 32 * 1024 * 1024
MAX_EXPANDED = 128 * 1024 * 1024
MAX_CELLS = 500000
ADDR = re.compile(r"^([A-Z]{1,3})([1-9][0-9]{0,6})$")
NUM = re.compile(r"^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[Ee][+-]?[0-9]+)?$")
def require(ok, code):
    if not ok: raise ValueError(code)
def sha(body): return hashlib.sha256(body).hexdigest()
def js(value): return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")
def digest(value): return sha(js(value))
def local(name): return name.rsplit("}", 1)[-1].split(":")[-1]
def child(element, name):
    return next((x for x in element if local(x.tag) == name), None)
def children(element, name): return [x for x in element if local(x.tag) == name]
def attrs(element): return {local(k): v for k, v in element.attrib.items()}
def xml(body):
    require(b"<!DOCTYPE" not in body.upper() and b"<!ENTITY" not in body.upper(), "WORKBOOK_XML_DECLARATION_UNSUPPORTED")
    try: return ET.fromstring(body)
    except ET.ParseError as e: raise ValueError("WORKBOOK_XML_INVALID") from e
def address(value):
    require(isinstance(value,str), "WORKBOOK_CELL_ADDRESS_REQUIRED")
    m=ADDR.fullmatch(value)
    require(m is not None, "WORKBOOK_CELL_ADDRESS_INVALID")
    col=0
    for char in m[1]: col=col*26+ord(char)-64
    row=int(m[2])
    require(col<=16384 and row<=1048576, "WORKBOOK_CELL_ADDRESS_INVALID")
    return row,col
def letters(col):
    result=""
    while col:
        col, digit=divmod(col-1,26); result=chr(65+digit)+result
    return result
def coord(row,col): return letters(col)+str(row)
def region(value):
    parts=value.replace("$","").split(":")
    require(len(parts) in (1,2), "WORKBOOK_RANGE_INVALID")
    a=address(parts[0]);b=address(parts[-1])
    return min(a[0],b[0]),min(a[1],b[1]),max(a[0],b[0]),max(a[1],b[1])
def rich_text(element):
    if element is None:return ""
    result=[]
    for e in element:
        if local(e.tag)=="t":result.append(e.text or "")
        elif local(e.tag)=="r":
            result.extend(t.text or "" for t in e if local(t.tag)=="t")
    return "".join(result)
def blank(cell):
    return {"address":cell,"value":{"type":"blank","value":None},"formula":None,"style":None}
def cell_hash(value):
    return digest({k:value[k] for k in ("value","formula","style")})
def target_path(parent,target):
    require(isinstance(target,str) and "?" not in target and "#" not in target and "\\" not in target,
            "WORKBOOK_RELATIONSHIP_INVALID")
    name=posixpath.normpath(target.lstrip("/") if target.startswith("/") else posixpath.join(posixpath.dirname(parent),target))
    require(not name.startswith("../") and not name.startswith("/") and name not in (".",".."), "WORKBOOK_RELATIONSHIP_INVALID")
    return name
def lexical_spans(body):
    # Expat supplies exact UTF-8 byte positions. ElementTree above establishes
    # well-formedness; no template XML is reserialised for an unrelated cell.
    parser=expat.ParserCreate(namespace_separator="}")
    stack=[]; found=[]
    def start(name,attributes):
        start=parser.CurrentByteIndex
        quote=None;i=start
        while i<len(body):
            ch=body[i]
            if quote:
                if ch==quote:quote=None
            elif ch in (34,39):quote=ch
            elif ch==62:break
            i+=1
        require(i<len(body),"WORKBOOK_XML_INVALID")
        tag=body[start:i+1]
        qname=re.match(br"<([^\s/>]+)",tag)[1].decode("ascii")
        stack.append({"name":name,"local":local(name),"attrs":{local(k):v for k,v in attributes.items()},
                      "start":start,"open_end":i+1,"self_closing":tag.rstrip().endswith(b"/>"),
                      "qname":qname,"parent":stack[-1]["local"] if stack else None})
    def end(name):
        item=stack.pop()
        if item["self_closing"]:
            item["close_start"]=item["open_end"];item["end"]=item["open_end"]
        else:
            stop=parser.CurrentByteIndex
            require(body[stop:stop+2]==b"</","WORKBOOK_XML_POSITION_INVALID")
            item["close_start"]=stop;item["end"]=body.index(b">",stop)+1
        found.append(item)
    parser.StartElementHandler=start;parser.EndElementHandler=end
    parser.ExternalEntityRefHandler=lambda *unused:0
    parser.Parse(body,True)
    return found
def replace_spans(body,edits):
    edits=sorted(edits,key=lambda x:(x[0],x[1]),reverse=True)
    last=len(body)+1
    for a,b,new in edits:
        require(0<=a<=b<=len(body) and b<=last,"WORKBOOK_PATCH_OVERLAP")
        body=body[:a]+new+body[b:];last=a
    return body
def esc(value): return value.replace("&","&amp;").replace("<","&lt;").replace(">","&gt;")
def attr(value): return esc(str(value)).replace('"',"&quot;")
def value_xml(value,prefix):
    kind=value["type"];v=value.get("value");p=(prefix+":") if prefix else ""
    if kind=="blank":return "",b""
    if kind=="text":
        require(isinstance(v,str) and len(v.encode("utf-16-le"))//2<=32767,"WORKBOOK_TEXT_CELL_LIMIT")
        require(all(ord(c)>=32 or c in "\t\n\r" for c in v),"WORKBOOK_TEXT_CHARACTER_INVALID")
        return "inlineStr",('<'+p+'is><'+p+'t xml:space="preserve">'+esc(v)+'</'+p+'t></'+p+'is>').encode()
    if kind=="number":
        require(isinstance(v,str) and NUM.fullmatch(v),"WORKBOOK_NUMBER_TOKEN_REQUIRED")
        # Excel stores at most fifteen significant decimal digits. Exact source
        # numbers with greater precision belong in explicit text cells.
        digits=re.sub("[^0-9]","",re.split("[eE]",v)[0]).lstrip("0")
        require(len(digits)<=15,"WORKBOOK_NUMBER_REQUIRES_TEXT")
        numeric=Decimal(v)
        require(numeric.is_finite() and abs(numeric)<=Decimal("1.7976931348623157E308") and (numeric==0 or abs(numeric)>=Decimal("2.2250738585072014E-308")),"WORKBOOK_NUMBER_REQUIRES_TEXT")
        return "n",('<'+p+'v>'+esc(v)+'</'+p+'v>').encode()
    if kind=="boolean":
        require(isinstance(v,bool),"WORKBOOK_BOOLEAN_REQUIRED")
        return "b",('<'+p+'v>'+("1" if v else "0")+'</'+p+'v>').encode()
    raise ValueError("WORKBOOK_CELL_TYPE_INVALID")
def patch_cell(body, span, cell, value, prefix="", all_spans=()):
    if span:
        prefix=span["qname"].split(":")[0] if ":" in span["qname"] else ""
        opening=body[span["start"]:span["open_end"]].decode("utf-8")
        opening=re.sub(r'\s+t\s*=\s*(?:"[^"]*"|\'[^\']*\')',"",opening)
        opening=re.sub(r"/\s*>$",">",opening)
        kind,inner=value_xml(value,prefix)
        if kind:opening=opening[:-1]+' t="'+kind+'">'
        inside=b"" if span["self_closing"] else body[span["open_end"]:span["close_start"]]
        # Delete only direct SpreadsheetML value children. Unrelated extension
        # elements and their namespace/byte representation stay exactly intact.
        edits=[]
        for part in all_spans:
            if part["parent"]=="c" and part["local"] in ("v","is") and part["name"].rsplit("}",1)[0] in NS and span["open_end"]<=part["start"]<part["end"]<=span["close_start"]:
                edits.append((part["start"]-span["open_end"],part["end"]-span["open_end"],b""))
        inside=replace_spans(inside,edits)
        return opening.encode()+inner+inside+("</"+span["qname"]+">").encode()
    p=prefix+":" if prefix else "";kind,inner=value_xml(value,prefix)
    return ('<'+p+'c r="'+cell+'"'+(' t="'+kind+'"' if kind else '')+'>').encode()+inner+('</'+p+'c>').encode()

class Workbook:
    def __init__(self,raw,filename,format=None,delimiter=None):
        require(isinstance(raw,bytes) and 0<len(raw)<=MAX_FILE,"WORKBOOK_SIZE_INVALID")
        self.raw=raw;self.filename=filename;self.sha256=sha(raw)
        self.format=format or ("xlsx" if raw[:4]==b"PK\x03\x04" else "csv")
        self.parts={};self.infos=[];self.sheets=[];self.formulas=0
        if self.format=="xlsx":self._xlsx()
        elif self.format=="csv":self._csv(delimiter)
        else:raise ValueError("WORKBOOK_FORMAT_UNSUPPORTED")
    def _xlsx(self):
        require(self.filename.lower().endswith(".xlsx"),"WORKBOOK_XLSX_REQUIRED")
        try:
            with zipfile.ZipFile(io.BytesIO(self.raw)) as z:
                infos=z.infolist()
                require(0<len(infos)<=5000,"WORKBOOK_PART_LIMIT")
                names=[i.filename for i in infos]
                require(len(names)==len(set(names)),"WORKBOOK_DUPLICATE_PART")
                require(sum(i.file_size for i in infos)<=MAX_EXPANDED,"WORKBOOK_EXPANDED_SIZE_LIMIT")
                for info in infos:
                    n=info.filename
                    require("\\" not in n and not n.startswith("/") and ".." not in n.split("/") and not(info.flag_bits&1),
                            "WORKBOOK_PART_INVALID")
                    require(((info.external_attr>>16)&0o170000)!=0o120000,"WORKBOOK_LINK_UNSUPPORTED")
                    self.parts[n]=z.read(info);self.infos.append(info)
                self.comment=z.comment
        except (zipfile.BadZipFile,RuntimeError) as e:raise ValueError("WORKBOOK_ZIP_INVALID") from e
        require("[Content_Types].xml" in self.parts and "_rels/.rels" in self.parts,"WORKBOOK_PACKAGE_INVALID")
        require(not any("vbaproject" in n.lower() for n in self.parts),"WORKBOOK_MACRO_PACKAGE_UNSUPPORTED")
        require(not any(n.startswith("_xmlsignatures/") for n in self.parts),"WORKBOOK_SIGNED_PACKAGE_REQUIRES_NATIVE_AUTHOR")
        rels=xml(self.parts["_rels/.rels"])
        doc=next((x for x in rels if x.attrib.get("Type","").endswith("/officeDocument")),None)
        require(doc is not None and doc.attrib.get("TargetMode")!="External","WORKBOOK_DOCUMENT_REQUIRED")
        self.workbook_path=target_path("",doc.attrib["Target"])
        require(self.workbook_path in self.parts,"WORKBOOK_DOCUMENT_MISSING")
        self.workbook=xml(self.parts[self.workbook_path])
        require(local(self.workbook.tag)=="workbook" and self.workbook.tag.split("}")[0].lstrip("{") in NS,"WORKBOOK_NAMESPACE_UNSUPPORTED")
        relpath=posixpath.join(posixpath.dirname(self.workbook_path),"_rels",posixpath.basename(self.workbook_path)+".rels")
        require(relpath in self.parts,"WORKBOOK_RELATIONSHIPS_MISSING")
        relationships={x.attrib["Id"]:x.attrib for x in xml(self.parts[relpath])}
        strings=[]
        shared=next((r for r in relationships.values() if r.get("Type","").endswith("/sharedStrings")),None)
        if shared:
            require(shared.get("TargetMode")!="External","WORKBOOK_SHARED_STRINGS_INVALID")
            sp=target_path(self.workbook_path,shared["Target"])
            strings=[rich_text(x) for x in xml(self.parts[sp]) if local(x.tag)=="si"]
        total=0
        for record in children(child(self.workbook,"sheets"),"sheet"):
            a=attrs(record);r=relationships.get(a.get("id"))
            require(r is not None,"WORKBOOK_SHEET_RELATIONSHIP_MISSING")
            path=target_path(self.workbook_path,r["Target"]) if r.get("TargetMode")!="External" else None
            sheet={"name":a["name"],"sheetId":a["sheetId"],"state":a.get("state","visible"),"path":path,"kind":"worksheet",
                   "cells":[],"merged":[],"protected":False,"formulaRanges":[]}
            if not r.get("Type","").endswith("/worksheet"):
                sheet["kind"]="retained-nonworksheet";self.sheets.append(sheet);continue
            require(path in self.parts,"WORKBOOK_SHEET_MISSING")
            body=self.parts[path];root=xml(body);sd=child(root,"sheetData")
            require(sd is not None,"WORKBOOK_SHEET_DATA_MISSING")
            names=set()
            for row in children(sd,"row"):
                for c in children(row,"c"):
                    ca=attrs(c);location=ca.get("r")
                    address(location);require(location not in names,"WORKBOOK_DUPLICATE_CELL");names.add(location)
                    v=child(c,"v");vtext=None if v is None else(v.text or "")
                    typ=ca.get("t","n")
                    if typ=="s":
                        require(vtext is not None and vtext.isdigit() and int(vtext)<len(strings),"WORKBOOK_STRING_REFERENCE_INVALID")
                        value={"type":"text","value":strings[int(vtext)]}
                    elif typ=="inlineStr":value={"type":"text","value":rich_text(child(c,"is"))}
                    elif typ=="b":
                        require(vtext in ("0","1"),"WORKBOOK_BOOLEAN_INVALID");value={"type":"boolean","value":vtext=="1"}
                    elif typ in ("str","d","e"):value={"type":{"str":"text","d":"date","e":"error"}[typ],"value":vtext}
                    elif typ=="n":
                        require(vtext is None or vtext=="" or NUM.fullmatch(vtext),"WORKBOOK_NUMERIC_CELL_INVALID")
                        value={"type":"blank","value":None} if vtext in (None,"") else {"type":"number","value":vtext}
                    else:raise ValueError("WORKBOOK_CELL_TYPE_UNSUPPORTED")
                    f=child(c,"f");formula=None if f is None else {"text":f.text or "","attributes":attrs(f)}
                    cell={"address":location,"value":value,"formula":formula,"style":ca.get("s")}
                    cell["fingerprint"]=cell_hash(cell);sheet["cells"].append(cell)
                    if formula:
                        self.formulas+=1
                        if formula["attributes"].get("ref"):sheet["formulaRanges"].append(formula["attributes"]["ref"])
                    total+=1;require(total<=MAX_CELLS,"WORKBOOK_CELL_LIMIT")
            merges=child(root,"mergeCells")
            if merges is not None:sheet["merged"]=[e.attrib["ref"] for e in merges if local(e.tag)=="mergeCell"]
            protection=child(root,"sheetProtection")
            sheet["protected"]=protection is not None and protection.attrib.get("sheet","1") not in ("0","false")
            sheet["dimensions"]=attrs(child(root,"dimension")).get("ref") if child(root,"dimension") is not None else None
            sheet["originalPartSha256"]=sha(body);self.sheets.append(sheet)
        require(len({s["name"] for s in self.sheets})==len(self.sheets),"WORKBOOK_DUPLICATE_SHEET")
    def _csv(self,delimiter):
        try:text=self.raw.decode("utf-8-sig")
        except UnicodeDecodeError as e:raise ValueError("WORKBOOK_CSV_UTF8_REQUIRED") from e
        require("\x00" not in text,"WORKBOOK_CSV_INVALID")
        if delimiter is None:
            try:delimiter=csv.Sniffer().sniff(text[:65536],delimiters=",;\t|").delimiter
            except csv.Error:delimiter=","
        require(delimiter in (",",";","\t","|"),"WORKBOOK_DELIMITER_INVALID")
        self.delimiter=delimiter;self.bom=self.raw.startswith(b"\xef\xbb\xbf")
        self.newline="\r\n" if "\r\n" in text else "\r" if "\r" in text else "\n"
        self.terminal_newline=text.endswith(("\n","\r"))
        try:self.rows=list(csv.reader(io.StringIO(text,newline=""),delimiter=delimiter,strict=True))
        except csv.Error as e:raise ValueError("WORKBOOK_CSV_INVALID") from e
        require(sum(len(r) for r in self.rows)<=MAX_CELLS,"WORKBOOK_CELL_LIMIT")
        cells=[]
        for ri,row in enumerate(self.rows,1):
            for ci,value in enumerate(row,1):
                c={"address":coord(ri,ci),"value":{"type":"text","value":value},"formula":None,"style":None}
                c["fingerprint"]=cell_hash(c);cells.append(c)
        self.sheets=[{"name":"CSV","sheetId":"1","state":"visible","kind":"worksheet","path":None,
                      "cells":cells,"merged":[],"formulaRanges":[],"protected":False}]
    def inspect(self):
        result={"schema":SCHEMA,"filename":self.filename,"format":self.format,"sha256":self.sha256,"bytes":len(self.raw),
                "sheets":self.sheets,"formulaCount":self.formulas,"partCount":len(self.parts),
                "originalParts":[{"path":n,"bytes":len(b),"sha256":sha(b)} for n,b in self.parts.items()]}
        if self.format=="csv":result["csv"]={"delimiter":self.delimiter,"bom":self.bom,"newline":self.newline,"terminalNewline":self.terminal_newline}
        return result
    def patch(self,patches):
        require(isinstance(patches,list) and 0<len(patches)<=MAX_CELLS,"WORKBOOK_PATCHES_REQUIRED")
        sheets={s["name"]:s for s in self.sheets}; indexes={s["name"]:{c["address"]:c for c in s["cells"]} for s in self.sheets}; by_sheet={};seen=set();changes=[]
        for patch in patches:
            sn=patch.get("sheet");loc=patch.get("cell");address(loc)
            require(sn in sheets and sheets[sn]["kind"]=="worksheet","WORKBOOK_TARGET_SHEET_INVALID")
            s=sheets[sn];require(not s["protected"],"WORKBOOK_PROTECTED_SHEET")
            key=(sn,loc);require(key not in seen,"WORKBOOK_DUPLICATE_PATCH");seen.add(key)
            c=indexes[sn].get(loc,blank(loc))
            require(patch.get("expectedFingerprint")==cell_hash(c),"WORKBOOK_TARGET_CELL_CHANGED")
            require(c["formula"] is None,"WORKBOOK_FORMULA_TARGET_REQUIRES_MAPPING")
            row,col=address(loc)
            for ref in s["merged"]:
                r1,c1,r2,c2=region(ref)
                require(not(r1<=row<=r2 and c1<=col<=c2) or(row,col)==(r1,c1),"WORKBOOK_MERGED_CHILD_TARGET")
            for ref in s["formulaRanges"]:
                r1,c1,r2,c2=region(ref)
                require(not(r1<=row<=r2 and c1<=col<=c2),"WORKBOOK_ARRAY_FORMULA_TARGET")
            value=patch.get("value")
            require(isinstance(value,dict),"WORKBOOK_PATCH_VALUE_REQUIRED");value_xml(value,"")
            if value==c["value"]:continue
            by_sheet.setdefault(sn,[]).append(patch)
            changes.append({"sheet":sn,"cell":loc,"before":c["value"],"after":value,"beforeFingerprint":cell_hash(c)})
        if not changes:return self.raw,{"schema":"sf88-template-workbook-change/v1","sourceSha256":self.sha256,"outputSha256":self.sha256,"changes":[],"unchangedParts":len(self.parts),"calculation":"unchanged"}
        if self.format=="csv":
            rows=[list(r) for r in self.rows]
            for patch in by_sheet["CSV"]:
                r,c=address(patch["cell"])
                while len(rows)<r:rows.append([])
                while len(rows[r-1])<c:rows[r-1].append("")
                value=patch["value"];v=value.get("value")
                rows[r-1][c-1]="" if value["type"]=="blank" else ("TRUE" if v else "FALSE") if value["type"]=="boolean" else str(v)
            stream=io.StringIO(newline="");w=csv.writer(stream,delimiter=self.delimiter,lineterminator=self.newline)
            w.writerows(rows);text=stream.getvalue()
            if not self.terminal_newline:text=text[:-len(self.newline)]
            raw=(b"\xef\xbb\xbf" if self.bom else b"")+text.encode("utf-8");changed_parts=[]
        else:
            parts=dict(self.parts);changed_parts=[]
            for sn,selected in by_sheet.items():
                s=sheets[sn];body=parts[s["path"]];spans=lexical_spans(body)
                cs={x["attrs"]["r"]:x for x in spans if x["local"]=="c" and x["parent"]=="row"}
                rs={int(x["attrs"]["r"]):x for x in spans if x["local"]=="row" and x["parent"]=="sheetData"}
                sd=next(x for x in spans if x["local"]=="sheetData")
                prefix=sd["qname"].split(":")[0] if ":" in sd["qname"] else ""
                pfx=prefix+":" if prefix else ""
                edits=[];new_cells={}
                for patch in selected:
                    loc=patch["cell"];span=cs.get(loc)
                    if span:edits.append((span["start"],span["end"],patch_cell(body,span,loc,patch["value"],prefix,spans)))
                    else:new_cells.setdefault(address(loc)[0],[]).append(patch)
                new_rows=[]
                for row,ps in sorted(new_cells.items()):
                    rspec=rs.get(row);bodycells=b"".join(patch_cell(body,None,p["cell"],p["value"],prefix) for p in sorted(ps,key=lambda p:address(p["cell"])[1]))
                    if rspec:
                        # New cells must be ordered amongst the existing cells.
                        existing=sorted((address(loc)[1],span) for loc,span in cs.items() if address(loc)[0]==row)
                        insertions={}
                        for patch in ps:
                            col=address(patch["cell"])[1]
                            pos=next((span["start"] for ec,span in existing if ec>col),rspec["close_start"])
                            insertions.setdefault(pos,[]).append((col,patch_cell(body,None,patch["cell"],patch["value"],prefix)))
                        if rspec["self_closing"]:
                            opening=body[rspec["start"]:rspec["open_end"]];opening=re.sub(br"/\s*>$",b">",opening)
                            edits.append((rspec["start"],rspec["end"],opening+bodycells+("</"+rspec["qname"]+">").encode()))
                        else:
                            for pos,values in insertions.items():edits.append((pos,pos,b"".join(b for _,b in sorted(values))))
                    else:new_rows.append((row,('<'+pfx+'row r="'+str(row)+'">').encode()+bodycells+('</'+pfx+'row>').encode()))
                insertion={}
                for row,new in new_rows:
                    pos=next((span["start"] for rn,span in sorted(rs.items()) if rn>row),sd["close_start"])
                    insertion.setdefault(pos,[]).append((row,new))
                if sd["self_closing"] and new_rows:
                    opening=re.sub(br"/\s*>$",b">",body[sd["start"]:sd["open_end"]])
                    edits.append((sd["start"],sd["end"],opening+b"".join(b for _,b in new_rows)+("</"+sd["qname"]+">").encode()))
                else:
                    for pos,values in insertion.items():edits.append((pos,pos,b"".join(b for _,b in sorted(values))))
                dim=next((x for x in spans if x["local"]=="dimension"),None)
                coords=[address(c["address"]) for c in s["cells"]]+[address(p["cell"]) for p in selected]
                if dim and coords:
                    if dim["attrs"].get("ref"):
                        r1,c1,r2,c2=region(dim["attrs"]["ref"]);coords.extend(((r1,c1),(r2,c2)))
                    extent=coord(min(x[0] for x in coords),min(x[1] for x in coords))+":"+coord(max(x[0] for x in coords),max(x[1] for x in coords))
                    old=body[dim["start"]:dim["end"]]
                    new=re.sub(br'(\bref\s*=\s*)(?:"[^"]*"|\'[^\']*\')',lambda m:m[1]+b'"'+extent.encode()+b'"',old,count=1)
                    if new!=old:edits.append((dim["start"],dim["end"],new))
                updated=replace_spans(body,edits);xml(updated);parts[s["path"]]=updated;changed_parts.append(s["path"])
            if self.formulas:
                wb=parts[self.workbook_path];spans=lexical_spans(wb);calc=next((s for s in spans if s["local"]=="calcPr"),None)
                if calc:
                    raw=wb[calc["start"]:calc["end"]]
                    for key in ("fullCalcOnLoad","forceFullCalc","calcMode"):
                        raw=re.sub(rb'\s+'+key.encode()+rb'\s*=\s*(?:"[^"]*"|\'[^\']*\')',b"",raw)
                    raw=re.sub(br"(/?>)",b' fullCalcOnLoad="1" forceFullCalc="1" calcMode="auto"\\1',raw,count=1)
                    wb=replace_spans(wb,[(calc["start"],calc["end"],raw)])
                else:
                    root=next(s for s in spans if s["local"]=="workbook");prefix=root["qname"].split(":")[0]+":" if ":" in root["qname"] else ""
                    new=('<'+prefix+'calcPr fullCalcOnLoad="1" forceFullCalc="1" calcMode="auto"/>').encode()
                    # calcPr precedes these optional Workbook children in SpreadsheetML.
                    followers={"oleSize","customWorkbookViews","pivotCaches","smartTagPr","smartTagTypes","webPublishing","fileRecoveryPr","webPublishObjects","extLst"}
                    position=min((s["start"] for s in spans if s["parent"]=="workbook" and s["local"] in followers),default=root["close_start"])
                    wb=replace_spans(wb,[(position,position,new)])
                parts[self.workbook_path]=wb;changed_parts.append(self.workbook_path)
            out=io.BytesIO()
            with zipfile.ZipFile(out,"w") as z:
                z.comment=self.comment
                for info in self.infos:z.writestr(info,parts[info.filename])
            raw=out.getvalue()
        receiving=Workbook(raw,self.filename,self.format,getattr(self,"delimiter",None))
        after_sheets={s["name"]:s for s in receiving.sheets}
        for change in changes:
            got=next((c for c in after_sheets[change["sheet"]]["cells"] if c["address"]==change["cell"]),blank(change["cell"]))
            expected=change["after"]
            if self.format=="csv":
                v=expected.get("value");expected={"type":"text","value":"" if expected["type"]=="blank" else("TRUE" if v else "FALSE") if expected["type"]=="boolean" else str(v)}
            require(got["value"]==expected and got["formula"] is None,"WORKBOOK_PATCH_READBACK_CHANGED")
            change["afterFingerprint"]=cell_hash(got)
        changed_keys={(c["sheet"],c["cell"]) for c in changes}
        for original in self.sheets:
            current=after_sheets[original["name"]];current_cells={c["address"]:c for c in current["cells"]}
            for c in original["cells"]:
                if (original["name"],c["address"]) not in changed_keys:
                    require(c["fingerprint"]==current_cells.get(c["address"],{}).get("fingerprint"),"WORKBOOK_UNMAPPED_CELL_CHANGED")
        unchanged=sum(1 for n,b in self.parts.items() if n not in changed_parts and receiving.parts.get(n)==b)
        require(unchanged==len(self.parts)-len(set(changed_parts)),"WORKBOOK_UNMAPPED_PART_CHANGED")
        return raw,{"schema":"sf88-template-workbook-change/v1","sourceSha256":self.sha256,"outputSha256":sha(raw),
                    "changes":changes,"changedParts":changed_parts,"unchangedParts":unchanged,
                    "formulaCount":self.formulas,"calculation":"native-application-recalculation-requested" if self.formulas else "no-formulas"}

def main():
    source=sys.stdin.buffer.read(MAX_FILE*3)
    require(len(source)<MAX_FILE*3,"WORKBOOK_REQUEST_TOO_LARGE")
    request=json.loads(source)
    raw=base64.b64decode(request["bodyBase64"],validate=True)
    book=Workbook(raw,request["filename"],request.get("format"),request.get("delimiter"))
    if request.get("action")=="inspect":return book.inspect()
    require(request.get("action")=="patch","WORKBOOK_ACTION_INVALID")
    body,report=book.patch(request["patches"])
    return {"bodyBase64":base64.b64encode(body).decode(),"report":report,"inspection":Workbook(body,request["filename"],book.format,getattr(book,"delimiter",None)).inspect()}
if __name__=="__main__":
    try:print(json.dumps({"ok":True,"result":main()},ensure_ascii=False,separators=(",",":"),allow_nan=False))
    except Exception as error:
        code=str(error) if isinstance(error,ValueError) and re.fullmatch(r"[A-Z][A-Z0-9_]+",str(error)) else "WORKBOOK_OPERATION_FAILED"
        print(json.dumps({"ok":False,"error":{"code":code}}));sys.exit(1)
