#!/usr/bin/env python3
"""Parse retained WFS2 capabilities and XSD using the standard namespace-aware XML parser."""
import json
import io
import sys
import xml.etree.ElementTree as ET

NS = {"wfs": "http://www.opengis.net/wfs/2.0",
      "ows": "http://www.opengis.net/ows/1.1",
      "xsd": "http://www.w3.org/2001/XMLSchema"}
XLINK = "{http://www.w3.org/1999/xlink}href"
LIMIT = 8 * 1024 * 1024

def require(ok, message):
    if not ok:
        raise ValueError(message)

def text(node, path=None):
    selected = node.find(path, NS) if path else node
    return "" if selected is None else "".join(selected.itertext()).strip()

def texts(node, path):
    return [text(item) for item in node.findall(path, NS) if text(item)]

def capabilities(root):
    require(root.tag == "{" + NS["wfs"] + "}WFS_Capabilities" and root.get("version") == "2.0.0",
            "Select the original WFS 2.0.0 capabilities response.")
    identification = root.find("ows:ServiceIdentification", NS)
    provider = root.find("ows:ServiceProvider", NS)
    operations = {}
    for operation in root.findall("ows:OperationsMetadata/ows:Operation", NS):
        name = operation.get("name")
        require(name and name not in operations, "Duplicate operation in capabilities.")
        operations[name] = {
            "get": [node.get(XLINK) for node in operation.findall("ows:DCP/ows:HTTP/ows:Get", NS) if node.get(XLINK)],
            "post": [node.get(XLINK) for node in operation.findall("ows:DCP/ows:HTTP/ows:Post", NS) if node.get(XLINK)],
            "parameters": {node.get("name"): texts(node, ".//ows:Value")
                           for node in operation.findall("ows:Parameter", NS) if node.get("name")},
        }
    for name in ["GetCapabilities", "DescribeFeatureType", "GetFeature"]:
        require(name in operations, "The service must advertise " + name + ".")
    feature_types = []
    seen = set()
    for feature in root.findall("wfs:FeatureTypeList/wfs:FeatureType", NS):
        name = text(feature, "wfs:Name")
        require(name and name not in seen, "Feature types must have unique qualified names.")
        seen.add(name)
        box = feature.find("ows:WGS84BoundingBox", NS)
        feature_types.append({
            "name": name, "title": text(feature, "wfs:Title"), "abstract": text(feature, "wfs:Abstract"),
            "defaultCrs": text(feature, "wfs:DefaultCRS"), "otherCrs": texts(feature, "wfs:OtherCRS"),
            "outputFormats": texts(feature, "wfs:OutputFormats/wfs:Format"),
            "keywords": texts(feature, "ows:Keywords/ows:Keyword"),
            "wgs84Bounds": None if box is None else {
                "lower": text(box, "ows:LowerCorner").split(),
                "upper": text(box, "ows:UpperCorner").split()},
            "metadata": [{"url": node.get(XLINK), "about": node.get("about")}
                         for node in feature.findall("wfs:MetadataURL", NS)],
        })
    require(feature_types, "The complete capabilities response has no feature types.")
    return {
        "schema": "stellar-forge.wfs-capabilities.v1", "version": "2.0.0",
        "title": text(identification, "ows:Title") if identification is not None else "",
        "abstract": text(identification, "ows:Abstract") if identification is not None else "",
        "fees": text(identification, "ows:Fees") if identification is not None else "",
        "accessConstraints": texts(identification, "ows:AccessConstraints") if identification is not None else [],
        "provider": text(provider, "ows:ProviderName") if provider is not None else "",
        "operations": operations, "featureTypes": feature_types,
        "constraints": {node.get("name"): texts(node, ".//ows:DefaultValue") + texts(node, ".//ows:Value")
                        for node in root.findall("ows:OperationsMetadata/ows:Constraint", NS) if node.get("name")},
    }

def feature_schema(root, namespaces):
    require(root.tag == "{" + NS["xsd"] + "}schema", "DescribeFeatureType must return the original XML Schema.")
    complex_types = {node.get("name"): node for node in root.findall("xsd:complexType", NS) if node.get("name")}
    def complex_type(qname):
        parts = qname.split(":", 1)
        prefix, local = parts if len(parts) == 2 else ("", parts[0])
        return complex_types.get(local) if namespaces.get(prefix) == root.get("targetNamespace") else None
    def group_elements(group):
        for child in group:
            if child.tag == "{" + NS["xsd"] + "}element":
                yield child
            elif child.tag in {"{" + NS["xsd"] + "}" + name for name in ("sequence", "choice", "all")}:
                yield from group_elements(child)
    def properties(node, trail=()):
        values = []
        extension = node.find("xsd:complexContent/xsd:extension", NS)
        if extension is not None:
            base = extension.get("base") or ""
            require(base not in trail and len(trail) < 32, "Recursive schema extension is unsupported.")
            inherited = complex_type(base)
            if inherited is not None:
                values.extend(properties(inherited, trail + (base,)))
        groups = [child for owner in (node, extension) if owner is not None for child in owner
                  if child.tag in {"{" + NS["xsd"] + "}" + name for name in ("sequence", "choice", "all")}]
        for element in (item for group in groups for item in group_elements(group)):
            name = element.get("name") or element.get("ref")
            require(name, "Schema property has no name or reference.")
            kind = element.get("type", "")
            values.append({
                "name": name, "type": kind, "reference": element.get("ref"),
                "nillable": element.get("nillable", "false") == "true",
                "minOccurs": element.get("minOccurs", "1"),
                "maxOccurs": element.get("maxOccurs", "1"),
                "geometry": namespaces.get(kind.split(":", 1)[0]) in ("http://www.opengis.net/gml", "http://www.opengis.net/gml/3.2") and ("PropertyType" in kind or "Geometry" in kind),
                "documentation": texts(element, "xsd:annotation/xsd:documentation"),
            })
        require(len({row["name"] for row in values}) == len(values), "The selected schema has duplicate property names.")
        return values
    features = []
    for element in root.findall("xsd:element", NS):
        name, kind = element.get("name"), element.get("type", "")
        node = complex_type(kind)
        if node is None:
            node = element.find("xsd:complexType", NS)
        features.append({
            "name": name, "type": kind, "substitutionGroup": element.get("substitutionGroup"),
            "properties": properties(node) if node is not None else [],
            "complexTypeResolved": node is not None,
        })
    require(features, "The complete source schema has no feature declarations.")
    return {
        "schema": "stellar-forge.wfs-feature-schema.v1",
        "targetNamespace": root.get("targetNamespace"), "features": features,
        "imports": [{"namespace": node.get("namespace"), "schemaLocation": node.get("schemaLocation")}
                    for node in root.findall("xsd:import", NS)],
    }

def main():
    require(len(sys.argv) == 2 and sys.argv[1] in ("capabilities", "schema"), "Choose capabilities or schema.")
    data = sys.stdin.buffer.read(LIMIT + 1)
    require(0 < len(data) <= LIMIT, "Use a complete XML response within the eight MiB document limit.")
    # External schemas remain documented references. No entities, DTD retrieval, or network resolution.
    upper = data.upper()
    require(b"<!DOCTYPE" not in upper and b"<!ENTITY" not in upper, "XML entities and document type declarations are unsupported.")
    namespaces, count = {}, 0
    parser = ET.iterparse(io.BytesIO(data), events=("start-ns", "end"))
    for event, item in parser:
        if event == "start-ns":
            prefix, uri = item
            require(prefix not in namespaces or namespaces[prefix] == uri,
                    "This schema rebinds a namespace prefix; select its resolved simple-feature schema.")
            namespaces[prefix] = uri
        else:
            count += 1
            require(count <= 200000, "The schema exceeds the supported element inventory.")
    root = parser.root
    result = capabilities(root) if sys.argv[1] == "capabilities" else feature_schema(root, namespaces)
    result["namespaces"] = namespaces
    sys.stdout.write(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n")

if __name__ == "__main__":
    try:
        main()
    except (ValueError, ET.ParseError) as error:
        sys.stderr.write(str(error) + "\n")
        raise SystemExit(2)
