"""MIT. Actual loopback FHIR receiving for the selected complete published examples.

This source exercise binds every original resource to its retained source ID.
It records real HTTP bodies, ETags, conditional updates, search pages and history.
It never represents an external clinical endpoint or contacts an original patient.
"""
from __future__ import annotations
from copy import deepcopy
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import os
from pathlib import Path
import re
import threading
from urllib.parse import parse_qs, urlencode, urlsplit
import uuid

from referral_runtime import InputError, source, atomic_json, private_directory, safe_read, now
from referral_exchange import comparable

SCHEMA = "stellar-forge.gravity-published-example-server.v1"

class PublishedExampleServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True
    def __init__(self, directory, source_id, rows, port=0):
        self.directory = private_directory(Path(directory))
        self.lock = threading.RLock()
        self.path = self.directory / "server-state.json"
        selected = {}
        for row in rows:
            value = source.json_value(row["jsonText"], lexical=True)
            rt, rid = value.get("resourceType"), value.get("id")
            if not isinstance(rt, str) or not isinstance(rid, str):
                continue
            if not re.fullmatch(r"[A-Za-z0-9.-]{1,64}", rid):
                continue
            key = rt + "/" + rid
            item = {"sourceId": source_id, "recordId": row["recordId"],
                    "resourceSha256": row["resourceSha256"], "jsonText": row["jsonText"]}
            if key in selected:
                if selected[key]["jsonText"] != item["jsonText"]:
                    raise InputError("Select an unambiguous original resource before publishing one local FHIR identity: " + key)
                selected[key].setdefault("alsoRecordIds", []).append(row["recordId"])
            else:
                selected[key] = item
        binding = {"sourceId": source_id, "resources": selected,
                   "classification": "published-example-http-exercise"}
        if self.path.exists():
            self.saved = source.json_value(safe_read(self.path, source.MAX_SOURCE))
            if self.saved.get("schema") != SCHEMA or self.saved["binding"] != binding:
                raise InputError("Continue the identical published source server and complete original binding")
            if port and port != self.saved["port"]:
                raise InputError("The original published-example listener has another selected port")
            port = self.saved["port"]
        else:
            self.saved = {"schema": SCHEMA, "binding": binding, "port": port,
                "createdAt": now(), "resources": {}, "receipts": [], "putCount": 0}
            for key, row in selected.items():
                self.saved["resources"][key] = {"original": row, "versions": [
                    {"versionId": "1", "recordedAt": self.saved["createdAt"],
                     "jsonText": row["jsonText"], "requestId": None, "kind": "unchanged-published-original"}]}
        super().__init__(("127.0.0.1", port), Handler)
        self.saved["port"] = self.server_address[1]
        self.base_url = "http://127.0.0.1:" + str(self.server_address[1]) + "/fhir"
        self.saved["baseUrl"] = self.base_url
        self.checkpoint()
        self.worker = threading.Thread(target=self.serve_forever, kwargs={"poll_interval": 0.1}, daemon=True)
        self.worker.start()

    def checkpoint(self):
        self.saved["updatedAt"] = now()
        atomic_json(self.path, self.saved)

    def close(self):
        self.shutdown()
        self.server_close()
        self.worker.join(timeout=10)
        with self.lock:
            self.checkpoint()

    def resource(self, version):
        value = source.json_value(version["jsonText"], lexical=True)
        meta = value.setdefault("meta", {})
        if not isinstance(meta, dict):
            raise InputError("An original resource meta must be an object")
        meta["versionId"], meta["lastUpdated"] = version["versionId"], version["recordedAt"]
        return value

    def capability(self):
        types = sorted({key.split("/", 1)[0] for key in self.saved["resources"]})
        return {"resourceType": "CapabilityStatement", "status": "active", "kind": "instance",
            "date": self.saved["createdAt"], "fhirVersion": "4.0.1",
            "format": ["json"], "software": {"name": "Gravity original published-source receiving", "version": "1.0.0"},
            "implementation": {"description": "Loopback receiving of the complete selected published examples",
                               "url": self.base_url},
            "rest": [{"mode": "server", "resource": [
                {"type": rt, "versioning": "versioned-update", "conditionalUpdate": False,
                 "interaction": [{"code": c} for c in ["read", "vread", "update", "history-instance", "search-type"]],
                 "searchParam": [{"name": n, "type": "date" if n == "_lastUpdated" else "token"}
                                 for n in ["_id", "_lastUpdated", "status", "owner", "requester"]]}
                for rt in types]}]}

class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "GravityPublishedSource/1.0"
    def log_message(self, *_):
        pass

    def send_value(self, value, status=200, headers=None, request_body=b""):
        body = source.lexical_json(value).encode("utf-8") + b"\n"
        receipt_id = str(uuid.uuid4())
        outgoing = {"Content-Type": "application/fhir+json; charset=utf-8", "Content-Length": str(len(body)),
                    "Connection": "close", **(headers or {})}
        # Save complete wire bodies and their source binding before returning them.
        with self.server.lock:
            request_path = self.server.directory / (receipt_id + ".request.bin")
            response_path = self.server.directory / (receipt_id + ".response.json")
            for path, raw in [(request_path, request_body), (response_path, body)]:
                with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as out:
                    out.write(raw); out.flush(); os.fsync(out.fileno())
            self.server.saved["receipts"].append({"id": receipt_id, "at": now(), "method": self.command,
                "path": self.path, "requestHeaders": dict(self.headers), "requestBody": request_path.name,
                "requestSha256": source.sha(request_body), "requestBytes": len(request_body),
                "status": status, "responseHeaders": outgoing, "responseBody": response_path.name,
                "responseSha256": source.sha(body), "responseBytes": len(body)})
            self.server.checkpoint()
        self.send_response(status)
        for key, value in outgoing.items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)
        self.close_connection = True

    def outcome(self, status, code, text, body=b""):
        self.send_value({"resourceType": "OperationOutcome",
            "issue": [{"severity": "error", "code": code, "diagnostics": text}]}, status, request_body=body)

    def path_parts(self):
        target = urlsplit(self.path)
        if not target.path.startswith("/fhir/") or "%" in target.path or ".." in target.path.split("/"):
            return None, {}
        return target.path[len("/fhir/"):].split("/"), parse_qs(target.query, keep_blank_values=True)

    def do_GET(self):
        with self.server.lock:
            parts, query = self.path_parts()
            if not parts:
                return self.outcome(404, "not-found", "Select this source server's exact /fhir route")
            if parts == ["metadata"]:
                return self.send_value(self.server.capability())
            if len(parts) == 1:
                return self.search(parts[0], query)
            key = "/".join(parts[:2])
            row = self.server.saved["resources"].get(key)
            if row is None:
                return self.outcome(404, "not-found", "This logical resource is absent from the retained published source")
            if len(parts) == 3 and parts[2] == "_history":
                if set(query) - {"_since"} or any(len(v) != 1 for v in query.values()):
                    return self.outcome(400, "not-supported", "This selected instance history accepts one optional _since instant")
                versions = list(reversed(row["versions"]))
                if query.get("_since"):
                    try:
                        since = datetime.fromisoformat(query["_since"][0].replace("Z", "+00:00"))
                        if since.tzinfo is None:
                            raise ValueError()
                        versions = [v for v in versions if datetime.fromisoformat(v["recordedAt"].replace("Z", "+00:00")) >= since]
                    except ValueError:
                        return self.outcome(400, "invalid", "History _since retains its full original timezone-aware instant")
                bundle = {"resourceType": "Bundle", "type": "history", "total": len(versions),
                    "link": [{"relation": "self", "url": self.server.base_url + "/" + key + "/_history" +
                        ("?" + urlencode(query, doseq=True) if query else "")}],
                    "entry": [{"fullUrl": self.server.base_url + "/" + key,
                        "resource": self.server.resource(v),
                        "request": {"method": "PUT", "url": key},
                        "response": {"status": "200", "etag": 'W/"' + v["versionId"] + '"',
                                     "lastModified": v["recordedAt"]}} for v in versions]}
                return self.send_value(bundle)
            if len(parts) == 4 and parts[2] == "_history":
                version = next((v for v in row["versions"] if v["versionId"] == parts[3]), None)
                if version is None:
                    return self.outcome(404, "not-found", "The selected original version is absent")
            elif len(parts) == 2:
                version = row["versions"][-1]
            else:
                return self.outcome(404, "not-found", "The selected source route is not implemented")
            return self.send_value(self.server.resource(version), headers={"ETag": 'W/"' + version["versionId"] + '"'})

    def search(self, resource_type, query):
        supported = {"_id", "_lastUpdated", "status", "owner", "requester", "_offset", "_count"}
        if set(query) - supported:
            return self.outcome(400, "not-supported", "The selected example endpoint does not implement these search parameters")
        try:
            offset = int(query.get("_offset", ["0"])[0])
            count = int(query.get("_count", ["25"])[0])
            if not 0 <= offset <= 10000 or not 1 <= count <= 250:
                raise ValueError()
        except ValueError:
            return self.outcome(400, "invalid", "Select a valid original page offset and count")
        values = []
        for key, row in sorted(self.server.saved["resources"].items()):
            if key.split("/", 1)[0] != resource_type:
                continue
            version = row["versions"][-1]
            value = self.server.resource(version)
            if query.get("_id") and value["id"] not in query["_id"][0].split(","):
                continue
            if query.get("status") and value.get("status") not in query["status"][0].split(","):
                continue
            selected = True
            for name in ["owner", "requester"]:
                if query.get(name):
                    ref = value.get(name, {})
                    if not isinstance(ref, dict) or ref.get("reference") != query[name][0]:
                        selected = False
            for bound in query.get("_lastUpdated", []):
                if not re.match(r"^(?:ge|gt|le|lt|eq)", bound):
                    return self.outcome(400, "invalid", "Retain a supported original update-window prefix")
                try:
                    actual = datetime.fromisoformat(version["recordedAt"].replace("Z", "+00:00"))
                    limit = datetime.fromisoformat(bound[2:].replace("Z", "+00:00"))
                    if actual.tzinfo is None or limit.tzinfo is None:
                        raise ValueError()
                    selected = selected and {"ge": actual >= limit, "gt": actual > limit,
                        "le": actual <= limit, "lt": actual < limit, "eq": actual == limit}[bound[:2]]
                except ValueError:
                    return self.outcome(400, "invalid", "Retain the selected source update timestamp with its offset")
            if selected:
                values.append((key, value))
        entries = [{"fullUrl": self.server.base_url + "/" + key, "resource": value}
                   for key, value in values[offset:offset + count]]
        links = [{"relation": "self", "url": self.server.base_url + "/" + resource_type +
                  ("?" + urlencode(query, doseq=True) if query else "")}]
        if offset + count < len(values):
            next_query = {**query, "_offset": [str(offset + count)], "_count": [str(count)]}
            links.append({"relation": "next", "url": self.server.base_url + "/" + resource_type +
                          "?" + urlencode(next_query, doseq=True)})
        return self.send_value({"resourceType": "Bundle", "type": "searchset",
                                "total": len(values), "link": links, "entry": entries})

    def do_PUT(self):
        with self.server.lock:
            parts, query = self.path_parts()
            if not parts or len(parts) != 2 or query:
                return self.outcome(404, "not-found", "Select one exact resource identity")
            try:
                size = int(self.headers.get("Content-Length", "-1"))
            except ValueError:
                size = -1
            if not 0 <= size <= source.MAX_RESOURCE:
                return self.outcome(413, "too-costly", "A complete original resource supports at most 16 MiB")
            raw = self.rfile.read(size)
            if len(raw) != size:
                return self.outcome(400, "incomplete", "The complete reviewed source body was not received", raw)
            try:
                value = source.json_value(raw, lexical=True)
            except InputError:
                return self.outcome(400, "invalid", "The reviewed original resource JSON could not be read", raw)
            key = "/".join(parts)
            if not isinstance(value, dict) or value.get("resourceType") != parts[0] or value.get("id") != parts[1]:
                return self.outcome(400, "invalid", "The complete resource body must retain the selected type and logical ID", raw)
            row = self.server.saved["resources"].get(key)
            if row:
                expected = 'W/"' + row["versions"][-1]["versionId"] + '"'
                if self.headers.get("If-Match") != expected:
                    return self.outcome(412, "conflict", "The actual original version differs from If-Match", raw)
                status = 200
            else:
                if self.headers.get("If-None-Match") != "*":
                    return self.outcome(412, "conflict", "Explicit create requires If-None-Match: *", raw)
                row = {"original": None, "versions": []}
                self.server.saved["resources"][key] = row
                status = 201
            item = {"versionId": str(len(row["versions"]) + 1), "recordedAt": now(),
                    "jsonText": raw.decode("utf-8"), "requestId": str(uuid.uuid4()),
                    "kind": "actual-reviewed-conditional-write", "requestSha256": source.sha(raw)}
            row["versions"].append(item)
            self.server.saved["putCount"] += 1
            self.server.checkpoint()
            return self.send_value(self.server.resource(item), status,
                                   {"ETag": 'W/"' + item["versionId"] + '"'}, raw)
