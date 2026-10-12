"""A local review workspace over the original retained public-source readers."""
from __future__ import annotations

from collections import Counter, defaultdict
from contextlib import contextmanager, nullcontext
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import signal
import threading

_ACTIVE = set()
_ACTIVE_LOCK = threading.Lock()

def stop_process(child):
    if child.poll() is None:
        try:
            os.killpg(child.pid, signal.SIGTERM) if os.name == 'posix' else child.terminate()
            child.wait(timeout=2)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGKILL) if os.name == 'posix' else child.kill()
            child.wait(timeout=2)
        except ProcessLookupError:
            pass

def close_active_intakes():
    with _ACTIVE_LOCK:
        children = list(_ACTIVE)
    for child in children:
        stop_process(child)


from model import (
    ROOT, SDK, SCHEMA, StudyError, clone, dump, encoded, fail, hash_id, identity, integer,
    lock, member, now, parse, private_directory, read, sync_directory, text,
    validate_mapping, validate_portfolio,
)
from semantics import canonical, comparison_key, difference

DDL = """
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY,body TEXT NOT NULL,created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS source_rows(
 source_id TEXT NOT NULL,row_id TEXT NOT NULL,family TEXT NOT NULL,geo TEXT NOT NULL,
 vintage TEXT NOT NULL,measure TEXT NOT NULL,unit TEXT NOT NULL,basis TEXT NOT NULL,name TEXT NOT NULL,
 body TEXT NOT NULL,PRIMARY KEY(source_id,row_id),FOREIGN KEY(source_id) REFERENCES sources(id));
CREATE INDEX IF NOT EXISTS source_scope ON source_rows(family,geo,vintage,measure);
CREATE TABLE IF NOT EXISTS revisions(id TEXT PRIMARY KEY,kind TEXT NOT NULL,body TEXT NOT NULL,created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS editions(id TEXT PRIMARY KEY,body TEXT NOT NULL,created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS edition_rows(edition_id TEXT NOT NULL,row_id TEXT NOT NULL,source_id TEXT NOT NULL,
 export_key TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(edition_id,row_id),
 FOREIGN KEY(edition_id) REFERENCES editions(id));
CREATE TABLE IF NOT EXISTS comparisons(id TEXT PRIMARY KEY,body TEXT NOT NULL,review_version INTEGER NOT NULL DEFAULT 0,created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS differences(comparison_id TEXT NOT NULL,key TEXT NOT NULL,kind TEXT NOT NULL,
 body TEXT NOT NULL,PRIMARY KEY(comparison_id,key),FOREIGN KEY(comparison_id) REFERENCES comparisons(id));
CREATE TABLE IF NOT EXISTS decisions(comparison_id TEXT NOT NULL,key TEXT NOT NULL,action TEXT NOT NULL,
 body TEXT NOT NULL,PRIMARY KEY(comparison_id,key),FOREIGN KEY(comparison_id,key) REFERENCES differences(comparison_id,key));
CREATE TABLE IF NOT EXISTS acquisitions(id TEXT PRIMARY KEY,source_id TEXT NOT NULL,body TEXT NOT NULL,created TEXT NOT NULL,FOREIGN KEY(source_id) REFERENCES sources(id));
CREATE TABLE IF NOT EXISTS exports(id TEXT PRIMARY KEY,body TEXT NOT NULL,created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT,time TEXT NOT NULL,operation TEXT NOT NULL,reference TEXT NOT NULL,body TEXT NOT NULL);
"""


def unpack(value):
    return parse(value.encode("utf-8"))


def file_identity(path):
    import hashlib
    import stat
    handle = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(handle, "rb") as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_mode & 0o077:
            fail("PRIVATE_REGULAR_MEMBER_REQUIRED", path=str(path))
        size, digest = 0, hashlib.sha256()
        while raw := stream.read(65536):
            size += len(raw)
            digest.update(raw)
        after = os.fstat(stream.fileno())
    if (before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (after.st_size, after.st_mtime_ns, after.st_ctime_ns):
        fail("MEMBER_CHANGED_DURING_READ", path=str(path))
    return {"bytes": size, "sha256": digest.hexdigest()}


def verify_source(directory, descriptor=None):
    directory = Path(directory).resolve()
    descriptor = descriptor or parse(read(directory / "descriptor.json", 16 * 1024 * 1024))
    if descriptor.get("schema") != "stellar-forge.study-retained-source.v1":
        fail("RETAINED_SOURCE_DESCRIPTOR_REQUIRED")
    expected = {}
    for item in descriptor["files"]:
        name = member(item["path"])
        if name in expected or name == "descriptor.json":
            fail("DUPLICATE_RETAINED_MEMBER")
        path = directory / name
        if path.resolve(strict=True) != path or file_identity(path) != {k: item[k] for k in ("bytes", "sha256")}:
            fail("RETAINED_SOURCE_MEMBER_CHANGED", path=name)
        expected[name] = item
    actual = {str(path.relative_to(directory)) for path in directory.rglob("*") if not path.is_dir()}
    if actual != set(expected) | {"descriptor.json"}:
        fail("RETAINED_SOURCE_INVENTORY_CHANGED")
    for projection in descriptor["projections"]:
        item = expected.get(projection["path"])
        if item is None or any(item[k] != projection[k] for k in ("bytes", "sha256")):
            fail("PROJECTION_INVENTORY_CHANGED")
    return descriptor


def source_identity(descriptor):
    return identity({key: descriptor[key] for key in ("provider", "capture_id", "source_sha256", "files")})


class Workspace:
    def __init__(self, directory):
        self.directory = private_directory(Path(directory).expanduser())
        self.database = self.directory / "workspace.sqlite3"
        fresh = not self.database.exists()
        if not fresh and self.database.stat().st_mode & 0o077:
            fail("PRIVATE_WORKSPACE_DATABASE_REQUIRED")
        self.connection = sqlite3.connect(self.database, timeout=15, isolation_level=None)
        if fresh:
            os.chmod(self.database, 0o600)
        self.connection.row_factory = sqlite3.Row
        self.connection.execute("PRAGMA foreign_keys=ON")
        self.connection.execute("PRAGMA trusted_schema=OFF")
        if fresh:
            self.connection.executescript(DDL)
            self.connection.execute("INSERT INTO meta VALUES('schema',?)", (SCHEMA,))
        if self.connection.execute("SELECT value FROM meta WHERE key='schema'").fetchone()[0] != SCHEMA:
            fail("WORKSPACE_SCHEMA_MISMATCH")
        private_directory(self.directory / "sources")

    def close(self):
        self.connection.close()

    @contextmanager
    def mutation(self, *, locked=False):
        with (nullcontext() if locked else lock(self.directory)):
            self.connection.execute("BEGIN IMMEDIATE")
            try:
                yield self.connection
                self.connection.execute("COMMIT")
            except BaseException:
                self.connection.execute("ROLLBACK")
                raise

    def event(self, operation, reference, body):
        self.connection.execute("INSERT INTO events(time,operation,reference,body) VALUES(?,?,?,?)",
                                (now(), operation, reference, encoded(body).decode()))

    def record(self, table, record_id):
        if table not in ("sources", "revisions", "editions", "comparisons", "exports", "acquisitions"):
            fail("RECORD_KIND_INVALID")
        row = self.connection.execute("SELECT body FROM " + table + " WHERE id=?", (hash_id(record_id),)).fetchone()
        if not row:
            fail("RECORD_NOT_FOUND", kind=table, id=record_id)
        return unpack(row["body"])

    def overview(self):
        result = {"schema": SCHEMA, "workspace": str(self.directory), "checkout": str(SDK.parent.parent.parent)}
        for table in ("sources", "revisions", "editions", "comparisons", "exports"):
            result[table] = [dict(unpack(row["body"]), id=row["id"], created=row["created"])
                             for row in self.connection.execute("SELECT id,body,created FROM " + table + " ORDER BY created DESC")]
        result["events"] = [dict(row, body=unpack(row["body"])) for row in
                            self.connection.execute("SELECT * FROM events ORDER BY id DESC LIMIT 50")]
        return result

    def import_source(self, provider, source, *, node=None, acquisition=None, expected_input_sha256=None):
        if expected_input_sha256 is not None:
            hash_id(expected_input_sha256)
        with lock(self.directory):
            return self._import_source(provider, source, node=node, acquisition=acquisition,
                                       expected_input_sha256=expected_input_sha256)

    def _import_source(self, provider, source, *, node=None, acquisition=None, expected_input_sha256=None):
        if provider not in ("acs", "acs_api", "bls", "hud"):
            fail("SOURCE_PROVIDER_INVALID")
        executable = node or os.environ.get("CODEX_PRIMARY_RUNTIME_NODE", "node")
        staging_root = Path(tempfile.mkdtemp(prefix=".intake-", dir=self.directory))
        target = staging_root / "source"
        try:
            # The public source contract selects only these installed original readers.
            command = ([sys.executable, str(ROOT / "census_api.py"),
                        str(Path(source).expanduser().resolve()), str(target)] if provider == "acs_api" else
                       [executable, str(ROOT / "provider-bridge.mjs"), provider,
                        str(Path(source).expanduser().resolve()), str(target)])
            child = subprocess.Popen(command,
                                     stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                     start_new_session=os.name == "posix",
                                     env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"})
            with _ACTIVE_LOCK:
                _ACTIVE.add(child)
            try:
                stdout, stderr = child.communicate(timeout=3650)
            finally:
                stop_process(child)
                with _ACTIVE_LOCK:
                    _ACTIVE.discard(child)
            if child.returncode:
                detail = stderr.decode("utf-8", errors="replace")[-8192:]
                fail("ORIGINAL_PROVIDER_INTAKE_FAILED", detail=detail, exit_code=child.returncode)
            descriptor = verify_source(target)
            if (expected_input_sha256 is not None
                    and descriptor.get("source_sha256") != expected_input_sha256):
                fail("SOURCE_INPUT_CHANGED", expected_sha256=expected_input_sha256,
                     actual_sha256=descriptor.get("source_sha256"))
            sid = source_identity(descriptor)
            body = {"schema": "stellar-forge.study-source.v1", "descriptor": descriptor,
                    "provider": provider, "capture_id": descriptor["capture_id"],
                    "label": descriptor["release_label"], "rows": sum(p["rows"] for p in descriptor["projections"]),
                    "acquisition": acquisition}
            destination = self.directory / "sources" / sid
            with self.mutation(locked=True):
                if self.connection.execute("SELECT 1 FROM sources WHERE id=?", (sid,)).fetchone():
                    verify_source(destination, self.record("sources", sid)["descriptor"])
                    return {"id": sid, "reopened": True, **self.record("sources", sid)}
                if destination.exists():
                    prior = verify_source(destination)
                    if source_identity(prior) != sid:
                        fail("SOURCE_DESTINATION_CONFLICT")
                    # An earlier interrupted metadata commit left the complete original capture.
                    descriptor = prior
                    body["descriptor"] = descriptor
                else:
                    os.rename(target, destination)
                    sync_directory(destination.parent)
                self.connection.execute("INSERT INTO sources VALUES(?,?,?)", (sid, encoded(body).decode(), now()))
                inventory = {item["path"]: item for item in descriptor["files"]}
                for projection in descriptor["projections"]:
                    family = {"acs": "acs", "acs_api": "acs", "hud": "hud_income_limits"}.get(provider, projection["query"])
                    count = 0
                    with (destination / projection["path"]).open("rb") as rows:
                        for line, raw in enumerate(rows, 1):
                            if len(raw) > 4_194_304 or not raw.endswith(b"\n"):
                                fail("NATIVE_PROJECTION_ROW_INVALID")
                            observation = canonical(family, parse(raw), descriptor, projection["query"], line)
                            original = inventory.get("capture/" + str(observation["source_locator"]["file"]))
                            if original is None or original["sha256"] != observation["source_hash"]:
                                fail("NATIVE_SOURCE_LOCATOR_UNRESOLVED", projection=projection["query"], line=line)
                            self.connection.execute("INSERT INTO source_rows VALUES(?,?,?,?,?,?,?,?,?,?)", (
                                sid, observation["row_id"], family, observation["source_geography_id"],
                                observation["geography_vintage"], observation["source_measure_id"], observation["unit"],
                                observation["geography_basis"], observation["geography_name"], encoded(observation).decode()))
                            count += 1
                    if count != projection["rows"]:
                        fail("NATIVE_PROJECTION_COUNT_CHANGED")
                self.event("source.import", sid, {"provider": provider, "capture_id": body["capture_id"], "rows": body["rows"]})
            return {"id": sid, "reopened": False, **body}
        finally:
            shutil.rmtree(staging_root)

    def catalog(self, source_ids=None, *, search="", offset=0, limit=100):
        integer(offset, "offset")
        integer(limit, "limit", 1, 500)
        text(search, "search", empty=True, maximum=200)
        ids = source_ids or [row[0] for row in self.connection.execute("SELECT id FROM sources")]
        for sid in ids:
            self.record("sources", sid)
        if not ids:
            return {"geographies": [], "measures": [], "next": None, "total": 0}
        clause = "source_id IN (" + ",".join("?" for _ in ids) + ")"
        parameters = [*ids, "%" + search + "%", "%" + search + "%"]
        where = clause + " AND (geo LIKE ? OR name LIKE ?)"
        query = "SELECT family,geo AS source_geography_id,vintage AS source_geography_vintage,basis AS geography_basis,name AS display_name,count(*) AS rows FROM source_rows WHERE " + where + " GROUP BY family,geo,vintage,basis,name"
        total = self.connection.execute("SELECT COUNT(*) FROM (" + query + ")", parameters).fetchone()[0]
        geographies = [dict(row) for row in self.connection.execute(query + " ORDER BY family,geo,vintage LIMIT ? OFFSET ?", [*parameters, limit, offset])]
        measures = [dict(row) for row in self.connection.execute(
            "SELECT family,measure AS measure_id,unit,count(*) AS rows FROM source_rows WHERE " + clause
            + " GROUP BY family,measure,unit ORDER BY family,measure", ids)]
        return {"geographies": geographies, "measures": measures, "total": total, "offset": offset,
                "next": offset + limit if offset + limit < total else None}

    def save_revision(self, kind, value):
        if kind == "portfolio":
            value = validate_portfolio(value)
        elif kind == "mapping":
            value = validate_mapping(value)
        else:
            fail("REVISION_KIND_INVALID")
        rid = identity(value)
        with self.mutation():
            self.connection.execute("INSERT OR IGNORE INTO revisions VALUES(?,?,?,?)",
                                    (rid, kind, encoded(value).decode(), now()))
            self.event(kind + ".freeze", rid, {"name": value["name"]})
        return {"id": rid, "kind": kind, **value}

    def freeze(self, source_ids, portfolio_id, mapping_id, label):
        if not isinstance(source_ids, list) or not source_ids or len(source_ids) != len(set(source_ids)):
            fail("DISTINCT_SOURCE_EDITIONS_REQUIRED")
        text(label, "label", maximum=200)
        sources = {sid: self.record("sources", sid) for sid in sorted(source_ids)}
        portfolio = validate_portfolio(self.record("revisions", portfolio_id))
        mapping = validate_mapping(self.record("revisions", mapping_id))
        for sid, source in sources.items():
            verify_source(self.directory / "sources" / sid, source["descriptor"])
        spec = {"schema": "stellar-forge.study-edition.v1", "label": label,
                "source_ids": sorted(source_ids), "portfolio_id": portfolio_id, "mapping_id": mapping_id}
        eid = identity(spec)
        if self.connection.execute("SELECT 1 FROM editions WHERE id=?", (eid,)).fetchone():
            return {"id": eid, "reopened": True, **self.record("editions", eid)}
        geographies = {(g["family"], g["source_geography_id"], g["source_geography_vintage"]): g for g in portfolio["geographies"]}
        selected_measures = {(item["family"], item["measure_id"]) for item in portfolio["measures"]}
        available, matched_geos, matched_measures, matched_pairs = set(), set(), set(), set()
        measures_by_definition = defaultdict(set)
        selected, outside, row_issues, export_keys = 0, 0, 0, defaultdict(list)
        with self.mutation():
            self.connection.execute("INSERT INTO editions VALUES(?,?,?)", (eid, encoded(spec).decode(), now()))
            for sid in sources:
                for record in self.connection.execute("SELECT body FROM source_rows WHERE source_id=? ORDER BY row_id", (sid,)):
                    row = unpack(record["body"])
                    family, geo, vintage = row["source_family"], row["source_geography_id"], row["geography_vintage"]
                    available.add((family, vintage))
                    measures_by_definition[(family, vintage)].add(row["source_measure_id"])
                    chosen = geographies.get((family, geo, vintage))
                    if chosen is None or selected_measures and (family, row["source_measure_id"]) not in selected_measures:
                        outside += 1
                        continue
                    matched_geos.add((family, geo, vintage))
                    matched_measures.add((family, row["source_measure_id"]))
                    matched_pairs.add((family, geo, vintage, row["source_measure_id"]))
                    value = __import__("model").project_row(row, chosen, mapping)
                    selected += 1
                    row_issues += bool(value["issues"])
                    export_keys[value["export_key"]].append(value["row_id"])
                    self.connection.execute("INSERT INTO edition_rows VALUES(?,?,?,?,?)",
                                            (eid, value["row_id"], sid, value["export_key"], encoded(value).decode()))
            duplicate_rows = set()
            for ids in export_keys.values():
                if len(ids) > 1:
                    duplicate_rows.update(ids)
            for rid in duplicate_rows:
                value = self.edition_row(eid, rid)
                if not value["issues"]:
                    row_issues += 1
                value["issues"].append("duplicate_export_key")
                self.connection.execute("UPDATE edition_rows SET body=? WHERE edition_id=? AND row_id=?",
                                        (encoded(value).decode(), eid, rid))
            global_issues = []
            for family in sorted({g["family"] for g in portfolio["geographies"]} - {x[0] for x in available}):
                global_issues.append({"code": "selected_family_absent", "family": family})
            for key in sorted(geographies):
                if (key[0], key[2]) in available and key not in matched_geos:
                    global_issues.append({"code": "selected_geography_absent", "identity": key})
            for key in sorted(geographies):
                if (key[0], key[2]) not in available:
                    continue  # A portfolio can bind both baseline and candidate definition editions.
                required = {measure for family, measure in selected_measures if family == key[0]} if selected_measures else measures_by_definition[(key[0], key[2])]
                for measure in sorted(required):
                    if (*key, measure) not in matched_pairs:
                        global_issues.append({"code": "selected_geography_measure_absent",
                                              "identity": (*key, measure)})
            for key in sorted(selected_measures - matched_measures):
                global_issues.append({"code": "selected_measure_absent", "identity": key})
            for family in sorted({g["family"] for g in portfolio["geographies"]}):
                if family in {x[0] for x in available} and family not in {x[0] for x in matched_geos}:
                    global_issues.append({"code": "geography_vintage_mapping_required", "family": family})
            if not selected:
                global_issues.append({"code": "selection_empty"})
            body = {**spec, "counts": {"selected": selected, "outside_portfolio": outside,
                                       "rows_with_mapping_issues": row_issues, "duplicate_export_rows": len(duplicate_rows),
                                       "selected_geography_measure_pairs": len(matched_pairs)},
                    "global_issues": global_issues}
            self.connection.execute("UPDATE editions SET body=? WHERE id=?", (encoded(body).decode(), eid))
            self.event("edition.freeze", eid, body["counts"])
        return {"id": eid, "reopened": False, **body}

    def edition_row(self, edition_id, row_id):
        row = self.connection.execute("SELECT body FROM edition_rows WHERE edition_id=? AND row_id=?",
                                      (edition_id, row_id)).fetchone()
        if not row:
            fail("EDITION_ROW_NOT_FOUND")
        return unpack(row["body"])

    def compare(self, candidate_id, baseline_id=None, mode="same_period", note="", unchanged="accept"):
        if mode not in ("same_period", "successive_release") or unchanged not in ("accept", "review"):
            fail("COMPARISON_MODE_INVALID")
        text(note, "comparison_note", empty=True)
        if mode == "successive_release" and not note.strip():
            fail("SUCCESSIVE_RELEASE_REVIEW_NOTE_REQUIRED")
        candidate = self.record("editions", candidate_id)
        baseline = self.record("editions", baseline_id) if baseline_id else None
        if candidate_id == baseline_id:
            fail("DISTINCT_EDITION_PAIR_REQUIRED")
        spec = {"schema": "stellar-forge.study-comparison.v1", "candidate_id": candidate_id,
                "baseline_id": baseline_id, "mode": mode, "note": note, "unchanged": unchanged,
                "mapping_ids": [baseline["mapping_id"] if baseline else None, candidate["mapping_id"]],
                "portfolio_ids": [baseline["portfolio_id"] if baseline else None, candidate["portfolio_id"]]}
        cid = identity(spec)
        if self.connection.execute("SELECT 1 FROM comparisons WHERE id=?", (cid,)).fetchone():
            return self.comparison(cid)
        grouped = [defaultdict(list), defaultdict(list)]
        for index, eid in enumerate((baseline_id, candidate_id)):
            if eid:
                for record in self.connection.execute("SELECT body FROM edition_rows WHERE edition_id=? ORDER BY row_id", (eid,)):
                    row = unpack(record["body"])
                    grouped[index][comparison_key(row, mode)].append(row)
        counts = Counter()
        with self.mutation():
            self.connection.execute("INSERT INTO comparisons VALUES(?,?,0,?)", (cid, encoded(spec).decode(), now()))
            for key in sorted(set(grouped[0]) | set(grouped[1])):
                old, new = grouped[0][key], grouped[1][key]
                if len(old) > 1 or len(new) > 1:
                    result = {"kind": "ambiguous", "reasons": ["comparison_key_not_unique"],
                              "changed_fields": [], "delta": None}
                else:
                    result = difference(old[0] if old else None, new[0] if new else None, mode)
                issues = sorted({issue for row in new for issue in row["issues"]})
                if issues:
                    result["reasons"] = sorted(set(result["reasons"]) | set(issues))
                body = {**result, "before_rows": [row["row_id"] for row in old],
                        "after_rows": [row["row_id"] for row in new], "mapping_issues": issues,
                        "provenance_changed": bool(old and new and old[0]["source_hash"] != new[0]["source_hash"])}
                self.connection.execute("INSERT INTO differences VALUES(?,?,?,?)",
                                        (cid, key, body["kind"], encoded(body).decode()))
                counts[body["kind"]] += 1
            spec.update({"counts": dict(counts), "before_rows": sum(map(len, grouped[0].values())),
                         "after_rows": sum(map(len, grouped[1].values())),
                         "global_issues": candidate["global_issues"],
                         "period_note": "Successive releases retain their different periods; overlapping ACS windows are not independent samples."
                         if mode == "successive_release" else "Only equal native reference periods share a comparison key."})
            self.connection.execute("UPDATE comparisons SET body=? WHERE id=?", (encoded(spec).decode(), cid))
            self.event("comparison.create", cid, dict(counts))
        return self.comparison(cid)

    def comparison(self, comparison_id, *, kind="", offset=0, limit=50):
        integer(offset, "offset")
        integer(limit, "limit", 1, 200)
        spec = self.record("comparisons", comparison_id)
        review_version = self.connection.execute("SELECT review_version FROM comparisons WHERE id=?", (comparison_id,)).fetchone()[0]
        parameters = [comparison_id]
        clause = "comparison_id=?"
        if kind:
            if kind not in ("added", "removed", "changed", "unchanged", "incomparable", "ambiguous"):
                fail("DIFFERENCE_KIND_INVALID")
            clause += " AND kind=?"
            parameters.append(kind)
        rows = []
        total = self.connection.execute("SELECT COUNT(*) FROM differences WHERE " + clause, parameters).fetchone()[0]
        for record in self.connection.execute("SELECT key,body FROM differences WHERE " + clause + " ORDER BY key LIMIT ? OFFSET ?", [*parameters, limit, offset]):
            body = unpack(record["body"])
            decision = self.connection.execute("SELECT body FROM decisions WHERE comparison_id=? AND key=?", (comparison_id, record["key"])).fetchone()
            automatic = body["kind"] == "unchanged" and spec["unchanged"] == "accept" and not body["mapping_issues"]
            rows.append({"key": record["key"], **body,
                         "decision": unpack(decision["body"]) if decision else {"action": "accept" if automatic else "pending", "automatic": automatic},
                         "before": [self.edition_row(spec["baseline_id"], rid) for rid in body["before_rows"]],
                         "after": [self.edition_row(spec["candidate_id"], rid) for rid in body["after_rows"]]})
        pending = 0
        actions = Counter()
        for record in self.connection.execute(
                "SELECT d.body,c.action FROM differences d LEFT JOIN decisions c ON c.comparison_id=d.comparison_id AND c.key=d.key WHERE d.comparison_id=?",
                (comparison_id,)):
            body = unpack(record["body"])
            action = record["action"] or ("accept" if body["kind"] == "unchanged" and spec["unchanged"] == "accept" and not body["mapping_issues"] else "pending")
            actions[action] += 1
            pending += action == "pending"
        return {"id": comparison_id, **spec, "review_version": review_version, "review_counts": dict(actions),
                "pending": pending, "rows": rows, "total": total, "offset": offset,
                "next": offset + limit if offset + limit < total else None}

    def review(self, comparison_id, keys, action, operator, note, expected_version):
        spec = self.record("comparisons", comparison_id)
        if action not in ("accept", "exclude"):
            fail("REVIEW_ACTION_INVALID")
        if not isinstance(keys, list) or not 1 <= len(keys) <= 100000 or len(keys) != len(set(keys)):
            fail("REVIEW_KEYS_REQUIRED")
        text(operator, "operator", maximum=200)
        text(note, "review_note", empty=action == "accept")
        integer(expected_version, "expected_review_version")
        with self.mutation():
            current = self.connection.execute("SELECT review_version FROM comparisons WHERE id=?", (comparison_id,)).fetchone()[0]
            if current != expected_version:
                fail("REVIEW_CHANGED", current_version=current)
            for key in keys:
                row = self.connection.execute("SELECT body FROM differences WHERE comparison_id=? AND key=?", (comparison_id, hash_id(key))).fetchone()
                if not row:
                    fail("DIFFERENCE_NOT_FOUND")
                value = unpack(row["body"])
                if action == "accept" and (value["mapping_issues"] or value["kind"] == "ambiguous"):
                    fail("MAPPING_REVISION_OR_EXCLUSION_REQUIRED", key=key, issues=value["mapping_issues"])
                if action == "accept" and value["kind"] == "incomparable" and not note.strip():
                    fail("INCOMPARABLE_REVIEW_NOTE_REQUIRED")
                decision = {"action": action, "operator": operator, "note": note, "time": now(),
                            "comparison_id": comparison_id, "candidate_id": spec["candidate_id"],
                            "review_version": current + 1}
                self.connection.execute("INSERT INTO decisions VALUES(?,?,?,?) ON CONFLICT(comparison_id,key) DO UPDATE SET action=excluded.action,body=excluded.body",
                                        (comparison_id, key, action, encoded(decision).decode()))
            self.connection.execute("UPDATE comparisons SET review_version=? WHERE id=?", (current + 1, comparison_id))
            self.event("review." + action, comparison_id, {"keys": len(keys), "operator": operator, "review_version": current + 1})
        return self.comparison(comparison_id)

    def review_keys(self, comparison_id, kind=""):
        self.record("comparisons", comparison_id)
        if kind and kind not in ("added", "removed", "changed", "unchanged", "incomparable", "ambiguous"):
            fail("DIFFERENCE_KIND_INVALID")
        return [row[0] for row in self.connection.execute(
            "SELECT key FROM differences WHERE comparison_id=?" + (" AND kind=?" if kind else "") + " ORDER BY key",
            (comparison_id, kind) if kind else (comparison_id,))]

    def original_row(self, edition_id, row_id):
        row = self.edition_row(edition_id, row_id)
        sid = self.connection.execute("SELECT source_id FROM edition_rows WHERE edition_id=? AND row_id=?", (edition_id, row_id)).fetchone()[0]
        source = self.record("sources", sid)
        projection = next(p for p in source["descriptor"]["projections"] if p["query"] == row["source_locator"]["projection"])
        path = self.directory / "sources" / sid / projection["path"]
        if file_identity(path) != {key: projection[key] for key in ("bytes", "sha256")}:
            fail("NATIVE_PROJECTION_CHANGED")
        with path.open("rb") as lines:
            for line, raw in enumerate(lines, 1):
                if line == row["source_locator"]["projection_line"]:
                    original = parse(raw)
                    if identity(original) != row["source_locator"]["projection_row_sha256"]:
                        fail("NATIVE_PROJECTION_ROW_CHANGED")
                    return {"canonical": row, "native": original, "source_id": sid}
        fail("NATIVE_PROJECTION_ROW_MISSING")


    def source_rows(self, source_id, *, geography="", measure="", offset=0, limit=50):
        self.record("sources", source_id)
        integer(offset, "offset")
        integer(limit, "limit", 1, 200)
        parameters = [source_id]
        clause = "source_id=?"
        if geography:
            clause += " AND geo=?"
            parameters.append(geography)
        if measure:
            clause += " AND measure=?"
            parameters.append(measure)
        total = self.connection.execute("SELECT count(*) FROM source_rows WHERE " + clause, parameters).fetchone()[0]
        rows = [unpack(row["body"]) for row in self.connection.execute(
            "SELECT body FROM source_rows WHERE " + clause + " ORDER BY row_id LIMIT ? OFFSET ?", [*parameters, limit, offset])]
        return {"source_id": source_id, "rows": rows, "total": total, "offset": offset,
                "next": offset + limit if offset + limit < total else None}
