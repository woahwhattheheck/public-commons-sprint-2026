"""MIT. Complete care-plan receiving and exact, resumable editable workspace transfer."""
from __future__ import annotations
from collections import deque
import csv
import hashlib
import html
import io
import os
from pathlib import Path
import re
import shutil
import stat
import uuid
import zipfile
from urllib.parse import quote

from eltss_runtime import InputError, ConflictError, original_workspace, atomic_json, private_directory, safe_read, now, write_zip, fhir
import eltss_source as source
from eltss_validation import typed
from eltss_graph import closure, public_row

MAX_WORKSPACE = 512 * 1024 * 1024
MAX_REGISTRY = 64 * 1024 * 1024
WORKSPACE_PACKET = "stellar-forge.eltss-workspace-packet.v1"
HANDOFF_PACKET = "stellar-forge.eltss-handoff-packet.v1"
STYLE = "body{font:14px system-ui,sans-serif;max-width:1240px;margin:0 auto;padding:32px;color:#202124;background:#fff}a{color:inherit}h1{font-size:25px}h2{font-size:18px;margin-top:30px}table{width:100%;border-collapse:collapse;margin:16px 0}th,td{border:1px solid #bfc2c4;text-align:left;vertical-align:top;padding:9px}th{background:#f2f3f3}code,pre{font:12px ui-monospace,monospace;overflow-wrap:anywhere;white-space:pre-wrap}small{color:#52575a}.meta{border:1px solid #bfc2c4;padding:16px}li{margin:8px 0}"
def esc(value):
    return html.escape(str(value if value is not None else ""), quote=True)


def original_file(path, maximum=MAX_WORKSPACE):
    path = Path(path).expanduser().absolute()
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or path.is_symlink() or info.st_size > maximum:
        raise InputError("Select one complete regular file within its documented byte budget")
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while block := stream.read(65536):
            digest.update(block)
    return path, info.st_size, digest.hexdigest()


def member(name):
    source.member_name(name)
    if not re.fullmatch(r"[A-Za-z0-9_./-]+", name):
        raise InputError("Portable native file names use exact simple relative paths")
    return name


def csv_text(value):
    result = "" if value is None else str(value)
    return "'" + result if result[:1] in {"=", "+", "-", "@", "\t", "\r"} else result


def html_start(title):
    return "<!doctype html><html lang=en><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>" + esc(title) + "</title><style>" + STYLE + "</style><body><h1>" + esc(title) + "</h1>"


class ReceivingMixin:
    def add_artifact(self, stream, label=None, name=None, content_type=None):
        label = source.text(label or "Original receiving result", "Artifact label", 160, False)
        name = source.text(name or "receiving-result.bin", "Artifact name", 160, False)
        name = Path(name.replace("\\", "/")).name
        content_type = source.text(content_type or "application/octet-stream", "Artifact content type", 256, False)
        with self.mutex, self.scratch() as temp:
            path = Path(temp) / "original-result.bin"
            total = 0
            with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as output:
                while block := stream.read(65536):
                    total += len(block)
                    if total > source.MAX_SOURCE:
                        raise InputError("One complete received result exceeds 256 MiB")
                    output.write(block)
                output.flush()
                os.fsync(output.fileno())
            descriptor = self._retain_file(path, "original-receiving-artifact")
            return self._store("artifacts", {"label": label, "name": name, "bytes": total,
                "contentType": content_type, "file": descriptor})

    def artifact_path(self, ident):
        return self._file_path(self._get("artifacts", ident)["file"])

    def save_receiving(self, raw):
        value = typed("receiving", raw)
        value = {"destinationObjectId": "", "receivedAt": None, "artifactId": None,
            "correctionOf": None, "sourceRefs": [], "owner": "", "note": "", **value}
        with self.mutex:
            handoff = self.handoff(value["handoffId"])
            value["sourceRefs"] = [self._source_ref(ref) for ref in value["sourceRefs"]]
            if value["artifactId"]:
                self.artifact_path(value["artifactId"])
            if value["correctionOf"]:
                previous = self.receiving(value["correctionOf"])
                if previous["receiver"] != value["receiver"]:
                    raise InputError("A corrected receiving result retains its original receiving party")
            if value["state"] in {"received", "partial", "corrected"} and not value["receivedAt"]:
                raise InputError("An observed receiving result needs its actual receivedAt time")
            if value["state"] in {"received", "partial", "corrected"} and not (
                    value["destinationObjectId"] or value["artifactId"]):
                raise InputError("An observed receiving result needs its original destination ID or complete result artifact")
            request_sha = source.sha(source.jbytes(value))
            for row in self._list("receivings"):
                if row["operationId"] == value["operationId"]:
                    if row["requestSha256"] != request_sha:
                        raise ConflictError("Original receiving operation ID is bound to another exact result")
                    return row
            return self._store("receivings", {**value, "requestSha256": request_sha,
                "handoffRequestSha256": handoff["requestSha256"]})

    def receiving(self, ident):
        return self._get("receivings", ident)

    def prepare_handoff(self, raw):
        value = typed("handoff", raw)
        value = {"receiver": "", "decisionIds": [], **value}
        with self.mutex:
            edition = self.edition(value["editionId"])
            review = self.review_set(value["reviewSetId"])
            assessment = self.assessment(value["assessmentId"])
            if assessment["editionId"] != edition["id"] or assessment["reviewSetId"] != review["id"]:
                raise InputError("Handoff source edition, complete field review and assessment must be the same frozen selection")
            decisions = [self.decision(ident) for ident in value["decisionIds"]]
            request_sha = source.sha(source.jbytes(value))
            for old in self._list("handoffs"):
                if old["requestSha256"] == request_sha:
                    for descriptor in old["files"].values():
                        self._file_path(descriptor)
                    return old
            with self.scratch() as temp, self._graph(edition["graphId"]) as (graph, index, resolved, applied):
                selected = closure(index, assessment["carePlanIds"], graph["policy"], applied, value["scope"])
                files = {}
                def put(name, data, role):
                    path = Path(temp) / ("file-" + source.sha(name.encode()))
                    original_workspace.private_write(path, data)
                    files[name] = self._retain_file(path, role)
                bundle_path = Path(temp) / "bundle.json"
                nodes_path = Path(temp) / "nodes.jsonl"
                edges_path = Path(temp) / "edges.jsonl"
                selected_roots, reference_counts = 0, {}
                with os.fdopen(os.open(bundle_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as bundle, \
                     os.fdopen(os.open(nodes_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as nodes, \
                     os.fdopen(os.open(edges_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as edges:
                    bundle.write(('{"resourceType":"Bundle","type":"collection","id":"receiving-' + request_sha[:32] + '","entry":[').encode())
                    total = 0
                    for row in index.all_rows():
                        if row["recordId"] not in selected:
                            continue
                        node = public_row(row, False)
                        nodes.write(source.jbytes(node))
                        if row.get("containedIn") or row.get("bundleIn"):
                            continue
                        entry = {"resource": row["_resource"]}
                        if row.get("fullUrl") is not None:
                            entry["fullUrl"] = row["fullUrl"]
                        data = source.lexical_json(entry).encode()
                        total += len(data)
                        if total > source.MAX_SOURCE:
                            raise InputError("Selected complete receiving collection exceeds 256 MiB")
                        if selected_roots:
                            bundle.write(b",")
                        bundle.write(data)
                        selected_roots += 1
                    bundle.write(b"]}\n")
                    for edge in resolved.all_edges():
                        if edge["fromRecordId"] in selected:
                            edges.write(source.jbytes(edge))
                            reference_counts[edge["status"]] = reference_counts.get(edge["status"], 0) + 1
                    for stream in [bundle, nodes, edges]:
                        stream.flush()
                        os.fsync(stream.fileno())
                for name, path, role in [("resources/bundle.json", bundle_path, "selected-care-plan-collection"),
                    ("graph/nodes.jsonl", nodes_path, "selected-original-resource-identities"),
                    ("graph/edges.jsonl", edges_path, "selected-original-reference-edges")]:
                    files[name] = self._retain_file(path, role)
                files["fields/cells.jsonl"] = assessment["cellsFile"]
                profile = review.get("profileSnapshot") or self.profile(review["profileId"])
                put("fields/profile.json", source.jbytes(profile), "complete-original-field-profile")
                put("fields/review.json", source.jbytes(review), "complete-reviewed-field-selection")
                put("decisions.json", source.jbytes(decisions), "selected-operator-decisions")
                put("selection.json", source.jbytes({"request": value, "requestSha256": request_sha,
                    "edition": edition, "assessment": assessment, "graph": graph,
                    "carePlanIds": assessment["carePlanIds"], "sourceIds": [edition["sourceId"]]}), "frozen-receiving-selection")
                # Compact human pages preserve original cell links and all field rows.
                index_html = html_start(value["label"]) + "<div class=meta><p>Receiver: " + esc(value["receiver"]) + "</p><p>Source edition <code>" + esc(edition["id"]) + "</code></p><p>Request <code>" + request_sha + "</code></p><p>Scope: " + esc(value["scope"]) + "; " + str(len(selected)) + " resources, " + str(len(assessment["carePlanIds"])) + " selected CarePlans.</p></div>"
                index_html += "<p><a href='resources/bundle.json'>Complete selected collection</a> · <a href='fields/profile.json'>All 56 original mapping definitions</a> · <a href='fields/review.json'>Saved field review</a> · <a href='fields/cells.jsonl'>Complete original assessment values</a> · <a href='graph/edges.jsonl'>Original reference graph</a> · <a href='registry.json'>Editable receiving registry</a></p>"
                index_html += "<h2>CarePlan field review</h2><ul>"
                for careplan in assessment["carePlanIds"]:
                    row = index.row(careplan)
                    name = "careplans/" + careplan + ".html"
                    index_html += "<li><a href='" + name + "'>" + esc(row["id"] or careplan) + "</a></li>"
                    page = html_start("CarePlan " + (row["id"] or careplan))
                    page += "<p><a href='../START_HERE.html'>Receiving overview</a></p><p>Original record <code>" + careplan + "</code>; fullUrl <code>" + esc(row.get("fullUrl")) + "</code></p><table><thead><tr><th>Original field</th><th>Review and observation</th><th>Original values and locators</th></tr></thead><tbody>"
                    with self.assessment_file(assessment["id"]).open("rb") as stream:
                        for line in stream:
                            cell = source.json_value(line)
                            if cell["carePlanId"] != careplan:
                                continue
                            page += "<tr><td><strong>" + esc(cell["label"]) + "</strong><br><small>" + esc(cell["fieldKey"]) + " · " + esc(cell["group"]) + "</small></td><td>" + esc(cell["status"]) + "<br><small>" + esc(cell["reviewStatus"]) + " · " + esc(cell["applicability"]) + " · " + esc(cell["absencePolicy"]) + "</small></td><td>"
                            for original in cell["values"]:
                                text = original["jsonText"]
                                shown = text if len(text) <= 8192 else text[:8192] + "\n[Complete value is retained in fields/cells.jsonl and the original source.]"
                                page += "<pre>" + esc(shown) + "</pre><small><code>" + esc(original["recordId"]) + "</code><br>" + esc(original["pointer"]) + "</small>"
                                if original.get("convertedJsonText") != original["jsonText"]:
                                    page += "<p>Reviewed converted value</p><pre>" + esc(original.get("convertedJsonText")) + "</pre>"
                            if cell["unresolved"]:
                                page += "<p>Unresolved references: " + str(len(cell["unresolved"])) + "; see complete cells/graph.</p>"
                            if cell["findings"]:
                                page += "<pre>" + esc(source.jbytes(cell["findings"]).decode()[:8192]) + "</pre>"
                            page += "</td></tr>"
                            if len(page.encode()) > 16 * 1024 * 1024:
                                raise InputError("One human CarePlan page exceeds 16 MiB; narrow the selected cohort or field paths")
                    page += "</tbody></table><p>Presence, missing values and authored review states are retained separately. Original published guidance and selected endpoint capabilities remain available in their source files.</p></body></html>"
                    put(name, page.encode(), "human-care-plan-field-review")
                index_html += "</ul><h2>Original source files</h2><ul>"
                for source_row in self._handoff_sources(edition["sourceId"]):
                    index_html += "<li><a href='sources/" + source_row["id"] + ".eltss'>" + esc(source_row["label"]) + "</a> · " + str(source_row["bytes"]) + " bytes · <code>" + source_row["id"] + "</code></li>"
                index_html += "</ul><h2>Receiving</h2><p>Open this packet through the installed eLTSS operator’s Receive handoff control to restore its complete source selection. The packet manifest verifies every member. Record the actual destination ID, received time and unchanged result artifact in the original Receiving view.</p></body></html>"
                put("START_HERE.html", index_html.encode(), "human-receiving-overview")
                total_bytes = sum(item["bytes"] for item in files.values())
                if total_bytes > MAX_WORKSPACE:
                    raise InputError("Complete handoff content exceeds 512 MiB")
            return self._store("handoffs", {**value, "requestSha256": request_sha,
                "carePlanIds": assessment["carePlanIds"], "graphId": edition["graphId"],
                "resourceCount": len(selected), "rootResourceCount": selected_roots,
                "referenceCounts": reference_counts, "files": files})

    def handoff(self, ident):
        return self._get("handoffs", ident)

    def _handoff_sources(self, source_id):
        result, pending = {}, [source_id]
        while pending:
            ident = pending.pop()
            if ident in result:
                continue
            row = self.source(ident)
            result[ident] = row
            context = row["inventory"].get("sourceContext", {})
            candidate = context.get("sourceId")
            if isinstance(candidate, str) and self.db.execute("SELECT 1 FROM sources WHERE id=?", (candidate,)).fetchone():
                pending.append(candidate)
        return list(result.values())

    def _portable_registry(self, selected_handoff=None):
        from eltss_workspace import RECORD_KINDS
        state = self.state()
        records = {kind: self._list(kind) for kind in sorted(RECORD_KINDS - {"receives"})}
        sources = [self.source(row["id"]) for row in state["sources"]]
        plans = [{"id": row["id"], "plan": self.plan(row["id"]), "created": row["created"]} for row in state["plans"]]
        builds, comparisons = state["builds"], state["comparisons"]
        if selected_handoff:
            kept = {kind: {} for kind in records}
            kept_sources = {}
            queue = deque([("handoffs", selected_handoff)])
            def add(kind, ident):
                if ident and kind in kept and self._get(kind, ident, required=False):
                    queue.append((kind, ident))
            def add_source(ident):
                if ident in kept_sources:
                    return
                row = self.source(ident)
                kept_sources[ident] = row
                context = row["inventory"].get("sourceContext", {})
                for kind, key in [("connections", "connectionId"), ("requests", "requestId"), ("operations", "operationId"), ("editions", "sourceEditionId")]:
                    add(kind, context.get(key))
                candidate = context.get("sourceId")
                if isinstance(candidate, str) and self.db.execute("SELECT 1 FROM sources WHERE id=?", (candidate,)).fetchone():
                    add_source(candidate)
            while queue:
                kind, ident = queue.popleft()
                if ident in kept[kind]:
                    continue
                row = self._get(kind, ident)
                kept[kind][ident] = row
                for ref in row.get("sourceRefs", []):
                    add_source(ref["sourceId"])
                if row.get("sourceId"):
                    add_source(row["sourceId"])
                joins = {
                    "connections": [],
                    "discoveries": [("connections", "connectionId")],
                    "requests": [],
                    "operations": [("requests", "requestId"), ("connections", "connectionId")],
                    "graphs": [],
                    "editions": [("editions", "predecessorId"), ("graphs", "graphId")],
                    "reviewSets": [("reviewSets", "predecessorId")],
                    "assessments": [("editions", "editionId"), ("reviewSets", "reviewSetId"), ("graphs", "graphId")],
                    "decisions": [("decisions", "supersedesId"), ("assessments", "assessmentId")],
                    "editionComparisons": [("editions", "beforeId"), ("editions", "afterId")],
                    "correctionPreviews": [],
                    "corrections": [("editions", "sourceEditionId"), ("editions", "editionId"), ("correctionPreviews", "previewId")],
                    "handoffs": [("editions", "editionId"), ("reviewSets", "reviewSetId"), ("assessments", "assessmentId"), ("graphs", "graphId")],
                    "receivings": [("handoffs", "handoffId"), ("artifacts", "artifactId"), ("receivings", "correctionOf")],
                    "artifacts": []
                }
                for target, key in joins.get(kind, []):
                    add(target, row.get(key))
                for decision_id in row.get("decisionIds", []) + row.get("policy", {}).get("decisionIds", []):
                    add("decisions", decision_id)
                for edition_id in row.get("editionIds", []):
                    add("editions", edition_id)
                if kind == "requests":
                    add("connections", row["request"]["connectionId"])
                    add("discoveries", row["request"].get("discoveryId"))
                if kind == "correctionPreviews":
                    add("editions", row["request"]["editionId"])
            records = {kind: list(values.values()) for kind, values in kept.items()}
            sources = list(kept_sources.values())
            plans, builds, comparisons = [], [], []
        return {"schema": WORKSPACE_PACKET, "workspaceId": self.workspace_id, "sources": sources,
            "plans": plans, "builds": builds, "comparisons": comparisons, "records": records,
            "implementation": {"workspaceSchema": self.version, "sourceSchema": source.SOURCE_SCHEMA,
                               "mappingSchema": source.PLAN_SCHEMA}}

    def _registry_files(self, registry):
        files = {}
        for row in registry["records"]["assessments"]:
            files[row["cellsFile"]["sha256"]] = row["cellsFile"]
        for row in registry["records"]["editionComparisons"] + registry["records"]["correctionPreviews"]:
            files[row["changesFile"]["sha256"]] = row["changesFile"]
        for row in registry["records"]["artifacts"]:
            files[row["file"]["sha256"]] = row["file"]
        for row in registry["records"]["handoffs"]:
            for descriptor in row["files"].values():
                old = files.get(descriptor["sha256"])
                if old and old["bytes"] != descriptor["bytes"]:
                    raise InputError("One retained content file has conflicting byte counts")
                files[descriptor["sha256"]] = descriptor
        return files

    def _members(self, registry):
        members = {"registry.json": source.jbytes(registry)}
        if len(members["registry.json"]) > MAX_REGISTRY:
            raise InputError("The complete editable registry exceeds 64 MiB")
        for row in registry["sources"]:
            members["sources/" + row["id"] + ".eltss"] = self.source_path(row["id"])
        for row in registry["builds"]:
            for name in ["data.csv", "dataset.json", "review.json"]:
                members["builds/" + row["id"] + "/" + name] = self._build_path(row["id"], name)
        for row in registry["comparisons"]:
            members["comparisons/" + row["id"] + "/changes.jsonl"] = self.comparison_file(row["id"])
        for ident, descriptor in self._registry_files(registry).items():
            members["files/eltss/files/" + ident + ".bin"] = self._file_path(descriptor)
        custody = []
        for row in registry["records"]["operations"]:
            custody.append(self.acquisition._directory(row["operationId"]))
        for row in registry["records"]["discoveries"]:
            custody.append(self.acquisition.observations / row["observation"]["directory"])
        for directory in custody:
            if directory.is_symlink() or not directory.is_dir():
                raise InputError("Original acquisition custody directory is missing")
            for path in sorted(directory.rglob("*")):
                if path.is_symlink():
                    raise InputError("Original acquisition custody contains an unsafe link")
                if path.is_dir():
                    continue
                original_workspace.regular(path, MAX_WORKSPACE)
                members["files/" + path.relative_to(self.root).as_posix()] = path
        return members

    def _write_packet(self, output, registry, members, *, schema, handoff_id=None):
        path = Path(output).expanduser().absolute()
        if path.exists():
            raise ConflictError("Choose a new complete receiving file")
        entries, total = {}, 0
        for name, value in members.items():
            member(name)
            if isinstance(value, bytes):
                size, digest = len(value), source.sha(value)
            else:
                size = original_workspace.regular(Path(value), MAX_WORKSPACE).st_size
                digest = original_workspace.file_digest(Path(value), MAX_WORKSPACE)
            total += size
            if total > MAX_WORKSPACE:
                raise InputError("Complete original receiving files exceed the 512 MiB packet budget")
            entries[name] = {"bytes": size, "sha256": digest}
        manifest = {"schema": schema, "workspaceId": registry["workspaceId"], "files": entries,
            "registrySha256": entries["registry.json"]["sha256"], "totalBytes": total, "fileCount": len(entries)}
        if handoff_id:
            manifest["handoffId"] = handoff_id
        write_zip(path, {**members, "manifest.json": source.jbytes(manifest)})
        if path.stat().st_size > MAX_WORKSPACE:
            path.unlink()
            raise InputError("Complete encoded receiving ZIP exceeds 512 MiB")
        return {"file": str(path), "bytes": path.stat().st_size,
            "sha256": original_workspace.file_digest(path, MAX_WORKSPACE), "workspaceId": registry["workspaceId"],
            "fileCount": len(entries), "originalBytes": total, **({"handoffId": handoff_id} if handoff_id else {})}

    def export_handoff(self, ident, output):
        with self.mutex:
            handoff = self.handoff(ident)
            registry = self._portable_registry(ident)
            members = self._members(registry)
            for name, descriptor in handoff["files"].items():
                members[member(name)] = self._file_path(descriptor)
            members["handoff.json"] = source.jbytes(handoff)
            return self._write_packet(output, registry, members, schema=HANDOFF_PACKET, handoff_id=ident)

    def export_workspace(self, output):
        with self.mutex:
            registry = self._portable_registry()
            return self._write_packet(output, registry, self._members(registry), schema=WORKSPACE_PACKET)

    def _validate_registry(self, value):
        from eltss_workspace import RECORD_KINDS, record_digest
        source.exact(value, {"schema", "workspaceId", "sources", "plans", "builds", "comparisons", "records", "implementation"}, "Editable care-plan registry")
        identity = value.get("workspaceId")
        try:
            canonical = str(uuid.UUID(identity)) if isinstance(identity, str) else None
        except (ValueError, AttributeError, TypeError):
            canonical = None
        if value.get("schema") != WORKSPACE_PACKET or canonical != identity or not canonical:
            raise InputError("Editable receiving needs its original canonical workspace identity")
        if value.get("implementation") != {"workspaceSchema": self.version, "sourceSchema": source.SOURCE_SCHEMA, "mappingSchema": source.PLAN_SCHEMA}:
            raise InputError("Receiving source implementation differs from this native workspace")
        for kind in ["sources", "plans", "builds", "comparisons"]:
            rows = value.get(kind)
            if not isinstance(rows, list) or len(rows) > 10000 or any(not isinstance(row, dict) for row in rows):
                raise InputError("Original registry requires complete object rows for " + kind)
            if len({source.identity(row.get("id")) for row in rows}) != len(rows):
                raise InputError("Original registry has duplicate or excessive " + kind)
            for row in rows:
                source.identity(row.get("id"))
        records = value.get("records")
        if not isinstance(records, dict) or set(records) != RECORD_KINDS - {"receives"}:
            raise InputError("Complete receiving registry must declare every native collection")
        if sum(len(rows) for rows in records.values() if isinstance(rows, list)) > 100000:
            raise InputError("Original receiving registry exceeds 100,000 saved records")
        for kind, rows in records.items():
            if not isinstance(rows, list):
                raise InputError("Original retained collections must be arrays")
            identifiers = []
            for row in rows:
                if not isinstance(row, dict):
                    raise InputError("Original retained record must be an object")
                ident = fhir.operation_id(row.get("operationId")) if kind == "operations" else source.identity(row.get("id"))
                if kind != "operations" and record_digest(kind, row) != ident:
                    raise InputError("Original retained record differs from its complete content ID")
                identifiers.append(ident)
            if len(set(identifiers)) != len(identifiers):
                raise InputError("Original receiving repeats a saved content identity")
        return value

    def _read_packet(self, path, temp, schema):
        with zipfile.ZipFile(path) as archive:
            infos = archive.infolist()
            if not 2 <= len(infos) <= 65536 or len({row.filename for row in infos}) != len(infos):
                raise InputError("Receiving ZIP has duplicate or excessive members")
            sizes, total = {}, 0
            for info in infos:
                member(info.filename)
                mode = info.external_attr >> 16
                if info.is_dir() or info.flag_bits & 1 or stat.S_ISLNK(mode) or info.compress_type not in {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED}:
                    raise InputError("Unsupported receiving ZIP member")
                total += info.file_size
                if info.file_size > MAX_WORKSPACE or total > MAX_WORKSPACE + MAX_REGISTRY:
                    raise InputError("Expanded receiving ZIP exceeds its complete original-byte budget")
                sizes[info.filename] = info.file_size
            if sizes.get("manifest.json", MAX_REGISTRY + 1) > MAX_REGISTRY or sizes.get("registry.json", MAX_REGISTRY + 1) > MAX_REGISTRY:
                raise InputError("Complete receiving requires its bounded manifest and registry")
            manifest = source.json_value(archive.read("manifest.json"))
            allowed = {"schema", "workspaceId", "files", "registrySha256", "totalBytes", "fileCount"}
            if schema == HANDOFF_PACKET:
                allowed.add("handoffId")
            source.exact(manifest, allowed, "Original receiving manifest")
            if manifest.get("schema") != schema or not isinstance(manifest.get("files"), dict) or set(manifest["files"]) != set(sizes) - {"manifest.json"}:
                raise InputError("Receiving member set differs from its original manifest")
            if manifest.get("fileCount") != len(manifest["files"]) or manifest.get("totalBytes") != sum(sizes[name] for name in manifest["files"]):
                raise InputError("Complete receiving byte/count declaration differs")
            staged = {}
            for name, descriptor in manifest["files"].items():
                source.exact(descriptor, {"bytes", "sha256"}, "Complete receiving member identity")
                if descriptor.get("bytes") != sizes[name]:
                    raise InputError("Original receiving member length differs")
                source.identity(descriptor.get("sha256"))
                target = Path(temp) / ("member-" + source.sha(name.encode()))
                count, checksum = 0, hashlib.sha256()
                with archive.open(name) as inp, os.fdopen(os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as output:
                    while block := inp.read(65536):
                        count += len(block)
                        if count > descriptor["bytes"]:
                            raise InputError("Receiving member exceeds its declared complete length")
                        checksum.update(block)
                        output.write(block)
                    output.flush()
                    os.fsync(output.fileno())
                if count != descriptor["bytes"] or checksum.hexdigest() != descriptor["sha256"]:
                    raise InputError("Original receiving member failed exact byte/hash verification")
                staged[name] = target
            if manifest["registrySha256"] != manifest["files"]["registry.json"]["sha256"]:
                raise InputError("Original registry hash differs")
            registry = self._validate_registry(source.json_value(safe_read(staged["registry.json"], MAX_REGISTRY)))
            if manifest["workspaceId"] != registry["workspaceId"]:
                raise InputError("Registry and manifest identify different original workspaces")
            return manifest, registry, staged

    def _receive(self, packet_path, *, handoff=False):
        path, _, archive_id = original_file(packet_path)
        schema = HANDOFF_PACKET if handoff else WORKSPACE_PACKET
        with self.mutex:
            previous = self._get("receives", archive_id, required=False)
            for active in self._list("receives"):
                if active["state"] != "complete" and active["id"] != archive_id:
                    raise ConflictError("Resume the identical retained packet before starting another receiving operation")
            if previous and previous["state"] == "complete":
                return {"workspaceId": self.workspace_id, "archiveSha256": archive_id, "reconstructed": True,
                    "recovered": True, "handoffId": previous.get("handoffId"), "state": self.state()}
            if not previous and not handoff:
                state = self.state()
                from eltss_workspace import RECORD_KINDS
                if any(state[key] for key in ["sources", "plans", "builds", "comparisons"]) or any(
                    self._list(kind) for kind in RECORD_KINDS - {"receives"}):
                    raise ConflictError("Receive a complete editable workspace into a fresh empty workspace")
            with self.scratch() as temp:
                manifest, registry, staged = self._read_packet(path, temp, schema)
                required = {"registry.json"}
                for row in registry["sources"]:
                    name = "sources/" + row["id"] + ".eltss"
                    required.add(name)
                    if name not in staged or manifest["files"][name]["sha256"] != row["id"] or manifest["files"][name]["bytes"] != row["bytes"]:
                        raise InputError("Complete original source is missing or changed")
                for row in registry["builds"]:
                    for leaf in ["data.csv", "dataset.json", "review.json"]:
                        name = "builds/" + row["id"] + "/" + leaf
                        required.add(name)
                        if name not in staged or leaf != "review.json" and manifest["files"][name] != row["files"][leaf]:
                            raise InputError("Complete original native dataset member is missing or changed")
                        if leaf == "review.json" and source.json_value(safe_read(staged[name])) != row:
                            raise InputError("Native build review differs from its retained registry")
                for row in registry["comparisons"]:
                    name = "comparisons/" + row["id"] + "/changes.jsonl"
                    required.add(name)
                    if name not in staged or manifest["files"][name]["sha256"] != row["changesSha256"]:
                        raise InputError("Complete original dataset comparison is missing or changed")
                for ident, descriptor in self._registry_files(registry).items():
                    name = "files/eltss/files/" + ident + ".bin"
                    required.add(name)
                    if name not in staged or manifest["files"][name] != {"sha256": ident, "bytes": descriptor["bytes"]}:
                        raise InputError("Complete native domain file is missing or changed")
                allowed_custody = set()
                for row in registry["records"]["operations"]:
                    allowed_custody.add("files/eltss/operations/" + fhir.operation_id(row["operationId"]) + "/")
                for row in registry["records"]["discoveries"]:
                    directory = row["observation"]["directory"]
                    if str(uuid.UUID(directory)) != directory:
                        raise InputError("Original discovery custody requires its exact canonical observation UUID")
                    allowed_custody.add("files/eltss/observations/" + directory + "/")
                human = set()
                if handoff:
                    ident = source.identity(manifest.get("handoffId"))
                    selected = next((row for row in registry["records"]["handoffs"] if row["id"] == ident), None)
                    if not selected or "handoff.json" not in staged or source.json_value(safe_read(staged["handoff.json"], MAX_REGISTRY)) != selected:
                        raise InputError("Receiving selection does not match the original handoff record")
                    human.add("handoff.json")
                    for name, descriptor in selected["files"].items():
                        member(name)
                        human.add(name)
                        if name not in staged or manifest["files"][name] != {"sha256": descriptor["sha256"], "bytes": descriptor["bytes"]}:
                            raise InputError("Complete original human receiving member differs")
                for name in set(staged) - required - human:
                    if not any(name.startswith(prefix) for prefix in allowed_custody):
                        raise InputError("Receiving ZIP contains an undeclared native or private file")
                if not required <= set(staged):
                    raise InputError("Receiving ZIP omitted original native files")
                if previous is None:
                    previous = {"id": archive_id, "archiveSha256": archive_id, "state": "receiving",
                        "kind": "handoff" if handoff else "workspace", "createdAt": now(), "updatedAt": now(),
                        "workspaceId": self.workspace_id if handoff else registry["workspaceId"],
                        "originalWorkspaceId": registry["workspaceId"], "handoffId": manifest.get("handoffId"),
                        "completed": [], "error": None}
                    self._save("receives", archive_id, previous)
                elif previous["originalWorkspaceId"] != registry["workspaceId"] or previous["kind"] != ("handoff" if handoff else "workspace"):
                    raise ConflictError("Original receiving archive is bound to another workspace or operation kind")
                def checkpoint(step):
                    if step not in previous["completed"]:
                        previous["completed"].append(step)
                    previous["updatedAt"], previous["error"] = now(), None
                    self._save("receives", archive_id, previous, immutable=False)
                try:
                    if not handoff:
                        atomic_json(self.root / "eltss" / "identity.json", {"schema": self.version, "workspaceId": registry["workspaceId"]})
                        self.workspace_id = registry["workspaceId"]
                    for name in sorted(staged):
                        if not name.startswith("files/"):
                            continue
                        destination = self.root / name[len("files/"):]
                        parent = self.root
                        for part in destination.relative_to(self.root).parts[:-1]:
                            parent = private_directory(parent / part)
                        if destination.exists():
                            if original_workspace.file_digest(destination, MAX_WORKSPACE) != manifest["files"][name]["sha256"]:
                                raise ConflictError("Original native custody path already has different bytes")
                        else:
                            pending = destination.with_name("." + destination.name + "." + uuid.uuid4().hex)
                            with staged[name].open("rb") as inp, os.fdopen(os.open(pending, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as out:
                                shutil.copyfileobj(inp, out, 65536)
                                out.flush()
                                os.fsync(out.fileno())
                            os.replace(pending, destination)
                            original_workspace.sync_dir(destination.parent)
                        checkpoint("file:" + name)
                    for row in registry["sources"]:
                        with staged["sources/" + row["id"] + ".eltss"].open("rb") as stream:
                            retained = self.add_source(stream, row["label"], row["name"])
                        if retained["id"] != row["id"] or retained["inventory"] != row["inventory"]:
                            raise InputError("Original source inventory differs after exact reconstruction")
                        if not handoff:
                            with self.db:
                                self.db.execute("UPDATE sources SET created=? WHERE id=?", (row["created"], row["id"]))
                        checkpoint("source:" + row["id"])
                    for row in registry["plans"]:
                        retained = self.save_plan(row["plan"])
                        if retained["id"] != row["id"]:
                            raise InputError("Original mapping changed during reconstruction")
                        with self.db:
                            self.db.execute("UPDATE plans SET created=? WHERE id=?", (row["created"], row["id"]))
                        checkpoint("plan:" + row["id"])
                    for row in registry["builds"]:
                        retained = self.build(row["source"], row["plan"], expected=row)
                        if retained["id"] != row["id"]:
                            raise InputError("Original native dataset changed during reconstruction")
                        checkpoint("build:" + row["id"])
                    for row in registry["comparisons"]:
                        if self.compare(row["before"], row["after"]) != row:
                            raise InputError("Original native comparison changed after complete reconstruction")
                        checkpoint("comparison:" + row["id"])
                    for kind, rows in registry["records"].items():
                        for row in rows:
                            ident = row["operationId"] if kind == "operations" else row["id"]
                            if kind == "operations":
                                native = self.acquisition._directory(ident) / "operation.json"
                                if not native.exists() or source.json_value(safe_read(native, MAX_REGISTRY)) != row:
                                    raise InputError("Received original operation differs from its durable file")
                            self._save(kind, ident, row)
                            checkpoint(kind + ":" + ident)
                    self._verify_received_links(registry)
                    previous["state"], previous["updatedAt"] = "complete", now()
                    self._save("receives", archive_id, previous, immutable=False)
                    return {"workspaceId": self.workspace_id, "archiveSha256": archive_id, "reconstructed": True,
                        "handoffId": manifest.get("handoffId"), "state": self.state()}
                except Exception as error:
                    previous["error"], previous["updatedAt"] = str(error), now()
                    self._save("receives", archive_id, previous, immutable=False)
                    raise

    def _verify_received_links(self, registry):
        records = registry["records"]
        for row in records["requests"]:
            request = row["request"]
            self.connection(request["connectionId"])
            if request.get("discoveryId"):
                self.discovery(request["discoveryId"])
            from eltss_acquisition import request_value
            keys = set(self.catalogue()["schemas"]["request"]["fields"])
            rebuilt = request_value({key: value for key, value in request.items() if key in keys},
                self.connection(request["connectionId"])["connection"],
                self.discovery(request["discoveryId"]) if request.get("discoveryId") else None)
            if rebuilt != request:
                raise InputError("Received acquisition request differs from its exact original selected route")
        for row in records["operations"]:
            request = self.request(row["requestId"])["request"]
            if request["requestSha256"] != row["requestSha256"] or request["connectionId"] != row["connectionId"]:
                raise InputError("Original operation/request binding differs after receiving")
            if row.get("sourceId"):
                self.source(row["sourceId"])
        for row in records["graphs"]:
            with self._graph(row["id"]):
                pass
        for row in records["editions"]:
            graph = self.graph_view(row["graphId"])
            if graph["sourceId"] != row["sourceId"] or any(i not in {c["recordId"] for c in graph["carePlans"]} for i in row["carePlanIds"]):
                raise InputError("Received edition changed its original CarePlan/source graph selection")
            if row.get("predecessorId"):
                self.edition(row["predecessorId"])
        for row in records["reviewSets"]:
            profile = row.get("profileSnapshot") or self.profile(row["profileId"])
            if source.sha(source.jbytes(profile)) != row["sourceProfileSha256"] or len(row["fields"]) != 56:
                raise InputError("Received field review changed its complete original source profile")
            if row.get("predecessorId"):
                self.review_set(row["predecessorId"])
        for row in records["assessments"]:
            edition = self.edition(row["editionId"])
            review = self.review_set(row["reviewSetId"])
            if row["graphId"] != edition["graphId"] or any(i not in edition["carePlanIds"] for i in row["carePlanIds"]):
                raise InputError("Received assessment no longer matches its complete original edition")
            expected, seen = {(cp, field["fieldKey"]) for cp in row["carePlanIds"] for field in review["fields"]}, set()
            with self._file_path(row["cellsFile"]).open("rb") as stream:
                for line in stream:
                    cell = source.json_value(line)
                    key = (cell.get("carePlanId"), cell.get("fieldKey"))
                    if key not in expected or key in seen:
                        raise InputError("Received assessment repeats or changes a selected CarePlan field")
                    seen.add(key)
            if seen != expected:
                raise InputError("Received assessment omitted original selected field cells")
        for row in records["decisions"]:
            for ref in row.get("sourceRefs", []):
                self._source_ref(ref)
            for ident in row.get("editionIds", []):
                self.edition(ident)
            if row.get("supersedesId"):
                self.decision(row["supersedesId"])
        for row in records["handoffs"]:
            assessment = self.assessment(row["assessmentId"])
            if assessment["editionId"] != row["editionId"] or assessment["reviewSetId"] != row["reviewSetId"]:
                raise InputError("Received handoff changed its original complete selection")
            for descriptor in row["files"].values():
                self._file_path(descriptor)
        for row in records["receivings"]:
            if self.handoff(row["handoffId"])["requestSha256"] != row["handoffRequestSha256"]:
                raise InputError("Original receiving result has another frozen handoff")
            if row.get("artifactId"):
                self.artifact_path(row["artifactId"])
            if row.get("correctionOf"):
                self.receiving(row["correctionOf"])

    def import_workspace(self, path):
        return self._receive(path, handoff=False)

    def import_handoff(self, path):
        return self._receive(path, handoff=True)
