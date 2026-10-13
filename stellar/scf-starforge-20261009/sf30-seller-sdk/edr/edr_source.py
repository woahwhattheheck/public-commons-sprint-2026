"""MIT. Original EDR CoverageJSON on the maintained SF30 native source engine.

Preserves complete source responses, declared query scope, exact axes, range order,
missing values and original parameter/reference metadata. No implicit resampling.
"""
from __future__ import annotations
import hashlib, io, itertools, json, math, re, stat, sys, zipfile
from fractions import Fraction
from pathlib import Path, PurePosixPath
from urllib.parse import parse_qsl, quote, urlencode, urljoin, urlsplit, urlunsplit

XML=Path(__file__).resolve().parent.parent/"xml"
if str(XML) not in sys.path: sys.path.insert(0,str(XML))
from xml_source import InputError, MAX_SOURCE, validate_plan as xml_plan, dataset_spec as native_spec, typed, utf16_length

SOURCE_SCHEMA="stellar-forge.edr-source.v1"
PLAN_SCHEMA="stellar-forge.edr-mapping.v1"
QUERY_SCHEMA="stellar-forge.edr-query.v1"
MAX_PACKET=2*MAX_SOURCE
MAX_DOCUMENT=32*1024*1024
MAX_PAGES=4096
MAX_ROWS=1000000
MAX_FIELDS=512
HEX=re.compile(r"[0-9a-f]{64}\Z")
NUMBER=re.compile(r"-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?\Z")
ID=re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,95}\Z")
SENSITIVE_QUERY={"access_token","token","api_key","apikey","key","signature","sig","password","secret","authorization"}
RECEIPT_HEADERS={"content-type","content-length","date","etag","last-modified","cache-control","vary","server","retry-after"}
SCHEMA_POLICY="coveragejson-layout-lexical-v1"
MAX_LINKED=4096
MAX_COVERAGES=100000
QUERY_TYPES={"position","radius","area","cube","trajectory","corridor","locations","items"}

class Number(str):
    """One original JSON numeric token, never a binary floating-point surrogate."""

_MISSING=object()

def sha(raw): return hashlib.sha256(raw).hexdigest()

def json_value(raw,lexical=False):
    def pairs(items):
        result={}
        for key,value in items:
            if key in result:raise InputError("Duplicate JSON member: "+key)
            result[key]=value
        return result
    def bad_constant(value):raise InputError("Nonstandard JSON numeric token: "+value)
    try:
        return json.loads(raw,object_pairs_hook=pairs,parse_constant=bad_constant,
            **({"parse_int":Number,"parse_float":Number} if lexical else {}))
    except (ValueError,UnicodeError,TypeError,RecursionError) as error:
        if isinstance(error,InputError):raise
        raise InputError("Expected complete UTF-8 JSON") from error

def lexical_json(value,sort_keys=False,_depth=0):
    if _depth>64:raise InputError("JSON nesting exceeds 64 levels")
    if isinstance(value,Number):
        if not NUMBER.fullmatch(value):raise InputError("Invalid retained JSON number")
        return str(value)
    if value is None:return "null"
    if value is True:return "true"
    if value is False:return "false"
    if isinstance(value,str):return json.dumps(value,ensure_ascii=False)
    if isinstance(value,(int,float)):
        return json.dumps(value,allow_nan=False,separators=(",",":"))
    if isinstance(value,list):
        return "["+",".join(lexical_json(v,sort_keys,_depth+1) for v in value)+"]"
    if isinstance(value,dict):
        keys=sorted(value) if sort_keys else value.keys()
        if any(not isinstance(k,str) for k in keys):raise InputError("JSON object names must be strings")
        return "{"+",".join(json.dumps(k,ensure_ascii=False)+":"+lexical_json(value[k],sort_keys,_depth+1) for k in keys)+"}"
    raise InputError("Unsupported JSON value")

def jbytes(value):
    try:return (json.dumps(value,sort_keys=True,ensure_ascii=False,separators=(",",":"),allow_nan=False)+"\n").encode("utf-8")
    except (ValueError,UnicodeError,TypeError,RecursionError) as error:raise InputError("Invalid JSON value") from error

def schema_sha(value):
    try:return sha(lexical_json(value,True).encode("utf-8"))
    except (ValueError,UnicodeError,RecursionError) as error:raise InputError("Invalid observation schema") from error

def text(value,label,maximum=2048,empty=False):
    if not isinstance(value,str) or (not value and not empty) or len(value)>maximum or re.search(r"[\x00-\x1f\x7f]",value):
        raise InputError(label+" must be printable text")
    return value

def integer(value,low,high,label):
    if type(value)is not int or not low<=value<=high:raise InputError(label+" is outside its supported integer range")
    return value

def exact(value,allowed,label,required=()):
    if not isinstance(value,dict) or set(value)-set(allowed) or set(required)-set(value):raise InputError("Invalid "+label+" fields")
    return value

def origin(value):
    u=urlsplit(value)
    try:port=u.port
    except ValueError as error:raise InputError("Invalid URL port") from error
    host=(u.hostname or "").lower()
    if ":" in host:host="["+host+"]"
    if port and port!=(443 if u.scheme=="https" else 80):host+=":"+str(port)
    return u.scheme.lower()+"://"+host

def url(value,base=None,allowed_origins=None,query=True):
    value=text(value,"Resource URL",8192)
    if any(c in value for c in "\\ \t\r\n"):raise InputError("Resource URL contains whitespace or a backslash")
    value=urljoin(base,value) if base else value
    try:u=urlsplit(value)
    except ValueError as error:raise InputError("Invalid resource URL") from error
    if u.scheme not in {"https","http"} or not u.hostname or u.username is not None or u.password is not None or u.fragment:
        raise InputError("Use an HTTP(S) URL without credentials or fragment")
    if u.scheme=="http" and u.hostname not in {"localhost","127.0.0.1","::1"}:
        raise InputError("Remote Connected Systems sources require HTTPS")
    origin(value)
    if not query and u.query:raise InputError("Base URLs cannot contain a query")
    if any(name.lower() in SENSITIVE_QUERY for name,_ in parse_qsl(u.query,keep_blank_values=True)):
        raise InputError("Authentication belongs in the selected host environment, not source URLs")
    if allowed_origins is not None and origin(value) not in set(allowed_origins):
        raise InputError("Linked resource belongs to an origin not approved in this connection")
    return value

def base_url(value):
    value=url(value,query=False)
    u=urlsplit(value)
    if any(part in {".",".."} for part in u.path.split("/")):raise InputError("Invalid endpoint base path")
    return urlunsplit((u.scheme,u.netloc,u.path.rstrip("/")+"/","",""))

def origin_list(base,values):
    if not isinstance(values,list) or len(values)>16:raise InputError("Choose at most 16 explicit public linked origins")
    result=[]
    for value in [origin(base),*values]:
        checked=url(value)
        u=urlsplit(checked)
        if u.path not in {"","/"} or u.query:raise InputError("Allowed origins must not contain resource paths")
        normalized=origin(checked)
        if normalized not in result:result.append(normalized)
    return result

def parameters(value):
    if value is None:return []
    if not isinstance(value,list) or len(value)>32:raise InputError("Query parameters must be an ordered list of at most 32 name/value pairs")
    result=[]
    for pair in value:
        exact(pair,{"name","value"},"query parameter",{"name","value"})
        name=text(pair["name"],"Parameter name",128);val=text(pair["value"],"Parameter value",4096,True)
        if name.lower() in SENSITIVE_QUERY:raise InputError("Credentials cannot be retained as query parameters")
        result.append({"name":name,"value":val})
    return result

def query_url(resource,params):
    values=parameters(params)
    if not values:return resource
    u=urlsplit(resource)
    added=urlencode([(v["name"],v["value"]) for v in values],quote_via=quote,safe="")
    return urlunsplit((u.scheme,u.netloc,u.path,u.query+("&" if u.query else "")+added,""))

def pointer(value):
    text(value,"JSON pointer",4096,True)
    if value=="" :return value
    if not value.startswith("/") or re.search(r"~(?![01])",value):raise InputError("Use an exact RFC6901 JSON pointer")
    if len(value.split("/"))>65:raise InputError("JSON pointer exceeds supported depth")
    return value

def pointer_token(value):return value.replace("~","~0").replace("/","~1")

def resolve(value,path):
    pointer(path)
    if path=="":return value
    for token in path[1:].split("/"):
        token=token.replace("~1","/").replace("~0","~")
        if isinstance(value,dict):
            if token not in value:return _MISSING
            value=value[token]
        elif isinstance(value,list):
            if not re.fullmatch(r"0|[1-9][0-9]*",token):return _MISSING
            index=int(token)
            if index>=len(value):return _MISSING
            value=value[index]
        else:return _MISSING
    return value

def next_link(document,request_url,allowed_origins):
    if not isinstance(document,dict):raise InputError("Provider JSON must be an object")
    links=document.get("links",[])
    if not isinstance(links,list) or len(links)>4096:raise InputError("Invalid provider links")
    next_urls=[]
    for link in links:
        if not isinstance(link,dict):raise InputError("Invalid provider link")
        if link.get("rel") in {"next","http://www.iana.org/assignments/relation/next"}:
            value=url(link.get("href"),request_url,allowed_origins)
            if value not in next_urls:next_urls.append(value)
    if len(next_urls)>1:raise InputError("Provider returned different next-page links")
    return next_urls[0] if next_urls else None


def collection(document):
    if not isinstance(document,dict):raise InputError("An EDR discovery response must be a JSON object")
    names=[name for name in ("collections","instances","features","items") if name in document]
    if len(names)>1:raise InputError("Ambiguous discovery item containers")
    if not names:return []
    values=document[names[0]]
    if not isinstance(values,list) or any(not isinstance(v,dict) for v in values):raise InputError("Invalid discovery item array")
    return values

def query_types(document,base,allowed):
    if not isinstance(document,dict):raise InputError("Collection metadata must be a JSON object")
    queries=document.get("data_queries",{})
    if not isinstance(queries,dict):raise InputError("Invalid collection data_queries")
    result=[]
    for kind,value in queries.items():
        if kind not in QUERY_TYPES:continue
        if not isinstance(value,dict):raise InputError("Invalid advertised query descriptor")
        link=value.get("link")
        if not isinstance(link,dict) or not isinstance(link.get("href"),str):raise InputError("Advertised query has no original link")
        variables=link.get("variables",{})
        if not isinstance(variables,dict) or variables.get("query_type",kind)!=kind:raise InputError("Advertised query type differs from its link")
        result.append({"type":kind,"href":url(link["href"],base,allowed),"mediaType":link.get("type"),"variables":variables})
    return result

def validate_query_route(document,base,allowed,selection):
    ident=document.get("id")
    if not isinstance(ident,str) or isinstance(ident,Number):raise InputError("Selected collection must retain its literal ID")
    text(ident,"Collection ID",2048)
    options=[v for v in query_types(document,base,allowed) if v["type"]==selection["queryType"]]
    if not options:raise InputError("The selected query type is not advertised by this collection")
    selected=url(selection["queryUrl"],allowed_origins=allowed);su=urlsplit(selected)
    for option in options:
        advertised=urlsplit(option["href"])
        if (su.scheme,su.netloc)!=(advertised.scheme,advertised.netloc):continue
        exact_path=su.path.rstrip("/")==advertised.path.rstrip("/")
        child=selection["queryType"] in {"locations","items"} and su.path.startswith(advertised.path.rstrip("/")+"/")
        if not (exact_path or child):continue
        # The explicit selected URL may include published format/query parameters.
        # Existing advertised query parameters cannot be silently changed.
        selected_params=parse_qsl(su.query,keep_blank_values=True)
        if all(pair in selected_params for pair in parse_qsl(advertised.query,keep_blank_values=True)):return ident
    raise InputError("Selected query URL does not match the collection's advertised route")

def number_fraction(value,label):
    if not isinstance(value,Number) and type(value)is not int:raise InputError(label+" must be an original JSON number")
    token=str(value)
    if len(token)>2048 or not NUMBER.fullmatch(token):raise InputError(label+" exceeds the exact numeric capacity")
    exponent=re.search(r"[eE]([+-]?\d+)$",token)
    if exponent and abs(int(exponent[1]))>4096:raise InputError(label+" exponent exceeds the exact numeric capacity")
    try:return Fraction(token)
    except (ValueError,ZeroDivisionError,OverflowError) as error:raise InputError("Invalid "+label) from error

def source_integer(value,low,high,label):
    number=number_fraction(value,label)
    if number.denominator!=1 or not low<=number.numerator<=high:raise InputError(label+" is outside its supported integer range")
    return number.numerator

def exact_coordinate(value):
    """Return a finite decimal token or an explicitly labelled exact rational."""
    denominator=value.denominator;twos=fives=0
    while denominator%2==0:denominator//=2;twos+=1
    while denominator%5==0:denominator//=5;fives+=1
    if denominator!=1:return {"encoding":"exact-rational","numerator":str(value.numerator),"denominator":str(value.denominator)}
    scale=max(twos,fives)
    numerator=value.numerator*(2**(scale-twos))*(5**(scale-fives))
    sign="-" if numerator<0 else "";digits=str(abs(numerator))
    if not scale:return Number(sign+digits)
    digits=digits.rjust(scale+1,"0")
    token=sign+digits[:-scale]+"."+digits[-scale:]
    token=token.rstrip("0").rstrip(".")
    return Number(token if token not in {"","-"} else "0")

def _primitive(value,label):
    if isinstance(value,Number):number_fraction(value,label);return
    if isinstance(value,str) and not isinstance(value,Number):return
    raise InputError(label+" must retain an original number or string")

def _i18n(value,label):
    if not isinstance(value,dict) or not value or any(not isinstance(k,str) or not isinstance(v,str) or isinstance(v,Number) for k,v in value.items()):
        raise InputError(label+" must be a nonempty language-label object")

def parameter(value):
    if not isinstance(value,dict) or value.get("type")!="Parameter":raise InputError("Expected an original CoverageJSON Parameter")
    prop=value.get("observedProperty")
    if not isinstance(prop,dict):raise InputError("Parameter has no observedProperty")
    _i18n(prop.get("label"),"Observed property label")
    codes=None
    categories=prop.get("categories")
    if categories is not None:
        if not isinstance(categories,list) or not categories:raise InputError("Parameter categories must be a nonempty array")
        ids=[]
        for item in categories:
            if not isinstance(item,dict):raise InputError("Invalid original category")
            ident=text(item.get("id"),"Category ID",8192);_i18n(item.get("label"),"Category label");ids.append(ident)
        if len(set(ids))!=len(ids):raise InputError("Repeated category ID")
        if "unit" in value:raise InputError("Categorical parameters cannot also declare a unit")
        encoding=value.get("categoryEncoding")
        if encoding is not None:
            if not isinstance(encoding,dict) or set(encoding)-set(ids):raise InputError("Category encoding references an absent original category")
            codes=set()
            for assigned in encoding.values():
                assigned=assigned if isinstance(assigned,list) else [assigned]
                for code in assigned:
                    integer_code=number_fraction(code,"Category code")
                    if integer_code.denominator!=1 or integer_code in codes:raise InputError("Category codes must be distinct integers")
                    codes.add(integer_code)
    elif "categoryEncoding" in value:raise InputError("Category encoding needs the original categories")
    unit=value.get("unit")
    if unit is not None:
        if not isinstance(unit,dict) or not ({"label","symbol"}&set(unit)):raise InputError("Unit must retain its original label or symbol")
        if "label" in unit:_i18n(unit["label"],"Unit label")
        symbol=unit.get("symbol")
        if symbol is not None and not (isinstance(symbol,str) and not isinstance(symbol,Number)):
            if not isinstance(symbol,dict) or not isinstance(symbol.get("value"),str) or not isinstance(symbol.get("type"),str):raise InputError("Invalid original unit symbol")
    return codes

class Axis:
    def __init__(self,name,value):
        text(name,"Axis identifier",160)
        if not isinstance(value,dict):raise InputError("Domain axis must be an object")
        self.name=name;self.raw=value
        self.kind=value.get("dataType","primitive")
        if self.kind not in {"primitive","tuple","polygon"}:raise InputError("Unsupported custom axis dataType: "+str(self.kind))
        coordinates=value.get("coordinates",[name])
        if not isinstance(coordinates,list) or not coordinates or len(set(coordinates))!=len(coordinates) or any(not isinstance(v,str) or isinstance(v,Number) for v in coordinates):
            raise InputError("Axis coordinate identifiers must be distinct strings")
        if self.kind=="primitive" and len(coordinates)!=1:raise InputError("A primitive axis exposes exactly one coordinate identifier")
        self.coordinates=coordinates;self.values=None;self.regular=None
        if "values" in value:
            if any(k in value for k in ("start","stop","num")):raise InputError("An axis cannot mix explicit values and regular-axis members")
            values=value["values"]
            if not isinstance(values,list) or not values or len(values)>MAX_ROWS:raise InputError("Invalid or excessive domain axis")
            self.values=values;self.size=len(values)
            for item in values:self._value(item)
        else:
            if self.kind!="primitive" or any(k not in value for k in ("start","stop","num")):raise InputError("A regular axis needs start, stop and num")
            size=source_integer(value["num"],1,MAX_ROWS,"Axis num")
            start=number_fraction(value["start"],"Axis start");stop=number_fraction(value["stop"],"Axis stop")
            if size==1 and start!=stop:raise InputError("A singleton regular axis must have equal start and stop")
            self.size=size;self.regular=(start,stop)
        bounds=value.get("bounds")
        if bounds is not None:
            if not isinstance(bounds,list) or len(bounds)!=2*self.size:raise InputError("Axis bounds must retain two values for every coordinate")
            for item in bounds:self._value(item)
        self.bounds=bounds
    def _value(self,value):
        if self.kind=="primitive":_primitive(value,"Axis value");return
        if self.kind=="tuple":
            if not isinstance(value,list) or len(value)!=len(self.coordinates):raise InputError("Tuple axis value differs from its coordinate order")
            for v in value:_primitive(v,"Tuple coordinate")
            return
        if not isinstance(value,list) or not value:raise InputError("Polygon axis value needs its original rings")
        for ring in value:
            if not isinstance(ring,list) or len(ring)<4:raise InputError("Polygon rings need at least four positions")
            if lexical_json(ring[0])!=lexical_json(ring[-1]):raise InputError("Polygon ring is not closed")
            for position in ring:
                if not isinstance(position,list) or len(position)!=len(self.coordinates):raise InputError("Polygon position differs from its coordinate order")
                for v in position:number_fraction(v,"Polygon coordinate")
    def coordinate(self,index):
        if self.values is not None:return self.values[index]
        if index==0:return self.raw["start"]
        if index==self.size-1:return self.raw["stop"]
        start,stop=self.regular
        return exact_coordinate(start+index*(stop-start)/(self.size-1))
    def summary(self):
        return {"id":self.name,"size":self.size,"dataType":self.kind,"coordinates":self.coordinates,
            "regular":{k:self.raw[k] for k in ("start","stop","num")} if self.regular is not None else None,
            "first":self.coordinate(0),"last":self.coordinate(self.size-1),"bounds":self.bounds is not None}

def _shape(value,label):
    if not isinstance(value,list):raise InputError(label+" must be an array")
    return [source_integer(v,1,MAX_ROWS,label) for v in value]

def _array(value):
    if not isinstance(value,dict) or value.get("type")!="NdArray":raise InputError("Linked range must be a complete NdArray")
    kind=value.get("dataType")
    if kind not in {"float","integer","string"}:raise InputError("Unsupported range dataType")
    shape=_shape(value.get("shape",[]),"Range shape")
    axes=value.get("axisNames",[])
    if not isinstance(axes,list) or len(axes)!=len(shape) or len(set(axes))!=len(axes) or any(not isinstance(a,str) or isinstance(a,Number) for a in axes):
        raise InputError("Range axisNames must exactly name its dimensions")
    values=value.get("values")
    if not isinstance(values,list) or not values or len(values)>MAX_ROWS or math.prod(shape)!=len(values):
        raise InputError("Range shape does not match all original values")
    for val in values:
        if val is None:continue
        if kind=="string":
            if not isinstance(val,str) or isinstance(val,Number):raise InputError("String range contains a nonstring value")
        else:
            n=number_fraction(val,"Range value")
            if kind=="integer" and n.denominator!=1:raise InputError("Integer range contains a noninteger value")
    return axes,shape,kind,values

def _resolve(value,base,allowed,loader,label):
    if isinstance(value,str) and not isinstance(value,Number):
        requested=url(value,base,allowed)
        loaded=loader(requested)
        if not isinstance(loaded,dict) or not isinstance(loaded.get("document"),dict):raise InputError("Linked "+label+" must be an original JSON object")
        return loaded["document"],url(loaded.get("finalUrl",requested),allowed_origins=allowed)
    if not isinstance(value,dict):raise InputError(label+" must be inline or an explicit original URL")
    return value,base

class Range:
    def __init__(self,value,base,allowed,loader,tile_set):
        value,base=_resolve(value,base,allowed,loader,"range")
        self.raw=value;self.tiles=None
        if value.get("type")=="NdArray":
            self.axes,self.shape,self.kind,self.values=_array(value);return
        if value.get("type")!="TiledNdArray":raise InputError("Unsupported CoverageJSON range encoding")
        self.axes=value.get("axisNames");self.shape=_shape(value.get("shape"),"Tiled range shape");self.kind=value.get("dataType")
        if not self.shape or self.kind not in {"float","integer","string"} or not isinstance(self.axes,list) or len(self.axes)!=len(self.shape) or len(set(self.axes))!=len(self.axes) or any(not isinstance(a,str) or isinstance(a,Number) for a in self.axes):
            raise InputError("Invalid original tiled range dimensions")
        if math.prod(self.shape)>MAX_ROWS:raise InputError("Tiled range exceeds the supported complete cell count")
        sets=value.get("tileSets")
        if not isinstance(sets,list) or not 0<=tile_set<len(sets):raise InputError("Selected tile set is not available in the original range")
        chosen=sets[tile_set]
        if not isinstance(chosen,dict):raise InputError("Invalid selected tile set")
        tile_shape=chosen.get("tileShape")
        if not isinstance(tile_shape,list) or len(tile_shape)!=len(self.shape):raise InputError("Tile shape does not match range dimensions")
        self.tile_shape=[size if v is None else source_integer(v,1,size,"Tile shape") for v,size in zip(tile_shape,self.shape)]
        template=text(chosen.get("urlTemplate"),"Tile URL template",8192)
        names=re.findall(r"\{([^{}]+)\}",template)
        expected={axis for axis,v in zip(self.axes,tile_shape) if v is not None}
        if set(names)!=expected or any(name not in self.axes for name in names) or re.search(r"[{}]",re.sub(r"\{[^{}]+\}","",template)):
            raise InputError("Tile URL must be a simple Level 1 template for exactly its tiled axes")
        counts=[(size+tile-1)//tile for size,tile in zip(self.shape,self.tile_shape)]
        if math.prod(counts)>MAX_LINKED:raise InputError("Selected tile set exceeds the linked document capacity")
        self.tiles={};self.values=None
        for coordinate in itertools.product(*(range(n) for n in counts)):
            variables={axis:str(n) for axis,n in zip(self.axes,coordinate)}
            requested=re.sub(r"\{([^{}]+)\}",lambda m:variables[m[1]],template)
            tile,_=_resolve(requested,base,allowed,loader,"tile")
            axes,shape,kind,values=_array(tile)
            required=[min(tile_size,size-index*tile_size) for index,tile_size,size in zip(coordinate,self.tile_shape,self.shape)]
            if (axes,shape,kind)!=(self.axes,required,self.kind):raise InputError("Original tile does not match its declared edge shape and axis order")
            self.tiles[coordinate]=(shape,values)
    def at(self,indices,flat):
        if self.tiles is None:return self.values[flat]
        tile=tuple(n//size for n,size in zip(indices,self.tile_shape))
        within=[n%size for n,size in zip(indices,self.tile_shape)]
        shape,values=self.tiles[tile];index=0
        for value,size in zip(within,shape):index=index*size+value
        return values[index]

class CoverageDocument:
    def __init__(self,document,base,allowed,loader,tile_set=0):
        if not isinstance(document,dict):raise InputError("Expected a CoverageJSON object")
        if document.get("type")=="Coverage":items=[document];parent={}
        elif document.get("type")=="CoverageCollection":
            items=document.get("coverages");parent=document
            if not isinstance(items,list) or len(items)>MAX_COVERAGES:raise InputError("Invalid or excessive CoverageCollection")
        else:raise InputError("EDR selected response must be Coverage or CoverageCollection")
        self.coverages=[];self.schema=[];self.total=0;self.issues=[]
        for index,item in enumerate(items):
            if not isinstance(item,dict) or item.get("type")!="Coverage":raise InputError("CoverageCollection contains a non-Coverage")
            ident=item.get("id")
            if ident is not None and (not isinstance(ident,str) or isinstance(ident,Number)):raise InputError("Coverage ID must retain its original string")
            domain,domain_base=_resolve(item.get("domain"),base,allowed,loader,"domain")
            if domain.get("type")!="Domain":raise InputError("Expected an original Domain")
            axes_raw=domain.get("axes")
            if not isinstance(axes_raw,dict) or not axes_raw or len(axes_raw)>64:raise InputError("Domain needs its original named axes")
            axes={name:Axis(name,value) for name,value in axes_raw.items()}
            coordinates=[v for axis in axes.values() for v in axis.coordinates]
            if len(set(coordinates))!=len(coordinates):raise InputError("Domain coordinate identifiers are repeated")
            referencing=domain.get("referencing",parent.get("referencing"))
            if not isinstance(referencing,list):raise InputError("Domain must retain its original reference systems")
            for ref in referencing:
                if not isinstance(ref,dict) or not isinstance(ref.get("coordinates"),list) or not ref["coordinates"] or any(c not in coordinates for c in ref["coordinates"]) or not isinstance(ref.get("system"),dict) or not isinstance(ref["system"].get("type"),str):
                    raise InputError("Reference system coordinates differ from the original domain")
            for ref in referencing:
                if ref["system"].get("type")=="TemporalRS" and ref["system"].get("calendar")=="Gregorian":
                    for axis_name,axis in axes.items():
                        if axis.kind!="primitive" or not set(axis.coordinates)&set(ref["coordinates"]):continue
                        values=axis.values if axis.values is not None else [axis.coordinate(i) for i in range(axis.size)]
                        absent=[v for v in values if isinstance(v,str) and not isinstance(v,Number) and "T" in v and not re.search(r"(?:Z|[+-]\d{2}:\d{2})$",v)]
                        if absent:self.issues.append({"code":"gregorian-time-without-zone","coverage":index,"axis":axis_name,"count":len(absent),"examples":absent[:3],
                            "message":"Original Gregorian time strings omit the required zone. Their reference system is retained; no zone is appended or numeric time inferred."})
            dtype=parent.get("domainType",item.get("domainType",domain.get("domainType")))
            if any(v is not None and v!=dtype for v in (parent.get("domainType"),item.get("domainType"),domain.get("domainType"))):
                raise InputError("Inherited domainType differs from an original coverage")
            parent_parameters=parent.get("parameters",{})
            own_parameters=item.get("parameters",{})
            if not isinstance(parent_parameters,dict) or not isinstance(own_parameters,dict) or ("parameters" not in item and "parameters" not in parent):
                raise InputError("Coverage must retain its parameter definitions")
            parameters_raw=dict(parent_parameters)
            for name,value in own_parameters.items():
                if name in parameters_raw and lexical_json(parameters_raw[name],True)!=lexical_json(value,True):
                    raise InputError("Coverage and collection declare different definitions for the same parameter")
                parameters_raw[name]=value
            codes={name:parameter(value) for name,value in parameters_raw.items()}
            ranges_raw=item.get("ranges")
            if not isinstance(ranges_raw,dict):raise InputError("Coverage must retain its original ranges")
            ranges={};summaries=[];range_schema={}
            for name,value in ranges_raw.items():
                text(name,"Parameter identifier",2048)
                if name not in parameters_raw:raise InputError("Range references an absent parameter")
                arr=Range(value,base,allowed,loader,tile_set)
                if set(arr.axes)-set(axes):raise InputError("Range axis is absent from its domain")
                if any(axes[a].size!=size for a,size in zip(arr.axes,arr.shape)):raise InputError("Range shape differs from the domain axis lengths")
                if any(axis.size!=1 for name2,axis in axes.items() if name2 not in arr.axes):raise InputError("A range may omit only singleton domain axes")
                cells=math.prod(arr.shape);self.total+=cells
                if self.total>MAX_ROWS:raise InputError("Complete CoverageJSON response exceeds the cell capacity")
                missing=0
                for flat,coords in enumerate(itertools.product(*(range(size) for size in arr.shape))):
                    val=arr.at(coords,flat);missing+=val is None
                    if val is not None and codes[name] is not None and number_fraction(val,"Category value") not in codes[name]:
                        raise InputError("Range value is absent from the original category encoding")
                ranges[name]=arr
                summaries.append({"parameter":name,"dataType":arr.kind,"axisNames":arr.axes,"shape":arr.shape,"values":cells,"missing":missing,
                    "encoding":arr.raw["type"],"tileSet":tile_set if arr.tiles is not None else None})
                range_schema[name]={"dataType":arr.kind,"axisNames":arr.axes}
            summary={"index":index,"id":ident,"domainType":dtype,"axes":[axis.summary() for axis in axes.values()],
                "referencing":referencing,"parameters":parameters_raw,"ranges":summaries}
            self.coverages.append({"item":item,"domain":domain,"axes":axes,"parameters":parameters_raw,"ranges":ranges,"summary":summary})
            self.schema.append({"domainType":dtype,"axes":{name:{"dataType":axis.kind,"coordinates":axis.coordinates,"bounds":axis.bounds is not None}
                for name,axis in axes.items()},"referencing":referencing,"parameters":parameters_raw,"ranges":range_schema})
    def records(self):
        for coverage_index,cov in enumerate(self.coverages):
            ident=cov["item"].get("id")
            for name,arr in cov["ranges"].items():
                for flat,indices in enumerate(itertools.product(*(range(size) for size in arr.shape))):
                    by_axis={axis:index for axis,index in zip(arr.axes,indices)}
                    by_axis.update({name2:0 for name2 in cov["axes"] if name2 not in by_axis})
                    coordinates={name2:axis.coordinate(by_axis[name2]) for name2,axis in cov["axes"].items()}
                    bounds={name2:axis.bounds[2*by_axis[name2]:2*by_axis[name2]+2] for name2,axis in cov["axes"].items() if axis.bounds is not None}
                    val=arr.at(indices,flat);param=cov["parameters"][name]
                    cell={"coverageId":ident,"parameter":name,"indices":by_axis,"coordinates":coordinates,"bounds":bounds,
                        "value":val,"missing":val is None,"dataType":arr.kind,"unit":param.get("unit"),
                        "parameterMetadata":param,"referencing":cov["summary"]["referencing"]}
                    yield {"coverage":coverage_index,"index":flat,"cell":cell}

def _filename(name):
    if not isinstance(name,str) or not name or len(name)>200 or "\\" in name:raise InputError("Invalid source member name")
    p=PurePosixPath(name)
    if str(p)!=name or p.is_absolute() or any(v in {".",".."} for v in p.parts):raise InputError("Invalid source member path")
    return name

def receipt(entry,body,name,allowed):
    if not isinstance(entry,dict):raise InputError("Missing original response receipt: "+name)
    if type(entry.get("bytes"))is not int or entry["bytes"]!=len(body) or entry.get("sha256")!=sha(body):
        raise InputError("Retained response differs from its original bytes: "+name)
    if entry.get("status")!=200:raise InputError("Source publication requires successful original responses: "+name)
    for field in ("requestUrl","finalUrl"):url(entry.get(field),allowed_origins=allowed)
    headers=entry.get("headers")
    if not isinstance(headers,dict) or set(headers)-RECEIPT_HEADERS:raise InputError("Response headers must use the documented nonsecret allowlist")
    if any(not isinstance(v,str) or len(v)>8192 or "\r" in v or "\n" in v for v in headers.values()):raise InputError("Invalid retained response header")
    for field in ("startedAt","completedAt"):
        if not isinstance(entry.get(field),(str,int,float)) or isinstance(entry.get(field),bool):raise InputError("Retain actual response timestamps")



class Capture:
    """A complete exact EDR response closure; original body bytes remain authority."""
    def __init__(self,stream):
        try:self.archive=zipfile.ZipFile(stream)
        except (zipfile.BadZipFile,OSError) as error:raise InputError("Expected an EDR CoverageJSON source ZIP") from error
        try:
            infos=self.archive.infolist()
            if not 3<=len(infos)<=MAX_PAGES+MAX_LINKED+16 or len({i.filename for i in infos})!=len(infos):raise InputError("Source member count or names are invalid")
            if sum(i.file_size for i in infos)>MAX_SOURCE:raise InputError("Uncompressed source exceeds 256 MiB")
            self.infos={}
            for info in infos:
                _filename(info.filename)
                if info.is_dir() or stat.S_ISLNK(info.external_attr>>16) or info.flag_bits&1 or info.compress_type not in {zipfile.ZIP_STORED,zipfile.ZIP_DEFLATED}:raise InputError("Invalid source ZIP member")
                if info.file_size>MAX_DOCUMENT:raise InputError("One source document exceeds 32 MiB")
                self.infos[info.filename]=info
            if "manifest.json" not in self.infos or self.infos["manifest.json"].file_size>2*1024*1024:raise InputError("Source manifest is missing or excessive")
            self.manifest=json_value(self.read("manifest.json"));m=self.manifest
            required={"schema","endpoint","allowedOrigins","selection","resources","pages","linked","coverage","files","rights"}
            exact(m,required,"source manifest",required)
            if m["schema"]!=SOURCE_SCHEMA:raise InputError("Unsupported EDR source schema")
            self.endpoint=base_url(m["endpoint"]);self.allowed=origin_list(self.endpoint,m["allowedOrigins"])
            files=m["files"]
            if not isinstance(files,dict) or set(files)!=set(self.infos)-{"manifest.json"}:raise InputError("Manifest must identify every original response")
            for name,entry in files.items():receipt(entry,self.read(name),name,self.allowed)
            resources=m["resources"];exact(resources,{"collection","conformance","landing"},"source resources",{"collection"})
            if any(not isinstance(name,str) or name not in files for name in resources.values()):raise InputError("Resource references an absent response")
            self.collection=json_value(self.read(resources["collection"]),True)
            if not isinstance(self.collection,dict):raise InputError("Collection metadata must be an original JSON object")
            self.conformance=json_value(self.read(resources["conformance"])) if "conformance" in resources else None
            selection=m["selection"]
            required_selection={"collectionUrl","queryType","queryUrl","params","limits","tileSet"}
            exact(selection,required_selection,"source selection",required_selection)
            for field in ("collectionUrl","queryUrl"):url(selection[field],allowed_origins=self.allowed)
            if not isinstance(selection["queryType"],str) or selection["queryType"] not in QUERY_TYPES:raise InputError("Unsupported EDR query type")
            parameters(selection["params"])
            integer(selection["tileSet"],0,1000,"tileSet")
            limits=selection["limits"];exact(limits,{"maxPages","maxRows","maxBytes","maxLinkedDocuments"},"acquisition limits",{"maxPages","maxRows","maxBytes","maxLinkedDocuments"})
            integer(limits["maxPages"],1,MAX_PAGES,"maxPages");integer(limits["maxRows"],1,MAX_ROWS,"maxRows")
            integer(limits["maxBytes"],1024,MAX_SOURCE-2*1024*1024,"maxBytes");integer(limits["maxLinkedDocuments"],0,MAX_LINKED,"maxLinkedDocuments")
            if files[resources["collection"]]["requestUrl"]!=selection["collectionUrl"]:raise InputError("Collection metadata belongs to another original query")
            self.collection_id=validate_query_route(self.collection,files[resources["collection"]]["finalUrl"],self.allowed,selection)
            self.query_types=query_types(self.collection,files[resources["collection"]]["finalUrl"],self.allowed)
            pages=m["pages"];linked=m["linked"]
            if not isinstance(pages,list) or not pages or len(pages)>limits["maxPages"] or any(not isinstance(p,str) or p not in files for p in pages) or len(set(pages))!=len(pages):
                raise InputError("Invalid complete CoverageJSON response pages")
            if not isinstance(linked,dict) or len(linked)>limits["maxLinkedDocuments"] or len(set(linked.values()))!=len(linked):raise InputError("Invalid complete linked response map")
            for requested,name in linked.items():
                url(requested,allowed_origins=self.allowed)
                if name not in files or files[name]["requestUrl"]!=requested:raise InputError("Linked response belongs to another original request")
            if set(files)!=set(resources.values())|set(pages)|set(linked.values()):raise InputError("Unaccounted original source response")
            if len(files)!=len(resources)+len(pages)+len(linked):raise InputError("Metadata, page and linked responses require distinct source members")
            if files[pages[0]]["requestUrl"]!=query_url(selection["queryUrl"],selection["params"]):raise InputError("First response differs from the selected EDR query")
            exact(m["rights"],{"license","attribution","usage","sourceUrl"},"source rights")
            for key,val in m["rights"].items():
                if val is not None:text(val,"Rights "+key,8192,True)
            self.schemas={};self.summaries=[];self.issues=[];self._validated=False
        except Exception:self.archive.close();raise
    def __enter__(self):return self
    def __exit__(self,*_):self.archive.close()
    def read(self,name):
        if name not in self.infos:raise InputError("Unknown original source member")
        try:
            with self.archive.open(self.infos[name]) as stream:body=stream.read(MAX_DOCUMENT+1)
        except (zipfile.BadZipFile,RuntimeError,EOFError,OSError) as error:raise InputError("Invalid retained ZIP content") from error
        if len(body)!=self.infos[name].file_size or len(body)>MAX_DOCUMENT:raise InputError("Incomplete or excessive retained response")
        return body
    def records(self):
        m=self.manifest;files=m["files"];count=0;coverage_count=0;next_url=None;seen=set();used_links=set();cache={}
        self.schemas={};self.summaries=[];self.issues=[]
        def load_link(requested):
            if requested not in m["linked"]:raise InputError("CoverageJSON links an unreceived original document: "+requested)
            used_links.add(requested)
            if requested not in cache:
                name=m["linked"][requested];cache[requested]={"document":json_value(self.read(name),True),"finalUrl":files[name]["finalUrl"]}
            return cache[requested]
        for page_number,name in enumerate(m["pages"],1):
            entry=files[name];requested=entry["requestUrl"]
            if requested in seen or (page_number>1 and requested!=next_url):raise InputError("CoverageJSON pages do not follow the complete original next chain")
            seen.add(requested)
            document=json_value(self.read(name),True)
            coverage=CoverageDocument(document,entry["finalUrl"],self.allowed,load_link,m["selection"]["tileSet"])
            next_url=next_link(document,entry["finalUrl"],self.allowed)
            self.issues.extend({"page":page_number,**issue} for issue in coverage.issues)
            for summary in coverage.coverages:self.summaries.append({"page":page_number,**summary["summary"]})
            for schema in coverage.schema:self.schemas[schema_sha(schema)]=schema
            coverage_count+=len(coverage.coverages)
            for row in coverage.records():
                count+=1
                if count>m["selection"]["limits"]["maxRows"]:raise InputError("Complete EDR source exceeds its selected maxRows")
                cell=row["cell"]
                basis={"page":page_number,"coverage":row["coverage"],"coverageId":cell["coverageId"],
                    "parameter":cell["parameter"],"indices":cell["indices"],"coordinates":cell["coordinates"]}
                cell["id"]=sha(lexical_json(basis,True).encode("utf-8"))
                yield {"ordinal":count,"page":page_number,**row}
        expected={"status":"exhausted" if next_url is None else "page-limit","pages":len(m["pages"]),"coverages":coverage_count,
            "values":count,"linkedDocuments":len(used_links),"nextUrl":next_url,"scope":"selected-query-response",
            "consistency":"sequential-responses-not-transactional-snapshot"}
        if next_url is not None and len(m["pages"])!=m["selection"]["limits"]["maxPages"]:raise InputError("A partial EDR capture must retain the actual selected page bound")
        if expected!=m["coverage"]:raise InputError("Coverage differs from the original complete response closure")
        if used_links!=set(m["linked"]):raise InputError("Capture includes a linked document outside the actual CoverageJSON closure")
        if sum(v["bytes"] for v in files.values())>m["selection"]["limits"]["maxBytes"]:raise InputError("Original source exceeds its selected maxBytes")
        self.schema_id=schema_sha({"collectionId":self.collection_id,"coverageLayouts":[self.schemas[k] for k in sorted(self.schemas)]})
        self._validated=True
    def validate(self):
        for _ in self.records():pass
        return self

def read_capture(stream):
    with Capture(stream) as capture:
        capture.validate()
        return {"manifest":capture.manifest,"collection":capture.collection,"schemaSha256":capture.schema_id,
            "queryTypes":capture.query_types,"coverages":capture.summaries,"sourceIssues":capture.issues}

def _kind(value):
    if value is _MISSING:return "missing"
    if isinstance(value,Number) or type(value) in (int,float):return "number"
    if value is None:return "null"
    if isinstance(value,bool):return "boolean"
    if isinstance(value,str):return "string"
    if isinstance(value,list):return "array"
    return "object"

def inventory(stream):
    with Capture(stream) as capture:
        fields={};count=0;omitted=0
        def inspect(value,path=""):
            nonlocal omitted
            if path not in fields:
                if len(fields)>=MAX_FIELDS:omitted+=1;return
                fields[path]={"pointer":path,"name":path.rsplit("/",1)[-1] or "cell","label":None,"type":None,
                    "units":None,"definition":None,"referenceFrame":None,"schema":None,"kinds":[],"present":0,"nulls":0,"samples":[]}
            row=fields[path];row["present"]+=1;kind=_kind(value)
            if kind not in row["kinds"]:row["kinds"].append(kind)
            row["nulls"]+=value is None
            sample=lexical_json(value)
            if len(row["samples"])<3 and len(sample)<=240 and sample not in row["samples"]:row["samples"].append(sample)
            if isinstance(value,dict):
                for key,val in value.items():inspect(val,path+"/"+pointer_token(key))
        for record in capture.records():count=record["ordinal"];inspect(record["cell"])
        for field in fields.values():field["missing"]=count-field["present"]
        m=capture.manifest
        return {"schema":"stellar-forge.edr-inventory.v1","endpoint":capture.endpoint,"collection":capture.collection,
            "collectionId":capture.collection_id,"schemaSha256":capture.schema_id,"schemaIdentityPolicy":SCHEMA_POLICY,
            "conformance":capture.conformance,"queryTypes":capture.query_types,"coverage":m["coverage"],"rowCount":count,
            "coverages":capture.summaries,"sourceIssues":capture.issues,"fields":list(fields.values()),"unlistedPathOccurrences":omitted,
            "files":m["files"],"resources":m["resources"],"selection":m["selection"],"rights":m["rights"],
            "duplicates":{"repeatedOccurrences":0,"conflictingOccurrences":0,"examples":[],
                "policy":"Keep every source parameter cell. Cell identity includes original page/coverage position, parameter, domain indices and exact coordinates; no source observation ID is invented."},
            "valuePolicy":"Original numeric tokens, nulls, units, CRS, calendars, time strings, categories and quality parameters are retained. Regular coordinates use exact declared-axis arithmetic and explicit rationals where necessary. No floating-point interpolation, timezone fallback, rescaling, reprojection, deduplication or hidden value filtering."}

def validate_plan(raw):
    allowed={"schema","endpoint","collectionId","schemaSha256","name","columns","keys","filters","ranges","sorts",
        "defaultLimit","maxLimit","maxRows","maxBytes","maxCellChars","allowEmpty","coveragePolicy"}
    exact(raw,allowed,"EDR mapping",{"schema","endpoint","collectionId","schemaSha256","name","columns"})
    if raw["schema"]!=PLAN_SCHEMA:raise InputError("Expected "+PLAN_SCHEMA)
    if not isinstance(raw["schemaSha256"],str) or not HEX.fullmatch(raw["schemaSha256"]):raise InputError("Mapping must bind the reviewed original CoverageJSON layout")
    cols=raw["columns"]
    if not isinstance(cols,list):raise InputError("Mapping columns must be a list")
    converted=[];extras=[]
    for col in cols:
        exact(col,{"name","source","pointer","type","nullable","encoding"},"column",{"name","source","type","nullable","encoding"})
        kind=col["source"]
        if not isinstance(kind,str) or kind not in {"cell","ordinal","page","coverage","index"}:raise InputError("Unknown original cell selector")
        path=pointer(col.get("pointer",""))
        if kind!="cell" and path!="":raise InputError("Only cell columns have JSON pointers")
        encoding=col["encoding"]
        if not isinstance(encoding,str) or encoding not in {"plain","json","presence-json"}:raise InputError("Choose an explicit original value encoding")
        if encoding!="plain" and (col["type"]!="string" or col["nullable"]is not False):raise InputError("JSON cell encodings require nonnullable native string columns")
        converted.append({"name":col["name"],"path":[],"type":col["type"],"nullable":col["nullable"]})
        extras.append({"source":kind,"pointer":path,"encoding":encoding})
    original={k:v for k,v in raw.items() if k not in {"endpoint","collectionId","schemaSha256","coveragePolicy"}}
    original.update(schema="stellar-forge.xml-mapping.v1",recordPath=["cell"],columns=converted)
    checked=xml_plan(original)
    result={k:v for k,v in checked.items() if k not in {"schema","recordPath","columns"}}
    coverage=raw.get("coveragePolicy","require-exhausted")
    if not isinstance(coverage,str) or coverage not in {"require-exhausted","allow-partial"}:raise InputError("Choose an explicit acquisition coverage policy")
    result.update(schema=PLAN_SCHEMA,endpoint=base_url(raw["endpoint"]),collectionId=text(raw["collectionId"],"Collection ID",2048),
        schemaSha256=raw["schemaSha256"],coveragePolicy=coverage,
        columns=[{"name":c["name"],"type":c["type"],"nullable":c["nullable"],**extra} for c,extra in zip(checked["columns"],extras)])
    return result

def default_plan(shape,name=None):
    columns=[];used=set()
    def add(alias,path,encoding="plain"):
        if alias in used or len(columns)>=64:return
        used.add(alias);columns.append({"name":alias,"source":"cell","pointer":path,"type":"string","nullable":False,"encoding":encoding})
    add("cell_id","/id");add("coverage_id","/coverageId","json");add("parameter","/parameter")
    add("axis_indices","/indices","json");add("coordinates","/coordinates","json");add("coordinate_bounds","/bounds","json")
    add("value","/value","json");add("missing","/missing");add("data_type","/dataType");add("unit","/unit","json")
    for field in shape["fields"]:
        path=field["pointer"]
        if not path.startswith("/coordinates/") or path.count("/")!=2:continue
        alias="axis_"+re.sub(r"[^A-Za-z0-9_]","_",path.rsplit("/",1)[1])[:40]
        base=alias;index=2
        while alias in used:alias=base+"_"+str(index);index+=1
        add(alias,path,"presence-json" if field["missing"] or field["nulls"] else "json")
    title=name or shape["collection"].get("title") or shape["collectionId"]
    return validate_plan({"schema":PLAN_SCHEMA,"endpoint":shape["endpoint"],"collectionId":shape["collectionId"],
        "schemaSha256":shape["schemaSha256"],"name":str(title)[:128],"columns":columns,"keys":["cell_id"],
        "filters":["cell_id","parameter"],"ranges":[],"sorts":["cell_id","parameter"],"defaultLimit":50,"maxLimit":1000,
        "maxRows":MAX_ROWS,"maxBytes":MAX_SOURCE,"maxCellChars":1048576,"allowEmpty":False,"coveragePolicy":"require-exhausted"})

def extract(stream,plan,on_record,cancel=None):
    plan=validate_plan(plan)
    with Capture(stream) as capture:
        # Validate the whole exact source before emitting any derived native row.
        capture.validate()
        if (capture.endpoint,capture.collection_id,capture.schema_id)!=(plan["endpoint"],plan["collectionId"],plan["schemaSha256"]):
            raise InputError("Mapping belongs to another endpoint, collection or CoverageJSON layout")
        if plan["coveragePolicy"]=="require-exhausted" and capture.manifest["coverage"].get("status")!="exhausted":
            raise InputError("Source stopped at its selected page bound; review coverage and explicitly allow-partial")
        count=0
        for record in capture.records():
            if cancel and cancel():raise InputError("Operation cancelled with original source retained")
            count=record["ordinal"]
            if count>plan["maxRows"]:raise InputError("Complete source exceeds mapping maxRows")
            cells=[];values=[]
            for col in plan["columns"]:
                value=resolve(record["cell"],col["pointer"]) if col["source"]=="cell" else Number(str(record[col["source"]]))
                encoding=col["encoding"]
                if encoding=="presence-json":cell=lexical_json({"present":False} if value is _MISSING else {"present":True,"value":value})
                elif encoding=="json":
                    if value is _MISSING:raise InputError("Missing JSON member requires presence-json: "+col["name"])
                    cell=lexical_json(value)
                elif value is _MISSING or value is None:
                    if not col["nullable"]:raise InputError("Missing/null value needs nullable or presence-json: "+col["name"])
                    cell=""
                elif isinstance(value,(dict,list)):raise InputError("Structured coordinate or value requires JSON encoding: "+col["name"])
                else:
                    cell=("true" if value else "false") if isinstance(value,bool) else str(value)
                    if cell=="" and col["nullable"]:raise InputError("Empty string differs from missing/null; select presence-json: "+col["name"])
                if utf16_length(cell)>plan["maxCellChars"]:raise InputError("Original coverage cell exceeds selected maxCellChars")
                cells.append(cell);values.append(typed(cell,col,"Cell "+str(count)+", "+col["name"]))
            on_record(count,cells,values)
        return count

def dataset_spec(plan):return native_spec(plan)

def preview(stream,offset=0,limit=100):
    integer(offset,0,MAX_ROWS,"offset");integer(limit,1,250,"limit")
    rows=[];count=0
    with Capture(stream) as capture:
        for row in capture.records():
            count=row["ordinal"]
            if offset<count<=offset+limit:rows.append(row)
        return {"rows":rows,"offset":offset,"nextOffset":offset+len(rows) if offset+len(rows)<count else None,"rowCount":count,
            "representation":"Original JSON numeric tokens are shown as strings in this preview. Raw original responses and explicit field kinds remain available; regular-axis nonterminating coordinates are exact rational objects."}

def write_capture(manifest,files,destination):
    """Deterministic, bounded source carrier. Caller retains original HTTP documents."""
    if set(files)!=set(manifest.get("files",{})):raise InputError("Capture files differ from the complete manifest")
    with zipfile.ZipFile(destination,"w",compression=zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
        for name in sorted({"manifest.json",*files}):
            info=zipfile.ZipInfo(name,(2000,1,1,0,0,0));info.create_system=3;info.external_attr=0o100600<<16
            info.compress_type=zipfile.ZIP_DEFLATED
            value=jbytes(manifest) if name=="manifest.json" else files[name]
            with archive.open(info,"w") as out:
                if isinstance(value,(bytes,bytearray)):out.write(value)
                else:
                    with Path(value).open("rb") as stream:
                        while block:=stream.read(65536):out.write(block)
