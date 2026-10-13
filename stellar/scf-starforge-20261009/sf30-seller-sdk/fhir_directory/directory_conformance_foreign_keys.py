"""MIT. Exact retained HSDS tabular foreign keys over original Directory rows.

This implementation reads the published declarations without adding relationships.
All candidate rows, every row/declaration outcome and every exact match are kept
in the assessment SQLite file and complete exports. Original source/index bytes
and logical field interpretations remain owned by the existing Directory engine.
"""
from __future__ import annotations
from collections import Counter, defaultdict
from decimal import InvalidOperation
import json
from directory_runtime import InputError, source
from directory_source_schema import standards, MAX_BYTES, MAX_RECORD
from directory_index import IndexBuilder
from eltss_source import JSONReader
import directory_conformance_rules as rules

EDITION = "stellar-forge.directory-conformance.hsds-foreign-keys.20261013"
VERSION = "stellar-forge.directory-conformance-foreign-keys.v1"
MAX_KEY_BYTES = 1048576
MAX_RECORD_BYTES = 4194304
MAX_CANDIDATES = 1000000
MAX_OUTCOMES = 2000000
MAX_MATCHES = 2000000
FILE_KINDS = ("foreignKeys", "foreignKeyCandidates", "foreignKeyMatches", "foreignKeyCoverage")
STATES = ("resolved", "ambiguous", "missing-target", "null-reference",
          "invalid-key", "target-table-unavailable", "representation-not-tabular",
          "unsupported-declaration", "nonmatching-value")
POLICY = {
    "edition": EDITION,
    "declarations": "Every original datapackage foreignKeys array member is separate, including repeated declarations.",
    "source": "https://specs.frictionlessdata.io/table-schema/#foreign-keys",
    "missingValues": "The source table's declared missingValues apply before the original cast_cell interpretation; the default is the single empty-string marker. Absence, JSON null and each physical marker remain distinct in outcomes.",
    "nullMatch": "The selected SQL MATCH SIMPLE interpretation requires no target for an otherwise interpretable tuple with any logical null component. Required/primary-key checks remain separate.",
    "nullMatchSource": "https://www.sqlite.org/foreignkeys.html#composite_foreign_key_constraints",
    "nullMatchStatus": "Explicit implementation interpretation of the Table Schema SQL-style foreign key; no additional composite null rule is attributed to HSDS.",
    "equality": "Each side uses its own original field type/format and the original conformance logical_key. Numeric values remain exact decimals. No SQL affinity, case folding, trimming or string/numeric identity coercion is introduced.",
    "targetScope": "All eligible original target rows in the selected immutable source or edition, including tables not selected for child assertions. No unselected source or remote endpoint is searched.",
    "ambiguity": "Existence can pass when multiple original target rows match. Identity resolution is separately ambiguous, with every candidate retained and no implicit winner.",
    "emptyTables": "The exact original CSV document selection and tables-layout JSON member are read independently of indexed rows. An explicitly present selected empty table establishes coverage; an omitted or edition-excluded table does not. Original JSON key pointers, byte ranges and array counts remain in tableDomains.",
    "representations": "Original CSV rows and top-level records of an explicitly selected HSDS tables JSON document use the tabular declarations. Nested/entity/page rows retain their exact JSON and native links and are explicitly outside this tabular check.",
    "fullValues": "Component previews are bounded descriptors; unchanged complete logical row JSON, physical cells, original member bytes and indices are included in the assessment package."
}

def _sha(value):
    return source.sha(source.jbytes(value))

def _fields(value):
    if type(value) is str and value:
        return [value]
    if isinstance(value, list) and value and all(type(v) is str and v for v in value):
        return list(value)
    raise ValueError("Field names must be one nonempty string or a nonempty array of strings")

def declarations(native=None):
    """Compile each exact original declaration; unsupported clauses stay explicit."""
    native = native or standards()
    output = []
    for table, item in native["tables"].items():
        schema = item["tabular"]["schema"]
        for ordinal, declared in enumerate(schema.get("foreignKeys", [])):
            location = rules.source_location(table, "/foreignKeys/" + str(ordinal), True)
            entry = {"schema": VERSION, "table": table, "declarationOrdinal": ordinal,
                     "requirement": declared, "source": location, "supported": True}
            try:
                if not isinstance(declared, dict) or set(declared) != {"fields", "reference"}:
                    raise ValueError("Only the exact published fields/reference declaration is implemented")
                ref = declared["reference"]
                if not isinstance(ref, dict) or set(ref) != {"resource", "fields"} or type(ref["resource"]) is not str:
                    raise ValueError("A reference must name its original resource and fields")
                local, target = _fields(declared["fields"]), _fields(ref["fields"])
                if len(local) != len(target) or len(set(local)) != len(local) or len(set(target)) != len(target):
                    raise ValueError("Original local and target field tuples must have equal, nonrepeating members")
                if type(declared["fields"]) is not type(ref["fields"]):
                    raise ValueError("Original local and target field declarations must use the same string/array form")
                target_table = ref["resource"] or table
                if target_table not in native["tables"]:
                    raise ValueError("The original target resource is outside this retained datapackage")
                target_schema = native["tables"][target_table]["tabular"]["schema"]
                local_specs = {f["name"]: f for f in schema["fields"]}
                target_specs = {f["name"]: f for f in target_schema["fields"]}
                if any(name not in local_specs for name in local) or any(name not in target_specs for name in target):
                    raise ValueError("An original field tuple names a field outside its retained table schema")
                for selected in (schema, target_schema):
                    missing = selected.get("missingValues", [""])
                    if not isinstance(missing, list) or any(type(v) is not str for v in missing):
                        raise ValueError("The original missingValues declaration is not an array of physical strings")
                group = {"table": target_table, "fields": target,
                         "fieldDeclarations": [target_specs[f] for f in target],
                         "missingValues": target_schema.get("missingValues", [""])}
                entry.update(fields=local, targetTable=target_table, targetFields=target,
                    selfReference=ref["resource"] == "", composite=len(local) > 1,
                    fieldDeclarations=[local_specs[f] for f in local],
                    missingValues=schema.get("missingValues", [""]),
                    targetGroupId=_sha(group), targetGroup=group)
            except (KeyError, TypeError, ValueError) as error:
                entry.update(supported=False, unsupportedReason=str(error))
            entry["id"] = _sha(entry)
            output.append(entry)
    return output

def catalogue_rules(native=None):
    result = []
    for declared in declarations(native):
        rule = {"family": "hsds-tabular-3.3.1", "table": declared["table"],
                "keyword": "foreignKey", "requirement": declared["requirement"],
                "mode": "evaluated" if declared["supported"] else "unevaluated",
                "checkScope": POLICY["targetScope"], "source": declared["source"],
                "declarationId": declared["id"], "implementationEdition": EDITION,
                "semantics": POLICY}
        if not declared["supported"]:
            rule["unsupportedReason"] = declared["unsupportedReason"]
        rule["id"] = _sha(rule)
        result.append(rule)
    return result

def original_ref(row):
    return {"nativeRef": row["ref"], **{key: row.get(key) for key in (
        "sourceId", "recordId", "table", "rowOrdinal", "rowSha256",
        "resourceSha256", "memberName", "memberSha256", "pointer",
        "rawRange", "representation", "parentRecordId", "nativeId") if key in row}}

def _has_nan(value):
    if rules.number(value):
        try:
            return rules.logical_number(value).is_nan()
        except InvalidOperation:
            return True
    if isinstance(value, list):
        return any(_has_nan(v) for v in value)
    if isinstance(value, dict):
        return any(_has_nan(v) for v in value.values())
    return False

def interpreted_key(row, fields, declarations_, missing, logical_key):
    """Return an exact checking key plus full component interpretation descriptors."""
    data = row.get("data")
    if not isinstance(data, dict):
        return {"state": "invalid", "components": [], "reason": "Original row is not an object",
                "keyJson": None, "keySha256": None}
    components, logical = [], []
    invalid, null, nonmatching = False, False, False
    headers = row.get("headers")
    for field, spec in zip(fields, declarations_):
        raw = data.get(field, rules.ABSENT)
        part = {"field": field, "pointer": "/" + rules.ptr(field),
                "originalPointer": (row.get("pointer") or "") + "/" + rules.ptr(field),
                "fieldDeclaration": spec, "physical": rules.described(raw)}
        if headers is not None:
            positions = [i for i, name in enumerate(headers) if name == field]
            part["headerPositions"] = positions
            if len(positions) > 1:
                part.update(state="ambiguous-header", reason="The original file repeats this exact column name")
                invalid = True
                components.append(part)
                continue
        if raw is rules.ABSENT:
            part.update(state="absent", logicalNull=True)
            logical.append(None)
            null = True
        elif raw is None:
            part.update(state="null", logicalNull=True)
            logical.append(None)
            null = True
        elif rules.kind(raw) == "string" and raw in missing:
            part.update(state="missing-value", matchedMarker=raw, logicalNull=True)
            logical.append(None)
            null = True
        else:
            try:
                value = rules.cast_cell(raw, spec)
                key = logical_key(value)
                part.update(state="value", logical=key)
                logical.append(value)
                nonmatching = nonmatching or _has_nan(value)
            except (ValueError, TypeError, InvalidOperation) as error:
                part.update(state="invalid", reason=str(error))
                invalid = True
        components.append(part)
    state = "invalid" if invalid else "null" if null else "nonmatching" if nonmatching else "value"
    key_json = source.jbytes([logical_key(v) for v in logical]).decode() if state in {"value", "nonmatching"} else None
    if key_json is not None and len(key_json.encode()) > MAX_KEY_BYTES:
        raise InputError("An exact interpreted foreign-key tuple exceeds its explicit 1 MiB key budget")
    value = {"state": state, "components": components, "keyJson": key_json,
             "keySha256": source.sha(key_json.encode()) if key_json is not None else None}
    if len(source.jbytes(value)) > MAX_RECORD_BYTES:
        raise InputError("A complete foreign-key interpretation exceeds the original interactive record budget")
    return value

SCHEMA = """
CREATE TABLE foreign_key_rules(ordinal INTEGER PRIMARY KEY,rule_id TEXT UNIQUE,table_name TEXT,target_table TEXT,group_id TEXT,body TEXT);
CREATE TABLE foreign_key_groups(group_id TEXT PRIMARY KEY,table_name TEXT,body TEXT);
CREATE TABLE foreign_key_documents(source_id TEXT,member_name TEXT,member_sha TEXT,body TEXT,PRIMARY KEY(source_id,member_name));
CREATE TABLE foreign_key_domains(ordinal INTEGER PRIMARY KEY,source_id TEXT,table_name TEXT,member_name TEXT,pointer TEXT,selected INTEGER,body TEXT,
    UNIQUE(source_id,table_name,member_name,pointer));
CREATE INDEX foreign_key_domain_table ON foreign_key_domains(table_name);
CREATE TABLE foreign_key_candidates(ordinal INTEGER PRIMARY KEY,id TEXT UNIQUE,group_id TEXT,source_id TEXT,record_id TEXT,
    table_name TEXT,state TEXT,key_sha TEXT,key_json TEXT,body TEXT,UNIQUE(group_id,source_id,record_id));
CREATE INDEX foreign_key_candidate_lookup ON foreign_key_candidates(group_id,state,key_sha);
CREATE TABLE foreign_keys(ordinal INTEGER PRIMARY KEY,id TEXT UNIQUE,rule_id TEXT,source_id TEXT,record_id TEXT,
    table_name TEXT,state TEXT,constraint_outcome TEXT,key_sha TEXT,key_json TEXT,candidate_count INTEGER,body TEXT,
    UNIQUE(rule_id,source_id,record_id));
CREATE INDEX foreign_key_outcome_filter ON foreign_keys(rule_id,table_name,state);
CREATE INDEX foreign_key_outcome_record ON foreign_keys(source_id,record_id);
CREATE TABLE foreign_key_matches(ordinal INTEGER PRIMARY KEY,id TEXT UNIQUE,outcome_id TEXT,candidate_id TEXT,body TEXT,
    UNIQUE(outcome_id,candidate_id));
CREATE INDEX foreign_key_match_outcome ON foreign_key_matches(outcome_id);
"""

class ForeignKeyAssessment:
    def __init__(self, workspace, plan, sink, logical_key):
        self.ws, self.plan, self.sink = workspace, plan, sink
        self.db, self.logical_key = sink.db, logical_key
        self.all_rules = declarations()
        self.rules = [r for r in self.all_rules if r["table"] in plan["tables"]]
        self.by_table = defaultdict(list)
        self.groups = {}
        for declared in self.rules:
            self.by_table[declared["table"]].append(declared)
            if declared["supported"]:
                self.groups[declared["targetGroupId"]] = declared["targetGroup"]
        self.outcomes = self.matches = self.candidates = 0
        self.context_rows = self.non_tabular_targets = 0
        self.state_counts = Counter()
        self.target_coverage = {}
        self.db.executescript(SCHEMA)
        for rule in self.rules:
            self.db.execute("INSERT INTO foreign_key_rules VALUES(NULL,?,?,?,?,?)",
                (rule["id"], rule["table"], rule.get("targetTable"), rule.get("targetGroupId"),
                 source.jbytes(rule).decode()))
        for group_id, group in sorted(self.groups.items()):
            self.db.execute("INSERT INTO foreign_key_groups VALUES(?,?,?)",
                (group_id, group["table"], source.jbytes(group).decode()))

    def _domain(self, row, representation, declaration, *, selected=True,
                pointer="", key_range=None, value_range=None, row_count=None):
        value = {"sourceId": row["sourceId"], "table": row["table"],
                 "memberName": row["memberName"], "memberSha256": row["memberSha256"],
                 "representation": representation, "selected": selected,
                 "coverage": "original-selected-table" if selected else "original-table-outside-selected-edition",
                 "selection": declaration, "pointer": pointer, "tableRows": row_count}
        if representation == "csv":
            value["presenceBasis"] = "Explicit original CSV document selection, including an empty table"
        else:
            value.update(keyRawRange=key_range, rawRange=value_range,
                presenceBasis="Exact original tables-layout JSON key and array read by the original streaming parser, including an empty array")
        self.db.execute("INSERT INTO foreign_key_domains VALUES(NULL,?,?,?,?,?,?)",
            (row["sourceId"], row["table"], row["memberName"], pointer, int(selected), source.jbytes(value).decode()))

    def _table_domains(self, ident, document, allowed):
        """Retain original table presence without inferring it from indexed rows."""
        path, descriptor = self.ws.directory_source_file(ident, document["name"])
        if descriptor["sha256"] != document["sha256"] or descriptor["bytes"] != document["bytes"]:
            raise InputError("The complete original JSON member differs from its frozen source index")
        native = standards()
        known = {name: name for name in native["tables"]}
        known.update({item["schema"]["path"]: name for name, item in native["tables"].items()})
        with path.open("rb") as stream:
            reader = JSONReader(stream, MAX_BYTES)
            reader.take(123)
            seen = set()
            reader.space()
            if reader.peek() != 125:
                while True:
                    _, key, key_start, key_end = reader.raw(65536)
                    if type(key) is not str or key in seen:
                        raise InputError("The original directory JSON repeats a key or has a non-text key")
                    seen.add(key)
                    reader.take(58)
                    reader.space()
                    start = reader.offset
                    if key in known:
                        # Reuse the exact maintained array reader used by the
                        # source index; each complete original value is bounded.
                        def consume(value, ordinal, raw, span):
                            if not isinstance(value, dict):
                                raise InputError("An original tabular array member must remain an object")
                            if ordinal % 100 == 0:
                                self.sink.budget()
                        count = IndexBuilder._array(None, reader, consume)
                        table = known[key]
                        self._domain({"sourceId": ident, "table": table,
                            "memberName": document["name"], "memberSha256": document["sha256"]},
                            "tables-json", document["selection"],
                            selected=not allowed or table in allowed,
                            pointer="/" + rules.ptr(key), key_range=[key_start, key_end],
                            value_range=[start, reader.offset], row_count=count)
                    else:
                        reader.raw(MAX_RECORD)
                    reader.space()
                    if reader.peek() == 125:
                        break
                    reader.take(44)
            reader.take(125)
            reader.space()
            if reader.peek() is not None or reader.offset != descriptor["bytes"]:
                raise InputError("The complete original tables JSON member did not end at its declared bytes")
        self.sink.budget()

    def _representation(self, row):
        if row.get("protocol") != "hsds":
            return None
        if "headers" in row:
            return "csv"
        if row.get("parentRecordId") is not None:
            return None
        found = self.db.execute("SELECT member_sha,body FROM foreign_key_documents WHERE source_id=? AND member_name=?",
            (row["sourceId"], row["memberName"])).fetchone()
        if found is None or found["member_sha"] != row["memberSha256"]:
            raise InputError("Foreign-key context must retain the exact original source document")
        document = source.json_value(found["body"])
        selected = document["selection"]
        if selected.get("format") == "hsds-json" and selected.get("layout") == "tables":
            return "tables-json"
        return None

    def prepare(self, native):
        """Index original target rows once on disk, independently of child order."""
        selected_tables = {}
        if self.plan["subjectKind"] == "editions":
            summary = source.json_value(native.execute("SELECT body FROM summary WHERE key='summary'").fetchone()[0])
            selected_tables = {r["sourceId"]: set(r["tables"]) for r in summary["sources"]}
            if set(selected_tables) != {r["sourceId"] for r in self.plan["sourceRefs"]}:
                raise InputError("The original edition source inventory differs from its frozen conformance plan")
        for ref in self.plan["sourceRefs"]:
            ident = ref["sourceId"]
            allowed = selected_tables.get(ident, set())
            with self.ws.directory_open_index("sources", ident) as original:
                for stored in original.execute("SELECT body FROM documents ORDER BY name"):
                    document = source.json_value(stored["body"])
                    selection = document["selection"]
                    self.db.execute("INSERT INTO foreign_key_documents VALUES(?,?,?,?)",
                        (ident, document["name"], document["sha256"], source.jbytes(document).decode()))
                    if selection.get("format") == "hsds-csv":
                        table = selection["table"]
                        self._domain({"sourceId": ident, "table": table, "memberName": document["name"],
                            "memberSha256": document["sha256"]}, "csv", selection,
                            selected=not allowed or table in allowed, row_count=document["indexedRecords"])
                    elif selection.get("format") == "hsds-json" and selection.get("layout") == "tables":
                        self._table_domains(ident, document, allowed)
        target_tables = defaultdict(list)
        for group_id, group in self.groups.items():
            target_tables[group["table"]].append((group_id, group))
        for row in self.ws.directory_iter_rows(self.plan["subjectKind"], self.plan["subjectId"]):
            self.context_rows += 1
            representation = self._representation(row)
            if row["table"] not in target_tables:
                continue
            for group_id, group in target_tables[row["table"]]:
                if representation:
                    checked = interpreted_key(row, group["fields"], group["fieldDeclarations"],
                        group["missingValues"], self.logical_key)
                else:
                    checked = {"state": "representation-not-tabular", "components": [],
                        "keyJson": None, "keySha256": None}
                    self.non_tabular_targets += 1
                value = {"schema": VERSION, "kind": "candidate", "groupId": group_id,
                         "table": row["table"], "ref": original_ref(row),
                         "representation": representation, **checked}
                ident = _sha(value)
                value = {"id": ident, **value}
                body = source.jbytes(value)
                if len(body) > MAX_RECORD_BYTES:
                    raise InputError("A complete original foreign-key target exceeds 4 MiB")
                self.db.execute("INSERT INTO foreign_key_candidates VALUES(NULL,?,?,?,?,?,?,?,?,?)",
                    (ident, group_id, row["sourceId"], row["recordId"], row["table"],
                     checked["state"], checked["keySha256"], checked["keyJson"], body.decode()))
                self.candidates += 1
                if self.candidates > MAX_CANDIDATES:
                    raise InputError("Complete foreign-key candidate index exceeds one million original rows")
            if self.context_rows % 100 == 0:
                self.db.commit()
                self.sink.budget()
        self.db.commit()
        self.sink.budget()

    def _target_coverage(self, declared):
        table, group_id = declared["targetTable"], declared["targetGroupId"]
        if group_id in self.target_coverage:
            return self.target_coverage[group_id]
        count = self.db.execute("""SELECT count(*) FROM
            (SELECT DISTINCT source_id,member_name FROM foreign_key_domains WHERE table_name=? AND selected=1)""",
            (table,)).fetchone()[0]
        states = {r[0]: r[1] for r in self.db.execute(
            "SELECT state,count(*) FROM foreign_key_candidates WHERE group_id=? GROUP BY state", (group_id,))}
        self.target_coverage[group_id] = {"targetTable": table, "groupId": group_id, "presentSelectedDocuments": count,
                "establishedTabularCoverage": count > 0, "candidateStates": states,
                "scope": POLICY["targetScope"]}
        return self.target_coverage[group_id]

    def check(self, row):
        for declared in self.by_table.get(row["table"], []):
            self._check(row, declared)

    def _check(self, row, declared):
        representation = self._representation(row)
        checked = {"state": None, "components": [], "keyJson": None, "keySha256": None}
        targets = None
        coverage = None
        candidate_count = 0
        if not declared["supported"]:
            state, outcome = "unsupported-declaration", "not-evaluated"
        elif not representation:
            state, outcome = "representation-not-tabular", "not-evaluated"
        else:
            checked = interpreted_key(row, declared["fields"], declared["fieldDeclarations"],
                declared["missingValues"], self.logical_key)
            coverage = self._target_coverage(declared)
            if checked["state"] == "invalid":
                state, outcome = "invalid-key", "error"
            elif checked["state"] == "null":
                state, outcome = "null-reference", "pass"
            elif checked["state"] == "nonmatching":
                state, outcome = "nonmatching-value", "error"
            elif not coverage["establishedTabularCoverage"]:
                state, outcome = "target-table-unavailable", "not-evaluated"
            else:
                params = (declared["targetGroupId"], checked["keySha256"], checked["keyJson"])
                candidate_count = self.db.execute(
                    "SELECT count(*) FROM foreign_key_candidates WHERE group_id=? AND state='value' AND key_sha=? AND key_json=?",
                    params).fetchone()[0]
                state = "resolved" if candidate_count == 1 else "ambiguous" if candidate_count > 1 else "missing-target"
                outcome = "pass" if candidate_count else "error"
                targets = params
        value = {"schema": VERSION, "kind": "outcome", "declarationId": declared["id"],
                 "table": row["table"], "ref": original_ref(row), "source": declared["source"],
                 "requirement": declared["requirement"], "representation": representation,
                 "state": state, "constraintOutcome": outcome,
                 "resolutionOutcome": "ambiguous" if state == "ambiguous" else state,
                 "components": checked["components"], "keyJson": checked["keyJson"],
                 "keySha256": checked["keySha256"], "candidateCount": candidate_count,
                 "candidateGroupId": declared.get("targetGroupId"), "targetCoverage": coverage,
                 "targetMatches": "foreignKeyMatches; filter outcomeId for every original match",
                 "nullPolicy": POLICY["nullMatch"] if state == "null-reference" else None}
        ident = _sha(value)
        value = {"id": ident, **value}
        body = source.jbytes(value)
        if len(body) > MAX_RECORD_BYTES:
            raise InputError("A complete foreign-key outcome exceeds 4 MiB")
        self.db.execute("INSERT INTO foreign_keys VALUES(NULL,?,?,?,?,?,?,?,?,?,?,?)",
            (ident, declared["id"], row["sourceId"], row["recordId"], row["table"], state, outcome,
             checked["keySha256"], checked["keyJson"], candidate_count, body.decode()))
        self.outcomes += 1
        self.state_counts[state] += 1
        if self.outcomes > MAX_OUTCOMES:
            raise InputError("Complete foreign-key assessment exceeds two million row/declaration outcomes")
        if targets and candidate_count:
            for candidate in self.db.execute(
                    "SELECT id,body FROM foreign_key_candidates WHERE group_id=? AND state='value' AND key_sha=? AND key_json=? ORDER BY ordinal",
                    targets):
                target = source.json_value(candidate["body"])
                match = {"schema": VERSION, "kind": "match", "outcomeId": ident,
                         "candidateId": candidate["id"], "declarationId": declared["id"],
                         "sourceRef": original_ref(row), "targetRef": target["ref"],
                         "keySha256": checked["keySha256"], "groupId": declared["targetGroupId"]}
                match_id = _sha(match)
                match = {"id": match_id, **match}
                self.db.execute("INSERT INTO foreign_key_matches VALUES(NULL,?,?,?,?)",
                    (match_id, ident, candidate["id"], source.jbytes(match).decode()))
                self.matches += 1
                if self.matches > MAX_MATCHES:
                    raise InputError("Complete foreign-key match index exceeds two million original edges")
        code = "tabular-foreign-key"
        self.sink.count(code, outcome)
        if outcome != "pass":
            messages = {
                "missing-target": "No eligible original target in the selected table has this complete interpreted field tuple.",
                "invalid-key": "The complete original key cannot be unambiguously interpreted using its retained field declarations.",
                "target-table-unavailable": "This subject does not establish tabular coverage of the declared target table. No remote absence is inferred.",
                "representation-not-tabular": "This original row is a nested/entity/page JSON representation; its native parent/reference relationships do not create missing tabular foreign-key fields.",
                "unsupported-declaration": "This original declaration contains an unsupported shape; its full source remains in coverage.",
                "nonmatching-value": "An original logical NaN key does not equal any value, including itself."}
            self.sink.emit(code, outcome, "/" + rules.ptr(declared.get("fields", [""])[0]) if declared.get("fields") else "",
                messages[state], {**declared["source"], "declarationId": declared["id"], "outcomeId": ident},
                {"state": state, "components": checked["components"], "candidateCount": candidate_count,
                 "targetCoverage": coverage})
        if state == "ambiguous":
            self.sink.count("tabular-foreign-key-identity", "warning")
            self.sink.emit("tabular-foreign-key-identity", "warning",
                "/" + rules.ptr(declared["fields"][0]),
                "The foreign-key existence condition passes, but multiple original target rows match. Every candidate is retained; no identity is selected.",
                {**declared["source"], "declarationId": declared["id"], "outcomeId": ident},
                {"candidateCount": candidate_count, "keySha256": checked["keySha256"],
                 "completeTargets": "foreignKeyMatches", "outcomeId": ident})
        elif state == "resolved":
            self.sink.count("tabular-foreign-key-identity", "pass")

    def finish(self):
        declared_rows = []
        for declared in self.all_rules:
            counts = {r[0]: r[1] for r in self.db.execute(
                "SELECT state,count(*) FROM foreign_keys WHERE rule_id=? GROUP BY state", (declared["id"],))}
            declared_rows.append({**declared, "selected": declared["table"] in self.plan["tables"],
                                  "outcomes": {state: counts.get(state, 0) for state in STATES},
                                  "checkedOriginalRows": sum(counts.values())})
        domains = [source.json_value(r[0]) for r in self.db.execute(
            "SELECT body FROM foreign_key_domains ORDER BY source_id,table_name,member_name,pointer")]
        groups = []
        for ident, group in sorted(self.groups.items()):
            counts = {r[0]: r[1] for r in self.db.execute(
                "SELECT state,count(*) FROM foreign_key_candidates WHERE group_id=? GROUP BY state", (ident,))}
            groups.append({"id": ident, **group, "candidateStates": counts})
        value = {"schema": VERSION, "implementationEdition": EDITION, "policy": POLICY,
                 "originalStandard": standards()["source"],
                 "originalDatapackageVersion": standards()["datapackage"].get("version"),
                 "subjectKind": self.plan["subjectKind"], "subjectId": self.plan["subjectId"],
                 "selectedChildTables": self.plan["tables"],
                 "selectedSources": [r["sourceId"] for r in self.plan["sourceRefs"]],
                 "declaredForeignKeys": len(self.all_rules), "selectedDeclarations": len(self.rules),
                 "declaredCompositeKeys": sum(bool(r.get("composite")) for r in self.all_rules),
                 "selectedCompositeKeys": sum(bool(r.get("composite")) for r in self.rules),
                 "contextOriginalRows": self.context_rows,
                 "outcomeRows": self.outcomes, "candidateRows": self.candidates, "matchRows": self.matches,
                 "states": {state: self.state_counts[state] for state in STATES},
                 "declarations": declared_rows, "targetGroups": groups, "tableDomains": domains,
                 "limits": {"keyBytes": MAX_KEY_BYTES, "recordBytes": MAX_RECORD_BYTES,
                            "candidateRows": MAX_CANDIDATES, "outcomeRows": MAX_OUTCOMES, "matchRows": MAX_MATCHES},
                 "meaning": "Complete declared-key evaluation within the original selected population. Existence, identity ambiguity, nulls, unsupported representations and missing target coverage are separate outcomes."}
        raw = source.jbytes(value)
        if len(raw) > MAX_RECORD_BYTES:
            raise InputError("Complete original foreign-key coverage exceeds 4 MiB; select a smaller subject")
        self.db.execute("INSERT INTO metadata VALUES(?,?)", ("foreignKeyCoverage", raw.decode()))
        return value

def verify_index(db, expected):
    """Validate complete received relationship files against their native index."""
    metadata = db.execute("SELECT body FROM metadata WHERE name='foreignKeyCoverage'").fetchone()
    if metadata is None:
        raise InputError("Receive the complete foreign-key coverage from this implementation edition")
    actual = source.json_value(metadata[0])
    summary = {key: actual[key] for key in (
        "implementationEdition", "declaredForeignKeys", "selectedDeclarations",
        "declaredCompositeKeys", "selectedCompositeKeys", "outcomeRows", "candidateRows", "matchRows", "states")}
    if summary != expected:
        raise InputError("The original foreign-key summary differs from its exact native coverage")
    for name, key in (("foreign_keys", "outcomeRows"), ("foreign_key_candidates", "candidateRows"),
                      ("foreign_key_matches", "matchRows")):
        if db.execute("SELECT count(*) FROM " + name).fetchone()[0] != actual[key]:
            raise InputError("The received foreign-key file/index count is incomplete")
    if db.execute("""SELECT count(*) FROM foreign_key_matches m
        LEFT JOIN foreign_keys o ON o.id=m.outcome_id
        LEFT JOIN foreign_key_candidates c ON c.id=m.candidate_id
        WHERE o.id IS NULL OR c.id IS NULL OR c.state!='value' OR o.key_sha!=c.key_sha OR o.key_json!=c.key_json""").fetchone()[0]:
        raise InputError("A received original foreign-key edge lost its exact source or target")
    if db.execute("""SELECT count(*) FROM foreign_keys o WHERE o.candidate_count !=
        (SELECT count(*) FROM foreign_key_matches m WHERE m.outcome_id=o.id)""").fetchone()[0]:
        raise InputError("Receive every original matching candidate for each declared-key outcome")
    return actual
