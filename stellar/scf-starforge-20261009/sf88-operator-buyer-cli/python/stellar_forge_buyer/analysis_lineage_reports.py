"""Printable and portable delivery of an original reviewed lineage publication."""
from __future__ import annotations

import base64
from copy import deepcopy
import html
import io
import json
from pathlib import Path
import stat
import zipfile

from .analysis_lineage_projection import SCHEMA as PROJECTION_SCHEMA, checksum, encode, need
from .storage import digest, parse, read
from .errors import StateError

PORTABLE_SCHEMA = "stellar-forge.analysis-lineage-handover.v1"
_MAX_ARCHIVE = 128 * 1024 * 1024
_MEMBERS = {"events.json", "plan.json", "native-bindings.json", "receipts.json", "report.html"}
_PLAN_KEYS = ("schema", "projection_schema", "id", "workspace_id", "created_at", "request",
              "summary", "snapshot_sha256", "events_sha256", "events_bytes",
              "operation_id", "source_name", "source_url", "target")


def esc(value):
    return html.escape("" if value is None else str(value), quote=True)


def _table(headers, rows):
    return "<div class='table-wrap'><table><thead><tr>" + "".join("<th>" + esc(h) + "</th>" for h in headers) + \
        "</tr></thead><tbody>" + "".join("<tr>" + "".join("<td>" + esc(c) + "</td>" for c in row) + "</tr>" for row in rows) + "</tbody></table></div>"


def render(plan, observations):
    publication = plan.get("publication")
    accepted = (publication or {}).get("accepted")
    receipt = accepted["native"]["receipt"] if accepted else None
    if accepted:
        outcome = "Accepted by the original collector"
    elif publication:
        outcome = "Publication " + str(publication.get("status", "pending")).lower()
    else:
        outcome = "Reviewed edition saved; publication has not started"
    native_status = "Original event bytes remain available. Resume the retained publication job when an acknowledgement is missing."
    if receipt:
        native_status = ("Collector revision " + str(receipt["revision"]) + "; " + str(receipt["added"]) +
                         " new event records; " + str(receipt["retained"]) + " events in this retained source. " +
                         ("The original request was replayed." if receipt["replayed"] else "The original request was accepted."))
    summary = plan["summary"]
    job_rows = []
    edges = []
    for job in plan["jobs"]:
        detail = job["detail"]
        scope = ("Saved preview: " + str(detail.get("preview_rows", 0)) + " rows; " +
                 ("truncated" if detail.get("preview_truncated") else "complete at the configured preview limit")) if job["kind"] == "query" else (
                 "Complete export from original reviewed SQL" if job["kind"] == "query-export" else "Original completed " + job["kind"])
        job_rows.append([job["id"], job["kind"], job["created_at"], job["finished_at"], scope])
        for direction in ("inputs", "outputs"):
            for dataset in job[direction]:
                namespace, name = dataset.split("\n", 1)
                edges.append([job["id"], direction[:-1], namespace, name])
    datasets = [[item["namespace"], item["name"],
                 item["facets"]["stellarForge_analysis"].get("kind"),
                 item["facets"]["stellarForge_analysis"].get("row_count"),
                 item["facets"]["stellarForge_analysis"].get("manifest_sha256") or
                 item["facets"]["stellarForge_analysis"].get("result_sha256") or
                 item["facets"]["stellarForge_analysis"].get("sha256")]
                for item in plan["datasets"]]
    history = [[item["attempt"], item["kind"], item["created_at"],
                item["record"].get("outcome"), item["record"].get("error") or
                (item["record"].get("runtime") or {}).get("error")]
               for item in observations]
    warnings = "".join("<li>" + esc(item) + "</li>" for item in summary["warnings"])
    publication_id = publication["job_id"] if publication else "Not started"
    target = plan["target"]
    return ("<!doctype html><html lang='en'><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>"
        "<title>" + esc(plan["request"]["title"]) + " — Analysis lineage</title><style>"
        ":root{color-scheme:light}*{box-sizing:border-box}body{font:15px/1.55 system-ui,sans-serif;color:#171717;background:#fff;margin:0;padding:32px;max-width:1320px}"
        "h1{font-size:32px;line-height:1.15}h2{margin-top:32px;border-top:1px solid #aaa;padding-top:16px}p,dd,td{overflow-wrap:anywhere}"
        ".eyebrow{font-size:12px;letter-spacing:.08em;text-transform:uppercase}.status{background:#eee;border-left:5px solid #333;padding:16px}"
        "dl{display:grid;grid-template-columns:minmax(150px,1fr) 3fr;gap:6px 20px}dt{font-weight:650}dd{margin:0}.table-wrap{overflow-x:auto}"
        "table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #aaa;padding:8px;text-align:left;vertical-align:top}th{background:#eee}"
        "code{font-size:12px;overflow-wrap:anywhere}footer{margin-top:32px;font-size:12px;color:#555}"
        "@media(max-width:600px){body{padding:16px}dl{display:block}dt{margin-top:10px}}"
        "@media print{body{max-width:none;padding:0;font-size:10pt}h2{break-after:avoid}.table-wrap{overflow:visible}thead{display:table-header-group}tr{break-inside:avoid}table{font-size:8pt}}"
        "</style><main><p class='eyebrow'>Stellar Forge / Original Analysis workspace</p><h1>" + esc(plan["request"]["title"]) +
        "</h1><div class='status'><strong>" + esc(outcome) + "</strong><p>" + esc(native_status) + "</p></div>"
        "<p>" + esc(plan["request"]["note"]) + "</p><dl><dt>Analysis workspace</dt><dd>" + esc(plan["workspace_id"]) +
        "</dd><dt>Publication edition</dt><dd>" + esc(plan["id"]) + "</dd><dt>Plan SHA-256</dt><dd>" + esc(plan["plan_sha256"]) +
        "</dd><dt>Original publication job</dt><dd>" + esc(publication_id) + "</dd><dt>Collector</dt><dd>" +
        esc(target["label"]) + " / " + esc(target["workspace_id"]) +
        "</dd><dt>Reviewed endpoint</dt><dd>" + esc(target["reviewed_endpoint"]) +
        "</dd><dt>Source bytes</dt><dd>" + esc(plan["events_bytes"]) + " / SHA-256 " + esc(plan["events_sha256"]) +
        "</dd><dt>Original idempotency key</dt><dd>" + esc(plan["operation_id"]) +
        "</dd><dt>Coverage</dt><dd>" + esc(summary["job_count"]) + " jobs / " + esc(summary["dataset_count"]) +
        " datasets / " + esc(summary["event_count"]) + " retained-timestamp events</dd><dt>SQL disclosure</dt><dd>" +
        ("Original SQL text is included in the reviewed outbound events." if summary["include_sql"] else "Only the SQL and parameter digests are included; parameter values and row contents are omitted.") +
        "</dd></dl><h2>Native operations and result scope</h2>" +
        _table(["Original job", "Kind", "Original start", "Original completion", "Scope"], job_rows) +
        "<h2>Recorded input and output relationships</h2>" +
        _table(["Original job", "Direction", "Namespace", "Dataset"], edges) +
        "<h2>Retained dataset identities</h2>" +
        _table(["Namespace", "Dataset", "Kind", "Rows", "Native digest"], datasets) +
        "<h2>Publication observations</h2>" +
        (_table(["Attempt", "Observation", "Recorded at", "Outcome", "Runtime/error"], history) if history else "<p>No publication attempt has been made.</p>") +
        ("<h2>Source qualifications</h2><ul>" + warnings + "</ul>" if warnings else "") +
        "<h2>Receiving and continued work</h2><p>The handover contains these exact events, the reviewed plan, full native metadata bindings and publication receipts. "
        "Its native-bindings document retains original manifests and job request/result bytes with their hashes. "
        "Use the original Analysis whole-workspace archive to carry the complete source documents, row tables, full query-export files, workbook files and working history. "
        "A restored workspace reads the same saved lineage plan and accepted receipt; an uncertain publication resumes its original job and collector key.</p>"
        "<footer>These START and COMPLETE events are a retrospective projection of completed native operations, using their retained original timestamps. "
        "No acquisition, query, import or workbook was rerun to create this report. Relationships follow recorded tables/source versions and explicit mappings; column dependencies are not inferred.</footer></main></html>").encode()


def files(plan, snapshot, events, observations):
    descriptor = {key: deepcopy(plan[key]) for key in _PLAN_KEYS}
    documents = {
        "events.json": (events, "application/json"),
        "plan.json": (encode({"schema": PORTABLE_SCHEMA, "plan_sha256": plan["plan_sha256"],
                              "plan": descriptor}) + b"\n", "application/json"),
        "native-bindings.json": (encode(snapshot) + b"\n", "application/json"),
        "receipts.json": (encode({"schema": PORTABLE_SCHEMA, "plan_id": plan["id"],
                                  "publication": plan.get("publication"), "observations": observations}) + b"\n",
                          "application/json"),
        "report.html": (render(plan, observations), "text/html;charset=utf-8"),
    }
    need(sum(len(value[0]) for value in documents.values()) <= _MAX_ARCHIVE, "HANDOVER_TOO_LARGE")
    manifest = {"schema": PORTABLE_SCHEMA, "plan_id": plan["id"], "workspace_id": plan["workspace_id"],
                "plan_sha256": plan["plan_sha256"], "events_sha256": plan["events_sha256"],
                "files": {name: {"bytes": len(value[0]), "sha256": digest(value[0]), "mime": value[1]}
                          for name, value in sorted(documents.items())}}
    documents["manifest.json"] = (encode(manifest) + b"\n", "application/json")
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for name, (raw, _) in sorted(documents.items()):
            info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = 0o100600 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, raw)
    documents["handover.zip"] = (stream.getvalue(), "application/zip")
    need(len(documents["handover.zip"][0]) <= _MAX_ARCHIVE, "HANDOVER_TOO_LARGE")
    return documents


class LineagePublication:
    """Read a complete original publication handover without a live collector."""

    def __init__(self, archive, *, expected_sha256=None):
        raw = read(Path(archive).expanduser().absolute(), _MAX_ARCHIVE)
        if expected_sha256 is not None:
            need(digest(raw) == checksum(expected_sha256), "HANDOVER_DIGEST_CHANGED")
        self.archive_sha256 = digest(raw)
        with zipfile.ZipFile(io.BytesIO(raw)) as bundle:
            names = bundle.namelist()
            need(len(names) == len(_MEMBERS) + 1 and set(names) == _MEMBERS | {"manifest.json"},
                 "HANDOVER_MEMBERS_INVALID")
            info = bundle.getinfo("manifest.json")
            need(0 < info.file_size <= 65536, "HANDOVER_MANIFEST_INVALID")
            manifest = parse(bundle.read(info))
            need(manifest.get("schema") == PORTABLE_SCHEMA and
                 isinstance(manifest.get("files"), dict) and set(manifest["files"]) == _MEMBERS,
                 "HANDOVER_MANIFEST_INVALID")
            total = 0
            members = {}
            for name in sorted(_MEMBERS):
                record, info = manifest["files"][name], bundle.getinfo(name)
                need(isinstance(record, dict) and type(record.get("bytes")) is int and
                     0 <= record["bytes"] <= _MAX_ARCHIVE and info.file_size == record["bytes"] and
                     not stat.S_ISLNK(info.external_attr >> 16) and not (info.flag_bits & 1),
                     "HANDOVER_MEMBER_INVALID")
                total += info.file_size
                need(total <= _MAX_ARCHIVE, "HANDOVER_TOO_LARGE")
                data = bundle.read(info)
                need(len(data) == record["bytes"] and digest(data) == checksum(record["sha256"]),
                     "HANDOVER_MEMBER_CHANGED")
                members[name] = data
        self.manifest, self.members = manifest, members
        envelope = parse(members["plan.json"])
        need(envelope.get("schema") == PORTABLE_SCHEMA, "HANDOVER_PLAN_INVALID")
        self.plan = envelope["plan"]
        self.snapshot = parse(members["native-bindings.json"])
        self.receipts = parse(members["receipts.json"])
        self.events = parse(members["events.json"])
        need(self.snapshot.get("schema") == PROJECTION_SCHEMA and
             self.snapshot.get("workspace_id") == self.plan.get("workspace_id") and
             self.snapshot.get("root_job_id") == self.plan.get("request", {}).get("job_id") and
             self.plan.get("id") == manifest["plan_id"] == self.receipts.get("plan_id") and
             self.plan.get("workspace_id") == manifest["workspace_id"], "HANDOVER_BINDING_CHANGED")
        need(digest(encode(self.snapshot)) == self.plan["snapshot_sha256"] and
             digest(encode({**self.plan, "snapshot": self.snapshot})) ==
             envelope["plan_sha256"] == manifest["plan_sha256"], "HANDOVER_PLAN_CHANGED")
        need(digest(members["events.json"]) == self.plan["events_sha256"] == manifest["events_sha256"] and
             len(members["events.json"]) == self.plan["events_bytes"] and
             isinstance(self.events, list) and len(self.events) == self.plan["summary"]["event_count"],
             "HANDOVER_EVENT_SOURCE_CHANGED")
        self._documents = {}
        for document in self.snapshot["documents"]:
            sha = checksum(document.get("sha256"))
            need(sha not in self._documents, "HANDOVER_NATIVE_DOCUMENT_DUPLICATED")
            try:
                data = base64.b64decode(document["body_base64"], validate=True)
            except (ValueError, TypeError):
                raise StateError("ANALYSIS_LINEAGE_HANDOVER_NATIVE_DOCUMENT_INVALID") from None
            need(len(data) == document["bytes"] and digest(data) == sha, "HANDOVER_NATIVE_DOCUMENT_CHANGED")
            self._documents[sha] = data
        for job in self.snapshot["native_jobs"]:
            need(job["request_sha256"] in self._documents and job["result_sha256"] in self._documents,
                 "HANDOVER_NATIVE_JOB_MISSING")
        for version in self.snapshot["native_versions"]:
            need(version["manifestSha256"] in self._documents, "HANDOVER_NATIVE_MANIFEST_MISSING")
        accepted = (self.receipts.get("publication") or {}).get("accepted")
        if accepted:
            from .analysis_lineage import AnalysisLineage
            need(accepted.get("plan_id") == self.plan["id"] and
                 accepted.get("workspace_id") == self.plan["workspace_id"] and
                 accepted.get("job_id") == self.receipts["publication"].get("job_id"),
                 "HANDOVER_ACCEPTANCE_CHANGED")
            AnalysisLineage._valid_reply(accepted.get("native"), self.plan)

    def inspect(self):
        return {"schema": PORTABLE_SCHEMA, "archive_sha256": self.archive_sha256,
                "plan_id": self.plan["id"], "workspace_id": self.plan["workspace_id"],
                "plan_sha256": self.manifest["plan_sha256"], "events_sha256": self.plan["events_sha256"],
                "summary": deepcopy(self.plan["summary"]),
                "publication": deepcopy(self.receipts.get("publication")),
                "native_document_count": len(self._documents)}

    def native_document(self, sha256):
        sha256 = checksum(sha256)
        need(sha256 in self._documents, "NATIVE_DOCUMENT_NOT_FOUND")
        return self._documents[sha256]
