#!/usr/bin/env python3
"""Namespace-aware views of the retained native WMS and SLD responses."""
import io
import json
import sys
import xml.etree.ElementTree as ET

LIMIT = 8 * 1024 * 1024
WMS = "http://www.opengis.net/wms"
SLD = "http://www.opengis.net/sld"
SE = "http://www.opengis.net/se"
WFS = "http://www.opengis.net/wfs/2.0"
XLINK = "{http://www.w3.org/1999/xlink}href"

def require(value, message):
    if not value:
        raise ValueError(message)

def local(tag):
    return tag.rsplit("}", 1)[-1]

def content(node):
    return "" if node is None else "".join(node.itertext()).strip()

def child(node, name, namespace=WMS):
    return node.find("{" + namespace + "}" + name)

def children(node, name, namespace=WMS):
    return node.findall("{" + namespace + "}" + name)

def wms(root):
    require(root.tag == "{" + WMS + "}WMS_Capabilities" and root.get("version") == "1.3.0",
            "Receive the original WMS 1.3.0 capabilities.")
    service = child(root, "Service")
    capability = child(root, "Capability")
    require(service is not None and capability is not None, "The complete WMS service is absent.")
    operations = {}
    request = child(capability, "Request")
    require(request is not None, "The WMS operation inventory is absent.")
    for operation in request:
        name = local(operation.tag)
        require(name not in operations, "Duplicate WMS operation.")
        operations[name] = {
            "formats": [content(value) for value in children(operation, "Format")],
            "get": [value.get(XLINK) for value in operation.findall(
                ".//{" + WMS + "}Get/{" + WMS + "}OnlineResource") if value.get(XLINK)]}
    require("GetCapabilities" in operations and "GetMap" in operations, "The native WMS operations are incomplete.")
    layers = []
    def visit(node, inherited_crs=(), inherited_styles=None, inherited_geo=None):
        crs = list(dict.fromkeys(list(inherited_crs) + [content(value) for value in children(node, "CRS")]))
        styles = dict(inherited_styles or {})
        for style in children(node, "Style"):
            name = content(child(style, "Name"))
            require(name, "A native WMS style is unnamed.")
            styles[name] = {"name": name, "title": content(child(style, "Title")),
                            "abstract": content(child(style, "Abstract")),
                            "legends": [{"format": content(child(legend, "Format")),
                                         "url": child(legend, "OnlineResource").get(XLINK)
                                         if child(legend, "OnlineResource") is not None else None}
                                        for legend in children(style, "LegendURL")]}
        geo = child(node, "EX_GeographicBoundingBox")
        geographic = inherited_geo if geo is None else {
            "west": content(child(geo, "westBoundLongitude")), "east": content(child(geo, "eastBoundLongitude")),
            "south": content(child(geo, "southBoundLatitude")), "north": content(child(geo, "northBoundLatitude"))}
        name = content(child(node, "Name"))
        if name:
            layers.append({"name": name, "title": content(child(node, "Title")),
                           "abstract": content(child(node, "Abstract")),
                           "queryable": node.get("queryable", "0") in ("1", "true"),
                           "crs": crs, "styles": list(styles.values()), "geographicBounds": geographic,
                           "boundingBoxes": [{"crs": value.get("CRS"),
                                              "bounds": [value.get(key) for key in ("minx", "miny", "maxx", "maxy")]}
                                             for value in children(node, "BoundingBox")]})
        for nested in children(node, "Layer"):
            visit(nested, crs, styles, geographic)
    for layer in children(capability, "Layer"):
        visit(layer)
    require(len({layer["name"] for layer in layers}) == len(layers), "Duplicate WMS layer identity.")
    return {"schema": "starforge.geoserver-wms-capabilities.v1", "version": "1.3.0",
            "title": content(child(service, "Title")), "abstract": content(child(service, "Abstract")),
            "operations": operations, "layers": layers}

def style(root):
    require(root.tag == "{" + SLD + "}StyledLayerDescriptor" and root.get("version") in ("1.0.0", "1.1.0"),
            "Select the complete native SLD 1.0 or SLD/SE 1.1 style.")
    names, rules, external = [], [], []
    for node in root.iter():
        name = local(node.tag)
        if name in ("NamedLayer", "UserLayer", "UserStyle", "NamedStyle"):
            names.append({"kind": name, "name": next((content(value) for value in node if local(value.tag) == "Name"), "")})
        if name == "Rule":
            rules.append(next((content(value) for value in node if local(value.tag) == "Name"), ""))
        if node.get(XLINK):
            external.append({"kind": name, "url": node.get(XLINK)})
    require(any(item["kind"] == "UserStyle" for item in names), "The SLD must retain an original user style.")
    return {"schema": "starforge.geoserver-style-source.v1", "version": root.get("version"),
            "format": "sld" if root.get("version") == "1.0.0" else "se",
            "names": names, "rules": rules, "references": external}

def envelope(root):
    result = {"schema": "starforge.geoserver-service-envelope.v1", "root": root.tag,
              "version": root.get("version"), "exceptions": []}
    for node in root.iter():
        if local(node.tag) in ("Exception", "ServiceException"):
            result["exceptions"].append({"code": node.get("exceptionCode") or node.get("code"),
                                         "locator": node.get("locator"), "text": content(node)})
    if root.tag == "{" + WFS + "}WFS_Capabilities":
        require(root.get("version") == "2.0.0", "Select WFS 2.0.0.")
        result["wfsFeatureTypes"] = len(root.findall("{" + WFS + "}FeatureTypeList/{" + WFS + "}FeatureType"))
    return result

def main():
    require(len(sys.argv) == 2 and sys.argv[1] in ("wms", "style", "envelope"), "Choose the retained native XML view.")
    data = sys.stdin.buffer.read(LIMIT + 1)
    require(0 < len(data) <= LIMIT, "Receive the complete XML within eight MiB.")
    require(b"<!DOCTYPE" not in data.upper() and b"<!ENTITY" not in data.upper(),
            "The native XML must not contain a DTD or entity declaration.")
    parser = ET.iterparse(io.BytesIO(data), events=("end",))
    count = 0
    for _, node in parser:
        count += 1
        require(count <= 200000, "The native XML exceeds the complete element allowance.")
    selected = {"wms": wms, "style": style, "envelope": envelope}[sys.argv[1]](parser.root)
    sys.stdout.write(json.dumps(selected, ensure_ascii=False, separators=(",", ":")) + "\n")

if __name__ == "__main__":
    try:
        main()
    except (ValueError, ET.ParseError) as error:
        sys.stderr.write(str(error) + "\n")
        raise SystemExit(2)
