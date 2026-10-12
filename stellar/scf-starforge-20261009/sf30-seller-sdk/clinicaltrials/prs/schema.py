"""Original PRS schemas, complete validation and source-aware inspection.

No network request is made by this module. XML and XSD bytes are independently
retained; the resolver only serves the selected, hash-checked original closure.
"""
from __future__ import annotations
import hashlib
import io
import json
import re
import threading
from collections import Counter, defaultdict
from functools import lru_cache
from pathlib import Path
from .errors import PrsError

try:
    from lxml import etree
except ImportError:
    etree = None

PRS = "http://clinicaltrials.gov/prs"
RRS = "http://clinicaltrials.gov/rrs"
XS = "http://www.w3.org/2001/XMLSchema"
XSI = "http://www.w3.org/2001/XMLSchema-instance"
MAX_XML_BYTES = 256 * 1024 * 1024
NOTICE = "https://www.nlm.nih.gov/pubs/techbull/so26/so26_ctg_prs_api.html"
BUNDLED_HASHES = {
    "ProtocolRecordSchema.xsd": "cb4f2036b811146a98f30ee48741e513d569af3193fd7ee2fb143e918c2ab066",
    "RRSUploadSchema.xsd": "2382a9eeb00ccabfab87a0c3b02c0b62586a2ecaf73d8ad7e39379228d28abda",
    "clinicaltrials-openapi.yaml": "ba31adaea67e6bb09ff77af5c0c11daf36d5aff7f5d6cbed89f0aab04b297aea",
}

def sha256(data):
    return hashlib.sha256(data).hexdigest()

def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)

def digest(value):
    return sha256(canonical(value).encode("utf-8"))

def _engine():
    if etree is None:
        raise PrsError("Install the declared lxml dependency to validate the complete original XSDs.", "DEPENDENCY_MISSING")

def xml_bytes(value):
    if not isinstance(value, (bytes, bytearray, memoryview)):
        raise PrsError("XML input must be original bytes.", "INPUT_TYPE")
    value = bytes(value)
    if not value or len(value) > MAX_XML_BYTES:
        raise PrsError("XML input must contain 1 to 268435456 bytes.", "INPUT_SIZE")
    return value

def _parser():
    _engine()
    return etree.XMLParser(resolve_entities=False, load_dtd=False, no_network=True,
                           remove_blank_text=False, remove_comments=False,
                           strip_cdata=False, recover=False, huge_tree=False)

def parse_document(value):
    _engine()
    data = xml_bytes(value)
    try:
        doc = etree.parse(io.BytesIO(data), _parser())
    except (etree.XMLSyntaxError, ValueError) as exc:
        log = getattr(exc, "error_log", ())
        raise PrsError("The original bytes are not a supported well-formed XML document.",
                       "XML_PARSE", _errors(log) or [{"message": str(exc)}]) from exc
    if doc.docinfo.doctype or any(isinstance(n, etree._Entity) for n in doc.iter()):
        raise PrsError("DTD and entity declarations are not part of the PRS XML intake.", "XML_DTD")
    return doc

def _errors(log):
    return [{"line": e.line, "column": e.column, "level": e.level_name,
             "domain": e.domain_name, "type": e.type_name, "path": e.path,
             "message": e.message} for e in log]

class SchemaSet:
    def __init__(self, directory=None):
        _engine()
        self.directory = Path(directory) if directory else Path(__file__).parent / "schemas"
        self.originals = {}
        try:
            manifest_bytes = (self.directory / "source-contracts.json").read_bytes()
            self.manifest = json.loads(manifest_bytes)
            records = self.manifest["records"]
        except (OSError, ValueError, KeyError, TypeError) as exc:
            raise PrsError("The selected source-contracts.json cannot be read.", "SCHEMA_SOURCE", str(exc)) from exc
        by_name = {r.get("file"): r for r in records if isinstance(r, dict)}
        if len(by_name) != len(records):
            raise PrsError("Schema source manifest contains duplicate or malformed filenames.", "SCHEMA_SOURCE")
        self.sources = []
        for name in BUNDLED_HASHES:
            record = by_name.get(name)
            if not record:
                raise PrsError("The selected source closure is missing " + name, "SCHEMA_SOURCE")
            try:
                data = (self.directory / name).read_bytes()
            except OSError as exc:
                raise PrsError("The original source file cannot be read: " + name, "SCHEMA_SOURCE") from exc
            if len(data) != record.get("bytes") or sha256(data) != record.get("sha256"):
                raise PrsError("Original source bytes do not match their retained manifest: " + name, "SCHEMA_HASH")
            self.originals[name] = data
            version = re.search(rb"Schema Version:\s*([^\r\n]+)", data)
            self.sources.append({
                "filename": name, "bytes": len(data), "sha256": sha256(data),
                "url": record.get("url"), "finalUrl": record.get("final_url"),
                "observedAt": record.get("observed_at"), "responseStatus": record.get("status"),
                "headers": record.get("headers", {}),
                "declaredVersion": version.group(1).decode("ascii", "replace").strip() if version else None,
            })
        self.set_sha256 = digest([{k: v[k] for k in ("filename", "bytes", "sha256")} for v in self.sources])
        self.profile_matches = all(sha256(self.originals[n]) == h for n, h in BUNDLED_HASHES.items())
        original_map = self.originals
        allowed_urls = {r.get("url"): r["file"] for r in records if r.get("file") in original_map}
        allowed_urls.update({r.get("final_url"): r["file"] for r in records if r.get("file") in original_map})
        class ClosureResolver(etree.Resolver):
            def resolve(self, url, public_id, context):
                filename = url if url in original_map else allowed_urls.get(url)
                if filename is None and url.startswith("prs-source:///"):
                    filename = url.removeprefix("prs-source:///")
                if filename not in ("ProtocolRecordSchema.xsd", "RRSUploadSchema.xsd"):
                    raise OSError("Schema import is outside the retained original closure: " + url)
                return self.resolve_string(original_map[filename], context,
                                           base_url="prs-source:///" + filename)
        parser = _parser()
        parser.resolvers.add(ClosureResolver())
        self.trees = {}
        self.validators = {}
        try:
            for kind, name in (("protocol", "ProtocolRecordSchema.xsd"), ("results", "RRSUploadSchema.xsd")):
                tree = etree.parse(io.BytesIO(self.originals[name]), parser, base_url="prs-source:///" + name)
                if tree.docinfo.doctype:
                    raise PrsError("Source schemas cannot declare a DTD.", "SCHEMA_SOURCE")
                declared = tree.xpath("//xs:import|//xs:include|//xs:redefine", namespaces={"xs": XS})
                for node in declared:
                    location = node.get("schemaLocation")
                    if location not in ("RRSUploadSchema.xsd",):
                        raise PrsError("A selected schema declares an unresolved source dependency.", "SCHEMA_CLOSURE",
                                       {"filename": name, "line": node.sourceline, "schemaLocation": location})
                self.trees[kind] = tree
                self.validators[kind] = etree.XMLSchema(tree)
        except (etree.XMLSchemaParseError, etree.XMLSyntaxError, OSError) as exc:
            raise PrsError("The complete selected source schemas could not be compiled.", "SCHEMA_COMPILE",
                           _errors(getattr(exc, "error_log", ())) or str(exc)) from exc
        self.lock = threading.RLock()
        self.order = [n.get("name") for n in self.trees["protocol"].xpath(
            "/xs:schema/xs:complexType[@name='ClinicalStudy']/xs:sequence/xs:element[@name]",
            namespaces={"xs": XS})]
    def validate(self, doc, kind):
        if kind not in self.validators:
            raise PrsError("schema must be protocol or results.", "SCHEMA_KIND")
        with self.lock:
            valid = self.validators[kind].validate(doc)
            errors = _errors(self.validators[kind].error_log)
        return valid, errors
    def schema_line(self, kind, type_name, field_name):
        found = self.trees[kind].xpath(
            "/xs:schema/xs:complexType[@name=$type]//xs:element[@name=$field]",
            namespaces={"xs": XS}, type=type_name, field=field_name)
        return found[0].sourceline if found else None

@lru_cache(maxsize=4)
def _cached_schemas(directory):
    return SchemaSet(directory)

def schemas(directory=None):
    # A SchemaSet is immutable for one process. New source editions use a new
    # selected directory/process; source identity is carried in every plan.
    return _cached_schemas(str(Path(directory).resolve()) if directory else None)

def doctor(schema_dir=None):
    result = {"schema": "stellar-forge.prs-doctor.v1", "network": "none",
              "maxXmlBytes": MAX_XML_BYTES, "pythonDependency": "lxml",
              "available": etree is not None}
    if etree is None:
        return {**result, "ready": False}
    result.update(lxmlVersion=".".join(map(str, etree.LXML_VERSION)),
                  libxmlVersion=".".join(map(str, etree.LIBXML_VERSION)))
    try:
        source = schemas(schema_dir)
        result.update(ready=True, schemaSetSha256=source.set_sha256,
                      schemaSources=source.sources, bundledProfileMatches=source.profile_matches)
    except PrsError as exc:
        result.update(ready=False, error=exc.as_dict()["error"])
    return result

# Thirteen deprecated names, with fifteen exact paths because the Outcome type
# is used by all three protocol outcome collections.
RULES = [
    ("is_fda_regulated", ("is_fda_regulated",), "ClinicalStudy", "remove", ()),
    ("is_section_801", ("is_section_801",), "ClinicalStudy", "remove", ()),
    ("end_date", ("end_date",), "ClinicalStudy", "date",
     ("last_follow_up_date", "last_follow_up_date_type")),
]
for _name in ("name_title", "organization", "phone", "phone_ext", "email"):
    RULES.append((_name, ("sponsors", "resp_party", _name), "ResponsibleParty",
                  "responsible_party", ("investigator_username", "investigator_title", "investigator_affiliation")))
RULES.append(("regulatory_authority", ("oversight_info", "regulatory_authority"), "OversightInfo", "remove", ()))
RULES.extend([
    ("masking", ("study_design", "interventional_design", "masking"), "InterventionalDesign", "masking",
     ("no_masking", "masked_subject", "masked_caregiver", "masked_investigator", "masked_assessor")),
    ("control", ("study_design", "interventional_design", "control"), "InterventionalDesign", "remove", ()),
    ("endpoint", ("study_design", "interventional_design", "endpoint"), "InterventionalDesign", "remove", ()),
])
for _outcome in ("primary_outcome", "secondary_outcome", "other_outcome"):
    RULES.append(("outcome_safety_issue", (_outcome, "outcome_safety_issue"), "Outcome", "remove", ()))

def children(node):
    return [c for c in node if isinstance(c.tag, str)]

def text_value(node):
    return "".join(node.itertext())

def select_xml(node, path):
    current = [node]
    for tag in path:
        current = [c for parent in current for c in children(parent) if c.tag == tag]
    return current

def path_of(node, stop=None):
    path = []
    while node is not None and node is not stop:
        if isinstance(node.tag, str):
            parent = node.getparent()
            same = [c for c in children(parent) if c.tag == node.tag] if parent is not None else [node]
            path.append({"name": node.tag, "occurrence": same.index(node) + 1})
        node = node.getparent()
    return list(reversed(path))

def path_key(path):
    return canonical(path)

def element_id(input_hash, node):
    return "element-" + digest({"inputSha256": input_hash, "path": path_of(node)})[:24]

def node_at(doc, path):
    current = doc.getroot()
    if not path or current.tag != path[0].get("name") or path[0].get("occurrence") != 1:
        raise PrsError("The retained element path no longer resolves.", "PLAN_SOURCE")
    for part in path[1:]:
        same = [c for c in children(current) if c.tag == part.get("name")]
        index = part.get("occurrence")
        if not isinstance(index, int) or isinstance(index, bool) or not 1 <= index <= len(same):
            raise PrsError("The retained element occurrence no longer resolves.", "PLAN_SOURCE")
        current = same[index - 1]
    return current

def _first(node, path):
    found = select_xml(node, path)
    return text_value(found[0]) if found else None

def study_nodes(doc):
    root = doc.getroot()
    if root.tag == "{" + PRS + "}study_collection":
        return [n for n in children(root) if n.tag == "clinical_study"]
    return []

def identity(node):
    return {"orgName": _first(node, ("id_info", "org_name")),
            "orgStudyId": _first(node, ("id_info", "org_study_id")),
            "providerName": _first(node, ("id_info", "provider_name")),
            "providerStudyId": _first(node, ("id_info", "provider_study_id"))}

def study_key(node):
    value = identity(node)
    return canonical([value["orgName"], value["orgStudyId"]])

def boolean_attribute(node, name):
    raw = node.get(name)
    return {"raw": raw, "value": False if raw is None else
            True if raw in ("true", "1") else False if raw in ("false", "0") else None,
            "defaulted": raw is None}

def _empty(node):
    return not children(node) and (node.text is None or node.text == "")

PROTOCOL_PARTIAL_UNITS = (
    "secondary_id is_fda_regulated is_section_801 delayed_posting is_ind_study ind_info brief_title official_title sponsors "
    "oversight_info brief_summary detailed_description overall_status why_stopped expanded_access_status start_date "
    "start_date_type last_follow_up_date last_follow_up_date_type primary_compl_date primary_compl_date_type study_type "
    "interventional_design observational_design primary_outcome secondary_outcome other_outcome enrollment enrollment_type "
    "condition keyword arm_group intervention eligibility overall_official overall_contact overall_contact_backup location "
    "ipd_sharing_statement link reference study_document verification_date"
).split()
RESULT_PARTIAL_UNITS = ["baseline", "certainAgreement", "limitationsAndCaveats",
                        "outcomeMeasures", "participantFlow", "pointOfContact", "reportedEvents"]

def upload_intent(node, *, result=False):
    attribute = "partialUpload" if result else "partial_upload"
    mode = boolean_attribute(node, attribute)
    allowed = RESULT_PARTIAL_UNITS if result else PROTOCOL_PARTIAL_UNITS
    grouped = defaultdict(list)
    for item in children(node):
        grouped[item.tag].append(item)
    units = []
    for tag, nodes in grouped.items():
        deletion = [n for n in nodes if boolean_attribute(n, "delete")["value"] is True]
        empty = all(_empty(n) for n in nodes)
        if mode["value"] is None:
            effect = "invalid_partial_attribute"
        elif not mode["value"]:
            effect = "replace_record_content" if not result else "replace_results_content"
        elif result:
            effect = "replace_results_subset" if tag in allowed else "outside_documented_subset"
        elif deletion:
            effect = "delete_complete_list_or_value"
        elif tag == "id_info":
            effect = "identifying_information"
        elif tag not in allowed:
            effect = "outside_documented_partial_unit"
        elif empty:
            effect = "retain_previous"
        else:
            effect = "replace_complete_list_or_value"
        units.append({"name": tag, "occurrences": len(nodes), "empty": empty,
                      "deleteRequested": bool(deletion), "effect": effect,
                      "paths": [path_of(n) for n in nodes]})
    return {"attribute": attribute, "partial": mode, "units": units,
            "omittedEffect": ("retain_previous" if mode["value"] else
                              "replace_record_with_submitted_content" if mode["value"] is False else "undefined"),
            "sourceFilename": "RRSUploadSchema.xsd" if result else "ProtocolRecordSchema.xsd",
            "documentedPartialUnits": allowed,
            "sourceNotes": [] if result else [
                "The original partial-upload comments list study_type/interventional_design/observational_design, but current XSD nests these under study_design.",
                "Some documented empty delete forms conflict with required XSD children; schema validity and requested deletion are reported separately.",
            ]}

def _reference_report(doc):
    ids = defaultdict(list)
    refs = []
    roots = [n for n in doc.iter() if isinstance(n.tag, str) and n.tag in ("{" + RRS + "}result", "{" + RRS + "}resultDisposition")]
    for root in roots:
        for node in root.iter():
            if not isinstance(node.tag, str):
                continue
            if "id" in node.attrib:
                ids[node.get("id")].append({"path": path_of(node), "line": node.sourceline})
            if node.tag in ("reportingGroupId", "outcomeReportingGroupId"):
                refs.append({"id": text_value(node), "path": path_of(node), "line": node.sourceline})
    errors = []
    for key, where in ids.items():
        if len(where) > 1:
            errors.append({"code": "DUPLICATE_ID", "id": key, "declarations": where})
    for ref in refs:
        ref["declarations"] = ids.get(ref["id"], [])
        ref["resolved"] = len(ref["declarations"]) == 1
        if not ref["resolved"]:
            errors.append({"code": "UNRESOLVED_IDREF" if not ref["declarations"] else "AMBIGUOUS_IDREF", **ref})
    return {"valid": not errors, "ids": dict(ids), "references": refs, "errors": errors,
            "scope": "single XML document", "sourceFilename": "RRSUploadSchema.xsd"}

def inspect(value, schema="protocol", schema_dir=None):
    data = xml_bytes(value)
    source = schemas(schema_dir)
    header = {"schema": "stellar-forge.prs-inspection.v1", "inputSha256": sha256(data),
              "bytes": len(data), "schemaKind": schema, "schemaSetSha256": source.set_sha256,
              "schemaSources": source.sources, "bundledProfileMatches": source.profile_matches}
    try:
        doc = parse_document(data)
    except PrsError as exc:
        if exc.code not in ("XML_PARSE", "XML_DTD"):
            raise
        return {**header, "wellFormed": False, "schemaValid": False,
                "schemaErrors": exc.details or [{"message": str(exc), "type": exc.code}],
                "legacyElements": [], "studies": [], "sourceIssues": [], "references": None}
    valid, errors = source.validate(doc, schema)
    studies = []
    legacy = []
    issues = []
    nodes = study_nodes(doc)
    key_counts = Counter(study_key(n) for n in nodes)
    for i, node in enumerate(nodes, 1):
        ident = identity(node)
        result_nodes = [n for n in children(node) if n.tag == "{" + RRS + "}result"]
        item = {"index": i, "key": study_key(node), "identity": ident,
                "path": path_of(node), "line": node.sourceline,
                "briefTitle": _first(node, ("brief_title",)),
                "protocolUpload": upload_intent(node),
                "resultsUpload": [upload_intent(n, result=True) for n in result_nodes],
                "hasResults": bool(result_nodes)}
        studies.append(item)
        if key_counts[item["key"]] > 1:
            issues.append({"code": "DUPLICATE_STUDY_IDENTITY", "studyIndex": i, "key": item["key"]})
        if not ident["orgName"] or not ident["orgStudyId"]:
            issues.append({"code": "EMPTY_STUDY_IDENTITY", "studyIndex": i,
                           "detail": "The XSD string type can be empty; PRS identifying information still needs review."})
        if item["protocolUpload"]["partial"]["value"] is False and not item["briefTitle"]:
            issues.append({"code": "FULL_UPLOAD_BRIEF_TITLE", "studyIndex": i,
                           "detail": "The original XSD comment requires brief_title except for partial upload."})
        for rule_id, route, type_name, kind, replacement_names in RULES:
            for found in select_xml(node, route):
                parent = found.getparent()
                current = {name: _first(parent, (name,)) for name in replacement_names}
                legacy.append({
                    "elementId": element_id(header["inputSha256"], found), "ruleId": rule_id,
                    "studyIndex": i, "studyKey": item["key"], "path": path_of(found),
                    "relativePath": list(route), "line": found.sourceline, "value": text_value(found),
                    "empty": _empty(found), "replacementKind": kind,
                    "allowedReplacementFields": list(replacement_names), "currentReplacement": current,
                    "source": {"notice": NOTICE, "schemaFilename": "ProtocolRecordSchema.xsd",
                               "type": type_name, "line": source.schema_line("protocol", type_name, rule_id)},
                    "currentTreatment": "accepted but not processed, stored or displayed; NLM 2026-09-22 notice",
                })
    references = _reference_report(doc)
    root = doc.getroot()
    return {**header, "wellFormed": True, "schemaValid": valid, "schemaErrors": errors,
            "rootName": root.tag, "encoding": doc.docinfo.encoding,
            "legacyElements": legacy, "legacyOccurrenceCount": len(legacy),
            "legacyNames": sorted({n["ruleId"] for n in legacy}),
            "studies": studies, "sourceIssues": issues, "references": references,
            "standaloneResultsUpload": upload_intent(root, result=True) if root.tag == "{" + RRS + "}result" else None,
            "resultsReleaseComponents": [{"path": path_of(n), "present": [c.tag for c in children(n)],
               "sourceRequiredBeforeRelease": ["baseline", "certainAgreement", "participantFlow", "pointOfContact"],
               "sourceFilename": "RRSUploadSchema.xsd"} for n in doc.iter() if isinstance(n.tag, str) and n.tag == "{" + RRS + "}result"],
            "notice": NOTICE}

def _flat(node, root_path=()):
    out = {}
    def visit(n, path):
        if not isinstance(n.tag, str):
            return
        out[path_key(path)] = {"path": list(path), "kind": "element", "attributes": dict(n.attrib),
                              "value": text_value(n) if not children(n) else
                              (n.text if n.text and n.text.strip() else None)}
        counts = Counter()
        for c in children(n):
            counts[c.tag] += 1
            visit(c, (*path, {"name": c.tag, "occurrence": counts[c.tag]}))
    visit(node, root_path or ({"name": node.tag, "occurrence": 1},))
    return out

def compare(original_bytes, candidate_bytes, schema="protocol", schema_dir=None):
    before = inspect(original_bytes, schema, schema_dir)
    after = inspect(candidate_bytes, schema, schema_dir)
    report = {"schema": "stellar-forge.prs-comparison.v1", "originalSha256": before["inputSha256"],
              "candidateSha256": after["inputSha256"], "byteIdentical": bytes(original_bytes) == bytes(candidate_bytes),
              "before": before, "after": after, "changes": []}
    if not before["wellFormed"] or not after["wellFormed"]:
        return {**report, "comparable": False, "contentEqual": None}
    documents = [parse_document(original_bytes), parse_document(candidate_bytes)]
    maps = []
    for doc in documents:
        rows = study_nodes(doc)
        counts = Counter(study_key(n) for n in rows)
        if rows:
            mapped = {study_key(n) + (f"#occurrence-{i}" if counts[study_key(n)] > 1 else ""): _flat(n)
                      for i, n in enumerate(rows, 1)}
            root = doc.getroot()
            root_path = path_of(root)
            mapped["$collection"] = {path_key(root_path): {"path": root_path, "kind": "element",
                "attributes": dict(root.attrib), "value": root.text if root.text and root.text.strip() else None}}
            maps.append(mapped)
        else:
            maps.append({"$document": _flat(doc.getroot())})
    changes = []
    for key in sorted(set(maps[0]) | set(maps[1])):
        left, right = maps[0].get(key, {}), maps[1].get(key, {})
        for path in sorted(set(left) | set(right)):
            a, b = left.get(path), right.get(path)
            if a != b:
                changes.append({"studyKey": key, "path": (a or b)["path"],
                                "change": "added" if a is None else "removed" if b is None else "changed",
                                "before": a, "after": b})
    return {**report, "comparable": True, "contentEqual": not changes,
            "changeCount": len(changes), "changes": changes,
            "comparisonSemantics": "Exact expanded names, original occurrence order, attributes and leaf values; studies are keyed by original organization/study IDs."}
