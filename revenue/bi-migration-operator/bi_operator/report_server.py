"""Native on-premises Report Server files, durable execution jobs and receiving work."""
from __future__ import annotations
import base64
import io
import json
from pathlib import Path, PurePosixPath
import re
import stat
from urllib.parse import urlsplit
import zipfile
from . import paginated
from .compare import read_csv
from .store import Conflict, digest, encoded, identifier, now

ROOT = Path(__file__).resolve().parents[1]
LIMIT = 64 * 1024 * 1024
KINDS = {"Report": ".rdl", "PowerBIReport": ".pbix"}


def file_input(request):
    data = base64.b64decode(request["base64"], validate=True)
    filename = basename(Path(str(request.get("filename", ""))).name)
    if not filename or len(data) > LIMIT:
        raise ValueError("Select a native file up to 64 MiB, or register its native manifest for external transfer.")
    return data, filename


def basename(value):
    value = str(value)
    if not value or value != PurePosixPath(value).name or any(ord(c) < 32 for c in value) or \
            any(c in value for c in ('<', '>', ':', '"', '/', chr(92), '|', '?', '*')) or \
            value.endswith((".", " ")) or re.match(r"(?i)^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)", value):
        raise ValueError("Use a portable Windows native filename without a directory.")
    return value


def parameters(value):
    value = value or {}
    if not isinstance(value, dict):
        raise ValueError("Report parameters must be a JSON object.")
    for key, item in value.items():
        if not isinstance(key, str) or not key or any(ord(c) < 32 for c in key):
            raise ValueError("Use a nonempty parameter name.")
        if isinstance(item, dict) or isinstance(item, list) and any(isinstance(x, (dict, list)) for x in item):
            raise ValueError("Parameter values may be scalars or lists of scalars.")
    return value


def report_path(value):
    if not isinstance(value, str) or not value.startswith("/") or value.endswith("/") or \
            any(ord(c) < 32 for c in value) or any(x in {"", ".", ".."} for x in value.split("/")[1:]):
        raise ValueError("Enter the exact Report Server catalog path, beginning with one slash.")
    return value


def url(value, suffix=None):
    parsed = urlsplit(str(value))
    if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("Use the original HTTP(S) server address without credentials, query or fragment.")
    result = str(value).rstrip("/")
    if suffix and not parsed.path.rstrip("/").lower().endswith(suffix.lower()):
        raise ValueError("The Report Server API address must end in " + suffix + ".")
    return result


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n").encode()


def zip_bytes(files):
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as package:
        for name, data in sorted(files.items()):
            info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100600 << 16
            package.writestr(info, data)
    return out.getvalue()


def read_result_archive(data):
    files = {}
    with zipfile.ZipFile(io.BytesIO(data)) as package:
        members = package.infolist()
        if len(members) > 2000 or sum(i.file_size for i in members) > 512 * 1024 * 1024:
            raise ValueError("The receiving package exceeds the local operator size limit.")
        for item in members:
            path = PurePosixPath(item.filename)
            if item.is_dir():
                continue
            if path.is_absolute() or ".." in path.parts or "\\" in item.filename or \
                    item.filename in files or item.file_size > LIMIT or stat.S_ISLNK(item.external_attr >> 16):
                raise ValueError("The receiving package contains an invalid or oversized file.")
            files[item.filename] = package.read(item)
    if "result.json" not in files:
        raise ValueError("Select the native runner's complete result ZIP with result.json at its root.")
    result = json.loads(files["result.json"])
    if result.get("schema") != "commons-bi-report-server-result/1":
        raise ValueError("The native result format is not recognized.")
    return result, files


class ReportServer:
    def __init__(self, service):
        self.service, self.store = service, service.store

    def import_native(self, request):
        data, filename = file_input(request)
        suffix = Path(filename).suffix.lower()
        kind = next((k for k, v in KINDS.items() if v == suffix), None)
        if kind is None:
            raise ValueError("Import an original .rdl or Report Server-optimized .pbix file.")
        if kind == "Report":
            validation = paginated.inspect(data)
        else:
            with zipfile.ZipFile(io.BytesIO(data)) as package:
                names = package.namelist()
                if len(names) != len(set(names)) or not any(n.startswith("Report/") for n in names):
                    raise ValueError("The PBIX does not contain its original report definition.")
                version = next((i for i in package.infolist() if i.filename == "Version" and i.file_size <= 65536), None)
                validation = {"zip_checked": True, "members": len(names),
                    "version": package.read(version).decode("utf-8-sig", errors="replace") if version else None}
        source = self.store.get("source", request["source_id"]) if request.get("source_id") else None
        native = self.store.blob(data, filename, "application/xml" if kind == "Report" else "application/octet-stream")
        return self.service.write("server_report", {"label": str(request.get("label") or filename)[:300],
            "native": {**native, "file": filename, "sha256": native["digest"], "kind": kind, "embedded": True},
            "source": self.service.reference(source) if source else None, "validation": validation,
            "desktop_build": str(request.get("desktop_build", ""))[:200],
            "report_server_build": str(request.get("report_server_build", ""))[:200],
            "owner": str(request.get("owner", ""))[:180], "scope": str(request.get("scope", ""))[:10000],
            "state": "retained_native_file", "imported": now()})

    def register_native(self, request):
        data, filename = file_input(request)
        manifest = json.loads(data)
        if manifest.get("schema") != "commons-bi-report-server-native/1":
            raise ValueError("Use the native Windows runner's file registration manifest.")
        native = manifest.get("native", manifest)
        name = basename(native.get("file", ""))
        kind, sha, size = native.get("kind"), native.get("sha256"), native.get("bytes")
        if kind not in KINDS or not name.lower().endswith(KINDS[kind]) or not re.fullmatch(r"[a-f0-9]{64}", sha or "") \
                or type(size) is not int or size <= 0:
            raise ValueError("The native registration must retain the original file kind, size and SHA-256.")
        original = self.store.blob(data, filename, "application/json")
        return self.service.write("server_report", {"label": str(request.get("label") or name)[:300],
            "native": {"file": name, "name": name, "sha256": sha, "bytes": size, "kind": kind, "embedded": False},
            "registration": original, "desktop_build": str(manifest.get("desktop_build", ""))[:200],
            "report_server_build": str(manifest.get("report_server_build", ""))[:200],
            "source": None, "owner": str(request.get("owner", ""))[:180], "scope": str(request.get("scope", ""))[:10000],
            "validation": {"native_file_registration": True}, "state": "registered_external_native_file", "imported": now()})

    def build_family(self, request):
        plan = self.store.get("plan", request["plan_id"], request.get("plan_revision"))
        project, bindings = plan["payload"]["project"], plan["payload"]["bindings"]
        files, reports, filenames = {}, [], set()
        column_selection = request.get("columns", {})
        if not isinstance(column_selection, dict):
            raise ValueError("Column selections must map each table to its exact source/model fields.")
        for table in project["tables"]:
            data, review = paginated.build_table(table, bindings.get(table["name"], {}), self.store,
                columns=column_selection.get(table["name"]), title=project["name"] + " — " + table["name"],
                description=plan["payload"].get("scope", ""))
            base_name = paginated.safe_name(table["name"], "Report")
            if re.fullmatch(r"(?i)(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])", base_name):
                base_name = "Report_" + base_name
            filename, suffix = base_name + ".rdl", 2
            while filename.casefold() in filenames:
                filename = base_name + "_" + str(suffix) + ".rdl"
                suffix += 1
            filenames.add(filename.casefold())
            native = self.store.blob(data, filename, "application/xml")
            entity_id = self.service.operation_id[:60] + "-rdl-" + digest(table["name"].encode())[:16]
            try:
                record = self.store.get("server_report", entity_id)
                if record["payload"]["native"]["sha256"] != digest(data):
                    raise Conflict("The original paginated family input changed.")
            except KeyError:
                record = self.store.put("server_report", {"label": table["name"] + " — native paginated report",
                    "native": {**native, "file": filename, "sha256": native["digest"], "kind": "Report", "embedded": True},
                    "plan": self.service.reference(plan), "source": plan["payload"]["source"], "validation": review["validation"],
                    "report_review": review, "owner": plan["payload"].get("owner", ""),
                    "desktop_build": "RDL 2016 / Report Builder", "report_server_build": "",
                    "state": "generated_native_paginated", "scope": review["scope"], "imported": now()},
                    entity_id, 0, self.service.actor)
            reports.append(self.service.reference(record))
            files["reports/" + filename] = data
            files["reports/" + filename + ".json"] = json_bytes(review)
        files["original-plan.json"] = json_bytes(plan)
        source_ref = plan["payload"]["source"]
        source = self.store.get("source", source_ref["id"], source_ref["revision"])
        source_file = source["payload"]["original"]
        extension = Path(source_file["name"]).suffix.lower()
        files["source/original-export" + (extension if extension in {".xml", ".json"} else ".bin")] = self.store.bytes(source_file["digest"])
        files["source/original-source.json"] = json_bytes(source)
        files["OPEN_FIRST.md"] = (
            "# Native paginated report family\n\nOpen each reports/*.rdl in Microsoft Report Builder, or prepare a Report Server job in the operator. "
            "CSV bindings use Microsoft's embedded XML provider and retain every selected row and exact source text, including explicit null tokens. "
            "SQL bindings keep the reviewed physical query and Windows integrated security. "
            "These are tabular model projections. The original Cognos layout, measures, interactive behavior and per-agency access require their separately reviewed implementation. "
            "A report definition schema check is recorded per file; actual native rendering and output comparison are recorded by the receiving workflow.\n").encode()
        package = self.store.blob(zip_bytes(files), project["name"] + "-ReportServer-RDL.zip", "application/zip")
        return self.service.write("server_bundle", {"label": project["name"] + " paginated family",
            "plan": self.service.reference(plan), "reports": reports, "package": package, "files": len(files), "built": now()})

    def prepare_job(self, request):
        report = self.store.get("server_report", request["report_id"], request.get("report_revision"))
        native = report["payload"]["native"]
        target = request.get("target", {})
        target = {"api_base": url(target.get("api_base", ""), "/api/v2.0"),
            "report_server_url": url(target["report_server_url"]) if target.get("report_server_url") else "",
            "report_path": report_path(target.get("report_path", ""))}
        exports = request.get("paginated_exports", [])
        if not isinstance(exports, list) or len(exports) > 100:
            raise ValueError("Choose at most 100 explicit paginated exports for a job.")
        review = report["payload"].get("report_review", {})
        if not exports and native["kind"] == "Report" and review.get("null_token") is not None:
            exports = [{"report_path": target["report_path"], "parameters": parameters(request.get("parameters", {})),
                "file": "report.csv", "null_token": review["null_token"]}]
        seen = set()
        for item in exports:
            report_path(item.get("report_path", ""))
            name = basename(item.get("file", ""))
            if not name.lower().endswith(".csv") or name in seen:
                raise ValueError("Each paginated export needs one distinct .csv filename.")
            seen.add(name)
            parameters(item.get("parameters", {}))
        job = {"schema": "commons-bi-report-server-job/1", "job_id": self.service.operation_id,
            "label": str(request.get("label") or report["payload"]["label"])[:300],
            "receiving_owner": str(request.get("owner", report["payload"].get("owner", "")))[:180],
            "native": {k: native[k] for k in ("file", "sha256", "bytes", "kind", "embedded")},
            "target": target, "parameters": parameters(request.get("parameters", {})), "paginated_exports": exports,
            "desktop_build": str(request.get("desktop_build") or report["payload"].get("desktop_build", ""))[:200],
            "report_server_build": str(request.get("report_server_build") or report["payload"].get("report_server_build", ""))[:200],
            "scope": str(request.get("scope", ""))[:10000], "source_report": self.service.reference(report), "created": now()}
        raw = json_bytes(job)
        files = {"job.json": raw}
        for name in ("RUN_REPORT_SERVER.ps1", "GUIDE.md"):
            path = ROOT / "tools/report-server" / name
            if not path.is_file():
                raise ValueError("Install the complete operator release including its native Report Server runner.")
            files[name] = path.read_bytes()
        if native["embedded"]:
            files[native["file"]] = self.store.bytes(native["digest"])
        files["OPEN_FIRST.txt"] = (
            "Open GUIDE.md. Use the current Windows account. "
            "Inspect checks the server and catalog; Capture retains the original native content before Publish. Reconcile reads the original target after an interrupted response. "
            "The same work directory retains original native content, target identities and operation state for rollback. "
            + ("The exact native report is included.\n" if native["embedded"] else
               "This job registers an external original report; pass -NativeFile with that exact file on the receiving machine. Its size and SHA-256 are checked before execution.\n")
        ).encode()
        package = self.store.blob(zip_bytes(files), "ReportServer-" + job["job_id"] + ".zip", "application/zip")
        return self.service.write("server_job", {"label": job["label"], "job": job, "job_sha256": digest(raw),
            "report": self.service.reference(report), "package": package, "files": len(files), "state": "prepared",
            "owner": str(request.get("owner", report["payload"].get("owner", "")))[:180], "created": now()})

    def import_result(self, request):
        data, filename = file_input(request)
        result, files = read_result_archive(data)
        job = self.store.get("server_job", identifier(result["job_id"]))
        job_hash = job["payload"]["job_sha256"]
        original_job = files.get("job.json")
        if (result.get("job_sha256") != job_hash or original_job is None
                or digest(original_job) != job_hash):
            raise Conflict("The native result must retain the exact original job.json.")
        if not isinstance(result.get("files"), list) or not isinstance(result.get("events", []), list):
            raise ValueError("The native result must include its original file manifest and event history.")

        # Fully validate the package and all existing capture identities before
        # any blob or record is saved. Store.put commits individual records.
        manifest_names, embedded_names, capture_ids = set(), set(), set()
        prepared = []
        for item in result["files"]:
            if not isinstance(item, dict):
                raise ValueError("Every native result file needs a manifest object.")
            name = item.get("path")
            if (
                not isinstance(name, str) or not name or name in manifest_names
                or name == "result.json" or PurePosixPath(name).is_absolute()
                or ".." in PurePosixPath(name).parts or chr(92) in name
                or PurePosixPath(name).as_posix() != name
                or any(ord(c) < 32 for c in name)
            ):
                raise ValueError("The native result repeats or omits a portable relative file path.")
            manifest_names.add(name)
            size, checksum = item.get("bytes"), item.get("sha256")
            if (type(size) is not int or size < 0 or not isinstance(checksum, str)
                    or not re.fullmatch(r"[a-f0-9]{64}", checksum)):
                raise ValueError("Every original file needs its complete size and SHA-256: " + name)
            embedded = item.get("embedded", True)
            if type(embedded) is not bool:
                raise ValueError("The embedded flag must be a Boolean: " + name)
            entry = {"item": item, "name": name, "embedded": embedded}
            if not embedded:
                if name in files:
                    raise ValueError("An external file also occurs inside the native result: " + name)
                prepared.append(entry)
                continue
            embedded_names.add(name)
            raw = files.get(name)
            if raw is None or len(raw) != size or digest(raw) != checksum:
                raise ValueError("A native result file differs from its manifest: " + name)
            entry["raw"] = raw
            if item.get("role") == "capture" and name.lower().endswith(".csv"):
                headers, rows = read_csv(raw)
                row_count = len(rows)
                del rows
                entity_id = self.service.operation_id[:60] + "-capture-" + digest(name.encode())[:12]
                if entity_id in capture_ids:
                    raise Conflict("Two native captures resolve to the same retained identity.")
                capture_ids.add(entity_id)
                try:
                    record = self.store.get("dataset", entity_id)
                except KeyError:
                    record = None
                if record is not None and record["payload"]["file"]["digest"] != checksum:
                    raise Conflict("The original native capture changed.")
                entry.update({"capture_id": entity_id, "headers": headers,
                    "row_count": row_count, "existing_record": record})
            prepared.append(entry)

        if "job.json" not in embedded_names:
            raise ValueError("The original job.json must be retained in the embedded file manifest.")
        if set(files) - {"result.json"} != embedded_names:
            raise ValueError("Every embedded native result file must occur in its complete manifest.")

        attachments, captures = [], []
        for entry in prepared:
            item, name = entry["item"], entry["name"]
            if not entry["embedded"]:
                attachments.append({**item, "retained_externally": True})
                continue
            blob = self.store.blob(entry["raw"], Path(name).name,
                "text/csv" if name.lower().endswith(".csv") else "application/octet-stream")
            attachments.append({**item, "object": blob})
            if "capture_id" in entry:
                record = entry["existing_record"]
                if record is None:
                    payload = {"label": job["payload"]["label"] + " · native " + Path(name).name, "file": blob,
                        "columns": entry["headers"], "rows": entry["row_count"], "null_token": item.get("null_token"),
                        "source_url": job["payload"]["job"]["target"].get("report_server_url", ""),
                        "scope": str(item.get("scope", job["payload"]["job"].get("scope", ""))),
                        "parameters": item.get("parameters", {}), "source_report": item.get("report_path"),
                        "server_job": self.service.reference(job), "native_result_state": result.get("state"),
                        "capture_kind": item.get("capture_kind"), "native_definition": item.get("native_definition"),
                        "imported": now(), "description": ("Original paginated CSV returned by Report Server." if item.get("capture_kind") == "paginated_csv"
                            else "Original CSV retained with the native receiving operation; its capture kind remains attached.")}
                    record = self.store.put("dataset", payload, entry["capture_id"], 0, self.service.actor)
                captures.append(self.service.reference(record))
        package = self.store.blob(data, filename, "application/zip")
        return self.service.write("server_result", {"label": job["payload"]["label"] + " · " + str(result.get("state", "returned")),
            "job": self.service.reference(job), "native_result": result, "state": result.get("state", "returned"),
            "attachments": attachments, "captures": captures, "package": package, "received": now()})
    def handoff(self, request):
        job = self.store.get("server_job", request["job_id"])
        report = self.store.get("server_report", job["payload"]["report"]["id"], job["payload"]["report"]["revision"])
        files = {"native/ReportServer-job.zip": self.store.bytes(job["payload"]["package"]["digest"]),
            "records/job.json": json_bytes(job), "records/native-report.json": json_bytes(report)}
        source_ref = report["payload"].get("source")
        plan_ref = report["payload"].get("plan")
        if plan_ref:
            plan = self.store.get("plan", plan_ref["id"], plan_ref["revision"])
            files["records/reviewed-plan.json"] = json_bytes(plan)
            inputs = []
            for index, (table, binding) in enumerate(sorted(plan["payload"]["bindings"].items()), 1):
                if binding.get("kind") == "csv":
                    name = "inputs/" + str(index).zfill(3) + "-" + paginated.safe_name(table, "Table") + ".csv"
                    files[name] = self.store.bytes(binding["digest"])
                    inputs.append({"table": table, "file": name, "sha256": binding["digest"], "null_token": binding.get("null_token")})
            files["inputs/index.json"] = json_bytes(inputs)
            source_ref = source_ref or plan["payload"].get("source")
        if source_ref:
            source = self.store.get("source", source_ref["id"], source_ref["revision"])
            original = source["payload"]["original"]
            extension = Path(original["name"]).suffix.lower()
            files["source/original-export" + (extension if extension in {".xml", ".json"} else ".bin")] = self.store.bytes(original["digest"])
            files["source/original-source.json"] = json_bytes(source)
        if report["payload"].get("registration"):
            files["native/original-registration.json"] = self.store.bytes(report["payload"]["registration"]["digest"])
        results = []
        for entity_id in request.get("result_ids", []):
            result = self.store.get("server_result", entity_id)
            if result["payload"]["job"]["id"] != job["id"]:
                raise ValueError("Select native results from this original Report Server job.")
            files["native/results/" + result["id"] + ".zip"] = self.store.bytes(result["payload"]["package"]["digest"])
            files["records/results/" + result["id"] + ".json"] = json_bytes(result)
            results.append(self.service.reference(result))
        comparisons = []
        for entity_id in request.get("comparison_ids", []):
            comparison = self.store.get("comparison", entity_id)
            files["comparisons/" + entity_id + ".json"] = json_bytes(comparison)
            for side in ("left", "right"):
                value = comparison["payload"][side + "_file"]
                files["comparisons/" + entity_id + "-" + side + ".csv"] = self.store.bytes(value["digest"])
            comparisons.append(self.service.reference(comparison))
        cases = [self.store.get("support", item) for item in request.get("support_ids", [])]
        files["records/support.json"] = json_bytes(cases)
        files["OPEN_FIRST.md"] = ("# Report Server operating handoff\n\nThe native job contains the exact report or its external native registration, "
            "the original target, native runner and operating guide. Returned result packages contain native state, original recovery content and captured outputs. "
            "Complete comparison outputs and support records remain attached. Keep the same native Windows work directory for original-target recovery.\n\n" +
            str(request.get("notes", ""))[:50000]).encode()
        files["MANIFEST.json"] = json_bytes({"schema": "commons-bi-report-server-handoff/1", "job": self.service.reference(job),
            "results": results, "files": [{"path": name, "bytes": len(data), "sha256": digest(data)} for name, data in sorted(files.items())]})
        package = self.store.blob(zip_bytes(files), "ReportServer-" + job["id"] + "-Handoff.zip", "application/zip")
        return self.service.write("delivery", {"label": job["payload"]["label"] + " Report Server handoff",
            "server_job": self.service.reference(job), "results": results, "comparisons": comparisons,
            "support": [self.service.reference(case) for case in cases], "files": len(files), "package": package,
            "notes": str(request.get("notes", ""))[:50000]})
