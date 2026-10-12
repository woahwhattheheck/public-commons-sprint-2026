"""MIT. Frozen referral handoffs and complete original editable receiving."""
from __future__ import annotations
import csv
import html
import io
import os
from pathlib import Path
import re
import shutil
import stat
import uuid
import zipfile

from referral_runtime import (BaseWorkspace, InputError, ConflictError, original_workspace,
    source, fhir, private_directory, atomic_json, safe_read, now, write_zip)
import referral_schema as schema

WORKSPACE_PACKET = "stellar-forge.gravity-referral-workspace-packet.v1"
HANDOFF_PACKET = "stellar-forge.gravity-referral-handoff-packet.v1"
REGISTRY_SCHEMA = "stellar-forge.gravity-referral-registry.v1"
MAX_PACKET = 512 * 1024 * 1024
MAX_REGISTRY = 64 * 1024 * 1024
STYLE = """body{font:14px system-ui,sans-serif;color:#242629;background:#fff;max-width:1280px;margin:auto;padding:32px}a{color:inherit}h1{font-size:25px}h2{font-size:19px;margin-top:32px}h3{font-size:16px}table{border-collapse:collapse;width:100%;margin:16px 0}td,th{border:1px solid #c5c8cb;text-align:left;padding:8px;vertical-align:top}th{background:#f3f4f5}pre,code{font:12px ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere}.meta{padding:16px;border:1px solid #c5c8cb}small{color:#53585d}"""

def esc(value):
    return html.escape(str(value if value is not None else ""), quote=True)

def safe_name(name):
    source.member_name(name)
    if not re.fullmatch(r"[A-Za-z0-9_./-]+", name):
        raise InputError("Receiving paths must retain simple relative native names")
    return name

def file_info(path, maximum=MAX_PACKET):
    path = Path(path).expanduser().absolute()
    info = path.lstat()
    if path.is_symlink() or not stat.S_ISREG(info.st_mode) or info.st_size > maximum:
        raise InputError("Select a complete regular receiving file within 512 MiB")
    import hashlib
    h = hashlib.sha256()
    with path.open("rb") as stream:
        while block := stream.read(65536):
            h.update(block)
    return path, info.st_size, h.hexdigest()

def csv_bytes(columns, rows):
    out = io.StringIO(newline="")
    writer = csv.writer(out, lineterminator="\r\n")
    writer.writerow(columns)
    for row in rows:
        values = []
        for value in row:
            value = "" if value is None else str(value)
            values.append("'" + value if value[:1] in {"=", "+", "-", "@", "\t", "\r"} else value)
        writer.writerow(values)
    return out.getvalue().encode("utf-8")

def table(columns, rows):
    return "<table><thead><tr>" + "".join("<th>" + esc(x) + "</th>" for x in columns) + \
        "</tr></thead><tbody>" + "".join("<tr>" + "".join("<td>" + esc(v) + "</td>" for v in row) +
        "</tr>" for row in rows) + "</tbody></table>"

class ReferralReceiving:
    def _referral_registry(self):
        return {"schema": REGISTRY_SCHEMA, "workspaceId": self.workspace_id,
            "records": {kind: self.referral_records(kind) for kind in sorted(schema.KINDS - {"receives"})},
            "sourceProfileSha256": source.sha(source.jbytes(self.referral_profile())),
            "implementation": {"workspaceSchema": self.version, "sourceSchema": source.SOURCE_SCHEMA,
                               "referralSchema": schema.SCHEMA}}

    @staticmethod
    def _referral_files(registry):
        files = {}
        def add(d):
            if not isinstance(d, dict):
                raise InputError("Retained receiving descriptor is missing")
            ident = source.identity(d.get("sha256"))
            source.integer(d.get("bytes"), 0, source.MAX_SOURCE, "Retained file size")
            schema.text(d.get("role"), "Retained file role", 200, True)
            old = files.get(ident)
            if old and old["bytes"] != d["bytes"]:
                raise InputError("One retained file has conflicting byte counts")
            files[ident] = d
        records = registry["records"]
        for r in records["assessments"]:
            add(r["reportFile"])
        for r in records["comparisons"] + records["correctionPreviews"]:
            add(r["changesFile"])
        for r in records["handoffs"]:
            add(r["nativeSnapshot"])
            add(r["referralSnapshot"])
            for d in r["files"].values():
                add(d)
            for d in r["custody"].values():
                add(d)
        return files

    def _referral_custody(self, registry):
        files = {}
        for operation in registry["records"]["exchangeOperations"]:
            directory = self._exchange_directory(operation["id"])
            if directory.is_symlink() or not directory.is_dir():
                raise InputError("Original exchange custody directory is missing")
            for path in sorted(directory.rglob("*")):
                if path.is_symlink():
                    raise InputError("Original exchange custody contains a link")
                if path.is_dir():
                    continue
                original_workspace.regular(path)
                files["files/" + path.relative_to(self.root).as_posix()] = path
            operation_file = directory / "operation.json"
            if source.json_value(safe_read(operation_file, MAX_REGISTRY)) != operation:
                raise InputError("Saved native exchange differs from its original durable operation file")
        return files

    def _referral_write_packet(self, output, registry, members, packet_schema, handoff_id=None):
        path = Path(output).expanduser().absolute()
        if path.exists():
            raise ConflictError("Choose a new complete receiving file")
        entries, total = {}, 0
        members = {**members, "referral-registry.json": source.jbytes(registry)}
        if len(members["referral-registry.json"]) > MAX_REGISTRY:
            raise InputError("The complete referral registry exceeds 64 MiB")
        for name, value in members.items():
            safe_name(name)
            if isinstance(value, bytes):
                size, digest = len(value), source.sha(value)
            else:
                _, size, digest = file_info(value)
            total += size
            if total > MAX_PACKET or len(entries) >= 20000:
                raise InputError("The complete receiving selection exceeds 512 MiB or 20,000 members")
            entries[name] = {"bytes": size, "sha256": digest}
        manifest = {"schema": packet_schema, "workspaceId": registry["workspaceId"], "files": entries,
            "registrySha256": entries["referral-registry.json"]["sha256"],
            "totalBytes": total, "fileCount": len(entries), "handoffId": handoff_id,
            "nativeSchema": "stellar-forge.eltss-workspace-packet.v1"}
        write_zip(path, {**members, "manifest.json": source.jbytes(manifest)})
        _, size, digest = file_info(path)
        return {"schema": packet_schema, "file": str(path), "bytes": size, "sha256": digest,
            "workspaceId": registry["workspaceId"], "fileCount": len(entries),
            "originalBytes": total, "handoffId": handoff_id}

    def export_workspace(self, output):
        with self.mutex, self.scratch() as temp:
            native = Path(temp) / "native-workspace.zip"
            BaseWorkspace.export_workspace(self, native)
            registry = self._referral_registry()
            members = {"native-workspace.zip": native, **self._referral_custody(registry)}
            for ident, descriptor in self._referral_files(registry).items():
                members["files/eltss/files/" + ident + ".bin"] = self._file_path(descriptor)
            return self._referral_write_packet(output, registry, members, WORKSPACE_PACKET)

    def prepare_referral_handoff(self, raw):
        v = schema.common(schema.obj(raw, {"label", "actor", "note", "editionId", "assessmentId",
            "receiver", "scope", "purpose", "sourceRefs"}, {"label", "actor", "editionId",
            "assessmentId", "receiver", "scope"}, "Complete referral handoff"))
        v["scope"] = schema.enum(v["scope"], ["complete-workspace"], "Receiving scope")
        v["receiver"] = schema.text(v["receiver"], "Selected receiving organisation or role", 1000, True)
        v["purpose"] = schema.text(v.get("purpose", ""), "Receiving purpose", 4000)
        with self.mutex, self.scratch() as temp:
            edition = self.referral_record("editions", v["editionId"])
            assessment = self.referral_record("assessments", v["assessmentId"])
            if assessment["editionId"] != edition["id"]:
                raise InputError("Select the frozen assessment for this exact referral edition")
            report = self.referral_assessment(assessment["id"])
            review = self.referral_record("reviews", assessment["reviewId"])
            config = self.referral_record("configurations", edition["configurationId"])
            v["sourceRefs"] = self._referral_refs(schema.refs(v.get("sourceRefs", [])))
            v["taskCount"] = len(edition["taskIds"])
            v["requestSha256"] = source.sha(source.jbytes(v))
            for old in self.referral_records("handoffs"):
                if old["requestSha256"] == v["requestSha256"]:
                    for descriptor in old["files"].values():
                        self._file_path(descriptor)
                    return old
            files = {}
            def put(name, data, role):
                safe_name(name)
                path = Path(temp) / name
                original_workspace.private_write(path, data)
                files[name] = self._retain_file(path, role)
            snapshot = {"schema": "stellar-forge.gravity-referral-handoff.v1", "workspaceId": self.workspace_id,
                "request": v, "edition": edition, "assessment": assessment, "review": review,
                "configuration": config, "frozenAt": assessment["asOf"]}
            tasks = report["tasks"]
            put("Handoff_Snapshot.json", source.jbytes(snapshot), "frozen-referral-handoff")
            put("Assessment.json", source.jbytes(report), "complete-referral-assessment")
            put("Reviewed_Requirements.json", source.jbytes(review), "complete-source-requirement-review")
            put("Topology.json", source.jbytes(config), "selected-server-and-actor-topology")
            originals = []
            for ident in edition["taskIds"]:
                row = self.source_row(edition["sourceId"], ident)
                originals.append({"recordId": ident, "sourceId": edition["sourceId"], "sourceRef": {
                    "sourceId": edition["sourceId"], "recordId": ident, "pointer": row["entryPointer"]},
                    "jsonText": row["jsonText"], "sha256": row["resourceSha256"]})
            put("Original_Referrals.json", source.jbytes(originals), "complete-original-referral-records")
            put("Source_References.json", source.jbytes({"profileSha256": review["profileSha256"],
                "profile": review["profileSnapshot"], "selected": v["sourceRefs"],
                "source": self.source(edition["sourceId"])}), "complete-primary-source-and-intake-index")
            operations = [r for r in self.referral_records("exchangeOperations")
                if self.referral_record("exchangeRequests", r["requestId"])["editionId"] == edition["id"]]
            put("Native_Exchange_History.json", source.jbytes(operations), "actual-native-exchange-history")
            put("Referral_Queue.csv", csv_bytes(["Task record ID", "Original logical ID", "Status", "Owner",
                "Requester", "Subject", "Authored", "Contact prohibited", "Consent decisions", "Source ID"],
                [[r["taskId"], r["logicalId"], r["status"], r["owner"], r["requester"], r["subject"],
                  r["authoredOn"], r["contactProhibited"], ",".join(r["consentDecisionIds"]), edition["sourceId"]]
                 for r in tasks]), "complete-referral-queue")
            put("Field_Review.csv", csv_bytes(["Task record ID", "Field key", "Label", "Original presence",
                "Original value JSON", "Original source references"],
                [[c["taskId"], c.get("fieldKey", c.get("key")), c.get("label"), c.get("state"),
                  c.get("jsonText", c.get("valueJson", source.lexical_json(c.get("values")))),
                  source.jbytes(c.get("sourceRefs", [])).decode().strip()] for c in report["cells"]]),
                "complete-original-field-reviews")
            put("Findings.csv", csv_bytes(["Finding ID", "Task record ID", "Rule", "Severity", "Message",
                "Source references", "Decision IDs"],
                [[r.get("id"), r.get("taskId"), r.get("rule"), r.get("severity"), r.get("label"),
                  source.jbytes(r.get("sourceRefs", [])).decode().strip(),
                  r.get("decisionId", "")] for r in report["findings"]]), "complete-referral-findings")
            links = ["Assessment.json", "Reviewed_Requirements.json", "Topology.json", "Original_Referrals.json",
                "Source_References.json", "Native_Exchange_History.json", "Referral_Queue.csv", "Field_Review.csv",
                "Findings.csv", "Handoff_Snapshot.json"]
            doc = "<!doctype html><html lang=en><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>" + esc(v["label"]) + "</title><style>" + STYLE + "</style><body><h1>" + esc(v["label"]) + "</h1>"
            doc += "<div class=meta><p>Receiver: " + esc(v["receiver"]) + "</p><p>Purpose: " + esc(v["purpose"]) + "</p><p>Frozen assessment: " + esc(assessment["asOf"]) + "</p><p>Source classification: " + esc(config["classification"]) + ". Selected source version: " + esc(config["sourceVersion"]) + ".</p><p>Workspace: <code>" + esc(self.workspace_id) + "</code></p><p>" + esc(v["note"]) + "</p></div>"
            doc += "<h2>Receiving files</h2><ul>" + "".join("<li><a href='" + name + "'>" + name + "</a></li>" for name in links) + "</ul><p>The complete editable packet retains the native workspace, every selected original source, review, decision, dataset and conditional exchange receipt. Reopen it into a fresh private Gravity workspace; the original workspace UUID is retained.</p>"
            doc += "<h2>Actor and server ownership</h2><p>Topology: " + esc(config["topology"]) + "; recipient host role: " + esc(config["recipientHostRole"]) + ".</p>" + table(["Role", "Original organisation", "Owner", "Selected connection"], [[r["role"], r["organization"], r["owner"], r["connectionId"]] for r in config["roles"]])
            doc += "<h2>Referral queue</h2>" + table(["Original Task", "Status", "Owner", "Requester", "Subject", "Contact prohibited"], [[r["logicalId"], r["status"], r["owner"], r["requester"], r["subject"], r["contactProhibited"]] for r in tasks])
            doc += "<h2>Review findings</h2>" + table(["Severity", "Original Task", "Finding"], [[r["severity"], r.get("taskId"), r.get("label")] for r in report["findings"]])
            doc += "<h2>Requirements and mapping</h2><p>All 57 original requirements and all 24 original field review rows remain in the editable review. The saved review records its actual owner, disposition and source references.</p>" + table(["Kind", "Counts"], [[k, source.jbytes(vv).decode().strip()] for k, vv in review["counts"].items()])
            doc += "<h2>Native receiving</h2>" + table(["Operation", "State", "Phase", "Retained source"], [[r["id"], r["state"], r["phase"], r.get("sourceId")] for r in operations])
            doc += "<h2>Operator continuation</h2><ol><li>Open the original referral edition, topology and complete source members.</li><li>Review the saved requirement and field dispositions, consent purpose and unresolved reference findings.</li><li>Record authored changes as a new preview and successor edition; retain the original preimage.</li><li>For an authorised selected endpoint, discover its actual capability and retain the complete conditional exchange and readback.</li><li>Attach the actual receiving result and record its destination, operator and original operation ID.</li></ol></body></html>"
            put("Referral_Handoff.html", doc.encode("utf-8"), "readable-complete-referral-handoff")
            registry = self._referral_registry()
            native = Path(temp) / "native-workspace.zip"
            BaseWorkspace.export_workspace(self, native)
            native_snapshot = self._retain_file(native, "frozen-complete-native-workspace")
            registry_path = Path(temp) / "referral-registry.json"
            original_workspace.private_write(registry_path, source.jbytes(registry))
            registry_snapshot = self._retain_file(registry_path, "frozen-complete-referral-registry")
            custody = {name: self._retain_file(path, "frozen-original-referral-exchange")
                       for name, path in self._referral_custody(registry).items()}
            return self._referral_store("handoffs", {**v, "reviewId": review["id"],
                "files": files, "nativeSnapshot": native_snapshot, "referralSnapshot": registry_snapshot,
                "custody": custody, "frozenAt": assessment["asOf"]})

    def export_referral_handoff(self, ident, output):
        with self.mutex:
            handoff = self.referral_record("handoffs", ident)
            registry = source.json_value(safe_read(self._file_path(handoff["referralSnapshot"]), MAX_REGISTRY))
            if registry["workspaceId"] != self.workspace_id:
                raise InputError("Frozen handoff belongs to another original workspace")
            if not any(r["id"] == ident for r in registry["records"]["handoffs"]):
                registry["records"]["handoffs"].append(handoff)
            members = {"native-workspace.zip": self._file_path(handoff["nativeSnapshot"]),
                       "handoff.json": source.jbytes(handoff)}
            for name, descriptor in handoff["files"].items():
                members[safe_name(name)] = self._file_path(descriptor)
            for name, descriptor in handoff["custody"].items():
                members[safe_name(name)] = self._file_path(descriptor)
            for sha, descriptor in self._referral_files(registry).items():
                members["files/eltss/files/" + sha + ".bin"] = self._file_path(descriptor)
            return self._referral_write_packet(output, registry, members, HANDOFF_PACKET, ident)

    def save_referral_receiving(self, raw):
        v = schema.common(schema.obj(raw, {"label", "actor", "note", "handoffId", "receiver", "state",
            "artifactId", "destinationObjectId", "operationId", "receivedAt", "correctionOf", "sourceRefs"},
            {"label", "actor", "handoffId", "receiver", "state", "operationId"}, "Actual referral receiving"))
        v["receiver"] = schema.text(v["receiver"], "Actual receiver", 1000, True)
        v["state"] = schema.enum(v["state"], ["received", "accepted", "needs-correction", "rejected"], "Receiving state")
        v["operationId"] = fhir.operation_id(v["operationId"])
        v["receivedAt"] = schema.timestamp(v.get("receivedAt") or now(), "Actual receiving time", False)
        v["destinationObjectId"] = schema.text(v.get("destinationObjectId", ""), "Actual receiving object", 2000)
        v.setdefault("artifactId", None)
        v.setdefault("correctionOf", None)
        if not v["artifactId"] and not v["destinationObjectId"]:
            raise InputError("Retain the complete receiving result or its exact original destination object")
        with self.mutex:
            handoff = self.referral_record("handoffs", v["handoffId"])
            if v["artifactId"]:
                self.artifact_path(v["artifactId"])
            if v["correctionOf"]:
                self.referral_record("receivings", v["correctionOf"])
            v["sourceRefs"] = self._referral_refs(schema.refs(v.get("sourceRefs", [])))
            v["handoffRequestSha256"] = handoff["requestSha256"]
            for old in self.referral_records("receivings"):
                if old["operationId"] == v["operationId"]:
                    comparable = {k: value for k, value in old.items() if k not in {"id", "createdAt"}}
                    if comparable != v:
                        raise ConflictError("The original receiving operation is already bound to another complete result")
                    return old
            return self._referral_store("receivings", v)

    def prepare_referral_export(self, raw):
        v = schema.obj(raw, {"kind", "id", "label"}, {"kind"}, "Complete file preparation")
        kind = schema.enum(v["kind"], ["workspace", "handoff", "assessment", "comparison", "exchange-operation"], "Export kind")
        if kind != "workspace":
            v["id"] = fhir.operation_id(v.get("id")) if kind == "exchange-operation" else source.identity(v.get("id"))
        label = schema.text(v.get("label", "Gravity " + kind), "Export label", 200, True)
        with self.mutex, self.scratch() as temp:
            if kind in {"workspace", "handoff"}:
                path = Path(temp) / ("Gravity_" + kind + ".zip")
                result = self.export_workspace(path) if kind == "workspace" else self.export_referral_handoff(v["id"], path)
                media = "application/zip"
            elif kind in {"assessment", "comparison"}:
                row = self.referral_record("assessments" if kind == "assessment" else "comparisons", v["id"])
                path = self._file_path(row["reportFile" if kind == "assessment" else "changesFile"])
                media = "application/json"
                result = {"bytes": path.stat().st_size, "sha256": original_workspace.file_digest(path)}
            else:
                op = self.referral_exchange_operation(v["id"])
                path = Path(temp) / "Gravity_Exchange_Operation.zip"
                members = {}
                directory = self._exchange_directory(op["id"])
                for p in sorted(directory.rglob("*")):
                    if p.is_symlink():
                        raise InputError("Original operation custody contains a link")
                    if p.is_file():
                        original_workspace.regular(p)
                        members[p.relative_to(directory).as_posix()] = p
                write_zip(path, members)
                media = "application/zip"
                result = {"bytes": path.stat().st_size, "sha256": original_workspace.file_digest(path)}
            if result["bytes"] > source.MAX_SOURCE:
                raise InputError("A retained delivery artifact supports 256 MiB; use the direct complete packet route for a larger workspace")
            with path.open("rb") as stream:
                artifact = self.add_artifact(stream, label, "Gravity_" + kind + (".zip" if media == "application/zip" else ".json"), media)
            return {"kind": kind, "selectionId": v.get("id"), "workspaceId": self.workspace_id,
                "artifact": artifact, "file": {"route": "/api/artifacts/" + artifact["id"] + "/file",
                    "bytes": artifact["bytes"], "sha256": artifact["file"]["sha256"],
                    "name": artifact["name"], "contentType": artifact["contentType"]},
                "source": {k: value for k, value in result.items() if k != "file"}}

    def _read_referral_packet(self, path, temp, packet_schema):
        manifest_path = "manifest.json"
        with zipfile.ZipFile(path) as z:
            infos = z.infolist()
            names = [i.filename for i in infos]
            if len(names) != len(set(names)) or len(names) > 20001:
                raise InputError("Complete receiving ZIP repeats a member or exceeds 20,000 files")
            for info in infos:
                safe_name(info.filename)
                if info.is_dir() or stat.S_ISLNK(info.external_attr >> 16) or info.flag_bits & 1:
                    raise InputError("Receiving ZIP supports original regular unencrypted members only")
            if manifest_path not in names or z.getinfo(manifest_path).file_size > MAX_REGISTRY:
                raise InputError("Receiving ZIP lacks its complete manifest")
            manifest = source.json_value(z.read(manifest_path))
            if manifest.get("schema") != packet_schema or not isinstance(manifest.get("files"), dict):
                raise InputError("Select the complete original Gravity receiving schema")
            if set(names) != set(manifest["files"]) | {manifest_path}:
                raise InputError("Receiving ZIP member selection differs from its complete manifest")
            if manifest.get("fileCount") != len(manifest["files"]):
                raise InputError("Receiving manifest file count differs")
            if str(uuid.UUID(manifest.get("workspaceId"))) != manifest["workspaceId"]:
                raise InputError("Receiving workspace requires its original canonical UUID")
            staged, total = {}, 0
            for name, descriptor in manifest["files"].items():
                safe_name(name)
                schema.obj(descriptor, {"bytes", "sha256"}, {"bytes", "sha256"}, "Original byte binding")
                size = source.integer(descriptor["bytes"], 0, MAX_PACKET, "Original member size")
                source.identity(descriptor["sha256"])
                total += size
                if total > MAX_PACKET or z.getinfo(name).file_size != size:
                    raise InputError("Receiving bytes exceed the original member or whole packet bounds")
                target = Path(temp) / name
                target.parent.mkdir(parents=True, exist_ok=True)
                with z.open(name) as inp, os.fdopen(os.open(target, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600), "wb") as out:
                    remaining = size
                    while block := inp.read(min(65536, remaining + 1)):
                        remaining -= len(block)
                        if remaining < 0:
                            raise InputError("Receiving original is longer than its declared complete bytes")
                        out.write(block)
                if remaining or file_info(target)[2] != descriptor["sha256"]:
                    raise InputError("Receiving original member differs from its complete hash")
                staged[name] = target
            if total != manifest.get("totalBytes"):
                raise InputError("Receiving original byte total differs")
        if "native-workspace.zip" not in staged or "referral-registry.json" not in staged:
            raise InputError("Receiving omitted its complete native workspace or referral registry")
        if manifest.get("registrySha256") != manifest["files"]["referral-registry.json"]["sha256"]:
            raise InputError("Receiving registry identity differs")
        registry = source.json_value(safe_read(staged["referral-registry.json"], MAX_REGISTRY))
        if registry.get("schema") != REGISTRY_SCHEMA or registry.get("workspaceId") != manifest["workspaceId"]:
            raise InputError("Receiving registry belongs to another original schema or workspace")
        if set(registry.get("records", {})) != schema.KINDS - {"receives"}:
            raise InputError("Receiving registry must contain every original referral collection")
        from referral_workspace import clean_record
        for kind, rows in registry["records"].items():
            if not isinstance(rows, list) or len(rows) > 100000:
                raise InputError("Receiving collection must be its complete bounded array")
            seen = set()
            for row in rows:
                clean_record(kind, row)
                if row["id"] in seen:
                    raise InputError("Receiving repeats an original record identity")
                seen.add(row["id"])
        descriptors = self._referral_files(registry)
        required = {"native-workspace.zip", "referral-registry.json"}
        for sha, descriptor in descriptors.items():
            name = "files/eltss/files/" + sha + ".bin"
            required.add(name)
            if manifest["files"].get(name) != {"sha256": sha, "bytes": descriptor["bytes"]}:
                raise InputError("Receiving omitted or changed a complete retained domain file")
        custody = set()
        for row in registry["records"]["exchangeOperations"]:
            prefix = "files/referral/operations/" + fhir.operation_id(row["id"]) + "/"
            original = prefix + "operation.json"
            if original not in staged or source.json_value(safe_read(staged[original], MAX_REGISTRY)) != row:
                raise InputError("Received original exchange differs from its durable operation")
            custody.update(name for name in staged if name.startswith(prefix))
        human = set()
        if packet_schema == HANDOFF_PACKET:
            ident = source.identity(manifest.get("handoffId"))
            selected = next((r for r in registry["records"]["handoffs"] if r["id"] == ident), None)
            if not selected or "handoff.json" not in staged or source.json_value(safe_read(staged["handoff.json"], MAX_REGISTRY)) != selected:
                raise InputError("Received handoff selection differs from its original snapshot")
            human.add("handoff.json")
            for name, descriptor in selected["files"].items():
                safe_name(name); human.add(name)
                if manifest["files"].get(name) != {"sha256": descriptor["sha256"], "bytes": descriptor["bytes"]}:
                    raise InputError("Complete readable handoff differs from its original descriptor")
        if set(staged) != required | custody | human:
            raise InputError("Receiving contains an undeclared native or private file")
        return manifest, registry, staged

    def _verify_referral_received(self, registry):
        for r in registry["records"]["configurations"]:
            schema.configuration({k: v for k, v in r.items() if k not in {"id", "createdAt"}})
            for role in r["roles"]:
                if role.get("connectionId"):
                    self.connection(role["connectionId"])
            if r.get("legacyProfileArtifactId"):
                self.artifact_path(r["legacyProfileArtifactId"])
        for r in registry["records"]["editions"]:
            self.source(r["sourceId"])
            self.referral_record("configurations", r["configurationId"])
            graph = self.graph_view(r["graphId"])
            if graph["sourceId"] != r["sourceId"]:
                raise InputError("Received referral graph changed its source selection")
            for ident in r["taskIds"]:
                if self.source_row(r["sourceId"], ident)["resourceType"] != "Task":
                    raise InputError("Received referral selection no longer identifies the original Task")
            if r.get("predecessorId"):
                self.referral_record("editions", r["predecessorId"])
        for r in registry["records"]["reviews"]:
            p = r["profileSnapshot"]
            if len(p["requirements"]) != 57 or len(p["fields"]) != 24 or source.sha(source.jbytes(p)) != r["profileSha256"]:
                raise InputError("Received review changed its complete original requirements or field profile")
            if {v["key"] for v in r["requirements"]} != {v["key"] for v in p["requirements"]} or {v["key"] for v in r["fields"]} != {v["key"] for v in p["fields"]}:
                raise InputError("Received review omitted an original requirement or field")
        for r in registry["records"]["assessments"]:
            edition = self.referral_record("editions", r["editionId"])
            self.referral_record("reviews", r["reviewId"])
            report = self.referral_assessment(r["id"])
            if report["editionId"] != edition["id"] or [v["taskId"] for v in report["tasks"]] != edition["taskIds"]:
                raise InputError("Received assessment changed its original referral selection")
            expected = {(i, f["key"]) for i in edition["taskIds"] for f in self.referral_record("reviews", r["reviewId"])["fields"]}
            actual = {(c["taskId"], c.get("fieldKey", c.get("key"))) for c in report["cells"]}
            if expected != actual or len(actual) != len(report["cells"]):
                raise InputError("Received assessment omitted or repeated an original field cell")
        for r in registry["records"]["decisions"]:
            self.referral_record("editions", r["editionId"])
            self._referral_refs(r["sourceRefs"])
            if r.get("supersedesId"):
                self.referral_record("decisions", r["supersedesId"])
        for r in registry["records"]["exchangeRequests"]:
            self.referral_record("editions", r["editionId"])
            self.connection(r["connectionId"]); self.discovery(r["discoveryId"])
        for r in registry["records"]["exchangeOperations"]:
            request = self.referral_record("exchangeRequests", r["requestId"])
            if request["requestSha256"] != r["requestSha256"]:
                raise InputError("Received exchange changed its original request identity")
            if r.get("sourceId"):
                self.source(r["sourceId"])
        for r in registry["records"]["handoffs"]:
            assessment = self.referral_record("assessments", r["assessmentId"])
            if assessment["editionId"] != r["editionId"] or assessment["reviewId"] != r["reviewId"]:
                raise InputError("Received handoff changed its original complete assessment")
        for r in registry["records"]["receivings"]:
            handoff = self.referral_record("handoffs", r["handoffId"])
            if handoff["requestSha256"] != r["handoffRequestSha256"]:
                raise InputError("Received result belongs to another frozen handoff")
            if r.get("artifactId"):
                self.artifact_path(r["artifactId"])

    def _receive_referral(self, packet_path, packet_schema):
        path, _, archive_id = file_info(packet_path)
        with self.mutex:
            previous = self.referral_record("receives", archive_id, required=False)
            if previous and previous["state"] == "complete":
                return {"workspaceId": self.workspace_id, "archiveSha256": archive_id,
                        "reconstructed": True, "recovered": True, "state": self.state()}
            for other in self.referral_records("receives"):
                if other["state"] != "complete" and other["id"] != archive_id:
                    raise ConflictError("Continue the identical original receiving archive before another one")
            if previous is None:
                native = BaseWorkspace.state(self)
                if any(native[k] for k in ["sources", "plans", "builds", "comparisons"]) or any(
                    self.referral_records(k) for k in schema.KINDS - {"receives"}):
                    raise ConflictError("Receive the complete editable selection into a fresh empty Gravity workspace")
            with self.scratch() as temp:
                manifest, registry, staged = self._read_referral_packet(path, temp, packet_schema)
                if previous is None:
                    previous = {"id": archive_id, "archiveSha256": archive_id,
                        "state": "receiving", "workspaceId": registry["workspaceId"],
                        "kind": "handoff" if packet_schema == HANDOFF_PACKET else "workspace",
                        "createdAt": now(), "updatedAt": now(), "completed": [], "error": None}
                    self._referral_save("receives", previous)
                def checkpoint(step):
                    if step not in previous["completed"]:
                        previous["completed"].append(step)
                    previous["updatedAt"], previous["error"] = now(), None
                    self._referral_save("receives", previous)
                try:
                    BaseWorkspace.import_workspace(self, staged["native-workspace.zip"])
                    if self.workspace_id != registry["workspaceId"]:
                        raise InputError("Native receiving changed the original selected workspace UUID")
                    checkpoint("complete-native-workspace")
                    for name, original in staged.items():
                        if not name.startswith("files/"):
                            continue
                        destination = self.root / name[len("files/"):]
                        parent = self.root
                        for part in destination.relative_to(self.root).parts[:-1]:
                            parent = private_directory(parent / part)
                        if destination.exists():
                            if file_info(destination)[2] != manifest["files"][name]["sha256"]:
                                raise ConflictError("An original receiving path already has different bytes")
                        else:
                            pending = destination.with_name("." + destination.name + "." + uuid.uuid4().hex)
                            with original.open("rb") as inp, os.fdopen(os.open(pending, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600), "wb") as out:
                                shutil.copyfileobj(inp, out, 65536); out.flush(); os.fsync(out.fileno())
                            os.replace(pending, destination)
                            original_workspace.sync_dir(destination.parent)
                        checkpoint("file:" + name)
                    for kind, rows in registry["records"].items():
                        for row in rows:
                            self._referral_save(kind, row)
                        checkpoint("records:" + kind)
                    self._verify_referral_received(registry)
                    previous["state"], previous["updatedAt"] = "complete", now()
                    self._referral_save("receives", previous)
                    return {"workspaceId": self.workspace_id, "archiveSha256": archive_id,
                        "handoffId": manifest.get("handoffId"), "reconstructed": True, "state": self.state()}
                except Exception as error:
                    previous["error"], previous["updatedAt"] = str(error), now()
                    self._referral_save("receives", previous)
                    raise

    def import_workspace(self, path):
        return self._receive_referral(path, WORKSPACE_PACKET)

    def import_referral_handoff(self, path):
        return self._receive_referral(path, HANDOFF_PACKET)
