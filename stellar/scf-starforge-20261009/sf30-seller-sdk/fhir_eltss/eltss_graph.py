"""MIT. Original eLTSS resource identities, versioned references and paged graph."""
from __future__ import annotations
from contextlib import contextmanager
from collections import Counter, deque
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import tempfile
from urllib.parse import urlsplit, urlunsplit
from eltss_runtime import InputError, original_workspace, atomic_json
from eltss_source import (Packet, MAX_SOURCE, MAX_INTERACTIVE, MAX_RESOURCES, identity,
                          sha, jbytes, json_value, lexical_json, pointer, integer)

INDEX_SCHEMA = "stellar-forge.eltss-source-index.v1"
GRAPH_SCHEMA = "stellar-forge.eltss-graph.v1"
RESOURCE_SUFFIX = re.compile(r"/([A-Z][A-Za-z0-9]*)/([A-Za-z0-9.-]{1,64})(?:/_history/([^/?#]+))?/?\Z")
RELATIVE = re.compile(r"([A-Z][A-Za-z0-9]*)/([A-Za-z0-9.-]{1,64})(?:/_history/([^/?#]+))?\Z")


def _write(path, data):
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())


def without_history(value):
    if not isinstance(value, str):
        return value, None
    match = re.search(r"/_history/([^/?#]+)\Z", value)
    return (value[:match.start()], match.group(1)) if match else (value, None)


def rest_base(value, resource_type=None, logical_id=None):
    if not isinstance(value, str):
        return None
    parts = urlsplit(value)
    if parts.scheme not in {"https", "http"} or not parts.netloc or parts.query or parts.fragment:
        return None
    match = RESOURCE_SUFFIX.search(parts.path)
    if not match or resource_type and match.group(1) != resource_type or logical_id and match.group(2) != logical_id:
        return None
    return urlunsplit((parts.scheme, parts.netloc, parts.path[:match.start()].rstrip("/"), "", ""))


def references(resource):
    """One edge per actual Reference, with contained resources indexed separately."""
    def walk(value, path=()):
        if isinstance(value, dict):
            if isinstance(value.get("reference"), str):
                yield {"path": list(path), "reference": value["reference"], "kind": "literal",
                       "referenceType": value.get("type"), "display": value.get("display"),
                       "identifierJson": lexical_json(value.get("identifier")) if value.get("identifier") is not None else None}
            elif isinstance(value.get("identifier"), dict) and \
                    any(key in value["identifier"] for key in ["system", "value"]):
                yield {"path": list(path), "reference": None, "kind": "logical",
                       "referenceType": value.get("type"), "display": value.get("display"),
                       "identifierJson": lexical_json(value["identifier"])}
            elif isinstance(value.get("display"), str) and path and (
                    str(path[-1]).endswith("Reference") or path[-1] in {
                    "subject", "patient", "encounter", "author", "custodian", "managingOrganization",
                    "requester", "performer", "beneficiary", "payor", "owner", "insurer", "party"}):
                yield {"path": list(path), "reference": None, "kind": "display",
                       "referenceType": value.get("type"), "display": value["display"], "identifierJson": None}
            for key, child in value.items():
                if key == "contained" or resource.get("resourceType") == "Bundle" and key == "entry":
                    continue
                if key in {"questionnaire", "instantiatesCanonical"}:
                    items = child if isinstance(child, list) else [child]
                    for i, item in enumerate(items):
                        if isinstance(item, str):
                            yield {"path": list(path + (key,) + ((str(i),) if isinstance(child, list) else ())),
                                   "reference": item, "kind": "canonical", "referenceType": None,
                                   "display": None, "identifierJson": None}
                else:
                    yield from walk(child, path + (key,))
        elif isinstance(value, list):
            for i, child in enumerate(value):
                yield from walk(child, path + (str(i),))
    yield from walk(resource)


def _resource_row(record):
    value = json_value(record["metadata"])
    value["jsonText"] = record["body"]
    value["_resource"] = json_value(record["body"], lexical=True)
    if "document" in record.keys() and record["document"]:
        document = json_value(record["document"])
        value.setdefault("bundleId", document.get("bundleId"))
        value.setdefault("bundleType", document.get("bundleType"))
    return value


def public_row(row, body=True):
    return {k: v for k, v in row.items() if k != "_resource" and (body or k != "jsonText")}


def _page(query, params, *, offset, limit, encode, total, budget=MAX_INTERACTIVE):
    offset = integer(offset, 0, 10_000_000, "Page offset")
    limit = integer(limit, 1, 500, "Page limit")
    rows, size, consumed = [], 0, 0
    for row in query(*params, limit=limit, offset=offset):
        value = encode(row)
        raw_size = len(jbytes(value))
        if raw_size > budget:
            # A single resource can be larger than an interactive page. Its exact
            # unchanged document/member remains downloadable.
            value = {k: v for k, v in value.items() if k not in {"jsonText", "beforeJson", "afterJson"}}
            value["contentOmitted"] = "Use the unchanged original member or complete changes file"
            raw_size = len(jbytes(value))
        if rows and size + raw_size > budget:
            break
        if raw_size > budget:
            raise InputError("One interactive descriptor exceeds the 4 MiB limit; open its complete file")
        rows.append(value)
        size += raw_size
        consumed += 1
    return {"rows": rows, "total": total, "offset": offset,
            "nextOffset": offset + consumed if offset + consumed < total else None,
            "pageBytes": size, "pageByteBudget": budget}


class SourceIndex:
    def __init__(self, source_path, directory, source_id):
        self.source_path, self.directory, self.source_id = Path(source_path), Path(directory), identity(source_id)
        self.directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        if self.directory.is_symlink():
            raise InputError("Source index must use its private real directory")
        self.path, self.manifest_path = self.directory / "source.sqlite", self.directory / "index.json"
        if not self.path.exists() or not self.manifest_path.exists():
            self._build()
        manifest = json_value(self.manifest_path.read_bytes())
        if manifest.get("schema") != INDEX_SCHEMA or manifest.get("sourceId") != source_id or \
                original_workspace.file_digest(self.path, 2 * MAX_SOURCE) != manifest.get("sha256"):
            raise InputError("Derived source index differs from its retained original identity")
        self.manifest = manifest
        self.db = sqlite3.connect(self.path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row

    def _build(self):
        if original_workspace.file_digest(self.source_path) != self.source_id:
            raise InputError("Original source changed before graph indexing")
        fd, name = tempfile.mkstemp(prefix="index-", suffix=".sqlite", dir=self.directory)
        os.close(fd)
        temp = Path(name)
        db = sqlite3.connect(temp)
        try:
            db.executescript("""
                PRAGMA journal_mode=OFF;
                CREATE TABLE documents(member_id TEXT PRIMARY KEY,body TEXT NOT NULL);
                CREATE TABLE nodes(record_id TEXT PRIMARY KEY,member_id TEXT NOT NULL,resource_type TEXT NOT NULL,
                    logical_id TEXT,version_id TEXT,full_url TEXT,source_url TEXT,root_id TEXT NOT NULL,
                    contained_in TEXT,resource_sha TEXT NOT NULL,canonical_url TEXT,canonical_version TEXT,
                    body TEXT NOT NULL,metadata TEXT NOT NULL);
                CREATE INDEX types ON nodes(resource_type,logical_id);
                CREATE INDEX urls ON nodes(full_url);
                CREATE INDEX sources ON nodes(source_url);
                CREATE INDEX roots ON nodes(root_id,logical_id);
                CREATE INDEX canonicals ON nodes(canonical_url,canonical_version);
                CREATE TABLE edges(id TEXT PRIMARY KEY,from_id TEXT NOT NULL,path TEXT NOT NULL,body TEXT NOT NULL);
                CREATE INDEX outgoing ON edges(from_id);
                CREATE TABLE nonresources(member_id TEXT NOT NULL,body TEXT NOT NULL);
            """)
            counts, edges, documents = Counter(), 0, 0
            with self.source_path.open("rb") as stream, Packet(stream) as packet:
                if packet.source_id != self.source_id:
                    raise InputError("Original graph source hash differs")
                for event in packet.events():
                    if event["kind"] == "header":
                        db.execute("INSERT INTO documents VALUES(?,?)", (event["memberId"], jbytes(event).decode()))
                        documents += 1
                    elif event["kind"] == "non-resource-entry":
                        db.execute("INSERT INTO nonresources VALUES(?,?)", (event["memberId"], jbytes(event).decode()))
                    else:
                        row = event["row"]
                        resource = row["_resource"]
                        metadata = public_row(row, False)
                        db.execute("INSERT INTO nodes VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (
                            row["recordId"], row["memberId"], row["resourceType"], row["id"], row["versionId"],
                            row["fullUrl"], row["sourceUrl"], row["rootRecordId"], row["containedIn"],
                            row["resourceSha256"], resource.get("url") if isinstance(resource.get("url"), str) else None,
                            resource.get("version") if isinstance(resource.get("version"), str) else None,
                            row["jsonText"], jbytes(metadata).decode()))
                        counts[row["resourceType"]] += 1
                        for edge in references(resource):
                            body = {**edge, "fromRecordId": row["recordId"],
                                "pointer": row["entryPointer"] + pointer(edge["path"]) +
                                           ("/reference" if edge["kind"] == "literal" else "/identifier" if edge["kind"] == "logical" else "")}
                            eid = sha(jbytes(body))
                            db.execute("INSERT INTO edges VALUES(?,?,?,?)",
                                       (eid, row["recordId"], jbytes(edge["path"]).decode(), jbytes({"id": eid, **body}).decode()))
                            edges += 1
                            if edges > 100000:
                                raise InputError("Complete original source exceeds 100,000 reference edges")
            db.commit()
            db.close()
            if temp.stat().st_size > 2 * MAX_SOURCE:
                raise InputError("Complete derived source graph exceeds 512 MiB")
            digest = original_workspace.file_digest(temp, 2 * MAX_SOURCE)
            os.replace(temp, self.path)
            atomic_json(self.manifest_path, {"schema": INDEX_SCHEMA, "sourceId": self.source_id,
                "bytes": self.path.stat().st_size, "sha256": digest, "resources": sum(counts.values()),
                "resourceTypes": dict(counts), "edges": edges, "documents": documents})
        finally:
            try:
                db.close()
            except Exception:
                pass
            temp.unlink(missing_ok=True)

    def close(self):
        self.db.close()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()

    def row(self, record_id):
        row = self.db.execute("""SELECT n.*,d.body AS document FROM nodes n
            LEFT JOIN documents d ON d.member_id=n.member_id WHERE n.record_id=?""", (identity(record_id),)).fetchone()
        if row is None:
            raise InputError("Unknown resource in this original source")
        return _resource_row(row)

    def _filter(self, resource_type=None, query=None):
        terms, args = [], []
        if resource_type:
            terms.append("n.resource_type=?")
            args.append(resource_type)
        if query:
            if not isinstance(query, str) or len(query) > 1000:
                raise InputError("Source search must be at most 1,000 characters")
            escaped = query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            terms.append("(n.body LIKE ? ESCAPE '\\' OR n.full_url LIKE ? ESCAPE '\\')")
            args.extend(["%" + escaped + "%"] * 2)
        return " WHERE " + " AND ".join(terms) if terms else "", args

    def rows(self, resource_type=None, offset=0, limit=50, query=""):
        where, args = self._filter(resource_type, query)
        total = self.db.execute("SELECT count(*) FROM nodes n" + where, args).fetchone()[0]
        def fetch(*a, limit, offset):
            return self.db.execute("""SELECT n.*,d.body AS document FROM nodes n
                LEFT JOIN documents d ON d.member_id=n.member_id""" + where +
                " ORDER BY n.member_id,json_extract(n.metadata,'$.entryOrdinal'),n.record_id LIMIT ? OFFSET ?",
                (*a, limit, offset))
        return {"sourceId": self.source_id, **_page(fetch, args, offset=offset, limit=limit,
                encode=lambda r: public_row(_resource_row(r)), total=total)}

    def all_rows(self, resource_type=None):
        where, args = self._filter(resource_type)
        for row in self.db.execute("""SELECT n.*,d.body AS document FROM nodes n
            LEFT JOIN documents d ON d.member_id=n.member_id""" + where + " ORDER BY n.member_id,n.rowid", args):
            yield _resource_row(row)

    def outgoing(self, record_id):
        return [json_value(row[0]) for row in self.db.execute("SELECT body FROM edges WHERE from_id=? ORDER BY rowid", (identity(record_id),))]

    def aliases(self, uri, version=None, canonical=False):
        if canonical:
            sql = "SELECT record_id,resource_sha FROM nodes WHERE canonical_url=?"
            args = [uri]
            if version is not None:
                sql += " AND canonical_version=?"
                args.append(version)
            return [dict(r) for r in self.db.execute(sql, args)]
        candidates = {}
        for row in self.db.execute("SELECT record_id,resource_sha,version_id FROM nodes WHERE full_url=? OR (full_url IS NULL AND source_url=?)", (uri, uri)):
            if version is None or row["version_id"] == version:
                candidates[row["record_id"]] = {"record_id": row["record_id"], "resource_sha": row["resource_sha"]}
        return list(candidates.values())


def resolve_edge(index, owner, edge, policy, decisions=None):
    ref, kind = edge["reference"], edge["kind"]
    base = {"targetRecordIds": [], "candidateRecordIds": [], "resolvedUrl": None,
            "versionId": None, "reason": "", **edge}
    if kind == "display":
        return {**base, "status": "unresolved", "reason": "Original display-only reference has no literal or logical identity"}
    if kind == "logical":
        return {**base, "status": "logical", "reason": "Original logical identifier requires a reviewed identity decision"}
    candidates, uri, version = [], None, None
    if kind == "canonical":
        uri, separator, version = ref.partition("|")
        version = version if separator else None
        candidates = index.aliases(uri, version, canonical=True)
    elif ref == "#":
        if owner.get("containedIn"):
            candidates = [{"record_id": owner["rootRecordId"],
                           "resource_sha": index.row(owner["rootRecordId"])["resourceSha256"]}]
        else:
            return {**base, "status": "unresolved", "reason": "A parent # reference requires an owning contained-resource context"}
    elif ref.startswith("#"):
        candidates = [dict(r) for r in index.db.execute(
            "SELECT record_id,resource_sha FROM nodes WHERE root_id=? AND logical_id=? AND contained_in IS NOT NULL",
            (owner["rootRecordId"], ref[1:]))]
    elif ref.startswith(("urn:uuid:", "urn:oid:")):
        uri = ref
        candidates = index.aliases(uri)
    else:
        parsed = urlsplit(ref)
        if parsed.scheme:
            if parsed.scheme not in {"https", "http"} or parsed.username or parsed.password:
                return {**base, "status": "external", "reason": "Retained external reference uses a separate identity scheme"}
            uri, version = without_history(ref)
            candidates = index.aliases(uri, version)
        else:
            relative = RELATIVE.fullmatch(ref)
            if not relative:
                return {**base, "status": "unresolved", "reason": "Relative reference is not an observed ResourceType/id or versioned identity"}
            original_base = rest_base(owner.get("fullUrl"), owner["resourceType"], owner.get("id"))
            if original_base is None and not owner.get("bundleType") and not owner.get("fullUrl"):
                original_base = rest_base(owner.get("sourceUrl"), owner["resourceType"], owner.get("id"))
            if original_base is None and policy.get("referencePolicy") == "selected-base":
                original_base = policy.get("baseUrl", "").rstrip("/") or None
            relative_uri, version = without_history(ref)
            if original_base:
                uri = original_base.rstrip("/") + "/" + relative_uri
                candidates = index.aliases(uri, version)
            else:
                possible = index.db.execute("SELECT record_id FROM nodes WHERE resource_type=? AND logical_id=? AND contained_in IS NULL",
                                            (relative.group(1), relative.group(2))).fetchall()
                return {**base, "status": "unresolved", "candidateRecordIds": [r[0] for r in possible],
                        "versionId": version, "reason": "Original Bundle identity does not supply a REST base; review a selected-base policy"}
    ids = [r["record_id"] for r in candidates]
    base.update({"candidateRecordIds": ids, "resolvedUrl": uri, "versionId": version})
    decision = (decisions or {}).get(edge["id"])
    if decision:
        selected = decision.get("selectedRecordId")
        if selected not in ids:
            raise InputError("A reference decision must select an original observed candidate")
        return {**base, "status": "resolved", "targetRecordIds": [selected], "decisionId": decision["id"],
                "reason": "Selected by the retained original reference decision"}
    if len(ids) == 1:
        return {**base, "status": "resolved", "targetRecordIds": ids, "reason": "Exact original resource identity"}
    if len(ids) > 1:
        equivalent = len({r["resource_sha"] for r in candidates}) == 1
        return {**base, "status": "equivalent" if equivalent else "ambiguous",
                "targetRecordIds": ids if equivalent else [],
                "reason": "Equivalent original entries retained" if equivalent else "Multiple original entries differ; select a reviewed version or identity"}
    return {**base, "status": "unresolved", "reason": "Referenced identity is absent from this retained source edition"}



class Resolution:
    """Disk-backed original reference resolution; reused by all 56 field reviews."""
    def __init__(self, index, policy, decisions=None):
        self.index, self.policy, self.decisions = index, policy, decisions or {}
        self.id = sha(jbytes({"schema": GRAPH_SCHEMA, "sourceId": index.source_id,
            "policy": policy, "decisions": sorted(self.decisions.values(), key=lambda d: d["id"])}))
        self.path = index.directory / ("graph-" + self.id + ".sqlite")
        self.manifest_path = index.directory / ("graph-" + self.id + ".json")
        if not self.path.exists() or not self.manifest_path.exists():
            self._build()
        manifest = json_value(self.manifest_path.read_bytes())
        if manifest.get("id") != self.id or original_workspace.file_digest(self.path, MAX_SOURCE) != manifest.get("sha256"):
            raise InputError("Derived reference graph changed from its retained source and decisions")
        self.manifest = manifest
        self.db = sqlite3.connect(self.path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row

    def _build(self):
        fd, name = tempfile.mkstemp(prefix="graph-", suffix=".sqlite", dir=self.index.directory)
        os.close(fd)
        temp = Path(name)
        db = sqlite3.connect(temp)
        counts = Counter()
        try:
            db.executescript("""PRAGMA journal_mode=OFF;
                CREATE TABLE edges(id TEXT PRIMARY KEY,from_id TEXT NOT NULL,status TEXT NOT NULL,body TEXT NOT NULL);
                CREATE INDEX outgoing ON edges(from_id);
                CREATE INDEX states ON edges(status);
                CREATE TABLE targets(edge_id TEXT NOT NULL,target_id TEXT NOT NULL,PRIMARY KEY(edge_id,target_id));
                CREATE INDEX incoming ON targets(target_id);""")
            for owner in self.index.all_rows():
                for edge in self.index.outgoing(owner["recordId"]):
                    value = resolve_edge(self.index, owner, edge, self.policy, self.decisions)
                    db.execute("INSERT INTO edges VALUES(?,?,?,?)",
                               (value["id"], value["fromRecordId"], value["status"], jbytes(value).decode()))
                    db.executemany("INSERT INTO targets VALUES(?,?)", [(value["id"], target) for target in value["targetRecordIds"]])
                    counts[value["status"]] += 1
            db.commit()
            db.close()
            digest = original_workspace.file_digest(temp, MAX_SOURCE)
            os.replace(temp, self.path)
            atomic_json(self.manifest_path, {"schema": GRAPH_SCHEMA, "id": self.id, "sourceId": self.index.source_id,
                "bytes": self.path.stat().st_size, "sha256": digest, "counts": dict(counts), "edges": sum(counts.values())})
        finally:
            try:
                db.close()
            except Exception:
                pass
            temp.unlink(missing_ok=True)

    def close(self):
        self.db.close()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()

    def outgoing(self, record_id):
        return [json_value(r[0]) for r in self.db.execute("SELECT body FROM edges WHERE from_id=? ORDER BY rowid", (record_id,))]

    def incoming(self, record_id):
        return [json_value(r[0]) for r in self.db.execute("""SELECT e.body FROM edges e JOIN targets t ON t.edge_id=e.id
            WHERE t.target_id=? ORDER BY e.rowid""", (record_id,))]

    def all_edges(self):
        for row in self.db.execute("SELECT body FROM edges ORDER BY rowid"):
            yield json_value(row[0])

    def edges(self, status=None, offset=0, limit=50, query=""):
        clauses, args = [], []
        if status:
            clauses.append("status=?")
            args.append(status)
        if query:
            if not isinstance(query, str) or len(query) > 1000:
                raise InputError("Reference search must be at most 1,000 characters")
            clauses.append("body LIKE ? ESCAPE '\\'")
            args.append("%" + query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%")
        where = " WHERE " + " AND ".join(clauses) if clauses else ""
        total = self.db.execute("SELECT count(*) FROM edges" + where, args).fetchone()[0]
        def fetch(*a, limit, offset):
            return self.db.execute("SELECT body FROM edges" + where + " ORDER BY rowid LIMIT ? OFFSET ?", (*a, limit, offset))
        return _page(fetch, args, offset=offset, limit=limit, encode=lambda r: json_value(r[0]), total=total)

def graph_document(index, policy, decisions=None, resolution=None):
    counts, careplans = Counter(), []
    for row in index.all_rows("CarePlan"):
        careplans.append(public_row(row, False))
    if resolution is not None:
        counts.update(resolution.manifest["counts"])
    else:
        for owner in index.all_rows():
            for edge in index.outgoing(owner["recordId"]):
                counts[resolve_edge(index, owner, edge, policy, decisions)["status"]] += 1
    return {"sourceId": index.source_id, "policy": policy,
            "summary": {"resources": index.manifest["resources"], "edges": sum(counts.values()),
                        "carePlans": len(careplans), **dict(counts)},
            "carePlans": careplans}


def resolved_edges(index, policy, decisions=None):
    for owner in index.all_rows():
        for edge in index.outgoing(owner["recordId"]):
            yield resolve_edge(index, owner, edge, policy, decisions)


def closure(index, selected, policy, decisions=None, scope="forward"):
    if scope not in {"forward", "connected", "edition"}:
        raise InputError("Choose the explicit receiving graph scope")
    all_ids = {row[0] for row in index.db.execute("SELECT record_id FROM nodes")}
    if any(r not in all_ids for r in selected):
        raise InputError("Receiving selection includes an unknown original resource")
    if scope == "edition":
        return all_ids
    adjacency = {}
    for edge in resolved_edges(index, policy, decisions):
        for target in edge["targetRecordIds"]:
            adjacency.setdefault(edge["fromRecordId"], set()).add(target)
            if scope == "connected":
                adjacency.setdefault(target, set()).add(edge["fromRecordId"])
    # A complete resource body includes its contained resources. Keep those
    # original identities within the same handoff even if not directly referenced.
    for child, parent in index.db.execute("SELECT record_id,contained_in FROM nodes WHERE contained_in IS NOT NULL"):
        adjacency.setdefault(parent, set()).add(child)
        adjacency.setdefault(child, set()).add(parent)
    for child, parent in index.db.execute("SELECT record_id,json_extract(metadata,'$.bundleIn') FROM nodes WHERE json_extract(metadata,'$.bundleIn') IS NOT NULL"):
        adjacency.setdefault(parent, set()).add(child)
        adjacency.setdefault(child, set()).add(parent)
    seen, pending = set(selected), deque(selected)
    while pending:
        for target in adjacency.get(pending.popleft(), ()):
            if target not in seen:
                seen.add(target)
                pending.append(target)
    return seen


def values_at(root, tokens, base=()):
    values = [(root, tuple(base))]
    for token in tokens:
        found = []
        for value, at in values:
            if token == "*" and isinstance(value, list):
                found.extend((child, at + (str(i),)) for i, child in enumerate(value))
            elif isinstance(value, dict) and token in value:
                found.append((value[token], at + (token,)))
            elif isinstance(value, list) and re.fullmatch(r"0|[1-9][0-9]*", token):
                number = int(token)
                if number < len(value):
                    found.append((value[number], at + (token,)))
        values = found
    return values


def path_matches(pattern, actual):
    return len(pattern) == len(actual) and all(a == b or a == "*" and re.fullmatch(r"0|[1-9][0-9]*", b) for a, b in zip(pattern, actual))


def predicates_match(resource, predicates):
    predicates = list(predicates or [])
    # Predicates sharing an array wildcard bind to the same original element;
    # system/code pairs cannot accidentally match two unrelated codings.
    groups = {}
    for number, condition in enumerate(predicates):
        path = condition["path"]
        if "*" in path:
            at = path.index("*")
            groups.setdefault(tuple(path[:at]), []).append((number, condition, at))
    handled = set()
    for prefix, group in groups.items():
        if len(group) < 2:
            continue
        candidates = values_at(resource, list(prefix) + ["*"])
        reduced = [{**c, "path": c["path"][at + 1:]} for _, c, at in group]
        if not any(predicates_match(value, reduced) for value, _ in candidates):
            return False
        handled.update(number for number, _, _ in group)
    for number, condition in enumerate(predicates):
        if number in handled:
            continue
        values = values_at(resource, condition["path"])
        operator = condition["operator"]
        if operator == "exists":
            expected = json_value(condition.get("valueJson", "true"), lexical=True)
            if type(expected) is not bool or bool(values) != expected:
                return False
        else:
            wanted = json_value(condition["valueJson"], lexical=True)
            possible = wanted if operator == "one-of" else [wanted]
            if not isinstance(possible, list):
                raise InputError("A one-of predicate requires a complete JSON array")
            canonicals = {lexical_json(v) for v in possible}
            if not any(lexical_json(value) in canonicals for value, _ in values):
                return False
    return True


def select_field(index, careplan_id, selectors, policy, decisions=None, resolution=None):
    if resolution is None:
        with Resolution(index, policy, decisions) as retained:
            return select_field(index, careplan_id, selectors, policy, decisions, retained)
    from functools import lru_cache
    row_at = lru_cache(maxsize=2)(index.row)
    unique, unresolved, unresolved_ids, byte_count = {}, [], set(), 0
    for selector_index, selector in enumerate(selectors):
        # Keep locators between steps, never thousands of decoded resource copies.
        current = [(careplan_id, ())]
        for step in selector["steps"]:
            next_values = {}
            for rid, at in current:
                row = row_at(rid)
                selected_values = values_at(row["_resource"], list(at))
                if not selected_values:
                    continue
                value = selected_values[0][0]
                if step["direction"] == "value":
                    if step.get("resourceType") and row["resourceType"] != step["resourceType"]:
                        continue
                    for selected, position in values_at(value, step["path"], at):
                        if predicates_match(selected, step.get("where")):
                            next_values[(rid, position)] = None
                else:
                    if step["direction"] == "out":
                        edges = resolution.db.execute("SELECT body FROM edges WHERE from_id=? ORDER BY rowid", (rid,))
                    else:
                        edges = resolution.db.execute("""SELECT e.body FROM edges e JOIN targets t ON t.edge_id=e.id
                            WHERE t.target_id=? ORDER BY e.rowid""", (rid,))
                    for entry in edges:
                        edge = json_value(entry[0])
                        if not path_matches((list(at) if step["direction"] == "out" else []) + step["path"], edge["path"]):
                            continue
                        target_ids = edge["targetRecordIds"] if step["direction"] == "out" else [edge["fromRecordId"]]
                        if not target_ids and (selector_index, edge["id"]) not in unresolved_ids:
                            unresolved_ids.add((selector_index, edge["id"]))
                            unresolved.append({"selector": selector_index, "edgeId": edge["id"], "reference": edge["reference"],
                                               "status": edge["status"], "reason": edge["reason"]})
                        for target in target_ids:
                            target_row = row_at(target)
                            if step.get("resourceType") and target_row["resourceType"] != step["resourceType"]:
                                continue
                            if predicates_match(target_row["_resource"], step.get("where")):
                                next_values[(target, ())] = None
                if len(next_values) + len(unresolved) > 25000:
                    raise InputError("One field selector exceeds 25,000 exact source matches; narrow the reviewed path")
            current = list(next_values)
        for rid, at in current:
            row = row_at(rid)
            matches = values_at(row["_resource"], list(at))
            if not matches:
                continue
            value = {"selector": selector_index, "selectorLabel": selector.get("label", ""),
                "sourceId": index.source_id, "recordId": rid, "memberId": row["memberId"],
                "pointer": row["entryPointer"] + pointer(at), "jsonText": lexical_json(matches[0][0]),
                "resourceSha256": row["resourceSha256"]}
            key = (value["recordId"], value["pointer"], value["jsonText"])
            if key not in unique:
                byte_count += len(jbytes(value))
                if byte_count > 16 * 1024 * 1024:
                    raise InputError("One field cell exceeds 16 MiB of complete values; narrow the reviewed selector")
                unique[key] = value
    return list(unique.values()), unresolved
