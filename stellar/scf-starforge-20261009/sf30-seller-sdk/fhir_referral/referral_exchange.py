"""MIT. Original selected FHIR referral reads, conditional writes and reconciliation."""
from __future__ import annotations
from datetime import datetime
import os
from pathlib import Path
import re
import uuid
from urllib.parse import quote, urlencode
from referral_runtime import (InputError, ConflictError, ProviderError, source, fhir,
    original_workspace, Transport, atomic_json, private_directory, safe_read, now,
    retry_time, decoded_body, write_zip, changed_values)
import referral_schema as schema

OPERATION_SCHEMA = "stellar-forge.gravity-referral-exchange.v1"
RETRY_CODES = {408, 429, 500, 502, 503, 504}

def comparable(resource):
    """Only server-maintained version and update instant are ignored in readback."""
    value = source.json_value(source.lexical_json(resource), lexical=True)
    if isinstance(value.get("meta"), dict):
        value["meta"].pop("versionId", None)
        value["meta"].pop("lastUpdated", None)
        if not value["meta"]:
            value.pop("meta")
    return source.lexical_json(value)

class ReferralExchange:
    def save_referral_exchange_request(self, raw):
        v = schema.common(schema.obj(raw, {"label", "actor", "note", "editionId", "connectionId",
            "discoveryId", "recordId", "resourceType", "logicalId", "method", "bodyJson",
            "expectedETag", "createIfAbsent", "consentDecisionId", "purpose", "role"},
            {"label", "actor", "editionId", "connectionId", "discoveryId",
             "resourceType", "logicalId", "method", "role"}, "Selected native exchange"))
        v["method"] = schema.enum(v["method"], ["GET", "PUT"], "Native resource method")
        v["role"] = schema.enum(v["role"], schema.ROLES, "Actual operating role")
        v["resourceType"] = schema.enum(v["resourceType"], schema.EXCHANGE_TYPES, "Selected resource type")
        if not isinstance(v["logicalId"], str) or not re.fullmatch(r"[A-Za-z0-9.-]{1,64}", v["logicalId"]):
            raise InputError("Keep the exact original FHIR logical ID")
        v.setdefault("recordId", None)
        v.setdefault("bodyJson", None)
        v.setdefault("expectedETag", None)
        v.setdefault("createIfAbsent", False)
        v.setdefault("consentDecisionId", None)
        v["purpose"] = schema.text(v.get("purpose", ""), "Selected exchange purpose", 4000)
        if type(v["createIfAbsent"]) is not bool:
            raise InputError("Create-if-absent is an explicit selected operation")
        with self.mutex:
            edition = self.referral_record("editions", v["editionId"])
            config = self.referral_record("configurations", edition["configurationId"])
            connection = self.connection(v["connectionId"])["connection"]
            discovery = self.discovery(v["discoveryId"])
            if discovery["connectionId"] != v["connectionId"]:
                raise InputError("Select actual discovery from this exact connection")
            caps = discovery["capabilities"].get("resources", {}).get(v["resourceType"], {})
            roles = {r["role"]: r for r in config["roles"]}
            selected_role = roles.get(v["role"])
            if not selected_role:
                raise InputError("The selected operating role is absent from the retained topology")
            host_role = config["recipientHostRole"] if v["role"] == "target" else v["role"]
            if roles[host_role].get("connectionId") != v["connectionId"]:
                raise InputError("The native endpoint differs from this actor's selected server ownership")
            if "read" not in caps.get("interactions", []):
                raise InputError("The selected actual endpoint must advertise the resource read used for receiving")
            v["url"] = connection["baseUrl"].rstrip("/") + "/" + v["resourceType"] + "/" + quote(v["logicalId"], safe="")
            original = None
            if v["recordId"]:
                original = self.source_row(edition["sourceId"], v["recordId"])
                if original["resourceType"] != v["resourceType"] or original.get("id") != v["logicalId"]:
                    raise InputError("The original source record must identify this exact native resource")
            if v["method"] == "GET":
                if v["bodyJson"] is not None or v["createIfAbsent"]:
                    raise InputError("An original read has no mutation body or create selection")
            else:
                if "update" not in caps.get("interactions", []):
                    raise InputError("The actual endpoint did not advertise this resource update")
                if not isinstance(v["bodyJson"], str):
                    raise InputError("The reviewed update retains its complete authored FHIR JSON body")
                body = source.json_value(v["bodyJson"], lexical=True)
                if not isinstance(body, dict) or body.get("resourceType") != v["resourceType"] or body.get("id") != v["logicalId"]:
                    raise InputError("The complete update body must retain the selected resource type and logical ID")
                if len(v["bodyJson"].encode()) > source.MAX_RESOURCE:
                    raise InputError("One complete resource update exceeds 16 MiB")
                if not v["createIfAbsent"] and original is None:
                    raise InputError("An update retains its actual original source preimage")
                if v["expectedETag"] is not None and (not isinstance(v["expectedETag"], str) or not re.fullmatch(r'(?:W/)?"[^"\r\n]+"', v["expectedETag"])):
                    raise InputError("Expected ETag retains the original quoted version validator")
                if not v["purpose"] or not v["consentDecisionId"]:
                    raise InputError("A selected referral write needs its recorded purpose and responsible consent review")
                self._exchange_consent(v, edition)
                if v["resourceType"] == "ServiceRequest" and v["role"] == "target":
                    raise InputError("The requester owns ServiceRequest changes; select its source or intermediary role")
                if v["resourceType"] == "Task":
                    from referral_domain import coding, TASK_CODE, TEMP
                    if body.get("status") not in schema.TASK_STATUSES or body.get("intent") != "order" or not coding(body.get("code"), TASK_CODE, "fulfill"):
                        raise InputError("The reviewed native referral Task must retain its selected status, order and fulfill semantics")
                    if body.get("status") == "completed" and not any(
                        isinstance(item, dict) and any(k.startswith("value") for k in item) for item in body.get("output", [])):
                        raise InputError("The completed Task retains at least one actual returned outcome")
                if v["resourceType"] == "Task":
                    old_task = source.json_value(original["jsonText"], lexical=True) if original else {}
                    if body.get("status") != old_task.get("status"):
                        writers = {
                            "draft": {"source"}, "requested": {"source"},
                            "accepted": {"target"}, "rejected": {"target"},
                            "cancelled": {"source", "target"}, "in-progress": {"target"},
                            "on-hold": {"target"}, "failed": {"target"},
                            "completed": {"target"}, "entered-in-error": {"source"}}
                        effective_role = v["role"]
                        if effective_role == "intermediary":
                            organization = selected_role["organization"]
                            requester = body.get("requester", {})
                            owner = body.get("owner", {})
                            sides = set()
                            if isinstance(requester, dict) and requester.get("reference") == organization:
                                sides.add("source")
                            if isinstance(owner, dict) and owner.get("reference") == organization:
                                sides.add("target")
                            if not (sides & writers[body["status"]]):
                                raise InputError("The intermediary status change needs its exact requester or owner reference for this Task")
                        elif effective_role not in writers[body["status"]]:
                            raise InputError("The original referral status table assigns this change to the requester or referral target")
                v["bodySha256"] = source.sha(v["bodyJson"].encode())
            v["originalSourceId"] = edition["sourceId"]
            v["originalResourceSha256"] = original.get("resourceSha256") if original else None
            v["originalResourceJson"] = original.get("jsonText") if original else None
            v["configurationId"] = config["id"]
            v["requestSha256"] = source.sha(source.jbytes(v))
            return self._referral_store("exchangeRequests", v)

    def _exchange_consent(self, request, edition):
        decision = self.referral_record("decisions", request["consentDecisionId"])
        replaced = {r.get("supersedesId") for r in self.referral_records("decisions") if r.get("supersedesId")}
        if decision["id"] in replaced or decision["editionId"] != edition["id"] or decision["kind"] != "consent":
            raise InputError("Select the current responsible consent decision for this original edition")
        if decision["outcome"] != "permit" or decision["purpose"] != request["purpose"]:
            raise InputError("The selected decision does not permit this exact recorded exchange purpose")
        if decision.get("expiresAt") and fhir.epoch(decision["expiresAt"]) <= fhir.epoch(now()):
            raise InputError("The selected original consent decision has expired")
        if not decision["taskIds"]:
            raise InputError("The consent decision must name its actual selected referral Tasks")
        if request["resourceType"] == "Task" and request.get("recordId") and request["recordId"] not in decision["taskIds"]:
            raise InputError("The consent decision does not select this original referral Task")
        return decision

    def _exchange_directory(self, ident):
        return self.root / "referral" / "operations" / fhir.operation_id(ident)

    def _save_exchange(self, op, action=None):
        if action:
            op["history"].append({"at": now(), "action": action, "state": op["state"], "phase": op["phase"]})
        op["updatedAt"] = now()
        atomic_json(self._exchange_directory(op["id"]) / "operation.json", op)
        return self._referral_save("exchangeOperations", op)

    def referral_exchange_operation(self, ident):
        ident = fhir.operation_id(ident)
        path = self._exchange_directory(ident) / "operation.json"
        if path.exists():
            value = source.json_value(safe_read(path, 64 * 1024 * 1024))
            if value.get("schema") != OPERATION_SCHEMA or value.get("id") != ident:
                raise InputError("Original referral operation identity differs")
            return self._referral_save("exchangeOperations", value)
        return self.referral_record("exchangeOperations", ident)

    def _exchange_http(self, op, request, method, *, name, headers=None, body=None):
        directory = self._exchange_directory(op["id"])
        step = {"id": str(uuid.uuid4()), "name": name, "method": method,
                "url": request["url"], "headers": headers or {"Accept": "application/fhir+json", "Accept-Encoding": "identity"},
                "bodySha256": source.sha(body) if body is not None else None, "startedAt": now(), "receipt": None}
        op["steps"].append(step)
        op["inflight"] = step["id"]
        self._save_exchange(op, "retain-" + name)
        if body is not None:
            original_workspace.private_write(directory / (step["id"] + ".request.json"), body)
        connection = self.connection(request["connectionId"])["connection"]
        receipt = Transport(self.credentials).receive(directory, step["id"], method, request["url"],
                    step["headers"], body, connection, limit=source.MAX_RESOURCE)
        step["receipt"] = receipt
        step["completedAt"] = now()
        op["inflight"] = None
        self._save_exchange(op, "receive-" + name)
        return receipt

    def _exchange_failure(self, op, receipt, phase):
        status = receipt.get("status")
        if status in RETRY_CODES:
            op["notBefore"] = retry_time(receipt.get("headers", {}).get("retry-after"))
            op["state"], op["phase"] = "waiting", phase
        else:
            op["state"], op["phase"] = "review-required", phase
        op["result"] = {"status": status, "complete": receipt.get("complete"),
            "receiptId": receipt["id"], "bodySha256": receipt.get("sha256"),
            "transportError": receipt.get("transportError")}
        return self._save_exchange(op, "retain-provider-result")

    def _exchange_resource(self, op, receipt):
        raw = decoded_body(self._exchange_directory(op["id"]), receipt, source.MAX_RESOURCE)
        value = source.json_value(raw, lexical=True)
        return raw, value

    def _complete_exchange(self, op, request, receipt, disposition):
        raw, value = self._exchange_resource(op, receipt)
        if value.get("resourceType") != request["resourceType"] or value.get("id") != request["logicalId"]:
            op["state"], op["phase"] = "review-required", "unexpected-resource-identity"
            return self._save_exchange(op, "retain-unexpected-identity")
        directory = self._exchange_directory(op["id"])
        doc_path = directory / "received-resource.json"
        if doc_path.exists():
            if doc_path.read_bytes() != raw:
                raise ConflictError("The original completed receiving resource differs")
        else:
            original_workspace.private_write(doc_path, raw)
        document = source.descriptor("documents/received-resource.json", raw, role="native-fhir-resource", sourceUrl=request["url"])
        members, protocol = {document["name"]: doc_path}, []
        for path in sorted(directory.iterdir()):
            if not path.is_file() or path.name in {"received-resource.json", "received-source.zip", "operation.json"}:
                continue
            if path.is_symlink():
                raise InputError("Native operation custody contains an unexpected link")
            name = "protocol/" + path.name
            members[name] = path
            protocol.append({"name": name, "bytes": path.stat().st_size,
                             "sha256": original_workspace.file_digest(path), "role": "original-native-exchange"})
        context = {"schema": OPERATION_SCHEMA, "operationId": op["id"], "requestId": request["id"],
            "requestSha256": request["requestSha256"], "sourceId": request["originalSourceId"],
            "sourceEditionId": request["editionId"], "connectionId": request["connectionId"],
            "method": request["method"], "url": request["url"], "disposition": disposition}
        manifest = {"schema": source.SOURCE_SCHEMA, "origin": self.connection(request["connectionId"])["connection"]["origin"],
                    "documents": [document], "protocol": protocol, "predecessors": [], "context": context}
        path = directory / "received-source.zip"
        if not path.exists():
            write_zip(path, {**members, "manifest.json": source.jbytes(manifest)})
        with path.open("rb") as stream:
            received = self.add_source(stream, request["label"], "referral-native-source.zip")
        op["state"], op["phase"] = "complete", "received-original-resource"
        op["sourceId"] = received["id"]
        op["result"] = {"disposition": disposition, "status": receipt["status"], "receiptId": receipt["id"],
            "resourceType": value["resourceType"], "logicalId": value["id"],
            "versionId": value.get("meta", {}).get("versionId"), "etag": receipt.get("headers", {}).get("etag"),
            "resourceSha256": source.sha(source.lexical_json(value).encode()), "sourceId": received["id"]}
        return self._save_exchange(op, "complete-original-receiving")

    def advance_referral_exchange(self, request_id, operation_id):
        fhir.operation_id(operation_id)
        with self.mutex:
            request = self.referral_record("exchangeRequests", request_id)
            directory = self._exchange_directory(operation_id)
            saved = directory / "operation.json"
            if saved.exists():
                op = self.referral_exchange_operation(operation_id)
                if op["requestId"] != request_id or op["requestSha256"] != request["requestSha256"]:
                    raise ConflictError("The original operation ID is bound to another reviewed request")
            else:
                private_directory(directory)
                original_workspace.private_write(directory / "request.json", source.jbytes(request))
                op = {"schema": OPERATION_SCHEMA, "id": operation_id, "requestId": request_id,
                    "requestSha256": request["requestSha256"], "connectionId": request["connectionId"],
                    "createdAt": now(), "updatedAt": now(), "state": "ready", "phase": "read-original",
                    "steps": [], "history": [], "inflight": None, "writeStarted": False, "notBefore": None,
                    "preflight": None, "result": None}
                self._save_exchange(op, "initialize-original-request")
            if op["state"] == "complete":
                self.source(op["sourceId"])
                return op
            if op.get("notBefore") and fhir.epoch(op["notBefore"]) > fhir.epoch(now()):
                return op
            if len(op["steps"]) >= 128:
                raise InputError("The original exchange has 128 retained HTTP steps; review its complete provider history")
            if request["method"] == "PUT":
                self._exchange_consent(request, self.referral_record("editions", request["editionId"]))
            # A read is safe after any interrupted write and decides whether the
            # exact original conditional request can continue or already arrived.
            receipt = self._exchange_http(op, request, "GET",
                name="reconcile-original" if op["writeStarted"] else "read-original")
            if not receipt.get("complete"):
                return self._exchange_failure(op, receipt, "read-original")
            if request["method"] == "GET":
                if receipt["status"] != 200:
                    return self._exchange_failure(op, receipt, "original-read-result")
                return self._complete_exchange(op, request, receipt, "read")
            desired = source.json_value(request["bodyJson"], lexical=True)
            current = None
            if receipt["status"] == 200:
                _, current = self._exchange_resource(op, receipt)
                if current.get("resourceType") != request["resourceType"] or current.get("id") != request["logicalId"]:
                    return self._exchange_failure(op, receipt, "unexpected-original-identity")
                if op["writeStarted"] and comparable(current) == comparable(desired):
                    return self._complete_exchange(op, request, receipt, "reconciled-same-request")
            elif receipt["status"] != 404:
                return self._exchange_failure(op, receipt, "original-read-result")
            if request["createIfAbsent"]:
                if current is not None:
                    op["state"], op["phase"] = "review-required", "selected-create-identity-exists"
                    return self._save_exchange(op, "retain-existing-resource")
                conditional = {"If-None-Match": "*"}
            else:
                if current is None:
                    op["state"], op["phase"] = "review-required", "original-resource-missing"
                    return self._save_exchange(op, "retain-missing-original")
                original = source.json_value(request["originalResourceJson"], lexical=True)
                if comparable(current) != comparable(original):
                    op["state"], op["phase"] = "review-required", "original-resource-changed"
                    op["result"] = {"changes": list(changed_values(original, current)),
                                    "receiptId": receipt["id"]}
                    return self._save_exchange(op, "retain-original-version-conflict")
                actual_etag = receipt.get("headers", {}).get("etag")
                if not actual_etag:
                    op["state"], op["phase"] = "review-required", "original-version-validator-absent"
                    return self._save_exchange(op, "retain-missing-version-validator")
                if request.get("expectedETag") and actual_etag != request["expectedETag"]:
                    op["state"], op["phase"] = "review-required", "original-version-validator-changed"
                    return self._save_exchange(op, "retain-version-conflict")
                conditional = {"If-Match": actual_etag}
            op["preflight"] = {"receiptId": receipt["id"], "status": receipt["status"],
                "etag": receipt.get("headers", {}).get("etag"),
                "sha256": receipt.get("sha256"), "conditionalHeaders": conditional}
            op["writeStarted"], op["state"], op["phase"] = True, "running", "original-conditional-write"
            self._save_exchange(op, "retain-original-mutation-intent")
            response = self._exchange_http(op, request, "PUT", name="original-conditional-write",
                headers={"Accept": "application/fhir+json", "Accept-Encoding": "identity",
                         "Content-Type": "application/fhir+json", "Prefer": "return=representation", **conditional},
                body=request["bodyJson"].encode())
            if not response.get("complete"):
                op["state"], op["phase"] = "ready", "read-after-interruption"
                return self._save_exchange(op, "retain-interrupted-original-write")
            if response["status"] not in {200, 201, 204}:
                return self._exchange_failure(op, response, "conditional-write-result")
            op["state"], op["phase"] = "ready", "read-after-write"
            self._save_exchange(op, "retain-provider-write-receipt")
            final = self._exchange_http(op, request, "GET", name="read-after-write")
            if not final.get("complete") or final.get("status") != 200:
                return self._exchange_failure(op, final, "read-after-write")
            _, received = self._exchange_resource(op, final)
            if comparable(received) != comparable(desired):
                op["state"], op["phase"] = "review-required", "received-resource-differs"
                op["result"] = {"changes": list(changed_values(desired, received)), "receiptId": final["id"]}
                return self._save_exchange(op, "retain-receiving-difference")
            return self._complete_exchange(op, request, final, "conditional-write-read-back")

    def prepare_referral_monitoring(self, raw):
        v = schema.common(schema.obj(raw, {"label", "actor", "note", "configurationId", "connectionId",
            "discoveryId", "since", "until", "owner", "requester", "statuses", "taskId", "history"},
            {"label", "actor", "configurationId", "connectionId", "discoveryId"}, "Selected native monitoring"))
        with self.mutex:
            config = self.referral_record("configurations", v["configurationId"])
            if v["connectionId"] not in {r["connectionId"] for r in config["roles"] if r.get("connectionId")}:
                raise InputError("Monitoring uses an original connection selected by this topology")
            v["since"] = schema.timestamp(v.get("since"), "Original lower window")
            v["until"] = schema.timestamp(v.get("until"), "Original upper window")
            if v["since"] and v["until"] and fhir.epoch(v["since"]) >= fhir.epoch(v["until"]):
                raise InputError("The original monitoring window must have increasing bounds")
            for key in ["owner", "requester"]:
                v[key] = schema.text(v.get(key, ""), "Original " + key + " filter", 2000)
            v["statuses"] = v.get("statuses", [])
            if not isinstance(v["statuses"], list) or any(s not in schema.TASK_STATUSES for s in v["statuses"]):
                raise InputError("Monitoring retains its selected original referral status filters")
            v["history"] = v.get("history", False)
            if type(v["history"]) is not bool:
                raise InputError("History selection is boolean")
            v.setdefault("taskId", None)
            connection = self.connection(v["connectionId"])["connection"]
            discovery = self.discovery(v["discoveryId"])
            if discovery["connectionId"] != v["connectionId"]:
                raise InputError("Select actual monitoring discovery from this exact connection")
            if v["history"]:
                if not isinstance(v["taskId"], str) or not re.fullmatch(r"[A-Za-z0-9.-]{1,64}", v["taskId"]):
                    raise InputError("History receiving selects an exact original Task logical ID")
                if v["until"] or v["owner"] or v["requester"] or v["statuses"]:
                    raise InputError("Instance history accepts the selected since instant; use Task search for an upper window, owner, requester or status filters")
                capabilities = discovery["capabilities"].get("resources", {}).get("Task", {})
                if "history-instance" not in capabilities.get("interactions", []):
                    raise InputError("The selected actual Task endpoint did not advertise instance history")
                parameters = [{"name": "_since", "value": v["since"]}] if v["since"] else []
                url = connection["baseUrl"].rstrip("/") + "/Task/" + v["taskId"] + "/_history"
                if parameters:
                    url += "?" + urlencode([(r["name"], r["value"]) for r in parameters])
                request = self.save_request({"label": v["label"], "connectionId": v["connectionId"],
                    "route": "bundle-url", "url": url,
                    "followReferences": True, "resourceTypes": [], "note": v["note"]})
                search = {"history": v["taskId"], "parameters": parameters, "url": url}
            else:
                if v["taskId"]:
                    raise InputError("An exact history Task ID applies only to selected instance history")
                parameters = []
                for key, prefix in [("since", "ge"), ("until", "lt")]:
                    if v[key]:
                        parameters.append({"name": "_lastUpdated", "value": prefix + v[key]})
                for key in ["owner", "requester"]:
                    if v[key]:
                        parameters.append({"name": key, "value": v[key]})
                if v["statuses"]:
                    parameters.append({"name": "status", "value": ",".join(v["statuses"])})
                search = {"resourceType": "Task", "parameters": parameters}
                request = self.save_request({"label": v["label"], "connectionId": v["connectionId"],
                    "discoveryId": v["discoveryId"], "route": "rest-graph", "searches": [search],
                    "followReferences": True, "resourceTypes": [], "note": v["note"]})
            return self._referral_store("monitoring", {**v, "search": search, "requestId": request["id"]})
