"""Project completed native Analysis records into reviewed OpenLineage events.

This reads the original immutable database versions, complete query exports and
workbook deliveries. It does not execute SQL, start an import or infer column
dependencies. Full native bindings stay in the local publication plan; outbound
events contain the explicitly reviewed metadata projection.
"""
from __future__ import annotations

import base64
from copy import deepcopy
from datetime import datetime
import json
import re
import uuid

from .analysis_workbooks import WorkbookDelivery
from .errors import StateError
from .storage import digest, parse

SCHEMA = "stellar-forge.analysis-lineage-projection.v1"
PRODUCER = "https://github.com/woahwhattheheck/public-commons-sprint-2026/tree/main/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python"
FACET_SCHEMA = "https://raw.githubusercontent.com/woahwhattheheck/public-commons-sprint-2026/e4e5196261cfb0f410538d0e3277b112806236c1/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python/analysis-lineage-facet.schema.json"
CORE_SCHEMA = "https://openlineage.io/spec/2-0-2/OpenLineage.json#/$defs/RunEvent"
SUPPORTED = ("import", "response-import", "query", "query-export", "workbook")
MAX_BINDING_BYTES = 32 * 1024 * 1024
MAX_EVENT_BYTES = 16 * 1024 * 1024
MAX_JOBS = 128
MAX_DATASETS = 2048
_ID = re.compile(r"[a-f0-9]{32}")
_HASH = re.compile(r"[a-f0-9]{64}")
_TABLE = re.compile(r"sf_dataset_rows_([a-f0-9]{64})")
_TIME = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})")


def need(condition, code):
    if not condition:
        raise StateError("ANALYSIS_LINEAGE_" + code)


def identifier(value):
    need(isinstance(value, str) and _ID.fullmatch(value), "ID_INVALID")
    return value


def checksum(value):
    need(isinstance(value, str) and _HASH.fullmatch(value), "SHA256_INVALID")
    return value


def encode(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False,
                      sort_keys=True, separators=(",", ":")).encode("utf-8")


def stamp(value):
    need(isinstance(value, str) and _TIME.fullmatch(value), "NATIVE_TIME_INVALID")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise StateError("ANALYSIS_LINEAGE_NATIVE_TIME_INVALID") from None
    need(parsed.tzinfo is not None, "NATIVE_TIME_INVALID")
    return parsed


def facet(*, entity, **values):
    need(entity in ("run", "job", "dataset"), "FACET_ENTITY_INVALID")
    definition = "StellarForgeAnalysis" + entity.title() + "Facet"
    return {"_producer": PRODUCER, "_schemaURL": FACET_SCHEMA + "#/$defs/" + definition, **values}


def _bounded(value, maximum=MAX_BINDING_BYTES):
    need(len(encode(value)) <= maximum, "NATIVE_BINDINGS_TOO_LARGE")
    return value


def _nonnegative(value):
    need(type(value) is int and value >= 0, "NATIVE_COUNT_INVALID")
    return value


def _file_records(value):
    need(isinstance(value, list), "NATIVE_OUTPUTS_INVALID")
    records = []
    for item in value:
        need(isinstance(item, dict) and isinstance(item.get("name"), str), "NATIVE_OUTPUTS_INVALID")
        records.append({"name": item["name"], "bytes": _nonnegative(item.get("bytes")),
                        "sha256": checksum(item.get("sha256"))})
    return records


class _Capture:
    def __init__(self, workspace, root_id, include_sql, stopped):
        self.workspace = workspace
        self.identity = identifier(workspace.identity)
        self.namespace = "urn:stellar-forge:analysis:" + self.identity
        self.root_id = identifier(root_id)
        need(type(include_sql) is bool, "SQL_SELECTION_INVALID")
        self.include_sql = include_sql
        self.stopped = stopped
        self.jobs = {}
        self.datasets = {}
        self.documents = {}
        self.native_versions = {}
        self.native_jobs = {}
        self.visiting = set()
        self.warnings = []
        self._import_index = None
        self._size = 0

    def check(self):
        if self.stopped:
            self.stopped()
        need(len(self.jobs) + len(self.visiting) <= MAX_JOBS, "TOO_MANY_NATIVE_JOBS")
        need(len(self.datasets) <= MAX_DATASETS, "TOO_MANY_NATIVE_DATASETS")

    def retain(self, raw, *, kind):
        self.check()
        need(isinstance(raw, bytes), "NATIVE_DOCUMENT_BYTES_REQUIRED")
        sha = digest(raw)
        if sha not in self.documents:
            self._size += len(raw)
            need(self._size <= MAX_BINDING_BYTES, "NATIVE_BINDINGS_TOO_LARGE")
            self.documents[sha] = {"kind": kind, "bytes": len(raw), "sha256": sha,
                                   "body_base64": base64.b64encode(raw).decode("ascii")}
        return sha

    def dataset(self, namespace, name, values):
        key = namespace + "\n" + name
        item = {"namespace": namespace, "name": name,
                "facets": {"stellarForge_analysis": facet(entity="dataset", **values)}}
        old = self.datasets.get(key)
        need(old is None or old == item, "DATASET_IDENTITY_CONFLICT")
        self.datasets[key] = item
        self.check()
        return key

    def external_source(self, version, manifest):
        sha = checksum(version["manifestSha256"])
        dataset = version.get("dataset") or {}
        values = {"kind": "retained-native-source", "manifest_sha256": sha,
                  "source_binding_sha256": checksum(version["sourceBindingSha256"]),
                  "row_count": _nonnegative(version["row_count"])}
        # Preserve native completion and financial status as separate observations.
        # Do not copy arbitrary provider fields, URLs, parameters or row values.
        if isinstance(dataset.get("kind"), str):
            values["source_kind"] = dataset["kind"]
        if "originalPaymentStatus" in version:
            status = version["originalPaymentStatus"]
            if isinstance(status, (str, bool)) or status is None:
                values["original_payment_status"] = status
        completion = manifest.get("completion")
        if isinstance(completion, dict):
            safe = {key: value for key, value in completion.items()
                    if key in {"complete", "partial", "requiresIncompleteAcknowledgement",
                               "incompleteAcknowledged", "sourceStatus", "responseStatus",
                               "deliveryStatus", "status"} and
                    (value is None or type(value) in (str, bool, int))}
            if safe:
                values["native_response_completion"] = safe
        return self.dataset("urn:stellar-forge:retained-source",
                            "manifest/" + sha, values)

    def version(self, version_id, *, expected=None, with_import=True, before=None):
        version_id = checksum(version_id)
        if version_id not in self.native_versions:
            record = self.workspace.database.version(version_id)
            need(record.get("version_id") == version_id and
                 record.get("table") == "sf_dataset_rows_" + version_id,
                 "NATIVE_VERSION_CHANGED")
            raw = self.workspace.database.manifest_bytes(version_id)
            need(digest(raw) == checksum(record.get("manifestSha256")), "NATIVE_MANIFEST_CHANGED")
            manifest = parse(raw)
            need(isinstance(manifest, dict), "NATIVE_MANIFEST_INVALID")
            self.retain(raw, kind="dataset-manifest")
            self.native_versions[version_id] = deepcopy(record)
            columns = record.get("column_types", [])
            need(isinstance(columns, list), "NATIVE_COLUMNS_INVALID")
            schema_columns = []
            for column in columns:
                need(isinstance(column, dict) and isinstance(column.get("column"), str), "NATIVE_COLUMNS_INVALID")
                schema_columns.append({"name": column["column"], "source": column.get("source"),
                                       "json_types": column.get("json_types", [])})
            values = {"kind": "sqlite-immutable-version", "version_id": version_id,
                      "manifest_sha256": record["manifestSha256"],
                      "source_binding_sha256": checksum(record["sourceBindingSha256"]),
                      "row_count": _nonnegative(record["row_count"]), "columns": schema_columns}
            if isinstance(record.get("jsonl"), dict):
                values["original_jsonl"] = {"bytes": _nonnegative(record["jsonl"]["bytes"]),
                                            "sha256": checksum(record["jsonl"]["sha256"])}
            self.dataset(self.namespace, record["table"], values)
            self.external_source(record, manifest)
        record = self.native_versions[version_id]
        if expected is not None:
            need(isinstance(expected, dict) and expected.get("version_id") == version_id and
                 expected.get("manifestSha256") == record["manifestSha256"] and
                 expected.get("sourceBindingSha256") == record["sourceBindingSha256"] and
                 expected.get("table") == record["table"] and
                 expected.get("row_count") == record["row_count"],
                 "RECORDED_SOURCE_VERSION_CHANGED")
        if with_import:
            self.import_witness(version_id, before)
        return self.namespace + "\n" + record["table"]

    def import_witness(self, version_id, before):
        # Only an original COMPLETE result that actually returned IMPORTED is a
        # write witness. An UNCHANGED observation does not establish its writer.
        if self._import_index is None:
            self._import_index = {}
            with self.workspace.database._connection(readonly=True) as db:
                rows = db.execute(
                    "SELECT id,finished_at,result FROM sf_analysis_jobs "
                    "WHERE kind IN ('import','response-import') AND status='COMPLETE' "
                    "ORDER BY sequence LIMIT 10001").fetchall()
            need(len(rows) <= 10000, "IMPORT_WITNESS_INDEX_TOO_LARGE")
            for row in rows:
                result = parse(row["result"].encode()) if row["result"] else {}
                version = result.get("version") or {}
                if version.get("import_status") == "IMPORTED":
                    self._import_index.setdefault(version.get("version_id"), []).append(dict(row))
        candidates = self._import_index.get(version_id, [])
        if before is not None:
            cutoff = stamp(before)
            candidates = [row for row in candidates if stamp(row["finished_at"]) <= cutoff]
        if len(candidates) == 1:
            original = candidates[0]["id"]
            if original not in self.visiting:
                self.job(original)
        elif candidates:
            warning = "More than one completed IMPORTED job claims version " + version_id + "; no writer was selected."
            if warning not in self.warnings:
                self.warnings.append(warning)
        else:
            warning = "Version " + version_id + " has its original manifest, but no completed IMPORTED job is recorded before this consumer."
            if warning not in self.warnings:
                self.warnings.append(warning)

    def query_inputs(self, job, *, binding=None):
        if binding is None:
            result = job["result"]
            records, tables = result.get("source_versions"), result.get("read_tables")
        else:
            need(isinstance(binding, dict), "QUERY_SOURCE_RECORDS_REQUIRED")
            records, tables = binding.get("sourceVersions"), binding.get("readTables")
        need(isinstance(records, list) and isinstance(tables, list),
             "QUERY_SOURCE_RECORDS_REQUIRED")
        recorded = {}
        for row in records:
            need(isinstance(row, dict), "QUERY_SOURCE_RECORDS_REQUIRED")
            key = checksum(row.get("version_id"))
            need(key not in recorded, "QUERY_SOURCE_VERSION_DUPLICATED")
            recorded[key] = row
        inputs = []
        for table in tables:
            need(isinstance(table, str), "QUERY_TABLE_INVALID")
            match = _TABLE.fullmatch(table)
            if match:
                inputs.append(self.version(match[1], expected=recorded.get(match[1]),
                                           before=job["created_at"]))
            else:
                inputs.append(self.dataset(self.namespace, "read-table/" + table,
                    {"kind": "native-read-table", "table": table,
                     "binding_basis": "original SQLite read_tables; no version inferred"}))
                self.warnings.append(job["kind"] + " " + job["id"] + " read " + table +
                                     "; no immutable dataset-version identity was inferred.")
        need(all("sf_dataset_rows_" + key in tables for key in recorded),
             "QUERY_SOURCE_TABLE_CHANGED")
        return sorted(set(inputs))

    def raw_job(self, job_id):
        job = self.workspace._job(job_id)
        need(job["kind"] in SUPPORTED and job["status"] == "COMPLETE" and
             isinstance(job.get("result"), dict), "COMPLETED_SUPPORTED_JOB_REQUIRED")
        need(stamp(job["finished_at"]) >= stamp(job["created_at"]), "NATIVE_TIME_ORDER_INVALID")
        with self.workspace.database._connection(readonly=True) as db:
            row = db.execute("SELECT request,result FROM sf_analysis_jobs WHERE id=?", (job_id,)).fetchone()
        need(row is not None and row["result"] is not None, "NATIVE_JOB_CHANGED")
        request_raw = row["request"].encode("utf-8")
        result_raw = row["result"].encode("utf-8")
        need(parse(request_raw) == job["request"] and parse(result_raw) == job["result"],
             "NATIVE_JOB_CHANGED")
        request_sha = self.retain(request_raw, kind="native-job-request")
        result_sha = self.retain(result_raw, kind="native-job-result")
        self.native_jobs[job_id] = {"id": job_id, "kind": job["kind"], "status": "COMPLETE",
                                    "created_at": job["created_at"], "finished_at": job["finished_at"],
                                    "request_sha256": request_sha, "result_sha256": result_sha}
        return job

    def job(self, job_id):
        job_id = identifier(job_id)
        if job_id in self.jobs:
            return self.jobs[job_id]
        need(job_id not in self.visiting, "NATIVE_DEPENDENCY_CYCLE")
        self.visiting.add(job_id)
        self.check()
        try:
            job = self.raw_job(job_id)
            result, request, kind = job["result"], job["request"], job["kind"]
            inputs, outputs, parents = [], [], []
            detail = {"kind": kind, "original_job_id": job_id,
                      "native_request_sha256": self.native_jobs[job_id]["request_sha256"],
                      "native_result_sha256": self.native_jobs[job_id]["result_sha256"]}
            if kind in {"import", "response-import"}:
                version = result.get("version")
                need(isinstance(version, dict), "IMPORTED_VERSION_REQUIRED")
                output = self.version(version.get("version_id"), expected=version, with_import=False)
                current = self.native_versions[version["version_id"]]
                inputs = ["urn:stellar-forge:retained-source\nmanifest/" + current["manifestSha256"]]
                outputs = [output]
                detail.update(source_revision=result.get("source_revision"),
                              import_status=version.get("import_status"),
                              column_mapping=current.get("columns", []))
                if kind == "response-import":
                    detail.update(preview_id=result.get("preview_id"),
                                  preview_sha256=result.get("preview_sha256"),
                                  incomplete_acknowledged=result.get("allow_incomplete", False))
            elif kind == "query":
                inputs = self.query_inputs(job)
                columns = result.get("columns")
                need(isinstance(columns, list) and all(isinstance(v, str) for v in columns) and
                     isinstance(result.get("rows"), list) and type(result.get("truncated")) is bool,
                     "QUERY_RESULT_INVALID")
                detail.update(result_sha256=checksum(result.get("result_sha256")),
                              sql_sha256=digest(request["sql"].encode()),
                              parameters_sha256=digest(request["parameters_text"].encode()),
                              preview_truncated=result["truncated"], preview_rows=len(result["rows"]),
                              reviewed_views=result["views"])
                if self.include_sql:
                    detail["sql"] = request["sql"]
                outputs = [self.dataset(self.namespace, "query/" + job_id,
                    {"kind": "saved-query-preview", "original_job_id": job_id,
                     "result_sha256": result["result_sha256"], "columns": columns,
                     "row_count": len(result["rows"]), "truncated": result["truncated"]})]
            elif kind == "query-export":
                query_id = identifier(request.get("query_id"))
                query = self.raw_job(query_id) if query_id not in self.jobs else self.workspace._job(query_id)
                need(query["kind"] == "query" and
                     query["result"].get("result_sha256") == request.get("result_sha256"),
                     "QUERY_EXPORT_REVIEW_CHANGED")
                self.job(query_id)
                # _completed uses the original QueryExport reader and verifies
                # actual outputs, exact SQL/parameters/views and native limits.
                fresh = self.workspace.exports._completed(job_id, request, query)
                need(fresh["manifest_sha256"] == result.get("manifest_sha256") and
                     fresh["files"] == result.get("files") and
                     fresh["source_query"] == result.get("source_query"),
                     "QUERY_EXPORT_NATIVE_BINDING_CHANGED")
                manifest_raw = fresh["manifest_text"].encode("utf-8")
                manifest = fresh["manifest"]
                self.retain(manifest_raw, kind="query-export-manifest")
                # The complete export owns its actual read transaction. Its
                # earlier preview remains a reviewed parent, not the data source.
                inputs = self.query_inputs(job, binding=manifest["binding"])
                parents = [query_id]
                detail.update(reviewed_query_id=query_id,
                              reviewed_query_result_sha256=request["result_sha256"],
                              manifest_sha256=fresh["manifest_sha256"],
                              binding_sha256=checksum(manifest["bindingSha256"]),
                              reviewed_preview_truncated=query["result"]["truncated"],
                              execution_basis="original complete SQL export, not the preview rows")
                outputs = [self.dataset(self.namespace, "query-export/" + job_id,
                    {"kind": "complete-query-export", "original_job_id": job_id,
                     "manifest_sha256": fresh["manifest_sha256"],
                     "binding_sha256": manifest["bindingSha256"],
                     "columns": manifest["columns"], "row_count": _nonnegative(manifest["rowCount"]),
                     "files": _file_records(fresh["files"])})]
            else:
                delivery = WorkbookDelivery(self.workspace.workbooks.directory / job_id,
                    expected_manifest_sha256=checksum(result.get("manifest_sha256")))
                manifest = delivery.inspect()
                need(manifest.get("id") == job_id and manifest.get("workspace_id") == self.identity and
                     manifest.get("name") == result.get("name") and
                     manifest.get("revision") == result.get("revision") and
                     manifest.get("definition_sha256") == result.get("definition_sha256"),
                     "WORKBOOK_NATIVE_BINDING_CHANGED")
                self.retain(delivery.raw, kind="workbook-manifest")
                with delivery.open("definition.json") as stream:
                    raw = stream.read(4 * 1024 * 1024 + 1)
                need(len(raw) <= 4 * 1024 * 1024 and digest(raw) == manifest["definition_sha256"],
                     "WORKBOOK_DEFINITION_CHANGED")
                self.retain(raw, kind="workbook-definition")
                definition = parse(raw)
                sheet_mappings = []
                for sheet in manifest["sheets"]:
                    source = sheet["source"]
                    if source["kind"] == "query-export":
                        parent = self.job(identifier(source["id"]))
                        need(parent["kind"] == "query-export" and
                             parent["detail"]["manifest_sha256"] == source["sha256"],
                             "WORKBOOK_QUERY_SOURCE_CHANGED")
                        inputs.extend(parent["outputs"])
                        parents.append(parent["id"])
                    elif source["kind"] == "report":
                        # An actual retained report publication is a valid source.
                        # Its internal dependencies are not inferred by this arm.
                        inputs.append(self.dataset(self.namespace,
                            "report-publication/" + str(source["id"]) + "/section/" + str(source.get("section", 0)),
                            {"kind": "retained-report-publication", "publication_id": source["id"],
                             "sha256": checksum(source["sha256"]), "section": source.get("section", 0),
                             "original_job_id": source.get("job_id"),
                             "result_sha256": source.get("result_sha256"),
                             "columns": source.get("columns", []), "row_count": source.get("row_count"),
                             "binding_basis": "original captured workbook source; report ancestors not inferred"}))
                    else:
                        raise StateError("ANALYSIS_LINEAGE_WORKBOOK_SOURCE_KIND_UNSUPPORTED")
                    sheet_mappings.append({"name": sheet["name"], "worksheets": sheet.get("worksheets", []),
                                           "row_count": sheet["row_count"], "source": source,
                                           "columns": sheet.get("columns", []),
                                           "conversions": sheet.get("conversions", [])})
                detail.update(definition_sha256=manifest["definition_sha256"],
                              manifest_sha256=result["manifest_sha256"], workbook_name=manifest["name"],
                              workbook_revision=manifest["revision"], sheet_mappings=sheet_mappings)
                outputs = [self.dataset(self.namespace, "workbook/" + job_id,
                    {"kind": "complete-workbook", "original_job_id": job_id,
                     "name": manifest["name"], "revision": manifest["revision"],
                     "definition_sha256": manifest["definition_sha256"],
                     "manifest_sha256": result["manifest_sha256"],
                     "row_count": _nonnegative(manifest["row_count"]),
                     "sheets": [{"name": s["name"], "row_count": s["row_count"]} for s in manifest["sheets"]],
                     "files": _file_records(result["files"])})]
            record = {"id": job_id, "kind": kind, "run_id": str(uuid.UUID(hex=job_id)),
                      "created_at": job["created_at"], "finished_at": job["finished_at"],
                      "inputs": sorted(set(inputs)), "outputs": sorted(set(outputs)),
                      "reviewed_parent_job_ids": sorted(set(parents)), "detail": detail}
            self.jobs[job_id] = record
            return record
        finally:
            self.visiting.discard(job_id)

    def finish(self):
        self.job(self.root_id)
        self.check()
        jobs = sorted(self.jobs.values(), key=lambda row: (stamp(row["created_at"]), row["id"]))
        datasets = [self.datasets[key] for key in sorted(self.datasets)]
        events = []
        for job in jobs:
            value = {"schemaURL": CORE_SCHEMA, "producer": PRODUCER,
                     "run": {"runId": job["run_id"], "facets": {"stellarForge_analysis": facet(
                         entity="run", analysis_workspace_id=self.identity, native_job_id=job["id"],
                         retrospective=True, time_basis="original retained Analysis job timestamps",
                         **job["detail"])}},
                     "job": {"namespace": self.namespace, "name": job["kind"] + "/" + job["id"],
                             "facets": {"stellarForge_analysis": facet(
                                 entity="job", kind=job["kind"], reviewed_parent_job_ids=job["reviewed_parent_job_ids"],
                                 sql_included=self.include_sql)}},
                     "inputs": [self.datasets[key] for key in job["inputs"]],
                     "outputs": [self.datasets[key] for key in job["outputs"]]}
            events.append({**deepcopy(value), "eventType": "START", "eventTime": job["created_at"]})
            events.append({**deepcopy(value), "eventType": "COMPLETE", "eventTime": job["finished_at"]})
        events.sort(key=lambda row: (stamp(row["eventTime"]), row["run"]["runId"],
                                    0 if row["eventType"] == "START" else 1))
        event_bytes = encode(events) + b"\n"
        need(len(event_bytes) <= MAX_EVENT_BYTES, "EVENT_SOURCE_TOO_LARGE")
        snapshot = _bounded({"schema": SCHEMA, "workspace_id": self.identity,
                             "root_job_id": self.root_id, "include_sql": self.include_sql,
                             "jobs": jobs, "datasets": datasets,
                             "native_jobs": [self.native_jobs[key] for key in sorted(self.native_jobs)],
                             "native_versions": [self.native_versions[key] for key in sorted(self.native_versions)],
                             "documents": [self.documents[key] for key in sorted(self.documents)],
                             "warnings": sorted(set(self.warnings))})
        return {"snapshot": snapshot, "snapshot_sha256": digest(encode(snapshot)),
                "events": events, "events_bytes": event_bytes, "events_sha256": digest(event_bytes),
                "summary": {"workspace_id": self.identity, "root_job_id": self.root_id,
                            "job_count": len(jobs), "dataset_count": len(datasets),
                            "event_count": len(events), "events_bytes": len(event_bytes),
                            "include_sql": self.include_sql,
                            "warnings": snapshot["warnings"]}}


def capture(workspace, job_id, *, include_sql=False, stopped=None):
    """Read one complete original dependency closure; all identities remain native."""
    return _Capture(workspace, job_id, include_sql, stopped).finish()
