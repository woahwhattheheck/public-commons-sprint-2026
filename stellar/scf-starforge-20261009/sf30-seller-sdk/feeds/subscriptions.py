"""MIT. Retained subscription collections, original feed capture and native delivery."""
from __future__ import annotations
from collections import Counter
import io
import os
from pathlib import Path
import re
import shutil
import stat
import threading
import time
import zipfile

from original import InputError, checked_id, digest, json_bytes, load_json, file_digest, private_write, regular
from opml_source import parse_opml, selected_opml, MAX_OPML_BYTES

COLLECTION = "stellar-forge.feed-subscription-collection.v1"
RUN = "stellar-forge.feed-collection-capture.v1"
BINDING = "stellar-forge.feed-collection-edition.v1"
PACKET = "stellar-forge.feed-collection-project.v1"
MAX_PACKET = 1536 * 1024 * 1024

def seal(value, field="digest"):
    return value | {field: digest(json_bytes(value))}

def sealed(value, field="digest"):
    return isinstance(value, dict) and value.get(field) == digest(json_bytes({k:v for k,v in value.items() if k != field}))

def child_operation(kind, parent, item=""):
    return "collection-" + kind + "-" + digest(json_bytes([parent, item]))[:48]

class SubscriptionWorkspace:
    def __init__(self, workspace):
        from feed_workspace import identifier, validate_url, origin, normalize_config
        self.ws = workspace
        self.identifier, self.validate_url, self.origin, self.normalize_config = identifier, validate_url, origin, normalize_config
        self.cancelled = threading.Event()
        self.progress = None
        self.db = workspace.db
        self.db.executescript("""
          CREATE TABLE IF NOT EXISTS feed_subscription_sources(id TEXT PRIMARY KEY,body TEXT NOT NULL,created REAL NOT NULL);
          CREATE TABLE IF NOT EXISTS feed_collections(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,body TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS feed_collection_revisions(id TEXT NOT NULL,revision INTEGER NOT NULL,body TEXT NOT NULL,
            PRIMARY KEY(id,revision));
          CREATE TABLE IF NOT EXISTS feed_collection_runs(id TEXT PRIMARY KEY,collection_id TEXT NOT NULL,body TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS feed_collection_editions(id TEXT PRIMARY KEY,collection_id TEXT NOT NULL,body TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS feed_collection_operations(id TEXT PRIMARY KEY,payload TEXT NOT NULL,result TEXT,created REAL NOT NULL);
        """)

    def _begin(self, operation_id, payload):
        self.identifier(operation_id)
        encoded = json_bytes(payload).decode()
        row = self.db.execute("SELECT * FROM feed_collection_operations WHERE id=?", (operation_id,)).fetchone()
        if row:
            if row["payload"] != encoded:
                raise InputError("Subscription operation ID belongs to another action; reopen its exact original request")
            return load_json(row["result"]) if row["result"] else None
        with self.db:
            self.db.execute("INSERT INTO feed_collection_operations VALUES(?,?,NULL,?)",
                            (operation_id, encoded, time.time()))
        return None

    def _done(self, operation_id, result):
        self.db.execute("UPDATE feed_collection_operations SET result=? WHERE id=?", (json_bytes(result).decode(), operation_id))
        return result

    def import_opml(self, data, operation_id):
        document = parse_opml(data, self.validate_url)
        with self.ws.mutex:
            saved = self._begin(operation_id, {"action": "opml-import", "sha256": document["sourceId"]})
            if saved is not None: return saved
            native = self.ws.add_source(io.BytesIO(data), document["head"].get("title", "Subscriptions")[:160], "subscriptions.opml")
            if native["id"] != document["sourceId"]:
                raise InputError("Original XML intake returned another source identity")
            previous = self.db.execute("SELECT body FROM feed_subscription_sources WHERE id=?", (document["sourceId"],)).fetchone()
            if previous and load_json(previous[0]) != document:
                raise InputError("Retained subscription source metadata differs")
            with self.db:
                self.db.execute("INSERT OR IGNORE INTO feed_subscription_sources VALUES(?,?,?)",
                                (document["sourceId"], json_bytes(document).decode(), time.time()))
                return self._done(operation_id, document)

    def source(self, source_id):
        row = self.db.execute("SELECT body FROM feed_subscription_sources WHERE id=?", (checked_id(source_id),)).fetchone()
        if row is None: raise InputError("Unknown original OPML source")
        return load_json(row[0])

    def source_path(self, source_id):
        doc = self.source(source_id)
        path = self.ws.root / "sources" / (source_id + ".xml")
        if file_digest(path, MAX_OPML_BYTES) != doc["sourceId"]:
            raise InputError("Original OPML bytes changed")
        return path

    def plan(self, source_id):
        with self.ws.mutex:
            doc = self.source(source_id)
            current = self.ws.feed_state()["feeds"]
            rows = []
            for item in doc["entries"]:
                matches = [f["id"] for f in current if f["config"]["url"] == item["url"]]
                suggestion = matches[0] if len(matches) == 1 else "feed-" + digest((item["url"] or "").encode())[:20]
                rows.append(item | {"sourceId": source_id, "existingFeedIds": matches,
                                   "suggestedFeedId": suggestion, "selected": not item["commented"] and not item["error"]})
            return {"source": doc, "entries": rows}

    def collection(self, collection_id, revision=None):
        self.identifier(collection_id)
        row = self.db.execute("SELECT body FROM feed_collections WHERE id=?", (collection_id,)).fetchone() if revision is None else \
              self.db.execute("SELECT body FROM feed_collection_revisions WHERE id=? AND revision=?", (collection_id, revision)).fetchone()
        if row is None: raise InputError("Unknown saved subscription collection or revision")
        return load_json(row[0])

    def _members(self, members, documents, configs):
        if not isinstance(members, list) or not 1 <= len(members) <= 10000:
            raise InputError("Choose 1–10,000 subscription entries")
        normalized, seen = [], set()
        entries = {s: {e["entryId"]: e for e in d["entries"]} for s,d in documents.items()}
        for member in members:
            if not isinstance(member, dict) or set(member) != {"sourceId", "entryId", "feedId", "enabled"} or type(member["enabled"]) is not bool:
                raise InputError("Each member needs sourceId, entryId, feedId and an explicit enabled boolean")
            source_id, entry_id, feed_id, enabled = (member[k] for k in ("sourceId", "entryId", "feedId", "enabled"))
            if source_id is None:
                if entry_id is not None or feed_id is None: raise InputError("A manual subscription needs its registered feed ID")
                key = ("feed", feed_id)
                original = None
            else:
                original = entries.get(source_id, {}).get(entry_id)
                if original is None: raise InputError("Subscription is absent from its original OPML")
                key = (source_id, entry_id)
            if key in seen: raise InputError("The same subscription entry occurs twice")
            seen.add(key)
            if feed_id is not None:
                self.identifier(feed_id)
                if feed_id not in configs: raise InputError("Select an existing feed or declare its complete new configuration")
                if original and configs[feed_id]["url"] != original["url"]:
                    raise InputError("Mapped feed URL differs from the exact OPML subscription URL")
            if enabled and (feed_id is None or original and original["error"]):
                raise InputError("An enabled subscription needs a valid original URL and registered feed")
            normalized.append(dict(member))
        enabled_ids = sorted({m["feedId"] for m in normalized if m["enabled"]})
        if not enabled_ids or len(enabled_ids) > 100:
            raise InputError("Enable 1–100 distinct feeds in a collection")
        return normalized

    def save(self, collection_id, title, members, new_feeds, expected_revision, operation_id):
        self.identifier(collection_id)
        if not isinstance(title, str) or not 1 <= len(title) <= 160:
            raise InputError("Collection title needs 1–160 characters")
        if type(expected_revision) is not int or expected_revision < 0 or not isinstance(new_feeds, dict) or not isinstance(members, list):
            raise InputError("Supply the current collection revision and newFeeds configuration object")
        with self.ws.mutex:
            normalized_new = {self.identifier(k): self.normalize_config(k,v) for k,v in new_feeds.items()}
            payload = {"action": "collection-save", "collectionId": collection_id, "title": title, "members": members,
                       "newFeeds": normalized_new, "expectedRevision": expected_revision}
            saved = self._begin(operation_id, payload)
            if saved is not None: return saved
            row = self.db.execute("SELECT revision FROM feed_collections WHERE id=?", (collection_id,)).fetchone()
            if (row[0] if row else 0) != expected_revision:
                raise InputError("Collection revision changed; reload its saved member choices")
            source_ids = sorted({m.get("sourceId") for m in members if isinstance(m,dict) and m.get("sourceId")})
            documents = {s:self.source(s) for s in source_ids}
            requested_ids = {m.get("feedId") for m in members if isinstance(m,dict) and m.get("feedId")}
            if set(normalized_new) - requested_ids:
                raise InputError("New feed configuration is outside the selected collection")
            configs = {}
            for feed_id in requested_ids:
                if feed_id in normalized_new:
                    config = normalized_new[feed_id]
                    existing = self.db.execute("SELECT id FROM feed_sources WHERE id=?", (feed_id,)).fetchone()
                    op_id = child_operation("register", operation_id, feed_id)
                    owned = self.db.execute("SELECT result FROM feed_operations WHERE id=?", (op_id,)).fetchone()
                    if existing and not (owned and owned[0] and self.ws.feed(feed_id)["config"] == config):
                        raise InputError("New feed ID already exists; select that existing feed or choose another ID")
                    configs[feed_id] = config
                else:
                    configs[feed_id] = self.ws.feed(feed_id)["config"]
            normalized = self._members(members, documents, configs)
            # The original registration operation owns each create. If interrupted,
            # this same request replays its completed children before saving the collection.
            for feed_id,config in normalized_new.items():
                self.ws.register(feed_id, config, 0, child_operation("register", operation_id, feed_id))
            now = time.time()
            previous = self.collection(collection_id) if row else None
            value = seal({"schema": COLLECTION, "id": collection_id, "revision": expected_revision + 1,
                          "title": title, "members": normalized, "sources": source_ids,
                          "feeds": [{"id":k,"config":configs[k]} for k in sorted(configs)],
                          "createdAt": previous["createdAt"] if previous else now, "updatedAt": now})
            with self.db:
                self.db.execute("INSERT OR REPLACE INTO feed_collections VALUES(?,?,?)",
                                (collection_id, value["revision"], json_bytes(value).decode()))
                self.db.execute("INSERT INTO feed_collection_revisions VALUES(?,?,?)",
                                (collection_id, value["revision"], json_bytes(value).decode()))
                return self._done(operation_id, value)

    @staticmethod
    def feed_ids(value):
        return sorted({m["feedId"] for m in value["members"] if m["enabled"]})

    def view(self, collection_id, revision=None):
        with self.ws.mutex:
            value = self.collection(collection_id, revision)
            feeds = []
            expected = {f["id"]:f["config"] for f in value["feeds"]}
            for feed_id in self.feed_ids(value):
                try:
                    current = self.ws.feed(feed_id)
                    feeds.append(current | {"configurationChanged": current["config"] != expected[feed_id]})
                except InputError:
                    feeds.append({"id":feed_id,"missing":True,"configurationChanged":True})
            registrations = []
            for item in value["feeds"]:
                current = self.db.execute("SELECT id FROM feed_sources WHERE id=?", (item["id"],)).fetchone()
                registrations.append({"id":item["id"],"retainedConfig":item["config"],"enabled":item["id"] in self.feed_ids(value),
                                      "missing":current is None,"current":self.ws.feed(item["id"]) if current else None})
            return {"collection":value,"feeds":feeds,"registrations":registrations,
                    "missingRegistrations":{f["id"]:f["retainedConfig"] for f in registrations if f["missing"]},
                    "runs":[load_json(r[0]) for r in self.db.execute("SELECT body FROM feed_collection_runs WHERE collection_id=? ORDER BY rowid DESC",(collection_id,))],
                    "editions":[load_json(r[0]) for r in self.db.execute("SELECT body FROM feed_collection_editions WHERE collection_id=? ORDER BY rowid DESC",(collection_id,))],
                    "revisions":[{"revision":r["revision"],"digest":load_json(r["body"])["digest"]}
                                 for r in self.db.execute("SELECT revision,body FROM feed_collection_revisions WHERE id=? ORDER BY revision DESC",(collection_id,))]}

    def state(self):
        with self.ws.mutex:
            return {"schema":COLLECTION, "sources":[{"id":r["id"],"title":load_json(r["body"])["head"].get("title","Subscriptions"),
                        "subscriptions":len(load_json(r["body"])["entries"]),"bytes":load_json(r["body"])["bytes"]}
                        for r in self.db.execute("SELECT * FROM feed_subscription_sources ORDER BY created DESC")],
                    "collections":[{"id":v["id"],"title":v["title"],"revision":v["revision"],"digest":v["digest"],
                        "feeds":len(self.feed_ids(v)),"members":len(v["members"])}
                        for r in self.db.execute("SELECT body FROM feed_collections ORDER BY id") if (v:=load_json(r[0]))]}

    def run(self, run_id):
        row = self.db.execute("SELECT body FROM feed_collection_runs WHERE id=?", (checked_id(run_id),)).fetchone()
        if row is None: raise InputError("Unknown retained collection acquisition")
        return load_json(row[0])

    def _save_run(self, value):
        value["updatedAt"] = time.time()
        with self.db:
            self.db.execute("INSERT OR REPLACE INTO feed_collection_runs VALUES(?,?,?)",
                            (value["id"],value["collectionId"],json_bytes(value).decode()))
        self.progress = {"runId":value["id"],"collectionId":value["collectionId"],"state":value["state"],
                         "counts":dict(Counter(i["state"] for i in value["items"])),
                         "feedId":next((i["feedId"] for i in value["items"] if i["state"]=="RUNNING"),None)}

    def capture(self, collection_id, expected_revision, expected_revisions, operation_id, page_limit=100, force=False):
        if type(page_limit) is not int or not 1 <= page_limit <= 1000 or type(force) is not bool:
            raise InputError("Choose 1–1000 pages per feed and an explicit force boolean")
        if not isinstance(expected_revisions,dict) or any(type(v) is not int for v in expected_revisions.values()):
            raise InputError("Supply the displayed revision of each selected feed")
        with self.ws.mutex:
            collection = self.collection(collection_id, expected_revision)
            payload = {"action":"collection-capture","collectionId":collection_id,"expectedRevision":expected_revision,
                       "collectionDigest":collection["digest"],"expectedRevisions":expected_revisions,"pageLimit":page_limit,"force":force}
            saved = self._begin(operation_id,payload)
            if saved is not None: return saved
            run_id = digest(json_bytes({"operationId":operation_id,"payload":payload}))
            row = self.db.execute("SELECT body FROM feed_collection_runs WHERE id=?", (run_id,)).fetchone()
            if row:
                value = load_json(row[0])
            else:
                if self.collection(collection_id)["revision"] != expected_revision:
                    raise InputError("A newer collection revision exists; review its selection before a new acquisition")
                ids = self.feed_ids(collection)
                if set(ids) != set(expected_revisions):
                    raise InputError("Feed revision choices differ from the complete enabled collection")
                configs = {f["id"]:f["config"] for f in collection["feeds"]}
                for feed_id in ids:
                    current = self.ws.feed(feed_id)
                    if current["revision"] != expected_revisions[feed_id] or current["config"] != configs[feed_id]:
                        raise InputError("Feed changed before collection acquisition: " + feed_id)
                value = {"schema":RUN,"id":run_id,"operationId":operation_id,"collectionId":collection_id,
                         "collectionRevision":expected_revision,"collectionDigest":collection["digest"],"request":payload,
                         "items":[{"feedId":f,"operationId":child_operation("capture",operation_id,f),"state":"PENDING",
                                   "captureId":None,"error":None} for f in ids],"createdAt":time.time(),"state":"RUNNING"}
            if value["state"] == "CAPTURED":
                with self.db: return self._done(operation_id,value)
            self.cancelled.clear()
            value["state"] = "RUNNING"; self._save_run(value)
            configs = {f["id"]:f["config"] for f in collection["feeds"]}
            for item in value["items"]:
                if item["state"] == "CAPTURED": continue
                if self.cancelled.is_set(): break
                item.update(state="RUNNING",error=None); self._save_run(value)
                try:
                    current = self.ws.feed(item["feedId"])
                    if current["revision"] != expected_revisions[item["feedId"]] or current["config"] != configs[item["feedId"]]:
                        raise InputError("Feed changed since this acquisition was selected; preserve this run and choose a new collection acquisition")
                    result = self.ws.capture(item["feedId"],item["operationId"],page_limit=page_limit,force=force)
                    item.update(state="CAPTURED",captureId=result["id"],error=None)
                except Exception as problem:
                    # Original feed_runs already owns the durable partial capture.
                    match = self.db.execute("SELECT id FROM feed_runs WHERE json_extract(body,'$.operationId')=?",
                                            (item["operationId"],)).fetchone()
                    item.update(state="FAILED",captureId=match[0] if match else None,error=str(problem))
                self._save_run(value)
            value["state"] = "CAPTURED" if all(i["state"]=="CAPTURED" for i in value["items"]) else \
                             "CANCELLED" if self.cancelled.is_set() else "PARTIAL"
            self._save_run(value)
            if value["state"] == "CAPTURED":
                with self.db: self._done(operation_id,value)
            return value

    def resume(self, run_id):
        with self.ws.mutex:
            value = self.run(run_id); request = value["request"]
            return self.capture(value["collectionId"],value["collectionRevision"],request["expectedRevisions"],
                                value["operationId"],request["pageLimit"],request["force"])

    def request_cancel(self):
        self.cancelled.set()

    def review(self, run_id):
        with self.ws.mutex:
            value = self.run(run_id)
            rows = []
            for item in value["items"]:
                result = dict(item)
                if item["state"] == "CAPTURED":
                    review = self.ws.review(item["captureId"],0,1)
                    result.update(counts=review["counts"],total=review["total"],feed=review["feed"],
                                  feedIdentityChanged=review["feedIdentityChanged"],application=review["application"])
                rows.append(result)
            return {"run":value,"items":rows}

    def edition(self, run_id, name, fields, expected_revisions, operation_id):
        with self.ws.mutex:
            value = self.run(run_id)
            payload = {"action":"collection-edition","runId":run_id,"name":name,"fields":fields,
                       "expectedRevisions":expected_revisions}
            saved = self._begin(operation_id,payload)
            if saved is not None: return saved
            if value["state"] != "CAPTURED":
                raise InputError("Resume all selected feed acquisitions before creating their combined edition")
            ids = [i["feedId"] for i in value["items"]]
            if not isinstance(expected_revisions,dict) or set(expected_revisions) != set(ids):
                raise InputError("Select the displayed applied revision for every feed")
            for item in value["items"]:
                application = self.db.execute("SELECT body FROM feed_applications WHERE capture_id=?", (item["captureId"],)).fetchone()
                applied = load_json(application[0]) if application else None
                if not applied or applied["revision"] != expected_revisions[item["feedId"]]:
                    raise InputError("Review and apply the selected capture before creating its edition: " + item["feedId"])
                if self.ws.feed(item["feedId"])["revision"] != applied["revision"]:
                    raise InputError("A feed advanced after the selected capture was applied; select a current acquisition")
            native = self.ws.edition(ids,name,fields,child_operation("edition",operation_id),expected_revisions)
            binding = seal({"schema":BINDING,"collectionId":value["collectionId"],"collectionRevision":value["collectionRevision"],
                            "collectionDigest":value["collectionDigest"],"runId":run_id,"editionId":native["id"],
                            "feedRevisions":expected_revisions,"createdAt":time.time()},"id")
            result = {"binding":binding,"edition":self.ws.edition_summary(native)}
            with self.db:
                self.db.execute("INSERT INTO feed_collection_editions VALUES(?,?,?)",
                                (binding["id"],binding["collectionId"],json_bytes(binding).decode()))
                return self._done(operation_id,result)

    def binding(self, binding_id):
        row = self.db.execute("SELECT body FROM feed_collection_editions WHERE id=?", (checked_id(binding_id),)).fetchone()
        if row is None: raise InputError("Unknown collection edition")
        return load_json(row[0])

    def opml(self, collection_id, revision=None):
        with self.ws.mutex:
            value = self.collection(collection_id,revision)
            return selected_opml(value,{s:self.source(s) for s in value["sources"]})

    def export(self, binding_id, output):
        with self.ws.mutex,self.ws.scratch() as temp:
            binding = self.binding(binding_id)
            collection = self.collection(binding["collectionId"],binding["collectionRevision"])
            run = self.run(binding["runId"])
            sources = {s:self.source(s) for s in collection["sources"]}
            history = [load_json(r[0]) for r in self.db.execute(
                "SELECT body FROM feed_collection_revisions WHERE id=? AND revision<=? ORDER BY revision",
                (collection["id"],collection["revision"]))]
            for revision in history:
                for s in revision["sources"]: sources.setdefault(s,self.source(s))
            body = {"schema":PACKET,"collection":collection,"revisionHistory":history,"run":run,"binding":binding,"sources":sources}
            native = temp/"feed-project.zip"
            self.ws.export_project(binding["editionId"],native)
            private_write(temp/"collection.json",json_bytes(body))
            private_write(temp/"subscriptions.opml",selected_opml(collection,sources))
            paths = {"feed-project.zip":native,"collection.json":temp/"collection.json","subscriptions.opml":temp/"subscriptions.opml"}
            for source_id in sources: paths["originals/"+source_id+".opml"] = self.source_path(source_id)
            manifest = {"schema":PACKET,"bindingId":binding_id,"files":{
                name:{"sha256":file_digest(path,MAX_PACKET),"bytes":regular(path,MAX_PACKET).st_size} for name,path in paths.items()}}
            output = Path(output)
            with os.fdopen(os.open(output,os.O_CREAT|os.O_EXCL|os.O_RDWR,0o600),"w+b") as handle:
                owned = os.fstat(handle.fileno())
                try:
                    with zipfile.ZipFile(handle,"w",compression=zipfile.ZIP_DEFLATED) as archive:
                        archive.writestr("manifest.json",json_bytes(manifest))
                        for name,path in paths.items(): archive.write(path,name)
                    handle.flush(); os.fsync(handle.fileno())
                except Exception:
                    try:
                        present = output.lstat()
                        if (present.st_dev,present.st_ino)==(owned.st_dev,owned.st_ino): output.unlink()
                    except FileNotFoundError: pass
                    raise
            return {"bindingId":binding_id,"editionId":binding["editionId"],"file":str(output),
                    "bytes":regular(output,MAX_PACKET).st_size,"sha256":file_digest(output,MAX_PACKET)}

    def receive(self, packet, operation_id):
        packet = Path(packet); packet_sha = file_digest(packet,MAX_PACKET)
        with self.ws.mutex:
            saved = self._begin(operation_id,{"action":"collection-receive","sha256":packet_sha})
            if saved is not None: return saved
            with self.ws.scratch() as temp,zipfile.ZipFile(packet) as archive:
                names, total = set(),0
                for info in archive.infolist():
                    name = info.filename
                    limit = 1024*1024*1024 if name=="feed-project.zip" else 64*1024*1024 if name=="collection.json" else MAX_OPML_BYTES
                    if (name in names or name not in ("manifest.json","collection.json","feed-project.zip","subscriptions.opml") and
                        not re.fullmatch(r"originals/[0-9a-f]{64}\.opml",name) or info.is_dir() or info.flag_bits&1 or
                        stat.S_ISLNK(info.external_attr>>16) or info.compress_type not in (zipfile.ZIP_STORED,zipfile.ZIP_DEFLATED) or info.file_size>limit):
                        raise InputError("Unsupported collection handover member")
                    total += info.file_size; names.add(name)
                    if total>MAX_PACKET or len(names)>10004: raise InputError("Collection handover exceeds its complete supported size")
                    path=temp/name; path.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
                    with archive.open(info) as inp, path.open("xb") as out:
                        path.chmod(0o600); copied=0
                        while data:=inp.read(65536):
                            copied+=len(data)
                            if copied>limit: raise InputError("Collection member exceeds its supported size")
                            out.write(data)
                if not {"manifest.json","collection.json","feed-project.zip","subscriptions.opml"}<=names:
                    raise InputError("Incomplete collection handover")
                manifest=load_json((temp/"manifest.json").read_bytes())
                if manifest.get("schema")!=PACKET or set(manifest.get("files",{}))!=names-{"manifest.json"}:
                    raise InputError("Collection manifest membership differs")
                for name,expected in manifest["files"].items():
                    path=temp/name
                    if expected!={"sha256":file_digest(path,MAX_PACKET),"bytes":regular(path,MAX_PACKET).st_size}:
                        raise InputError("Collection original bytes differ: "+name)
                body=load_json((temp/"collection.json").read_bytes())
                if not isinstance(body,dict) or set(body)!={"schema","collection","revisionHistory","run","binding","sources"} or body["schema"]!=PACKET:
                    raise InputError("Unsupported collection handover body")
                collection,run,binding,sources=(body[k] for k in ("collection","run","binding","sources"))
                if (not sealed(collection) or collection.get("schema")!=COLLECTION or not sealed(binding,"id") or
                    binding.get("schema")!=BINDING or manifest.get("bindingId")!=binding["id"] or
                    binding["collectionId"]!=collection["id"] or binding["collectionRevision"]!=collection["revision"] or
                    binding["collectionDigest"]!=collection["digest"]):
                    raise InputError("Collection edition identity differs")
                if set(sources)!={n[10:-5] for n in names if n.startswith("originals/")}:
                    raise InputError("Original OPML source membership differs")
                for source_id,document in sources.items():
                    data=(temp/"originals"/(checked_id(source_id)+".opml")).read_bytes()
                    if parse_opml(data,self.validate_url)!=document or document["sourceId"]!=source_id:
                        raise InputError("Subscription metadata differs from its original OPML")
                revisions=body["revisionHistory"]
                if not isinstance(revisions,list) or not revisions or len(revisions)>10000:
                    raise InputError("Invalid collection revision history")
                if len({r["revision"] for r in revisions})!=len(revisions) or collection not in revisions:
                    raise InputError("Collection revision history repeats or omits the selected edition")
                for revision in revisions:
                    if not sealed(revision) or revision.get("schema")!=COLLECTION or revision["id"]!=collection["id"] or \
                       type(revision["revision"]) is not int or not 1<=revision["revision"]<=collection["revision"]:
                        raise InputError("Collection historical revision identity differs")
                    configs={f["id"]:self.normalize_config(f["id"],f["config"]) for f in revision["feeds"]}
                    if len(configs)!=len(revision["feeds"]) or any(configs[f["id"]]!=f["config"] for f in revision["feeds"]) or set(revision["sources"])-set(sources):
                        raise InputError("Collection feed/source declaration differs")
                    self._members(revision["members"],{s:sources[s] for s in revision["sources"]},configs)
                if (temp/"subscriptions.opml").read_bytes()!=selected_opml(collection,sources):
                    raise InputError("Selected OPML differs from the saved collection choices")
                request=run.get("request",{})
                expected_keys={"action","collectionId","expectedRevision","collectionDigest","expectedRevisions","pageLimit","force"}
                if (not isinstance(request,dict) or set(request)!=expected_keys or request["action"]!="collection-capture" or
                    request["collectionId"]!=collection["id"] or request["expectedRevision"]!=collection["revision"] or
                    not isinstance(request["expectedRevisions"],dict) or set(request["expectedRevisions"])!=set(self.feed_ids(collection)) or
                    any(type(v) is not int or v<1 for v in request["expectedRevisions"].values()) or
                    type(request["pageLimit"]) is not int or not 1<=request["pageLimit"]<=1000 or type(request["force"]) is not bool):
                    raise InputError("Original collection acquisition request differs")
                self.identifier(run.get("operationId"))
                if (run.get("schema")!=RUN or run.get("state")!="CAPTURED" or run.get("id")!=binding["runId"] or
                    run.get("collectionId")!=collection["id"] or run.get("collectionRevision")!=collection["revision"] or
                    run.get("collectionDigest")!=collection["digest"] or request.get("collectionDigest")!=collection["digest"] or
                    digest(json_bytes({"operationId":run.get("operationId"),"payload":request}))!=run.get("id")):
                    raise InputError("Original collection acquisition identity differs")
                with zipfile.ZipFile(temp/"feed-project.zip") as native:
                    info=native.getinfo("project.json")
                    if info.file_size>256*1024*1024: raise InputError("Original feed project metadata exceeds its supported size")
                    original=load_json(native.read(info))
                edition=original["edition"]
                ids=set(self.feed_ids(collection))
                if (set(f["id"] for f in original["feeds"])!=ids or set(i["feedId"] for i in run["items"])!=ids or
                    len(run["items"])!=len(ids) or binding["editionId"]!=edition["id"] or
                    binding["feedRevisions"]!=edition["revisions"]):
                    raise InputError("Collection and original native edition select different feeds")
                captures={c["id"]:c for c in original["captures"]}
                applications={a["captureId"]:a["body"] for a in original["applications"]}
                frozen_configs={f["id"]:f["config"] for f in collection["feeds"]}
                for item in run["items"]:
                    capture=captures.get(item["captureId"]); applied=applications.get(item["captureId"])
                    if item["state"]!="CAPTURED" or not capture or capture["feedId"]!=item["feedId"] or not applied or \
                       applied["revision"]!=binding["feedRevisions"][item["feedId"]] or capture["operationId"]!=item["operationId"] or \
                       item["operationId"]!=child_operation("capture",run["operationId"],item["feedId"]) or \
                       capture["config"]!=frozen_configs[item["feedId"]]:
                        raise InputError("Collection capture/application join differs")
                # Preflight every collection identity before the original receiver mutates.
                tables=[
                    ("feed_subscription_sources",("id",),[(s,json_bytes(d).decode()) for s,d in sources.items()],"id,body"),
                    ("feed_collection_revisions",("id","revision"),[(r["id"],r["revision"],json_bytes(r).decode()) for r in revisions],"id,revision,body"),
                    ("feed_collections",("id",),[(collection["id"],collection["revision"],json_bytes(collection).decode())],"id,revision,body"),
                    ("feed_collection_runs",("id",),[(run["id"],run["collectionId"],json_bytes(run).decode())],"id,collection_id,body"),
                    ("feed_collection_editions",("id",),[(binding["id"],binding["collectionId"],json_bytes(binding).decode())],"id,collection_id,body")]
                for table,keys,rows,columns in tables:
                    for values in rows:
                        existing=self.db.execute("SELECT "+columns+" FROM "+table+" WHERE "+" AND ".join(k+"=?" for k in keys),
                                                 values[:len(keys)]).fetchone()
                        if existing is not None and tuple(existing)!=values:
                            raise InputError("Existing collection identity differs; receive into a separate workspace")
                native_result=self.ws.receive_project(temp/"feed-project.zip",child_operation("receive",operation_id))
                for source_id in sources:
                    self.ws.add_source(io.BytesIO((temp/"originals"/(source_id+".opml")).read_bytes()),
                                       sources[source_id]["head"].get("title","Subscriptions")[:160],"subscriptions.opml")
                with self.db:
                    for table,keys,rows,columns in tables:
                        for values in rows:
                            if table=="feed_subscription_sources":
                                self.db.execute("INSERT OR IGNORE INTO "+table+" VALUES(?,?,?)",values+(time.time(),))
                            else:
                                self.db.execute("INSERT OR IGNORE INTO "+table+" ("+columns+") VALUES("+",".join("?" for _ in values)+")",values)
                    result={"schema":PACKET,"packetSha256":packet_sha,"collectionId":collection["id"],
                            "collectionRevision":collection["revision"],"bindingId":binding["id"],"editionId":binding["editionId"],
                            "runId":run["id"],"native":native_result}
                    return self._done(operation_id,result)
