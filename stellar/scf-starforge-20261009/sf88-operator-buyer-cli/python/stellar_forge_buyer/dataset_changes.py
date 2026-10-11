"""Complete retained-edition review in the original customer analysis database."""
from __future__ import annotations

import csv
from datetime import datetime, timezone
import hashlib
import io
import json
import os
from pathlib import Path
import re
import sqlite3
import stat
import tempfile
import time

from .errors import StateError
from .sqlite_dataset import _identifier, _view_name
from .storage import digest, parse, private_directory, sync_directory

_ID = re.compile(r"[a-f0-9]{32}")
_HEX = re.compile(r"[a-f0-9]{64}")
_KINDS = ("added", "removed", "changed", "moved")
_MISSING = {"type": "missing", "text": ""}
_MAX_RECORD_BYTES = 128 * 1024 * 1024
_SCHEMA = "stellar-forge.customer-dataset-comparison.v1"


def _json(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True, separators=(",", ":"))


def _now():
    return datetime.now(timezone.utc).isoformat()


def _cell(value):
    if value is None:
        return {"type": "null", "text": ""}
    if type(value) is int:
        return {"type": "integer", "text": str(value)}
    if type(value) is float:
        return {"type": "number", "text": repr(value)}
    if isinstance(value, str):
        return {"type": "string", "text": value}
    raise StateError("DATASET_CHANGE_SQL_SCALAR_REQUIRED")


def _id(value):
    if not isinstance(value, str) or not _ID.fullmatch(value):
        raise StateError("DATASET_CHANGE_REQUEST_ID_REQUIRED")
    return value


def _view(db, name):
    row = db.execute("SELECT name,version_id,revision FROM sf_dataset_views WHERE name=?", (_view_name(name),)).fetchone()
    return dict(row) if row else None


class DatasetChanges:
    """One complete comparison, its exact review, and reproducible exports.

    SQL values use the original database's no-affinity representation. Original
    Boolean/number type declarations remain visible as separate source metadata.
    """

    def __init__(self, database):
        self.database = database
        # AnalysisWorkspace already holds its exclusive process lock. No export
        # worker is live at startup. Retire only our private incomplete exports,
        # including the extra temporary hardlink from an interrupted publish.
        directory = database.directory / "analysis-exports"
        if directory.exists() or directory.is_symlink():
            private_directory(directory, create=False)
            for path in directory.iterdir():
                if re.fullmatch(r"\.changes-[A-Za-z0-9_-]+", path.name):
                    info = path.lstat()
                    if stat.S_ISREG(info.st_mode) and not info.st_mode & 0o077:
                        path.unlink()
            sync_directory(directory)
        with database._connection() as db:
            db.executescript("""
CREATE TABLE IF NOT EXISTS sf_analysis_change_rows(
 job_id TEXT NOT NULL REFERENCES sf_analysis_jobs(id),ordinal INTEGER NOT NULL,
 kind TEXT NOT NULL,record TEXT NOT NULL,sha256 TEXT NOT NULL,
 PRIMARY KEY(job_id,ordinal));
CREATE INDEX IF NOT EXISTS sf_analysis_change_kind ON sf_analysis_change_rows(job_id,kind,ordinal);
CREATE TABLE IF NOT EXISTS sf_analysis_change_selections(
 id TEXT PRIMARY KEY,job_id TEXT UNIQUE NOT NULL REFERENCES sf_analysis_jobs(id),
 request_sha256 TEXT NOT NULL,record TEXT NOT NULL);
""")

    def prepare(self, request, *, check=True):
        name = _view_name(request.get("view"))
        revision = request.get("expected_revision")
        base, candidate = request.get("base_version_id"), request.get("candidate_version_id")
        if type(revision) is not int or revision < 1 or any(not isinstance(v, str) or not _HEX.fullmatch(v) for v in (base, candidate)):
            raise StateError("DATASET_CHANGE_REVIEWED_VERSIONS_REQUIRED")
        keys = request.get("keys")
        if not isinstance(keys, list) or not 1 <= len(keys) <= 16 or not all(isinstance(k, str) for k in keys) or len(set(keys)) != len(keys):
            raise StateError("DATASET_CHANGE_SELECT_ONE_TO_SIXTEEN_KEYS")
        spec = {"view": name, "expected_revision": revision, "base_version_id": base,
                "candidate_version_id": candidate, "keys": keys}
        if check:
            with self.database._connection(readonly=True) as db:
                db.execute("BEGIN")
                self._inputs(db, spec)
        return spec

    def _inputs(self, db, spec):
        current = _view(db, spec["view"])
        if current is None or current["version_id"] != spec["base_version_id"] or current["revision"] != spec["expected_revision"]:
            raise StateError("DATASET_CHANGE_CURRENT_VIEW_CHANGED")
        versions = [self.database._version(db, spec[key]) for key in ("base_version_id", "candidate_version_id")]
        for version in versions:
            manifest = db.execute("SELECT manifest FROM sf_dataset_versions WHERE version_id=?", (version["version_id"],)).fetchone()[0]
            if digest(manifest) != version["manifestSha256"]:
                raise StateError("DATASET_SQL_RETAINED_MANIFEST_CHANGED")
            columns = [item["column"] for item in version["column_types"]]
            if any(key not in columns for key in spec["keys"]):
                raise StateError("DATASET_CHANGE_KEYS_MUST_EXIST_IN_BOTH_VERSIONS")
        return current, *versions

    def run(self, job_id, spec):
        """Complete every row or roll the entire report back; never sample."""
        _id(job_id)
        deadline = time.monotonic() + 120
        with self.database._connection() as db:
            db.execute("PRAGMA temp_store=FILE")
            db.execute("PRAGMA temp.cache_size=-4096")
            db.execute("BEGIN IMMEDIATE")
            db.set_progress_handler(lambda: int(time.monotonic() > deadline), 10000)
            try:
                current, baseline, candidate = self._inputs(db, spec)
                before_columns = [c["column"] for c in baseline["column_types"]]
                after_columns = [c["column"] for c in candidate["column_types"]]
                columns = before_columns + [c for c in after_columns if c not in before_columns]
                for side, version in (("before", baseline), ("after", candidate)):
                    temp = "sf_change_" + side
                    db.execute(f"CREATE TEMP TABLE {temp}(key TEXT PRIMARY KEY COLLATE BINARY,row_number INTEGER NOT NULL) WITHOUT ROWID")
                    select = ",".join(_identifier(c) for c in [version["row_order_column"], *spec["keys"]])
                    scanned = 0
                    for row in db.execute(f"SELECT {select} FROM {_identifier(version['table'])} ORDER BY {_identifier(version['row_order_column'])}"):
                        if time.monotonic() > deadline:
                            raise StateError("DATASET_CHANGE_DEADLINE_EXCEEDED")
                        scanned += 1
                        if any(v is None for v in tuple(row)[1:]):
                            raise StateError("DATASET_CHANGE_NULL_KEY:" + side + ":row=" + str(row[0]))
                        key = _json([_cell(v) for v in tuple(row)[1:]])
                        try:
                            db.execute(f"INSERT INTO {temp} VALUES(?,?)", (key, row[0]))
                        except sqlite3.IntegrityError:
                            raise StateError("DATASET_CHANGE_DUPLICATE_KEY:" + side + ":row=" + str(row[0])) from None
                    if scanned != version["row_count"]:
                        raise StateError("DATASET_CHANGE_RETAINED_ROW_COUNT_CHANGED")
                cursor = db.execute("""SELECT * FROM (
 SELECT b.key AS key,b.row_number AS before_number,a.row_number AS after_number
 FROM sf_change_before b LEFT JOIN sf_change_after a ON a.key=b.key
 UNION ALL
 SELECT a.key,NULL,a.row_number FROM sf_change_after a
 LEFT JOIN sf_change_before b ON b.key=a.key WHERE b.key IS NULL
) ORDER BY key COLLATE BINARY""")
                counts = {key: 0 for key in (*_KINDS, "unchanged")}
                fields = {column: 0 for column in columns}
                row_digest, before_digest, after_digest = (hashlib.sha256() for _ in range(3))
                ordinal = payload_bytes = positions_changed = 0
                for joined in cursor:
                    if time.monotonic() > deadline:
                        raise StateError("DATASET_CHANGE_DEADLINE_EXCEEDED")
                    values = []
                    for version, names, number, observed in (
                        (baseline, before_columns, joined["before_number"], before_digest),
                        (candidate, after_columns, joined["after_number"], after_digest)):
                        if number is None:
                            values.append(None)
                            continue
                        source = db.execute(f"SELECT " + ",".join(_identifier(c) for c in names) +
                            f" FROM {_identifier(version['table'])} WHERE {_identifier(version['row_order_column'])}=?", (number,)).fetchone()
                        if source is None:
                            raise StateError("DATASET_CHANGE_RETAINED_ROW_MISSING")
                        mapped = dict(zip(names, [_cell(v) for v in source]))
                        cells = [mapped.get(c, _MISSING) for c in columns]
                        observed.update((_json({"key": joined["key"], "row_number": number, "values": cells}) + "\n").encode())
                        values.append(cells)
                    before, after = values
                    changed = [columns[i] for i in range(len(columns)) if before is None or after is None or before[i] != after[i]]
                    moved = before is not None and after is not None and joined["before_number"] != joined["after_number"]
                    positions_changed += int(moved)
                    kind = "added" if before is None else "removed" if after is None else "changed" if changed else "moved" if moved else "unchanged"
                    counts[kind] += 1
                    if kind == "unchanged":
                        continue
                    for column in changed:
                        fields[column] += 1
                    ordinal += 1
                    record = {"ordinal": ordinal, "kind": kind, "key": parse(joined["key"].encode()),
                        "before_row_number": joined["before_number"], "after_row_number": joined["after_number"],
                        "before": before, "after": after, "changed_columns": changed}
                    raw = _json(record)
                    encoded = (raw + "\n").encode()
                    payload_bytes += len(encoded)
                    if payload_bytes > _MAX_RECORD_BYTES:
                        raise StateError("DATASET_CHANGE_REPORT_EXCEEDS_128_MIB")
                    row_digest.update(encoded)
                    db.execute("INSERT INTO sf_analysis_change_rows VALUES(?,?,?,?,?)", (job_id, ordinal, kind, raw, digest(raw.encode())))
                before_types = {c["column"]:c["json_types"] for c in baseline["column_types"]}
                after_types = {c["column"]:c["json_types"] for c in candidate["column_types"]}
                report = {"schema": _SCHEMA, "id": job_id, "completed_at": _now(), "complete": True,
                    "reviewed_view": current, "keys": spec["keys"], "columns": columns,
                    "baseline": baseline, "candidate": candidate, "counts": counts, "positions_changed": positions_changed,
                    "field_changes": fields, "schema_changes": {"added": [c for c in after_columns if c not in before_columns],
                        "removed": [c for c in before_columns if c not in after_columns],
                        "original_json_types": [{"column": c, "before": before_types[c], "after": after_types[c]} for c in before_columns if c in after_types and before_types[c] != after_types[c]]},
                    "changed_rows": ordinal, "record_bytes": payload_bytes, "rows_sha256": row_digest.hexdigest(),
                    "baseline_observation_sha256": before_digest.hexdigest(), "candidate_observation_sha256": after_digest.hexdigest(),
                    "value_basis": "original SQLite scalars; original JSON type declarations retained separately"}
                report["result_sha256"] = digest(_json(report).encode())
                updated = db.execute("UPDATE sf_analysis_jobs SET status='COMPLETE',result=?,finished_at=? WHERE id=? AND kind='compare' AND status='RUNNING'",
                    (_json(report), report["completed_at"], job_id)).rowcount
                if updated != 1:
                    raise StateError("DATASET_CHANGE_JOB_NOT_RUNNING")
                db.commit()
                return report
            except BaseException as exc:
                db.set_progress_handler(None, 0)
                db.rollback()
                if isinstance(exc, sqlite3.OperationalError) and time.monotonic() > deadline:
                    raise StateError("DATASET_CHANGE_DEADLINE_EXCEEDED") from exc
                raise
            finally:
                db.set_progress_handler(None, 0)

    @staticmethod
    def _report(db, job_id):
        row = db.execute("SELECT status,result FROM sf_analysis_jobs WHERE id=? AND kind='compare'", (_id(job_id),)).fetchone()
        if row is None or row["status"] != "COMPLETE" or row["result"] is None:
            raise StateError("DATASET_CHANGE_COMPLETE_REPORT_REQUIRED")
        result = parse(row["result"].encode())
        if result.get("result_sha256") != digest(_json({k:v for k,v in result.items() if k != "result_sha256"}).encode()):
            raise StateError("DATASET_CHANGE_RETAINED_REPORT_CHANGED")
        return result

    @staticmethod
    def _selection(db, job_id):
        row = db.execute("SELECT record FROM sf_analysis_change_selections WHERE job_id=?", (job_id,)).fetchone()
        return parse(row[0].encode()) if row else None

    @staticmethod
    def _record(row):
        if digest(row["record"].encode()) != row["sha256"]:
            raise StateError("DATASET_CHANGE_RETAINED_ROW_CHANGED")
        return parse(row["record"].encode())

    def history(self, *, before=None, limit=25):
        if type(limit) is not int or not 1 <= limit <= 100 or before is not None and (type(before) is not int or before < 1):
            raise StateError("DATASET_CHANGE_HISTORY_PAGE_INVALID")
        with self.database._connection(readonly=True) as db:
            rows = db.execute("SELECT sequence,id,status,created_at,finished_at,error,result FROM sf_analysis_jobs WHERE kind='compare' AND (? IS NULL OR sequence<?) ORDER BY sequence DESC LIMIT ?", (before,before,limit+1)).fetchall()
        values=[]
        for row in rows[:limit]:
            item=dict(row);report=parse(item.pop("result").encode()) if row["result"] else None
            item.update(view=report["reviewed_view"]["name"] if report else None, counts=report["counts"] if report else None)
            values.append(item)
        return {"comparisons":values,"next_before":rows[limit-1]["sequence"] if len(rows)>limit else None}

    def page(self, job_id, *, kind="all", after=0, limit=50):
        if kind not in ("all", *_KINDS) or type(after) is not int or after < 0 or type(limit) is not int or not 1 <= limit <= 100:
            raise StateError("DATASET_CHANGE_PAGE_INVALID")
        with self.database._connection(readonly=True) as db:
            db.execute("BEGIN")
            report=self._report(db,job_id)
            cursor=db.execute("SELECT * FROM sf_analysis_change_rows WHERE job_id=? AND ordinal>? AND (?='all' OR kind=?) ORDER BY ordinal LIMIT ?", (job_id,after,kind,kind,limit+1))
            rows=[];page_bytes=0;more=False
            for row in cursor:
                size=len(row["record"].encode())
                if rows and (len(rows)==limit or page_bytes+size>4*1024*1024):
                    more=True;break
                rows.append(row);page_bytes+=size
            selection = self._selection(db,job_id)
            return {"report":report,"selection":selection,"selection_sha256":digest(_json(selection).encode()),"current_view":_view(db,report["reviewed_view"]["name"]),
                "kind":kind,"after":after,"rows":[self._record(row) for row in rows],
                "next_after":rows[-1]["ordinal"] if more else None}

    def select(self, job_id, request):
        key=_id(request.get("id"));note=request.get("note", "")
        if not isinstance(note,str) or len(note.encode())>8000:
            raise StateError("DATASET_CHANGE_REVIEW_NOTE_INVALID")
        spec={"id":key,"comparison_id":_id(job_id),"result_sha256":request.get("result_sha256"),"note":note}
        request_sha=digest(_json(spec).encode())
        with self.database._connection() as db:
            db.execute("BEGIN IMMEDIATE")
            old=db.execute("SELECT request_sha256,record FROM sf_analysis_change_selections WHERE id=?", (key,)).fetchone()
            if old:
                if old["request_sha256"]!=request_sha:
                    raise StateError("DATASET_CHANGE_REVIEW_ID_REUSED")
                return parse(old["record"].encode())
            report=self._report(db,job_id)
            if report["result_sha256"]!=spec["result_sha256"]:
                raise StateError("DATASET_CHANGE_REVIEWED_REPORT_CHANGED")
            if self._selection(db,job_id):
                raise StateError("DATASET_CHANGE_REPORT_ALREADY_SELECTED")
            self._verify_rows(db,report)
            activation=self.database._activate(db,report["reviewed_view"]["name"],report["candidate"]["version_id"],expected_revision=report["reviewed_view"]["revision"])
            record={**spec,"selected_at":_now(),"activation":activation,"previous_view":report["reviewed_view"]}
            db.execute("INSERT INTO sf_analysis_change_selections VALUES(?,?,?,?)", (key,job_id,request_sha,_json(record)))
            db.commit()
            return record

    def _verify_rows(self, db, report):
        observed=hashlib.sha256();count=0
        for row in db.execute("SELECT * FROM sf_analysis_change_rows WHERE job_id=? ORDER BY ordinal", (report["id"],)):
            self._record(row);count+=1
            if row["ordinal"]!=count:
                raise StateError("DATASET_CHANGE_RETAINED_ROW_MISSING")
            observed.update((row["record"]+"\n").encode())
        if count!=report["changed_rows"] or observed.hexdigest()!=report["rows_sha256"]:
            raise StateError("DATASET_CHANGE_RETAINED_ROWS_CHANGED")

    def prepare_export(self, request, *, check=True):
        if request.get("format") not in ("json", "csv"):
            raise StateError("DATASET_CHANGE_EXPORT_FORMAT_INVALID")
        spec={"comparison_id":_id(request.get("comparison_id")),"result_sha256":request.get("result_sha256"),
              "format":request["format"],"selection_sha256":request.get("selection_sha256")}
        if any(not isinstance(spec[k],str) or not _HEX.fullmatch(spec[k]) for k in ("result_sha256","selection_sha256")):
            raise StateError("DATASET_CHANGE_EXACT_REPORT_AND_REVIEW_REQUIRED")
        if check:
            with self.database._connection(readonly=True) as db:
                db.execute("BEGIN")
                self._export_input(db,spec)
        return spec

    def _export_input(self, db, spec):
        report=self._report(db,spec["comparison_id"])
        selection=self._selection(db,report["id"])
        if report["result_sha256"]!=spec["result_sha256"] or digest(_json(selection).encode())!=spec["selection_sha256"]:
            raise StateError("DATASET_CHANGE_EXPORT_REVIEW_CHANGED")
        return report,selection

    def _export_blocks(self, db, report, selection, format):
        if format=="json":
            yield ('{"schema":"'+_SCHEMA+'","report":'+_json(report)+',"selection":'+_json(selection)+',"changes":[').encode()
            first=True
            for row in db.execute("SELECT * FROM sf_analysis_change_rows WHERE job_id=? ORDER BY ordinal", (report["id"],)):
                self._record(row)
                yield (("" if first else ",")+row["record"]).encode();first=False
            yield b"]}\n"
        else:
            stream=io.StringIO(newline="");writer=csv.writer(stream)
            def line(values):
                stream.seek(0);stream.truncate();writer.writerow(values);return stream.getvalue().encode()
            identity=[report["id"],report["result_sha256"],report["baseline"]["version_id"],report["baseline"]["manifestSha256"],
                      report["candidate"]["version_id"],report["candidate"]["manifestSha256"],selection["id"] if selection else "",
                      digest(_json(selection).encode()),report["reviewed_view"]["name"],report["reviewed_view"]["revision"],
                      selection["activation"]["revision"] if selection else ""]
            yield line(["record_type","comparison_id","result_sha256","baseline_version_id","baseline_manifest_sha256",
                        "candidate_version_id","candidate_manifest_sha256","selection_id","selection_sha256","view_name","reviewed_view_revision","selected_view_revision",
                        "change","key_json","before_row_number","after_row_number","column","before_type","before_value","after_type","after_value","scope_json"])
            scope={"schema":_SCHEMA,"baseline":report["baseline"]["dataset"],"candidate":report["candidate"]["dataset"],
                   "counts":report["counts"],"schema_changes":report["schema_changes"],"keys":report["keys"],
                   "rows_sha256":report["rows_sha256"],"selection":selection,"value_basis":report["value_basis"]}
            # An unchanged comparison still exports its complete source identity.
            yield line(["comparison",*identity,*([""]*9),_json(scope)])
            for row in db.execute("SELECT * FROM sf_analysis_change_rows WHERE job_id=? ORDER BY ordinal", (report["id"],)):
                record=self._record(row)
                indices=[report["columns"].index(c) for c in record["changed_columns"]]
                if record["kind"]=="moved":
                    yield line(["difference",*identity,record["kind"],_json(record["key"]),record["before_row_number"],record["after_row_number"],"_sf_row_number","integer",record["before_row_number"],"integer",record["after_row_number"],""])
                for i in indices:
                    before=record["before"][i] if record["before"] is not None else _MISSING
                    after=record["after"][i] if record["after"] is not None else _MISSING
                    yield line(["difference",*identity,record["kind"],_json(record["key"]),record["before_row_number"],record["after_row_number"],report["columns"][i],before["type"],before["text"],after["type"],after["text"],""])

    def export(self, spec):
        directory=private_directory(self.database.directory/"analysis-exports")
        identity=digest(_json({"schema":_SCHEMA,**spec}).encode())
        destination=directory/("changes-"+identity+"."+spec["format"])
        temporary=None;existing=None;target=None;reused=False
        try:
            if destination.exists() or destination.is_symlink():
                fd=os.open(destination,os.O_RDONLY|os.O_NOFOLLOW)
                info=os.fstat(fd)
                if not stat.S_ISREG(info.st_mode) or info.st_mode&0o077 or info.st_nlink!=1:
                    os.close(fd);raise StateError("DATASET_CHANGE_PRIVATE_EXPORT_REQUIRED")
                existing=os.fdopen(fd,"rb")
                reused=True
            else:
                fd,temporary=tempfile.mkstemp(prefix=".changes-",dir=directory)
                target=os.fdopen(fd,"wb")
            observed=hashlib.sha256();size=0
            with self.database._connection(readonly=True) as db:
                db.execute("BEGIN")
                report,selection=self._export_input(db,spec)
                self._verify_rows(db,report)
                for block in self._export_blocks(db,report,selection,spec["format"]):
                    observed.update(block);size+=len(block)
                    if existing:
                        if existing.read(len(block))!=block:
                            raise StateError("DATASET_CHANGE_RETAINED_EXPORT_CHANGED")
                    else:
                        target.write(block)
                if existing:
                    if existing.read(1):
                        raise StateError("DATASET_CHANGE_RETAINED_EXPORT_CHANGED")
                else:
                    target.flush();os.fsync(target.fileno());target.close();target=None
            if temporary is not None:
                try:
                    os.link(temporary,destination)
                except FileExistsError:
                    fd=os.open(destination,os.O_RDONLY|os.O_NOFOLLOW)
                    with os.fdopen(fd,"rb") as other:
                        info=os.fstat(other.fileno())
                        if not stat.S_ISREG(info.st_mode) or info.st_mode&0o077 or info.st_nlink!=1 or info.st_size!=size or hashlib.file_digest(other,"sha256").hexdigest()!=observed.hexdigest():
                            raise StateError("DATASET_CHANGE_RETAINED_EXPORT_CHANGED")
                    reused=True
                Path(temporary).unlink()
                temporary=None
                sync_directory(directory)
            return {"path":str(destination),"bytes":size,"sha256":observed.hexdigest(),"filename":destination.name,
                "mime":"application/json" if spec["format"]=="json" else "text/csv;charset=utf-8",
                "comparison_id":report["id"],"result_sha256":report["result_sha256"],"selection_sha256":spec["selection_sha256"],"reused":reused}
        finally:
            if target:target.close()
            if existing:existing.close()
            if temporary is not None:
                Path(temporary).unlink(missing_ok=True)
