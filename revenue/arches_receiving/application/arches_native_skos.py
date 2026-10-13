"""Receive original Arches 8.1 SKOS exports into explicit review context.

Consumes local original graph JSON plus BOTH concept/scheme and collection RDF/XML.
No network, platform writes, identifier invention, or source-record rewriting.
Uses the original arches_source exact JSON/identity implementation.
"""
from __future__ import annotations
import argparse
import hashlib
import os
import re
import shutil
import stat
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.parse import urljoin, urlsplit

from arches_source import canonical_json, loads_json, inspect_context, hash_file, SourceError

SCHEMA = "commons.arches-native-skos-context.v1"
PIN = "2127517966462ea024ffb000b2e1fd46bf66d6dd"
RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#"
SKOS = "http://www.w3.org/2004/02/skos/core#"
DCT = "http://purl.org/dc/terms/"
XML = "http://www.w3.org/XML/1998/namespace"
UUID = re.compile(r"^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$")
MAX_FILE = 64 * 1024 * 1024
MAX_TOTAL = 256 * 1024 * 1024
MAX_SUBJECTS = 500000
MAX_DEPTH = 128

def _sha(raw):
    return hashlib.sha256(raw).hexdigest()

def _problem(rows, code, message, **details):
    rows.append({"code": code, "severity": "error", "message": message, **details})

def _regular(path):
    path = Path(path)
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(path, flags)
    try:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or before.st_size > MAX_FILE:
            raise SourceError("NATIVE_SOURCE_FILE", "Select a regular original source within the per-file limit.")
        pieces, count = [], 0
        while True:
            piece = os.read(fd, 1024 * 1024)
            if not piece:
                break
            count += len(piece)
            if count > MAX_FILE:
                raise SourceError("NATIVE_SOURCE_SIZE", "An original source exceeds the per-file limit.")
            pieces.append(piece)
        after = os.fstat(fd)
        current = os.stat(path, follow_symlinks=False)
        identity = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
        if identity(before) != identity(after) or identity(after) != identity(current):
            raise SourceError("NATIVE_SOURCE_CHANGED", "An original source changed while receiving.")
        raw = b"".join(pieces)
        if len(raw) != before.st_size:
            raise SourceError("NATIVE_SOURCE_CHANGED", "An original source did not finish receiving.")
        return raw, {"name": path.name, "bytes": len(raw), "sha256": _sha(raw)}
    finally:
        os.close(fd)

def _explicit_id(uri):
    if not isinstance(uri, str) or not uri:
        return None
    if uri.startswith("urn:uuid:"):
        candidate = uri[len("urn:uuid:"):]
    else:
        parts = urlsplit(uri)
        if not parts.scheme:
            return None
        candidate = parts.fragment or parts.path.rstrip("/").rsplit("/", 1)[-1]
    return candidate if UUID.fullmatch(candidate or "") else None

def _resolve(value, base):
    if not isinstance(value, str):
        return None
    return urljoin(base, value) if base else value

def _parse(raw, source, subjects, global_issues):
    # The publisher emits UTF-8 RDF/XML. Entity/DTD expansion and external
    # resolution are outside this explicit local-source format.
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeError as exc:
        raise SourceError("SKOS_UTF8", "The selected native RDF/XML must be UTF-8.") from exc
    if re.search(r"<!\s*(?:DOCTYPE|ENTITY)", text, re.I):
        raise SourceError("SKOS_DTD", "Select the original RDF/XML without DTD or entity declarations.")
    try:
        root = ET.fromstring(text)
    except ET.ParseError as exc:
        raise SourceError("SKOS_XML", "The original native source is not complete RDF/XML.") from exc
    if root.tag != "{" + RDF + "}RDF":
        raise SourceError("SKOS_ROOT", "The selected source needs its original rdf:RDF document.")
    def walk(element, base="", language=None, depth=0):
        if depth > MAX_DEPTH:
            raise SourceError("SKOS_DEPTH", "The original RDF/XML exceeds the receiving depth limit.")
        base = _resolve(element.get("{" + XML + "}base", ""), base) or base
        language = element.get("{" + XML + "}lang", language)
        about = element.get("{" + RDF + "}about")
        if about is not None:
            uri = _resolve(about, base)
            item = subjects.setdefault(uri, {"uri": uri, "id": _explicit_id(uri),
                "types": set(), "members": set(), "labels": [], "relations": [],
                "sources": set(), "issues": []})
            if len(subjects) > MAX_SUBJECTS:
                raise SourceError("SKOS_SUBJECT_LIMIT", "The original source exceeds the configured subject limit.")
            item["sources"].add(source["sha256"])
            if element.tag.startswith("{" + SKOS + "}"):
                item["types"].add(SKOS + element.tag.split("}", 1)[1])
            elif element.tag != "{" + RDF + "}Description":
                item["types"].add(element.tag.replace("{", "").replace("}", ""))
            for prop in element:
                pbase = _resolve(prop.get("{" + XML + "}base", ""), base) or base
                lang = prop.get("{" + XML + "}lang", language)
                predicate = prop.tag.replace("{", "").replace("}", "")
                target = prop.get("{" + RDF + "}resource")
                objects = []
                if target is not None:
                    objects.append(_resolve(target, pbase))
                for child in prop:
                    if child.get("{" + RDF + "}about") is not None:
                        child_base = _resolve(child.get("{" + XML + "}base", ""), pbase) or pbase
                        objects.append(_resolve(child.get("{" + RDF + "}about"), child_base))
                if predicate == RDF + "type":
                    item["types"].update(objects)
                elif predicate == SKOS + "member":
                    if not objects:
                        _problem(item["issues"], "SKOS_MEMBER_ID", "An original member lacks its explicit subject URI.", subject=uri)
                    item["members"].update(objects)
                if objects:
                    item["relations"].extend({"predicate": predicate, "object": obj} for obj in objects)
                if not objects and len(prop) == 0 and predicate != RDF + "type":
                    literal = "".join(prop.itertext())
                    try:
                        value = loads_json(literal)
                    except SourceError:
                        value = None
                    if not isinstance(value, dict) or not isinstance(value.get("value"), str) or not UUID.fullmatch(value.get("id", "") if isinstance(value.get("id"), str) else ""):
                        _problem(item["issues"], "SKOS_VALUE_ID", "A native Value literal lacks its original JSON Value UUID and text.",
                                 subject=uri, predicate=predicate, language=lang)
                    elif not isinstance(lang, str) or not lang:
                        _problem(item["issues"], "SKOS_VALUE_LANGUAGE", "A native Value needs its original explicit language tag.",
                                 subject=uri, value_id=value["id"])
                    else:
                        item["labels"].append({"id": value["id"], "value": value["value"],
                            "language": lang, "predicate": predicate, "source_sha256": source["sha256"]})
        for child in element:
            walk(child, base, language, depth + 1)
    walk(root)

def _pref_labels(subject, issues):
    result = {}
    for label in subject["labels"]:
        if label["predicate"] != SKOS + "prefLabel":
            continue
        lang = label["language"]
        value = {"id": label["id"], "value": label["value"]}
        prior = result.get(lang)
        if prior is not None and prior != value:
            _problem(issues, "SKOS_PREFLABEL_CONFLICT", "More than one preferred Value is bound to the same original language.",
                     subject=subject["uri"], language=lang)
        else:
            result[lang] = value
    return result

def resolve_native_skos(skos_paths, *, collection_ids):
    """Resolve explicitly selected collections; return derived documents and full original sources."""
    if not skos_paths or not collection_ids or len(set(collection_ids)) != len(collection_ids):
        raise SourceError("SKOS_SELECTION", "Select the original RDF/XML files and distinct collection UUIDs.")
    if any(not isinstance(x, str) or not UUID.fullmatch(x) for x in collection_ids):
        raise SourceError("SKOS_SELECTION_ID", "Select literal collection UUIDs.")
    originals, subjects, issues, total = [], {}, [], 0
    seen_files = set()
    for path in skos_paths:
        raw, identity = _regular(path)
        total += len(raw)
        if total > MAX_TOTAL:
            raise SourceError("SKOS_TOTAL_SIZE", "The selected original context exceeds the total receiving limit.")
        if identity["sha256"] in seen_files:
            raise SourceError("SKOS_DUPLICATE_SOURCE", "Select each unchanged original RDF/XML file once.")
        seen_files.add(identity["sha256"])
        originals.append({"identity": identity, "raw": raw})
        _parse(raw, identity, subjects, issues)
    by_id = {}
    for uri, subject in subjects.items():
        if subject["id"]:
            by_id.setdefault(subject["id"], []).append(subject)
    documents = {}
    value_assertions = {}
    for subject in subjects.values():
        for value in subject["labels"]:
            binding = (subject["uri"], value["predicate"], value["language"], value["value"])
            value_assertions.setdefault(value["id"], set()).add(binding)
    sources = sorted((x["identity"] for x in originals), key=lambda x: x["sha256"])
    source_identity = _sha(canonical_json({"schema": SCHEMA, "sources": sources}).encode("utf-8"))
    for cid in collection_ids:
        roots = [x for x in by_id.get(cid, []) if SKOS + "Collection" in x["types"]]
        local = []
        if len(roots) != 1:
            _problem(issues, "SKOS_COLLECTION_SELECTION", "The selected collection must have exactly one explicit original subject.",
                     collection_id=cid, subjects=[x["uri"] for x in roots])
            continue
        root = roots[0]
        selected, selected_collections, visited = {}, {}, set()
        def members(subject, stack):
            uri = subject["uri"]
            if uri in stack:
                _problem(local, "SKOS_COLLECTION_CYCLE", "Original collection membership contains a cycle.", subject=uri)
                return
            if uri in visited:
                return
            visited.add(uri)
            local.extend(subject["issues"])
            if not subject["id"]:
                _problem(local, "SKOS_EXPLICIT_UUID", "An original selected subject has no explicit UUID.", subject=uri)
                return
            # Multiple source URIs with one UUID require an explicit source reconciliation.
            if len(by_id.get(subject["id"], [])) != 1:
                _problem(local, "SKOS_SUBJECT_ID_CONFLICT", "Different original subject URIs use one UUID.",
                         subject_id=subject["id"], subjects=[x["uri"] for x in by_id[subject["id"]]])
            # Value PK identity applies to every literal, including Collection
            # labels, alternate labels, notes, identifiers and native custom Values.
            for value in subject["labels"]:
                bindings = value_assertions[value["id"]]
                if len(bindings) != 1:
                    _problem(local, "SKOS_VALUE_BINDING_CONFLICT",
                             "The same original Value UUID has conflicting subject/type/language/text bindings.",
                             value_id=value["id"], subject=uri,
                             bindings=[list(x) for x in sorted(bindings)])
            is_collection = SKOS + "Collection" in subject["types"]
            is_concept = SKOS + "Concept" in subject["types"]
            if is_collection and is_concept:
                _problem(local, "SKOS_SUBJECT_TYPE_CONFLICT", "The selected subject is both Collection and Concept.", subject=uri)
                return
            if is_collection:
                selected_collections[subject["id"]] = {"uri": uri, "members": sorted(subject["members"])}
                for target in sorted(subject["members"]):
                    child = subjects.get(target)
                    if child is None:
                        _problem(local, "SKOS_MEMBER_MISSING", "A selected collection member has no original subject definition.",
                                 subject=uri, member=target)
                    else:
                        members(child, stack | {uri})
            elif is_concept:
                labels = _pref_labels(subject, local)
                if not labels:
                    _problem(local, "SKOS_CONCEPT_VALUES_MISSING", "The selected member lacks its scheme's original preferred Value labels.",
                             concept_id=subject["id"], subject=uri)
                selected[subject["id"]] = {"id": subject["id"], "prefLabels": labels,
                    "native_subject": uri,
                    "native_values": sorted(subject["labels"], key=lambda x: (x["predicate"], x["language"], x["id"], x["source_sha256"])),
                    "native_relations": [list(x) for x in sorted({(x["predicate"], x["object"]) for x in subject["relations"]})]}
            else:
                _problem(local, "SKOS_MEMBER_TYPE", "A selected member needs its explicit Concept or Collection type.", subject=uri)
        members(root, set())
        root_labels = _pref_labels(root, local)
        if not selected:
            _problem(local, "SKOS_COLLECTION_EMPTY", "The selected collection contains no fully identified concepts.", collection_id=cid)
        issues.extend({**x, "selected_collection_id": cid} for x in local)
        documents[cid] = {"id": cid, "prefLabels": root_labels, "concepts": selected,
            "__native_source": {"schema": SCHEMA, "publisher_source_commit": PIN,
                "derivation": "Explicit Collection/member and Concept/preferred-Value join over unchanged original RDF/XML.",
                "source_identity": source_identity, "sources": sources,
                "selected_subject": root["uri"], "collection_membership": selected_collections}}
    return {"schema": SCHEMA, "source_identity": source_identity, "sources": sources,
        "documents": documents, "issues": issues, "blocking": bool(issues),
        "subjects": len(subjects), "originals": originals}

def _write(path, raw):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        view = memoryview(raw)
        while view:
            written = os.write(fd, view)
            if written <= 0:
                raise OSError("Original output write stopped.")
            view = view[written:]
        os.fsync(fd)
    finally:
        os.close(fd)

def _json_bytes(value):
    return (canonical_json(value) + "\n").encode("utf-8")

def receive_native_context(*, skos_paths, graph_paths, collection_ids, output):
    """Produce a complete source-bound context packet; blocked inputs emit originals/diagnostics only."""
    output = Path(output).absolute()
    if output.exists() or output.is_symlink():
        raise SourceError("NATIVE_OUTPUT_EXISTS", "Choose a new owned output directory; keep the prior complete edition.")
    output.parent.mkdir(parents=True, exist_ok=True)
    resolved = resolve_native_skos(skos_paths, collection_ids=collection_ids)
    graph_originals, graph_total = [], 0
    for path in graph_paths:
        raw, identity = _regular(path)
        graph_total += len(raw)
        if graph_total + sum(x["bytes"] for x in resolved["sources"]) > MAX_TOTAL:
            raise SourceError("NATIVE_CONTEXT_SIZE", "The complete selected context exceeds its receiving limit.")
        doc = loads_json(raw)
        if not isinstance(doc, dict) or not isinstance(doc.get("graph"), list) or not doc["graph"]:
            raise SourceError("NATIVE_GRAPH_SHAPE", "Use the original graph export's graph array.")
        graph_originals.append({"raw": raw, "identity": identity})
    if not graph_originals:
        raise SourceError("NATIVE_GRAPH_REQUIRED", "Select the exact original graph export for receiving.")
    # Atomic directory reservation; NATIVE_CONTEXT.json is written last.
    # An interrupted owned edition remains visible with its original captured bytes.
    os.mkdir(output, 0o700)
    stage = output
    manifest = {"schema": SCHEMA, "source_identity": resolved["source_identity"],
        "publisher_source_commit": PIN, "selected_collection_ids": collection_ids,
        "original_files": [], "graph_files": [], "collection_files": [],
        "issues": list(resolved["issues"]), "status": "BLOCKED", "files": []}
    try:
        for item in resolved["originals"]:
            info = item["identity"]
            rel = "original/skos/" + info["sha256"] + ".xml"
            _write(stage / rel, item["raw"])
            manifest["original_files"].append({"path": rel, **info})
        for item in graph_originals:
            info = item["identity"]
            rel = "original/graphs/" + info["sha256"] + ".json"
            if not (stage / rel).exists():
                _write(stage / rel, item["raw"])
            manifest["graph_files"].append({"path": rel, **info})
        if not resolved["blocking"]:
            # Temporary derived files are inspected by the same original adapter.
            for cid, doc in resolved["documents"].items():
                rel = "context/" + cid + ".json"
                _write(stage / rel, _json_bytes(doc))
                manifest["collection_files"].append({"path": rel, "collection_id": cid, **hash_file(stage / rel)})
            ctx = inspect_context([stage / x["path"] for x in manifest["graph_files"]],
                                  [stage / x["path"] for x in manifest["collection_files"]])
            manifest["issues"].extend(ctx["issues"])
            needed = set()
            for graph in ctx["graphs"].values():
                for node in graph["nodes"].values():
                    if node.get("datatype") in ("concept", "concept-list"):
                        config = node.get("config")
                        cid = config.get("rdmCollection") if isinstance(config, dict) else None
                        if not isinstance(cid, str) or cid not in ctx["collections"]:
                            _problem(manifest["issues"], "NATIVE_GRAPH_COLLECTION_MISSING",
                                     "Every selected graph concept node needs its original collection context.",
                                     node_id=node.get("nodeid"), collection_id=cid)
                        else:
                            needed.add(cid)
            manifest["required_collection_ids"] = sorted(needed)
            manifest["adapter_context_digest"] = ctx["digest"]
            if not any(x.get("severity") == "error" for x in manifest["issues"]):
                manifest["status"] = "READY"
            else:
                # Do not expose a seemingly usable context from a failed join.
                shutil.rmtree(stage / "context")
                manifest["collection_files"] = []
        for path in sorted(stage.rglob("*")):
            if path.is_file():
                manifest["files"].append({"path": path.relative_to(stage).as_posix(), **hash_file(path)})
        _write(stage / "NATIVE_CONTEXT.json", _json_bytes(manifest))
        return {**manifest, "manifest_sha256": hash_file(stage / "NATIVE_CONTEXT.json")["sha256"]}
    finally:
        # Preserve captured originals on failure. A missing final manifest is incomplete.
        pass

def receive_candidate(workspace, *, context_directory, source_paths, source_format,
                      scope_id, coverage, actor, operation_id, expected_revision,
                      expected_manifest_sha256, parent_release=None, notice_paths=()):
    """Use the existing complete Workspace import; originals travel as supporting source files."""
    root = Path(context_directory).resolve()
    if not isinstance(expected_manifest_sha256, str) or not re.fullmatch(r"[a-f0-9]{64}", expected_manifest_sha256):
        raise SourceError("NATIVE_MANIFEST_PIN", "Use the retained READY manifest's exact SHA256.")
    manifest_raw, manifest_identity = _regular(root / "NATIVE_CONTEXT.json")
    if manifest_identity["sha256"] != expected_manifest_sha256:
        raise SourceError("NATIVE_MANIFEST_CHANGED", "The selected complete context manifest differs from its retained identity.")
    manifest = loads_json(manifest_raw)
    if manifest.get("schema") != SCHEMA or manifest.get("status") != "READY":
        raise SourceError("NATIVE_CONTEXT_NOT_READY", "Resolve the retained original context diagnostics before receiving.")
    def member(relative):
        if not isinstance(relative, str) or "\\" in relative:
            raise SourceError("NATIVE_CONTEXT_PATH", "Use the saved portable source member.")
        p = Path(relative)
        if p.is_absolute() or ".." in p.parts:
            raise SourceError("NATIVE_CONTEXT_PATH", "Use the saved portable source member.")
        path = root / p
        if path.is_symlink() or not path.is_file() or root not in path.resolve().parents:
            raise SourceError("NATIVE_CONTEXT_PATH", "A saved source member is unavailable.")
        return path
    seen, file_index = set(), {}
    for item in manifest["files"]:
        if item["path"] in seen or hash_file(member(item["path"])) != {"bytes": item["bytes"], "sha256": item["sha256"]}:
            raise SourceError("NATIVE_CONTEXT_CHANGED", "A complete saved context member differs.")
        seen.add(item["path"])
        file_index[item["path"]] = item
    selected = manifest["graph_files"] + manifest["collection_files"] + manifest["original_files"]
    if any(x["path"] not in seen for x in selected):
        raise SourceError("NATIVE_CONTEXT_MANIFEST", "A selected original context member is outside its retained manifest.")
    for descriptor in selected:
        saved = file_index[descriptor["path"]]
        if any(descriptor.get(key) != saved[key] for key in ("bytes", "sha256")):
            raise SourceError("NATIVE_CONTEXT_DESCRIPTOR", "A selected role differs from its exact retained file descriptor.")
    # Reopen original meanings rather than trusting a saved READY/status string.
    resolved = resolve_native_skos([member(x["path"]) for x in manifest["original_files"]],
                                   collection_ids=manifest["selected_collection_ids"])
    if resolved["blocking"]:
        raise SourceError("NATIVE_CONTEXT_RESOLVE", "The retained originals no longer resolve the selected context.")
    # Source names in the manifest retain publisher names; copied files use hashes.
    restored_sources = sorted(({key: x[key] for key in ("name", "bytes", "sha256")}
                               for x in manifest["original_files"]), key=lambda x: x["sha256"])
    resolved_identity = _sha(canonical_json({"schema": SCHEMA, "sources": restored_sources}).encode("utf-8"))
    if resolved_identity != manifest["source_identity"]:
        raise SourceError("NATIVE_CONTEXT_IDENTITY", "The original SKOS file roster differs from its retained context identity.")
    if set(resolved["documents"]) != {x["collection_id"] for x in manifest["collection_files"]}:
        raise SourceError("NATIVE_CONTEXT_SELECTION", "The saved context has a different selected collection roster.")
    for selected_doc in manifest["collection_files"]:
        expected = resolved["documents"][selected_doc["collection_id"]]
        expected["__native_source"]["source_identity"] = resolved_identity
        expected["__native_source"]["sources"] = restored_sources
        actual_raw, _ = _regular(member(selected_doc["path"]))
        if canonical_json(loads_json(actual_raw)) != canonical_json(expected):
            raise SourceError("NATIVE_CONTEXT_DERIVATION", "A derived context differs from the complete original SKOS join.")
    reopened = inspect_context([member(x["path"]) for x in manifest["graph_files"]],
                               [member(x["path"]) for x in manifest["collection_files"]])
    if reopened["blocking"] or reopened["digest"] != manifest["adapter_context_digest"]:
        raise SourceError("NATIVE_CONTEXT_ADAPTER", "The original graph/context adapter does not reproduce the saved digest.")
    # Existing license_paths also retains supporting documents verbatim; the
    # native manifest explicitly identifies these XML files as original context.
    return workspace.import_candidate(source_paths=source_paths,
        graph_paths=[member(x["path"]) for x in manifest["graph_files"]],
        collection_paths=[member(x["path"]) for x in manifest["collection_files"]],
        source_format=source_format, scope_id=scope_id, coverage=coverage,
        parent_release=parent_release,
        license_paths=[member(x["path"]) for x in manifest["original_files"]] + [root / "NATIVE_CONTEXT.json"] + list(notice_paths),
        actor=actor, operation_id=operation_id, expected_revision=expected_revision)

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--skos", action="append", required=True)
    p.add_argument("--graph", action="append", required=True)
    p.add_argument("--collection", action="append", required=True)
    p.add_argument("--output", required=True)
    args = p.parse_args()
    result = receive_native_context(skos_paths=args.skos, graph_paths=args.graph,
        collection_ids=args.collection, output=args.output)
    print(canonical_json(result))
    return 0 if result["status"] == "READY" else 2

if __name__ == "__main__":
    raise SystemExit(main())
