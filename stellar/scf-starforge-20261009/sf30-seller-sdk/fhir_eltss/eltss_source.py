"""MIT. Exact FHIR Bundle/resource intake and original SF30 dataset projection."""
from __future__ import annotations
from contextlib import contextmanager
import hashlib
import io
import json
import re
import stat
import zipfile
from collections import Counter
from pathlib import PurePosixPath
from eltss_runtime import InputError, MAX_SOURCE, fhir

SOURCE_SCHEMA = "stellar-forge.eltss-source.v1"
PLAN_SCHEMA = "stellar-forge.eltss-mapping.v1"
MAX_RESOURCE = 16 * 1024 * 1024
MAX_RESOURCES = 5000
MAX_CAREPLANS = 100
MAX_MEMBERS = 4096
MAX_INTERACTIVE = 4 * 1024 * 1024
RESOURCE_TYPE = re.compile(r"[A-Z][A-Za-z0-9]{0,63}\Z")
JSON_SPACE = b" \t\r\n"
STRUCTURAL = re.compile(rb'["{}\[\]]')
IN_STRING = re.compile(rb'["\\]')
SCALAR_END = re.compile(rb'[,}\]\s]')
sha = fhir.sha
jbytes = fhir.jbytes
identity = fhir.identity
text = fhir.text
integer = fhir.integer
exact = fhir.exact
json_value = fhir.json_value
lexical_json = fhir.lexical_json


def pointer(tokens):
    return "".join("/" + str(t).replace("~", "~0").replace("/", "~1") for t in tokens)


def pointer_tokens(value):
    if value == "":
        return []
    if not isinstance(value, str) or not value.startswith("/") or re.search(r"~(?![01])", value):
        raise InputError("Choose an exact original JSON pointer")
    return [part.replace("~1", "/").replace("~0", "~") for part in value[1:].split("/")]


def member_name(value):
    if not isinstance(value, str) or not value or len(value) > 1024 or "\\" in value or "\0" in value:
        raise InputError("Invalid original member name")
    path = PurePosixPath(value)
    if path.is_absolute() or any(p in {"", ".", ".."} for p in value.split("/")) or ":" in path.parts[0]:
        raise InputError("Choose a relative original member name")
    return value


def descriptor(name, data, **extra):
    return {"name": member_name(name), "bytes": len(data), "sha256": sha(data), **extra}


class JSONReader:
    """Incremental outer Bundle reader; retains each exact complete entry."""
    def __init__(self, stream, limit=MAX_SOURCE):
        self.stream, self.limit = stream, limit
        self.buffer, self.pos, self.base, self.read_bytes = b"", 0, 0, 0
        self.done = False

    @property
    def offset(self):
        return self.base + self.pos

    def fill(self):
        if self.pos < len(self.buffer):
            return True
        if self.done:
            return False
        self.base += len(self.buffer)
        self.buffer = self.stream.read(65536)
        self.pos = 0
        self.read_bytes += len(self.buffer)
        if self.read_bytes > self.limit:
            raise InputError("Original FHIR document exceeds 256 MiB")
        if not self.buffer:
            self.done = True
            return False
        return True

    def peek(self):
        return self.buffer[self.pos] if self.fill() else None

    def space(self):
        while self.fill():
            start = self.pos
            while self.pos < len(self.buffer) and self.buffer[self.pos] in JSON_SPACE:
                self.pos += 1
            if self.pos < len(self.buffer) or self.pos == start:
                break

    def take(self, char):
        self.space()
        if self.peek() != char:
            raise InputError("Malformed FHIR JSON at original byte " + str(self.offset))
        self.pos += 1

    def raw(self, maximum=MAX_RESOURCE):
        self.space()
        start, first = self.offset, self.peek()
        if first is None:
            raise InputError("Truncated original JSON value")
        parts, total = [], 0
        composite, string = first in (123, 91), first == 34
        level = 0
        in_string = False
        skip = False
        finished = False
        while self.fill() and not finished:
            begin = self.pos
            if not composite and not string:
                found = SCALAR_END.search(self.buffer, self.pos)
                self.pos = found.start() if found else len(self.buffer)
                finished = found is not None
            else:
                while self.pos < len(self.buffer):
                    if skip:
                        self.pos += 1
                        skip = False
                        continue
                    matcher = IN_STRING if in_string else STRUCTURAL
                    found = matcher.search(self.buffer, self.pos)
                    if found is None:
                        self.pos = len(self.buffer)
                        break
                    self.pos = found.start() + 1
                    char = found.group()[0]
                    if in_string:
                        if char == 92:
                            skip = True
                        else:
                            in_string = False
                            if string:
                                finished = True
                                break
                    elif char == 34:
                        in_string = True
                    elif char in (123, 91):
                        level += 1
                        if level > 128:
                            raise InputError("FHIR JSON nesting exceeds 128 levels")
                    else:
                        level -= 1
                        if level == 0:
                            finished = True
                            break
                        if level < 0:
                            raise InputError("Malformed original JSON nesting")
            part = self.buffer[begin:self.pos]
            total += len(part)
            if total > maximum:
                raise InputError("One FHIR resource or header value exceeds 16 MiB")
            parts.append(part)
            if not composite and not string and finished:
                break
        raw = b"".join(parts)
        if not raw or ((composite or string) and not finished):
            raise InputError("Truncated original JSON value")
        value = json_value(raw, lexical=True)
        return raw, value, start, self.offset

    def document(self):
        """Yield entries followed by one complete header event."""
        self.take(123)
        header, keys, ordinal, has_entries = {}, set(), 0, False
        self.space()
        if self.peek() == 125:
            self.pos += 1
        else:
            while True:
                _, key, _, _ = self.raw(65536)
                if type(key) is not str or key in keys:
                    raise InputError("Original FHIR object has an invalid or duplicate key")
                keys.add(key)
                self.take(58)
                if key == "entry":
                    has_entries = True
                    self.take(91)
                    self.space()
                    if self.peek() == 93:
                        self.pos += 1
                    else:
                        while True:
                            raw, value, start, end = self.raw()
                            ordinal += 1
                            if ordinal > MAX_RESOURCES or not isinstance(value, dict):
                                raise InputError("Bundle entries must be objects within the 5,000-resource limit")
                            yield {"kind": "entry", "entry": value, "ordinal": ordinal,
                                   "pointer": "/entry/" + str(ordinal - 1),
                                   "entrySha256": sha(raw), "startByte": start, "endByte": end}
                            self.space()
                            if self.peek() == 93:
                                self.pos += 1
                                break
                            self.take(44)
                else:
                    _, value, _, _ = self.raw()
                    header[key] = value
                    if len(lexical_json(header).encode()) > MAX_RESOURCE:
                        raise InputError("Original Bundle metadata exceeds 16 MiB")
                self.space()
                if self.peek() == 125:
                    self.pos += 1
                    break
                self.take(44)
        self.space()
        if self.peek() is not None:
            raise InputError("Additional bytes follow the complete original FHIR JSON")
        rt = header.get("resourceType")
        if not isinstance(rt, str) or not RESOURCE_TYPE.fullmatch(rt):
            raise InputError("Original source must be a complete FHIR resource or Bundle")
        if has_entries and rt != "Bundle":
            raise InputError("The top-level entry array belongs to a FHIR Bundle")
        if rt == "Bundle" and not isinstance(header.get("type"), str):
            raise InputError("A FHIR Bundle must retain its original type")
        yield {"kind": "header", "header": header, "entries": ordinal,
               "hasEntries": has_entries, "bytes": self.offset}


class Packet:
    """Complete immutable raw JSON or a declared, verified source archive."""
    def __init__(self, stream):
        self.stream, self.archive = stream, None
        stream.seek(0)
        digest, size = hashlib.sha256(), 0
        while block := stream.read(65536):
            size += len(block)
            if size > MAX_SOURCE:
                raise InputError("Complete eLTSS source exceeds 256 MiB")
            digest.update(block)
        self.source_id, self.size = digest.hexdigest(), size
        stream.seek(0)
        self.manifest = None
        self.members, self.documents = [], []
        self.headers = {}
        if zipfile.is_zipfile(stream):
            stream.seek(0)
            try:
                self.archive = zipfile.ZipFile(stream)
                infos = self.archive.infolist()
                if not 2 <= len(infos) <= MAX_MEMBERS or len({i.filename for i in infos}) != len(infos):
                    raise InputError("Original source archive has duplicate or excessive members")
                total = 0
                for info in infos:
                    member_name(info.filename)
                    mode = info.external_attr >> 16
                    if info.is_dir() or stat.S_ISLNK(mode) or info.flag_bits & 1 or \
                            info.compress_type not in {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED}:
                        raise InputError("Unsupported original source archive member")
                    total += info.file_size
                    if info.file_size > MAX_SOURCE or total > MAX_SOURCE:
                        raise InputError("Expanded original source exceeds 256 MiB")
                index = {i.filename: i for i in infos}
                if "manifest.json" not in index or index["manifest.json"].file_size > MAX_INTERACTIVE:
                    raise InputError("Source archive requires its complete manifest.json")
                manifest_raw = self.archive.read("manifest.json")
                self.manifest = json_value(manifest_raw)
                if not isinstance(self.manifest, dict) or self.manifest.get("schema") != SOURCE_SCHEMA:
                    raise InputError("Unsupported eLTSS source manifest")
                self.documents = self.manifest.get("documents")
                if not isinstance(self.documents, list) or not 1 <= len(self.documents) <= 512:
                    raise InputError("Source manifest must select 1–512 complete original documents")
                declared = []
                for key in ["documents", "protocol", "predecessors"]:
                    values = self.manifest.get(key, [])
                    if not isinstance(values, list):
                        raise InputError("Source manifest member groups must be arrays")
                    declared.extend(values)
                names = set()
                for item in declared:
                    if not isinstance(item, dict):
                        raise InputError("Invalid original source member descriptor")
                    name = member_name(item.get("name"))
                    if name == "manifest.json" or name in names or name not in index:
                        raise InputError("Source manifest repeats or omits an original member")
                    names.add(name)
                    integer(item.get("bytes"), 0, MAX_SOURCE, "Original member bytes")
                    identity(item.get("sha256"))
                    if item["bytes"] != index[name].file_size:
                        raise InputError("Original member byte count differs: " + name)
                    h, observed = hashlib.sha256(), 0
                    with self.archive.open(name) as member:
                        while block := member.read(65536):
                            observed += len(block)
                            if observed > item["bytes"]:
                                raise InputError("Original member exceeds its complete declaration")
                            h.update(block)
                    if observed != item["bytes"] or h.hexdigest() != item["sha256"]:
                        raise InputError("Original member hash differs: " + name)
                    self.members.append(dict(item))
                if names | {"manifest.json"} != set(index):
                    raise InputError("Source archive has undeclared members")
                self.members.append(descriptor("manifest.json", manifest_raw, role="source-manifest"))
            except Exception as error:
                self.close()
                if isinstance(error, InputError):
                    raise
                raise InputError("Could not read the complete original source archive") from error
        else:
            stream.seek(0)
            self.documents = [{"name": "source.json", "bytes": size, "sha256": self.source_id,
                               "role": "resource", "sourceUrl": None}]
            self.members = [dict(self.documents[0])]
        self.by_name = {row["name"]: row for row in self.members}

    def close(self):
        if self.archive:
            self.archive.close()
            self.archive = None

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()

    @contextmanager
    def open(self, name):
        if name not in self.by_name:
            raise InputError("Unknown retained original member")
        if self.archive:
            with self.archive.open(name) as stream:
                yield stream
        else:
            self.stream.seek(0)
            yield self.stream

    def events(self, cancel=None):
        count, careplans = 0, 0
        for document in self.documents:
            mid = sha(jbytes({"name": document["name"], "sha256": document["sha256"]}))
            with self.open(document["name"]) as stream:
                for event in JSONReader(stream).document():
                    if cancel and cancel.is_set():
                        raise InputError("Original source reading was cancelled")
                    if event["kind"] == "header":
                        header = event["header"]
                        self.headers[mid] = {"memberId": mid, "memberName": document["name"],
                            "sourceUrl": document.get("sourceUrl"), "headerJson": lexical_json(header),
                            "bundleId": header.get("id") if header["resourceType"] == "Bundle" else None,
                            "bundleType": header.get("type") if header["resourceType"] == "Bundle" else None,
                            "entryCount": event["entries"]}
                        yield {"kind": "header", **self.headers[mid]}
                        if header["resourceType"] == "Bundle":
                            continue
                        entries = [{"resource": header}]
                        locators = [(1, "", document["sha256"], 0, event["bytes"])]
                    else:
                        entry = event["entry"]
                        if not isinstance(entry.get("resource"), dict):
                            # Search/transaction responses may carry an original deleted or
                            # failed entry with a response and no resource.
                            if not any(k in entry for k in ["request", "response"]):
                                raise InputError("Bundle entry requires an original resource or request/response")
                            yield {"kind": "non-resource-entry", "memberId": mid,
                                   "entryPointer": event["pointer"], "entrySha256": event["entrySha256"],
                                   "jsonText": lexical_json(entry)}
                            continue
                        entries = [entry]
                        locators = [(event["ordinal"], event["pointer"] + "/resource",
                                     event["entrySha256"], event["startByte"], event["endByte"])]
                    for entry, locator in zip(entries, locators):
                        ordinal, root_pointer, entry_sha, start, end = locator
                        resource = entry["resource"]
                        full_url = entry.get("fullUrl")
                        if full_url is not None and not isinstance(full_url, str):
                            raise InputError("Original Bundle fullUrl must be a string")
                        search = entry.get("search", {})
                        if search is not None and not isinstance(search, dict):
                            raise InputError("Original Bundle search metadata must be an object")
                        def walk(value, at, parent=None, root=None, full=full_url, bundle_parent=None):
                            nonlocal count, careplans
                            if not isinstance(value, dict) or not isinstance(value.get("resourceType"), str) or \
                                    not RESOURCE_TYPE.fullmatch(value["resourceType"]):
                                raise InputError("Bundle and contained resources require their original resourceType")
                            encoded = lexical_json(value)
                            if len(encoded.encode()) > MAX_RESOURCE:
                                raise InputError("One resource exceeds 16 MiB")
                            count += 1
                            careplans += value["resourceType"] == "CarePlan"
                            if count > MAX_RESOURCES or careplans > MAX_CAREPLANS:
                                raise InputError("Edition exceeds 5,000 resources or 100 CarePlans")
                            rid = sha(jbytes({"memberId": mid, "pointer": at, "ordinal": ordinal}))
                            root = root or rid
                            meta = value.get("meta") or {}
                            if not isinstance(meta, dict):
                                raise InputError("Original resource meta must be an object")
                            if value.get("id") is not None and not isinstance(value["id"], str):
                                raise InputError("Original resource ID must remain a string")
                            if any(meta.get(key) is not None and not isinstance(meta[key], str) for key in ["versionId", "lastUpdated"]):
                                raise InputError("Original version and update time must remain strings")
                            row = {"recordId": rid, "sourceId": self.source_id, "memberId": mid,
                                "memberName": document["name"], "entryOrdinal": ordinal,
                                "entryPointer": at, "entrySha256": entry_sha, "startByte": start, "endByte": end,
                                "fullUrl": full, "resourceType": value["resourceType"], "id": value.get("id"),
                                "versionId": meta.get("versionId"), "lastUpdated": meta.get("lastUpdated"),
                                "containedIn": parent, "rootRecordId": root, "bundleIn": bundle_parent, "jsonText": encoded,
                                "resourceSha256": sha(encoded.encode()), "sourceUrl": document.get("sourceUrl"),
                                "searchMode": (search or {}).get("mode"), "_resource": value,
                                "fileId": mid, "line": ordinal}
                            yield {"kind": "resource", "row": row}
                            contained = value.get("contained", [])
                            if not isinstance(contained, list):
                                raise InputError("Original contained resources must be an array")
                            for number, child in enumerate(contained):
                                yield from walk(child, at + "/contained/" + str(number), rid, root, None, bundle_parent)
                            if value["resourceType"] == "Bundle":
                                nested = value.get("entry", [])
                                if not isinstance(nested, list):
                                    raise InputError("Original nested Bundle entries must be an array")
                                for number, nested_entry in enumerate(nested):
                                    if not isinstance(nested_entry, dict):
                                        raise InputError("Original nested Bundle entry must be an object")
                                    child = nested_entry.get("resource")
                                    child_pointer = at + "/entry/" + str(number)
                                    if child is None and any(k in nested_entry for k in ["request", "response"]):
                                        yield {"kind": "non-resource-entry", "memberId": mid,
                                            "entryPointer": child_pointer, "entrySha256": sha(lexical_json(nested_entry).encode()),
                                            "jsonText": lexical_json(nested_entry)}
                                        continue
                                    child_full = nested_entry.get("fullUrl")
                                    if child_full is not None and not isinstance(child_full, str):
                                        raise InputError("Nested Bundle fullUrl must remain an original string")
                                    yield from walk(child, child_pointer + "/resource", None, None, child_full, rid)
                        yield from walk(resource, root_pointer)

    def records(self, cancel=None):
        for event in self.events(cancel):
            if event["kind"] == "resource":
                row = event["row"]
                header = self.headers.get(row["memberId"], {})
                yield {**row, "bundleId": header.get("bundleId"), "bundleType": header.get("bundleType")}


def inventory(stream, cancel=None):
    with Packet(stream) as packet:
        types, ids, paths, duplicates = {}, {}, set(), Counter()
        count, nonresources = 0, 0
        for event in packet.events(cancel):
            if event["kind"] == "non-resource-entry":
                nonresources += 1
                continue
            if event["kind"] != "resource":
                continue
            row = event["row"]
            count += 1
            rt = row["resourceType"]
            item = types.setdefault(rt, {"type": rt, "count": 0, "missingIds": 0,
                                        "duplicateIdentities": 0, "contained": 0, "paths": []})
            item["count"] += 1
            item["missingIds"] += not row["id"]
            item["contained"] += row["containedIn"] is not None
            if row["id"]:
                key = (rt, row["id"])
                duplicates[key] += 1
            def visit(value, at=()):
                if len(at) > 16 or len(item["paths"]) >= 256:
                    return
                signature = (rt, at)
                if signature not in paths:
                    paths.add(signature)
                    item["paths"].append(list(at))
                if isinstance(value, dict):
                    for key, child in value.items():
                        visit(child, at + (key,))
                elif isinstance(value, list):
                    for child in value[:8]:
                        visit(child, at + ("*",))
            visit(row["_resource"])
        for (rt, _), number in duplicates.items():
            if number > 1:
                types[rt]["duplicateIdentities"] += number
        return {"schema": "stellar-forge.eltss-inventory.v1", "sourceSha256": packet.source_id,
            "bytes": packet.size, "resources": count, "carePlans": types.get("CarePlan", {}).get("count", 0),
            "resourceTypes": [types[key] for key in sorted(types)],
            "members": packet.members, "documents": list(packet.headers.values()),
            "nonResourceEntries": nonresources, "origin": (packet.manifest or {}).get("origin", "operator_source"),
            "sourceContext": (packet.manifest or {}).get("context", {})}


def validate_plan(raw):
    if not isinstance(raw, dict) or raw.get("schema") != PLAN_SCHEMA:
        raise InputError("Mapping schema must be " + PLAN_SCHEMA)
    original = fhir.validate_plan({**raw, "schema": fhir.PLAN_SCHEMA})
    return {**original, "schema": PLAN_SCHEMA}


def default_mapping(shape, resource_type, name=None):
    return {**fhir.default_mapping(shape, resource_type, name), "schema": PLAN_SCHEMA}


def dataset_spec(plan):
    checked = validate_plan(plan)
    return fhir.dataset_spec({**checked, "schema": fhir.PLAN_SCHEMA})


def extract(stream, plan, on_record, cancel=None):
    plan, count = validate_plan(plan), 0
    with Packet(stream) as packet:
        for row in packet.records(cancel):
            if row["resourceType"] != plan["resourceType"]:
                continue
            count += 1
            if count > plan["maxRows"]:
                raise InputError("Selected resources exceed the reviewed mapping's maxRows")
            cells = [fhir.project(row, column, count, plan["maxCellChars"]) for column in plan["columns"]]
            on_record(count, [v[0] for v in cells], [v[1] for v in cells])
    return count
