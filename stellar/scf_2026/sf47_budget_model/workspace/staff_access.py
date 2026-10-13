"""Named installation operators, private sessions and original-case access."""
from __future__ import annotations

from copy import deepcopy
import hashlib
import hmac
import json
import re
import secrets
import time
from uuid import uuid4

from model import Problem, canonical, digest, now, text

SCHEMA = "stellar-forge.sf47-staff.v1"
ROLES = ("lead", "finance", "contributor", "reviewer")
SESSION_SECONDS = 8 * 60 * 60
IDLE_SECONDS = 30 * 60
MEMBER_ID = re.compile(r"[a-z][a-z0-9._-]{2,63}")
CASE_ID = re.compile(r"operation-[a-f0-9]{32}")
PERSON_ID = re.compile(r"person-[a-f0-9]{32}")
MEMBER_COLUMNS = ("id", "display_name", "actor", "role", "case_ids_json",
                  "contributor_ids_json", "is_admin", "state", "credential_hash",
                  "revision", "created_at", "updated_at")


def fail(message, code="STAFF_ACCESS_DENIED", status=403):
    raise Problem(message, status, code)


def secret_hash(value, context):
    return hashlib.sha256((context + "\0" + value).encode("utf-8")).hexdigest()


def owner_principal():
    return {"id": "owner", "displayName": "Installation owner", "actor": "Installation owner",
            "role": "owner", "caseIds": ["*"], "contributorIds": {},
            "administrator": True, "revision": 0}


class StaffAccess:
    """Uses the original SQLite connection and mutex, with no business-record copy."""

    def __init__(self, workspace, owner_token):
        self.workspace, self.owner_token = workspace, owner_token
        with workspace.mutex:
            self.db.executescript("""
                CREATE TABLE IF NOT EXISTS staff_metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS staff_members(
                  id TEXT PRIMARY KEY,display_name TEXT NOT NULL,actor TEXT NOT NULL,
                  role TEXT NOT NULL,case_ids_json TEXT NOT NULL,contributor_ids_json TEXT NOT NULL,
                  is_admin INTEGER NOT NULL,state TEXT NOT NULL,credential_hash TEXT,
                  revision INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS staff_sessions(
                  token_hash TEXT PRIMARY KEY,member_id TEXT NOT NULL,csrf TEXT NOT NULL,
                  created_at INTEGER NOT NULL,last_seen INTEGER NOT NULL,expires_at INTEGER NOT NULL,
                  owner_hash TEXT);
                CREATE TABLE IF NOT EXISTS staff_requests(
                  request_id TEXT PRIMARY KEY,actor TEXT NOT NULL,fingerprint TEXT NOT NULL,
                  result_json TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS staff_events(
                  sequence INTEGER PRIMARY KEY AUTOINCREMENT,at TEXT NOT NULL,actor TEXT NOT NULL,
                  action TEXT NOT NULL,member_id TEXT NOT NULL,detail_json TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS staff_login_attempts(
                  bucket TEXT PRIMARY KEY,started_at INTEGER NOT NULL,attempts INTEGER NOT NULL);
                CREATE INDEX IF NOT EXISTS staff_sessions_member ON staff_sessions(member_id);
            """)
            previous = self.db.execute("SELECT value FROM staff_metadata WHERE key='schema'").fetchone()
            if previous and previous[0] != SCHEMA:
                fail("Use the installed staff-access release.", "STAFF_SCHEMA", 409)
            self.db.execute("INSERT OR IGNORE INTO staff_metadata VALUES('schema',?)", (SCHEMA,))
            self.db.execute("INSERT OR IGNORE INTO staff_metadata VALUES('installation_id',?)", (uuid4().hex,))
            self.installation_id = self.db.execute(
                "SELECT value FROM staff_metadata WHERE key='installation_id'").fetchone()[0]
        self.cookie_name = "sf47_" + self.installation_id

    @property
    def db(self):
        return self.workspace.db

    def event(self, actor, action, member_id, detail=None):
        with self.workspace.mutex:
            self.db.execute("INSERT INTO staff_events(at,actor,action,member_id,detail_json) VALUES(?,?,?,?,?)",
                            (now(), actor, action, member_id, canonical(detail or {})))

    def member(self, member_id):
        row = self.db.execute("SELECT " + ",".join(MEMBER_COLUMNS) + " FROM staff_members WHERE id=?",
                              (member_id,)).fetchone()
        if row is None:
            fail("The selected staff profile is unavailable.", "STAFF_NOT_FOUND", 404)
        return dict(zip(MEMBER_COLUMNS, row))

    @staticmethod
    def principal(row):
        return {"id": row["id"], "displayName": row["display_name"], "actor": row["actor"],
                "role": row["role"], "caseIds": json.loads(row["case_ids_json"]),
                "contributorIds": json.loads(row["contributor_ids_json"]),
                "administrator": bool(row["is_admin"]), "revision": row["revision"]}

    def public_member(self, row):
        stamp = int(time.time())
        count = self.db.execute(
            "SELECT COUNT(*) FROM staff_sessions WHERE member_id=? AND expires_at>? AND last_seen>?",
            (row["id"], stamp, stamp - IDLE_SECONDS)).fetchone()[0]
        return {**self.principal(row), "state": row["state"], "credentialReady": bool(row["credential_hash"]),
                "createdAt": row["created_at"], "updatedAt": row["updated_at"], "activeSessions": count}

    def members(self):
        with self.workspace.mutex:
            return [self.public_member(self.member(row[0])) for row in
                    self.db.execute("SELECT id FROM staff_members ORDER BY display_name,id").fetchall()]

    def events(self, after=0, limit=100):
        if isinstance(after, bool) or not isinstance(after, int) or after < 0:
            fail("Use an event cursor from this installation.", "STAFF_EVENT_CURSOR", 422)
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 500:
            fail("Read between one and 500 access events.", "STAFF_EVENT_LIMIT", 422)
        with self.workspace.mutex:
            rows = self.db.execute(
                "SELECT sequence,at,actor,action,member_id,detail_json FROM staff_events "
                "WHERE sequence>? ORDER BY sequence LIMIT ?", (after, limit + 1)).fetchall()
            shown = rows[:limit]
            return {"events": [dict(sequence=r[0], at=r[1], actor=r[2], action=r[3],
                                   memberId=r[4], detail=json.loads(r[5])) for r in shown],
                    "nextAfter": shown[-1][0] if len(rows) > limit else None}

    def validate_profile(self, body):
        name = text(body.get("displayName"), "Staff name", 180, True)
        role = body.get("role")
        if role not in ROLES:
            fail("Choose lead, finance, contributor or reviewer.", "STAFF_ROLE", 422)
        case_ids = body.get("caseIds")
        if (not isinstance(case_ids, list) or not 1 <= len(case_ids) <= 200
                or any(not isinstance(x, str) for x in case_ids) or len(set(case_ids)) != len(case_ids)):
            fail("Select this person's operating cases.", "STAFF_CASES", 422)
        if "*" in case_ids and case_ids != ["*"]:
            fail("Select all cases or specific cases.", "STAFF_CASES", 422)
        if case_ids != ["*"]:
            for case_id in case_ids:
                if not CASE_ID.fullmatch(case_id) or not self.db.execute(
                        "SELECT 1 FROM ops_programs WHERE id=?", (case_id,)).fetchone():
                    fail("Select an existing operating case.", "STAFF_CASES", 422)
        bindings = body.get("contributorIds", {})
        if not isinstance(bindings, dict) or len(bindings) > 200:
            fail("Use the original case-to-contributor selections.", "STAFF_CONTRIBUTORS", 422)
        for case_id, person_id in bindings.items():
            if (case_id not in case_ids or not isinstance(person_id, str) or not PERSON_ID.fullmatch(person_id)
                    or not self.db.execute("SELECT 1 FROM ops_records WHERE program_id=? "
                                           "AND kind='contributors' AND id=?", (case_id, person_id)).fetchone()):
                fail("Match each contributor to their existing case record.", "STAFF_CONTRIBUTORS", 422)
        if role == "contributor" and (case_ids == ["*"] or set(bindings) != set(case_ids)):
            fail("Give a contributor specific cases and their original contributor record in every case.",
                 "STAFF_CONTRIBUTORS", 422)
        administrator = body.get("administrator", False)
        if not isinstance(administrator, bool):
            fail("Select whether this lead administers the installation.", "STAFF_ADMINISTRATOR", 422)
        if administrator and (role != "lead" or case_ids != ["*"]):
            fail("An installation administrator is a lead with access to all cases.", "STAFF_ADMINISTRATOR", 422)
        return name, role, sorted(case_ids), bindings, int(administrator)

    def control(self, principal, action, body):
        if not principal.get("administrator"):
            fail("Open Staff using an installation administrator profile.")
        allowed = {"requestId", "id", "expectedRevision"}
        if action in ("create", "update"):
            allowed |= {"displayName", "role", "caseIds", "contributorIds", "administrator"}
        if not isinstance(body, dict) or set(body) - allowed:
            fail("Use the staff form's complete selected fields.", "STAFF_INPUT", 422)
        member_id = body.get("id")
        if not isinstance(member_id, str) or not MEMBER_ID.fullmatch(member_id) or member_id == "owner":
            fail("Use a staff sign-in ID of 3–64 lowercase letters, numbers, periods, hyphens or underscores.",
                 "STAFF_ID", 422)
        request_id = body.get("requestId")
        if not isinstance(request_id, str) or not re.fullmatch(r"[A-Za-z0-9._:-]{8,160}", request_id):
            fail("Keep the original staff request ID.", "STAFF_REQUEST_ID", 422)
        fingerprint = digest({"actor": principal["id"], "action": action, "body": body})
        with self.workspace.mutex:
            self.db.execute("BEGIN IMMEDIATE")
            try:
                prior = self.db.execute("SELECT fingerprint,result_json FROM staff_requests WHERE request_id=?",
                                        (request_id,)).fetchone()
                if prior:
                    if not hmac.compare_digest(prior[0], fingerprint):
                        fail("This staff request ID belongs to another change.", "STAFF_REQUEST_CONFLICT", 409)
                    self.db.execute("COMMIT")
                    return {**json.loads(prior[1]), "replayed": True}
                credential = None
                if action == "create":
                    if self.db.execute("SELECT 1 FROM staff_members WHERE id=?", (member_id,)).fetchone():
                        fail("This staff ID already exists. Open its saved profile.", "STAFF_EXISTS", 409)
                    if self.db.execute("SELECT COUNT(*) FROM staff_members").fetchone()[0] >= 200:
                        fail("This installation already has 200 retained staff profiles.", "STAFF_LIMIT", 422)
                    name, role, cases, bindings, administrator = self.validate_profile(body)
                    credential, stamp = secrets.token_urlsafe(32), now()
                    self.db.execute("INSERT INTO staff_members VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                        (member_id, name, name + " [" + member_id + "]", role, canonical(cases),
                         canonical(bindings), administrator, "ACTIVE",
                         secret_hash(credential, "staff-code:" + member_id), 1, stamp, stamp))
                else:
                    row = self.member(member_id)
                    if (isinstance(body.get("expectedRevision"), bool)
                            or not isinstance(body.get("expectedRevision"), int)
                            or body.get("expectedRevision") != row["revision"]):
                        fail("The staff profile changed. Reopen it before saving.", "STAFF_REVISION_CONFLICT", 409)
                    if action == "update":
                        name, role, cases, bindings, administrator = self.validate_profile(body)
                        self.db.execute("UPDATE staff_members SET display_name=?,role=?,case_ids_json=?,"
                                        "contributor_ids_json=?,is_admin=? WHERE id=?",
                                        (name, role, canonical(cases), canonical(bindings), administrator, member_id))
                    elif action == "rotate":
                        credential = secrets.token_urlsafe(32)
                        self.db.execute("UPDATE staff_members SET credential_hash=?,state='ACTIVE' WHERE id=?",
                                        (secret_hash(credential, "staff-code:" + member_id), member_id))
                    elif action == "revoke":
                        self.db.execute("UPDATE staff_members SET credential_hash=NULL,state='REVOKED' WHERE id=?",
                                        (member_id,))
                    elif action != "sign-out":
                        fail("Select an available staff action.", "STAFF_ACTION", 422)
                    self.db.execute("UPDATE staff_members SET revision=revision+1,updated_at=? WHERE id=?",
                                    (now(), member_id))
                    self.db.execute("DELETE FROM staff_sessions WHERE member_id=?", (member_id,))
                    self.db.execute("DELETE FROM staff_login_attempts WHERE bucket=?",
                                    (secret_hash(member_id, "staff-login"),))
                result = {"member": self.public_member(self.member(member_id)),
                          "credentialIssued": credential is not None, "replayed": False}
                self.event(principal["actor"], "staff." + action, member_id,
                           {"role": result["member"]["role"], "caseIds": result["member"]["caseIds"],
                            "revision": result["member"]["revision"], "requestId": request_id})
                # A replay returns the saved profile. Lost one-time credentials are reissued
                # by a new rotate request; neither event nor request storage contains a code.
                self.db.execute("INSERT INTO staff_requests VALUES(?,?,?,?)",
                                (request_id, principal["actor"], fingerprint, canonical(result)))
                self.db.execute("COMMIT")
                return {**result, **({"accessCode": credential} if credential else {})}
            except BaseException:
                self.db.execute("ROLLBACK")
                raise

    def _throttle(self, member_id):
        stamp = int(time.time())
        self.db.execute("DELETE FROM staff_login_attempts WHERE started_at<?", (stamp - 300,))
        # Unknown IDs share one bucket, so requests cannot grow a table of guessed names.
        known = self.db.execute("SELECT 1 FROM staff_members WHERE id=?", (member_id,)).fetchone()
        bucket = secret_hash(member_id if known else "unknown", "staff-login")
        row = self.db.execute("SELECT started_at,attempts FROM staff_login_attempts WHERE bucket=?",
                              (bucket,)).fetchone()
        if row and row[1] >= 20:
            fail("Wait five minutes before trying this sign-in again.", "STAFF_LOGIN_RATE", 429)
        self.db.execute("INSERT INTO staff_login_attempts VALUES(?,?,1) "
                        "ON CONFLICT(bucket) DO UPDATE SET attempts=attempts+1", (bucket, stamp))
        return bucket

    def login(self, member_id, access_code):
        if not isinstance(member_id, str) or not isinstance(access_code, str) or len(access_code) > 128:
            fail("Enter your staff ID and access code.", "STAFF_SIGN_IN", 401)
        member_id = member_id.strip().lower()
        with self.workspace.mutex:
            bucket = self._throttle(member_id)
            try:
                row = self.member(member_id)
            except Problem:
                row = None
            observed = secret_hash(access_code, "staff-code:" + member_id)
            expected = row["credential_hash"] if row and row["credential_hash"] else "0" * 64
            matches = hmac.compare_digest(observed, expected)
            if not row or row["state"] != "ACTIVE" or not row["credential_hash"] or not matches:
                fail("The staff ID or access code was not recognized.", "STAFF_SIGN_IN", 401)
            self.db.execute("DELETE FROM staff_login_attempts WHERE bucket=?", (bucket,))
            return self.start_session(self.principal(row))

    def start_session(self, principal):
        with self.workspace.mutex:
            token, csrf, stamp = secrets.token_urlsafe(32), secrets.token_urlsafe(32), int(time.time())
            self.db.execute("DELETE FROM staff_sessions WHERE expires_at<=? OR last_seen<=?",
                            (stamp, stamp - IDLE_SECONDS))
            sessions = self.db.execute(
                "SELECT token_hash FROM staff_sessions WHERE member_id=? ORDER BY created_at DESC",
                (principal["id"],)).fetchall()
            for row in sessions[9:]:
                self.db.execute("DELETE FROM staff_sessions WHERE token_hash=?", (row[0],))
            self.db.execute("INSERT INTO staff_sessions VALUES(?,?,?,?,?,?,?)",
                (secret_hash(token, self.installation_id), principal["id"], csrf, stamp, stamp,
                 stamp + SESSION_SECONDS, secret_hash(self.owner_token, "owner")
                 if principal["id"] == "owner" else None))
            self.event(principal["actor"], "session.open", principal["id"])
            return {"authenticated": True, "principal": principal, "csrfToken": csrf,
                    "expiresAt": stamp + SESSION_SECONDS, "idleSeconds": IDLE_SECONDS}, token

    def session(self, token):
        if not isinstance(token, str) or not re.fullmatch(r"[A-Za-z0-9_-]{43}", token):
            return None
        with self.workspace.mutex:
            key, stamp = secret_hash(token, self.installation_id), int(time.time())
            row = self.db.execute("SELECT member_id,csrf,created_at,last_seen,expires_at,owner_hash "
                                  "FROM staff_sessions WHERE token_hash=?", (key,)).fetchone()
            if row is None:
                return None
            principal = None
            if row[4] > stamp and row[3] > stamp - IDLE_SECONDS:
                if row[0] == "owner":
                    if hmac.compare_digest(row[5] or "", secret_hash(self.owner_token, "owner")):
                        principal = owner_principal()
                else:
                    try:
                        member = self.member(row[0])
                        if member["state"] == "ACTIVE" and member["credential_hash"]:
                            principal = self.principal(member)
                    except Problem:
                        pass
            if principal is None:
                self.db.execute("DELETE FROM staff_sessions WHERE token_hash=?", (key,))
                return None
            if stamp - row[3] >= 60:
                self.db.execute("UPDATE staff_sessions SET last_seen=? WHERE token_hash=?", (stamp, key))
            return {"authenticated": True, "principal": principal, "csrfToken": row[1],
                    "expiresAt": row[4], "idleSeconds": IDLE_SECONDS}

    def logout(self, token, principal):
        with self.workspace.mutex:
            self.db.execute("DELETE FROM staff_sessions WHERE token_hash=?",
                            (secret_hash(token or "", self.installation_id),))
            self.event(principal["actor"], "session.close", principal["id"])

    @staticmethod
    def case_allowed(principal, case_id):
        return "*" in principal["caseIds"] or case_id in principal["caseIds"]

    def plan_allowed(self, principal, plan_id):
        if "*" in principal["caseIds"]:
            return True
        rows = self.db.execute("SELECT id FROM ops_programs WHERE plan_id=?", (plan_id,)).fetchall()
        return any(self.case_allowed(principal, row[0]) for row in rows)

    def contributor_board(self, principal, operations):
        if principal["role"] != "contributor":
            fail("This work desk belongs to a contributor profile.")
        cases = []
        with self.workspace.mutex:
            for case_id in principal["caseIds"]:
                if not self.case_allowed(principal, case_id):
                    continue
                context = operations._context(case_id)
                person_id = principal["contributorIds"][case_id]
                person = next((r for r in context["records"]["contributors"] if r["id"] == person_id), None)
                if person is None:
                    continue
                work = [r for r in context["records"]["work"] if r["contributorId"] == person_id]
                invoices = [r for r in context["records"]["invoices"] if r["contributorId"] == person_id]
                invoice_ids = {row["id"] for row in invoices}
                invoice_balances = [row for row in operations.report(case_id)["invoices"]
                                    if row["id"] in invoice_ids]
                selected = {sid for row in work + invoices for sid in row.get("sourceIds", [])}
                for (body,) in self.db.execute(
                        "SELECT body_json FROM ops_events WHERE program_id=? AND "
                        "json_extract(body_json,'$.actor')=? AND json_extract(body_json,'$.action')='source.add'",
                        (case_id, principal["actor"])):
                    selected.add(json.loads(body)["recordId"])
                cases.append({"program": context["program"],
                              "contributor": {k: person[k] for k in ("id", "name", "kind", "state")},
                              "packages": [{"id": c["id"], "description": c.get("remaining_work", ""),
                                            "deliverable": c.get("measurable_proof", "")}
                                           for c in context["plan"]["scenario"]["future_costs"]],
                              "work": deepcopy(work), "invoices": deepcopy(invoices),
                              "invoiceBalances": invoice_balances,
                              "sources": [r for sid, r in context["sources"].items() if sid in selected]})
        return {"schema": SCHEMA, "principal": principal, "cases": cases}

    def contributor_source(self, principal, operations, case_id, source_id):
        board = self.contributor_board(principal, operations)
        return any(c["program"]["id"] == case_id and any(s["id"] == source_id for s in c["sources"])
                   for c in board["cases"])

    def contributor_command(self, principal, operations, case_id, body):
        person_id = principal["contributorIds"].get(case_id)
        action, data = body.get("action"), body.get("data", {})
        if not isinstance(data, dict):
            fail("Use the original contributor record.", "STAFF_RECORD", 422)
        if action == "source.add":
            if data.get("kind", "other") not in ("work", "invoice"):
                fail("Choose a work or invoice attachment for this contributor desk.")
            return
        allowed = {"work.save", "work.submit", "work.void", "invoice.save", "invoice.void"}
        if action not in allowed:
            fail("This contributor can record and submit their own work and invoices.")
        kind = "work" if action.startswith("work.") else "invoices"
        previous = operations._record(case_id, kind, data["id"]) if data.get("id") else None
        if previous and previous.get("contributorId") != person_id:
            fail("Select this contributor's original record.")
        if action.endswith(".save") and data.get("contributorId") != person_id:
            fail("Keep the staff profile's original contributor selection.")
        if action.endswith(".void") and (not previous or previous["state"] not in ("LOGGED", "RECEIVED")):
            fail("A reviewer or finance operator handles changes to a submitted record.")
        allowed_sources = {s["id"] for c in self.contributor_board(principal, operations)["cases"]
                           if c["program"]["id"] == case_id for s in c["sources"]}
        source_ids = data.get("sourceIds", [])
        if not isinstance(source_ids, list) or any(not isinstance(s, str) for s in source_ids):
            fail("Select original source attachments as a list of IDs.", "STAFF_RECORD", 422)
        if any(s not in allowed_sources for s in source_ids):
            fail("Attach a source available in this contributor desk.")
