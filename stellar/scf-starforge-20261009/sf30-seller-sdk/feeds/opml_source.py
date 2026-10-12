"""MIT. OPML 1.0/1.1/2.0 subscription outlines over the maintained XML parser."""
from __future__ import annotations
import io
from xml.etree import ElementTree as ET
from original import InputError, parser, parse_stream, expanded, MAX_DEPTH, Node, digest
from feed_source import children, one, txt

MAX_OPML_BYTES = 16 * 1024 * 1024
MAX_OUTLINES = 10000
SCHEMA = "stellar-forge.feed-subscription-source.v1"

def parse_opml(data, validate_url):
    if not isinstance(data, bytes) or not data or len(data) > MAX_OPML_BYTES:
        raise InputError("Choose an original OPML document from 1 byte to 16 MiB")
    p, stack, root, count = parser(), [], None, 0
    def start(name, attributes):
        nonlocal root, count
        count += 1
        if count > MAX_OUTLINES * 2 or len(stack) >= MAX_DEPTH or len(attributes) > 256:
            raise InputError("OPML exceeds this workspace's supported outline shape")
        node = Node(expanded(name), {expanded(k): v for k, v in attributes.items()})
        if stack:
            stack[-1].children.append(node); stack[-1].content.append(node)
        else:
            root = node
        stack.append(node)
    def text(value):
        if stack: stack[-1].content.append(value)
    p.StartElementHandler, p.EndElementHandler, p.CharacterDataHandler = start, lambda _: stack.pop(), text
    parse_stream(p, io.BytesIO(data))
    if root is None or root.name != "opml" or root.attrs.get("version") not in ("1.0", "1.1", "2.0"):
        raise InputError("Choose an OPML document with unnamespaced core elements and version 1.0, 1.1 or 2.0")
    head, body = one(root, "head", True), one(root, "body", True)
    head_values = {}
    for node in head.children:
        if node.name in head_values:
            raise InputError("OPML head repeats " + node.name)
        head_values[node.name] = txt(node)
    entries, outlines = [], 0
    def outline(node, path, folders, inherited_comment=False):
        nonlocal outlines
        outlines += 1
        if outlines > MAX_OUTLINES or "text" not in node.attrs:
            raise InputError("Every OPML outline needs text; at most 10,000 outlines are supported")
        attrs, ident = dict(node.attrs), ".".join(map(str, path))
        for flag in ("isComment", "isBreakpoint"):
            if flag in attrs and attrs[flag] not in ("true", "false"):
                raise InputError("OPML " + flag + " must be true or false")
        commented = inherited_comment or attrs.get("isComment") == "true"
        kind, label = attrs.get("type", "").lower(), attrs["text"]
        row = {"entryId": ident, "attributes": attrs, "children": []}
        if kind == "rss":
            error, url = None, attrs.get("xmlUrl")
            try: validate_url(url)
            except (ValueError, InputError) as problem: error = str(problem)
            entries.append({"entryId": ident, "label": label, "url": url, "folders": folders,
                            "attributes": attrs, "commented": commented, "error": error})
        row["children"] = [outline(c, path + [i + 1], folders + [label], commented)
                           for i, c in enumerate(children(node, "outline"))]
        return row
    tree = [outline(n, [i + 1], []) for i, n in enumerate(children(body, "outline"))]
    if not tree:
        raise InputError("OPML body needs at least one outline")
    return {"schema": SCHEMA, "sourceId": digest(data), "bytes": len(data),
            "version": root.attrs["version"], "head": head_values, "tree": tree, "entries": entries,
            "outlineCount": outlines}

def selected_opml(collection, documents):
    """Produce the selected subscription list; exact input originals are separate files."""
    root = ET.Element("opml", {"version": "2.0"})
    head = ET.SubElement(root, "head")
    ET.SubElement(head, "title").text = collection["title"]
    ET.SubElement(head, "docs").text = "https://opml.org/spec2.opml"
    body = ET.SubElement(root, "body")
    selected = {(m["sourceId"], m["entryId"]) for m in collection["members"]
                if m["enabled"] and m["sourceId"]}
    def copy_node(node, source_id):
        kids = [n for child in node["children"] if (n := copy_node(child, source_id)) is not None]
        chosen = (source_id, node["entryId"]) in selected
        if not chosen and not kids: return None
        attrs = dict(node["attributes"])
        if not chosen:
            attrs = {"text": attrs["text"]}
        # An explicitly selected commented subscription becomes active in this export.
        attrs.pop("isComment", None)
        result = ET.Element("outline", attrs)
        for child in kids: result.append(child)
        return result
    used = [s for s in collection["sources"] if any(key[0] == s for key in selected)]
    for source_id in used:
        doc = documents[source_id]
        target = body if len(used) == 1 else ET.SubElement(body, "outline", {
            "text": doc["head"].get("title") or source_id[:16]})
        for node in doc["tree"]:
            result = copy_node(node, source_id)
            if result is not None: target.append(result)
    configs = {f["id"]: f["config"] for f in collection["feeds"]}
    for member in collection["members"]:
        if member["enabled"] and not member["sourceId"]:
            config = configs[member["feedId"]]
            ET.SubElement(body, "outline", {"text": config["label"], "title": config["label"],
                                          "type": "rss", "xmlUrl": config["url"]})
    if not list(body):
        raise InputError("Select at least one subscription for OPML export")
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)
