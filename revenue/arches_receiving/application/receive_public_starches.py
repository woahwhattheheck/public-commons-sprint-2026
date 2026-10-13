#!/usr/bin/env python3
"""Receive one original public Starches resource and its declared Arches context.

The existing arches_source.py / Workspace remain the semantic validator and
staff review/release engine. This file only retains original public sources.
"""
import argparse
import contextlib
import datetime as dt
import fcntl
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile
import urllib.parse
import urllib.request
import uuid

SCHEMA = "commons.starches-public-source-receiving.v1"
COHORT_SCHEMA = "commons.flax-arches-two-edition-cohort.v1"
CASE = "arches-public-source-receiving"
SIGNATURE = b"pagefind_dcd"
HASH_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$")
EDITION_RE = re.compile(r"^[a-z][a-z0-9_-]{0,63}$")


class SourceError(Exception):
    pass


class SourceMissing(SourceError):
    pass


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def sha(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def loads(data):
    def duplicates(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise SourceError("Duplicate JSON key: " + key)
            result[key] = value
        return result
    try:
        return json.loads(data, object_pairs_hook=duplicates,
                          parse_constant=lambda value: (_ for _ in ()).throw(SourceError("Non-finite JSON token: " + value)))
    except (ValueError, UnicodeError) as exc:
        raise SourceError("Invalid original UTF-8 JSON") from exc


def object_value(value, label):
    if not isinstance(value, dict):
        raise SourceError(label + " must be an object")
    return value


def identifier(value, label):
    if not isinstance(value, str):
        raise SourceError(label + " is not a UUID string")
    try:
        result = str(uuid.UUID(value))
    except ValueError as exc:
        raise SourceError(label + " is not a UUID") from exc
    if value.lower() != result:
        raise SourceError(label + " is not a canonical UUID")
    return result


def private_file(path, limit):
    path = Path(path)
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode):
        raise SourceError("Selected input is not a regular file: " + str(path))
    if info.st_size > limit:
        raise SourceError("Selected input exceeds its declared maximum: " + str(path))
    with path.open("rb") as handle:
        data = handle.read(limit + 1)
    if len(data) > limit or len(data) != info.st_size:
        raise SourceError("Selected input changed or exceeds its declared maximum: " + str(path))
    return data


def atomic_bytes(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temporary = tempfile.mkstemp(prefix="." + path.name + ".", dir=path.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(temporary)


def origin_value(value):
    parsed = urllib.parse.urlsplit(value)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise SourceError("Source origin must be an HTTPS origin without credentials")
    if parsed.query or parsed.fragment or parsed.path not in ("", "/"):
        raise SourceError("Source origin cannot contain a path, query or fragment")
    return urllib.parse.urlunsplit(("https", parsed.netloc.lower(), "", "", ""))


class SameOriginRedirect(urllib.request.HTTPRedirectHandler):
    def __init__(self, origin):
        self.origin = origin

    def redirect_request(self, request, fp, code, message, headers, newurl):
        if origin_value(urllib.parse.urlunsplit((*urllib.parse.urlsplit(newurl)[:2], "", "", ""))) != self.origin:
            raise SourceError("Public source redirected outside the selected origin")
        return super().redirect_request(request, fp, code, message, headers, newurl)


class Receiver:
    def __init__(self, root, selection, response_map, offline, timeout, per_file, total):
        self.root = root
        self.selection = selection
        self.offline = offline
        self.timeout = timeout
        self.per_file = per_file
        self.total = total
        self.map_path = Path(response_map).resolve() if response_map else None
        self.responses = {}
        if self.map_path:
            mapped = object_value(loads(private_file(self.map_path, 8 * 1024 * 1024)), "Response map")
            if mapped.get("schema") != "commons.starches-original-responses.v1":
                raise SourceError("Unsupported original-response map schema")
            for item in mapped.get("responses", []):
                object_value(item, "Original response")
                if item.get("url") in self.responses:
                    raise SourceError("Duplicate original-response URL")
                if not isinstance(item.get("path"), str) or not re.fullmatch(r"[0-9a-f]{64}", str(item.get("sha256", ""))):
                    raise SourceError("Original response requires a path and exact SHA-256")
                if not isinstance(item.get("bytes"), int) or isinstance(item.get("bytes"), bool) or item["bytes"] < 0:
                    raise SourceError("Original response requires its actual byte count")
                self.responses[item.get("url")] = item
        self.journal_path = root / "source-receiving.json"
        if self.journal_path.exists():
            self.state = object_value(loads(private_file(self.journal_path, 8 * 1024 * 1024)), "Receiving state")
            if self.state.get("schema") != SCHEMA or self.state.get("selection") != selection:
                raise SourceError("Existing receiving directory belongs to another source selection")
        else:
            self.state = {"schema": SCHEMA, "case_id": CASE, "selection": selection,
                          "created_at": now(), "state": "RECEIVING", "files": {}, "errors": []}
            self.save()
        if not isinstance(self.state.get("files"), dict):
            raise SourceError("Invalid retained receiving files")
        self.opener = urllib.request.build_opener(SameOriginRedirect(selection["origin"]))

    def save(self):
        self.state["updated_at"] = now()
        atomic_bytes(self.journal_path, (canonical(self.state) + "\n").encode())

    def target(self, relative):
        parts = Path(relative).parts
        if not parts or Path(relative).is_absolute() or any(p in ("", ".", "..") for p in parts):
            raise SourceError("Invalid private receiving path")
        current = self.root
        for part in parts:
            current = current / part
            if current.is_symlink():
                raise SourceError("Receiving path contains a symbolic link")
        return current

    def verify(self, descriptor):
        path = self.target(descriptor["path"])
        data = private_file(path, self.per_file)
        if len(data) != descriptor["bytes"] or sha(data) != descriptor["sha256"]:
            raise SourceError("Retained source identity changed: " + descriptor["path"])
        return data

    def receive(self, path, relative):
        url = self.selection["origin"] + path
        if not path.startswith("/") or urllib.parse.urlsplit(url).netloc != urllib.parse.urlsplit(self.selection["origin"]).netloc:
            raise SourceError("Source path is outside the selected public origin")
        existing = self.state["files"].get(relative)
        if existing:
            if existing["url"] != url:
                raise SourceError("Existing selected source has a different URL")
            return self.verify(existing)
        remaining = self.total - sum(f["bytes"] for f in self.state["files"].values())
        allowed = min(self.per_file, remaining)
        if allowed <= 0:
            raise SourceError("Complete selected source exceeds the declared total byte budget")
        observation = {"observed_at": now()}
        if url in self.responses:
            item = self.responses[url]
            selected = Path(item["path"])
            if not selected.is_absolute():
                selected = self.map_path.parent / selected
            data = private_file(selected, allowed)
            if len(data) != item["bytes"] or sha(data) != item["sha256"]:
                raise SourceError("Retained original response identity differs: " + url)
            observation = {
                "transport": "retained_original_response",
                "received_at": now(),
                "observed_at": item.get("observed_at"),
                "original_receipt": item.get("receipt"),
                "http": item.get("http"),
            }
        elif self.offline:
            raise SourceMissing("Original response is needed for " + url)
        else:
            request = urllib.request.Request(url, headers={"User-Agent": "Commons-Arches-Source-Receiver/1.0", "Accept-Encoding": "identity"})
            with self.opener.open(request, timeout=self.timeout) as response:
                status = getattr(response, "status", None)
                if status != 200:
                    raise SourceError("Original source returned HTTP " + str(status))
                final = response.geturl()
                if urllib.parse.urlsplit(final).netloc != urllib.parse.urlsplit(self.selection["origin"]).netloc:
                    raise SourceError("Final source URL is outside the selected origin")
                chunks, count = [], 0
                while True:
                    chunk = response.read(min(262144, allowed - count + 1))
                    if not chunk:
                        break
                    count += len(chunk)
                    if count > allowed:
                        raise SourceError("Original source exceeds its declared byte budget: " + url)
                    chunks.append(chunk)
                data = b"".join(chunks)
                length = response.headers.get("Content-Length")
                if length and int(length) != len(data):
                    raise SourceError("Original response ended before its declared Content-Length")
                observation = {"transport": "direct_public_https", "observed_at": now(),
                               "http": {"status": status, "final_url": final,
                                        "headers": dict(response.headers.items())}}
        descriptor = {"path": relative, "url": url, "bytes": len(data), "sha256": sha(data), **observation}
        atomic_bytes(self.target(relative), data)
        self.state["files"][relative] = descriptor
        self.save()
        return data

    def add_derived(self, relative, value, source_path):
        data = (canonical(value) + "\n").encode()
        atomic_bytes(self.target(relative), data)
        descriptor = {"path": relative, "bytes": len(data), "sha256": sha(data),
                      "derivation": source_path}
        self.state.setdefault("derived", {})[relative] = descriptor
        self.save()
        return data


def fragment_document(raw, maximum):
    if raw.startswith(SIGNATURE):
        decoded = raw
    else:
        try:
            with gzip.GzipFile(fileobj=io.BytesIO(raw), mode="rb") as handle:
                decoded = handle.read(maximum + len(SIGNATURE) + 1)
        except (OSError, EOFError) as exc:
            raise SourceError("Pagefind fragment is not the original gzip or signed payload") from exc
    if len(decoded) > maximum + len(SIGNATURE) or not decoded.startswith(SIGNATURE):
        raise SourceError("Pagefind decoded payload is too large or lacks its original pagefind_dcd signature")
    return object_value(loads(decoded[len(SIGNATURE):]), "Pagefind document")


def one_resource(raw, source_format, selected):
    envelope = object_value(loads(raw), "Original resource document")
    if source_format == "business_data":
        business = object_value(envelope.get("business_data"), "Original business_data envelope")
        records = business.get("resources")
        if not isinstance(records, list) or len(records) != 1:
            raise SourceError("Selected single-resource URL did not return exactly one business_data resource")
        record = object_value(records[0], "Original resource")
    else:
        record = envelope
    instance = object_value(record.get("resourceinstance") if "resourceinstance" in record else record, "Original resourceinstance")
    ids = [instance[k] for k in ("resourceinstanceid", "resourceid") if k in instance]
    if not ids or any(identifier(value, "resourceinstanceid/resourceid") != selected for value in ids):
        raise SourceError("Original resource identity differs from the selected public locator")
    graph_id = identifier(instance.get("graph_id"), "resource graph_id")
    if not isinstance(record.get("tiles"), list):
        raise SourceError("Original resource tiles must be an array")
    # Tile ownership/type/vocabulary diagnostics belong to arches_source.py.
    return record, graph_id


def graph_model(raw, selected):
    envelope = object_value(loads(raw), "Original graph document")
    models = envelope.get("graph")
    if not isinstance(models, list):
        raise SourceError("Original graph envelope has no graph array")
    matches = [x for x in models if isinstance(x, dict) and x.get("graphid") == selected]
    if len(matches) != 1:
        raise SourceError("Original graph document does not uniquely contain the selected graph")
    model = matches[0]
    if not isinstance(model.get("nodes"), list):
        raise SourceError("Original graph nodes must be an array")
    collections = set()
    for node in model["nodes"]:
        if not isinstance(node, dict):
            raise SourceError("Original graph node is not an object")
        if node.get("datatype") in ("concept", "concept-list"):
            config = object_value(node.get("config"), "Original concept node config")
            collection = config.get("rdmCollection")
            if collection:
                collections.add(identifier(collection, "rdmCollection"))
    return model, sorted(collections)


def collect(args):
    origin = origin_value(args.origin)
    if not EDITION_RE.fullmatch(args.edition):
        raise SourceError("Invalid edition name")
    if args.document_hash and not HASH_RE.fullmatch(args.document_hash):
        raise SourceError("Invalid actual Pagefind document hash")
    if args.resource_id:
        args.resource_id = identifier(args.resource_id, "Selected resource ID")
    notice_paths = list(dict.fromkeys(getattr(args, "notice_path", []) or []))
    if len(notice_paths) > 16:
        raise SourceError("At most sixteen original attribution/notice paths may be selected")
    for path in notice_paths:
        parsed = urllib.parse.urlsplit(path)
        if not path.startswith("/") or parsed.scheme or parsed.netloc or parsed.query or parsed.fragment:
            raise SourceError("Original notice must be a same-origin absolute path without query or fragment")
    selection = {"origin": origin, "document_hash": args.document_hash,
                 "resource_id": args.resource_id, "source_format": args.source_format,
                 "edition": args.edition, "graph_language": args.graph_language, "max_file_bytes": args.max_file_bytes,
                 "max_total_bytes": args.max_total_bytes}
    if notice_paths:
        selection["notice_paths"] = notice_paths
    root = Path(args.output).absolute()
    if root.is_symlink():
        raise SourceError("Receiving root must not be a symbolic link")
    if root.exists() and not (root / "source-receiving.json").exists() and any(root.iterdir()):
        raise SourceError("Receiving output is not an empty or original receiving directory")
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(root, 0o700)
    lock = root / ".source-receiving.lock"
    if lock.is_symlink():
        raise SourceError("Receiving lock must not be a symbolic link")
    with lock.open("a+b") as lockfile:
        fcntl.flock(lockfile, fcntl.LOCK_EX | fcntl.LOCK_NB)
        receiver = Receiver(root, selection, args.response_map, args.offline, args.timeout,
                            args.max_file_bytes, args.max_total_bytes)
        try:
            if receiver.state.get("state") == "COMPLETE":
                for descriptor in receiver.state["files"].values():
                    receiver.verify(descriptor)
                for descriptor in receiver.state.get("derived", {}).values():
                    receiver.verify(descriptor)
                cohort = private_file(root / "COHORT.json", 8 * 1024 * 1024)
                if sha(cohort) != receiver.state["cohort"]["sha256"]:
                    raise SourceError("Completed COHORT.json identity changed")
                return loads(cohort), root
            selected = args.resource_id
            locator = None
            if args.document_hash:
                raw = receiver.receive("/pagefind/fragment/" + args.document_hash + ".pf_fragment",
                                       "sources/locator/" + args.document_hash + ".pf_fragment")
                locator = fragment_document(raw, args.max_file_bytes)
                meta = object_value(locator.get("meta"), "Pagefind metadata")
                selected = identifier(meta.get("slug"), "Pagefind meta.slug")
                receiver.add_derived("sources/locator/pagefind-document.json", locator,
                                     "sources/locator/" + args.document_hash + ".pf_fragment")
                receiver.state["selected_resource_id"] = selected
                receiver.save()
            raw = receiver.receive("/definitions/business_data/" + selected + ".json",
                                   "sources/" + args.edition + "/resource.json")
            record, graph_id = one_resource(raw, args.source_format, selected)
            registry = object_value(loads(receiver.receive("/definitions/graphs/_all.json", "sources/context/graph-registry.json")), "Graph registry")
            models = object_value(registry.get("models"), "Graph registry models")
            meta = object_value(models.get(graph_id), "Selected graph registry metadata")
            name = meta.get("name")
            if isinstance(name, dict):
                name = name.get(args.graph_language)
            if not isinstance(name, str) or not name or "/" in name or "\\" in name or name in (".", ".."):
                raise SourceError("Selected graph registry name is not a safe original model filename")
            graph_path = "sources/context/graph-" + graph_id + ".json"
            graph_bytes = receiver.receive("/definitions/graphs/resource_models/" + urllib.parse.quote(name, safe="") + ".json", graph_path)
            model, collection_ids = graph_model(graph_bytes, graph_id)
            collection_paths = []
            for collection_id in collection_ids:
                relative = "sources/context/collection-" + collection_id + ".json"
                body = receiver.receive("/definitions/reference_data/collections/" + collection_id + ".json", relative)
                collection = object_value(loads(body), "Original controlled-vocabulary collection")
                if identifier(collection.get("id"), "Original collection id") != collection_id:
                    raise SourceError("Original collection identity differs from the graph declaration")
                collection_paths.append(relative)
            notice_files = []
            for index, path in enumerate(notice_paths, 1):
                relative = "sources/notices/" + str(index).zfill(3) + ".original"
                receiver.receive(path, relative)
                notice_files.append(relative)
            public_url = locator.get("url") if locator else None
            if public_url:
                public_url = urllib.parse.urljoin(origin + "/", public_url)
                if urllib.parse.urlsplit(public_url).netloc != urllib.parse.urlsplit(origin).netloc:
                    raise SourceError("Pagefind asset URL is outside the selected public origin")
            edition = {"resources": ["sources/" + args.edition + "/resource.json"],
                       "graphs": [graph_path], "collections": collection_paths, "licenses": [],
                       "resource_id": selected, "graph_id": graph_id,
                       "source_format": args.source_format, "source_url": public_url,
                       "original_notice_files": notice_files,
                       "coverage": "partial", "source_scope": "one original public resource plus its declared graph and concept collections"}
            cohort = {"schema": COHORT_SCHEMA, "case_id": CASE,
                      "source_kind": "original deployed public Starches sources",
                      "source_origin": origin, "source_format": args.source_format,
                      "files": list(receiver.state["files"].values()),
                      "derived_files": list(receiver.state.get("derived", {}).values()),
                      "editions": {args.edition: edition},
                      "rights": {"license_assertion": None,
                                 "original_notice_files": notice_files,
                                 "notice": "Source is the publisher's public view. No publisher code license is asserted to license these asset records. Retain observed attribution and obtain the selected-use terms in the existing staff commissioning workflow."}}
            body = (canonical(cohort) + "\n").encode()
            atomic_bytes(root / "COHORT.json", body)
            receiver.state.update({"state": "COMPLETE", "completed_at": now(),
                                   "selected_resource_id": selected, "graph_id": graph_id,
                                   "cohort": {"path": "COHORT.json", "bytes": len(body), "sha256": sha(body)}})
            receiver.save()
            return cohort, root
        except BaseException as exc:
            if receiver.state.get("state") == "COMPLETE":
                raise
            receiver.state["state"] = "NEEDS_SOURCE" if isinstance(exc, SourceMissing) else "INTERRUPTED"
            receiver.state["errors"].append({"at": now(), "type": type(exc).__name__, "message": str(exc)})
            receiver.save()
            raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--origin", required=True)
    selection = parser.add_mutually_exclusive_group(required=True)
    selection.add_argument("--document-hash", help="Actual hash returned by the publisher's spatial index or Pagefind")
    selection.add_argument("--resource-id", help="Actual public resource UUID already observed in original source")
    parser.add_argument("--source-format", required=True, choices=("resource", "business_data"))
    parser.add_argument("--output", required=True)
    parser.add_argument("--edition", default="live")
    parser.add_argument("--graph-language", default="en", help="Exact retained graph-name language key; preserve its spelling and spaces")
    parser.add_argument("--notice-path", action="append", default=[], help="Optional original same-origin attribution/notice path; repeat up to sixteen times (for example / or /faq/)")
    parser.add_argument("--response-map", help="Retained original-response map; no signed transport URL is persisted")
    parser.add_argument("--offline", action="store_true", help="Read only retained original responses; report the exact next required source URL")
    parser.add_argument("--timeout", type=float, default=30)
    parser.add_argument("--max-file-bytes", type=int, default=32 * 1024 * 1024)
    parser.add_argument("--max-total-bytes", type=int, default=128 * 1024 * 1024)
    args = parser.parse_args()
    if not 0 < args.timeout <= 300 or not 1024 <= args.max_file_bytes <= args.max_total_bytes <= 1024 * 1024 * 1024:
        parser.error("Specify positive bounded source limits (maximum total 1 GiB)")
    os.umask(0o077)
    try:
        cohort, root = collect(args)
        print(canonical({"state": "COMPLETE", "directory": str(root), "files": len(cohort["files"]),
                         "editions": cohort["editions"]}))
    except (SourceError, OSError) as exc:
        print(canonical({"state": "NEEDS_SOURCE" if isinstance(exc, SourceMissing) else "INTERRUPTED",
                         "error": type(exc).__name__, "message": str(exc)}), file=sys.stderr)
        return 2 if isinstance(exc, SourceMissing) else 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
