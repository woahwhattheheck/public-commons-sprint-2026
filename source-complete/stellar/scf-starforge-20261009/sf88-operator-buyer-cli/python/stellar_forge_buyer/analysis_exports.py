"""Complete SQL exports operated by the existing analysis workspace job owner."""
from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone
import io
import json
from pathlib import Path
import re
import threading

from .errors import BuyerError, StateError
from .query_export import QueryExport
from .storage import digest, dump, parse, private_directory, read

_SCHEMA = "stellar-forge.analysis-query-export.v1"
_CONTROL = "stellar-forge.analysis-query-export-control.v1"
_ID = re.compile(r"[a-f0-9]{32}")
_SHA = re.compile(r"[a-f0-9]{64}")
_FORMATS = {"jsonl": "rows.jsonl", "csv": "rows.csv", "sqlite": "rows.sqlite3"}
_MIMES = {"rows.jsonl": "application/x-ndjson", "rows.csv": "text/csv;charset=utf-8",
          "rows.sqlite3": "application/vnd.sqlite3", "manifest.json": "application/json"}


def _now():
    return datetime.now(timezone.utc).isoformat()


def _json(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":"))


def _identifier(value):
    if not isinstance(value, str) or not _ID.fullmatch(value):
        raise StateError("ANALYSIS_EXPORT_ID_INVALID")
    return value


class AnalysisExports:
    """Use original jobs, query reviews, native exporter and retained-file reader.

    Progress and cancellation use small private control files. They never write
    to the analytical SQLite database while its export read transaction is open.
    The workspace's existing single executor remains the only dispatch owner.
    """

    def __init__(self, database, *, identity, read_job, parse_parameters):
        self.database, self.identity = database, identity
        self.read_job, self.parse_parameters = read_job, parse_parameters
        self.directory = private_directory(database.directory / "analysis-query-exports")
        self.controls = private_directory(self.directory / "control")
        self._mutex = threading.RLock()
        self._signals = {}
        self._observations = {}
        self._closed = False

    def prepare(self, request):
        allowed = {"id", "query_id", "result_sha256", "label", "formats", "timeout",
                   "max_rows", "max_output_bytes", "spreadsheet_safe"}
        if set(request) - allowed:
            raise StateError("ANALYSIS_EXPORT_FIELDS_INVALID")
        query_id = _identifier(request.get("query_id"))
        checksum = request.get("result_sha256")
        if not isinstance(checksum, str) or not _SHA.fullmatch(checksum):
            raise StateError("ANALYSIS_EXPORT_REVIEW_DIGEST_REQUIRED")
        label = request.get("label", "")
        if not isinstance(label, str) or len(label) > 160 or any(ord(c) < 32 for c in label):
            raise StateError("ANALYSIS_EXPORT_LABEL_INVALID")
        formats = request.get("formats", list(_FORMATS))
        if (not isinstance(formats, list) or not formats
                or any(not isinstance(v, str) or v not in _FORMATS for v in formats)
                or len(set(formats)) != len(formats)):
            raise StateError("QUERY_EXPORT_OPTIONS_INVALID")
        timeout = request.get("timeout", 300)
        if type(timeout) not in (int, float) or not 0 < timeout <= 86400:
            raise StateError("ANALYSIS_EXPORT_TIMEOUT_INVALID")
        limits = {key: request.get(key) for key in ("max_rows", "max_output_bytes")}
        if any(value is not None and (type(value) is not int or value < 1) for value in limits.values()):
            raise StateError("QUERY_EXPORT_OPTIONS_INVALID")
        safe = request.get("spreadsheet_safe", True)
        if type(safe) is not bool:
            raise StateError("QUERY_EXPORT_OPTIONS_INVALID")
        spec = {"query_id": query_id, "result_sha256": checksum, "label": label.strip(),
                "formats": formats, "timeout": timeout, **limits, "spreadsheet_safe": safe}
        self._review(spec)
        return spec

    def _review(self, spec):
        # _job returns the full, digest-checked original result before paging.
        job = self.read_job(spec["query_id"])
        if job["kind"] != "query" or job["status"] != "COMPLETE":
            raise StateError("ANALYSIS_EXPORT_COMPLETE_QUERY_REQUIRED")
        if job["result"].get("result_sha256") != spec["result_sha256"]:
            raise StateError("ANALYSIS_EXPORT_REVIEW_CHANGED")
        return job

    def _record(self, job_id):
        job_id = _identifier(job_id)
        with self.database._connection(readonly=True) as db:
            row = db.execute("SELECT * FROM sf_analysis_jobs WHERE id=? AND kind='query-export'", (job_id,)).fetchone()
        if row is None:
            raise StateError("ANALYSIS_EXPORT_NOT_FOUND")
        item = dict(row)
        item["request"] = parse(item["request"].encode())
        item["result"] = parse(item["result"].encode()) if item["result"] else None
        return item

    def _control(self, job_id):
        with self._mutex:
            if job_id not in self._observations:
                path = self.controls / (job_id + ".json")
                if path.exists():
                    value = parse(read(path, 16384))
                    if (value.get("schema") != _CONTROL or value.get("workspace_id") != self.identity
                            or value.get("id") != job_id):
                        raise StateError("ANALYSIS_EXPORT_CONTROL_CHANGED")
                else:
                    value = {"schema": _CONTROL, "workspace_id": self.identity, "id": job_id,
                             "rows": 0, "outputBytes": 0, "complete": False, "cancel_requested": False}
                self._observations[job_id] = value
            return dict(self._observations[job_id])

    def _progress(self, job_id, values):
        with self._mutex:
            value = self._control(job_id)
            value.update(values, updated_at=_now())
            dump(self.controls / (job_id + ".json"), value)
            self._observations[job_id] = value
            return dict(value)

    def progress(self, job_id):
        return {key: value for key, value in self._control(_identifier(job_id)).items()
                if key not in {"schema", "workspace_id", "id"}}

    def cancel(self, job_id):
        job = self._record(job_id)
        if job["status"] == "RUNNING":
            with self._mutex:
                self._signals.setdefault(job_id, threading.Event()).set()
                self._progress(job_id, {"cancel_requested": True})
        return self.read_job(job_id)

    def close(self):
        # Signal first; the original workspace then waits for its executor.
        with self._mutex:
            self._closed = True
            for job_id, signal in self._signals.items():
                signal.set()
                try:
                    self._progress(job_id, {"cancel_requested": True})
                except OSError:
                    pass

    def _completed(self, job_id, spec, review):
        result = QueryExport(self.directory / job_id)
        manifest = result.inspect()
        binding = manifest["binding"]
        expected = self.parse_parameters(review["request"]["parameters_text"])
        if (binding.get("sql") != review["request"]["sql"] or binding.get("parameters") != expected
                or binding.get("views") != review["result"]["views"]
                or set(manifest["outputs"]) != {_FORMATS[k] for k in spec["formats"]}
                or manifest.get("csv", {}).get("spreadsheetSafe") is not spec["spreadsheet_safe"]):
            raise StateError("ANALYSIS_EXPORT_BINDING_CHANGED")
        if (spec["max_rows"] is not None and manifest["rowCount"] > spec["max_rows"]
                or spec["max_output_bytes"] is not None
                and sum(v["bytes"] for v in manifest["outputs"].values()) > spec["max_output_bytes"]):
            raise StateError("ANALYSIS_EXPORT_LIMIT_BINDING_CHANGED")
        raw = read(result.directory / "manifest.json", 16 * 1024 * 1024)
        files = [{"name": name, **record, "mime": _MIMES[name]} for name, record in manifest["outputs"].items()]
        files.append({"name": "manifest.json", "bytes": len(raw), "sha256": digest(raw), "mime": _MIMES["manifest.json"]})
        return {"schema": _SCHEMA, "label": spec["label"], "directory": str(result.directory),
                "manifest_sha256": digest(raw), "manifest": manifest,
                "manifest_text": raw.decode("utf-8"), "files": files,
                "source_query": {"id": review["id"], "result_sha256": spec["result_sha256"],
                                 "parameters_text": review["request"]["parameters_text"],
                                 "finished_at": review["finished_at"], "preview_rows": len(review["result"]["rows"]),
                                 "preview_truncated": review["result"]["truncated"]}}

    def _finish(self, job_id, status, *, result=None, error=None):
        with self.database._connection() as db:
            db.execute("UPDATE sf_analysis_jobs SET status=?,result=?,error=?,finished_at=? WHERE id=? AND kind='query-export'",
                       (status, _json(result) if result else None, error, _now(), job_id))

    def run(self, job_id, spec):
        job_id = _identifier(job_id)
        review = self._review(spec)
        with self._mutex:
            signal = self._signals.setdefault(job_id, threading.Event())
            if self._closed or self._control(job_id)["cancel_requested"]:
                signal.set()
        try:
            self._progress(job_id, {"started_at": _now()})
            if signal.is_set():
                raise StateError("DATASET_SQL_QUERY_CANCELLED")
            self.database.export_query(review["request"]["sql"],
                self.parse_parameters(review["request"]["parameters_text"]),
                destination=self.directory / job_id, expected_views=review["result"]["views"],
                formats=spec["formats"], timeout=spec["timeout"], cancel=signal.is_set,
                max_rows=spec["max_rows"], max_output_bytes=spec["max_output_bytes"],
                spreadsheet_safe=spec["spreadsheet_safe"], progress=lambda value: self._progress(job_id, value))
            result = self._completed(job_id, spec, review)
            self._finish(job_id, "COMPLETE", result=result)
        except BaseException as exc:
            # A final callback or DB update can fail after native publication.
            # The complete original manifest wins over late cancel/error state.
            try:
                result = self._completed(job_id, spec, review)
            except (BuyerError, OSError, ValueError, TypeError):
                code = getattr(exc, "code", None) or str(exc) if isinstance(exc, BuyerError) else type(exc).__name__
                status = "CANCELLED" if code == "DATASET_SQL_QUERY_CANCELLED" else "FAILED"
                self._finish(job_id, status, error=str(code)[:256])
            else:
                self._finish(job_id, "COMPLETE", result=result)
        finally:
            with self._mutex:
                self._signals.pop(job_id, None)

    def recover_completed(self):
        """Adopt original complete outputs after interruption without SQL replay."""
        with self.database._connection(readonly=True) as db:
            ids = [row[0] for row in db.execute("SELECT id FROM sf_analysis_jobs WHERE kind='query-export' AND status IN ('INTERRUPTED','FAILED','CANCELLED')")]
        for job_id in ids:
            if not (self.directory / job_id / "manifest.json").exists():
                continue
            record = self._record(job_id)
            try:
                result = self._completed(job_id, record["request"], self._review(record["request"]))
            except (BuyerError, OSError, ValueError, TypeError):
                continue
            self._finish(job_id, "COMPLETE", result=result)

    def history(self, *, before=None, limit=25):
        if type(limit) is not int or not 1 <= limit <= 100 or before is not None and (type(before) is not int or before < 1):
            raise StateError("ANALYSIS_EXPORT_PAGE_INVALID")
        with self.database._connection(readonly=True) as db:
            rows = db.execute("SELECT sequence,id,status,created_at,finished_at,error,request,result FROM sf_analysis_jobs "
                              "WHERE kind='query-export' AND (? IS NULL OR sequence<?) ORDER BY sequence DESC LIMIT ?",
                              (before, before, limit + 1)).fetchall()
        items = []
        for row in rows[:limit]:
            item = dict(row)
            spec = parse(item.pop("request").encode())
            result = parse(item.pop("result").encode()) if row["result"] else None
            manifest = result["manifest"] if result else {}
            item.update(label=spec["label"], query_id=spec["query_id"], row_count=manifest.get("rowCount"),
                        output_bytes=sum(v["bytes"] for v in manifest.get("outputs", {}).values()) if result else None,
                        progress=self.progress(row["id"]))
            items.append(item)
        return {"items": items, "next_before": items[-1]["sequence"] if len(rows) > limit else None}

    @contextmanager
    def download(self, job_id, name):
        job = self._record(job_id)
        if job["status"] != "COMPLETE" or not job["result"]:
            raise StateError("ANALYSIS_EXPORT_COMPLETE_REQUIRED")
        if name not in _MIMES:
            raise StateError("ANALYSIS_EXPORT_FILE_INVALID")
        result = QueryExport(self.directory / job_id)
        raw = read(result.directory / "manifest.json", 16 * 1024 * 1024)
        if digest(raw) != job["result"]["manifest_sha256"]:
            raise StateError("ANALYSIS_EXPORT_MANIFEST_CHANGED")
        record = next((f for f in job["result"]["files"] if f["name"] == name), None)
        if record is None:
            raise StateError("QUERY_EXPORT_OUTPUT_NOT_SELECTED")
        if name == "manifest.json":
            if len(raw) != record["bytes"] or digest(raw) != record["sha256"]:
                raise StateError("ANALYSIS_EXPORT_MANIFEST_CHANGED")
            with io.BytesIO(raw) as stream:
                yield stream, record
        else:
            # The native reader validates the chosen output before HTTP headers,
            # and owns this same descriptor through the whole streamed download.
            with result.open(name) as stream:
                yield stream, record
