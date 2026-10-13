"""Complete native XML indexing, exact scalar edits and offline XSD/Schematron."""
from __future__ import annotations
import copy
import io
import json
import platform
import re
import threading
from collections import Counter, defaultdict
from pathlib import Path

from lxml import etree, isoschematron
from common import AuditError, canonical, digest, key, now, require, text

NAMESPACE = "http://buildingsync.net/schemas/bedes-auc/2019"
Q = "{" + NAMESPACE + "}"
SVRL = "{http://purl.oclc.org/dsdl/svrl}"
ASSET_DIRECTORY = Path(__file__).resolve().parent / "standards"
_ENGINE_LOCK = threading.RLock()
_CACHE = {}
# Semantic locations and reference annotations come from the complete pinned
# BuildingSync catalogue. A similarly named LinkedPremises wrapper is not an
# inventory entity, and a foreign wildcard element is not a native audit tag.
_XML_SPACE = re.compile(r"[\x20\t\r\n]+")


def local(element):
    return etree.QName(element).localname if isinstance(element.tag, str) else ""

def native(element):
    return isinstance(element.tag, str) and element.tag.startswith(Q)

def scalar(element, name, default=""):
    found = element.find(Q + name) if element is not None else None
    return default if found is None or found.text is None else found.text

def diagnostic(code, message, **details):
    value = {"code": code, "message": message, "severity": "error", **details}
    value["id"] = "finding-" + key(code, message, canonical(details))[:24]
    return value

def asset_catalog():
    data = json.loads((ASSET_DIRECTORY / "standards.json").read_text("utf-8"))
    return data

def asset_bytes(name, catalogue=None):
    require(isinstance(name, str) and "/" not in name and "\\" not in name, "invalid_standard", "A standard must be a retained asset")
    catalogue = catalogue or asset_catalog()
    record = next((a for a in catalogue["originalAssets"] if a["name"] == name), None)
    require(record is not None, "unknown_standard", "The requested standard is absent from the source catalogue")
    raw = (ASSET_DIRECTORY / name).read_bytes()
    require(len(raw) == record["bytes"] and digest(raw) == record["sha256"],
            "standard_changed", "The complete retained standard differs from its pinned source", {"file": name})
    return raw

class RetainedSchemaResolver(etree.Resolver):
    def resolve(self, url, public_id, context):
        imports = asset_catalog()["validation"]["schemaImports"]
        for entry in imports:
            if url == entry["requestedURI"]:
                return self.resolve_string(asset_bytes(entry["localFile"]), context, base_url=url)
        raise AuditError("schema_resolver_denied", "The schema requested an unregistered dependency", {"uri": url})

def parser(*, schema=False):
    result = etree.XMLParser(no_network=True, load_dtd=False, resolve_entities=False,
                             recover=False, remove_blank_text=False, strip_cdata=False,
                             remove_comments=False, remove_pis=False, huge_tree=False)
    if schema:
        result.resolvers.add(RetainedSchemaResolver())
    return result

def engine_info():
    return {
        "python": platform.python_version(),
        "lxml": ".".join(map(str, etree.LXML_VERSION)),
        "libxml2": ".".join(map(str, etree.LIBXML_VERSION)),
        "libxslt": ".".join(map(str, etree.LIBXSLT_VERSION)),
    }

def structural_paths(root):
    """Expanded-name paths in document order, with a linear sibling pass."""
    paths = {}
    def visit(element, parent_path, position):
        if not isinstance(element.tag, str):
            return
        qname = etree.QName(element)
        part = "Q{" + (qname.namespace or "") + "}" + qname.localname + "[" + str(position) + "]"
        path = parent_path + "/" + part
        paths[element] = path
        positions = Counter()
        for child in element:
            if isinstance(child.tag, str):
                positions[child.tag] += 1
                visit(child, path, positions[child.tag])
    visit(root, "", 1)
    return paths

def normalized_id(value):
    """xs:ID/IDREF have collapse whitespace; keep their literal source separately."""
    return _XML_SPACE.sub(" ", value).strip(" ")

def semantic_nodes(root, catalogue):
    if root.tag != Q + "BuildingSync":
        return {}
    found = {root: "root"}
    for location in catalogue["entityLocations"]:
        for element in root.getroottree().xpath(location["xpath"], namespaces={"auc": NAMESPACE}):
            if native(element):
                found[element] = location["kind"]
    return found

def native_system_scope(element):
    """The schema's System assemblies include native plants and deliveries."""
    for node in [element, *element.iterancestors()]:
        if not native(node) or local(node) != "Systems":
            continue
        chain = []
        cursor = node
        while cursor is not None:
            chain.append(local(cursor) if native(cursor) else "")
            cursor = cursor.getparent()
        if chain == ["Systems", "Facility", "Facilities", "BuildingSync"]:
            return True
    return False

def reference_kind_matches(target, hint):
    if not native(target):
        return False
    if hint == "***System":
        # The original 2.7 L200 source links both CoolingPlant and Delivery
        # through LinkedSystemID. These are ID-bearing system components,
        # within the native Facility/Systems assembly, not separate buildings.
        return native_system_scope(target)
    if local(target) == hint:
        return True
    if hint in {"Window", "Door", "Skylight"} and local(target) == "FenestrationSystem":
        # In 2.7 the required ID belongs to FenestrationSystem. Its actual
        # FenestrationType choice identifies Window/Door/Skylight; those
        # inline choice objects do not declare their own ID attribute.
        choice = target.find(Q + "FenestrationType")
        members = [child for child in choice if native(child)] if choice is not None else []
        return native_system_scope(target) and len(members) == 1 and local(members[0]) == hint
    return False

def empty_model():
    return {"entities": [], "fields": [], "references": [], "timeSeries": [], "diagnostics": [],
            "declaredVersion": "", "rootNamespace": "", "encoding": "", "counts": {
                "entities": 0, "facilities": 0, "buildings": 0, "systems": 0,
                "measures": 0, "scenarios": 0, "resources": 0, "timeSeries": 0}}

def inspect_xml(raw, source_id):
    require(isinstance(raw, bytes), "invalid_xml", "The native source must be complete bytes")
    text(source_id, "sourceId", blank=False)
    result = empty_model()
    source_parser = parser()
    try:
        tree = etree.parse(io.BytesIO(raw), source_parser)
    except etree.XMLSyntaxError:
        result["diagnostics"] = [diagnostic("xml_syntax", entry.message, sourceId=source_id,
                                           line=entry.line, column=entry.column, nativeType=entry.type_name)
                                 for entry in source_parser.error_log]
        return result, None, {}
    root = tree.getroot()
    if tree.docinfo.doctype or any(isinstance(node, etree._Entity) for node in root.iter()):
        result["diagnostics"].append(diagnostic("xml_dtd",
            "DTD and entity declarations are retained as source but cannot enter an editable XML tree",
            sourceId=source_id))
        return result, None, {}
    result["declaredVersion"] = root.get("version", "")
    result["rootNamespace"] = etree.QName(root).namespace or ""
    result["encoding"] = tree.docinfo.encoding or "UTF-8"
    if root.tag != Q + "BuildingSync":
        result["diagnostics"].append(diagnostic("xml_standard",
            "The source root is not BuildingSync in its declared native namespace", path="/", sourceId=source_id))
    catalogue = asset_catalog()
    paths = structural_paths(root)
    elements = list(paths)
    semantic = semantic_nodes(root, catalogue)
    # Preserve every source ID-bearing object for inspection, including foreign
    # extension data. Only native IDs participate in the BuildingSync graph.
    entity_nodes = [element for element in elements
                    if element is root or element in semantic or element.get("ID") is not None]
    by_node = {}
    for element in entity_nodes:
        path = paths[element]
        label = next((scalar(element, name) for name in (
            "PremisesName", "SystemName", "MeasureName", "ReportName", "ScenarioName",
            "ContactName", "UtilityName", "EquipmentName", "Name", "Description")
            if native(element) and scalar(element, name).strip()), "")
        identity = element.get("ID", "")
        row = {"key": "node-" + key(source_id, path)[:32], "kind": local(element),
               "xmlId": identity, "normalizedXmlId": normalized_id(identity) if native(element) else "",
               "path": path, "label": label or identity or local(element),
               "namespace": etree.QName(element).namespace or "", "semanticKind": semantic.get(element, ""),
               "nativeIdentity": native(element) and element.get("ID") is not None,
               "facilityKeys": [], "buildingKeys": [], "fieldKeys": [], "parentKey": None,
               "buildingAssociation": {"mode": "unassigned", "fromKey": None, "references": []},
               "line": element.sourceline}
        by_node[element] = row
        result["entities"].append(row)
    def owner(element):
        while element is not None and element not in by_node:
            element = element.getparent()
        return by_node.get(element)
    ids = defaultdict(list)
    for element in elements:
        if native(element) and element.get("ID") is not None:
            ids[normalized_id(element.get("ID"))].append(element)
    for identity, targets in ids.items():
        if len(targets) > 1:
            for target in targets:
                result["diagnostics"].append(diagnostic("duplicate_id",
                    "The native ID has more than one target in this source", sourceId=source_id,
                    path=paths[target], xmlId=target.get("ID"), normalizedXmlId=identity,
                    targetKeys=[by_node[item]["key"] for item in targets], line=target.sourceline))
    containment_buildings = {}
    for element in entity_nodes:
        row = by_node[element]
        parent = owner(element.getparent())
        row["parentKey"] = parent["key"] if parent else None
        building_keys = []
        for ancestor in [element, *element.iterancestors()]:
            if ancestor in by_node:
                if semantic.get(ancestor) == "facility":
                    row["facilityKeys"].append(by_node[ancestor]["key"])
                if semantic.get(ancestor) == "building":
                    building_keys.append(by_node[ancestor]["key"])
        containment_buildings[element] = building_keys
    annotations = {entry["referenceLocalName"]: entry for entry in catalogue["referenceAnnotations"]}
    references = []
    for element in elements:
        row_owner = owner(element)
        for name, value in element.attrib.items():
            field = {"key": "field-" + key(source_id, paths[element], "attribute", name)[:32],
                     "entityKey": row_owner["key"], "path": paths[element], "kind": "attribute",
                     "attributeName": name, "name": "@" + name, "value": value, "editable": True,
                     "namespace": etree.QName(element).namespace or ""}
            result["fields"].append(field)
            row_owner["fieldKeys"].append(field["key"])
            if name == "IDref" and native(element):
                normalized = normalized_id(value)
                targets = ids.get(normalized, [])
                annotation = annotations.get(local(element))
                relation = {"fromKey": row_owner["key"], "path": paths[element] + "/@IDref",
                            "targetXmlId": value, "normalizedTargetXmlId": normalized,
                            "targetKey": by_node[targets[0]]["key"] if len(targets) == 1 else None,
                            "targetKeys": [by_node[t]["key"] for t in targets],
                            "resolution": "resolved" if len(targets) == 1 else ("missing" if not targets else "ambiguous"),
                            "referenceType": local(element), "attributes": dict(element.attrib),
                            "sourceId": source_id, "annotation": copy.deepcopy(annotation),
                            "targetKindValid": None, "targetKindInterpretation": None}
                if annotation and len(targets) == 1:
                    relation["targetKindValid"] = reference_kind_matches(targets[0], annotation["targetKindHint"])
                    if relation["targetKindValid"] and local(targets[0]) != annotation["targetKindHint"]:
                        relation["targetKindInterpretation"] = {
                            "schemaFile": "schema-buildingsync-2.7.0.xsd",
                            "rule": "native-system-component" if annotation["targetKindHint"] == "***System" else "fenestration-choice",
                            "nativeTargetKind": local(targets[0]), "documentedKind": annotation["targetKindHint"]}
                    if not relation["targetKindValid"]:
                        result["diagnostics"].append(diagnostic("reference_target_kind",
                            "The native reference resolves to a different kind than its published linking annotation",
                            sourceId=source_id, path=relation["path"], line=element.sourceline,
                            targetXmlId=value, targetKey=relation["targetKey"],
                            expectedTargetKind=annotation["targetKindHint"],
                            actualTargetKind=local(targets[0]), actualTargetNamespace=etree.QName(targets[0]).namespace,
                            sourcePathHint=annotation["sourcePathHint"], annotationFile="schema-linking-elements.md"))
                references.append((element, targets, relation))
                result["references"].append(relation)
                if len(targets) != 1:
                    result["diagnostics"].append(diagnostic("reference_" + relation["resolution"],
                        "The source-local reference " + value + " is " + relation["resolution"],
                        sourceId=source_id, path=relation["path"], line=element.sourceline,
                        targetXmlId=value, targetKeys=relation["targetKeys"]))
        child_elements = [child for child in element if isinstance(child.tag, str)]
        if not child_elements or (element.text is not None and element.text.strip()):
            field = {"key": "field-" + key(source_id, paths[element], "text")[:32],
                     "entityKey": row_owner["key"], "path": paths[element], "kind": "text",
                     "name": local(element), "value": element.text if element.text is not None else "",
                     "namespace": etree.QName(element).namespace or "",
                     "presentText": element.text is not None, "editable": not child_elements}
            result["fields"].append(field)
            row_owner["fieldKeys"].append(field["key"])
    # Expand only explicit native premises links. Ordinary references and a
    # Facility's mere containment of several Buildings never imply allocation.
    explicit = defaultdict(list)
    explicit_present = set()
    premise_names = {"LinkedBuildingID", "LinkedSectionID", "LinkedThermalZoneID",
                     "LinkedSpaceID", "LinkedSiteID", "LinkedFacilityID"}
    premise_kinds = {"building", "section", "thermal-zone", "space", "site", "facility"}
    for element, targets, relation in references:
        if local(element) not in premise_names:
            continue
        linked = next((ancestor for ancestor in element.iterancestors()
                       if native(ancestor) and local(ancestor) == "LinkedPremises"), None)
        if linked is None:
            continue
        linked_owner = owner(linked.getparent())
        if linked_owner is None:
            continue
        explicit_present.add(linked_owner["key"])
        target_buildings = []
        if len(targets) == 1 and relation["targetKindValid"] is not False:
            target = targets[0]
            target_kind = semantic.get(target)
            if target_kind in premise_kinds:
                if target_kind in {"site", "facility"}:
                    target_buildings = [by_node[node]["key"] for node in target.iterdescendants()
                                        if semantic.get(node) == "building"]
                else:
                    target_buildings = containment_buildings.get(target, [])
        explicit[linked_owner["key"]].append({"path": relation["path"],
            "referenceType": relation["referenceType"], "targetXmlId": relation["targetXmlId"],
            "targetKeys": relation["targetKeys"], "resolution": relation["resolution"],
            "buildingKeys": list(target_buildings)})
    for element in entity_nodes:
        row = by_node[element]
        if row["key"] in explicit_present:
            links = explicit[row["key"]]
            row["buildingKeys"] = list(dict.fromkeys(k for item in links for k in item["buildingKeys"]))
            row["buildingAssociation"] = {"mode": "explicit", "fromKey": row["key"], "references": links}
        elif containment_buildings[element]:
            row["buildingKeys"] = list(containment_buildings[element])
            row["buildingAssociation"] = {"mode": "containment", "fromKey": row["buildingKeys"][0], "references": []}
        else:
            parent = owner(element.getparent())
            if parent and parent["buildingAssociation"]["mode"] != "unassigned":
                row["buildingKeys"] = list(parent["buildingKeys"])
                row["buildingAssociation"] = {"mode": "inherited", "fromKey": parent["key"],
                                              "references": copy.deepcopy(parent["buildingAssociation"]["references"])}
    def ancestor_entity(element, kind):
        for ancestor in [element, *element.iterancestors()]:
            if semantic.get(ancestor) == kind:
                return by_node[ancestor]
        return None
    def resolved(element, reference_name, semantic_kind):
        links = element.findall(Q + reference_name)
        literal = links[0].get("IDref", "") if len(links) == 1 else ""
        candidates = ids.get(normalized_id(literal), []) if links else []
        selected = candidates[0] if len(candidates) == 1 and semantic.get(candidates[0]) == semantic_kind else None
        return links, literal, candidates, selected
    for element in entity_nodes:
        if semantic.get(element) != "time-series":
            continue
        resource_ids, literal, resource_candidates, resource = resolved(element, "ResourceUseID", "resource-use")
        weather_ids, weather_literal, weather_candidates, weather = resolved(element, "WeatherStationID", "weather-station")
        reading_type = scalar(element, "ReadingType")
        quantity = scalar(element, "TimeSeriesReadingQuantity")
        resource_units = scalar(resource, "ResourceUnits")
        peak_units = scalar(resource, "PeakResourceUnits")
        units, units_path = "", ""
        if resource is not None:
            if quantity not in {"Cost", "Currency"} and reading_type != "Cost":
                if quantity in {"Demand", "Power"} or (not quantity and reading_type == "Peak"):
                    units, units_path = peak_units, paths[resource] + "/Q{" + NAMESPACE + "}PeakResourceUnits[1]"
                elif quantity == "Energy" or (not quantity and reading_type in {"", "Total", "Average", "Median", "Minimum", "Point"}):
                    units, units_path = resource_units, paths[resource] + "/Q{" + NAMESPACE + "}ResourceUnits[1]"
        scenario = ancestor_entity(element, "scenario")
        scenario_buildings = list(scenario["buildingKeys"]) if scenario else []
        resource_buildings = list(by_node[resource]["buildingKeys"]) if resource is not None else []
        reading_buildings = list(by_node[element]["buildingKeys"])
        scope_state = "associated" if reading_buildings or resource_buildings else "unassigned"
        if reading_buildings and resource_buildings:
            overlap = [k for k in reading_buildings if k in resource_buildings]
            if not overlap:
                scope_state = "conflict"
                result["diagnostics"].append(diagnostic("series_premises_conflict",
                    "The original reading and resource have disjoint explicit building associations",
                    sourceId=source_id, path=paths[element], line=element.sourceline,
                    readingBuildingKeys=reading_buildings, resourceBuildingKeys=resource_buildings))
            reading_buildings = overlap
        elif resource_buildings:
            reading_buildings = resource_buildings
        reading = element.find(Q + "IntervalReading")
        source_value = reading.get(Q + "Source", "") if reading is not None else ""
        resource_state = "absent" if not resource_ids else ("resolved" if resource is not None else
                         ("ambiguous" if len(resource_candidates) > 1 else "invalid"))
        weather_state = "absent" if not weather_ids else ("resolved" if weather is not None else
                        ("ambiguous" if len(weather_candidates) > 1 else "invalid"))
        row = {"key": by_node[element]["key"], "path": paths[element], "entityKey": by_node[element]["key"],
               "xmlId": element.get("ID", ""), "sourceId": source_id,
               "resourceKey": by_node[resource]["key"] if resource is not None else "",
               "resourceXmlId": literal, "resourceKeys": [by_node[item]["key"] for item in resource_candidates],
               "resourceState": resource_state, "energyResource": scalar(resource, "EnergyResource"),
               "resourceUnits": resource_units, "peakResourceUnits": peak_units,
               "readingType": reading_type, "peakType": scalar(element, "PeakType"),
               "units": units, "unitsSourcePath": units_path,
               "start": scalar(element, "StartTimestamp"), "end": scalar(element, "EndTimestamp"),
               "value": scalar(element, "IntervalReading"), "valueSource": source_value,
               "interval": scalar(element, "IntervalFrequency"), "intervalDuration": scalar(element, "IntervalDuration"),
               "quantity": quantity, "intervalDurationUnits": scalar(element, "IntervalDurationUnits"),
               "phase": scalar(element, "Phase"), "flowDirection": scalar(element, "EnergyFlowDirection"),
               "scenarioKey": scenario["key"] if scenario else "",
               "buildingKeys": reading_buildings, "buildingScopeState": scope_state,
               "scenarioBuildingKeys": scenario_buildings, "resourceBuildingKeys": resource_buildings,
               "weatherStationKey": by_node[weather]["key"] if weather is not None else "",
               "weatherStationXmlId": weather_literal, "weatherStationKeys": [by_node[item]["key"] for item in weather_candidates],
               "weatherStationState": weather_state}
        stream_dimensions = {name: row[name] for name in ("scenarioKey", "resourceKey", "weatherStationKey",
            "readingType", "peakType", "units", "quantity", "interval", "intervalDuration",
            "intervalDurationUnits", "phase", "flowDirection")}
        row["streamKey"] = "stream-" + key(source_id, canonical(stream_dimensions))[:32]
        if resource_ids and (len(resource_ids) != 1 or resource is None):
            result["diagnostics"].append(diagnostic("series_resource",
                "The supplied reading link does not resolve to one original ResourceUse",
                sourceId=source_id, path=paths[element], line=element.sourceline,
                targetXmlId=literal, targetKeys=row["resourceKeys"]))
        if weather_ids and (len(weather_ids) != 1 or weather is None):
            result["diagnostics"].append(diagnostic("series_weather",
                "The supplied reading link does not resolve to one original WeatherStation",
                sourceId=source_id, path=paths[element], line=element.sourceline,
                targetXmlId=weather_literal, targetKeys=row["weatherStationKeys"]))
        result["timeSeries"].append(row)
    counts = Counter(semantic.values())
    result["counts"] = {"entities": len(entity_nodes), "facilities": counts["facility"], "buildings": counts["building"],
                        "systems": counts["system"], "measures": counts["measure"], "scenarios": counts["scenario"],
                        "resources": counts["resource-use"], "timeSeries": len(result["timeSeries"])}
    return result, tree, {path: element for element, path in paths.items()}

def native_log(log, code, source_id=None):
    return [diagnostic(code, item.message, sourceId=source_id, line=item.line, column=item.column,
                       path=item.path, nativeDomain=item.domain_name, nativeType=item.type_name)
            for item in log]

def validate_document(raw, source_id, selected_schema="2.7.0", profile_ids=()):
    require(selected_schema == "2.7.0", "unknown_schema", "Select the delivered 2.7.0 schema")
    require(isinstance(profile_ids, (list, tuple)) and all(isinstance(p, str) for p in profile_ids),
            "invalid_profiles", "Select profile identifiers from the retained catalogue")
    require(len(set(profile_ids)) == len(profile_ids), "invalid_profiles", "Select each official profile at most once")
    catalogue = asset_catalog()
    rules = {row["id"]: row for row in catalogue["useCases"]}
    require(all(p in rules for p in profile_ids), "unknown_profile", "A selected official validation profile is unavailable")
    started = now()
    model, tree, nodes = inspect_xml(raw, source_id)
    report = {"sourceSha256": digest(raw), "selectedSchema": selected_schema, "declaredVersion": model["declaredVersion"],
              "engines": engine_info(), "startedAt": started, "wellFormed": tree is not None,
              "xsd": {"valid": False, "diagnostics": []}, "profiles": [],
              "references": {"valid": not any(d["severity"] == "error" for d in model["diagnostics"]),
                             "diagnostics": model["diagnostics"]}}
    if tree is None:
        report["xsd"]["diagnostics"] = model["diagnostics"]
        report["profiles"] = [{"id": p, "valid": False, "diagnostics": [diagnostic("xml_unavailable",
            "Correct the native XML syntax before running this profile", sourceId=source_id, profileId=p)]} for p in profile_ids]
    else:
        with _ENGINE_LOCK:
            schema_raw = asset_bytes(catalogue["standard"]["mainSchemaFile"], catalogue)
            dependencies = []
            for entry in catalogue["validation"]["schemaImports"]:
                body = asset_bytes(entry["localFile"], catalogue)
                dependencies.append({"uri": entry["requestedURI"], "file": entry["localFile"], "sha256": digest(body)})
            schema_hash = digest(schema_raw)
            cache_key = "xsd:" + key(schema_hash, canonical(dependencies))
            if cache_key not in _CACHE:
                schema_tree = etree.parse(io.BytesIO(schema_raw), parser(schema=True), base_url="urn:audit-exchange:BuildingSync.xsd")
                _CACHE[cache_key] = etree.XMLSchema(schema_tree)
            schema = _CACHE[cache_key]
            report["xsd"] = {"valid": bool(schema.validate(tree)), "diagnostics": native_log(schema.error_log, "xsd", source_id),
                             "schemaSha256": schema_hash, "resolvedDependencies": dependencies}
            for profile_id in profile_ids:
                rule = rules[profile_id]
                rule_raw = asset_bytes(rule["file"], catalogue)
                rule_hash = digest(rule_raw)
                cache_key = "rule:" + key(profile_id, rule_hash, "#ALL")
                if cache_key not in _CACHE:
                    rule_tree = etree.parse(io.BytesIO(rule_raw), parser())
                    _CACHE[cache_key] = isoschematron.Schematron(rule_tree, phase="#ALL", store_report=True, validate_schema=False)
                validator = _CACHE[cache_key]
                native_valid = bool(validator.validate(tree))
                svrl = copy.deepcopy(validator.validation_report)
                findings = []
                for failure in svrl.iter():
                    if failure.tag not in {SVRL + "failed-assert", SVRL + "successful-report"}:
                        continue
                    original_role = failure.get("role", "ERROR")
                    role = original_role.upper()
                    message = "".join(failure.itertext()).strip()
                    findings.append(diagnostic("schematron", message, path=failure.get("location", ""),
                        severity={"ERROR": "error", "WARNING": "warning", "INFO": "info"}.get(role, "error"),
                        role=original_role, profileId=profile_id, sourceId=source_id,
                        nativeOutcome=local(failure), test=failure.get("test", ""), ruleId=failure.get("id", "")))
                report["profiles"].append({"id": profile_id, "valid": not any(x["severity"] == "error" for x in findings),
                    "engineDefaultValid": native_valid, "phase": "#ALL", "ruleVersion": rule["version"],
                    "schemaVersion": rule["schemaVersion"], "ruleSha256": rule_hash, "diagnostics": findings,
                    "svrl": etree.tostring(svrl, encoding="unicode")})
    report["endedAt"] = now()
    return model, report

def patch_document(raw, source_id, patches):
    require(isinstance(patches, list) and patches, "invalid_patch", "Select at least one original field to correct")
    model, tree, nodes = inspect_xml(raw, source_id)
    require(tree is not None, "xml_unavailable", "Replace malformed XML with a complete corrected source before field editing")
    fields = {(f["path"], f["kind"], f.get("attributeName")): f for f in model["fields"] if f["editable"]}
    selected = set()
    for patch in patches:
        require(isinstance(patch, dict), "invalid_patch", "Every correction must be an object")
        text(patch.get("path"), "path", blank=False)
        require(patch.get("kind") in ("text", "attribute"), "invalid_patch", "Select a native text or attribute field")
        require(patch.get("attributeName") is None or isinstance(patch.get("attributeName"), str),
                "invalid_patch", "The native attribute identity must be a string")
        identity = (patch.get("path"), patch.get("kind"), patch.get("attributeName"))
        require(identity in fields and identity not in selected, "invalid_patch", "A correction does not identify one editable original field")
        selected.add(identity)
        expected = text(patch.get("expected"), "expected")
        value = text(patch.get("value"), "value")
        require(expected == fields[identity]["value"], "field_changed", "The original field has changed", {"path": identity[0]}, 409)
        # XML 1.0 permits tab, LF, CR and the standard scalar ranges.
        require(all(c in "\t\n\r" or 0x20 <= ord(c) <= 0xD7FF or 0xE000 <= ord(c) <= 0xFFFD or 0x10000 <= ord(c) <= 0x10FFFF for c in value),
                "invalid_xml_character", "The replacement contains a character excluded by XML 1.0")
    changed = False
    for patch in patches:
        element = nodes[patch["path"]]
        if patch["value"] == patch["expected"]:
            continue
        changed = True
        if patch["kind"] == "attribute":
            element.set(patch["attributeName"], patch["value"])
        else:
            element.text = patch["value"]
    if not changed:
        return raw
    return etree.tostring(tree, encoding="UTF-8", xml_declaration=True, pretty_print=False)

def compare_models(before, after):
    old = {f["key"]: f for f in before["fields"]}
    new = {f["key"]: f for f in after["fields"]}
    added = [new[k] for k in new.keys() - old.keys()]
    removed = [old[k] for k in old.keys() - new.keys()]
    changed = [{"key": k, "before": old[k], "after": new[k]} for k in old.keys() & new.keys()
               if old[k]["value"] != new[k]["value"] or old[k].get("presentText") != new[k].get("presentText")]
    for rows in (added, removed, changed):
        rows.sort(key=lambda row: row.get("path", row.get("after", {}).get("path", "")))
    refs_old = {canonical(r): r for r in before["references"]}
    refs_new = {canonical(r): r for r in after["references"]}
    reference_changes = [{"kind": "removed", "reference": refs_old[k]} for k in refs_old.keys() - refs_new.keys()] + [
        {"kind": "added", "reference": refs_new[k]} for k in refs_new.keys() - refs_old.keys()]
    reference_changes.sort(key=lambda row: (row["kind"], row["reference"]["path"], canonical(row["reference"])))
    return {"added": added, "removed": removed, "changed": changed, "referenceChanges": reference_changes,
            "counts": {"added": len(added), "removed": len(removed), "changed": len(changed), "referenceChanges": len(reference_changes)}}

def analysis_selection(detail, inputs):
    model = detail["model"]
    entities = {entity["key"]: entity for entity in model["entities"]}
    chosen = {}
    for argument, kind in (("buildingKey", "Building"), ("scenarioKey", "Scenario"), ("resourceKey", "ResourceUse")):
        identity = text(inputs.get(argument), argument, blank=False)
        require(identity in entities and entities[identity]["kind"] == kind and entities[identity].get("namespace") == NAMESPACE
                and entities[identity].get("semanticKind") in {"building", "scenario", "resource-use"}, "invalid_analysis_selection", "Select an original " + kind)
        chosen[argument] = entities[identity]
    reading_type = text(inputs.get("readingType", ""), "readingType")
    units = text(inputs.get("units", ""), "units")
    stream_key = text(inputs.get("streamKey", ""), "streamKey")
    readings = [r for r in model["timeSeries"] if r["scenarioKey"] == inputs["scenarioKey"] and r["resourceKey"] == inputs["resourceKey"]
                and r["readingType"] == reading_type and r["units"] == units]
    if stream_key:
        readings = [r for r in readings if r.get("streamKey") == stream_key]
    require(readings, "empty_analysis_selection", "No original readings match all selected source dimensions")
    findings = []
    if any(r["buildingKeys"] and inputs["buildingKey"] not in r["buildingKeys"] for r in readings):
        findings.append(diagnostic("analysis_building", "The selected original scenario explicitly serves other building identities"))
    signatures = {(r["quantity"], r["interval"], r.get("intervalDuration", ""), r["intervalDurationUnits"],
                   r.get("peakType", ""), r["phase"], r["flowDirection"], r.get("weatherStationKey", "")) for r in readings}
    if any(r.get("buildingScopeState") == "conflict" for r in readings):
        findings.append(diagnostic("analysis_building_conflict", "The original reading and resource identify disjoint building scopes"))
    if not set(chosen["buildingKey"]["facilityKeys"]) & set(chosen["scenarioKey"]["facilityKeys"]):
        findings.append(diagnostic("analysis_facility", "The selected building and scenario belong to different original facilities"))
    if len(signatures) != 1:
        findings.append(diagnostic("analysis_mixed_stream", "The selection contains distinct quantity, interval, phase or flow-direction streams"))
    if len(readings) < 12:
        findings.append(diagnostic("analysis_month_count", "The selected stream has fewer than twelve original readings", severity="warning"))
    if not reading_type or not units:
        findings.append(diagnostic("analysis_missing_semantics", "The original reading type or unit is absent; supply an explicit reviewed native interpretation before model execution"))
    if reading_type != "Total" or any(r["quantity"] not in ("", "Energy") for r in readings):
        findings.append(diagnostic("analysis_non_energy_total", "The selected stream is not an explicitly declared Total energy series"))
    def value(entity, field):
        candidates = [f["value"] for f in model["fields"] if f["entityKey"] == entity["key"] and f["kind"] == "text" and f["name"] == field
                      and f.get("namespace") == NAMESPACE]
        return candidates[0] if len(candidates) == 1 else ""
    building = {**chosen["buildingKey"], "latitude": value(chosen["buildingKey"], "Latitude"), "longitude": value(chosen["buildingKey"], "Longitude")}
    resource = {**chosen["resourceKey"], "energyResource": value(chosen["resourceKey"], "EnergyResource"),
                "resourceUnits": value(chosen["resourceKey"], "ResourceUnits"), "peakResourceUnits": value(chosen["resourceKey"], "PeakResourceUnits")}
    selection = {"sourceId": detail["source"]["id"], "revisionId": detail["revision"]["id"],
                 "sourceSha256": detail["revision"]["sha256"], "building": building, "scenario": chosen["scenarioKey"],
                 "resource": resource, "readingType": reading_type, "units": units, "readings": readings,
                 "streamKey": readings[0].get("streamKey", "") if len({r.get("streamKey", "") for r in readings}) == 1 else "",
                 "selectedStreamKey": stream_key}
    selection["selectionSha256"] = digest(canonical(selection).encode())
    return {"selection": selection, "readings": readings, "diagnostics": findings,
            "nativeProfile": {"processor": "nmecr", "requiresWeather": True, "selectionSha256": selection["selectionSha256"]}}


