"""Source-bound candidate browsing for the original Conservation study.

The SQLite file is a rebuildable reading index. Original candidates, studies,
plans, geometry and native runs remain authoritative in their existing stores.
"""
from __future__ import annotations

import argparse
from contextlib import closing, contextmanager
import csv
import hashlib
import json
import math
from pathlib import Path
import sqlite3
import tempfile

from . import conservation
from .common import (
    atomic_json, canonical, describe_file, digest, held, identifier, now,
    read_json, relative_file, verify_file,
)

SCHEMA = "upstate.conservation-catalog/v1"
VERSION = 1
RANGES = {
    "rank": "rank", "score": "score", "area_ha": "area_ha",
    "reporting_area_ha": "reporting_area_ha", "cost": "cost",
    "protected_fraction": "protected_fraction",
    "source_water_fraction": "source_water_fraction",
}
SORTS = {"id": "id", "label": "label_sort", **RANGES}
METRIC_FIELDS = {
    "value": "quantity", "coverage_fraction": "coverage",
    "delta": "delta", "reduction": "reduction",
    "common_coverage_fraction": "common_coverage",
}
AVAILABILITY = {"modeled", "not_selected", "unbound"}


def _json(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":"))


def _number(value, name, *, optional=True):
    if value is None and optional:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(name + " must be a finite number")
    return value


def _integer(value, name, *, minimum=0, maximum=None):
    if isinstance(value, bool):
        raise ValueError(name + " must be a whole number")
    if isinstance(value, str) and value.isdecimal():
        value = int(value)
    if not isinstance(value, int) or value < minimum or (maximum is not None and value > maximum):
        raise ValueError(name + " is outside the supported page range")
    return value


def _text(value, name):
    if not isinstance(value, str) or "\0" in value:
        raise ValueError(name + " must preserve its original text value")
    return value


class _CandidateReader:
    """Stream the original top-level JSON array with the standard JSON decoder."""
    def __init__(self, stream):
        self.stream, self.buffer, self.position, self.eof = stream, "", 0, False
        self.decoder = json.JSONDecoder(parse_constant=self._constant)
        self.metadata = {}
        self.sha256 = hashlib.sha256()
        self.bytes = 0

    @staticmethod
    def _constant(value):
        raise ValueError("Original candidates contain a nonfinite JSON number: " + value)

    def _more(self):
        if self.eof:
            return False
        self.buffer = self.buffer[self.position:]
        self.position = 0
        chunk = self.stream.read(1024 * 1024)
        encoded = chunk.encode("utf-8")
        self.sha256.update(encoded)
        self.bytes += len(encoded)
        self.buffer += chunk
        self.eof = not chunk
        return bool(chunk)

    def _peek(self):
        while True:
            while self.position < len(self.buffer) and self.buffer[self.position].isspace():
                self.position += 1
            if self.position < len(self.buffer):
                return self.buffer[self.position]
            if not self._more():
                return ""

    def _take(self, expected):
        if self._peek() != expected:
            raise ValueError("The original candidate JSON has an invalid delimiter")
        self.position += 1

    def _value(self):
        self._peek()
        while True:
            try:
                value, end = self.decoder.raw_decode(self.buffer, self.position)
            except json.JSONDecodeError:
                if not self._more():
                    raise ValueError("The original candidate JSON is incomplete or invalid") from None
            else:
                # A number can end at a chunk boundary before its next digit.
                if end == len(self.buffer) and not self.eof:
                    self._more()
                    continue
                if (end < len(self.buffer) and not self.buffer[end].isspace()
                        and self.buffer[end] not in ",:]}"):
                    if self._more():
                        continue
                    raise ValueError("The original JSON value has an invalid suffix")
                self.position = end
                return value

    def rows(self):
        self._take("{")
        seen = set()
        if self._peek() == "}":
            raise ValueError("The original candidate inventory is empty")
        while True:
            key = self._value()
            if not isinstance(key, str) or key in seen or key not in {"schema", "study_id", "candidates"}:
                raise ValueError("The original candidate inventory has an unexpected or repeated member")
            seen.add(key)
            self._take(":")
            if key == "candidates":
                self._take("[")
                if self._peek() != "]":
                    while True:
                        row = self._value()
                        if not isinstance(row, dict):
                            raise ValueError("Each original candidate must be an object")
                        yield row
                        if self._peek() == "]":
                            break
                        self._take(",")
                self._take("]")
            else:
                self.metadata[key] = self._value()
            if self._peek() == "}":
                break
            self._take(",")
        self._take("}")
        if self._peek() or seen != {"schema", "study_id", "candidates"}:
            raise ValueError("The original candidate inventory has trailing or missing members")


def _binding(workspace, study_id):
    study = conservation.inspect(workspace, identifier(study_id), include_candidates=False)
    if study["state"] != "complete":
        raise ValueError("Complete the original conservation study before indexing its candidates")
    source = study["files"]["candidates"]
    selection = {"version": VERSION, "study_id": study["id"], "source_inventory": source}
    key = digest(selection)
    folder = workspace.root / "conservation" / study["id"] / "catalog" / key
    return study, selection, key, folder


def status(workspace, study_id):
    study, selection, key, folder = _binding(workspace, study_id)
    path = folder / "state.json"
    if path.is_file():
        result = read_json(path)
        if result.get("id") != key or result.get("selection") != selection:
            raise ValueError("The candidate reading index belongs to another source edition")
    else:
        result = {
            "schema": SCHEMA, "id": key, "study_id": study["id"],
            "state": "unprepared", "selection": selection, "files": {},
        }
    return {
        **result,
        "source_inventory": selection["source_inventory"],
        "original_count": study["summary"]["units"],
        "original_summary": study["summary"],
        "unit_type": study["unit_type"],
        "planning_unit_label": study["planning_unit_label"],
        "metric_cases": ["baseline", *study["spec"]["alternative_run_ids"]],
        "pollutants": list(conservation.POLLUTANTS),
        "sort_fields": [*SORTS, *conservation.POLLUTANTS], "numeric_filters": list(RANGES),
        "metric_filter_fields": list(METRIC_FIELDS),
    }


def _candidate_values(row):
    key = _text(row.get("id"), "Original candidate ID")
    if not key:
        raise ValueError("The original candidate ID is empty")
    label = _text(row.get("label"), "Original candidate label")
    if not isinstance(row.get("eligible"), bool):
        raise ValueError("Original candidate eligibility must be a boolean")
    rank = row.get("rank")
    if rank is not None:
        rank = _integer(rank, "Original candidate rank", minimum=1)
    values = [_number(row.get(name), "Original " + name) for name in RANGES if name != "rank"]
    searchable = "\n".join((key, label, _json(row.get("original_attributes", {})))).casefold()
    return (
        key, label.casefold(), searchable, int(row["eligible"]), rank, *values,
        row.get("currency"), _json(row),
    )


def _metric_values(row, spec):
    for pollutant in conservation.POLLUTANTS:
        original = row["pollutants"][pollutant]
        if original["unit"] != conservation.POLLUTANTS[pollutant][2]:
            raise ValueError("Preserve the original physical units in the candidate index")
        cases = [("baseline", original)] + list(original["alternatives"].items())
        if {case for case, _ in cases} != {"baseline", *spec["alternative_run_ids"]}:
            raise ValueError("The candidate metric cases differ from the original study")
        for case, metric in cases:
            availability = metric.get("availability")
            if availability not in AVAILABILITY:
                raise ValueError("The candidate output availability is unknown")
            yield (
                row["id"], pollutant, case, availability,
                _number(metric.get("baseline" if case == "baseline" else "value"), "Original quantity"),
                _number(metric.get("coverage_fraction"), "Original case coverage"),
                _number(metric.get("delta"), "Original paired delta"),
                _number(metric.get("reduction"), "Original paired reduction"),
                _number(metric.get("common_coverage_fraction"), "Original common coverage"),
                metric.get("comparison_availability"),
            )


def prepare(workspace, study_id):
    """Stream all original candidates once; build the reusable reading index."""
    study, selection, key, folder = _binding(workspace, study_id)
    folder.mkdir(parents=True, exist_ok=True)
    with held(folder / ".catalog.lock", blocking=False):
        current = status(workspace, study_id)
        if current["state"] == "complete":
            verify_file(workspace.root, current["files"]["index"])
            return {**current, "reused": True}
        source = verify_file(workspace.root, selection["source_inventory"])
        state = {
            "schema": SCHEMA, "id": key, "study_id": study["id"],
            "selection": selection, "state": "building",
            "created_at": current.get("created_at") or now(), "updated_at": now(),
            "progress": {"rows": 0, "total": study["summary"]["units"]}, "files": {},
        }
        atomic_json(folder / "state.json", state)
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(prefix=".catalog-", suffix=".sqlite3", dir=folder, delete=False) as stream:
                temporary = Path(stream.name)
            with closing(sqlite3.connect(temporary)) as db:
                db.executescript("""
                    PRAGMA journal_mode=DELETE;
                    PRAGMA synchronous=FULL;
                    CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                    CREATE TABLE candidates (
                        id TEXT PRIMARY KEY, label_sort TEXT NOT NULL, search_text TEXT NOT NULL,
                        eligible INTEGER NOT NULL, rank INTEGER, score REAL, area_ha REAL,
                        reporting_area_ha REAL, cost REAL, protected_fraction REAL,
                        source_water_fraction REAL, currency TEXT, original_json TEXT NOT NULL);
                    CREATE TABLE metrics (
                        candidate_id TEXT NOT NULL, pollutant TEXT NOT NULL, case_id TEXT NOT NULL,
                        availability TEXT NOT NULL, quantity REAL, coverage REAL, delta REAL,
                        reduction REAL, common_coverage REAL, comparison_availability TEXT,
                        PRIMARY KEY (candidate_id, pollutant, case_id));
                """)
                count, eligible = 0, 0
                with source.open("r", encoding="utf-8", newline="") as stream:
                    reader = _CandidateReader(stream)
                    for row in reader.rows():
                        db.execute("INSERT INTO candidates VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", _candidate_values(row))
                        db.executemany("INSERT INTO metrics VALUES (?,?,?,?,?,?,?,?,?,?)",
                                       _metric_values(row, study["spec"]))
                        count += 1
                        eligible += int(row["eligible"])
                        if count % 5000 == 0:
                            state.update(updated_at=now(), progress={"rows": count, "total": study["summary"]["units"]})
                            atomic_json(folder / "state.json", state)
                    if (reader.metadata.get("schema") != "upstate.conservation-candidates/v1"
                            or reader.metadata.get("study_id") != study["id"]):
                        raise ValueError("The candidate source differs from its completed original study")
                    if (reader.sha256.hexdigest() != selection["source_inventory"]["sha256"]
                            or reader.bytes != selection["source_inventory"]["bytes"]):
                        raise ValueError("The original candidate source changed while its index was prepared")
                if count != study["summary"]["units"] or eligible != study["summary"]["eligible_units"]:
                    raise ValueError("The full indexed inventory differs from its original counts")
                db.executescript("""
                    CREATE INDEX candidate_rank ON candidates(rank,id);
                    CREATE INDEX candidate_score ON candidates(score,id);
                    CREATE INDEX candidate_label ON candidates(label_sort,id);
                    CREATE INDEX candidate_eligible ON candidates(eligible,rank,id);
                    CREATE INDEX candidate_area ON candidates(area_ha,id);
                    CREATE INDEX candidate_reporting_area ON candidates(reporting_area_ha,id);
                    CREATE INDEX metric_quantity ON metrics(pollutant,case_id,quantity,candidate_id);
                    CREATE INDEX metric_coverage ON metrics(pollutant,case_id,coverage,candidate_id);
                """)
                db.execute("INSERT INTO metadata VALUES ('identity',?)", (key,))
                db.execute("INSERT INTO metadata VALUES ('selection',?)", (_json(selection),))
                db.execute("INSERT INTO metadata VALUES ('counts',?)", (_json({"total": count, "eligible": eligible}),))
                db.commit()
            destination = folder / "candidates.sqlite3"
            temporary.replace(destination)
            state.update(
                state="complete", completed_at=now(), updated_at=now(),
                counts={"total": count, "eligible": eligible},
                progress={"rows": count, "total": count},
                files={"index": describe_file(workspace.root, destination)},
            )
            atomic_json(folder / "state.json", state)
            return status(workspace, study_id)
        except BaseException as error:
            state.update(state="failed", updated_at=now(),
                         error={"type": type(error).__name__, "message": str(error)})
            atomic_json(folder / "state.json", state)
            raise
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)


@contextmanager
def _open(workspace, study_id):
    state = status(workspace, study_id)
    if state["state"] != "complete":
        raise ValueError("Prepare this original study's candidate catalog through the task queue first")
    descriptor = state["files"]["index"]
    path = relative_file(workspace.root, descriptor["path"])
    if path.stat().st_size != descriptor["bytes"]:
        raise ValueError("The candidate index changed; prepare its original source again")
    # The published index is immutable. Verify its full hash when preparing or
    # receiving, and its exact source/metadata binding on each cheap page read.
    with closing(sqlite3.connect(path.as_uri() + "?mode=ro&immutable=1", uri=True)) as db:
        db.row_factory = sqlite3.Row
        identity = db.execute("SELECT value FROM metadata WHERE key='identity'").fetchone()
        selected = db.execute("SELECT value FROM metadata WHERE key='selection'").fetchone()
        if identity is None or identity[0] != state["id"] or selected is None or json.loads(selected[0]) != state["selection"]:
            raise ValueError("The candidate index belongs to another original inventory")
        yield db, state


def _range(value, label):
    if not isinstance(value, dict) or set(value) - {"min", "max"} or not value:
        raise ValueError(label + " must specify a minimum or maximum")
    result = {name: _number(item, label + " " + name, optional=False) for name, item in value.items()}
    if "min" in result and "max" in result and result["min"] > result["max"]:
        raise ValueError(label + " minimum exceeds maximum")
    return result


def _request(value, state):
    value = {} if value is None else value
    if not isinstance(value, dict) or set(value) - {"filters", "sort", "direction", "offset", "limit"}:
        raise ValueError("Choose candidate filters, sorting and a result page")
    filters = value.get("filters", {})
    allowed = {"search", "eligible", "ids", "metrics", *RANGES}
    if not isinstance(filters, dict) or set(filters) - allowed:
        raise ValueError("Use the declared candidate filters")
    normalized = {"search": _text(filters.get("search", ""), "Search").strip(),
                  "eligible": filters.get("eligible", "all")}
    if normalized["eligible"] not in {"all", "yes", "no"}:
        raise ValueError("Eligibility must be all, yes or no")
    if "ids" in filters:
        ids = filters["ids"]
        if not isinstance(ids, list):
            raise ValueError("Selected original candidate IDs must be a list")
        normalized["ids"] = sorted(set(_text(x, "Candidate ID") for x in ids))
    for field in RANGES:
        if field in filters:
            normalized[field] = _range(filters[field], field)
    metric_filters = filters.get("metrics", [])
    if not isinstance(metric_filters, list):
        raise ValueError("Metric filters must be a list")
    normalized["metrics"] = []
    for item in metric_filters:
        if not isinstance(item, dict) or set(item) - {"pollutant", "case", "field", "min", "max", "availability"}:
            raise ValueError("Choose a pollutant, original case and metric range or availability")
        pollutant, case = item.get("pollutant"), item.get("case", "baseline")
        field = item.get("field", "value")
        if pollutant not in conservation.POLLUTANTS or case not in state["metric_cases"] or field not in METRIC_FIELDS:
            raise ValueError("The metric filter differs from the original study's cases or units")
        if case == "baseline" and field in {"delta", "reduction", "common_coverage_fraction"}:
            raise ValueError("Paired changes and common support require an original alternative case")
        selected = {"pollutant": pollutant, "case": case, "field": field}
        if "availability" in item:
            if item["availability"] not in AVAILABILITY:
                raise ValueError("Choose a declared output availability")
            selected["availability"] = item["availability"]
        bounds = {key: item[key] for key in ("min", "max") if key in item}
        if bounds:
            selected.update(_range(bounds, "Metric"))
        if not bounds and "availability" not in selected:
            raise ValueError("A metric filter needs a range or availability")
        normalized["metrics"].append(selected)
    sort = value.get("sort", "rank")
    direction = value.get("direction", "asc" if sort in {"rank", "id", "label"} else "desc")
    if sort not in {*SORTS, *conservation.POLLUTANTS} or direction not in {"asc", "desc"}:
        raise ValueError("Choose a declared candidate sort and asc or desc direction")
    return {"filters": normalized, "sort": sort, "direction": direction,
            "offset": _integer(value.get("offset", 0), "Offset", maximum=9223372036854775807),
            "limit": _integer(value.get("limit", 100), "Page size", minimum=1, maximum=1000)}


def _where(db, request, namespace=""):
    if namespace not in ("", "cohort_"):
        raise ValueError("Unknown query namespace")
    id_table = namespace + "requested_ids"
    filters = request["filters"]
    terms, parameters = [], []
    if filters["search"]:
        terms.append("instr(c.search_text,?)>0")
        parameters.append(filters["search"].casefold())
    if filters["eligible"] != "all":
        terms.append("c.eligible=?")
        parameters.append(int(filters["eligible"] == "yes"))
    if "ids" in filters:
        db.execute("CREATE TEMP TABLE " + id_table + " (id TEXT PRIMARY KEY)")
        db.executemany("INSERT INTO " + id_table + " VALUES (?)", ((key,) for key in filters["ids"]))
        unknown = db.execute("SELECT COUNT(*) FROM " + id_table + " AS wanted "
                             "LEFT JOIN candidates AS known ON known.id=wanted.id WHERE known.id IS NULL").fetchone()[0]
        if unknown:
            raise ValueError(str(unknown) + " selected IDs are absent from this original study")
        terms.append("EXISTS (SELECT 1 FROM " + id_table + " AS requested WHERE requested.id=c.id)")
    for name, column in RANGES.items():
        for bound, number in filters.get(name, {}).items():
            terms.append("c." + column + (">=?" if bound == "min" else "<=?"))
            parameters.append(number)
    for selected in filters["metrics"]:
        metric_terms = ["m.candidate_id=c.id", "m.pollutant=?", "m.case_id=?"]
        parameters.extend((selected["pollutant"], selected["case"]))
        for bound in ("min", "max"):
            if bound in selected:
                metric_terms.append("m." + METRIC_FIELDS[selected["field"]] + (">=?" if bound == "min" else "<=?"))
                parameters.append(selected[bound])
        if "availability" in selected:
            metric_terms.append("m.availability=?")
            parameters.append(selected["availability"])
        terms.append("EXISTS (SELECT 1 FROM metrics AS m WHERE " + " AND ".join(metric_terms) + ")")
    return (" WHERE " + " AND ".join(terms) if terms else ""), parameters


def _order(request):
    if request["sort"] in conservation.POLLUTANTS:
        column = "(SELECT ordered.quantity FROM metrics AS ordered WHERE ordered.candidate_id=c.id"
        column += " AND ordered.case_id=\'baseline\' AND ordered.pollutant=\'" + request["sort"] + "\')"
    else:
        column = "c." + SORTS[request["sort"]]
    return " ORDER BY " + column + " IS NULL ASC, " + column + " " + request["direction"].upper() + ", c.id ASC"


def _reference(state, request):
    return {"schema": "upstate.conservation-candidate-query/v1", "study_id": state["study_id"],
            "index_id": state["id"], "source_inventory": state["source_inventory"],
            "filters": request["filters"], "sort": request["sort"], "direction": request["direction"]}


def _cohort(workspace, db, state, value):
    if value is None:
        return None, [], None
    if not isinstance(value, dict) or set(value) - {
        "selection_id", "include_ids", "exclude_ids", "selected_only",
    }:
        raise ValueError("Choose one retained selection and its explicit manual edits")
    selected = get_selection(workspace, state["study_id"], value.get("selection_id"))
    reference = selected["reference"]
    request = _request({key: reference[key] for key in ("filters", "sort", "direction")}, state)
    where, parameters = _where(db, request, "cohort_")
    original = where.removeprefix(" WHERE ") or "1"
    edits = {}
    for name, table in (("include_ids", "cohort_added"), ("exclude_ids", "cohort_removed")):
        values = value.get(name, [])
        if not isinstance(values, list):
            raise ValueError(name + " must list original candidate IDs")
        edits[name] = sorted(set(_text(item, "Candidate ID") for item in values))
        db.execute("CREATE TEMP TABLE " + table + " (id TEXT PRIMARY KEY)")
        db.executemany("INSERT INTO " + table + " VALUES (?)", ((key,) for key in edits[name]))
        unknown = db.execute("SELECT COUNT(*) FROM " + table + " AS wanted "
                             "LEFT JOIN candidates AS known ON known.id=wanted.id WHERE known.id IS NULL").fetchone()[0]
        if unknown:
            raise ValueError(str(unknown) + " selection edits are absent from this original study")
    if set(edits["include_ids"]) & set(edits["exclude_ids"]):
        raise ValueError("An original candidate cannot be both added and excluded")
    selected_only = value.get("selected_only", False)
    if not isinstance(selected_only, bool):
        raise ValueError("selected_only must be true or false")
    clause = "((" + original + ") OR EXISTS (SELECT 1 FROM cohort_added AS added WHERE added.id=c.id))"
    clause += " AND NOT EXISTS (SELECT 1 FROM cohort_removed AS removed WHERE removed.id=c.id)"
    count = db.execute("SELECT COUNT(*) FROM candidates AS c WHERE " + clause, parameters).fetchone()[0]
    return clause, parameters, {
        "selection_id": selected["id"], "index_id": selected["index_id"],
        "original_count": selected["count"], "resolved_count": count,
        "selected_ids_file": selected["files"]["selected_ids"],
        **edits, "selected_only": selected_only,
    }


def _query_parts(workspace, db, state, request, retained):
    where, parameters = _where(db, request)
    clause, cohort_parameters, cohort = _cohort(workspace, db, state, retained)
    if cohort and cohort["selected_only"]:
        where += (" AND " if where else " WHERE ") + "(" + clause + ")"
        parameters += cohort_parameters
    reference = _reference(state, request)
    if cohort is not None:
        reference["retained"] = cohort
    return where, parameters, clause, cohort_parameters, cohort, reference


def query(workspace, study_id, value=None, retained=None):
    with _open(workspace, study_id) as (db, state):
        request = _request(value, state)
        where, parameters, clause, cohort_parameters, cohort, reference = _query_parts(
            workspace, db, state, request, retained)
        total = db.execute("SELECT COUNT(*) FROM candidates AS c" + where, parameters).fetchone()[0]
        membership = "CASE WHEN (" + clause + ") THEN 1 ELSE 0 END" if clause else "0"
        rows = db.execute("SELECT c.original_json," + membership + " FROM candidates AS c" + where + _order(request)
                          + " LIMIT ? OFFSET ?", [*cohort_parameters, *parameters, request["limit"], request["offset"]])
        candidates, selected_ids_on_page = [], []
        for row in rows:
            original = json.loads(row[0])
            candidates.append(original)
            if row[1]:
                selected_ids_on_page.append(original["id"])
        end = request["offset"] + len(candidates)
        return {
            **reference, "schema": "upstate.conservation-candidate-page/v1",
            "request": request, "total": total, "original_count": state["original_count"],
            "offset": request["offset"], "limit": request["limit"],
            "next_offset": end if end < total else None, "candidates": candidates,
            "selected_ids_on_page": selected_ids_on_page, "retained": cohort,
        }


def candidate(workspace, study_id, candidate_id):
    key = _text(candidate_id, "Original candidate ID")
    with _open(workspace, study_id) as (db, state):
        row = db.execute("SELECT original_json FROM candidates WHERE id=?", (key,)).fetchone()
        if row is None:
            raise ValueError("The candidate is absent from this original study")
        return {"schema": "upstate.conservation-candidate-detail/v1", "study_id": state["study_id"],
                "index_id": state["id"], "source_inventory": state["source_inventory"],
                "candidate": json.loads(row[0])}


def _selection_folder(workspace, study_id, selection_id):
    return workspace.root / "conservation" / identifier(study_id) / "catalog-selections" / identifier(selection_id)


def select(workspace, study_id, value=None):
    """Retain every matched original ID without sending the full list to a client."""
    with _open(workspace, study_id) as (db, state):
        request = _request(value, state)
        reference = _reference(state, request)
        key = digest(reference)
        folder = _selection_folder(workspace, state["study_id"], key)
        folder.mkdir(parents=True, exist_ok=True)
        with held(folder / ".selection.lock", blocking=False):
            path = folder / "selection.json"
            if path.is_file():
                return {**get_selection(workspace, study_id, key), "reused": True}
            where, parameters = _where(db, request)
            header = {"schema": "upstate.conservation-selected-ids/v1", "reference": reference}
            count = 0
            with tempfile.TemporaryDirectory(prefix=".selection-", dir=folder) as temporary:
                staging = Path(temporary) / "selected-ids.json"
                with staging.open("w", encoding="utf-8", newline="") as output:
                    output.write(_json(header)[:-1] + ',"selected_ids":[')
                    for row in db.execute("SELECT c.id FROM candidates AS c" + where + " ORDER BY c.id", parameters):
                        output.write(("," if count else "") + _json(row[0]))
                        count += 1
                    output.write("]}\n")
                staging.replace(folder / "selected-ids.json")
            result = {
                "schema": "upstate.conservation-candidate-selection/v1",
                "id": key, "selection_id": key, "study_id": state["study_id"],
                "index_id": state["id"], "source_inventory": state["source_inventory"],
                "state": "complete", "reference": reference, "count": count, "created_at": now(),
                "files": {"selected_ids": describe_file(workspace.root, folder / "selected-ids.json")},
                "consumer": "conservation_catalog.save_selected_plan",
            }
            atomic_json(path, result, immutable=True)
            return result


def get_selection(workspace, study_id, selection_id, *, include_ids=False):
    """Reopen one exact source-bound selection; large IDs stay server-side by default."""
    state = status(workspace, study_id)
    key = identifier(selection_id)
    result = read_json(_selection_folder(workspace, state["study_id"], key) / "selection.json")
    reference = result.get("reference", {})
    if (result.get("schema") != "upstate.conservation-candidate-selection/v1"
            or result.get("id") != key or result.get("selection_id") != key
            or result.get("study_id") != state["study_id"]
            or result.get("index_id") != state["id"] or result.get("state") != "complete"
            or reference.get("study_id") != state["study_id"]
            or reference.get("index_id") != state["id"]
            or reference.get("source_inventory") != state["source_inventory"]
            or result.get("source_inventory") != state["source_inventory"]
            or digest(reference) != key):
        raise ValueError("The retained candidate selection belongs to another original source")
    path = verify_file(workspace.root, result["files"]["selected_ids"])
    if include_ids:
        stored = read_json(path)
        ids = stored.get("selected_ids")
        if (stored.get("schema") != "upstate.conservation-selected-ids/v1"
                or stored.get("reference") != reference or not isinstance(ids, list)
                or len(ids) != result["count"] or not all(isinstance(item, str) for item in ids)
                or ids != sorted(set(ids))):
            raise ValueError("The retained full selection differs from its declared source and count")
        return {**result, "selected_ids": ids}
    return result


def save_selected_plan(workspace, value):
    """Resolve retained IDs and small manual edits into the original manual plan store."""
    if not isinstance(value, dict) or set(value) - {
        "study_id", "selection_id", "plan", "include_ids", "exclude_ids",
    }:
        raise ValueError("Supply an original study, retained selection and manual plan")
    study_id = identifier(value.get("study_id"))
    selected = get_selection(workspace, study_id, value.get("selection_id"), include_ids=True)
    spec = value.get("plan")
    if not isinstance(spec, dict):
        raise ValueError("Supply the original manual plan title, eligibility and limits")
    spec = json.loads(_json(spec))
    if spec.get("study_id", study_id) != study_id or spec.get("mode", "manual") != "manual":
        raise ValueError("A retained candidate selection saves to its original manual plan")
    if spec.get("selected_ids"):
        raise ValueError("Use the retained selection plus explicit include_ids and exclude_ids")
    additions, removals = [], []
    for name, target in (("include_ids", additions), ("exclude_ids", removals)):
        ids = value.get(name, [])
        if not isinstance(ids, list):
            raise ValueError(name + " must list original candidate IDs")
        target.extend(sorted(set(_text(item, "Candidate ID") for item in ids)))
    if set(additions) & set(removals):
        raise ValueError("An original candidate cannot be both added and excluded")
    # Validate the edits against the exact indexed inventory, including removals
    # which otherwise could silently hide a mistyped or foreign original ID.
    with _open(workspace, study_id) as (db, state):
        request = _request({"filters": {"ids": additions + removals}}, state)
        _where(db, request)
    ids = sorted((set(selected["selected_ids"]) | set(additions)) - set(removals))
    spec.update(
        study_id=study_id, mode="manual", selected_ids=ids,
        catalog_selection={
            "selection_id": selected["id"], "index_id": selected["index_id"],
            "source_inventory": selected["source_inventory"],
            "selected_ids_file": selected["files"]["selected_ids"],
            "reference": selected["reference"], "original_count": selected["count"],
            "include_ids": additions, "exclude_ids": removals, "resolved_count": len(ids),
        },
    )
    plan = conservation.save_plan(workspace, spec)
    return {
        "schema": "upstate.conservation-catalog-plan/v1", "study_id": study_id,
        "selection": {key: item for key, item in selected.items() if key != "selected_ids"},
        "plan": plan, "plan_id": plan["id"], "resolved_count": len(ids),
    }


def export_rows(workspace, study_id, value=None, retained=None):
    """Stream all matched original records and separate physical columns to files."""
    with _open(workspace, study_id) as (db, state):
        request = _request(value, state)
        where, parameters, _, _, cohort, reference = _query_parts(
            workspace, db, state, request, retained)
        key = digest(reference)
        folder = workspace.root / "conservation-exports" / "catalog" / key
        with held(folder / ".catalog-export.lock", blocking=False):
            folder.mkdir(parents=True, exist_ok=True)
            retained = folder / "export.json"
            if retained.is_file():
                previous = read_json(retained)
                if previous.get("reference") != reference:
                    raise ValueError("This candidate export belongs to another source selection")
                for item in previous["files"].values():
                    verify_file(workspace.root, item)
                return {**previous, "reused": True}
            header = {"schema": "upstate.conservation-filtered-candidates/v1", "reference": reference}
            columns = ["id", "label", "eligible", "rank", "score", "area_ha", "reporting_area_ha",
                       "cost", "currency", "protected_fraction", "source_water_fraction"]
            for name in conservation.POLLUTANTS:
                columns.extend(name + "_" + field for field in ("baseline", "unit", "coverage_fraction"))
            columns += ["original_attributes", "point_score", "pollutants", "exclusion_reasons"]
            count = 0
            with tempfile.TemporaryDirectory(prefix=".rows-", dir=folder) as temporary:
                staging = Path(temporary)
                with (staging / "candidates.json").open("w", encoding="utf-8", newline="") as output, (
                        staging / "candidates.csv").open("w", encoding="utf-8-sig", newline="") as table:
                    output.write(_json(header)[:-1] + ',"candidates":[')
                    writer = csv.DictWriter(table, fieldnames=columns)
                    writer.writeheader()
                    rows = db.execute("SELECT c.original_json FROM candidates AS c" + where + _order(request), parameters)
                    for source in rows:
                        row = json.loads(source[0])
                        output.write(("," if count else "") + source[0])
                        flat = {field: row.get(field) for field in columns}
                        for name in conservation.POLLUTANTS:
                            for field in ("baseline", "unit", "coverage_fraction"):
                                flat[name + "_" + field] = row["pollutants"][name].get(field)
                        for field in ("original_attributes", "point_score", "pollutants", "exclusion_reasons"):
                            flat[field] = _json(row.get(field))
                        # Preserve text while preventing spreadsheet formula interpretation.
                        for field, item in flat.items():
                            if isinstance(item, str) and item.lstrip().startswith(("=", "+", "-", "@")):
                                flat[field] = "'" + item
                        writer.writerow(flat)
                        count += 1
                    output.write("]}\n")
                for filename in ("candidates.json", "candidates.csv"):
                    (staging / filename).replace(folder / filename)
            result = {
                "schema": "upstate.conservation-candidate-export/v1", "id": key,
                "study_id": state["study_id"], "state": "complete", "reference": reference,
                "count": count, "created_at": now(),
                "files": {name: describe_file(workspace.root, folder / filename)
                          for name, filename in (("json", "candidates.json"), ("csv", "candidates.csv"))},
                "method": "Every matched original candidate; baseline physical units stay separate and full alternative/common-support records remain in the pollutants column and JSON.",
            }
            atomic_json(retained, result, immutable=True)
            return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True, type=Path)
    parser.add_argument("--study-id", required=True)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("prepare")
    commands.add_parser("status")
    for name in ("query", "select", "export"):
        child = commands.add_parser(name)
        child.add_argument("--selection", type=Path)
        if name in ("query", "export"):
            child.add_argument("--retained", type=Path)
    reopen = commands.add_parser("selection")
    reopen.add_argument("selection_id")
    saved = commands.add_parser("plan-save")
    saved.add_argument("--spec", required=True, type=Path)
    detail = commands.add_parser("candidate")
    detail.add_argument("candidate_id")
    args = parser.parse_args(argv)
    from .workspace import Workspace
    workspace = Workspace(args.workspace)
    if args.command == "prepare":
        result = prepare(workspace, args.study_id)
    elif args.command == "status":
        result = status(workspace, args.study_id)
    elif args.command == "selection":
        result = get_selection(workspace, args.study_id, args.selection_id)
    elif args.command == "plan-save":
        value = read_json(args.spec)
        if value.get("study_id", args.study_id) != args.study_id:
            raise ValueError("The plan specification names another original study")
        value["study_id"] = args.study_id
        result = save_selected_plan(workspace, value)
    elif args.command == "candidate":
        result = candidate(workspace, args.study_id, args.candidate_id)
    else:
        value = read_json(args.selection) if args.selection else None
        function = {"query": query, "select": select, "export": export_rows}[args.command]
        if args.command in ("query", "export"):
            retained = read_json(args.retained) if args.retained else None
            result = function(workspace, args.study_id, value, retained)
        else:
            result = function(workspace, args.study_id, value)
    print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
