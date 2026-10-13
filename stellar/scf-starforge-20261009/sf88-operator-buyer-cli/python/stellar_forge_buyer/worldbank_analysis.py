"""Use reviewed World Bank handovers in the original Analysis workspace.

Source validation, projection, SQL, report publication, workbook delivery and
workspace receiving remain owned by their maintained engines. This module joins
their operations and retains the exact inputs and resumable request identities.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import base64
import csv
import hashlib
import io
import inspect
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
import time
import zipfile

from .analysis_workspace import AnalysisWorkspace, serve
from .errors import BuyerError, StateError
from .storage import private_directory

SCHEMA = "stellar-forge.worldbank-analysis.v1"
MAX_PACKAGE = 32 * 1024 * 1024
MAX_DOCUMENT = 32 * 1024 * 1024
REQUIRED = {
    "source_id", "country_iso3", "country_name", "indicator_id", "indicator_name",
    "period", "value", "value_state", "unit", "obs_status", "aggregate",
}
REVIEW_FIELDS = ("title", "note", "columns", "excludedKeys", "choices")
GDP = "NY.GDP.MKTP.CD"
POPULATION = "SP.POP.TOTL"


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True,
                       separators=(",", ":"), allow_nan=False) + "\n").encode()


def sha(body):
    return hashlib.sha256(body).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def regular(path, maximum=MAX_PACKAGE):
    path = Path(path).expanduser().absolute()
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as stream:
        before = os.fstat(stream.fileno())
        require(stat.S_ISREG(before.st_mode), "Select an original regular file: " + str(path))
        require(before.st_size <= maximum, "The selected file exceeds its supported byte capacity.")
        raw = stream.read(maximum + 1)
        after = os.fstat(stream.fileno())
        require((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) ==
                (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns),
                "The selected source changed while it was read.")
        require(len(raw) == after.st_size and len(raw) <= maximum,
                "The selected source was not read completely.")
    named = path.lstat()
    require((named.st_dev, named.st_ino, named.st_size, named.st_mtime_ns) ==
            (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns),
            "The selected source path changed.")
    return raw


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def write(path, raw, *, exact=False):
    path = Path(path)
    private_directory(path.parent, create=True)
    if path.exists():
        require(not path.is_symlink() and path.is_file(),
                "Retain the original ordinary operation file: " + str(path))
        if exact:
            require(regular(path, max(len(raw), MAX_DOCUMENT)) == raw,
                    "An existing operation file selects different original bytes: " + path.name)
            return
    fd, temporary = tempfile.mkstemp(prefix=".worldbank-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        if exact:
            try:
                os.link(temporary, path, follow_symlinks=False)
            except FileExistsError:
                require(regular(path, max(len(raw), MAX_DOCUMENT)) == raw,
                        "Concurrent operation source differs.")
        else:
            os.replace(temporary, path)
        sync_directory(path.parent)
    finally:
        Path(temporary).unlink(missing_ok=True)


def describe(path):
    path = Path(path)
    raw = regular(path, 1024 * 1024 * 1024)
    return {"filename": path.name, "bytes": len(raw), "sha256": sha(raw)}


def sql_identifier(value):
    require(isinstance(value, str) and value and "\0" not in value,
            "Use a retained SQL column name.")
    return '"' + value.replace('"', '""') + '"'


def core_call(core, directory, action, data=None):
    completed = subprocess.run(
        [sys.executable, "-B", str(core), "--workspace", str(directory), "--action", action],
        input=encoded(data or {}), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"}, check=False)
    try:
        result = json.loads(completed.stdout)
    except (ValueError, UnicodeError):
        raise ValueError("The original World Bank source operation returned no complete JSON result.") from None
    if completed.returncode or "error" in result:
        problem = result.get("error", {})
        raise ValueError("World Bank " + action + ": " +
                         str(problem.get("message", problem.get("code", completed.returncode))))
    return result


def typed_rows(raw, specification):
    csv.field_size_limit(1024 * 1024)
    reader = csv.DictReader(io.StringIO(raw.decode("utf-8"), newline=""))
    columns = reader.fieldnames
    require(columns and len(columns) == len(set(columns)),
            "The reviewed source CSV needs distinct original columns.")
    require(specification.get("schema") == "stellar-forge.csv-dataset.v1"
            and set(columns) == set(specification["columns"]),
            "The original dataset schema and CSV columns differ.")
    missing = sorted(REQUIRED - set(columns))
    require(not missing, "Review the source with the Analysis columns included: " + ", ".join(missing))
    rows = []
    for original in reader:
        require(set(original) == set(columns) and all(v is not None for v in original.values()),
                "An original CSV row has a different field count.")
        row = {}
        for name, value in original.items():
            descriptor = specification["columns"][name]
            kind = descriptor.get("type") if isinstance(descriptor, dict) else descriptor
            nullable = isinstance(descriptor, dict) and descriptor.get("nullable") is True
            if nullable and value == "":
                row[name] = None
            elif kind == "string":
                row[name] = value
            elif kind == "boolean":
                require(value in {"true", "false"}, "Retain the original source boolean value.")
                row[name] = value == "true"
            elif kind == "integer":
                require(re.fullmatch(r"-?(0|[1-9][0-9]*)", value) is not None,
                        "Retain the original source integer value.")
                row[name] = int(value)
            else:
                raise ValueError("Use the original World Bank scalar schema: " + str(kind))
        rows.append(row)
    return columns, rows


def recipes(view, columns, rows):
    table = sql_identifier(view)
    original = ", ".join(
        ("CASE " + sql_identifier(c) + " WHEN 1 THEN 'true' WHEN 0 THEN 'false' END AS " + sql_identifier(c))
        if c == "aggregate" else sql_identifier(c) for c in columns)
    raw_sql = "SELECT " + original + " FROM " + table + " ORDER BY source_id,country_iso3,indicator_id,period"
    coverage = """SELECT source_id,country_iso3,country_name,indicator_id,indicator_name,
 CASE aggregate WHEN 1 THEN 'true' WHEN 0 THEN 'false' END AS aggregate,
 unit,COUNT(*) AS observations,
 SUM(CASE WHEN value IS NULL THEN 1 ELSE 0 END) AS missing_observations,
 MIN(period) AS first_period_label,MAX(period) AS last_period_label
FROM """ + table + """
GROUP BY source_id,country_iso3,country_name,indicator_id,indicator_name,aggregate,unit
ORDER BY source_id,country_iso3,indicator_id,unit"""
    changes = """WITH annual AS (
 SELECT source_id,country_iso3,country_name,indicator_id,indicator_name,period,
 value,value_state,unit,obs_status,aggregate,CAST(period AS INTEGER) AS year,
 COUNT(*) OVER (PARTITION BY source_id,country_iso3,indicator_id,period,aggregate) AS period_observations
 FROM """ + table + """ WHERE period GLOB '[0-9][0-9][0-9][0-9]'
), previous AS (
 SELECT *,LAG(year) OVER w AS previous_year,LAG(value) OVER w AS previous_value,
 LAG(value_state) OVER w AS previous_value_state,
 LAG(period_observations) OVER w AS previous_period_observations
 FROM annual WINDOW w AS (
  PARTITION BY source_id,country_iso3,indicator_id,aggregate,unit ORDER BY year)
)
SELECT source_id,country_iso3,country_name,indicator_id,indicator_name,period,
 value AS source_value,previous_year,previous_value,
 CASE WHEN period_observations=1 AND previous_period_observations=1
       AND previous_year=year-1 AND value IS NOT NULL AND previous_value IS NOT NULL
       AND value_state='present' AND previous_value_state='present'
       AND CAST(previous_value AS REAL)<>0
      THEN 100.0*(CAST(value AS REAL)/CAST(previous_value AS REAL)-1.0)
      ELSE NULL END AS annual_change_percent,
 unit,obs_status,
 CASE WHEN period_observations<>1 OR previous_period_observations<>1 THEN 'Multiple reviewed source rows'
      WHEN previous_year IS NULL THEN 'No prior selected year'
      WHEN previous_year<>year-1 THEN 'Nonconsecutive selected years'
      WHEN value IS NULL OR previous_value IS NULL THEN 'Missing source value'
      WHEN value_state<>'present' OR previous_value_state<>'present' THEN 'Source value status'
      WHEN CAST(previous_value AS REAL)=0 THEN 'Zero prior value'
      ELSE 'Consecutive annual values' END AS calculation_status
FROM previous ORDER BY source_id,country_iso3,indicator_id,period"""
    result = [
        {"key": "observations", "title": "Reviewed observations", "sheet": "Observations",
         "note": "Every reviewed source row is retained. Original number tokens, period labels and codes remain text. Aggregate flags retain their original true/false spelling.",
         "sql": raw_sql, "numeric": {"source_page", "source_row"}},
        {"key": "coverage", "title": "Source coverage", "sheet": "Coverage",
         "note": "Coverage includes missing values and aggregate rows. First and last periods are original source labels. Missing observations are not filled.",
         "sql": coverage, "numeric": {"observations", "missing_observations"}},
        {"key": "annual_change", "title": "Annual change", "sheet": "Annual change",
         "note": "Changes use only four-digit annual periods and consecutive selected years. Missing values, duplicate period identities, nonconsecutive years and zero prior values remain uncalculated. Percentages use SQLite floating point; both original value strings remain alongside them.",
         "sql": changes, "numeric": {"previous_year", "annual_change_percent"}},
    ]
    indicators = {row["indicator_id"] for row in rows}
    if {GDP, POPULATION}.issubset(indicators):
        per_person = """WITH selected AS (
 SELECT *,COUNT(*) OVER (PARTITION BY source_id,country_iso3,indicator_id,period,aggregate) AS identity_rows
 FROM """ + table + """
)
SELECT g.source_id,g.country_iso3,g.country_name,g.period,
 g.value AS gdp_current_usd_source,p.value AS population_source,
 CASE WHEN g.value IS NOT NULL AND p.value IS NOT NULL
       AND g.value_state='present' AND p.value_state='present'
       AND CAST(p.value AS REAL)>0
      THEN CAST(g.value AS REAL)/CAST(p.value AS REAL) ELSE NULL END AS gdp_usd_per_person,
 g.obs_status AS gdp_observation_status,p.obs_status AS population_observation_status,
 CASE g.aggregate WHEN 1 THEN 'true' WHEN 0 THEN 'false' END AS aggregate
FROM selected g JOIN selected p
 ON p.source_id=g.source_id AND p.country_iso3=g.country_iso3
 AND p.period=g.period AND p.aggregate=g.aggregate
WHERE g.indicator_id='NY.GDP.MKTP.CD' AND p.indicator_id='SP.POP.TOTL'
 AND g.identity_rows=1 AND p.identity_rows=1
ORDER BY g.source_id,g.country_iso3,g.period"""
        result.append({"key": "gdp_per_person", "title": "GDP and population", "sheet": "GDP per person",
                       "note": "Unique reviewed current-US-dollar GDP and population rows join on source, country, period and aggregate status. Duplicate identities remain in Observations and are omitted from this ratio. GDP per person is a derived ratio using SQLite floating point; the two source values remain exact text. It is distinct from purchasing-power-parity measures.",
                       "sql": per_person, "numeric": {"gdp_usd_per_person"}})
    return result


class WorldBankAnalysis:
    def __init__(self, workspace, *, operation_id, progress=None, active_workspace=None):
        require(re.fullmatch(r"[a-f0-9]{32}", operation_id) is not None,
                "Use a stable 32-character lowercase hexadecimal operation ID.")
        self.workspace = private_directory(Path(workspace).expanduser().absolute(), create=True)
        self.operation_id = operation_id
        self.active_workspace = active_workspace
        self.directory = private_directory(
            self.workspace / "worldbank-analysis" / operation_id, create=True)
        self.progress = progress or (lambda value: None)
        path = self.directory / "operation.json"
        self.record = json.loads(regular(path, MAX_DOCUMENT)) if path.exists() else {
            "schema": SCHEMA, "operation_id": operation_id, "jobs": {}, "queries": {},
        }
        require(self.record.get("schema") == SCHEMA and
                self.record.get("operation_id") == operation_id,
                "Continue the original World Bank Analysis operation.")

    @contextmanager
    def _workspace_session(self):
        if self.active_workspace is not None:
            workspace = self.active_workspace
            require(workspace.database.directory == self.workspace and not workspace._closed,
                    "Continue the same live Analysis workspace owner.")
            yield workspace
        else:
            workspace = AnalysisWorkspace(self.workspace)
            try:
                yield workspace
            finally:
                workspace.close()

    def save(self):
        write(self.directory / "operation.json", encoded(self.record))

    def emit(self, phase, **details):
        self.progress({"operation_id": self.operation_id, "phase": phase, **details})

    def identifier(self, name):
        return sha((self.operation_id + "\0" + name).encode())[:32]

    def job(self, workspace, phase, kind, payload, *, resume=False):
        attempts = self.record["jobs"].setdefault(phase, [])
        expected = sha(encoded({"kind": kind, "request": payload}))
        if not attempts:
            attempts.append({"id": self.identifier("job:" + phase + ":0"),
                             "kind": kind, "request_sha256": expected})
            self.save()
        chosen = attempts[-1]
        require(chosen["kind"] == kind and chosen["request_sha256"] == expected,
                "The original " + phase + " job selects different source inputs.")
        request = {"id": chosen["id"], **payload}
        try:
            current = workspace.job(chosen["id"])
        except StateError as error:
            if (getattr(error, "code", None) or str(error)) != "ANALYSIS_JOB_NOT_FOUND":
                raise
            current = None
        if current and current["status"] in {"FAILED", "INTERRUPTED", "CANCELLED"}:
            require(resume, phase + " needs its original continuation; run prepare with --resume. " +
                    str(current.get("error") or current["status"]))
            if kind != "workspace-export":
                chosen = {"id": self.identifier("job:" + phase + ":" + str(len(attempts))),
                          "kind": kind, "request_sha256": expected}
                attempts.append(chosen)
                self.save()
                request["id"] = chosen["id"]
        self.emit(phase, job_id=chosen["id"])
        current = workspace.start(kind, request)
        while current["status"] == "RUNNING":
            time.sleep(0.05)
            current = workspace.job(chosen["id"])
        require(current["status"] == "COMPLETE",
                phase + " stopped: " + str(current.get("error") or current["status"]))
        return current

    def completed(self):
        result = self.record.get("result")
        if not result:
            return None
        for item in result["files"]:
            path = self.directory / "delivery" / item["filename"]
            require(describe(path) == item, "A completed customer delivery file changed: " + item["filename"])
        return result

    def prepare(self, handover, core, *, prefix="worldbank", resume=False):
        import fcntl
        descriptor = os.open(self.directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            path = self.directory / "operation.json"
            if path.exists():
                self.record = json.loads(regular(path, MAX_DOCUMENT))
                require(self.record.get("operation_id") == self.operation_id and
                        self.record.get("schema") == SCHEMA,
                        "Continue the original selected Analysis operation.")
            return self._prepare(handover, core, prefix=prefix, resume=resume)
        finally:
            os.close(descriptor)

    def _prepare(self, handover, core, *, prefix="worldbank", resume=False):
        require(re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,20}", prefix) is not None,
                "Use a short Analysis name containing letters, digits and underscores.")
        core = Path(core).expanduser().resolve(strict=True)
        require(core.name == "core.py" and (core.parent / "source.py").is_file(),
                "Select the original World Bank core.py and its source.py sibling.")
        raw = regular(handover, MAX_PACKAGE)
        intent = {
            "schema": SCHEMA, "operation_id": self.operation_id,
            "handover": {"bytes": len(raw), "sha256": sha(raw)},
            "source_engine": {"core_sha256": sha(regular(core)),
                              "source_sha256": sha(regular(core.parent / "source.py"))},
            "prefix": prefix,
            "transform_sha256": sha(inspect.getsource(typed_rows).encode()),
        }
        write(self.directory / "intent.json", encoded(intent), exact=True)
        self._source_file = core.parent / "source.py"
        self._source_sha256 = intent["source_engine"]["source_sha256"]
        ready = self.completed()
        if ready:
            self.emit("COMPLETE", rows=ready["source"]["observations"], reused=True)
            return ready
        write(self.directory / "original-handover.zip", raw, exact=True)
        native = self.directory / "worldbank"
        capture_id, review_id, export_id = "analysis-source", "analysis-review", "analysis-edition"
        self.emit("SOURCE_REVIEW")
        state = core_call(core, native, "state")
        capture = next((r for r in state["captures"] if r["id"] == capture_id), None)
        reviewed = next((r for r in state["reviews"] if r["id"] == review_id), None)
        if not (capture and capture.get("status") == "COMPLETE" and reviewed and
                reviewed.get("captureId") == capture_id and
                reviewed.get("captureSha256") == capture.get("captureSha256")):
            imported = core_call(core, native, "import-package", {
                "id": capture_id, "reviewId": review_id, "selectionId": "analysis-selection",
                "archiveBase64": base64.b64encode(raw).decode()})
            require(imported["originalPackageSha256"] == intent["handover"]["sha256"],
                    "The native source importer selected another handover.")
            capture, reviewed = imported["capture"], imported["review"]
        exported = core_call(core, native, "export", {
            "id": export_id, "reviewId": review_id, "expectedRevision": reviewed["revision"]})
        export_root = Path(exported["directory"])
        regenerated = regular(export_root / "dataset.csv", MAX_DOCUMENT)
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            original = {name: archive.read(name) for name in (
                "dataset.csv", "dataset.json", "source.json", "review.json",
                "selection.json", "original/capture.json")}
        source = json.loads(original["source.json"])
        review = json.loads(original["review.json"])
        require(regenerated == original["dataset.csv"],
                "The reviewed source rows differ from the original customer CSV.")
        require(all(review.get(k) == reviewed.get(k) for k in REVIEW_FIELDS)
                and review["captureSha256"] == source["captureSha256"]
                and reviewed["captureSha256"] == capture["captureSha256"],
                "The retained receiving review differs from the original source review.")
        specification = json.loads(regular(export_root / "dataset.json"))
        columns, rows = typed_rows(regenerated, specification)
        require(len(rows) == review["includedObservations"] == source["observations"],
                "The original review, source and projected row counts differ.")
        require(len(rows) < 100_000, "Select fewer than 100,000 reviewed observations for this complete report.")
        projection = encoded({"observations": rows})
        require(len(projection) <= MAX_DOCUMENT,
                "The typed Analysis source exceeds the original 32 MiB JSON document capacity.")
        document = private_directory(self.directory / "source-document", create=True)

        def content(body, extension, mime):
            path = "files/" + sha(body) + "." + extension
            write(document / path, body, exact=True)
            return {"path": path, "bytes": len(body), "sha256": sha(body), "contentType": mime}

        original_files = [{**content(raw, "bin", "application/zip"), "role": "original-worldbank-handover"}]
        seen = {original_files[0]["path"]}
        for name, body in original.items():
            extension = "csv" if name.endswith(".csv") else "json"
            descriptor = content(body, extension, "text/csv" if extension == "csv" else "application/json")
            if descriptor["path"] not in seen:
                original_files.append({**descriptor, "role": "original-" + name.replace("/", "-")})
                seen.add(descriptor["path"])
        manifest = {
            "schema": "stellar-forge.analysis-source-document.v1",
            "title": review["title"][:200], "format": "json",
            "document": content(projection, "json", "application/json"),
            "originals": original_files,
            "provenance": {
                "kind": "public-source", "publisher": "World Bank",
                "sourceUrl": "https://api.worldbank.org/v2",
                "capturedAt": source["capturedAt"],
                "scope": ("Source " + source["sourceId"] + "; " + str(len(source["selection"]["countries"])) +
                          " countries; " + str(len(source["selection"]["indicators"])) +
                          " indicators; period " + source["selection"]["date"] +
                          ". Complete original selection retained in this document."),
                "description": "Reviewed original World Bank observations. " + review["note"],
                "transform": {
                    "name": "worldbank_analysis.typed_rows source function v1",
                    "sourceUrl": "https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python/stellar_forge_buyer/worldbank_analysis.py",
                    "sha256": intent["transform_sha256"],
                },
            },
            "complete": True,
        }
        write(document / "source.json", encoded(manifest), exact=True)
        name = prefix + "_" + self.operation_id[:12]
        selected_recipes = recipes(name, columns, rows)
        max_rows = max(1000, len(rows) + 1)
        self.record["adapter_sha256"] = sha(regular(Path(__file__), MAX_DOCUMENT))
        self.record["source"] = {
            "handover": intent["handover"], "observations": len(rows),
            "capture_sha256": source["captureSha256"], "selection": source["selection"],
            "captured_at": source["capturedAt"], "review_id": review["id"],
            "review_revision": review["revision"], "title": review["title"],
            "dataset_csv_sha256": sha(regenerated), "typed_source_sha256": sha(projection),
        }
        self.save()
        with self._workspace_session() as workspace:
            return self._prepare_analysis(workspace, document, name, source, review,
                rows, columns, selected_recipes, max_rows, resume=resume)


    def _prepare_analysis(self, workspace, document, name, source, review,
                          rows, columns, selected_recipes, max_rows, *, resume):
        registered = workspace.responses.register(name, "document", manifest=document / "source.json")
        preview = self.job(workspace, "SOURCE_PREVIEW", "response-preview", {
            "source": name, "source_revision": registered["revision"],
            "mapping": {"collection": "/observations", "sse_data": "text",
                        "columns": [{"name": c, "pointer": "/" + c, "type": "native", "missing": "error"}
                                    for c in columns]}}, resume=resume)
        imported = self.job(workspace, "SOURCE_IMPORT", "response-import", {
            "preview_id": preview["id"], "preview_sha256": preview["result"]["preview_sha256"],
            "allow_incomplete": False}, resume=resume)
        version = imported["result"]["version"]
        require(version["row_count"] == len(rows), "The retained Analysis table row count differs.")
        current = workspace.database.current(name)
        if current["version"] is not None:
            require(current["version"]["version_id"] == version["version_id"],
                    "The original Analysis view now selects another customer edition.")
        selected_view = workspace.database.activate(name, version["version_id"],
                                                    expected_revision=current["revision"])
        self.record["version_id"] = version["version_id"]
        self.record["view"] = {"name": name, "revision": selected_view["revision"]}
        query_records = []
        for recipe in selected_recipes:
            query_name = name + "_" + recipe["key"]
            fields = {"sql": recipe["sql"], "parameters_text": "[]", "max_rows": max_rows}
            if query_name in self.record["queries"]:
                saved = workspace.saved_query(query_name, revision=self.record["queries"][query_name])
                require(all(saved[k] == v for k, v in fields.items()),
                        "The retained query revision differs from its original source recipe.")
            else:
                try:
                    saved = workspace.saved_query(query_name)
                except StateError as error:
                    if (getattr(error, "code", None) or str(error)) != "ANALYSIS_QUERY_NOT_FOUND":
                        raise
                    saved = workspace.save_query(query_name, fields, expected_revision=0)
                require(all(saved[k] == v for k, v in fields.items()),
                        "An existing query name contains another customer recipe.")
                self.record["queries"][query_name] = saved["revision"]
                self.save()
            query_records.append(saved)
        report_name = name + "_report"
        report_definition = workspace.reports.save(report_name, {
            "id": self.identifier("report-definition"), "expected_revision": 0,
            "title": (review["title"] + " — Analysis")[:200],
            "introduction": "Original reviewed World Bank source " + source["sourceId"] +
                ". Source numeric text and period labels are retained. Derived calculations are identified in their sections.",
            "sections": [{"title": recipe["title"], "note": recipe["note"],
                          "query_name": saved["name"], "query_revision": saved["revision"],
                          "parameters_text": None}
                         for recipe, saved in zip(selected_recipes, query_records)]})
        definition = workspace.reports.definition(report_name, revision=report_definition["revision"])
        if "report_views" not in self.record:
            self.record["report_views"] = workspace.database.view_bindings()
            self.save()
        report = self.job(workspace, "REPORT", "report", {
            "name": report_name, "revision": report_definition["revision"],
            "definition_sha256": definition["sha256"],
            "expected_views": self.record["report_views"]}, resume=resume)
        if "publication_revision" not in self.record:
            self.record["publication_revision"] = definition["publication_revision"]
            self.save()
        publication = workspace.reports.publish(report["id"], {
            "id": self.identifier("report-publication"),
            "result_sha256": report["result"]["result_sha256"],
            "expected_revision": self.record["publication_revision"],
            "note": "Complete reviewed source and reproducible country/indicator analysis."})
        first_source = workspace.workbooks.source({"kind": "report", "id": publication["id"], "section": 0})
        publication_sha = first_source["sha256"]
        self.record["publication"] = {**publication, "sha256": publication_sha}
        self.save()
        sheets = []
        for index, recipe in enumerate(selected_recipes):
            selected = workspace.workbooks.source({"kind": "report", "id": publication["id"], "section": index})
            labels = selected["columns"]
            if labels and isinstance(labels[0], dict):
                labels = [c["name"] for c in labels]
            require(all(isinstance(c, str) for c in labels), "Use the original published report columns.")
            sheets.append({
                "name": recipe["sheet"],
                "source": {"kind": "report", "id": publication["id"],
                           "sha256": selected["sha256"], "section": index},
                "columns": [{"source": c, "source_index": i, "header": c,
                             "type": ("number" if c in {"annual_change_percent", "gdp_usd_per_person"} else
                                      "integer" if c in recipe["numeric"] else "text"),
                             "null": "blank" if c in recipe["numeric"] else "text",
                             "null_text": "NULL",
                             "precision": "excel-number" if c in {"annual_change_percent", "gdp_usd_per_person"} else "preserve"}
                            for i, c in enumerate(labels)],
            })
        workbook_name = name + "_workbook"
        workbook_definition = workspace.workbooks.save(workbook_name, {
            "id": self.identifier("workbook-definition"), "expected_revision": 0,
            "title": review["title"][:200], "notes": "Original source values are text. Counts and explicitly derived calculations are numeric. Missing source text is NULL; uncalculated numeric cells are blank.",
            "sheets": sheets})
        workbook = self.job(workspace, "WORKBOOK", "workbook", {
            "name": workbook_name, "revision": workbook_definition["revision"],
            "definition_sha256": workbook_definition["definition_sha256"]}, resume=resume)
        return self._deliver(workspace, source, review, len(rows), version, publication,
                             publication_sha, workbook, resume=resume)

    def _deliver(self, workspace, source, review, row_count, version, publication,
                 publication_sha, workbook, *, resume=False, extra_files=()):
        """Use the original complete delivery route for first and recurring editions."""
        destination = private_directory(self.directory / "delivery", create=True)

        def download(manager, job_id, source_name, output_name):
            with manager.download(job_id, source_name) as (stream, descriptor):
                data = stream.read()
            require(len(data) == descriptor["bytes"] and sha(data) == descriptor["sha256"],
                    "The original download differs from its declared complete file.")
            path = destination / output_name
            write(path, data, exact=True)
            return describe(path)

        files = [
            download(workspace.workbooks, workbook["id"], "workbook.xlsx", "WorldBank_Analysis.xlsx"),
            download(workspace.workbooks, workbook["id"], "handoff.zip", "WorldBank_Workbook_Handover.zip"),
        ]
        files.extend(extra_files)
        for format, filename in (("html", "WorldBank_Report.html"), ("json", "WorldBank_Report.json"),
                                 ("csv", "WorldBank_Report_Tables.zip")):
            report_export = self.job(workspace, "REPORT_" + format.upper(), "report-export", {
                "publication_id": publication["id"], "publication_sha256": publication_sha,
                "format": format}, resume=resume)
            path, descriptor = workspace.report_export_file(report_export["id"])
            body = regular(path, 1024 * 1024 * 1024)
            require(len(body) == descriptor["bytes"] and sha(body) == descriptor["sha256"],
                    "The original published report download changed.")
            write(destination / filename, body, exact=True)
            files.append(describe(destination / filename))
        availability = workspace.archives.review(include_previous_backups=False)
        require(availability["ready"], "Complete the retained Analysis outputs before workspace delivery: " +
                json.dumps(availability.get("missing", [])))
        archived = self.job(workspace, "WORKSPACE_ARCHIVE", "workspace-export", {
            "include_previous_backups": False}, resume=resume)
        files.append(download(workspace.archives, archived["id"], "workspace.zip", "WorldBank_Analysis_Workspace.zip"))
        files.append(download(workspace.archives, archived["id"], "archive-manifest.json", "WorldBank_Analysis_Workspace_Manifest.json"))
        guide = self.guide(source, review, publication, archived["result"])
        write(destination / "Open_and_use.md", guide.encode(), exact=True)
        files.append(describe(destination / "Open_and_use.md"))
        result = {
            "schema": SCHEMA, "operation_id": self.operation_id, "status": "COMPLETE",
            "source": self.record["source"], "version_id": version["version_id"],
            "view": self.record["view"], "report": self.record["publication"],
            "workbook": {"job_id": workbook["id"], "manifest_sha256": workbook["result"]["manifest_sha256"],
                         "rows": workbook["result"]["row_count"]},
            "workspace": {"id": archived["result"]["id"],
                          "workspace_id": archived["result"]["workspace_id"]},
            "files": files,
        }
        write(destination / "Analysis_Delivery.json", encoded(result), exact=True)
        files = [*files, describe(destination / "Analysis_Delivery.json")]
        bundle = destination / "WorldBank_Analysis_Delivery.zip"
        self.bundle(bundle, destination, files)
        result["files"] = [*files, describe(bundle)]
        self.record["result"] = result
        self.save()
        self.emit("COMPLETE", rows=row_count, files=len(result["files"]))
        return result

    def guide(self, source, review, publication, archived):
        fence = chr(96) * 3
        return """# World Bank Analysis

""" + review["title"] + """

Open **WorldBank_Report.html** for the complete published analysis, or
**WorldBank_Analysis.xlsx** for the Excel workbook. The workbook contains
reviewed observations, source coverage, consecutive annual changes and, when
both original series are present, GDP divided by population.

## Source and numeric values

The original World Bank handover and its reviewed CSV, source metadata, review
and capture are retained inside the Analysis source document. Original number
tokens and period labels remain text. Counts and derived calculations use numeric
cells; calculated percentages and ratios use SQLite floating point. Source
values remain alongside the calculations. Missing source text appears as NULL; uncalculated numeric cells are blank. Both
remain nullable in the Analysis database.

GDP uses the original current-US-dollar series. GDP per person is a derived ratio
and is distinct from purchasing-power-parity or constant-price measures.

## Continue in the original Analysis application

Install the existing Python workbook extra, then receive the complete workspace
into a new private directory:

""" + fence + """sh
stellar-forge-worldbank-analysis receive --archive /absolute/WorldBank_Analysis_Workspace.zip \\
  --sha256 <workspace-ZIP-SHA256-from-Analysis_Delivery.json> \\
  --workspace /absolute/private/worldbank-analysis \\
  --operation-id <stable-32-character-lowercase-hex-id>
stellar-forge-worldbank-analysis serve --workspace /absolute/private/worldbank-analysis
""" + fence + """

The command prints a private local browser URL. Open that URL to use the original
sources, typed tables, saved SQL recipes, report publication and workbook history.
The workbook ZIP can also be received independently through the existing
WorkbookDelivery API. Exact original publication, workbook and source hashes
are included in Analysis_Delivery.json.

Use the same receiving operation and archive hash to continue an interrupted
workspace delivery. A completed receive preserves subsequent customer edits.
For another approved edition of the same customer monitoring workbook, use the
recurring-review / recurring-refresh workflow with the same saved view, report
and workbook names. Use a separate prepare operation and view for an independent
analysis.

## Retained source edition

- Source: World Bank Indicators API V2; source """ + source["sourceId"] + """
- Original capture time: """ + source["capturedAt"] + """
- Reviewed observations: """ + str(source["observations"]) + """
- Original review: """ + review["id"] + " revision " + str(review["revision"]) + """
- Published report: """ + publication["id"] + """
- Analysis workspace: """ + archived["workspace_id"] + """
"""

    def bundle(self, path, directory, files):
        fd, temporary = tempfile.mkstemp(prefix=".worldbank-delivery-", dir=directory)
        os.close(fd)
        try:
            with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                for item in sorted(files, key=lambda row: row["filename"]):
                    body = regular(directory / item["filename"], 1024 * 1024 * 1024)
                    require(len(body) == item["bytes"] and sha(body) == item["sha256"],
                            "A selected customer delivery file changed during assembly.")
                    info = zipfile.ZipInfo(item["filename"], (1980, 1, 1, 0, 0, 0))
                    info.create_system = 3
                    info.external_attr = 0o100600 << 16
                    info.compress_type = zipfile.ZIP_DEFLATED
                    archive.writestr(info, body)
            write(path, regular(temporary, 1024 * 1024 * 1024), exact=True)
        finally:
            Path(temporary).unlink(missing_ok=True)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    prepare = commands.add_parser("prepare", help="Prepare the complete reviewed source, report, workbook and portable workspace")
    prepare.add_argument("--handover", required=True)
    prepare.add_argument("--worldbank-core", required=True, help="Original World Bank core.py beside its source.py")
    prepare.add_argument("--workspace", required=True)
    prepare.add_argument("--operation-id", help="Stable 32-character lowercase hexadecimal operation ID; defaults to the handover digest")
    prepare.add_argument("--prefix", default="worldbank")
    prepare.add_argument("--resume", action="store_true", help="Continue an interrupted original phase while retaining prior job results")
    receive = commands.add_parser("receive", help="Receive the complete portable Analysis workspace")
    receive.add_argument("--archive", required=True)
    receive.add_argument("--sha256", required=True)
    receive.add_argument("--workspace", required=True)
    receive.add_argument("--operation-id", required=True)
    launch = commands.add_parser("serve", help="Open the original private Analysis application")
    launch.add_argument("--workspace", required=True)
    launch.add_argument("--port", type=int, default=0)
    status = commands.add_parser("status", help="Read a retained World Bank Analysis delivery")
    status.add_argument("--workspace", required=True)
    status.add_argument("--operation-id", required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == "receive":
            from .workspace_archive_receive import restore_archive
            value = restore_archive(args.archive, args.workspace,
                                    operation=args.operation_id, expected_sha256=args.sha256)
        elif args.command == "serve":
            workspace = AnalysisWorkspace(args.workspace)
            server, control, url = serve(workspace, port=args.port)
            try:
                print(json.dumps({"url": url, "workspace_id": workspace.identity}), flush=True)
                server.serve_forever(poll_interval=0.2)
            finally:
                server.server_close()
                workspace.close()
                control.unlink(missing_ok=True)
            return 0
        else:
            operation = args.operation_id or sha(regular(args.handover))[:32]
            current = WorldBankAnalysis(args.workspace, operation_id=operation,
                progress=lambda event: print(json.dumps(event), flush=True))
            if args.command == "status":
                value = current.completed() or current.record
            else:
                value = current.prepare(args.handover, args.worldbank_core,
                                        prefix=args.prefix, resume=args.resume)
        print(json.dumps(value, ensure_ascii=False, allow_nan=False), flush=True)
        return 0
    except KeyboardInterrupt:
        return 130
    except (BuyerError, OSError, ValueError, KeyError, TypeError, zipfile.BadZipFile) as error:
        print(json.dumps({"schema": SCHEMA, "error": str(error)}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
