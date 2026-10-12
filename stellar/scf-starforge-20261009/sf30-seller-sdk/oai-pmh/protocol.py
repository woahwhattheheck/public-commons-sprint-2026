"""MIT. OAI-PMH 2.0 protocol over the original hardened streaming XML parser."""
from __future__ import annotations
from datetime import datetime
import re
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode
from bridge import xml, InputError

NS = "http://www.openarchives.org/OAI/2.0/"
Q = lambda name: "{" + NS + "}" + name
VERBS = {"Identify", "ListMetadataFormats", "ListSets", "GetRecord", "ListIdentifiers", "ListRecords"}
ERRORS = {"badArgument", "badResumptionToken", "badVerb", "cannotDisseminateFormat",
          "idDoesNotExist", "noRecordsMatch", "noMetadataFormats", "noSetHierarchy"}
DATE = re.compile(r"\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}Z)?\Z")
RESERVED = {"verb", "identifier", "metadataPrefix", "from", "until", "set", "resumptionToken"}

def date(value, seconds=False):
    if not isinstance(value, str) or not DATE.fullmatch(value) or seconds and len(value) != 20:
        raise InputError("Use an OAI date YYYY-MM-DD or UTC timestamp YYYY-MM-DDThh:mm:ssZ")
    try:
        datetime.strptime(value, "%Y-%m-%d" if len(value) == 10 else "%Y-%m-%dT%H:%M:%SZ")
    except ValueError as e:
        raise InputError("Invalid OAI calendar date") from e
    return value

def base_url(value):
    if not isinstance(value, str) or len(value) > 4096 or any(ord(c) < 33 for c in value):
        raise InputError("Choose the repository's complete OAI base URL")
    u = urlsplit(value)
    if u.scheme not in ("https", "http") or not u.hostname or u.username or u.password or u.fragment:
        raise InputError("Use an HTTP(S) repository URL without credentials or a fragment")
    if any(k in RESERVED for k, _ in parse_qsl(u.query, keep_blank_values=True)):
        raise InputError("The base URL must not already contain OAI request arguments")
    return value

def request_url(base, verb, arguments):
    base_url(base)
    if verb not in VERBS or not isinstance(arguments, dict):
        raise InputError("Unsupported OAI operation")
    allowed = {"Identify": set(), "ListMetadataFormats": {"identifier"},
               "ListSets": {"resumptionToken"}, "GetRecord": {"identifier", "metadataPrefix"},
               "ListRecords": {"metadataPrefix", "from", "until", "set", "resumptionToken"},
               "ListIdentifiers": {"metadataPrefix", "from", "until", "set", "resumptionToken"}}[verb]
    if set(arguments) - allowed or any(not isinstance(v, str) or not v or len(v) > 32768 for v in arguments.values()):
        raise InputError("Invalid OAI request arguments")
    if "resumptionToken" in arguments and set(arguments) != {"resumptionToken"}:
        raise InputError("A continuation sends only verb and the opaque resumptionToken")
    if verb == "GetRecord" and set(arguments) != {"identifier", "metadataPrefix"}:
        raise InputError("GetRecord requires identifier and metadataPrefix")
    if verb in {"ListRecords", "ListIdentifiers"} and "resumptionToken" not in arguments:
        if "metadataPrefix" not in arguments:
            raise InputError("Choose a discovered metadata format")
        for key in ("from", "until"):
            if key in arguments: date(arguments[key])
        if "from" in arguments and "until" in arguments:
            if len(arguments["from"]) != len(arguments["until"]) or arguments["from"] > arguments["until"]:
                raise InputError("from and until are inclusive and must use the same date granularity in order")
    u = urlsplit(base)
    query = parse_qsl(u.query, keep_blank_values=True) + [("verb", verb)] + list(arguments.items())
    return urlunsplit((u.scheme, u.netloc, u.path, urlencode(query), ""))

def packed(node):
    return [node.name, node.attrs, [item if isinstance(item, str) else packed(item) for item in node.content]]

def unpacked(value):
    node = xml.Node(value[0], value[1])
    for item in value[2]:
        child = item if isinstance(item, str) else unpacked(item)
        node.content.append(child)
        if not isinstance(child, str): node.children.append(child)
    return node

def children(node, name):
    return [c for c in node.children if c.name == Q(name)]

def single(node, name, required=True):
    found = children(node, name)
    if len(found) > 1 or required and len(found) != 1:
        raise InputError("OAI " + name + " must occur exactly once")
    return found[0] if found else None

def text(node):
    return node.text("leaf")

def header(node):
    identifier = text(single(node, "identifier"))
    stamp = date(text(single(node, "datestamp")))
    status = node.attrs.get("status", "active")
    if not identifier or len(identifier) > 4096 or status not in {"active", "deleted"}:
        raise InputError("OAI record identifier or deletion status is invalid")
    return {"identifier": identifier, "datestamp": stamp, "status": status,
            "setSpecs": [text(c) for c in children(node, "setSpec")]}

def record(node):
    result = header(single(node, "header"))
    metadata = children(node, "metadata")
    if result["status"] == "deleted":
        if metadata or children(node, "about"):
            raise InputError("A deleted OAI record cannot contain metadata or about")
    elif len(metadata) != 1 or len(metadata[0].children) != 1:
        raise InputError("An active OAI record requires one metadata element and metadata root")
    return {**result, "node": packed(node)}

def parse_page(stream, verb, on_record=None):
    """Keep one record tree in memory. Original response bytes are retained separately."""
    if verb not in VERBS: raise InputError("Unsupported OAI verb")
    result = {"verb": verb, "items": [], "errors": [], "token": None, "recordCount": 0}
    p = xml.parser()
    stack, active = [], []
    size = nodes = 0
    containers = []
    def start(raw, attrs):
        nonlocal size, nodes
        name = xml.expanded(raw)
        if len(stack) >= xml.MAX_DEPTH or len(name) > 2048 or len(attrs) > 256:
            raise InputError("OAI XML exceeds the original parser's structure limits")
        stack.append(name)
        if len(stack) == 1 and name != Q("OAI-PMH"):
            raise InputError("Expected an OAI-PMH 2.0 response namespace")
        is_container = len(stack) == 2 and name == Q(verb)
        if is_container:
            containers.append(name)
            if verb != "Identify": return
        if active or len(stack) == 2 or len(stack) == 3 and stack[1] == Q(verb):
            node = xml.Node(name, {xml.expanded(k): v for k, v in attrs.items()})
            size += len(name.encode()) + sum(len(k.encode()) + len(v.encode()) for k,v in node.attrs.items()) + 128
            nodes += 1
            if size > xml.MAX_RECORD or nodes > 100000:
                raise InputError("An OAI record exceeds the original XML record limits")
            if active:
                active[-1].children.append(node); active[-1].content.append(node)
            active.append(node)
    def content(value):
        nonlocal size
        if active:
            size += len(value.encode())
            if size > xml.MAX_RECORD: raise InputError("OAI record working text exceeds 16 MiB")
            active[-1].content.append(value)
        elif value.strip():
            raise InputError("Unexpected text outside an OAI response element")
    def finished(node):
        name = node.name
        if name == Q("responseDate"):
            if "responseDate" in result: raise InputError("Duplicate OAI responseDate")
            result["responseDate"] = date(text(node), True)
        elif name == Q("request"):
            if "request" in result: raise InputError("Duplicate OAI request echo")
            result["request"] = {"baseURL": text(node), "arguments": node.attrs}
        elif name == Q("error"):
            code = node.attrs.get("code")
            if code not in ERRORS: raise InputError("Unknown OAI error code")
            result["errors"].append({"code": code, "message": text(node)})
        elif name == Q("Identify"):
            identify = {key: text(single(node, key)) for key in
                        ("repositoryName", "baseURL", "protocolVersion", "earliestDatestamp", "deletedRecord", "granularity")}
            identify["adminEmail"] = [text(c) for c in children(node, "adminEmail")]
            identify["compression"] = [text(c) for c in children(node, "compression")]
            if identify["protocolVersion"] != "2.0" or identify["deletedRecord"] not in {"no", "transient", "persistent"}:
                raise InputError("Unsupported OAI protocol version or deletion policy")
            if identify["granularity"] not in {"YYYY-MM-DD", "YYYY-MM-DDThh:mm:ssZ"}:
                raise InputError("Unsupported repository date granularity")
            date(identify["earliestDatestamp"])
            result["identify"] = identify
        elif name == Q("resumptionToken"):
            if result["token"] is not None: raise InputError("Duplicate OAI resumptionToken")
            token = {"value": text(node), **node.attrs}
            if "expirationDate" in token: date(token["expirationDate"], True)
            for key in ("cursor", "completeListSize"):
                if key in token and not re.fullmatch(r"[0-9]+", token[key]):
                    raise InputError("Invalid OAI continuation " + key)
            result["token"] = token
        elif name == Q("record") and verb in {"ListRecords", "GetRecord"}:
            value = record(node)
            result["recordCount"] += 1
            if on_record: on_record(result["recordCount"], value)
        elif name == Q("header") and verb == "ListIdentifiers":
            value = header(node)
            result["recordCount"] += 1
            if on_record: on_record(result["recordCount"], value)
        elif name == Q("metadataFormat") and verb == "ListMetadataFormats":
            result["items"].append({key: text(single(node, key)) for key in ("metadataPrefix", "schema", "metadataNamespace")})
        elif name == Q("set") and verb == "ListSets":
            result["items"].append({"setSpec": text(single(node, "setSpec")), "setName": text(single(node, "setName")),
                                    "description": [packed(c) for c in children(node, "setDescription")]})
        else:
            raise InputError("Unexpected OAI response element: " + name)
    def end(_):
        nonlocal size, nodes
        if active:
            node = active.pop()
            if not active:
                finished(node)
                size = nodes = 0
        stack.pop()
    p.StartElementHandler, p.EndElementHandler, p.CharacterDataHandler = start, end, content
    xml.parse_stream(p, stream)
    if "responseDate" not in result or "request" not in result:
        raise InputError("The OAI response is missing responseDate or request")
    if result["errors"] and containers or not result["errors"] and containers != [Q(verb)]:
        raise InputError("OAI response must contain either its verb result or protocol errors")
    if not result["errors"] and result["request"]["arguments"].get("verb") != verb:
        raise InputError("OAI response request echo belongs to a different verb")
    if verb == "GetRecord" and not result["errors"] and result["recordCount"] != 1:
        raise InputError("GetRecord must return exactly one record")
    return result
