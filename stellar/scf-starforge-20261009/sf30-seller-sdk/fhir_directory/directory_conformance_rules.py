"""MIT. Evaluated assertions from the exact retained HSDS/HSD source.
This module does not replace the original parser, resolver or a full FHIR validator.
Every checked or unevaluated requirement has its original source location.
"""
from __future__ import annotations
from collections import Counter
from datetime import date, datetime, time
from decimal import Decimal, InvalidOperation
from email.headerregistry import Address
import ipaddress
import json
import re
from urllib.parse import urlsplit
from directory_runtime import InputError, fhir
from directory_source_schema import standards, original_sources, sha, jbytes, lexical_json

ABSENT = object()
MAX_DEPTH = 200
ASSERTIONS = {"type","properties","required","items","$ref","enum","const",
    "minimum","maximum","exclusiveMinimum","exclusiveMaximum","minLength",
    "maxLength","minItems","maxItems","uniqueItems","additionalProperties"}
ANNOTATIONS = {"name","path","description","datapackage_metadata","title","constraints",
    "example","examples","core","format","tabular_required","datapackage_type",
    "deprecated","deprecatedDetails","$schema","$id","default","readOnly","writeOnly",
    "$comment","definitions","$defs"}
FHIR_PRIMITIVES = {"base64Binary","boolean","canonical","code","date","dateTime","decimal",
    "id","instant","integer","integer64","markdown","oid","positiveInt","string",
    "time","unsignedInt","uri","url","uuid","xhtml"}

def ptr(token):
    return str(token).replace("~","~0").replace("/","~1")

def number(value):
    return isinstance(value, (fhir.Number, Decimal)) or type(value) in (int,float)

def logical_number(value):
    return Decimal(str(value))

def kind(value):
    if value is ABSENT:return "absent"
    if value is None:return "null"
    if type(value)is bool:return "boolean"
    if number(value):return "number"
    if isinstance(value,str):return "string"
    if isinstance(value,list):return "array"
    if isinstance(value,dict):return "object"
    return type(value).__name__

def same(left,right):
    if number(left) and number(right):
        try:return logical_number(left)==logical_number(right)
        except InvalidOperation:return False
    if kind(left)!=kind(right):return False
    if isinstance(left,dict):return left.keys()==right.keys() and all(same(left[k],right[k])for k in left)
    if isinstance(left,list):return len(left)==len(right) and all(same(a,b)for a,b in zip(left,right))
    return left==right

def check_type(value,expected):
    if isinstance(expected,list):return any(check_type(value,k)for k in expected)
    if expected=="integer":
        try:return number(value) and logical_number(value).is_finite() and logical_number(value)%1==0
        except InvalidOperation:return False
    return kind(value)==expected

def described(value):
    if value is ABSENT:return {"type":"absent"}
    raw=lexical_json(value).encode()
    return {"type":kind(value),"bytes":len(raw),"sha256":sha(raw),
        "preview":raw[:512].decode("utf-8","replace"),"previewTruncated":len(raw)>512}

def source_location(table,pointer="",tabular=False):
    native=standards();item=native["tables"][table]
    source=dict(item["source"])
    if tabular:
        original=next(s for s in original_sources()["sources"]if s["id"]=="hsds-3.3.1")
        member=next(f for f in original["files"]if f["path"]=="datapackage.json")
        position=next(i for i,r in enumerate(native["datapackage"]["resources"])if r["name"]==table)
        source.update(path=member["path"],git_blob_sha=member["git_blob_sha"],bytes=member["bytes"])
        pointer="/resources/"+str(position)+"/schema"+pointer
    source["pointer"]=pointer
    source["url"]="https://github.com/"+source["repository"]+"/blob/"+source["ref"]+"/"+source["path"]
    return source

def format_valid(value,fmt):
    """Selected syntax assertions; no DNS/HTTP request or implicit normalization."""
    if not isinstance(value,str)or isinstance(value,fhir.Number):return False
    if fmt in ("uuid","uuid-urn"):
        return bool(re.fullmatch((r"urn:uuid:"if fmt=="uuid-urn"else "")+r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}",value))
    if fmt in ("uri","url","canonical","oid"):
        if any(ord(c)>127 or ord(c)<33 for c in value)or re.search(r"%(?![0-9A-Fa-f]{2})",value):return False
        try:p=urlsplit(value)
        except ValueError:return False
        if not re.fullmatch(r"[A-Za-z][A-Za-z0-9+.-]*",p.scheme):return False
        pchar=r"[A-Za-z0-9\-._~!$&'()*+,;=:@%]"
        if not re.fullmatch("(?:"+pchar+r"|/)*",p.path):return False
        if not re.fullmatch("(?:"+pchar+r"|/|\?)*",p.query)or not re.fullmatch("(?:"+pchar+r"|/|\?)*",p.fragment):return False
        if p.netloc:
            try:
                host=p.hostname
                if host is None:return False
                if "["in p.netloc:
                    ipaddress.IPv6Address(host)
                elif not re.fullmatch(r"[A-Za-z0-9\-._~!$&'()*+,;=%]*",host):return False
                unused=p.port
            except ValueError:return False
        if fmt=="url"and p.scheme in {"http","https"}and not p.netloc:return False
        if fmt=="oid":return bool(re.fullmatch(r"urn:oid:[0-2](?:\.(?:0|[1-9][0-9]*))+",value))
        return True
    if fmt=="email":
        try:
            a=Address(addr_spec=value)
            return bool(a.username and a.domain)and not any(c in value for c in "\r\n")
        except (ValueError,IndexError):return False
    if fmt in {"date-time","instant"}:
        m=re.fullmatch(r"(\d{4}-\d{2}-\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?([Zz]|[+-]\d{2}:\d{2})",value)
        if not m:return False
        try:
            date.fromisoformat(m[1]);h,mi,se=map(int,m.group(2,3,4))
            if h>23 or mi>59 or se>60:return False
            if m[5].upper()!="Z":
                if int(m[5][1:3])>23 or int(m[5][4:6])>59:return False
            return True
        except ValueError:return False
    if fmt=="date":
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}",value):return False
        try:date.fromisoformat(value);return True
        except ValueError:return False
    if fmt=="time":
        if not re.fullmatch(r"\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?",value):return False
        try:time.fromisoformat(value.replace("Z","+00:00"));return True
        except ValueError:return False
    return None

class HsdsRules:
    def __init__(self,format_policy):
        self.native=standards();self.format_policy=format_policy
        self.schemas={k:v["schema"]for k,v in self.native["tables"].items()}

    def catalogue(self):
        rules=[]
        def node(table,spec,p):
            for key,value in spec.items():
                if key in {"properties","items","$ref"}:continue
                if key in ASSERTIONS or key=="format":
                    rules.append({"family":"hsds-3.3.1","table":table,"keyword":key,
                        "requirement":value,"mode":"annotation"if key=="format"and self.format_policy=="annotation"else "evaluated",
                        "source":source_location(table,p+"/"+ptr(key))})
                elif key not in ANNOTATIONS:
                    rules.append({"family":"hsds-3.3.1","table":table,"keyword":key,
                        "requirement":value,"mode":"unevaluated","source":source_location(table,p+"/"+ptr(key))})
            if "$ref"in spec:
                rules.append({"family":"hsds-3.3.1","table":table,"keyword":"$ref","requirement":spec["$ref"],
                    "mode":"evaluated","source":source_location(table,p+"/$ref")})
            for key,value in spec.get("properties",{}).items():node(table,value,p+"/properties/"+ptr(key))
            if isinstance(spec.get("items"),dict):node(table,spec["items"],p+"/items")
        for table,spec in self.schemas.items():
            node(table,spec,"")
            resource=self.native["tables"][table]["tabular"]["schema"]
            for i,field in enumerate(resource["fields"]):
                rules.append({"family":"hsds-tabular-3.3.1","table":table,"keyword":"field",
                    "requirement":field,"mode":"evaluated","source":source_location(table,"/fields/"+str(i),True)})
            for key in ("primaryKey","foreignKeys","missingValues"):
                if key in resource:rules.append({"family":"hsds-tabular-3.3.1","table":table,
                    "keyword":key,"requirement":resource[key],"mode":"unevaluated"if key=="foreignKeys"else"evaluated",
                    "checkScope":"Exact native reference states are reported separately as selected-population observations; full declared foreign-key conformance is not asserted"if key=="foreignKeys"else"Selected original tabular assertion",
                    "source":source_location(table,"/"+key,True)})
        for r in rules:r["id"]=sha(jbytes(r))
        return rules

    def check_json(self,value,table,emit,count,path="",spec=None,schema_table=None,schema_pointer="",depth=0):
        if depth>MAX_DEPTH:raise InputError("Selected JSON schema validation exceeds its explicit200-level budget")
        spec=self.schemas[table]if spec is None else spec
        schema_table=schema_table or table
        def check(code,valid,message,actual=value,where=path,keyword=None,severity="error"):
            count(code,"pass"if valid else severity)
            if not valid:emit(code,severity,where,message,source_location(schema_table,schema_pointer+"/"+(keyword or code)),actual)
        if "$ref"in spec:
            ref=spec["$ref"]
            if not isinstance(ref,str)or not re.fullmatch(r"[a-z_]+\.json",ref)or ref[:-5]not in self.schemas:
                check("schema-reference",False,"The selected original schema reference is outside the retained canonical closure.",ref,keyword="$ref",severity="not-evaluated");return
            self.check_json(value,table,emit,count,path,self.schemas[ref[:-5]],ref[:-5],"",depth+1);return
        if "type"in spec:
            valid=check_type(value,spec["type"]);check("json-type",valid,"Original JSON type differs from the selected canonical declaration.",keyword="type")
            if not valid:return
        if "enum"in spec:check("json-enum",any(same(value,v)for v in spec["enum"]),"Original value is outside the declared enumeration.",keyword="enum")
        if "const"in spec:check("json-const",same(value,spec["const"]),"Original value differs from the declared constant.",keyword="const")
        for key in ("minimum","maximum","exclusiveMinimum","exclusiveMaximum"):
            if key in spec and number(value):
                a,b=logical_number(value),logical_number(spec[key])
                valid={"minimum":a>=b,"maximum":a<=b,"exclusiveMinimum":a>b,"exclusiveMaximum":a<b}[key]
                check("json-"+key,valid,"Original number is outside the selected bound.",keyword=key)
        if isinstance(value,str)and not number(value):
            for key in ("minLength","maxLength"):
                if key in spec:check("json-"+key,len(value)>=spec[key]if key=="minLength"else len(value)<=spec[key],"Original text length is outside the declared bound.",keyword=key)
            if "format"in spec:
                fmt=spec["format"]
                if self.format_policy=="annotation":count("format:"+fmt,"annotation")
                else:
                    result=format_valid(value,fmt)
                    check("format:"+fmt,result is True,"Original string does not satisfy the selected format syntax."if result is not None else "This original format is not implemented by the selected syntax checks.",
                        keyword="format",severity="error"if result is not None else "not-evaluated")
        if isinstance(value,dict):
            for key in spec.get("required",[]):
                check("json-required",key in value,"The original object omits a required property.",value.get(key,ABSENT),path+"/"+ptr(key),"required")
            props=spec.get("properties",{})
            for key,child in value.items():
                if key in props:self.check_json(child,table,emit,count,path+"/"+ptr(key),props[key],schema_table,schema_pointer+"/properties/"+ptr(key),depth+1)
                elif spec.get("additionalProperties")is False:check("json-additional",False,"The selected schema disallows this additional property.",child,path+"/"+ptr(key),"additionalProperties")
                elif isinstance(spec.get("additionalProperties"),dict):self.check_json(child,table,emit,count,path+"/"+ptr(key),spec["additionalProperties"],schema_table,schema_pointer+"/additionalProperties",depth+1)
                else:count("json-additional-permitted","annotation")
        if isinstance(value,list):
            for key in ("minItems","maxItems"):
                if key in spec:check("json-"+key,len(value)>=spec[key]if key=="minItems"else len(value)<=spec[key],"Original array count is outside the declared bound.",keyword=key)
            if spec.get("uniqueItems"):
                check("json-uniqueItems",all(not same(value[i],value[j])for i in range(len(value))for j in range(i)),"Original array repeats a value.",keyword="uniqueItems")
            if isinstance(spec.get("items"),dict):
                for i,child in enumerate(value):self.check_json(child,table,emit,count,path+"/"+str(i),spec["items"],schema_table,schema_pointer+"/items",depth+1)
        for key in set(spec)-ASSERTIONS-ANNOTATIONS:
            check("schema-keyword:"+key,False,"An assertion keyword in the selected schema is not evaluated.",spec[key],keyword=key,severity="not-evaluated")

    def check_tabular(self,row,emit,count,unique):
        table=row["table"];resource=self.native["tables"][table]["tabular"]["schema"]
        data=row["data"];headers=row.get("headers",list(data));cells=row.get("cells")
        missing=resource.get("missingValues",[""]);pk=resource.get("primaryKey",[])
        pk=[pk]if isinstance(pk,str)else pk
        expected={f["name"]for f in resource["fields"]}
        if len(headers)!=len(set(h.casefold()for h in headers)):
            emit("csv-header-duplicate","warning","","Original header names repeat under the tabular case-insensitive recommendation.",source_location(table,"/fields",True),headers)
            count("csv-header-duplicate","warning")
        if set(headers)!=expected:
            emit("csv-header-shape","warning","","Original header selection differs from the compiled field list; all original columns are retained.",source_location(table,"/fields",True),headers)
            count("csv-header-shape","warning")
        for i,field in enumerate(resource["fields"]):
            name=field["name"];raw=data.get(name,ABSENT);constraints=field.get("constraints",{})
            absent=raw is ABSENT or raw is None or (kind(raw)=="string"and raw in missing)
            location=source_location(table,"/fields/"+str(i),True)
            required=constraints.get("required",False)or name in pk
            if required:
                count("tabular-required","error"if absent else "pass")
                if absent:emit("tabular-required","error","/"+ptr(name),"A required original tabular cell is missing under its declared missingValues.",location,raw)
            if absent:continue
            try:logical=cast_cell(raw,field)
            except (ValueError,InvalidOperation,TypeError):
                count("tabular-type","error");emit("tabular-type","error","/"+ptr(name),"The original cell cannot be interpreted using its selected table field type and format.",location,raw);continue
            count("tabular-type","pass")
            fmt=field.get("format","default")
            if field.get("type","string")=="string"and fmt!="default":
                result=format_valid(logical,fmt)
                severity="error"if result is not None else "not-evaluated"
                count("tabular-format:"+fmt,"pass"if result else severity)
                if not result:emit("tabular-format:"+fmt,severity,"/"+ptr(name),"The original cell does not satisfy the selected tabular format syntax."if result is not None else "The selected tabular string format is unevaluated.",location,raw)
            if constraints.get("unique")or name in pk:
                if len(pk)<=1 or name not in pk:
                    duplicate=unique(table,row["memberName"],name,logical,row["ref"])
                    count("tabular-unique","error"if duplicate else "pass")
                    if duplicate:emit("tabular-unique","error","/"+ptr(name),"The original logical value repeats within this source member.",location,raw,related=[duplicate])
            for key,value in constraints.items():
                if key in {"required","unique"}:continue
                valid=None
                if key=="enum":valid=any(same(logical,cast_cell(v,field))for v in value)
                elif key in {"minLength","maxLength"}and isinstance(logical,(str,list,dict)):
                    valid=len(logical)>=value if key=="minLength"else len(logical)<=value
                elif key in {"minimum","maximum"}:
                    bound=cast_cell(value,field)
                    try:valid=logical>=bound if key=="minimum"else logical<=bound
                    except (TypeError,InvalidOperation):valid=False
                severity="error"if valid is not None else "not-evaluated"
                count("tabular-"+key,"pass"if valid else severity)
                if not valid:emit("tabular-"+key,severity,"/"+ptr(name),"Original logical cell violates its selected constraint."if valid is not None else "This original tabular constraint is not evaluated.",{**location,"pointer":location["pointer"]+"/constraints/"+key},raw)
        if len(pk)>1:
            values=[]
            for name in pk:
                raw=data.get(name,ABSENT)
                if raw is ABSENT or raw is None or kind(raw)=="string"and raw in missing:break
                values.append(cast_cell(raw,next(f for f in resource["fields"]if f["name"]==name)))
            else:
                duplicate=unique(table,row["memberName"],"primaryKey",values,row["ref"])
                if duplicate:emit("tabular-primary-key","error","","The original composite primary key repeats within this member.",source_location(table,"/primaryKey",True),data,related=[duplicate])
                count("tabular-primary-key","error"if duplicate else "pass")

def cast_cell(value,field):
    t=field.get("type","string");fmt=field.get("format","default")
    if t in {"string","any"}:
        if kind(value)!="string":raise ValueError("Expected physical text")
        return value
    if t in {"number","integer"}:
        if number(value):result=logical_number(value)
        elif isinstance(value,str):
            text=value
            if field.get("groupChar"):text=text.replace(field["groupChar"],"")
            if field.get("decimalChar",".")!=".":text=text.replace(field["decimalChar"],".")
            if field.get("bareNumber",True)is False:raise ValueError("Non-bare numeric interpretation is not selected")
            if not re.fullmatch(r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?|(?i:NaN|[+-]?INF)",text):raise ValueError("Invalid physical number")
            result=Decimal(text)
        else:raise ValueError("Expected original number or numeric cell")
        if t=="integer"and(not result.is_finite()or result%1):raise ValueError("Expected integer")
        return result
    if t=="boolean":
        if type(value)is bool:return value
        if value in field.get("trueValues",["true","True","TRUE","1"]):return True
        if value in field.get("falseValues",["false","False","FALSE","0"]):return False
        raise ValueError("Expected original boolean cell")
    if t in {"array","object"}:
        result=fhir.json_value(value,lexical=True)if kind(value)=="string"else value
        if kind(result)!=t:raise ValueError("Wrong JSON cell type")
        return result
    if t in {"date","time","datetime"}:
        if kind(value)!="string":raise ValueError("Expected date/time text")
        if fmt not in {"default","any"}:
            return datetime.strptime(value,fmt)
        if fmt=="any":raise ValueError("Unselected permissive date parser")
        if t=="date":
            if not format_valid(value,"date"):raise ValueError("Expected ISO8601 date")
            return date.fromisoformat(value)
        if t=="time":
            if not format_valid(value,"time"):raise ValueError("Expected ISO8601 time")
            return time.fromisoformat(value.replace("Z","+00:00"))
        if not format_valid(value,"date-time"):raise ValueError("Expected ISO8601 datetime")
        return datetime.fromisoformat(value.replace("Z","+00:00").replace("z","+00:00"))
    raise ValueError("Unsupported original tabular type")

def primitive_valid(value,code):
    if code=="boolean":return type(value)is bool
    if code in {"decimal","integer","positiveInt","unsignedInt"}:
        if not number(value):return False
        v=logical_number(value)
        if not v.is_finite():return False
        if code!="decimal"and v%1:return False
        if code=="integer":return -2147483648<=v<=2147483647
        if code=="positiveInt":return 1<=v<=2147483647
        if code=="unsignedInt":return 0<=v<=2147483647
        return True
    if kind(value)!="string":return False
    if code=="integer64":return bool(re.fullmatch(r"-?(?:0|[1-9][0-9]*)",value))
    if code=="id":return bool(re.fullmatch(r"[A-Za-z0-9.-]{1,64}",value))
    if code=="code":return bool(value)and not value[0].isspace()and not value[-1].isspace()and not re.search(r"\s{2,}|[\r\n\t]",value)
    if code in {"uri","url","canonical"}:
        # FHIR primitive uri values may be relative. The selected check is the
        # non-whitespace primitive syntax; target resolution is retained separately.
        return bool(value)and not re.search(r"\s",value)
    if code=="oid":return format_valid(value,"oid")
    if code=="uuid":return format_valid(value,"uuid-urn")
    if code=="instant":return format_valid(value,"instant")
    if code in {"date","dateTime"}:
        if re.fullmatch(r"\d{4}",value):return int(value)>0
        if re.fullmatch(r"\d{4}-\d{2}",value):
            try:date.fromisoformat(value+"-01");return True
            except ValueError:return False
        return format_valid(value,"date")or code=="dateTime"and format_valid(value,"date-time")
    if code=="time":
        return bool(re.fullmatch(r"\d{2}:\d{2}:\d{2}(?:\.\d+)?",value))and format_valid(value,"time")
    if code=="base64Binary":
        import base64
        try:base64.b64decode(re.sub(r"\s","",value),validate=True);return True
        except ValueError:return False
    if code=="xhtml":return None
    return bool(value)

def selected_nodes(root,path):
    """Yield existing parent objects with their exact JSON pointers, expanding arrays."""
    rows=[("",root)]
    for token in path:
        out=[]
        for p,value in rows:
            entries=list(enumerate(value))if isinstance(value,list)else[(None,value)]
            for i,obj in entries:
                ip=p+"/"+str(i)if i is not None else p
                if not isinstance(obj,dict)or token not in obj:continue
                out.append((ip+"/"+ptr(token),obj[token]))
        rows=out
    result=[]
    for p,v in rows:
        if isinstance(v,list):result.extend((p+"/"+str(i),item)for i,item in enumerate(v))
        else:result.append((p,v))
    return result

def pattern_match(value,expected):
    if isinstance(expected,dict):
        if not isinstance(value,dict)or any(k not in value for k in expected):return False
        outcomes=[pattern_match(value[k],v)for k,v in expected.items()]
        return False if False in outcomes else None if None in outcomes else True
    if isinstance(expected,list):
        if not isinstance(value,list):return False
        # FHIR R4 ElementDefinition.pattern[x]: each pattern member matches
        # at least one original member; the standard does not require distinct matches.
        if len(expected)>64 or len(value)>10000:return None
        unknown=False
        for wanted in expected:
            outcomes=[pattern_match(item,wanted)for item in value]
            if True in outcomes:continue
            if None in outcomes:unknown=True
            else:return False
        return None if unknown else True
    return same(value,expected)

def fhir_type(t):
    code=t.get("code","")
    for extension in t.get("extension",[]):
        if extension.get("url")=="http://hl7.org/fhir/StructureDefinition/structuredefinition-fhir-type":
            return extension.get("valueUrl",extension.get("valueUri",code))
    return {"http://hl7.org/fhirpath/System.String":"string",
        "http://hl7.org/fhirpath/System.Boolean":"boolean",
        "http://hl7.org/fhirpath/System.Integer":"integer",
        "http://hl7.org/fhirpath/System.Decimal":"decimal",
        "http://hl7.org/fhirpath/System.Date":"date",
        "http://hl7.org/fhirpath/System.DateTime":"dateTime",
        "http://hl7.org/fhirpath/System.Time":"time"}.get(code,code)

class HsdRules:
    def __init__(self,definitions):
        self.definitions=definitions
        self.by_type={d["resource"]["type"]:d for d in definitions}
    def location(self,d,i,key=None):
        ref=d["ref"];v=d["resource"]
        return {"sourceId":ref["sourceId"],"recordId":ref["recordId"],
            "resourceSha256":ref["resourceSha256"],"memberName":ref.get("memberName"),
            "memberSha256":ref.get("memberSha256"),"profile":v["url"],"version":v.get("version"),
            "pointer":"/snapshot/element/"+str(i)+(("/"+ptr(key))if key else ""),
            "url":v["url"]}
    def catalogue(self):
        rules=[]
        for d in self.definitions:
            v=d["resource"]
            for i,e in enumerate(v["snapshot"]["element"]):
                sliced=":"in e.get("id","")or bool(e.get("sliceName"))
                for k,val in e.items():
                    if k in {"min","max","type","binding","constraint","slicing","mustSupport","contentReference","minValue","maxValue","maxLength"}or k.startswith(("fixed","pattern","minValue","maxValue")):
                        mode="unevaluated"if sliced or "."not in e["path"]or k in {"binding","constraint","slicing","mustSupport","contentReference"}or k.startswith(("minValue","maxValue"))else "evaluated"
                        rules.append({"family":"fhir-hsd-1.0.0","table":v["type"],"elementId":e.get("id"),
                            "path":e["path"],"keyword":k,"requirement":val,"mode":mode,"checkScope":"Selected primitive syntax or complex JSON object shape; nested base datatype and target profiles remain separate unevaluated requirements"if k=="type"else"Exact selected unsliced snapshot assertion"if mode=="evaluated"else"Original requirement retained without evaluation","source":self.location(d,i,k)})
                for t,typ in enumerate(e.get("type",[])):
                    for key in ("profile","targetProfile","aggregation","versioning"):
                        if key in typ:
                            rules.append({"family":"fhir-hsd-1.0.0","table":v["type"],"elementId":e.get("id"),
                                "path":e["path"],"keyword":"type."+key,"requirement":typ[key],
                                "mode":"unevaluated","source":{**self.location(d,i,"type"),"pointer":self.location(d,i,"type")["pointer"]+"/"+str(t)+"/"+key}})
            rules.append({"family":"fhir-hsd-1.0.0","table":v["type"],"keyword":"baseDefinition",
                "requirement":v.get("baseDefinition"),"mode":"unevaluated","source":{**d["ref"],"pointer":"/baseDefinition","url":v["url"]}})
        for r in rules:r["id"]=sha(jbytes(r))
        return rules
    def check(self,row,emit,count):
        d=self.by_type.get(row["table"]);resource=row["data"]
        if d is None:
            count("hsd-profile-unselected","not-evaluated")
            emit("hsd-profile-unselected","not-evaluated","","No exact HSD snapshot was selected for this original resource type.",{"family":"fhir-hsd-1.0.0"},resource);return
        for i,e in enumerate(d["resource"]["snapshot"]["element"]):
            if ":"in e.get("id","")or e.get("sliceName"):continue
            tokens=e["path"].split(".")[1:]
            if not tokens:continue
            last=tokens[-1];parents=selected_nodes(resource,tokens[:-1])
            for parent_ptr,parent in parents:
                if not isinstance(parent,dict):continue
                choices=[last]
                if last.endswith("[x]"):
                    stem=last[:-3];choices=[stem+fhir_type(t)[0].upper()+fhir_type(t)[1:]for t in e.get("type",[])if t.get("code")]
                occurrences=[]
                for name in choices:
                    if name not in parent:continue
                    original=parent[name];is_array=isinstance(original,list)
                    values=list(enumerate(original))if is_array else[(None,original)]
                    for n,value in values:
                        extensions=parent.get("_"+name)
                        companion=extensions[n]if n is not None and isinstance(extensions,list)and n<len(extensions)else extensions if n is None else None
                        occurrences.append((parent_ptr+"/"+ptr(name)+("/"+str(n)if n is not None else ""),value,companion))
                    expected_array=e.get("base",{}).get("max")=="*"or e.get("base",{}).get("max","1").isdigit()and int(e.get("base",{}).get("max","1"))>1
                    if expected_array and not is_array:
                        count("fhir-array-shape","error");emit("fhir-array-shape","error",parent_ptr+"/"+ptr(name),"A repeating FHIR element must retain its JSON array representation.",self.location(d,i,"base"),original)
                    elif not expected_array and is_array and e.get("base",{}).get("max")=="1":
                        count("fhir-scalar-shape","error");emit("fhir-scalar-shape","error",parent_ptr+"/"+ptr(name),"A non-repeating FHIR element must not use an array representation.",self.location(d,i,"base"),original)
                minimum=e.get("min",0);maximum=e.get("max","*")
                # Extension-only primitives may satisfy cardinality; retain an explicit
                # unevaluated requirement rather than invent a primitive value.
                extension_only=not occurrences and any("_"+name in parent for name in choices)
                if extension_only:
                    count("fhir-primitive-extension","not-evaluated")
                    emit("fhir-primitive-extension","not-evaluated",parent_ptr+"/"+ptr(last),"Primitive extension-only cardinality requires full FHIR validation.",self.location(d,i),parent)
                else:
                    valid=len(occurrences)>=minimum and(maximum=="*"or len(occurrences)<=int(maximum))
                    count("fhir-cardinality","pass"if valid else "error")
                    if not valid:emit("fhir-cardinality","error",parent_ptr+"/"+ptr(last),"Original element count is outside the selected snapshot cardinality.",self.location(d,i),len(occurrences))
                for p,value,companion in occurrences:
                    if value is None:
                        if isinstance(companion,dict)and companion:
                            count("fhir-primitive-extension","not-evaluated");emit("fhir-primitive-extension","not-evaluated",p,"Original null placeholder has a paired primitive extension; full FHIR validation is required.",self.location(d,i),companion)
                        else:
                            count("fhir-null","error");emit("fhir-null","error",p,"FHIR JSON null has no paired original primitive extension.",self.location(d,i),value)
                        continue
                    codes=[fhir_type(t)for t in e.get("type",[])if t.get("code")]
                    primitives=[c for c in codes if c in FHIR_PRIMITIVES]
                    if primitives:
                        outcomes=[primitive_valid(value,c)for c in primitives]
                        result=True if True in outcomes else None if None in outcomes else False
                        count("fhir-primitive","pass"if result else "not-evaluated"if result is None else "error")
                        if not result:emit("fhir-primitive","not-evaluated"if result is None else "error",p,"Original value does not satisfy the selected primitive syntax."if result is False else "This primitive requires an external standards validator.",self.location(d,i,"type"),value)
                    elif codes and not isinstance(value,dict):
                        count("fhir-complex-type","error");emit("fhir-complex-type","error",p,"The selected complex FHIR datatype requires an object.",self.location(d,i,"type"),value)
                    for k,expected in e.items():
                        if k.startswith("fixed"):valid=same(value,expected)
                        elif k.startswith("pattern"):valid=pattern_match(value,expected)
                        elif k=="maxLength"and kind(value)=="string":valid=len(value)<=expected
                        else:continue
                        severity="not-evaluated"if valid is None else "error"
                        count("fhir-"+k,"pass"if valid else severity)
                        if not valid:emit("fhir-"+k,severity,p,"Original value differs from the exact selected snapshot assertion."if valid is not None else "This snapshot pattern exceeds the bounded comparison scope.",self.location(d,i,k),value)
