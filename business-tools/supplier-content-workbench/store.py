"""Transactional supplier review, immutable product editions, and exact receiving."""
from __future__ import annotations
import base64, csv, fcntl, hashlib, hmac, io, json, os, re, secrets, sqlite3, struct, threading, time, zipfile, zlib
from pathlib import Path
from contextlib import suppress
from urllib.parse import quote
from core import *
from intake import parse_source, validate_source, inspect_source, canonical_item, zip_members

DDL = {
 "meta": "CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)",
 "users": "CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,role TEXT NOT NULL,supplier_id TEXT,active INTEGER NOT NULL,revision INTEGER NOT NULL,salt TEXT NOT NULL,password_hash TEXT NOT NULL,totp_secret TEXT,totp_pending TEXT,totp_last INTEGER NOT NULL,created_at TEXT NOT NULL)",
 "sessions": "CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires INTEGER NOT NULL)",
 "entities": "CREATE TABLE entities(kind TEXT NOT NULL,id TEXT NOT NULL,supplier_id TEXT,status TEXT NOT NULL,created_at TEXT NOT NULL,revision INTEGER NOT NULL,body BLOB NOT NULL,PRIMARY KEY(kind,id))",
 "sources": "CREATE TABLE sources(sha256 TEXT PRIMARY KEY,bytes INTEGER NOT NULL,payload BLOB NOT NULL)",
 "requests": "CREATE TABLE requests(user_id TEXT NOT NULL,id TEXT NOT NULL,path TEXT NOT NULL,body_sha256 TEXT NOT NULL,response BLOB NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(user_id,id))",
 "audit": "CREATE TABLE audit(seq INTEGER PRIMARY KEY,event_id TEXT UNIQUE NOT NULL,actor_id TEXT NOT NULL,action TEXT NOT NULL,object_id TEXT,created_at TEXT NOT NULL,previous_sha256 TEXT NOT NULL,sha256 TEXT NOT NULL,body BLOB NOT NULL)",
}
INDEXES = {
 "entities_listing": "CREATE INDEX entities_listing ON entities(kind,supplier_id,status,created_at)",
 "sessions_user": "CREATE INDEX sessions_user ON sessions(user_id)",
}
ROLES = ("admin", "reviewer", "supplier_admin", "supplier")
STAFF = ("admin", "reviewer")
SOURCE_NOTES = [
 {"title": "Supplier operations workbench", "text": "Integration tooling for a qualified platform partner. Production identity, hosting authorization, data-pool service and government interfaces belong to the agreed deployment."},
 {"title": "Original source attribution", "text": "Publisher documentation examples retain their original message identities and source label. Recorded file acknowledgments are operator-supplied statements tied to one exact release."},
 {"title": "Integration targets", "text": "Mapping names identify proposed target agreements. A mapped package becomes a government interface only after the prime and government agree its actual schema and endpoints."},
]
APP_FILES = ("core.py","intake.py","store.py","server.py","README.md","web/index.html","web/app.js","web/style.css")
def packed(value):
    return zlib.compress(canonical(value), 6)
def unpacked(raw):
    return json.loads(decompressed(raw))
def password_key(password, salt):
    need(isinstance(password, str) and 12 <= len(password) <= 1024, "PASSWORD_LENGTH", "Use a password with at least 12 characters.")
    return hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1).hex()
def request_fingerprint(raw, previous=None):
    """Slow salted binding for requests that contain account credentials."""
    if previous is None:
        salt = secrets.token_hex(16)
    else:
        parts = previous.split("$")
        need(len(parts) == 3 and parts[0] == "scrypt" and re.fullmatch(r"[0-9a-f]{32}", parts[1]),
             "REQUEST_FINGERPRINT", "The retained credential request fingerprint is invalid.", 409)
        salt = parts[1]
    value = hashlib.scrypt(raw, salt=bytes.fromhex(salt), n=16384, r=8, p=1).hex()
    return "scrypt$" + salt + "$" + value

def public_user(row):
    return {k: row[k] for k in ("id","email","name","role","supplier_id","revision","created_at")} | {
        "active": bool(row["active"]), "mfa_enabled": bool(row["totp_secret"])}
def otp_step(secret, otp, last=-1):
    if not isinstance(otp, str) or not re.fullmatch(r"\d{6}", otp):
        return None
    key = base64.b32decode(secret, casefold=True)
    current = int(time.time()) // 30
    for step in (current, current-1, current+1):
        if step <= last:
            continue
        value = hmac.new(key, struct.pack(">Q", step), hashlib.sha1).digest()
        offset = value[-1] & 15
        number = (int.from_bytes(value[offset:offset+4], "big") & 0x7fffffff) % 1000000
        if hmac.compare_digest(f"{number:06d}", otp):
            return step
    return None

def render_release(products, fields, fmt):
    """Render exact approved editions in the original selection and field order."""
    need(isinstance(products, list) and 1 <= len(products) <= 5000 and
         all(isinstance(p, dict) and isinstance(p.get("id"), str) for p in products) and
         len({p["id"] for p in products}) == len(products),
         "PRODUCT_SELECTION", "Select distinct approved product editions.")
    need(fmt in ("csv", "json") and isinstance(fields, list) and 1 <= len(fields) <= 512 and
         all(isinstance(f, dict) and isinstance(f.get("source"), str) and f["source"] and
             isinstance(f.get("target"), str) and f["target"] and type(f.get("required")) is bool for f in fields) and
         len({f["target"] for f in fields}) == len(fields),
         "MAPPING_FIELDS", "The original mapping must have unique ordered target fields.")
    rows, selected, issues = [], [], []
    for p in products:
        key = p["id"]
        record = {}
        for field in fields:
            value = field_at(p["item"], field["source"])
            if value is None or value == "" or value == []:
                issues.append({"product_id":key, "gtin":p["gtin"], "field":field["source"], "target":field["target"],
                               "severity":"error" if field["required"] else "warning",
                               "message":"No mapped source value is present."})
            record[field["target"]] = value
        rows.append(record)
        selected.append({k:p[k] for k in ("id","key","gtin","identifier_type","identifier","identifier_namespace",
                                          "edition","submission_id","source_sha256","supplier_id","source_label")})
    if fmt == "json":
        raw = canonical({"items":rows}) + b"\n"
    else:
        out = io.StringIO(newline="")
        writer = csv.DictWriter(out, fieldnames=[f["target"] for f in fields], lineterminator="\r\n")
        writer.writeheader()
        for row in rows:
            converted = {}
            for key, value in row.items():
                # Keep the original value; spreadsheet consumers must import columns as text.
                converted[key] = canonical(value).decode() if isinstance(value,(dict,list)) else "" if value is None else str(value)
            writer.writerow(converted)
        raw = out.getvalue().encode("utf-8")
    need(len(raw) <= MAX_UPLOAD, "RELEASE_SIZE", "This mapped release exceeds the supported 48 MiB original-file size.", 413)
    return {"rows":rows, "products":selected, "findings":issues, "sha256":digest(raw), "bytes":len(raw)}, raw

class Store:
    def __init__(self, directory, app_root=None):
        self.root = Path(directory).expanduser().resolve()
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(self.root, 0o700)
        self.app_root = Path(app_root or Path(__file__).parent).resolve()
        self.lease = (self.root / "INSTANCE.lock").open("a+b")
        try:
            fcntl.flock(self.lease.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            self.lease.close()
            raise Problem("WORKSPACE_ALREADY_OPEN", "This workspace is already open in its original process.", 409) from exc
        self.lock = threading.RLock()
        self.db = None
        try:
            self.db = sqlite3.connect(self.root / "state.sqlite3", isolation_level=None, check_same_thread=False)
            os.chmod(self.root / "state.sqlite3", 0o600)
            self.db.row_factory = sqlite3.Row
            self.db.execute("PRAGMA synchronous=FULL")
            self.db.execute("PRAGMA journal_mode=DELETE")
            self.db.execute("PRAGMA foreign_keys=ON")
            self.db.execute("PRAGMA busy_timeout=5000")
            if not self.db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='meta'").fetchone():
                with self.transaction():
                    for statement in DDL.values():
                        self.db.execute(statement)
                    for statement in INDEXES.values():
                        self.db.execute(statement)
                    for key, value in {"schema":SCHEMA, "id":ident("workspace"), "created_at":now()}.items():
                        self.db.execute("INSERT INTO meta VALUES(?,?)", (key, value))
            need(dict(self.db.execute("SELECT key,value FROM meta")).get("schema") == SCHEMA,
                 "WORKSPACE_SCHEMA", "Use the receiving application for this workspace edition.")
        except BaseException:
            if self.db is not None:
                with suppress(Exception):
                    self.db.close()
            with suppress(Exception):
                fcntl.flock(self.lease.fileno(), fcntl.LOCK_UN)
                self.lease.close()
            raise
    def close(self):
        with self.lock:
            self.db.close()
            fcntl.flock(self.lease.fileno(), fcntl.LOCK_UN)
            self.lease.close()
    def transaction(self):
        from contextlib import contextmanager
        @contextmanager
        def tx():
            with self.lock:
                self.db.execute("BEGIN IMMEDIATE")
                try:
                    yield
                    self.db.execute("COMMIT")
                except BaseException:
                    if self.db.in_transaction:
                        with suppress(sqlite3.Error):
                            self.db.execute("ROLLBACK")
                    raise
        return tx()
    def _user(self, user_id):
        row = self.db.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
        need(row is not None and row["active"], "AUTH_REQUIRED", "Sign in with an active account.", 401)
        return public_user(row)
    def _staff(self, user):
        need(user["role"] in STAFF, "ROLE_REQUIRED", "This action requires a reviewer or administrator.", 403)
    def _admin(self, user):
        need(user["role"] == "admin", "ROLE_REQUIRED", "This action requires an administrator.", 403)
    def _scope(self, user, supplier_id):
        need(user["role"] in STAFF or user["supplier_id"] == supplier_id, "SUPPLIER_ACCESS",
             "This record belongs to another supplier.", 403)
    def _put(self, kind, value):
        self.db.execute("INSERT INTO entities VALUES(?,?,?,?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET supplier_id=excluded.supplier_id,status=excluded.status,revision=excluded.revision,body=excluded.body",
            (kind,value["id"],value.get("supplier_id"),value.get("status","active"),value["created_at"],value.get("revision",1),packed(value)))
        return value
    def _get(self, kind, key):
        row = self.db.execute("SELECT body FROM entities WHERE kind=? AND id=?", (kind,key)).fetchone()
        need(row is not None, "RECORD_NOT_FOUND", "The selected record was not found.", 404)
        return unpacked(row[0])
    def _all(self, kind, user=None):
        sql, args = "SELECT body FROM entities WHERE kind=?", [kind]
        if user and user["role"] not in STAFF:
            sql += " AND supplier_id=?"
            args.append(user["supplier_id"])
        sql += " ORDER BY created_at DESC,id DESC"
        return [unpacked(row[0]) for row in self.db.execute(sql,args)]
    def _audit(self, user, action, object_id, details):
        row = self.db.execute("SELECT sha256 FROM audit ORDER BY seq DESC LIMIT 1").fetchone()
        previous = row[0] if row else "0"*64
        body = {"event_id":ident("event"),"actor_id":user["id"],"action":action,
                "object_id":object_id,"created_at":now(),"details":details,"previous_sha256":previous}
        sha = digest(canonical(body))
        self.db.execute("INSERT INTO audit(event_id,actor_id,action,object_id,created_at,previous_sha256,sha256,body) VALUES(?,?,?,?,?,?,?,?)",
            (body["event_id"],user["id"],action,object_id,body["created_at"],previous,sha,packed(body)))
    def _notify(self, supplier_id, title, message, object_id):
        value = {"id":ident("notification"),"supplier_id":supplier_id,"status":"unread","created_at":now(),
                 "revision":1,"title":title,"message":message,"object_id":object_id,"read_by":[]}
        self._put("notification", value)
    def change(self, user, path, payload, request_id, operation):
        need(isinstance(request_id,str) and re.fullmatch(r"[A-Za-z0-9-]{16,100}",request_id),
             "REQUEST_ID_REQUIRED","Retain an Idempotency-Key for this action.")
        body = canonical(payload)
        sensitive = any(key in payload for key in ("password", "otp", "secret"))
        with self.transaction():
            self._user(user["id"])
            cached = self.db.execute("SELECT * FROM requests WHERE user_id=? AND id=?", (user["id"],request_id)).fetchone()
            if cached:
                saved = cached["body_sha256"]
                actual = request_fingerprint(body, saved) if saved.startswith("scrypt$") else digest(body)
                need(cached["path"] == path and hmac.compare_digest(saved, actual),
                     "REQUEST_ID_REUSED","This request ID belongs to a different action. Recover its original response.",409)
                return unpacked(cached["response"])
            result = operation()
            body_fingerprint = request_fingerprint(body) if sensitive else digest(body)
            self.db.execute("INSERT INTO requests VALUES(?,?,?,?,?,?)",
                (user["id"],request_id,path,body_fingerprint,packed(result),now()))
            return result
    def request(self, user, request_id):
        with self.lock:
            row = self.db.execute("SELECT path,body_sha256,response,created_at FROM requests WHERE user_id=? AND id=?",
                                  (user["id"],request_id)).fetchone()
            need(row is not None,"REQUEST_NOT_COMMITTED","No committed response exists for this request.",404)
            sensitive = row["body_sha256"].startswith("scrypt$")
            return {"id":request_id,"path":row["path"],
                    "body_sha256":None if sensitive else row["body_sha256"],
                    "fingerprint_kind":"salted_scrypt" if sensitive else "sha256",
                    "created_at":row["created_at"],"response":unpacked(row["response"])}
    def session(self, token):
        with self.lock:
            required = not self.db.execute("SELECT 1 FROM users LIMIT 1").fetchone()
            user = None
            if token:
                row = self.db.execute("SELECT user_id FROM sessions WHERE token_hash=? AND expires>?",
                    (digest(token.encode()),int(time.time()))).fetchone()
                if row:
                    try:
                        user = self._user(row["user_id"])
                    except Problem:
                        pass
            return {"authenticated":user is not None,"setup_required":required,"user":user,
                    "workspace_id":dict(self.db.execute("SELECT key,value FROM meta"))["id"]}
    def _session(self, user_id):
        self.db.execute("DELETE FROM sessions WHERE expires<=?", (int(time.time()),))
        token = secrets.token_urlsafe(32)
        self.db.execute("INSERT INTO sessions VALUES(?,?,?)",(digest(token.encode()),user_id,int(time.time())+8*3600))
        return token
    def setup(self, payload):
        with self.transaction():
            need(not self.db.execute("SELECT 1 FROM users LIMIT 1").fetchone(),"SETUP_COMPLETE","This workspace already has an administrator.",409)
            created = self._create_user(None,payload | {"role":"admin","supplier_id":None})
            token = self._session(created["id"])
            return created, token
    def login(self, payload):
        email = text(payload.get("email"),"Email",254).casefold()
        with self.transaction():
            row = self.db.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
            password = payload.get("password")
            salt = row["salt"] if row else "0"*32
            try:
                actual = password_key(password,salt)
            except Problem:
                actual = ""
            need(row and row["active"] and hmac.compare_digest(actual,row["password_hash"]),
                 "LOGIN_FAILED","The email or password is incorrect.",401)
            if row["totp_secret"]:
                step = otp_step(row["totp_secret"],payload.get("otp"),row["totp_last"])
                need(step is not None,"MFA_REQUIRED","Enter a current unused authenticator code.",401)
                self.db.execute("UPDATE users SET totp_last=? WHERE id=?", (step,row["id"]))
            user = public_user(row)
            self._audit(user,"session.login",user["id"],{})
            return user,self._session(user["id"])
    def logout(self, token):
        with self.transaction():
            self.db.execute("DELETE FROM sessions WHERE token_hash=?", (digest((token or "").encode()),))
        return {"signed_out":True}
    def _create_user(self, actor, payload):
        role = payload.get("role","supplier")
        supplier_id = payload.get("supplier_id") or None
        need(role in ROLES,"USER_ROLE","Select an available account role.")
        if actor:
            if actor["role"] == "supplier_admin":
                need(role in ("supplier","supplier_admin") and supplier_id == actor["supplier_id"],
                     "DELEGATION_SCOPE","Supplier administrators may add accounts only for their own supplier.",403)
            else:
                self._admin(actor)
        if role in ("supplier","supplier_admin"):
            need(supplier_id is not None,"SUPPLIER_REQUIRED","Select the supplier for this account.")
            self._get("supplier",supplier_id)
        else:
            need(supplier_id is None,"STAFF_SCOPE","Staff accounts must not be assigned to one supplier.")
        email = text(payload.get("email"),"Email",254).casefold()
        need(re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+",email) is not None,"EMAIL_INVALID","Enter a valid account email.")
        salt = secrets.token_hex(16)
        value = {"id":ident("user"),"email":email,"name":text(payload.get("name"),"Name",160),"role":role,
                 "supplier_id":supplier_id,"active":1,"revision":1,"salt":salt,
                 "password_hash":password_key(payload.get("password"),salt),"totp_secret":None,
                 "totp_pending":None,"totp_last":-1,"created_at":now()}
        need(not self.db.execute("SELECT 1 FROM users WHERE email=?",(email,)).fetchone(),
             "EMAIL_EXISTS","This account email is already registered.",409)
        self.db.execute("INSERT INTO users VALUES(:id,:email,:name,:role,:supplier_id,:active,:revision,:salt,:password_hash,:totp_secret,:totp_pending,:totp_last,:created_at)",value)
        out = public_user(value)
        self._audit(actor or out,"user.create",value["id"],{"role":role,"supplier_id":supplier_id})
        return out
    def create_user(self,user,payload):
        return self._create_user(user,payload)
    def users(self,user):
        with self.lock:
            need(user["role"] in ("admin","supplier_admin"),"ROLE_REQUIRED","Account administration is required.",403)
            rows = self.db.execute("SELECT * FROM users ORDER BY name") if user["role"]=="admin" else self.db.execute("SELECT * FROM users WHERE supplier_id=? ORDER BY name",(user["supplier_id"],))
            return [public_user(row) for row in rows]
    def update_user(self,user,key,payload):
        selected = self.db.execute("SELECT * FROM users WHERE id=?", (key,)).fetchone()
        need(selected is not None,"USER_NOT_FOUND","The selected account does not exist.",404)
        need(user["role"]=="admin" or user["role"]=="supplier_admin" and selected["supplier_id"]==user["supplier_id"] and selected["role"] in ("supplier","supplier_admin"),
             "DELEGATION_SCOPE","This account is outside your administration scope.",403)
        need(payload.get("expected_revision")==selected["revision"],"REVISION_CHANGED","Refresh the account before changing its access.",409)
        need(type(payload.get("active")) is bool,"ACTIVE_REQUIRED","Select whether this account is active.")
        need(key!=user["id"] or payload["active"],"CURRENT_ACCOUNT","Use another administrator to deactivate the current account.",409)
        self.db.execute("UPDATE users SET active=?,revision=revision+1 WHERE id=?",(int(payload["active"]),key))
        if not payload["active"]:
            self.db.execute("DELETE FROM sessions WHERE user_id=?",(key,))
        self._audit(user,"user.access",key,{"active":payload["active"]})
        return public_user(self.db.execute("SELECT * FROM users WHERE id=?",(key,)).fetchone())
    def mfa_enroll(self,user):
        row = self.db.execute("SELECT totp_secret FROM users WHERE id=?",(user["id"],)).fetchone()
        need(not row[0],"MFA_ALREADY_ENABLED","This account already has an authenticator.",409)
        secret = base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")
        self.db.execute("UPDATE users SET totp_pending=? WHERE id=?",(secret,user["id"]))
        return {"secret":secret,"otpauth_uri":"otpauth://totp/"+quote("Supplier workbench:"+user["email"])+"?secret="+secret+"&issuer=Supplier%20workbench&digits=6&period=30"}
    def mfa_confirm(self,user,payload):
        row = self.db.execute("SELECT * FROM users WHERE id=?",(user["id"],)).fetchone()
        need(row["totp_pending"] is not None,"MFA_ENROLL_FIRST","Start authenticator enrollment first.",409)
        step = otp_step(row["totp_pending"],payload.get("otp"))
        need(step is not None,"MFA_CODE","Enter the current code from the new authenticator.")
        self.db.execute("UPDATE users SET totp_secret=totp_pending,totp_pending=NULL,totp_last=?,revision=revision+1 WHERE id=?",(step,user["id"]))
        self._audit(user,"user.mfa_enabled",user["id"],{})
        return public_user(self.db.execute("SELECT * FROM users WHERE id=?",(user["id"],)).fetchone())
    def suppliers(self,user):
        with self.lock:
            values = self._all("supplier")
            return [v for v in values if user["role"] in STAFF or v["id"]==user["supplier_id"]]
    def create_supplier(self,user,payload):
        self._admin(user)
        gln = text(payload.get("gln"),"Supplier GLN",13,optional=True)
        need(not gln or gs1_check(gln,(13,)),"GLN_INVALID","Use a valid 13-digit GLN, or leave it empty until assigned.")
        need(not gln or not any(v.get("gln")==gln for v in self._all("supplier")),"GLN_EXISTS","This supplier GLN is already registered.",409)
        value = {"id":ident("supplier"),"name":text(payload.get("name"),"Supplier name",200),"gln":gln,
                 "contact_email":text(payload.get("contact_email"),"Contact email",254,optional=True),
                 "status":"active","created_at":now(),"revision":1}
        self._put("supplier",value)
        self._audit(user,"supplier.create",value["id"],{"gln":gln,"name":value["name"]})
        return value
    def _submission_summary(self,value):
        return {k:value.get(k) for k in ("id","supplier_id","supplier_name","filename","format","status","revision",
            "created_at","item_count","error_count","warning_count","parent_id","source_sha256","source_label")}
    def submissions(self,user,filters=None):
        with self.lock:
            values = self._all("submission",user)
            for key in ("status","supplier_id"):
                if filters and filters.get(key):
                    values = [v for v in values if v.get(key)==filters[key]]
            return [self._submission_summary(v) for v in values]
    def submission(self,user,key):
        with self.lock:
            value = self._get("submission",key)
            self._scope(user,value["supplier_id"])
            return value
    def import_source(self,user,payload,manual=False):
        supplier = self._get("supplier",text(payload.get("supplier_id"),"Supplier",100))
        self._scope(user,supplier["id"])
        need(supplier["status"]=="active","SUPPLIER_INACTIVE","This supplier is not active.",409)
        source_label = text(payload.get("source_label"),"Source attribution",2000)
        if manual:
            rows = payload.get("items")
            need(isinstance(rows,list) and 1<=len(rows)<=5000,"ITEMS_REQUIRED","Provide between one and 5,000 supplier items.")
            name, raw = "manual-supplier-items.json", canonical({"items":rows})
        else:
            name, raw = source_bytes(payload)
        parent = payload.get("parent_id") or None
        if parent:
            previous = self._get("submission",parent)
            self._scope(user,previous["supplier_id"])
            need(previous["supplier_id"]==supplier["id"] and previous["status"] in ("rejected","approved"),
                 "RESUBMISSION_PARENT","Select a reviewed submission from this supplier as the prior edition.",409)
        parsed,findings = inspect_source(name,raw,supplier,source_label)
        sha = digest(raw)
        self.db.execute("INSERT OR IGNORE INTO sources VALUES(?,?,?)",(sha,len(raw),zlib.compress(raw,6)))
        value = {"id":ident("submission"),"supplier_id":supplier["id"],"supplier_name":supplier["name"],
            "filename":name,"format":parsed["format"],"status":"pending","revision":1,"created_at":now(),
            "created_by":user["id"],"source_sha256":sha,"source_bytes":len(raw),"source_label":source_label,
            "parent_id":parent,"items":parsed["items"],"findings":findings,"observations":parsed["observations"],
            "provenance":parsed["provenance"],"members":parsed["members"],
            "item_count":len(parsed["items"]),"error_count":sum(f["severity"]=="error" for f in findings),
            "warning_count":sum(f["severity"]=="warning" for f in findings),
            "history":[{"action":"import","at":now(),"actor":user["name"],"source_sha256":sha,"parent_id":parent}]}
        self._put("submission",value)
        self._audit(user,"submission.import",value["id"],{"supplier_id":supplier["id"],"sha256":sha,"items":len(value["items"]),"parent_id":parent})
        self._notify(supplier["id"],"Content received",name+" is ready for source review.",value["id"])
        return self._submission_summary(value)
    def original(self,user,key):
        value = self.submission(user,key)
        with self.lock:
            row = self.db.execute("SELECT bytes,payload FROM sources WHERE sha256=?",(value["source_sha256"],)).fetchone()
            need(row is not None,"SOURCE_MISSING","The retained original source is missing.",409)
            raw = decompressed(row["payload"], MAX_UPLOAD)
            need(len(raw)==row["bytes"] and digest(raw)==value["source_sha256"],"SOURCE_CHANGED","The retained original source differs from its saved identity.",409)
            return value["filename"],raw
    def review(self,user,key,payload):
        self._staff(user)
        value = self._get("submission",key)
        need(payload.get("expected_revision")==value["revision"],"REVISION_CHANGED","Review the latest submission state.",409)
        need(value["status"]=="pending","ALREADY_REVIEWED","This source already has a review decision. Import a successor to revise it.",409)
        decision = payload.get("decision")
        need(decision in ("approve","reject"),"REVIEW_DECISION","Choose approve or reject.")
        note = text(payload.get("note"),"Review note",6000)
        if decision=="approve":
            need(value["error_count"]==0,"VALIDATION_ERRORS","Resolve the validation errors in a successor source before approval.",422,{"findings":value["findings"]})
            need(not value["warning_count"] or payload.get("acknowledge_warnings") is True,
                 "REVIEW_WARNINGS","Acknowledge the source warnings before approval.",422)
        value["status"] = "approved" if decision=="approve" else "rejected"
        value["revision"] += 1
        at = now()
        value["history"].append({"action":decision,"at":at,"actor":user["name"],"note":note,
                                 "acknowledge_warnings":payload.get("acknowledge_warnings") is True})
        if decision=="approve":
            existing = self._all("product")
            for item in value["items"]:
                predecessors = [p for p in existing if p["supplier_id"]==value["supplier_id"] and p["key"]==item["key"]]
                edition = max((p["edition"] for p in predecessors),default=0)+1
                product = {"id":ident("product"),"key":item["key"],"gtin":item["gtin"],"provider_gln":item["provider_gln"],
                    "name":item["name"],"brand":item["brand"],"identifier_type":item["identifier_type"],
                    "identifier":item["identifier"],"identifier_namespace":item["identifier_namespace"],
                    "supplier_id":value["supplier_id"],"supplier_name":value["supplier_name"],
                    "edition":edition,"submission_id":key,"source_sha256":value["source_sha256"],"source_label":value["source_label"],
                    "approved_at":at,"approved_by":user["name"],"created_at":at,"revision":1,"status":"approved","item":item}
                self._put("product",product)
                existing.append(product)
        self._put("submission",value)
        self._audit(user,"submission."+decision,key,{"source_sha256":value["source_sha256"],"note":note,"revision":value["revision"]})
        self._notify(value["supplier_id"],"Content "+value["status"],note,key)
        return self._submission_summary(value)
    def products(self,user,all_editions=False):
        with self.lock:
            products = self._all("product",user)
            current = {}
            for p in products:
                key = (p["supplier_id"],p["key"])
                if key not in current or p["edition"]>current[key]["edition"]:
                    current[key]=p
            selected = products if all_editions else list(current.values())
            return [{k:v for k,v in p.items() if k!="item"} | {"is_current":current[(p["supplier_id"],p["key"])]["id"]==p["id"]}
                    for p in selected]
    def product(self,user,key):
        with self.lock:
            p = self._get("product",key)
            self._scope(user,p["supplier_id"])
            all_values = [v for v in self._all("product",user) if v["supplier_id"]==p["supplier_id"] and v["key"]==p["key"]]
            p["history"] = [{k:v[k] for k in ("id","edition","submission_id","approved_at","source_sha256")} for v in sorted(all_values,key=lambda x:x["edition"],reverse=True)]
            p["is_current"] = p["edition"]==max(v["edition"] for v in all_values)
            return p
    def mappings(self,user):
        self._staff(user)
        with self.lock:
            return self._all("mapping")
    def mapping_payload(self,payload):
        fields = payload.get("fields")
        need(isinstance(fields,list) and 1<=len(fields)<=512,"MAPPING_FIELDS","Provide one to 512 explicit field mappings.")
        normalized = []
        for row in fields:
            need(isinstance(row,dict) and type(row.get("required",False)) is bool,"MAPPING_FIELD",
                 "Each mapping field must be an object with a boolean required flag.")
            normalized.append({"source":text(row.get("source"),"Source field",2000),
                               "target":text(row.get("target"),"Target column",200),
                               "required":bool(row.get("required",False))})
        need(len({v["target"] for v in normalized})==len(normalized),"DUPLICATE_TARGET","Each target column must be unique.")
        fmt = payload.get("format","json")
        need(fmt in ("csv","json"),"MAPPING_FORMAT","Choose JSON or CSV.")
        return normalized,fmt
    def create_mapping(self,user,payload):
        self._staff(user)
        fields,fmt = self.mapping_payload(payload)
        name = text(payload.get("name"),"Mapping name",160)
        target = text(payload.get("target"),"Agreed or proposed target",240)
        old = [v for v in self._all("mapping") if v["name"]==name and v["target"]==target]
        value = {"id":ident("mapping"),"name":name,"target":target,"fields":fields,"format":fmt,
            "version":max((v["version"] for v in old),default=0)+1,"created_at":now(),"created_by":user["name"],
            "revision":1,"status":"active","prior_id":max(old,key=lambda x:x["version"])["id"] if old else None}
        self._put("mapping",value)
        self._audit(user,"mapping.create",value["id"],{"name":name,"target":target,"version":value["version"]})
        return value
    def _mapped(self,user,fields,fmt,product_ids):
        self._staff(user)
        need(isinstance(product_ids,list) and 1<=len(product_ids)<=5000 and
             all(isinstance(key,str) for key in product_ids) and len(set(product_ids))==len(product_ids),
             "PRODUCT_SELECTION","Select distinct approved product editions.")
        products = [self._get("product",text(key,"Product edition",100)) for key in product_ids]
        return render_release(products,fields,fmt)
    def preview_mapping(self,user,payload):
        with self.lock:
            fields,fmt = self.mapping_payload(payload)
            result,_ = self._mapped(user,fields,fmt,payload.get("product_ids"))
            return result | {"fields":fields,"format":fmt}
    def create_release(self,user,payload):
        self._staff(user)
        mapping = self._get("mapping",text(payload.get("mapping_id"),"Mapping edition",100))
        result,raw = self._mapped(user,mapping["fields"],mapping["format"],payload.get("product_ids"))
        need(not any(v["severity"]=="error" for v in result["findings"]),"MAPPING_REQUIRED_FIELDS",
             "Complete the required mapping fields before preparing this release.",422,{"findings":result["findings"]})
        sha = digest(raw)
        self.db.execute("INSERT OR IGNORE INTO sources VALUES(?,?,?)",(sha,len(raw),zlib.compress(raw,6)))
        key = ident("release")
        value = {"id":key,"name":text(payload.get("name"),"Release name",200,optional=True) or mapping["name"]+" "+now(),
            "mapping_id":mapping["id"],"mapping_name":mapping["name"],"mapping_version":mapping["version"],
            "target":mapping["target"],"format":mapping["format"],"mapping":mapping,
            "sha256":sha,"bytes":len(raw),"filename":key+"."+mapping["format"],"status":"prepared",
            "revision":1,"created_at":now(),"created_by":user["name"],"note":text(payload.get("note"),"Release note",4000,optional=True),
            "rows":result["rows"],"products":result["products"],"findings":result["findings"],"attempts":[],"acks":[]}
        self._put("release",value)
        self._audit(user,"release.prepare",key,{"sha256":sha,"mapping_id":mapping["id"],"products":[p["id"] for p in result["products"]]})
        return value
    def releases(self,user):
        self._staff(user)
        with self.lock:
            return [{k:v for k,v in value.items() if k not in ("rows","mapping")} for value in self._all("release")]
    def release(self,user,key):
        self._staff(user)
        with self.lock:
            return self._get("release",key)
    def release_file(self,user,key):
        self._staff(user)
        with self.lock:
            value = self._get("release",key)
            row = self.db.execute("SELECT bytes,payload FROM sources WHERE sha256=?",(value["sha256"],)).fetchone()
            need(row is not None,"RELEASE_MISSING","This release's retained file is missing.",409)
            raw = decompressed(row["payload"], MAX_UPLOAD)
            need(digest(raw)==value["sha256"] and len(raw)==value["bytes"]==row["bytes"],
                 "RELEASE_CHANGED","The saved release differs from its approved editions.",409)
            return value["filename"],raw
    def acknowledge(self,user,key,payload):
        self._staff(user)
        value = self._get("release",key)
        need(payload.get("expected_revision")==value["revision"],"REVISION_CHANGED","Review the current release before recording a response.",409)
        need(payload.get("sha256")==value["sha256"],"ACK_FILE_MISMATCH","The acknowledgment must identify this exact released file.",409)
        status = payload.get("status")
        need(status in ("accepted","rejected"),"ACK_STATUS","Choose accepted or rejected from the actual response.")
        ack = {"id":ident("ack"),"status":status,"sha256":value["sha256"],
            "reference":text(payload.get("reference"),"Original response reference",2000),
            "message":text(payload.get("message"),"Original response or review note",6000),
            "recorded_at":now(),"recorded_by":user["name"],"authority":"operator_recorded_external_response"}
        value["acks"].append(ack)
        value["status"], value["revision"] = status,value["revision"]+1
        self._put("release",value)
        self._audit(user,"release.acknowledgment",key,ack)
        for supplier in {p["supplier_id"] for p in value["products"]}:
            self._notify(supplier,"Release response recorded",value["name"]+": "+status+" — "+ack["message"],key)
        return value
    def audit(self,user):
        self._staff(user)
        with self.lock:
            return [unpacked(r["body"]) | {"seq":r["seq"],"sha256":r["sha256"]}
                    for r in self.db.execute("SELECT * FROM audit ORDER BY seq DESC LIMIT 500")]
    def notifications(self,user):
        with self.lock:
            return [v | {"read":user["id"] in v["read_by"]} for v in self._all("notification",user)]
    def mark_read(self,user,key):
        value = self._get("notification",key)
        self._scope(user,value["supplier_id"])
        if user["id"] not in value["read_by"]:
            value["read_by"].append(user["id"])
            value["revision"] += 1
            self._put("notification",value)
        return value | {"read":True}
    def dashboard(self,user):
        with self.lock:
            submissions = self.submissions(user)
            products = self.products(user)
            notifications = self.notifications(user)
            releases = self.releases(user) if user["role"] in STAFF else []
            counts = {"suppliers":len(self.suppliers(user)),"submissions":len(submissions),
                "pending":sum(v["status"]=="pending" for v in submissions),
                "approved":sum(v["status"]=="approved" for v in submissions),
                "rejected":sum(v["status"]=="rejected" for v in submissions),
                "products":len(products),"releases":len(releases),
                "unread_notifications":sum(not v["read"] for v in notifications)}
            return {"counts":counts,"activity":self.audit(user)[:12] if user["role"] in STAFF else notifications[:12],
                    "source_notes":SOURCE_NOTES,"workspace":dict(self.db.execute("SELECT key,value FROM meta"))}
    def backup(self,user):
        self._admin(user)
        with self.lock:
            clone = sqlite3.connect(":memory:")
            try:
                self.db.backup(clone)
                clone.execute("DELETE FROM sessions")
                clone.commit()
                database = clone.serialize()
            finally:
                clone.close()
            meta = dict(self.db.execute("SELECT key,value FROM meta"))
            files = {"state/state.sqlite3":database}
            for name in APP_FILES:
                path = self.app_root/name
                need(path.is_file() and not path.is_symlink(),"APPLICATION_FILE_MISSING",
                     "The complete source application is required for a portable backup.",409,{"path":name})
                files["app/"+name]=path.read_bytes()
            manifest = {"schema":SCHEMA,"kind":"complete-private-workspace","workspace_id":meta["id"],"created_at":now(),
                "active_sessions":"removed_from_exported_copy","database_sha256":digest(database),
                "files":[{"path":name,"bytes":len(raw),"sha256":digest(raw)} for name,raw in sorted(files.items())],
                "counts":{kind:self.db.execute("SELECT count(*) FROM entities WHERE kind=?",(kind,)).fetchone()[0]
                          for kind in ("supplier","submission","product","mapping","release","notification")}}
            files["MANIFEST.json"]=canonical(manifest)+b"\n"
            files["OPEN.txt"]=b"Private complete supplier workspace. Keep account credentials and supplier originals private.\nVerify with the trusted existing server.py receive command; it never runs code from an incoming archive.\nRun the independently reviewed application with --state RECEIVED_DIRECTORY. Sign in again; active sessions are not exported.\nCSV values preserve original content: import all columns as text, never open untrusted source cells as spreadsheet formulas.\n"
            need(sum(len(raw) for raw in files.values())<=96*1024*1024,"PROJECT_EXPANSION",
                 "This workspace exceeds the current portable receiver's 96 MiB expanded-project limit.",413)
            out = io.BytesIO()
            with zipfile.ZipFile(out,"w",zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
                for name,raw in sorted(files.items()):
                    info=zipfile.ZipInfo(name,(2026,1,1,0,0,0))
                    info.compress_type=zipfile.ZIP_DEFLATED
                    info.external_attr=0o600<<16
                    archive.writestr(info,raw)
            result=out.getvalue()
            need(len(result)<=MAX_UPLOAD,"PROJECT_SIZE","This project exceeds the current 48 MiB complete-package limit.",413)
            return meta["id"]+"-complete.zip",result
    def restore(self,user,payload):
        self._admin(user)
        name,raw = source_bytes(payload)
        return receive(raw,self.root/"received",self.app_root)

def verify_database(raw,manifest):
    db = sqlite3.connect(":memory:")
    db.row_factory=sqlite3.Row
    try:
        db.deserialize(raw)
        schema = {r["name"]:(r["type"],r["sql"]) for r in db.execute("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'")}
        expected = {k:("table",v) for k,v in DDL.items()} | {k:("index",v) for k,v in INDEXES.items()}
        need(schema==expected,"RECEIVING_SCHEMA","The incoming database must have exactly the trusted application schema.",422)
        need(db.execute("PRAGMA integrity_check").fetchone()[0]=="ok","RECEIVING_DATABASE","The incoming database is not intact.",422)
        meta=dict(db.execute("SELECT key,value FROM meta"))
        need(meta.get("schema")==SCHEMA and meta.get("id")==manifest["workspace_id"],
             "RECEIVING_IDENTITY","The incoming workspace identity differs from its manifest.",422)
        need(db.execute("SELECT count(*) FROM sessions").fetchone()[0]==0,"RECEIVING_SESSIONS","Portable receiving requires fresh sign-in.",422)
        entities={}
        for row in db.execute("SELECT * FROM entities"):
            value=unpacked(row["body"])
            need(value["id"]==row["id"] and value.get("supplier_id")==row["supplier_id"] and
                 value.get("status","active")==row["status"] and value["created_at"]==row["created_at"] and
                 value.get("revision",1)==row["revision"],"RECEIVING_RECORD","An incoming record differs from its index.",422)
            entities[(row["kind"],row["id"])]=value
        required_kinds={"supplier","submission","product","mapping","release","notification"}
        need(set(manifest.get("counts", {}))==required_kinds and
             all(kind in required_kinds for kind,_ in entities),
             "RECEIVING_COUNTS", "The complete project must identify every supported record class.", 422)
        for kind,count in manifest["counts"].items():
            need(type(count) is int and count>=0 and sum(k==kind for k,_ in entities)==count,
                 "RECEIVING_COUNTS","The incoming project is missing record history.",422)
        raw_sources={}
        for row in db.execute("SELECT * FROM sources"):
            value=decompressed(row["payload"], MAX_UPLOAD)
            need(len(value)==row["bytes"] and digest(value)==row["sha256"],"RECEIVING_SOURCE","An original file differs from its saved identity.",422)
            raw_sources[row["sha256"]]=value
        for (kind,key),value in entities.items():
            if kind=="submission":
                need(value["source_sha256"] in raw_sources and ("supplier",value["supplier_id"]) in entities,
                     "RECEIVING_SUBMISSION","The incoming source or supplier is missing.",422)
                parsed,findings=inspect_source(value["filename"],raw_sources[value["source_sha256"]],entities[("supplier",value["supplier_id"])],value["source_label"])
                for field in ("items","observations","provenance","members"):
                    need(canonical(parsed[field])==canonical(value[field]),"RECEIVING_PROJECTION",
                         "The saved supplier projection differs from the exact original file.",422,{"submission_id":key,"field":field})
                need(canonical(findings)==canonical(value["findings"]),"RECEIVING_VALIDATION","The original validation findings changed.",422)
            elif kind=="product":
                submission=entities.get(("submission",value["submission_id"]))
                need(submission and submission["status"]=="approved" and submission["source_sha256"]==value["source_sha256"] and
                     any(canonical(value["item"])==canonical(item) for item in submission["items"]),"RECEIVING_PRODUCT",
                     "An approved product lost its original reviewed source.",422)
            elif kind=="release":
                mapping=entities.get(("mapping",value["mapping_id"]))
                need(value["sha256"] in raw_sources and len(raw_sources[value["sha256"]])==value["bytes"] and
                     mapping is not None and canonical(mapping)==canonical(value["mapping"]) and
                     all(value[field]==mapping[source] for field,source in
                         (("mapping_id","id"),("mapping_name","name"),("mapping_version","version"),("target","target"),("format","format"))) and
                     value["filename"]==key+"."+mapping["format"],
                     "RECEIVING_RELEASE","A release lost its original mapping, identity or file.",422)
                products=[]
                for p in value["products"]:
                    retained=entities.get(("product",p["id"]))
                    need(retained is not None,"RECEIVING_RELEASE_PRODUCT",
                         "A released product edition is missing from its approved source.",422)
                    products.append(retained)
                regenerated, rendered=render_release(products,mapping["fields"],mapping["format"])
                need(not any(f["severity"]=="error" for f in regenerated["findings"]) and
                     all(canonical(regenerated[field])==canonical(value[field])
                         for field in ("rows","products","findings","sha256","bytes")) and
                     rendered==raw_sources[value["sha256"]],
                     "RECEIVING_RELEASE_CONTENT","The release does not reproduce its exact selected product editions and mapping.",422)
                need(all(a["sha256"]==value["sha256"] for a in value["acks"]),
                     "RECEIVING_ACK","A response is not bound to its original released file.",422)
        previous="0"*64
        for row in db.execute("SELECT * FROM audit ORDER BY seq"):
            body=unpacked(row["body"])
            need(body["previous_sha256"]==previous==row["previous_sha256"] and digest(canonical(body))==row["sha256"],
                 "RECEIVING_HISTORY","The original operation history is incomplete.",422)
            previous=row["sha256"]
        return {"workspace_id":meta["id"],"counts":manifest["counts"],"original_sources":len(raw_sources),"audit_head":previous}
    finally:
        db.close()

def receive(raw,directory,app_root=None):
    """Receive into a new hash-addressed directory using only this trusted code."""
    need(0<len(raw)<=MAX_UPLOAD,"PROJECT_SIZE","Choose a complete project up to 48 MiB.",413)
    sha=digest(raw)
    archive,infos=zip_members(raw)
    with archive:
        names={i.filename for i in infos}
        need("MANIFEST.json" in names and "state/state.sqlite3" in names,
             "RECEIVING_PACKAGE","Choose a complete private workbench backup.",422)
        manifest=json.loads(archive.read("MANIFEST.json"))
        need(manifest.get("schema")==SCHEMA and manifest.get("kind")=="complete-private-workspace",
             "RECEIVING_VERSION","Use the trusted receiving application for this package edition.",422)
        entries=manifest.get("files")
        need(isinstance(entries,list) and len({e["path"] for e in entries})==len(entries),
             "RECEIVING_MANIFEST","The package manifest has duplicate or invalid entries.",422)
        required_payload={"state/state.sqlite3"}|{"app/"+n for n in APP_FILES}
        expected={e["path"] for e in entries}|{"MANIFEST.json","OPEN.txt"}
        need({e["path"] for e in entries}==required_payload and names==expected,
             "RECEIVING_MEMBERS","The complete package member set differs from its manifest.",422)
        blobs={}
        for entry in entries:
            data=archive.read(entry["path"])
            need(len(data)==entry["bytes"] and digest(data)==entry["sha256"],
                 "RECEIVING_BYTES","A package member differs from its manifest.",422,{"path":entry["path"]})
            blobs[entry["path"]]=data
        database=blobs["state/state.sqlite3"]
        need(digest(database)==manifest["database_sha256"],"RECEIVING_DATABASE_HASH","The original database identity changed.",422)
        result=verify_database(database,manifest)
    base=Path(directory).expanduser().resolve()
    base.mkdir(mode=0o700,parents=True,exist_ok=True)
    target=base/("received-"+sha[:24])
    receipt={"schema":SCHEMA,"source_sha256":sha,"source_bytes":len(raw),"source_workspace_id":manifest["workspace_id"],
             "received_at":now(),"status":"complete","directory":str(target/"state"),"code_execution":"trusted_receiver_only",
             "data":result}
    if target.exists():
        saved=json.loads((target/"RECEIVING.json").read_bytes())
        need(saved["source_sha256"]==sha,"RECEIVING_COLLISION","An existing receiving directory has a different original source.",409)
        for entry in entries:
            path=target/entry["path"]
            need(path.is_file() and not path.is_symlink(),
                 "RECEIVING_INCOMPLETE", "A retained receiving member is missing or replaced.", 409,
                 {"path":entry["path"],"receipt":saved})
            actual=path.read_bytes()
            need(len(actual)==entry["bytes"] and digest(actual)==entry["sha256"],
                 "RECEIVING_ALREADY_OPENED" if entry["path"]=="state/state.sqlite3" else "RECEIVING_SOURCE_CHANGED",
                 "The received workspace has advanced or an included source file has changed. Its original receiving record is retained.",
                 409,{"path":entry["path"],"receipt":saved})
        need(not any((target/"state"/name).exists() for name in ("state.sqlite3-journal","state.sqlite3-wal","state.sqlite3-shm")),
             "RECEIVING_ALREADY_OPENED","This received workspace has an active SQLite sidecar. Use its original process.",409,{"receipt":saved})
        return saved | {"reopened":True}
    staging=base/("."+ident("receiving"))
    staging.mkdir(mode=0o700)
    try:
        for name,data in blobs.items():
            path=staging/name
            path.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
            with path.open("xb") as stream:
                os.chmod(path,0o600)
                stream.write(data);stream.flush();os.fsync(stream.fileno())
        for name,data in (("MANIFEST.json",canonical(manifest)+b"\n"),("RECEIVING.json",canonical(receipt)+b"\n")):
            path=staging/name
            with path.open("xb") as stream:
                os.chmod(path,0o600);stream.write(data);stream.flush();os.fsync(stream.fileno())
        directories=[p for p in staging.rglob("*") if p.is_dir()]+[staging]
        for folder in sorted(directories,key=lambda p:len(p.parts),reverse=True):
            descriptor=os.open(folder,os.O_RDONLY|os.O_DIRECTORY)
            try:os.fsync(descriptor)
            finally:os.close(descriptor)
        os.rename(staging,target)
        descriptor=os.open(base,os.O_RDONLY|os.O_DIRECTORY)
        try:os.fsync(descriptor)
        finally:os.close(descriptor)
    except BaseException:
        # Retain this partial receiving directory for recovery; do not replace an existing workspace.
        raise
    return receipt
