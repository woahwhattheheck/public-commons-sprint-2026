"""Convert the original ETIM International ETIM10 example into supplier input.
This source adapter reads only the declared original XML and exposes every
unmapped source field in a separate mapping report. It never invents supplier
classification definitions, asset contents, or current commerce dates.
"""
import copy, collections, hashlib, json, pathlib, sys, xml.etree.ElementTree as ET
NS="{https://www.etim-international.com/bmecat/50}"
EXPECTED="50568f0357c982a853eaf523475d18d6f2a594d0c8a392143a4df50007cddf8e"
SOURCE_URL="https://www.etim-international.com/wp-content/uploads/2021/09/ETIM-BMEcat-Guideline-V5-0-2-2024-12-12.zip"
SOURCE_MEMBER="SampleFile_bmecat_etim_V5_T_NEW_CATALOG_ETIM10.xml"
def convert(xml_bytes,template):
 if hashlib.sha256(xml_bytes).hexdigest()!=EXPECTED:
  raise ValueError("This adapter requires the exact published ETIM10 source")
 if b"<!DOCTYPE" in xml_bytes.upper() or b"<!ENTITY" in xml_bytes.upper():
  raise ValueError("Document declarations are outside this published sample")
 root=ET.fromstring(xml_bytes)
 if root.tag!=NS+"BMECAT":raise ValueError("Original namespace changed")
 paths={};all_fields=[];mapped=[];used=set();notes=[]
 def local(x):return x.rsplit("}",1)[-1]
 def index(n,path):
  paths[id(n)]=path
  if not list(n):all_fields.append({"sourcePath":path+"/text()","value":n.text or ""})
  for k,v in n.attrib.items():all_fields.append({"sourcePath":path+"/@"+local(k),"value":v})
  counts=collections.Counter()
  for c in n:
   name=local(c.tag);counts[name]+=1;index(c,path+"/"+name+"["+str(counts[name])+"]")
 index(root,"/BMECAT")
 def child(n,name):return None if n is None else n.find(NS+name)
 def children(n,name):return [] if n is None else list(n.findall(NS+name))
 def follow(n,*parts):
  for part in parts:n=child(n,part)
  return n
 def val(n,target,transform=None):
  if n is None:return ""
  p=paths[id(n)]+"/text()";v=n.text or "";used.add(p)
  mapped.append({"sourcePath":p,"targetPath":target,"sourceValue":v,**({"transformation":transform} if transform else {})})
  return v
 def attr(n,key,target):
  if n is None or key not in n.attrib:return ""
  p=paths[id(n)]+"/@"+local(key);used.add(p)
  mapped.append({"sourcePath":p,"targetPath":target,"sourceValue":n.attrib[key]})
  return n.attrib[key]
 def lang(n,target):
  explicit=attr(n,"lang",target) if n is not None else ""
  language=explicit or default
  notes.append({"sourcePath":paths[id(n)] if n is not None else None,"targetPath":target,
    "language":language,"languageOrigin":"explicit @lang" if explicit else "CATALOG/LANGUAGE[@default='true']"})
  return language
 def multilingual(nodes,target):
  result={}
  for n in nodes:
   code=lang(n,target+"/{language}")
   if code in result:raise ValueError("Repeated source language needs an additional target slot: "+target)
   result[code]=val(n,target+"/"+code)
  return result
 def boolean(n,target):
  raw=val(n,target,"XML boolean lexical value to JSON boolean")
  if raw in ("true","1"):return True
  if raw in ("false","0"):return False
  if raw=="":return None
  raise ValueError("Invalid original boolean")
 h=child(root,"HEADER");c=child(h,"CATALOG")
 ls=children(c,"LANGUAGE")
 defaults=[n for n in ls if n.get("default") in ("true","1")]
 if len(defaults)!=1:raise ValueError("Explicit original default language required")
 default=val(defaults[0],"/profile/defaultLanguage")
 attr(defaults[0],"default","/profile/defaultLanguage")
 languages=[val(n,"/profile/languages/"+str(i)) for i,n in enumerate(ls)]
 profile={"schema":"stellar-forge.supplier-profile.v1","id":"etim-published-etim10-original-2024-12-12",
  "targets":["bmecat-5.0"],"languages":languages,"defaultLanguage":default,
  "countries":[val(n,"/profile/countries/"+str(i)) for i,n in enumerate(children(c,"TERRITORY"))],
  "etim":{"version":"","classes":[],"source":SOURCE_URL+"#"+SOURCE_MEMBER},
  "envelope":{"transaction":"T_NEW_CATALOG",
   "catalogId":val(child(c,"CATALOG_ID"),"/profile/envelope/catalogId"),
   "catalogVersion":val(child(c,"CATALOG_VERSION"),"/profile/envelope/catalogVersion"),
   "catalogName":multilingual(children(c,"CATALOG_NAME"),"/profile/envelope/catalogName"),
   "generationDate":"","buyer":{},"supplier":{},
   "currency":val(child(c,"CURRENCY"),"/profile/envelope/currency"),
   "mimeRoot":multilingual(children(c,"MIME_ROOT"),"/profile/envelope/mimeRoot"),
   "previousVersion":None,"receiverAccepted":False,"subsetAgreed":False},
  "conversions":{"allowExactUnitConversion":False,"allowNetOrderBasisConversion":False},"localRules":[]}
 env=profile["envelope"]
 for n in children(c,"DATETIME"):
  if n.get("type")=="generation_date":
   attr(n,"type","/profile/envelope/generationDate")
   env["generationDate"]=val(child(n,"DATE"),"/profile/envelope/generationDate")
 for name,key in (("BUYER","buyer"),("SUPPLIER","supplier")):
  n=child(h,name);target="/profile/envelope/"+key
  party={"name":val(child(n,name+"_NAME"),target+"/name"),"ids":[]}
  for i,z in enumerate(children(n,name+"_ID")):
   party["ids"].append({"type":attr(z,"type",target+"/ids/"+str(i)+"/type"),
      "value":val(z,target+"/ids/"+str(i)+"/value")})
  if name=="SUPPLIER" and child(n,"ADDRESS") is not None:
   address=child(n,"ADDRESS")
   party["address"]={key2:val(child(address,xml),target+"/address/"+key2)
    for xml,key2 in (("CONTACT","contact"),("STREET","street"),("ZIP","zip"),("CITY","city"),
     ("COUNTRY","country"),("VAT_ID","vatId"),("EMAIL","email"),("URL","url"))}
   attr(address,"type",target+"/address (supplier address context)")
  env[key]=party
 version=val(follow(h,"USER_DEFINED_EXTENSIONS","UDX.EDXF.VERSION"),"/profile/targets/0 (EDXF version)")
 if version!="5.0" or root.get("version")!="2005":raise ValueError("Original version changed")
 attr(root,"version","/profile/targets/0 (BMEcat version)")
 attr(root,"{http://www.w3.org/2001/XMLSchema-instance}schemaLocation","/mappingReport/source/schemaLocation")
 records=[];feature_systems=[]
 for pi,n in enumerate(children(child(root,"T_NEW_CATALOG"),"PRODUCT")):
  base="/records/"+str(pi)+"/supplier"
  p=copy.deepcopy(template["product"])
  p.pop("segment",None);p.pop("category",None);p.pop("applicability",None)
  p["descriptions"]={}
  d=child(n,"PRODUCT_DETAILS");u=child(n,"USER_DEFINED_EXTENSIONS")
  for xml,key in (("SUPPLIER_PID","supplierProductId"),):p[key]=val(child(n,xml),base+"/"+key)
  for xml,key in (("MANUFACTURER_PID","manufacturerProductId"),("MANUFACTURER_NAME","manufacturerName"),
    ("MANUFACTURER_TYPE_DESCR","manufacturerTypeDescription"),("SUPPLIER_ALT_PID","alternativeSupplierId")):
   p[key]=val(child(d,xml),base+"/"+key)
  gtins=[z for z in children(d,"INTERNATIONAL_PID") if z.get("type")=="gtin"]
  if len(gtins)>1:raise ValueError("Multiple original GTINs exceed productGtin slot")
  if gtins:
   p["productGtin"]=val(gtins[0],base+"/productGtin")
   attr(gtins[0],"type",base+"/productGtin (GTIN identifier context)")
  for parent,xml,key in ((d,"DESCRIPTION_SHORT","short"),(d,"DESCRIPTION_LONG","long"),
    (u,"UDX.EDXF.DESCRIPTION_VERY_SHORT","veryShort")):
   for z in children(parent,xml):
    code=lang(z,base+"/descriptions/{language}")
    desc=p["descriptions"].setdefault(code,{"veryShort":"","short":"","long":"","titleProposal":""})
    if desc[key]:raise ValueError("Repeated original description for one target language")
    desc[key]=val(z,base+"/descriptions/"+code+"/"+key)
  p["brand"]=val(child(u,"UDX.EDXF.BRAND_NAME"),base+"/brand")
  for xml,key in (("UDX.EDXF.PRODUCT_SERIES","series"),("UDX.EDXF.PRODUCT_VARIATION","types")):
   p[key]=[{"language":lang(z,base+"/"+key+"/"+str(i)+"/language"),"value":val(z,base+"/"+key+"/"+str(i)+"/value")}
    for i,z in enumerate(children(u,xml))]
  p["expiresAt"]=val(child(u,"UDX.EDXF.EXPIRATION_DATE"),base+"/expiresAt")
  for outer,inner,key in (("UDX.EDXF.COUNTRY_BRANCH_NUMBERS","UDX.EDXF.COUNTRY_BRANCH_NUMBER","branchNumbers"),
    ("UDX.EDXF.COUNTRY_BRANCH_SUPPLIER_IDS","UDX.EDXF.COUNTRY_BRANCH_SUPPLIER_ID","branchSupplierIds")):
   p[key]=[{"country":attr(z,"country",base+"/"+key+"/"+str(i)+"/country"),
    "type":attr(z,"type",base+"/"+key+"/"+str(i)+"/type"),
    "value":val(z,base+"/"+key+"/"+str(i)+"/value")}
    for i,z in enumerate(children(child(u,outer),inner))]
  for fs in children(n,"PRODUCT_FEATURES"):
   system=child(fs,"REFERENCE_FEATURE_SYSTEM_NAME")
   if not (system is not None and (system.text or "").startswith("ETIM-")):continue
   if feature_systems and p["classification"]["etim"]["version"]:raise ValueError("Multiple ETIM blocks require additional target slots")
   version=val(system,base+"/classification/etim/version");feature_systems.append(version)
   features=[]
   for fi,f in enumerate(children(fs,"FEATURE")):
    fb=base+"/classification/etim/features/"+str(fi)
    codes=children(f,"FNAME")
    if len(codes)!=1:raise ValueError("Repeated feature names require an additional target slot")
    feature={"code":val(codes[0],fb+"/code"),"values":[val(z,fb+"/values/"+str(i)) for i,z in enumerate(children(f,"FVALUE"))],
     "details":"","unit":val(child(f,"FUNIT"),fb+"/unit")}
    details=children(f,"FVALUE_DETAILS")
    if len(details)==1:feature["details"]=val(details[0],fb+"/details")
    elif details:feature["details"]=multilingual(details,fb+"/details")
    features.append(feature)
   p["classification"]["etim"]={"version":version,
    "classId":val(child(fs,"REFERENCE_FEATURE_GROUP_ID"),base+"/classification/etim/classId"),"features":features}
  p["customsTariff"]=val(follow(n,"PRODUCT_LOGISTIC_DETAILS","CUSTOMS_TARIFF_NUMBER","CUSTOMS_NUMBER"),base+"/customsTariff")
  for key,xml in (("supplier","UDX.EDXF.DISCOUNT_GROUP_SUPPLIER"),("manufacturer","UDX.EDXF.DISCOUNT_GROUP_MANUFACTURER")):
   p["discountGroup"][key]=val(follow(u,"UDX.EDXF.DISCOUNT_GROUP",xml),base+"/discountGroup/"+key)
  order=child(n,"PRODUCT_ORDER_DETAILS")
  p["order"]={key:val(child(order,xml),base+"/order/"+key) for xml,key in (
   ("ORDER_UNIT","unit"),("CONTENT_UNIT","contentUnit"),("NO_CU_PER_OU","contentUnitsPerOrderUnit"),
   ("PRICE_QUANTITY","priceQuantity"),("QUANTITY_MIN","minimum"),("QUANTITY_INTERVAL","interval"))}
  p["prices"]=[]
  for pd in children(n,"PRODUCT_PRICE_DETAILS"):
   dates={}
   for dt in children(pd,"DATETIME"):
    key={"valid_start_date":"validFrom","valid_end_date":"validTo"}.get(dt.get("type"))
    if key:dates[key]=(dt,child(dt,"DATE"))
   for z in children(pd,"PRODUCT_PRICE"):
    qb=base+"/prices/"+str(len(p["prices"]))
    price={"type":attr(z,"price_type",qb+"/type")}
    for xml,key in (("PRICE_AMOUNT","amount"),("PRICE_CURRENCY","currency"),("TAX","tax"),
      ("PRICE_FACTOR","priceFactor"),("LOWER_BOUND","lowerBound")):price[key]=val(child(z,xml),qb+"/"+key)
    price["territories"]=[val(v,qb+"/territories/"+str(i)) for i,v in enumerate(children(z,"TERRITORY"))]
    for key in ("validFrom","validTo"):
     pair=dates.get(key);price[key]=val(pair[1],qb+"/"+key) if pair else ""
     if pair:attr(pair[0],"type",qb+"/"+key)
    if child(pd,"DAILY_PRICE") is not None:price["dailyPrice"]=boolean(child(pd,"DAILY_PRICE"),qb+"/dailyPrice")
    if child(pd,"PRICE_BASE") is not None:
     price["priceBase"]={"unit":val(follow(pd,"PRICE_BASE","PRICE_UNIT"),qb+"/priceBase/unit"),
      "factor":val(follow(pd,"PRICE_BASE","PRICE_UNIT_FACTOR"),qb+"/priceBase/factor")}
    p["prices"].append(price)
  net=child(u,"UDX.EDXF.PRODUCT_LOGISTIC_DETAILS");p["net"]["basis"]="order_unit"
  for key,xml,unit in (("volume","NETVOLUME","MTQ"),("weight","NETWEIGHT","KGM"),("length","NETLENGTH","MTR"),
    ("width","NETWIDTH","MTR"),("depth","NETDEPTH","MTR"),("diameter","NETDIAMETER","MTR")):
   z=child(net,"UDX.EDXF."+xml)
   p["net"][key]={"value":val(z,base+"/net/"+key+"/value"),"unit":unit if z is not None else ""}
  p["packaging"]=[]
  for i,z in enumerate(children(child(u,"UDX.EDXF.PACKING_UNITS"),"UDX.EDXF.PACKING_UNIT")):
   qb=base+"/packaging/"+str(i)
   package={"supplierProductId":"","gtin":val(child(z,"UDX.EDXF.GTIN"),qb+"/gtin"),
    "code":val(child(z,"UDX.EDXF.PACKING_UNIT_CODE"),qb+"/code"),
    "name":multilingual(children(z,"UDX.EDXF.PACKING_UNIT_NAME"),qb+"/name"),
    "min":val(child(z,"UDX.EDXF.QUANTITY_MIN"),qb+"/min"),"max":val(child(z,"UDX.EDXF.QUANTITY_MAX"),qb+"/max"),
    "parts":val(child(z,"UDX.EDXF.PACKING_PARTS"),qb+"/parts")}
   if child(z,"UDX.EDXF.PACKAGE_BREAK") is not None:package["breakable"]=boolean(child(z,"UDX.EDXF.PACKAGE_BREAK"),qb+"/breakable")
   for key,unit in (("volume","MTQ"),("weight","KGM"),("length","MTR"),("width","MTR"),("depth","MTR"),("diameter","MTR")):
    measure=child(z,"UDX.EDXF."+key.upper())
    package[key]={"value":val(measure,qb+"/"+key+"/value"),"unit":unit if measure is not None else ""}
   p["packaging"].append(package)
  delivery=child(d,"DELIVERY_TIME")
  p["deliveryTime"]={"value":val(delivery,base+"/deliveryTime/value"),"basis":"working_days" if delivery is not None else ""}
  for key,xml in (("businessMonths","UDX.EDXF.WARRANTY_BUSINESS"),("consumerMonths","UDX.EDXF.WARRANTY_CONSUMER")):
   p["warranty"][key]=val(follow(u,"UDX.EDXF.WARRANTY",xml),base+"/warranty/"+key)
  p["assets"]=[]
  for i,z in enumerate(children(child(u,"UDX.EDXF.MIME_INFO"),"UDX.EDXF.MIME")):
   qb=base+"/assets/"+str(i);asset=copy.deepcopy(template["asset"])
   for xml,key in (("MIME_SOURCE","source"),("MIME_CODE","code"),("MIME_FILENAME","filename"),
    ("MIME_DESIGNATION","designation"),("MIME_ALT","alt"),("MIME_ISSUE_DATE","issuedAt"),
    ("MIME_EXPIRY_DATE","expiresAt"),("MIME_ORDER","order")):
    asset[key]=val(child(z,"UDX.EDXF."+xml),qb+"/"+key)
   asset["language"]=lang(child(z,"UDX.EDXF.MIME_SOURCE"),qb+"/language")
   p["assets"].append(asset)
  p["relations"]=[]
  for i,z in enumerate(children(n,"PRODUCT_REFERENCE")):
   qb=base+"/relations/"+str(i)
   relation={"type":attr(z,"type",qb+"/type"),"quantity":attr(z,"quantity",qb+"/quantity")}
   for xml,key in (("PROD_ID_TO","targetSupplierProductId"),("CATALOG_ID","catalogId"),("CATALOG_VERSION","catalogVersion")):
    relation[key]=val(child(z,xml),qb+"/"+key)
   descriptions=children(z,"REFERENCE_DESCR")
   relation["description"]=multilingual(descriptions,qb+"/description") if descriptions else ""
   p["relations"].append(relation)
  records.append({"materialId":p["supplierProductId"],"supplier":p})
 systems=sorted(set(feature_systems))
 if len(systems)==1:profile["etim"]["version"]=systems[0]
 unmapped=[f for f in all_fields if f["sourcePath"] not in used]
 report={"schema":"stellar-forge.published-supplier-mapping.v1",
  "source":{"archiveUrl":SOURCE_URL,"member":SOURCE_MEMBER,"bytes":len(xml_bytes),"sha256":EXPECTED,
   "carrierGitBlob":"936df68a18b9cd262bbe7d6288762adbc1ea4093","originalSchemaMember":"bmecat_etim_501.xsd",
   "schemaSha256":"821e4dbcec9fa32b64df4298531adc5d3cdab68507686317dd08e8266378b005"},
  "targetTemplateGitBlob":"a02433856bed4e7245fa04604c2538bac2bab955",
  "scope":{"products":len(records),"materialIds":[r["materialId"] for r in records],
   "sourceFields":len(all_fields),"mappedUniqueSourceFields":len(used),"unmappedSourceFields":len(unmapped)},
  "fieldMappings":mapped,"languageInheritance":notes,"unmappedSourceFields":unmapped,
  "semanticMappings":[
   {"target":"supplier.net.basis","value":"order_unit","sourceRule":"ETIM BMEcat5.0 UDX.EDXF.PRODUCT_LOGISTIC_DETAILS measurements are based on one ORDER_UNIT."},
   {"target":"supplier.net/packaging measure units","value":{"length":"MTR","width":"MTR","depth":"MTR","diameter":"MTR","weight":"KGM","volume":"MTQ"},"sourceRule":"Original ETIM fixed SI measurement units; source numbers are unchanged."},
   {"target":"supplier.deliveryTime.basis","value":"working_days","sourceRule":"ETIM5.0 PRODUCT_DETAILS/DELIVERY_TIME uses working days."}],
  "retainedDifferences":[
   "The original publisher sample is an explicitly dated example, with generation2021-06-22 and original2022 expiry/price dates.",
   "Feature kind/class metadata is absent from this XML; feature code/value(s)/details/unit are preserved without invented types.",
   "Original implicit default-language fields are recorded separately from explicit lang attributes; the exporter may emit explicit original language.",
   "Unsupported source nodes stay in this mapping report and the exact original XML; they are not reclassified into unrelated supplier fields.",
   "Sonepar-only category,segment,title proposal,asset quality metrics and packaging supplier IDs remain empty or omitted.",
   "Original relative MIME_SOURCE and stem-only MIME_FILENAME values remain separate; referenced image bodies are not present in the publisher XML."
  ]}
 return {"profile":profile,"records":records,"mappingReport":report}
def main():
 if len(sys.argv)!=4:raise SystemExit("usage: etim10-to-supplier.py ORIGINAL_XML TEMPLATE_JSON OUTPUT_DIRECTORY")
 xml_path,template_path,out=map(pathlib.Path,sys.argv[1:])
 result=convert(xml_path.read_bytes(),json.loads(template_path.read_text()))
 out.mkdir(parents=True,exist_ok=True)
 payloads={"etim10-supplier-profile.json":json.dumps(result["profile"],ensure_ascii=False,indent=2)+"\n",
  "etim10-supplier-products.jsonl":"".join(json.dumps(row,ensure_ascii=False,separators=(",",":"))+"\n" for row in result["records"]),
  "etim10-source-mapping.json":json.dumps(result["mappingReport"],ensure_ascii=False,indent=2)+"\n"}
 outputs=[]
 for name,text in payloads.items():
  data=text.encode("utf-8");path=out/name
  if path.exists() and path.read_bytes()!=data:raise ValueError("Existing output differs: "+str(path))
  if not path.exists():path.write_bytes(data)
  outputs.append({"path":str(path),"bytes":len(data),"sha256":hashlib.sha256(data).hexdigest()})
 print(json.dumps({"sourceSha256":EXPECTED,"scope":result["mappingReport"]["scope"],"outputs":outputs}))
if __name__=="__main__":main()
