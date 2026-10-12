"""MIT. Source-selected FHIR Bundle, CarePlan operation and REST graph receiving."""
from __future__ import annotations
import gzip
import hashlib
import os
from pathlib import Path
import re
import shutil
from urllib.parse import urlencode, urljoin, urlsplit, quote
from eltss_runtime import (Credentials, Transport, ConflictError, ProviderError, InputError,
    atomic_json, private_directory, safe_read, now, retry_time, fhir, original_workspace, write_zip)
from eltss_source import (SOURCE_SCHEMA, JSONReader, Packet, MAX_SOURCE, MAX_RESOURCE,
    MAX_RESOURCES, MAX_CAREPLANS, jbytes, json_value, sha, identity, integer, text, exact, RESOURCE_TYPE)
from eltss_validation import typed
from eltss_graph import references, rest_base, RELATIVE

OPERATION_SCHEMA = "stellar-forge.eltss-operation.v1"
RETRY_CODES = {408, 429, 500, 502, 503, 504}
REQUEST_LIMITS = {"maxBytes": MAX_SOURCE, "maxResources": MAX_RESOURCES,
    "maxCarePlans": MAX_CAREPLANS, "maxPages": 512, "maxDepth": 32}


def capability_summary(resource):
    if resource.get("resourceType") != "CapabilityStatement" or resource.get("kind") == "requirements":
        raise InputError("Discovery requires this endpoint's actual CapabilityStatement, not a requirements document")
    if resource.get("kind") not in {"instance", "capability"}:
        raise InputError("The original discovery does not identify an actual server capability statement")
    servers = [r for r in resource.get("rest", []) if isinstance(r, dict) and r.get("mode") == "server"]
    if not servers:
        raise InputError("The retained CapabilityStatement has no server REST behavior")
    resources, operations = {}, []
    for server in servers:
        operations.extend(server.get("operation", []))
        for r in server.get("resource", []):
            if not isinstance(r, dict) or not isinstance(r.get("type"), str):
                continue
            resources[r["type"]] = {"type": r["type"],
                "interactions": [i["code"] for i in r.get("interaction", []) if isinstance(i, dict) and isinstance(i.get("code"), str)],
                "searchParams": r.get("searchParam", []), "searchInclude": r.get("searchInclude", []),
                "searchRevInclude": r.get("searchRevInclude", []), "operations": r.get("operation", []),
                "profile": r.get("profile"), "supportedProfile": r.get("supportedProfile", [])}
    return {"resources": resources, "operations": operations, "fhirVersion": resource.get("fhirVersion"),
            "format": resource.get("format", []), "implementation": resource.get("implementation"),
            "instantiates": resource.get("instantiates", []), "software": resource.get("software")}


def connection_value(raw, credentials):
    result = typed("connection", raw)
    result["baseUrl"] = fhir.http_url(result["baseUrl"], "FHIR base", True)
    result.setdefault("authProfile", None)
    if result["authProfile"] is not None and result["authProfile"] not in {r["name"] for r in credentials.public()}:
        raise InputError("Select an existing local authentication profile")
    result.setdefault("publisher", "")
    result.setdefault("sourceUrl", "")
    result.setdefault("note", "")
    return result


def request_value(raw, connection, discovery=None):
    result = typed("request", raw)
    base = connection["baseUrl"].rstrip("/")
    result.setdefault("discoveryId", None)
    result.setdefault("url", None)
    result.setdefault("carePlanIds", [])
    result.setdefault("searches", [])
    result.setdefault("followReferences", True)
    result.setdefault("resourceTypes", [])
    result.setdefault("note", "")
    limits = result.get("limits", {})
    for key, maximum in REQUEST_LIMITS.items():
        limits[key] = integer(limits.get(key, maximum), 1, maximum, key)
    result["limits"] = limits
    if len(result["carePlanIds"]) > limits["maxCarePlans"]:
        raise InputError("Selected CarePlans exceed the reviewed request limit")
    for ident in result["carePlanIds"]:
        if not re.fullmatch(r"[A-Za-z0-9.-]{1,64}", ident):
            raise InputError("Remote CarePlan IDs must be exact FHIR logical IDs")
    for rt in result["resourceTypes"]:
        if not RESOURCE_TYPE.fullmatch(rt):
            raise InputError("Choose exact original FHIR resource type names")
    selected, notes = [], []
    caps = discovery.get("capabilities") if discovery else None
    if result["route"] == "bundle-url":
        if not result["url"] or result["carePlanIds"] or result["searches"]:
            raise InputError("Original Bundle URL selects one URL without additional read/search seeds")
        url = fhir.http_url(result["url"])
        if fhir.origin(url) != fhir.origin(base):
            raise InputError("Original Bundle URL must use the selected connection origin")
        selected.append({"url": url, "kind": "bundle", "seed": True, "depth": 0})
    else:
        if not discovery or discovery["connectionId"] != result["connectionId"] or result["discoveryId"] != discovery["id"]:
            raise InputError("Select the retained discovery belonging to this exact source connection")
        if result["url"]:
            raise InputError("The selected native CarePlan/REST route derives URLs from its reviewed FHIR base")
        careplan = caps["resources"].get("CarePlan", {})
        if result["route"] == "all-eltss-careplan":
            if not result["carePlanIds"] or result["searches"]:
                raise InputError("CarePlan operation requires explicit instance IDs and no separate REST searches")
            advertised = [o for o in careplan.get("operations", []) if isinstance(o, dict) and
                (o.get("name", "").lstrip("$") == "all-eltss-careplan" or
                 str(o.get("definition", "")).split("|", 1)[0].endswith("/OperationDefinition/all-eltss-careplan"))]
            if not advertised:
                raise InputError("This selected endpoint did not advertise the instance CarePlan operation")
            result["selectedOperation"] = advertised
            for ident in result["carePlanIds"]:
                selected.append({"url": base + "/CarePlan/" + quote(ident, safe="") + "/$all-eltss-careplan",
                                 "kind": "operation", "seed": True, "depth": 0, "carePlanId": ident})
        else:
            if not result["carePlanIds"] and not result["searches"]:
                raise InputError("Reviewed REST graph needs explicit CarePlan reads or searches")
            if result["carePlanIds"] and "read" not in careplan.get("interactions", []):
                raise InputError("The selected discovery does not advertise CarePlan read")
            for ident in result["carePlanIds"]:
                selected.append({"url": base + "/CarePlan/" + quote(ident, safe=""), "kind": "read",
                                 "seed": True, "depth": 0, "carePlanId": ident})
            for search in result["searches"]:
                rt = search.get("resourceType")
                if rt not in caps["resources"] or "search-type" not in caps["resources"][rt]["interactions"]:
                    raise InputError("The selected discovery does not advertise search-type for " + str(rt))
                parameters = search.get("parameters", [])
                if len(parameters) > 128:
                    raise InputError("A reviewed native search supports at most 128 original parameters")
                pairs = []
                advertised = {p.get("name") for p in caps["resources"][rt]["searchParams"] if isinstance(p, dict)}
                for parameter in parameters:
                    if "name" not in parameter or "value" not in parameter:
                        raise InputError("Every search parameter retains its exact name and value")
                    name, value = parameter["name"], parameter["value"]
                    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_.:-]{0,127}", name):
                        raise InputError("Invalid selected FHIR search parameter name")
                    if name.startswith("_include"):
                        available = caps["resources"][rt]["searchInclude"]
                        if value not in available and "*" not in available:
                            notes.append({"resourceType": rt, "parameter": name, "value": value,
                                          "note": "Selected include value is not advertised; retain actual provider response"})
                    elif name.startswith("_revinclude"):
                        available = caps["resources"][rt]["searchRevInclude"]
                        if value not in available and "*" not in available:
                            notes.append({"resourceType": rt, "parameter": name, "value": value,
                                          "note": "Selected reverse include is not advertised; retain actual provider response"})
                    elif name.split(":", 1)[0] not in advertised and not name.startswith("_"):
                        notes.append({"resourceType": rt, "parameter": name,
                                      "note": "Selected parameter is not advertised; retain actual provider response"})
                    pairs.append((name, value))
                selected.append({"url": base + "/" + quote(rt, safe="") + ("?" + urlencode(pairs) if pairs else ""),
                                 "kind": "search", "seed": True, "depth": 0, "resourceType": rt})
    result["initialGets"] = selected
    result["capabilityNotes"] = notes
    result["requestSha256"] = sha(jbytes({"connection": connection, "selection": {k: v for k, v in result.items() if k != "requestSha256"}}))
    return result


def decoded_file(directory, receipt, maximum):
    if not receipt.get("body") or not receipt.get("complete"):
        raise InputError("The original HTTP response is not complete")
    original = Path(directory) / receipt["body"]
    if original_workspace.regular(original, MAX_SOURCE).st_size != receipt["bytes"] or \
            original_workspace.file_digest(original, MAX_SOURCE) != receipt["sha256"]:
        raise InputError("The complete original HTTP response changed before decoding")
    encoding = receipt.get("headers", {}).get("content-encoding", "identity").lower()
    if encoding in {"", "identity"}:
        return original
    if encoding != "gzip":
        raise InputError("Original provider encoding must be identity or gzip")
    if maximum <= 0:
        raise InputError("Complete original wire bytes exhausted the selected source budget")
    target = Path(directory) / (receipt["id"] + ".decoded.json")
    metadata = Path(directory) / (receipt["id"] + ".decoded.receipt.json")
    if target.exists() and metadata.exists():
        saved = json_value(safe_read(metadata, 4096))
        if saved.get("sourceSha256") != receipt["sha256"] or \
                original_workspace.regular(target, maximum).st_size != saved.get("bytes") or \
                original_workspace.file_digest(target, maximum) != saved.get("sha256"):
            raise InputError("Retained decoded source differs from its complete original response")
        return target
    # A process can die after creating a decoded file. Only an atomic completed
    # file and a wire-bound receipt are reusable. This temporary is reproducible
    # derived data; the complete original response always remains untouched.
    temporary = Path(directory) / ("." + receipt["id"] + ".decoding")
    if temporary.exists():
        original_workspace.regular(temporary, MAX_SOURCE)
        temporary.unlink()
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        digest, total = hashlib.sha256(), 0
        with os.fdopen(fd, "wb") as out, gzip.open(original, "rb") as inp:
            while block := inp.read(65536):
                total += len(block)
                if total > maximum:
                    raise InputError("Decoded original FHIR document exceeds the reviewed remaining budget")
                digest.update(block)
                out.write(block)
            out.flush()
            os.fsync(out.fileno())
        if target.exists():
            original_workspace.regular(target, MAX_SOURCE)
        os.replace(temporary, target)
        original_workspace.sync_dir(Path(directory))
        atomic_json(metadata, {"schema": "stellar-forge.eltss-decoded-original.v1",
            "sourceSha256": receipt["sha256"], "bytes": total, "sha256": digest.hexdigest()})
    except (OSError, EOFError) as error:
        temporary.unlink(missing_ok=True)
        raise InputError("Original provider response has invalid or incomplete gzip bytes") from error
    except Exception:
        temporary.unlink(missing_ok=True)
        raise
    return target


class Acquisition:
    def __init__(self, workspace, credentials):
        self.ws, self.credentials = workspace, credentials
        self.transport = Transport(credentials)
        self.operations = private_directory(workspace.root / "eltss" / "operations")
        self.observations = private_directory(workspace.root / "eltss" / "observations")

    def discover(self, connection_id):
        with self.ws.mutex:
            connection = self.ws.connection(connection_id)["connection"]
            # Each explicit discovery is an original observation; its completed
            # response determines the immutable ID and remains part of transfer.
            import uuid
            ident = str(uuid.uuid4())
            directory = private_directory(self.observations / ident)
            receipt = self.transport.receive(directory, "metadata", "GET", connection["baseUrl"] + "/metadata",
                {"Accept": "application/fhir+json", "Accept-Encoding": "identity"}, None, connection, limit=MAX_RESOURCE)
            if not receipt.get("complete") or receipt.get("status") != 200:
                raise ProviderError("The original FHIR discovery did not complete successfully", receipt.get("status"),
                    receipt.get("headers", {}).get("retry-after"), receipt=receipt)
            path = decoded_file(directory, receipt, MAX_RESOURCE)
            value = json_value(safe_read(path, MAX_RESOURCE))
            capabilities = capability_summary(value)
            return self.ws._store("discoveries", {"connectionId": connection_id, "kind": value["kind"],
                "fhirVersion": value.get("fhirVersion"), "capabilities": capabilities,
                "observation": {"directory": ident, "receipt": receipt, "body": path.name,
                                "sha256": original_workspace.file_digest(path, MAX_RESOURCE)}})

    def _directory(self, operation_id):
        return self.operations / fhir.operation_id(operation_id)

    def _save(self, value):
        value["updatedAt"] = now()
        atomic_json(self._directory(value["operationId"]) / "operation.json", value)
        self.ws._save("operations", value["operationId"], value, immutable=False)
        return value

    def operation(self, ident):
        with self.ws.mutex:
            path = self._directory(ident) / "operation.json"
            if not path.exists():
                raise InputError("Unknown retained eLTSS acquisition operation")
            value = json_value(safe_read(path, 64 * 1024 * 1024))
            if value.get("schema") != OPERATION_SCHEMA or value.get("operationId") != ident:
                raise InputError("Original acquisition operation identity changed")
            self.ws._save("operations", ident, value, immutable=False)
            return value

    def pause(self, ident):
        with self.ws.mutex:
            op = self.operation(ident)
            if op["state"] != "complete":
                op["state"] = "paused"
                op["phase"] = "paused-locally"
            return self._save(op)

    def resume(self, ident):
        with self.ws.mutex:
            op = self.operation(ident)
            if op["state"] != "complete":
                op["state"] = "waiting" if op.get("notBefore") and fhir.epoch(op["notBefore"]) > fhir.epoch(now()) else "ready"
                op["phase"] = "original-source-receiving"
                op["error"] = None
            return self._save(op)

    def _enqueue(self, op, item, limits):
        if item["url"] in op["seenUrls"] or item["url"] in op.get("observedResourceUrls", []):
            return
        if len(op["seenUrls"]) >= limits["maxPages"]:
            op["unresolved"].append({**item, "reason": "Reviewed page limit reached"})
            return
        if item["depth"] > limits["maxDepth"]:
            op["unresolved"].append({**item, "reason": "Reviewed reference depth reached"})
            return
        op["seenUrls"].append(item["url"])
        op["queue"].append(item)

    def _document(self, path, current, request, connection, op):
        header, references_to_visit, count, careplans = None, [], 0, 0
        def resource(value, full_url=None, standalone=False, inherited_base=None):
            nonlocal count, careplans
            if not isinstance(value, dict) or not isinstance(value.get("resourceType"), str):
                raise InputError("Original HTTP document contains an invalid FHIR resource")
            count += 1
            careplans += value["resourceType"] == "CarePlan"
            base = rest_base(full_url, value["resourceType"], value.get("id")) or inherited_base
            if base is None and standalone:
                base = rest_base(current["url"], value["resourceType"], value.get("id"))
            observed_urls = op.setdefault("observedResourceUrls", [])
            if full_url and full_url not in observed_urls:
                observed_urls.append(full_url)
            if standalone and current["url"] not in observed_urls:
                observed_urls.append(current["url"])
            if request["followReferences"]:
                for reference in references(value):
                    ref = reference.get("reference")
                    if reference["kind"] != "literal" or not ref or ref.startswith(("#", "urn:")):
                        continue
                    if urlsplit(ref).scheme:
                        url = fhir.http_url(ref, "Original resource reference")
                    elif base and RELATIVE.fullmatch(ref):
                        url = base.rstrip("/") + "/" + ref
                    else:
                        op["unresolved"].append({"url": None, "reference": ref, "fromUrl": current["url"],
                            "reason": "Original reference has no defined REST base"})
                        continue
                    selected_base = connection["baseUrl"].rstrip("/")
                    parsed, selected = urlsplit(url), urlsplit(selected_base)
                    if fhir.origin(url) != fhir.origin(selected_base) or not (
                            parsed.path == selected.path or parsed.path.startswith(selected.path.rstrip("/") + "/")):
                        op["unresolved"].append({"url": url, "reference": ref, "fromUrl": current["url"],
                                                "reason": "Reference is outside the reviewed FHIR base"})
                        continue
                    suffix = parsed.path[len(selected.path):].strip("/").split("/")
                    rt = suffix[0] if suffix else ""
                    if request["resourceTypes"] and rt not in request["resourceTypes"]:
                        op["unresolved"].append({"url": url, "reference": ref, "fromUrl": current["url"],
                                                "reason": "Reference type is outside the reviewed traversal selection"})
                        continue
                    references_to_visit.append({"url": url, "reference": ref, "fromUrl": current["url"],
                        "kind": "reference", "seed": False, "depth": current["depth"] + 1})
            contained = value.get("contained", [])
            if not isinstance(contained, list):
                raise InputError("Original contained resources must remain an array")
            for child in contained:
                resource(child, inherited_base=base)
            if value["resourceType"] == "Bundle":
                entries = value.get("entry", [])
                if not isinstance(entries, list):
                    raise InputError("Original nested Bundle entries must remain an array")
                for entry in entries:
                    if not isinstance(entry, dict):
                        raise InputError("Original nested Bundle entry must be an object")
                    if entry.get("resource") is not None:
                        resource(entry["resource"], entry.get("fullUrl"))
        with path.open("rb") as stream:
            for event in JSONReader(stream, request["limits"]["maxBytes"]).document():
                if event["kind"] == "entry":
                    value = event["entry"].get("resource")
                    if value:
                        resource(value, event["entry"].get("fullUrl"))
                else:
                    header = event["header"]
                    if header.get("resourceType") != "Bundle":
                        resource(header, standalone=True)
        if header is None:
            raise InputError("Original HTTP JSON has no complete resource header")
        if header["resourceType"] == "OperationOutcome":
            issues = [{"severity": i.get("severity"), "code": i.get("code"), "diagnostics": i.get("diagnostics")}
                      for i in header.get("issue", []) if isinstance(i, dict)]
            return {"header": header, "count": count, "careplans": careplans, "outcome": issues}
        next_urls = []
        if header["resourceType"] == "Bundle":
            for link in header.get("link", []):
                if isinstance(link, dict) and link.get("relation") == "next":
                    destination = fhir.http_url(urljoin(current["url"], link.get("url", "")), "Original Bundle next link")
                    if fhir.origin(destination) != fhir.origin(connection["baseUrl"]):
                        raise InputError("Original Bundle next link left the selected provider origin")
                    next_urls.append(destination)
        for url in next_urls:
            self._enqueue(op, {**current, "url": url, "kind": "page"}, request["limits"])
        for item in references_to_visit:
            self._enqueue(op, item, request["limits"])
        return {"header": header, "count": count, "careplans": careplans, "outcome": None}

    def _finish(self, op, request, connection):
        directory = self._directory(op["operationId"])
        members, documents, protocol = {}, [], []
        receipts = directory / "receipts"
        for document in op["documents"]:
            path = receipts / document["body"]
            desc = {"name": "documents/" + document["body"], "bytes": path.stat().st_size,
                    "sha256": original_workspace.file_digest(path), "role": "resource", "sourceUrl": document["url"],
                    "receiptId": document["receiptId"]}
            documents.append(desc)
            members[desc["name"]] = path
        document_paths = {d["body"] for d in op["documents"]}
        for path in sorted(receipts.iterdir()):
            original_workspace.regular(path)
            if path.name in document_paths:
                continue
            desc = {"name": "protocol/" + path.name, "bytes": path.stat().st_size,
                    "sha256": original_workspace.file_digest(path), "role": "http-receipt" if path.name.endswith(".receipt.json") else "http-wire"}
            protocol.append(desc)
            members[desc["name"]] = path
        if not documents:
            op.update({"state": "failed", "phase": "source-empty", "error": "No original FHIR documents were received"})
            return self._save(op)
        manifest = {"schema": SOURCE_SCHEMA, "origin": connection["origin"],
            "publisher": connection.get("publisher", ""), "sourceUrl": connection.get("sourceUrl", ""),
            "documents": documents, "protocol": protocol, "predecessors": [],
            "context": {"connection": connection, "connectionId": request["connectionId"],
                "request": request, "requestId": op["requestId"], "operationId": op["operationId"],
                "discoveryId": request.get("discoveryId"), "startedAt": op["createdAt"],
                "receivedAt": now(), "unresolved": op["unresolved"],
                "transportArtifacts": {p.name: ("documents/" if p.name in document_paths else "protocol/") + p.name for p in receipts.iterdir()}}}
        members["manifest.json"] = jbytes(manifest)
        total = sum(len(v) if isinstance(v, bytes) else v.stat().st_size for v in members.values())
        if total > request["limits"]["maxBytes"]:
            op.update({"state": "failed", "phase": "source-budget", "error": "Complete documents and original protocol exceed the reviewed source-byte budget"})
            return self._save(op)
        packet_path = directory / "source.zip"
        if not packet_path.exists():
            write_zip(packet_path, members)
        with packet_path.open("rb") as stream, Packet(stream) as retained:
            context = (retained.manifest or {}).get("context", {})
            if context.get("operationId") != op["operationId"] or context.get("requestId") != op["requestId"] or context.get("request") != request:
                raise ConflictError("Retained source packet belongs to another original operation")
            if [(d["name"], d["sha256"], d["bytes"]) for d in retained.documents] != [(d["name"], d["sha256"], d["bytes"]) for d in documents]:
                raise ConflictError("Retained source packet does not contain the selected original documents")
        with packet_path.open("rb") as stream:
            original = self.ws.add_source(stream, request["label"], "eltss-original-source.zip")
        op.update({"state": "complete", "phase": "source-received", "sourceId": original["id"],
                   "finishedAt": now(), "error": None, "queued": 0,
                   "completeness": {"receivedPages": op["pageCount"], "receivedResources": op["resourceCount"],
                                    "unresolvedReferences": len(op["unresolved"]), "selectedRoute": request["route"]}})
        return self._save(op)

    def advance(self, request_id, operation_id):
        operation_id = fhir.operation_id(operation_id)
        with self.ws.mutex:
            saved = self.ws.request(request_id)
            request = saved["request"]
            connection = self.ws.connection(request["connectionId"])["connection"]
            directory = self._directory(operation_id)
            if (directory / "operation.json").exists():
                op = self.operation(operation_id)
                if op["requestId"] != request_id or op["requestSha256"] != request["requestSha256"]:
                    raise ConflictError("Original operation ID is already bound to another exact source request")
            else:
                private_directory(directory)
                private_directory(directory / "receipts")
                op = {"schema": OPERATION_SCHEMA, "operationId": operation_id, "requestId": request_id,
                    "requestSha256": request["requestSha256"], "connectionId": request["connectionId"],
                    "state": "ready", "phase": "original-source-receiving", "createdAt": now(), "updatedAt": now(),
                    "queue": list(request["initialGets"]), "seenUrls": [i["url"] for i in request["initialGets"]],
                    "cursor": 0, "pending": None, "attempt": 0, "history": [], "documents": [], "unresolved": [],
                    "notBefore": None, "receivedBytes": 0, "resourceCount": 0, "carePlanCount": 0,
                    "pageCount": 0, "queued": len(request["initialGets"]), "sourceId": None, "error": None}
                self._save(op)
            if op["state"] in {"complete", "paused", "failed"}:
                return op
            if op.get("notBefore") and fhir.epoch(op["notBefore"]) > fhir.epoch(now()):
                return op
            if op["cursor"] >= len(op["queue"]):
                return self._finish(op, request, connection)
            current = op["queue"][op["cursor"]]
            while not current.get("seed") and current["url"] in op.get("observedResourceUrls", []):
                op.setdefault("coveredReferences", []).append(current)
                op["cursor"] += 1
                op["queued"] = len(op["queue"]) - op["cursor"]
                self._save(op)
                if not op["queued"]:
                    return self._finish(op, request, connection)
                current = op["queue"][op["cursor"]]
            if op["pending"] is None:
                op["pending"] = {"stem": "step-" + str(len(op["history"]) + 1).zfill(6), "queueIndex": op["cursor"], "url": current["url"]}
                op["state"] = "running"
                self._save(op)
            pending = op["pending"]
            limit = request["limits"]["maxBytes"] - op["receivedBytes"]
            if limit <= 0 or len(op["history"]) >= 4096:
                op.update({"state": "failed", "phase": "source-budget", "error": "The original receiving reached its reviewed byte/attempt limit"})
                return self._save(op)
            receipt = self.transport.receive(directory / "receipts", pending["stem"], "GET", pending["url"],
                {"Accept": "application/fhir+json", "Accept-Encoding": "identity"}, None, connection, limit=limit)
            op["history"].append(receipt)
            op["receivedBytes"] += receipt.get("bytes", 0)
            op["pending"] = None
            op["attempt"] += 1
            status = receipt.get("status")
            if not receipt.get("complete") or status in RETRY_CODES:
                op.update({"state": "waiting", "phase": "original-http-retry",
                    "notBefore": retry_time(receipt.get("headers", {}).get("retry-after"), op["attempt"]),
                    "error": receipt.get("transportError") or ("Original provider returned " + str(status))})
                return self._save(op)
            if status == 202:
                target = receipt.get("headers", {}).get("content-location") or receipt.get("headers", {}).get("location")
                if not target:
                    op.update({"state": "failed", "phase": "original-http-response", "error": "Original HTTP 202 omitted its status Location"})
                else:
                    target = fhir.http_url(urljoin(pending["url"], target), "Original status URL")
                    if fhir.origin(target) != fhir.origin(connection["baseUrl"]):
                        raise InputError("Original status URL changed the reviewed provider origin")
                    op["queue"][op["cursor"]] = {**current, "url": target, "kind": "status"}
                    op.update({"state": "waiting", "phase": "original-http-status", "error": None,
                        "notBefore": retry_time(receipt.get("headers", {}).get("retry-after"))})
                return self._save(op)
            if status != 200:
                result = {"url": current["url"], "status": status, "receiptId": receipt["id"], "reason": "Original provider rejected this selected read"}
                if current["seed"]:
                    op.update({"state": "failed", "phase": "original-http-rejected", "error": result})
                    return self._save(op)
                op["unresolved"].append(result)
            else:
                remaining = request["limits"]["maxBytes"] - op["receivedBytes"]
                path = decoded_file(directory / "receipts", receipt, remaining)
                if path.name != receipt["body"]:
                    op["receivedBytes"] += path.stat().st_size
                try:
                    observed = self._document(path, current, request, connection, op)
                except InputError as error:
                    op.update({"state": "failed", "phase": "original-document-review",
                        "error": {"message": str(error), "url": current["url"], "receiptId": receipt["id"],
                                  "body": path.name, "sha256": original_workspace.file_digest(path)}})
                    return self._save(op)
                op["documents"].append({"body": path.name, "url": receipt.get("actualUrl") or current["url"], "receiptId": receipt["id"],
                    "bytes": path.stat().st_size, "sha256": original_workspace.file_digest(path)})
                op["pageCount"] += 1
                op["resourceCount"] += observed["count"]
                op["carePlanCount"] += observed["careplans"]
                if observed["outcome"] is not None:
                    outcome = {"url": current["url"], "status": status, "receiptId": receipt["id"],
                               "reason": "Original OperationOutcome response", "issues": observed["outcome"]}
                    op["unresolved"].append(outcome)
                    if current["seed"]:
                        op.update({"state": "failed", "phase": "original-operation-outcome", "error": outcome})
                        return self._save(op)
                if op["resourceCount"] > request["limits"]["maxResources"] or op["carePlanCount"] > request["limits"]["maxCarePlans"]:
                    op.update({"state": "failed", "phase": "source-budget", "error": "Original resources exceed the reviewed cohort limits"})
                    return self._save(op)
            op["cursor"] += 1
            op["queued"] = len(op["queue"]) - op["cursor"]
            op.update({"state": "ready", "phase": "original-source-receiving", "notBefore": None, "error": None})
            self._save(op)
            return self._finish(op, request, connection) if not op["queued"] else op
