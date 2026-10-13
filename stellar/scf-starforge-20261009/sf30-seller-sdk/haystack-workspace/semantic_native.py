#!/usr/bin/env python3
"""Offline CSV and Brick 1.4.4 operations using the selected original engines."""
from __future__ import annotations
import argparse, base64, binascii, contextlib, csv, hashlib, importlib.metadata, io, json, os, re, signal, sys, tempfile
from pathlib import Path

SCHEMA="commons.haystack.semantic-native-result.v1"
ROOT=Path(__file__).resolve().parent
MAX_REQUEST_BYTES=64*1024*1024
MAX_SOURCE_BYTES=32*1024*1024
MAX_DATA_ROWS=25000
MAX_COLUMNS=256
ONTOLOGY_BYTES=1749633
ONTOLOGY_SHA256="b65720b7b9b64c646745c689777e6138c0d59ce0088df0aeb78fbd444d04d8e7"
LICENSE_BYTES=1534
LICENSE_SHA256="3f4d165cc1c2b234d4bca6462971cb318ef525961cc688b3280a96b2fde932af"
DEPENDENCIES={"brickschema":"0.8.0","rdflib":"7.6.0","pyshacl":"0.40.1"}
BRICK_IRI="https://brickschema.org/schema/Brick#"
TAG_IRI="https://brickschema.org/schema/BrickTag#"
REC_IRI="https://w3id.org/rec#"
QUDT_IRI="http://qudt.org/schema/qudt/"
UNIT_IRI="http://qudt.org/vocab/unit/"
PROVENANCE_IRI="urn:commons:haystack:semantic:"
SHACL_IRI="http://www.w3.org/ns/shacl#"
HEX64=re.compile(r"^[0-9a-f]{64}$")
IRI_SCHEME=re.compile(r"^[A-Za-z][A-Za-z0-9+.-]*:")
INVALID_IRI=re.compile(r'[\x00-\x20<>"{}|^\x60\\\x7f]')
LANGUAGE=re.compile(r"^[A-Za-z]+(?:-[A-Za-z0-9]+)*$")

class SemanticError(Exception):
    def __init__(self,code,message,details=None):
        super().__init__(message);self.code=code;self.details=details

def fail(code,message,details=None):
    raise SemanticError(code,message,details)

def canonical_bytes(value):
    return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(",",":"),allow_nan=False).encode("utf-8")

def sha256(data):
    return hashlib.sha256(data).hexdigest()

def object_value(value,field):
    if not isinstance(value,dict):fail("INVALID_FIELD",field+" must be a JSON object",{"field":field})
    return value

def string_value(value,field,empty=False):
    if not isinstance(value,str) or (not empty and not value):fail("INVALID_FIELD",field+" must be a "+("string" if empty else "nonempty string"),{"field":field})
    try:value.encode("utf-8")
    except UnicodeEncodeError:fail("INVALID_UNICODE",field+" contains an unpaired Unicode surrogate",{"field":field})
    return value

def array_value(value,field):
    if not isinstance(value,list):fail("INVALID_FIELD",field+" must be an array",{"field":field})
    return value

def integer_value(value,field,minimum=0):
    if not isinstance(value,int) or isinstance(value,bool) or value<minimum:fail("INVALID_FIELD",field+" must be an integer of at least "+str(minimum),{"field":field})
    return value

def digest_value(value,field):
    value=string_value(value,field)
    if not HEX64.fullmatch(value):fail("INVALID_DIGEST",field+" must be a lowercase SHA-256 digest",{"field":field})
    return value

def iri_value(value,field):
    value=string_value(value,field)
    if not IRI_SCHEME.match(value) or INVALID_IRI.search(value):fail("INVALID_IRI",field+" must be an absolute RDF IRI",{"field":field,"value":value})
    return value

def model_term(value,field):
    value=iri_value(value,field)
    if value.startswith(SHACL_IRI):
        fail("MODEL_CONTROL_TERM","A building model cannot define executable SHACL shapes; the retained ontology is the only shape source",{"field":field,"iri":value})
    return value

def strict_json(data):
    def pairs(rows):
        result={}
        for key,value in rows:
            if key in result:fail("DUPLICATE_JSON_KEY","The input repeats a JSON object key",{"key":key})
            result[key]=value
        return result
    def constant(value):fail("INVALID_JSON_NUMBER","The input contains a non-finite JSON number",{"value":value})
    try:return json.loads(data.decode("utf-8-sig"),object_pairs_hook=pairs,parse_constant=constant)
    except SemanticError:raise
    except (UnicodeDecodeError,json.JSONDecodeError) as error:fail("INVALID_JSON","The complete request must be valid UTF-8 JSON",{"message":str(error)})

def output_file(name,media_type,data):
    return {"name":name,"mediaType":media_type,"bytes":len(data),"sha256":sha256(data),"base64":base64.b64encode(data).decode("ascii")}

def regular_bytes(path,bound):
    if path.is_symlink() or not path.is_file():fail("SOURCE_FILE_MISSING","A selected native source file is unavailable or linked",{"path":path.name})
    with path.open("rb") as stream:
        before=os.fstat(stream.fileno());data=stream.read(bound+1);after=os.fstat(stream.fileno())
    if len(data)>bound:fail("SOURCE_FILE_BOUND","A selected source exceeds its bound",{"path":path.name,"bound":bound})
    if (before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns,before.st_ctime_ns)!=(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns):
        fail("SOURCE_FILE_CHANGED","A selected native source changed while being read",{"path":path.name})
    return data

def standard_source():
    metadata_bytes=regular_bytes(ROOT/"semantic-standard.json",1024*1024)
    metadata=object_value(strict_json(metadata_bytes),"standard")
    ontology=regular_bytes(ROOT/"semantic-brick.ttl",ONTOLOGY_BYTES)
    license_body=regular_bytes(ROOT/"semantic-brick-LICENSE.txt",LICENSE_BYTES)
    if len(ontology)!=ONTOLOGY_BYTES or sha256(ontology)!=ONTOLOGY_SHA256:fail("ONTOLOGY_MISMATCH","The selected original Brick 1.4.4 ontology bytes differ")
    if len(license_body)!=LICENSE_BYTES or sha256(license_body)!=LICENSE_SHA256:fail("LICENSE_MISMATCH","The original Brick licence bytes differ")
    if metadata.get("id")!="brick" or metadata.get("version")!="1.4.4":fail("STANDARD_MISMATCH","The native standard metadata must select Brick 1.4.4")
    declared=object_value(metadata.get("ontology"),"standard.ontology")
    declared_license=object_value(metadata.get("license"),"standard.license")
    if declared.get("bytes")!=ONTOLOGY_BYTES or declared.get("sha256")!=ONTOLOGY_SHA256:fail("STANDARD_MISMATCH","The standard metadata does not bind the selected ontology")
    if declared_license.get("bytes")!=LICENSE_BYTES or declared_license.get("sha256")!=LICENSE_SHA256:fail("STANDARD_MISMATCH","The standard metadata does not bind the original licence")
    return {"id":"brick","version":"1.4.4","ontologySha256":ONTOLOGY_SHA256,"bytes":ONTOLOGY_BYTES,
            "sourceUrl":declared.get("sourceUrl"),"licenseSha256":LICENSE_SHA256,"licenseBytes":LICENSE_BYTES,
            "metadataSha256":sha256(metadata_bytes)},ontology

def runtime_metadata(standard,required):
    versions={};unavailable=[]
    for name,expected in DEPENDENCIES.items():
        try:versions[name]=importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:versions[name]=None
        if versions[name]!=expected:unavailable.append({"name":name,"expected":expected,"actual":versions[name]})
    if required and unavailable:fail("DEPENDENCY_MISMATCH","Install the selected offline semantic dependency closure with the native interpreter",{"packages":unavailable,"requirements":"requirements-semantic.txt","networkRequiredAtRuntime":False})
    if required and not ((3,11)<=sys.version_info[:2]<(4,0)):fail("PYTHON_VERSION","The selected brickschema release requires Python >=3.11 and <4",{"actual":sys.version.split()[0]})
    return {"python":sys.version.split()[0],**versions,"standard":standard,"dependencyStatus":"ready" if not unavailable else "unavailable",
            "network":"disabled","csv":"Python standard-library csv.reader"}

def inspect_file(request,runtime):
    selected=object_value(request.get("file"),"file")
    name=string_value(selected.get("name"),"file.name")
    format_name=selected.get("format")
    if format_name not in ("csv","tsv"):fail("UNSUPPORTED_FORMAT","inspect accepts the original csv or tsv format",{"format":format_name})
    declared_bytes=integer_value(selected.get("bytes"),"file.bytes")
    if declared_bytes>MAX_SOURCE_BYTES:fail("FILE_TOO_LARGE","The source exceeds the complete 32 MiB inspection bound",{"bytes":declared_bytes,"limit":MAX_SOURCE_BYTES})
    declared_sha=digest_value(selected.get("sha256"),"file.sha256")
    encoded=string_value(selected.get("base64"),"file.base64",True)
    if len(encoded)>((MAX_SOURCE_BYTES+2)//3)*4:fail("FILE_TOO_LARGE","The encoded source exceeds the complete inspection bound")
    try:body=base64.b64decode(encoded,validate=True)
    except (binascii.Error,ValueError):fail("INVALID_BASE64","file.base64 must contain the complete original source bytes")
    if len(body)!=declared_bytes or sha256(body)!=declared_sha:fail("FILE_BINDING_MISMATCH","The original file size or SHA-256 differs",{"actualBytes":len(body),"actualSha256":sha256(body)})
    encoding="utf-8-sig" if body.startswith(b"\xef\xbb\xbf") else "utf-8"
    try:decoded=body.decode(encoding)
    except UnicodeDecodeError as error:fail("UNSUPPORTED_ENCODING","The complete source must be UTF-8 with an optional UTF-8 BOM",{"byteStart":error.start,"byteEnd":error.end,"reason":error.reason})
    delimiter=request.get("delimiter","\t" if format_name=="tsv" else ",")
    if delimiter not in (",","\t",";"):fail("UNSUPPORTED_DELIMITER","Select comma, tab or semicolon explicitly")
    columns=[];rows=[];row_end_lines=[];diagnostics=[];header_end_line=0
    previous_limit=csv.field_size_limit();reader=None
    try:
        csv.field_size_limit(MAX_SOURCE_BYTES)
        reader=csv.reader(io.StringIO(decoded,newline=""),delimiter=delimiter,quotechar='"',doublequote=True,skipinitialspace=False,strict=True)
        try:columns=next(reader);header_end_line=reader.line_num
        except StopIteration:diagnostics.append({"code":"EMPTY_FILE","message":"The original file contains no header row."})
        if len(columns)>MAX_COLUMNS:fail("COLUMN_LIMIT","The header exceeds the complete 256-column bound",{"columns":len(columns),"limit":MAX_COLUMNS})
        seen={}
        for index,value in enumerate(columns):
            if not value.strip():diagnostics.append({"code":"BLANK_HEADER","message":"This original column has a blank heading.","columnIndex":index})
            if value in seen:diagnostics.append({"code":"DUPLICATE_HEADER","message":"This heading repeats an earlier original heading.","columnIndex":index,"firstColumnIndex":seen[value]})
            else:seen[value]=index
        for row in reader:
            index=len(rows)
            if index>=MAX_DATA_ROWS:fail("ROW_LIMIT","The source exceeds the complete 25,000-data-row bound",{"rowIndex":index,"physicalEndLine":reader.line_num,"limit":MAX_DATA_ROWS})
            if len(row)>MAX_COLUMNS:fail("COLUMN_LIMIT","An original row exceeds the complete 256-column bound",{"rowIndex":index,"physicalEndLine":reader.line_num,"columns":len(row),"limit":MAX_COLUMNS})
            rows.append(row);row_end_lines.append(reader.line_num)
            if len(row)!=len(columns):diagnostics.append({"code":"ROW_WIDTH_MISMATCH","message":"This original row has a different cell count from the header.","rowIndex":index,"columns":len(row),"headerColumns":len(columns)})
    except csv.Error as error:fail("CSV_PARSE_ERROR","Python csv.reader could not parse the complete source",{"message":str(error),"physicalEndLine":reader.line_num if reader else None,"completeRowsRead":len(rows)})
    finally:csv.field_size_limit(previous_limit)
    return {"schema":SCHEMA,"ok":True,"action":"inspect","file":{"name":name,"format":format_name,"bytes":len(body),"sha256":declared_sha},
            "columns":columns,"rows":rows,"rowEndLines":row_end_lines,"headerEndLine":header_end_line,"rowIndexBase":0,"physicalLineBase":1,
            "diagnostics":diagnostics,"encoding":encoding,"delimiter":delimiter,"runtime":runtime}

def rdf_modules():
    try:
        import rdflib
        from brickschema import Graph
        import pyshacl
    except ImportError as error:fail("DEPENDENCY_IMPORT","The selected offline semantic engine could not be imported",{"message":str(error)})
    return rdflib,Graph,pyshacl

def ontology_graph(body):
    rdflib,_,_=rdf_modules()
    graph=rdflib.Graph().parse(data=body.decode("utf-8"),format="turtle")
    declarations=list(graph.objects(None,rdflib.OWL.versionInfo))+list(graph.objects(None,rdflib.OWL.versionIRI))
    if not any(str(value)=="1.4.4" or "/1.4.4/" in str(value) for value in declarations):fail("ONTOLOGY_VERSION","The parsed original ontology does not declare Brick 1.4.4")
    return graph

def term_value(term):
    if term is None:return None
    import rdflib
    if isinstance(term,rdflib.URIRef):return {"termType":"NamedNode","value":str(term)}
    if isinstance(term,rdflib.BNode):return {"termType":"BlankNode","value":str(term)}
    if isinstance(term,rdflib.Literal):return {"termType":"Literal","value":str(term),"language":term.language,"datatype":str(term.datatype) if term.datatype else None}
    return {"termType":type(term).__name__,"value":str(term)}

def catalogue_rows(graph):
    import rdflib
    RDF,RDFS,OWL=rdflib.RDF,rdflib.RDFS,rdflib.OWL
    SKOS=rdflib.Namespace("http://www.w3.org/2004/02/skos/core#");BRICK=rdflib.Namespace(BRICK_IRI);QUDT=rdflib.Namespace(QUDT_IRI)
    named=lambda values:{value for value in values if isinstance(value,rdflib.URIRef)}
    classes=named(graph.subjects(RDF.type,OWL.Class))|named(graph.subjects(RDF.type,RDFS.Class))|named(graph.subjects(RDFS.subClassOf,None))
    property_types=(RDF.Property,OWL.ObjectProperty,OWL.DatatypeProperty,OWL.AnnotationProperty,OWL.FunctionalProperty,OWL.InverseFunctionalProperty,OWL.TransitiveProperty,OWL.SymmetricProperty)
    properties=set()
    for property_type in property_types:properties|=named(graph.subjects(RDF.type,property_type))
    properties|=named(graph.subjects(RDFS.subPropertyOf,None))
    tags=named(graph.subjects(RDF.type,BRICK.Tag));units=named(graph.subjects(RDF.type,QUDT.Unit))
    for subject,predicate,value in graph:
        for term in (subject,value):
            if isinstance(term,rdflib.URIRef):
                if str(term).startswith(TAG_IRI) and str(term)!=TAG_IRI:tags.add(term)
                if str(term).startswith(UNIT_IRI) and str(term)!=UNIT_IRI:units.add(term)
        if predicate in (BRICK.hasUnit,QUDT.unit) and isinstance(value,rdflib.URIRef):units.add(value)
    def literals(subject,predicates):
        values={value for predicate in predicates for value in graph.objects(subject,predicate) if isinstance(value,rdflib.Literal)}
        return sorted(values,key=lambda value:(0 if value.language in (None,"","en") else 1,value.language or "",str(value),str(value.datatype or "")))
    def rows(values,kind):
        result=[]
        for term in sorted(values,key=str):
            labels=literals(term,(RDFS.label,SKOS.prefLabel));definitions=literals(term,(SKOS.definition,RDFS.comment))
            parents=named(graph.objects(term,RDFS.subPropertyOf if kind=="property" else RDFS.subClassOf))
            row={"iri":str(term),"label":str(labels[0]) if labels else "","definition":"\n\n".join(dict.fromkeys(str(value) for value in definitions)),
                 "parents":sorted(map(str,parents)),"kind":kind,"labels":[term_value(value) for value in labels],"definitions":[term_value(value) for value in definitions]}
            if kind=="property":row["propertyTypes"]=sorted(str(value) for value in graph.objects(term,RDF.type) if value in property_types)
            deprecated=list(graph.objects(term,OWL.deprecated))
            if deprecated:row["deprecated"]=any(value.toPython() is True for value in deprecated if isinstance(value,rdflib.Literal))
            result.append(row)
        return result
    return {"classes":rows(classes,"class"),"properties":rows(properties,"property"),"tags":rows(tags,"tag"),"units":rows(units,"unit")}

def catalog(request,runtime,ontology):
    graph=ontology_graph(ontology);rows=catalogue_rows(graph)
    return {"schema":SCHEMA,"ok":True,"action":"catalog",**rows,"runtime":runtime,"counts":{key:len(value) for key,value in rows.items()},
            "graphCounts":{"ontology":len(graph)},"complete":True,"scope":"Terms declared or referenced by the retained combined Brick 1.4.4 and RealEstateCore ontology."}

def model_graph(model,ontology):
    rdflib,BrickGraph,_=rdf_modules()
    model_id=string_value(model.get("modelId"),"model.modelId")
    version_id=string_value(model.get("versionId"),"model.versionId")
    content_sha=digest_value(model.get("contentSha256"),"model.contentSha256")
    namespace=iri_value(model.get("namespace"),"model.namespace")
    entities=array_value(model.get("entities"),"model.entities")
    relations=array_value(model.get("relations"),"model.relations")
    graph=BrickGraph(load_brick=False,load_brick_nightly=False,brick_version="1.4")
    for prefix,value in (("brick",BRICK_IRI),("tag",TAG_IRI),("rec",REC_IRI),("model",namespace),("source",PROVENANCE_IRI)):
        graph.bind(prefix,rdflib.Namespace(value),replace=True)
    BRICK=rdflib.Namespace(BRICK_IRI);PROV=rdflib.Namespace(PROVENANCE_IRI)
    terms=catalogue_rows(ontology)
    known_classes={row["iri"] for row in terms["classes"]}
    known_properties={row["iri"] for row in terms["properties"]}
    known_properties|={str(rdflib.RDF.type),str(rdflib.RDFS.label),str(rdflib.RDFS.comment),str(rdflib.OWL.sameAs)}
    known_tags={row["iri"] for row in terms["tags"]};known_units={row["iri"] for row in terms["units"]}
    ontology_subjects={str(subject) for subject in ontology.subjects() if isinstance(subject,rdflib.URIRef)}
    observations=[];bindings=[];by_id={};by_iri={};semantic_relations=set()
    def observation(code,message,**fields):observations.append({"code":code,"message":message,**fields})
    def class_term(value,field,entity_id):
        value=model_term(value,field)
        if value not in known_classes:observation("UNKNOWN_CLASS","The class is absent from the selected ontology catalogue; the original IRI is retained.",entityId=entity_id,iri=value)
        return rdflib.URIRef(value)
    def property_term(value,field):
        value=model_term(value,field)
        if value==str(rdflib.OWL.imports):fail("MODEL_IMPORT","A model cannot request an ontology import during offline validation",{"field":field,"iri":value})
        return rdflib.URIRef(value)
    for index,raw in enumerate(entities):
        entity=object_value(raw,"model.entities["+str(index)+"]")
        entity_id=string_value(entity.get("id"),"entity.id");iri=model_term(entity.get("iri"),"entity.iri")
        if entity_id in by_id or iri in by_iri:fail("DUPLICATE_ENTITY","Entity IDs and supplied stable IRIs must each be unique",{"entityId":entity_id,"iri":iri})
        if iri in ontology_subjects:fail("ONTOLOGY_SUBJECT_COLLISION","A model entity cannot replace a subject in the retained standard",{"entityId":entity_id,"iri":iri})
        subject=rdflib.URIRef(iri);by_id[entity_id]=subject;by_iri[iri]=entity_id
        label=string_value(entity.get("label",""),"entity.label",True)
        classes=array_value(entity.get("classes",[]),"entity.classes");tags=array_value(entity.get("tags",[]),"entity.tags")
        attributes=array_value(entity.get("attributes",[]),"entity.attributes");source_refs=array_value(entity.get("sourceRefs",[]),"entity.sourceRefs")
        for source_index,raw_source in enumerate(source_refs):
            source=object_value(raw_source,"entity.sourceRefs["+str(source_index)+"]")
            if source.get("kind") not in ("native","intake"):fail("INVALID_SOURCE_REFERENCE","A source reference kind must be native or intake",{"entityId":entity_id})
            string_value(source.get("sourceId"),"sourceRef.sourceId");integer_value(source.get("rowIndex"),"sourceRef.rowIndex")
            for optional in ("recordKey","externalId"):
                if optional in source:string_value(source[optional],"sourceRef."+optional,True)
        graph.add((subject,rdflib.RDF.type,rdflib.OWL.NamedIndividual))
        graph.add((subject,rdflib.RDFS.label,rdflib.Literal(label,normalize=False)))
        graph.add((subject,PROV.entityId,rdflib.Literal(entity_id,normalize=False)))
        graph.add((subject,PROV.sourceRefs,rdflib.Literal(canonical_bytes(source_refs).decode("utf-8"),datatype=rdflib.URIRef(str(rdflib.RDF)+"JSON"),normalize=False)))
        classification_count=len(classes)
        for value in classes:graph.add((subject,rdflib.RDF.type,class_term(value,"entity.classes[]",entity_id)))
        for value in tags:
            value=model_term(value,"entity.tags[]")
            if value not in known_tags:observation("UNKNOWN_TAG","The tag is absent from the selected ontology catalogue; the original IRI is retained.",entityId=entity_id,iri=value)
            graph.add((subject,BRICK.hasTag,rdflib.URIRef(value)))
        for attribute_index,raw_attribute in enumerate(attributes):
            attribute=object_value(raw_attribute,"entity.attributes["+str(attribute_index)+"]")
            predicate=property_term(attribute.get("predicate"),"attribute.predicate");predicate_string=str(predicate)
            if predicate_string not in known_properties:observation("UNKNOWN_PROPERTY","The property is absent from the selected ontology catalogue; its triple is retained.",entityId=entity_id,attributeIndex=attribute_index,iri=predicate_string)
            kind=attribute.get("kind");value=string_value(attribute.get("value"),"attribute.value",True)
            if kind=="iri":
                value=model_term(value,"attribute.value")
                if attribute.get("datatype") or attribute.get("language"):fail("INVALID_ATTRIBUTE","An IRI attribute cannot have a literal datatype or language",{"entityId":entity_id})
                obj=rdflib.URIRef(value)
                if predicate==rdflib.RDF.type:classification_count+=1;class_term(value,"attribute.value",entity_id)
                if predicate in (BRICK.hasUnit,rdflib.URIRef(QUDT_IRI+"unit")) and value not in known_units:
                    observation("UNKNOWN_UNIT","This unit IRI is absent from the selected ontology catalogue; the triple is retained.",entityId=entity_id,attributeIndex=attribute_index,iri=value)
            elif kind=="literal":
                datatype=attribute.get("datatype") or None;language=attribute.get("language") or None
                if datatype is not None:datatype=iri_value(datatype,"attribute.datatype")
                if language is not None:
                    language=string_value(language,"attribute.language")
                    if not LANGUAGE.fullmatch(language):fail("INVALID_LANGUAGE","A literal language must be a well-formed language tag",{"language":language})
                if datatype and language:fail("INVALID_ATTRIBUTE","A literal cannot have both an explicit datatype and a language")
                obj=rdflib.Literal(value,datatype=rdflib.URIRef(datatype) if datatype else None,lang=language,normalize=False)
            else:fail("INVALID_ATTRIBUTE","An attribute kind must be iri or literal",{"entityId":entity_id,"attributeIndex":attribute_index})
            graph.add((subject,predicate,obj))
        if not classification_count:observation("UNCLASSIFIED_ENTITY","The original entity has no explicit class mapping; it remains in the model and report.",entityId=entity_id,iri=iri)
        bindings.append({"entityId":entity_id,"iri":iri,"label":label,"sourceRefs":source_refs,"explicitClasses":list(classes),"explicitTags":list(tags)})
    relation_ids=set()
    for index,raw in enumerate(relations):
        relation=object_value(raw,"model.relations["+str(index)+"]");relation_id=string_value(relation.get("id"),"relation.id")
        if relation_id in relation_ids:fail("DUPLICATE_RELATION","Every original relation ID must be unique",{"relationId":relation_id})
        relation_ids.add(relation_id);subject_id=string_value(relation.get("subjectId"),"relation.subjectId");object_id=string_value(relation.get("objectId"),"relation.objectId")
        if subject_id not in by_id or object_id not in by_id:fail("UNKNOWN_RELATION_ENTITY","A relation references an entity outside this complete model",{"relationId":relation_id,"subjectId":subject_id,"objectId":object_id})
        predicate=property_term(relation.get("predicate"),"relation.predicate")
        if str(predicate) not in known_properties:observation("UNKNOWN_PROPERTY","The relation property is absent from the selected ontology catalogue; its triple is retained.",relationId=relation_id,iri=str(predicate))
        triple=(by_id[subject_id],predicate,by_id[object_id])
        if triple in semantic_relations:observation("DUPLICATE_RELATION_TRIPLE","This original relation repeats a semantic triple; every relation ID remains in model.json.",relationId=relation_id)
        semantic_relations.add(triple);graph.add(triple)
    received_model_sha=sha256(canonical_bytes(model))
    model_node=rdflib.URIRef(PROVENANCE_IRI+"version:"+sha256(canonical_bytes([model_id,version_id])))
    for predicate,value in ((PROV.modelId,model_id),(PROV.versionId,version_id),(PROV.contentSha256,content_sha),(PROV.receivedModelSha256,received_model_sha)):
        graph.add((model_node,predicate,rdflib.Literal(value,normalize=False)))
    graph.add((model_node,PROV.relations,rdflib.Literal(canonical_bytes(relations).decode("utf-8"),datatype=rdflib.URIRef(str(rdflib.RDF)+"JSON"),normalize=False)))
    return graph,{"modelId":model_id,"versionId":version_id,"contentSha256":content_sha,"receivedModelSha256":received_model_sha},bindings,observations,{"entities":len(entities),"relations":len(relations),"distinctRelationTriples":len(semantic_relations)}

def graph_bytes(graph):
    return graph.serialize(format="turtle",encoding="utf-8")

def validation_rows(report_graph):
    import rdflib
    SH=rdflib.Namespace(SHACL_IRI)
    nodes=set(report_graph.subjects(rdflib.RDF.type,SH.ValidationResult))|set(report_graph.objects(None,SH.result))|set(report_graph.objects(None,SH.detail))
    rows=[]
    for node in nodes:
        def values(predicate):return sorted(report_graph.objects(node,predicate),key=lambda value:value.n3())
        def scalar(predicate):
            result=values(predicate);return str(result[0]) if result else None
        messages=values(SH.resultMessage)
        rows.append({"id":node.n3(),"focusNode":scalar(SH.focusNode),"path":scalar(SH.resultPath),"value":scalar(SH.value),
                     "severity":scalar(SH.resultSeverity),"sourceShape":scalar(SH.sourceShape),"component":scalar(SH.sourceConstraintComponent),
                     "messages":[str(message) for message in messages],"messageTerms":[term_value(message) for message in messages],
                     "focusNodes":[term_value(value) for value in values(SH.focusNode)],"paths":[term_value(value) for value in values(SH.resultPath)],
                     "values":[term_value(value) for value in values(SH.value)],"sourceShapes":[term_value(value) for value in values(SH.sourceShape)],
                     "details":[value.n3() for value in values(SH.detail)],"parentResults":sorted(value.n3() for value in report_graph.subjects(SH.detail,node))})
    return sorted(rows,key=lambda row:tuple(str(row.get(key) or "") for key in ("focusNode","path","sourceShape","severity","id")))

def complete_validation(graph,ontology):
    """Original Brick wrapper plus an independent complete pass of its selected engine."""
    rdflib,BrickGraph,pyshacl=rdf_modules()
    minimum_iterations=1;maximum_iterations=10
    if minimum_iterations<1 or maximum_iterations<minimum_iterations:fail("ITERATION_OPTIONS","The selected validation pass controls are invalid")
    model_copy=rdflib.Graph()
    for prefix,namespace in graph.namespaces():model_copy.bind(prefix,namespace)
    for triple in graph:model_copy.add(triple)
    wrapper=BrickGraph(load_brick=False,load_brick_nightly=False,brick_version="1.4")
    for prefix,namespace in model_copy.namespaces():wrapper.bind(prefix,namespace)
    for triple in model_copy:wrapper.add(triple)
    official_conforms,official_report,official_text=wrapper.validate(extra_graphs=[ontology],engine="pyshacl",min_iterations=minimum_iterations,max_iterations=maximum_iterations)
    if not isinstance(official_report,rdflib.Graph):fail("SHACL_ENGINE_FAILURE","The original Brick wrapper returned a SHACL engine failure",{"message":str(official_report)})
    # Match the original wrapper: flatten and skolemize DATA once, then add shapes.
    # Ontology blank nodes retain their original identity. Runs are independent.
    working=model_copy.skolemize()+ontology
    for prefix,namespace in model_copy.namespaces():working.bind(prefix,namespace)
    passes=[];stabilized=False
    for iteration in range(maximum_iterations):
        before=set(working)
        conforms,report,text=pyshacl.validate(data_graph=working,advanced=True,inplace=True,allow_warnings=True,
            allow_infos=False,abort_on_first=False,inference=None,iterate_rules=False,
            do_owl_imports=False,sparql_mode=False,js=False,debug=False)
        if not isinstance(report,rdflib.Graph):fail("SHACL_ENGINE_FAILURE","The complete pySHACL pass returned an engine failure",{"message":str(report)})
        after=set(working);unchanged=before==after
        passes.append({"pass":iteration+1,"before":len(before),"after":len(after),"added":len(after-before),"removed":len(before-after),"unchanged":unchanged})
        if iteration+1>=minimum_iterations and unchanged:stabilized=True;break
    wrapper_turtle=graph_bytes(official_report)
    method={"engine":"pyshacl","complete":stabilized,"status":"fixed-point" if stabilized else "iteration-limit",
            "minimumIterations":minimum_iterations,"maximumIterations":maximum_iterations,"iterations":len(passes),"stabilized":stabilized,"passes":passes,
            "abortOnFirst":False,"advanced":True,"inplace":True,"iterateRules":False,"inference":None,
            "allowWarnings":True,"allowInfos":False,"allowedSeverities":["http://www.w3.org/ns/shacl#Warning","http://www.w3.org/ns/shacl#Info"],
            "owlImports":False,"javascript":False,"sparqlMode":False,"dataSkolemizedOnce":True,"ontologySkolemized":False,
            "brickWrapper":{"engine":"pyshacl","conforms":bool(official_conforms),"resultCount":len(validation_rows(official_report)),"reportSha256":sha256(wrapper_turtle)},
            "validatedGraphTriples":len(working)}
    return bool(conforms),report,str(text),method,[
        output_file("brick-wrapper-report.ttl","text/turtle",wrapper_turtle),
        output_file("brick-wrapper-report.txt","text/plain",str(official_text).encode("utf-8")),
        output_file("validation-expanded.ttl","text/turtle",graph_bytes(working))]

def validate_model(request,runtime,ontology_body):
    model=object_value(request.get("model"),"model");ontology=ontology_graph(ontology_body)
    graph,binding,bindings,observations,counts=model_graph(model,ontology)
    original_turtle=graph_bytes(graph)
    conforms,report,report_text,method,engine_outputs=complete_validation(graph,ontology)
    results=validation_rows(report);result_counts={}
    for row in results:
        severity=row.get("severity") or "unspecified";result_counts[severity]=result_counts.get(severity,0)+1
    result={"schema":SCHEMA,"ok":True,"action":"validate",**binding,"conforms":conforms,"results":results,"resultCounts":result_counts,
            "mappingObservations":observations,"entityBindings":bindings,"graphCounts":{"model":len(graph),"ontology":len(ontology),"report":len(report),"validated":method["validatedGraphTriples"],**counts},
            "runtime":runtime,"validation":method,"outputs":[output_file("model.ttl","text/turtle",original_turtle),
                output_file("model.json","application/json",canonical_bytes(model)+b"\n"),
                output_file("validation-report.ttl","text/turtle",graph_bytes(report)),
                output_file("validation-report.txt","text/plain",report_text.encode("utf-8")),*engine_outputs]}
    if not method["stabilized"]:
        result.update({"ok":False,"observedConforms":conforms,"conforms":None,
                       "error":{"code":"SHACL_ITERATION_LIMIT","message":"The original pass bound was reached before an observed fixed point; all actual reports and the final graph are retained.","details":{"iterations":method["iterations"],"limit":method["maximumIterations"]}}})
    return result

def dispatch(request):
    request=object_value(request,"request");action=request.get("action")
    if action not in ("inspect","catalog","validate"):fail("UNKNOWN_ACTION","Select inspect, catalog or validate",{"action":action})
    standard,ontology=standard_source();runtime=runtime_metadata(standard,action!="inspect")
    if action=="inspect":return inspect_file(request,runtime)
    if action=="catalog":return catalog(request,runtime,ontology)
    return validate_model(request,runtime,ontology)

def atomic_result(path,data):
    if not path.is_absolute():fail("OUTPUT_PATH","--output must be an absolute path")
    path.parent.mkdir(parents=True,exist_ok=True)
    fd,temporary=tempfile.mkstemp(prefix="."+path.name+".",dir=path.parent)
    try:
        with os.fdopen(fd,"wb") as stream:
            os.fchmod(stream.fileno(),0o600);stream.write(data);stream.flush();os.fsync(stream.fileno())
        os.replace(temporary,path)
        parent_fd=os.open(path.parent,os.O_RDONLY|getattr(os,"O_DIRECTORY",0))
        try:os.fsync(parent_fd)
        finally:os.close(parent_fd)
    finally:Path(temporary).unlink(missing_ok=True)

def install_offline_guard():
    def deny_network(event,arguments):
        if event in ("socket.connect","socket.getaddrinfo","http.client.connect","urllib.Request"):
            fail("NETWORK_DISABLED","Native semantic actions only use retained local sources",{"event":event})
    sys.addaudithook(deny_network)

def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input",type=Path,help="Absolute path to the complete original JSON request")
    parser.add_argument("--output",type=Path,help="Absolute path for the atomically written complete JSON result")
    args=parser.parse_args(argv)
    request_bytes=b"";request=None;captured=io.StringIO();exit_code=0
    def interrupted(signum,frame):raise InterruptedError("Native semantic operation interrupted by signal "+str(signum))
    old_handlers={number:signal.signal(number,interrupted) for number in (signal.SIGINT,signal.SIGTERM)}
    try:
        install_offline_guard()
        if args.input is not None:
            if not args.input.is_absolute():fail("INPUT_PATH","--input must be an absolute path")
            with args.input.open("rb") as stream:request_bytes=stream.read(MAX_REQUEST_BYTES+1)
        else:request_bytes=sys.stdin.buffer.read(MAX_REQUEST_BYTES+1)
        if len(request_bytes)>MAX_REQUEST_BYTES:fail("REQUEST_TOO_LARGE","The complete native request exceeds 64 MiB",{"limit":MAX_REQUEST_BYTES})
        request=strict_json(request_bytes)
        with contextlib.redirect_stdout(captured):result=dispatch(request)
        if not result.get("ok"):exit_code=2
    except SemanticError as error:
        result={"schema":SCHEMA,"ok":False,"error":{"code":error.code,"message":str(error)}}
        if error.details is not None:result["error"]["details"]=error.details
        exit_code=2
    except (InterruptedError,KeyboardInterrupt) as error:
        result={"schema":SCHEMA,"ok":False,"error":{"code":"INTERRUPTED","message":str(error)}};exit_code=130
    except Exception as error:
        result={"schema":SCHEMA,"ok":False,"error":{"code":"NATIVE_ERROR","message":str(error),"type":type(error).__name__}};exit_code=1
    finally:
        for number,handler in old_handlers.items():signal.signal(number,handler)
    result["requestSha256"]=sha256(request_bytes);result["adapterSha256"]=sha256(Path(__file__).read_bytes())
    if isinstance(request,dict):
        result.setdefault("action",request.get("action"));model=request.get("model")
        if isinstance(model,dict):
            for field in ("modelId","versionId","contentSha256"):
                if field in model:result.setdefault(field,model[field])
    if captured.getvalue():result["runtimeMessages"]=captured.getvalue()
    result_bytes=canonical_bytes(result)+b"\n"
    try:
        if args.output is not None:atomic_result(args.output,result_bytes)
    except Exception as error:
        failure={"schema":SCHEMA,"ok":False,"action":result.get("action"),"requestSha256":result["requestSha256"],"adapterSha256":result["adapterSha256"],
                 "error":{"code":"OUTPUT_WRITE_FAILED","message":str(error),"type":type(error).__name__}}
        sys.stdout.buffer.write(canonical_bytes(failure)+b"\n");sys.stdout.buffer.flush();return 1
    sys.stdout.buffer.write(result_bytes);sys.stdout.buffer.flush();return exit_code

if __name__=="__main__":
    raise SystemExit(main())
