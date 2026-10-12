"""MIT. IATI portfolios on the original retained XML/CSV/native dataset workspace."""
from __future__ import annotations

import csv
from contextlib import contextmanager
from decimal import Decimal, localcontext
import hashlib
import html
import io
import json
import os
from pathlib import Path
import re
import shutil
import stat
import sys
import time
import zipfile

from iati_source import (
    InputError, MAX_SOURCE, inventory, validate_plan, extract, dataset_spec,
    preset, presets as source_presets, TRANSACTION_TYPES, financial_dimensions,
)
from workspace import (
    Workspace, SourceFormat, json_bytes, load_json, digest, checked_id,
    private_write, regular, file_digest, sync_dir,
)

SCHEMA = "stellar-forge.iati-portfolio.v1"
REPORT = "stellar-forge.iati-report.v1"
PACKET = "stellar-forge.iati-portfolio-packet.v1"
REPORT_PACKET = "stellar-forge.iati-report-packet.v1"
COMPARE = "stellar-forge.iati-portfolio-comparison.v1"
IATI_FORMAT = SourceFormat("iati", "IATI", inventory, validate_plan, extract, dataset_spec)
COLLECTIONS = ("activities", "transactions", "budgets")
MAX_PACKET = 4 * 1024 * 1024 * 1024
MAX_METADATA = 64 * 1024 * 1024
MAX_FILES = 16384
REQUEST = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,159}\Z")
csv.field_size_limit(16 * 1024 * 1024)

def short_text(value, name, limit, empty=False):
    if not isinstance(value, str) or len(value) > limit or (not empty and not value.strip()):
        raise InputError(f"{name} must be {'0' if empty else '1'}–{limit} characters")
    return value.strip() if not empty else value

def revision_number(value):
    if type(value) is not int or value < 1:
        raise InputError("Portfolio revision must be a positive integer")
    return value

def stable_build(view):
    """Portable projection identity; SQLite index bytes belong to the receiving runtime."""
    if not isinstance(view, dict) or not isinstance(view.get("files"), dict) or not isinstance(view.get("native"), dict):
        raise InputError("Invalid native build review")
    try:
        return {**{key: view[key] for key in ("schema", "id", "source", "plan", "rowCount", "keys", "columns")},
                "files": {name: view["files"][name] for name in ("data.csv", "dataset.json")},
                "native": {key: view["native"][key] for key in ("snapshot", "rowCount")}}
    except KeyError as error:
        raise InputError("Incomplete native build review") from error

def json_file(path, value):
    private_write(path, json_bytes(value))

@contextmanager
def export_lease(output):
    lock_path = output.parent / ("." + output.name + ".iati-export.lock")
    fd = os.open(lock_path, os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
    lock = os.fdopen(fd, "r+b", buffering=0)
    try:
        regular(lock_path, 4096)
        if os.name == "posix":
            import fcntl
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        else:
            import msvcrt
            if not lock.read(1):
                lock.write(b"0")
            lock.seek(0)
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        yield
    except BlockingIOError as error:
        raise InputError("This output already has an active export") from error
    finally:
        lock.close()

def verified_native_manifest(archive, build_id):
    """Read the original six-file dataset packet and verify every declared byte."""
    limits = {"manifest.json": 16384, "source.iati": MAX_SOURCE, "plan.json": 65536,
              "data.csv": MAX_SOURCE, "dataset.json": 65536, "review.json": 131072}
    infos = archive.infolist()
    if len(infos) != len(limits) or {info.filename for info in infos} != set(limits):
        return None
    for info in infos:
        if (info.flag_bits & 1 or info.is_dir()
            or info.compress_type not in {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED}
            or stat.S_ISLNK(info.external_attr >> 16) or info.file_size > limits[info.filename]):
            return None
    raw = archive.read("manifest.json")
    manifest = load_json(raw)
    if (not isinstance(manifest, dict) or set(manifest) != {"schema", "build", "files"}
        or manifest.get("schema") != "stellar-forge.iati-packet.v1"
        or manifest.get("build") != build_id or not isinstance(manifest.get("files"), dict)
        or set(manifest["files"]) != set(limits) - {"manifest.json"}):
        return None
    for name in manifest["files"]:
        h, size = hashlib.sha256(), 0
        with archive.open(name) as stream:
            while block := stream.read(65536):
                size += len(block)
                if size > limits[name]:
                    return None
                h.update(block)
        if manifest["files"][name] != {"bytes": size, "sha256": h.hexdigest()}:
            return None
    return raw

def completed_packet_matches(output, sources, schema, metadata, entries):
    """Completed output is immutable; an identical logical export can be replayed."""
    regular(output, MAX_PACKET)
    with zipfile.ZipFile(output) as archive:
        infos = archive.infolist()
        names = [info.filename for info in infos]
        if (len(names) != len(set(names)) or set(names) != set(sources) | {"manifest.json"}
            or archive.getinfo("manifest.json").file_size > MAX_METADATA):
            return False
        manifest = load_json(archive.read("manifest.json"))
        if (not isinstance(manifest, dict) or set(manifest) != {"schema", "files", *metadata}
            or manifest.get("schema") != schema or any(manifest.get(k) != v for k, v in metadata.items())
            or not isinstance(manifest.get("files"), dict) or set(manifest["files"]) != set(sources)):
            return False
        for name in sources:
            info = archive.getinfo(name)
            if (info.file_size > MAX_PACKET or info.is_dir() or info.flag_bits & 1
                or info.compress_type not in {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED}
                or stat.S_ISLNK(info.external_attr >> 16)):
                return False
            h, size = hashlib.sha256(), 0
            with archive.open(info) as stream:
                while block := stream.read(65536):
                    h.update(block)
                    size += len(block)
                    if size > MAX_PACKET:
                        return False
            if manifest["files"][name] != {"bytes": size, "sha256": h.hexdigest()}:
                return False
            if manifest["files"][name] == entries[name]:
                continue
            # The original nested dataset packet writes ZIP timestamps at export
            # time. Its complete native manifest defines its logical identity.
            if not re.fullmatch(r"packets/[0-9a-f]{64}\.zip", name):
                return False
            with archive.open(info) as stream, zipfile.ZipFile(stream) as old_packet, zipfile.ZipFile(sources[name]) as new_packet:
                build_id = Path(name).stem
                old_manifest = verified_native_manifest(old_packet, build_id)
                if old_manifest is None or old_manifest != verified_native_manifest(new_packet, build_id):
                    return False
        return True

def packet_write(output, sources, schema, metadata):
    """Stage the complete archive, then publish atomically without replacing a file."""
    entries = {name: {"bytes": regular(path, MAX_METADATA if name.endswith(".json") else MAX_PACKET).st_size,
                      "sha256": file_digest(path, MAX_METADATA if name.endswith(".json") else MAX_PACKET)}
               for name, path in sources.items()}
    if len(entries) > MAX_FILES or sum(x["bytes"] for x in entries.values()) > MAX_PACKET:
        raise InputError("Complete packet exceeds its 4 GiB expanded capacity")
    manifest = {"schema": schema, "files": entries, **metadata}
    manifest_bytes = json_bytes(manifest)
    if len(manifest_bytes) > MAX_METADATA:
        raise InputError("Packet manifest exceeds 64 MiB")
    stage = output.parent / ("." + output.name + ".iati-export.partial")
    with export_lease(output):
        if stage.exists() or stage.is_symlink():
            info = stage.lstat()
            if not stat.S_ISREG(info.st_mode) or (os.name == "posix" and (info.st_uid != os.getuid() or info.st_mode & 0o077)):
                raise InputError("Export stage is not an operator-owned private file")
            if output.exists() and not output.is_symlink() and os.path.samefile(stage, output):
                if info.st_nlink != 2:
                    raise InputError("Published export has an unexpected additional hard link")
                stage.unlink()
                sync_dir(output.parent)
            else:
                if info.st_nlink != 1:
                    raise InputError("Incomplete export has an unexpected hard link")
                preserved = stage.with_name(stage.name + ".interrupted-" + os.urandom(8).hex())
                os.rename(stage, preserved)
                sync_dir(output.parent)
        if output.exists() or output.is_symlink():
            if not completed_packet_matches(output, sources, schema, metadata, entries):
                raise InputError("Completed output belongs to a different export; choose another output path")
            return {"file": str(output), "bytes": output.stat().st_size,
                    "sha256": file_digest(output, MAX_PACKET), "reused": True}
        with os.fdopen(os.open(stage, os.O_RDWR | os.O_CREAT | os.O_EXCL, 0o600), "w+b") as out:
            with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as archive:
                archive.writestr("manifest.json", manifest_bytes)
                for name in sorted(sources):
                    archive.write(sources[name], name)
            out.flush()
            os.fsync(out.fileno())
        # link provides an atomic no-replace publication; the recoverable stage
        # name covers interruption between publication and unlink.
        os.link(stage, output)
        stage.unlink()
        sync_dir(output.parent)
        return {"file": str(output), "bytes": output.stat().st_size,
                "sha256": file_digest(output, MAX_PACKET), "reused": False}

def packet_read(path, temp, expected_schema):
    """Verify the full declared archive before importing any source or portfolio."""
    regular(path, MAX_PACKET)
    with zipfile.ZipFile(path) as archive:
        infos = archive.infolist()
        names = [x.filename for x in infos]
        if len(infos) > MAX_FILES + 1 or len(set(names)) != len(names) or "manifest.json" not in names:
            raise InputError("Packet has duplicate, missing or excessive members")
        total = 0
        for info in infos:
            if (not re.fullmatch(r"(?:manifest|portfolio-history|requests|comparisons)\.json|reports/[A-Za-z0-9._-]+|packets/[0-9a-f]{64}\.zip", info.filename)
                or info.is_dir() or info.flag_bits & 1
                or info.compress_type not in {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED}
                or stat.S_ISLNK(info.external_attr >> 16)):
                raise InputError("Packet member path, type or compression is invalid")
            limit = MAX_METADATA if info.filename.endswith(".json") else MAX_PACKET
            if info.file_size > limit:
                raise InputError("Packet member exceeds its declared capacity")
            total += info.file_size
            if total > MAX_PACKET:
                raise InputError("Expanded packet exceeds 4 GiB")
        manifest_info = archive.getinfo("manifest.json")
        if manifest_info.file_size > MAX_METADATA:
            raise InputError("Packet manifest exceeds 64 MiB")
        manifest = load_json(archive.read(manifest_info))
        if (not isinstance(manifest, dict) or manifest.get("schema") != expected_schema
            or not isinstance(manifest.get("files"), dict)
            or set(manifest["files"]) != set(names) - {"manifest.json"}):
            raise InputError("Packet manifest does not name the complete archive")
        for info in infos:
            if info.filename == "manifest.json":
                continue
            path_out = temp / info.filename
            path_out.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            h = hashlib.sha256()
            size = 0
            with archive.open(info) as inp, os.fdopen(os.open(path_out, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as out:
                while block := inp.read(65536):
                    size += len(block)
                    if size > info.file_size or size > MAX_PACKET:
                        raise InputError("Packet member expanded beyond its declared size")
                    h.update(block)
                    out.write(block)
                out.flush()
                os.fsync(out.fileno())
            if manifest["files"][info.filename] != {"bytes": size, "sha256": h.hexdigest()}:
                raise InputError(f"Packet member differs from its declared identity: {info.filename}")
        return manifest

class IatiWorkspace(Workspace):
    def __init__(self, root, create=False):
        super().__init__(root, create=create, source_format=IATI_FORMAT)
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS iati_portfolios(
                id TEXT NOT NULL, revision INTEGER NOT NULL, body TEXT NOT NULL,
                PRIMARY KEY(id,revision));
            CREATE TABLE IF NOT EXISTS iati_requests(
                id TEXT PRIMARY KEY, request_sha TEXT NOT NULL, portfolio TEXT NOT NULL,
                revision INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS iati_portfolio_comparisons(
                id TEXT PRIMARY KEY, portfolio TEXT NOT NULL, before_revision INTEGER NOT NULL,
                after_revision INTEGER NOT NULL, body TEXT NOT NULL);
        """)

    def presets(self):
        return source_presets()

    def profile(self, source_id):
        source = self.source(source_id)
        return {"schema": "stellar-forge.iati-profile.v1",
                "source": {k: source[k] for k in ("id", "label", "name", "bytes")},
                "inventory": source["inventory"]}

    def state(self):
        with self.mutex:
            result = super().state()
            result["portfolios"] = self.portfolios()
            return result

    def portfolios(self):
        with self.mutex:
            return [load_json(row["body"]) for row in self.db.execute("""
                SELECT p.body FROM iati_portfolios p JOIN
                (SELECT id,MAX(revision) AS revision FROM iati_portfolios GROUP BY id) latest
                ON p.id=latest.id AND p.revision=latest.revision ORDER BY p.id""")]

    def portfolio(self, ident, revision=None):
        checked_id(ident)
        with self.mutex:
            if revision is None:
                row = self.db.execute("SELECT body FROM iati_portfolios WHERE id=? ORDER BY revision DESC LIMIT 1", (ident,)).fetchone()
            else:
                row = self.db.execute("SELECT body FROM iati_portfolios WHERE id=? AND revision=?", (ident, revision_number(revision))).fetchone()
            if row is None:
                raise InputError("Unknown saved portfolio revision")
            return load_json(row["body"])

    def history(self, ident):
        self.portfolio(ident)
        with self.mutex:
            return [load_json(r["body"]) for r in self.db.execute(
                "SELECT body FROM iati_portfolios WHERE id=? ORDER BY revision", (ident,))]

    def _definition(self, raw):
        if not isinstance(raw, dict):
            raise InputError("Portfolio definition must be an object")
        allowed = {"requestId", "name", "notes", "sources", "selection", "review", "id", "expectedRevision"}
        if set(raw) - allowed:
            raise InputError("Unknown portfolio field: " + ", ".join(sorted(set(raw) - allowed)))
        request = raw.get("requestId")
        if not isinstance(request, str) or not REQUEST.fullmatch(request):
            raise InputError("Use a unique requestId of 1–160 letters, digits, dots, dashes, underscores or colons")
        if ("id" in raw) != ("expectedRevision" in raw):
            raise InputError("A portfolio edit requires both id and expectedRevision")
        ident = checked_id(raw["id"]) if "id" in raw else None
        expected = revision_number(raw["expectedRevision"]) if ident else None
        sources = raw.get("sources")
        if (not isinstance(sources, list) or not 1 <= len(sources) <= 32
            or any(not isinstance(s, str) for s in sources) or len(set(sources)) != len(sources)):
            raise InputError("Select 1–32 distinct complete publisher source IDs")
        sources = sorted(checked_id(s) for s in sources)
        for source in sources:
            self.source(source)
        selection = raw.get("selection", {})
        if not isinstance(selection, dict) or set(selection) - {"activityIds", "currencies", "transactionTypes", "budgetTypes", "dateFrom", "dateTo"}:
            raise InputError("Unknown portfolio selection field")
        # Validate each native collection using the same canonical source mapper.
        plans = {collection: self._collection_plan(collection, selection) for collection in COLLECTIONS}
        normalized = {}
        for p in plans.values():
            normalized.update(p["selection"])
        review = raw.get("review", {"status": "draft", "reviewer": "", "note": ""})
        if not isinstance(review, dict) or set(review) != {"status", "reviewer", "note"} or review["status"] not in {"draft", "reviewed", "needs-correction"}:
            raise InputError("Review requires status draft/reviewed/needs-correction, reviewer and note")
        review = {"status": review["status"],
                  "reviewer": short_text(review["reviewer"], "Reviewer", 160, empty=review["status"] == "draft"),
                  "note": short_text(review["note"], "Review note", 4000, empty=True)}
        definition = {"name": short_text(raw.get("name"), "Portfolio name", 160),
                      "notes": short_text(raw.get("notes", ""), "Portfolio notes", 16000, empty=True),
                      "sources": sources, "selection": normalized, "review": review}
        return request, ident, expected, definition, plans

    def _collection_plan(self, collection, selection):
        applicable = {"activityIds"}
        if collection != "activities":
            applicable |= {"currencies", "dateFrom", "dateTo"}
            applicable.add("transactionTypes" if collection == "transactions" else "budgetTypes")
        selected = {k: v for k, v in selection.items() if k in applicable}
        return preset(collection, name="IATI portfolio " + collection, selection=selected, allowEmpty=True)

    def _rows(self, build):
        path = self._build_path(build["id"], "data.csv")
        plan = self.plan(build["plan"])
        columns = [c["name"] for c in plan["columns"]]
        with path.open("r", encoding="utf-8", newline="") as stream:
            reader = csv.DictReader(stream)
            if reader.fieldnames != columns:
                raise InputError("Native edition column order differs from its retained mapping")
            count = 0
            for row in reader:
                if None in row or any(v is None for v in row.values()):
                    raise InputError("Native edition contains an incomplete CSV record")
                count += 1
                yield row
            if count != build["rowCount"]:
                raise InputError("Native edition row count changed")

    def _summarize(self, editions, selection, issue_sink=None, row_sink=None):
        counts = {"sources": len(editions), "activities": 0, "transactions": 0, "budgets": 0,
                  "plannedDisbursementsRetained": 0, "reviewRecords": 0,
                  "excludedFinancialRecords": 0}
        activities = {}
        groups = {}
        coverage = []
        with localcontext() as context:
            context.prec = 1024
            for edition in editions:
                source = edition["source"]
                source_counts = {"source": source, "activities": 0, "transactions": 0, "budgets": 0}
                orgs = set()
                for collection in COLLECTIONS:
                    build = edition[collection]
                    if build["source"] != source:
                        raise InputError("Portfolio edition refers to a different publisher source")
                    for row in self._rows(build):
                        counts[collection] += 1
                        source_counts[collection] += 1
                        if row_sink:
                            row_sink(collection, source, row)
                        if collection == "activities":
                            activity = row["activity_id"]
                            if activity in activities:
                                raise InputError(f"Activity {activity} occurs in both selected sources {activities[activity]} and {source}; select one publisher edition for this activity")
                            activities[activity] = source
                            if len(activities) > 1000000:
                                raise InputError("Portfolio exceeds one million distinct activities")
                            orgs.add(row["reporting_org_ref"])
                            counts["plannedDisbursementsRetained"] += int(row["planned_disbursement_count"])
                        issues = load_json(row["issues_json"])
                        if not isinstance(issues, list):
                            raise InputError("Native financial review issues are invalid")
                        if issues:
                            counts["reviewRecords"] += 1
                            if issue_sink:
                                issue_sink({"source": source, "collection": collection,
                                            "rowId": row["row_id"], "activityId": row["activity_id"],
                                            "issues": issues})
                        if collection == "activities":
                            continue
                        value = row["value_decimal"]
                        if row["financial_eligible"] != "true":
                            counts["excludedFinancialRecords"] += 1
                            continue
                        dimensions = financial_dimensions(row, collection)
                        key = json_bytes(dimensions).decode()
                        if key not in groups:
                            groups[key] = {**dimensions, "count": 0, "amount": Decimal(0)}
                        groups[key]["count"] += 1
                        groups[key]["amount"] += Decimal(value)
                        if len(groups) > 250000:
                            raise InputError("Portfolio financial group count exceeds 250,000")
                coverage.append({**source_counts, "reportingOrgRefs": sorted(orgs)})
        financial = []
        for key in sorted(groups):
            group = groups[key]
            financial.append({**group, "amount": format(group["amount"], "f")})
        return {"schema": REPORT, "counts": counts, "financialGroups": financial,
                "reviewCount": counts["reviewRecords"],
                "coverage": {"bySource": coverage, "activityCount": len(activities),
                    "activityIdsSha256": digest(json_bytes(sorted(activities)))},
                "selection": selection,
                "semantics": {
                    "amounts": "Exact reported decimals, grouped by reporting organisation, hierarchy, collection, currency, financial type and value date; budgets additionally by status and whole period",
                    "dates": "Transactions use transaction date; value date remains separate; selected budgets retain their whole overlapping period",
                    "sectors": "Publisher vocabulary/code/percentage/narrative associations remain together in each full record; amounts are not multiplied by classification rows",
                    "identity": "Activity identifier; unique publisher transaction ref or budget period/type; otherwise complete-content identity with occurrence",
                    "excluded": "Records missing an eligible amount, currency, date or financial type remain in the full editions and review files",
                    "plannedDisbursements": "Retained in publisher XML and activity counts; distinct from transactions and budgets",
                }}

    def save_portfolio(self, raw):
        with self.mutex:
            request, ident, expected, definition, plans = self._definition(raw)
            request_sha = digest(json_bytes(raw))
            prior_request = self.db.execute("SELECT * FROM iati_requests WHERE id=?", (request,)).fetchone()
            if prior_request:
                if prior_request["request_sha"] != request_sha:
                    raise InputError("requestId was already used for a different portfolio request")
                return self.portfolio(prior_request["portfolio"], prior_request["revision"])
            previous = self.portfolio(ident) if ident else None
            if previous and previous["revision"] != expected:
                raise InputError(f"Portfolio changed; current revision is {previous['revision']}")
            mapped = {collection: self.save_plan(plan) for collection, plan in plans.items()}
            editions = []
            for source in definition["sources"]:
                editions.append({"source": source, **{collection: self.build(source, mapped[collection]["id"])
                                                      for collection in COLLECTIONS}})
            report = self._summarize(editions, definition["selection"])
            now = time.time()
            ident = ident or digest(os.urandom(32))
            revision = previous["revision"] + 1 if previous else 1
            result = {"schema": SCHEMA, "id": ident, "revision": revision,
                      **definition, "editions": editions, "report": report,
                      "created": previous["created"] if previous else now, "updated": now,
                      "previousRevision": previous["revision"] if previous else None,
                      "definitionSha256": digest(json_bytes(definition))}
            encoded = json_bytes(result)
            if len(encoded) > MAX_METADATA:
                raise InputError("Complete portfolio revision exceeds 64 MiB")
            with self.db:
                self.db.execute("INSERT INTO iati_portfolios VALUES(?,?,?)", (ident, revision, encoded.decode()))
                self.db.execute("INSERT INTO iati_requests VALUES(?,?,?,?)", (request, request_sha, ident, revision))
            return result

    def report(self, ident, revision=None):
        with self.mutex:
            portfolio = self.portfolio(ident, revision)
            report = self._summarize(portfolio["editions"], portfolio["selection"])
            if report != portfolio["report"]:
                raise InputError("Retained portfolio report differs from its complete native editions")
            return {**report, "portfolio": ident, "revision": portfolio["revision"],
                    "name": portfolio["name"], "notes": portfolio["notes"], "review": portfolio["review"],
                    "definitionSha256": portfolio["definitionSha256"]}

    def compare_portfolio(self, raw):
        if not isinstance(raw, dict) or set(raw) - {"id", "beforeRevision", "afterRevision", "pairs"}:
            raise InputError("Comparison requires portfolio id, beforeRevision, afterRevision and optional source pairs")
        revision_number(raw.get("beforeRevision"))
        revision_number(raw.get("afterRevision"))
        with self.mutex:
            before = self.portfolio(raw.get("id"), raw["beforeRevision"])
            after = self.portfolio(raw.get("id"), raw["afterRevision"])
            result = self._compare_revisions(before, after, raw.get("pairs"))
            with self.db:
                self.db.execute("INSERT OR IGNORE INTO iati_portfolio_comparisons VALUES(?,?,?,?,?)",
                    (result["id"], before["id"], before["revision"], after["revision"], json_bytes(result).decode()))
            return result

    def _compare_revisions(self, before, after, supplied=None):
        if before["revision"] >= after["revision"]:
            raise InputError("Select an earlier and a later portfolio revision")
        left = {e["source"]: e for e in before["editions"]}
        right = {e["source"]: e for e in after["editions"]}
        pairs = [{"before": s, "after": s} for s in sorted(set(left) & set(right))]
        remaining_left = set(left) - set(right)
        remaining_right = set(right) - set(left)
        if supplied is not None:
            if not isinstance(supplied, list):
                raise InputError("Source pairs must be an array")
            for pair in supplied:
                if not isinstance(pair, dict) or set(pair) != {"before", "after"} or pair["before"] not in remaining_left or pair["after"] not in remaining_right:
                    raise InputError("Each replacement must pair one distinct selected earlier source with one distinct selected later source")
                remaining_left.remove(pair["before"])
                remaining_right.remove(pair["after"])
                pairs.append(pair)
        else:
            before_orgs = {x["source"]: tuple(x["reportingOrgRefs"]) for x in before["report"]["coverage"]["bySource"]}
            after_orgs = {x["source"]: tuple(x["reportingOrgRefs"]) for x in after["report"]["coverage"]["bySource"]}
            for source in sorted(remaining_left.copy()):
                signature = before_orgs[source]
                matches = [s for s in remaining_right if signature and after_orgs[s] == signature]
                reverse = [s for s in remaining_left if before_orgs[s] == signature]
                if len(matches) == len(reverse) == 1:
                    target = matches[0]
                    pairs.append({"before": source, "after": target})
                    remaining_left.remove(source)
                    remaining_right.remove(target)
        original = []
        selection_changed = before["selection"] != after["selection"]
        for pair in pairs:
            for collection in COLLECTIONS:
                earlier, later = left[pair["before"]][collection], right[pair["after"]][collection]
                if earlier["plan"] == later["plan"]:
                    original.append({"collection": collection, **pair,
                                     "comparison": self.compare(earlier["id"], later["id"])})
        summary = {"schema": COMPARE, "portfolio": before["id"],
                   "beforeRevision": before["revision"], "afterRevision": after["revision"],
                   "selectionChanged": selection_changed,
                   "pairs": pairs, "addedSources": sorted(remaining_right),
                   "removedSources": sorted(remaining_left), "comparisons": original,
                   "beforeCounts": before["report"]["counts"], "afterCounts": after["report"]["counts"],
                   "semantics": "Exact native field comparison for identical mappings; source additions/removals and selection changes are retained separately"}
        ident = digest(json_bytes(summary))
        result = {"id": ident, **summary}
        return result

    def _report_files(self, portfolio, destination, comparison_rows=None):
        calculated = self._summarize(portfolio["editions"], portfolio["selection"])
        if calculated != portfolio["report"]:
            raise InputError("Retained report differs from its complete native editions")
        report = {**calculated, "portfolio": portfolio["id"], "revision": portfolio["revision"],
                  "name": portfolio["name"], "notes": portfolio["notes"], "review": portfolio["review"],
                  "definitionSha256": portfolio["definitionSha256"]}
        destination.mkdir(mode=0o700)
        files = {}
        streams = {}
        writers = {}
        try:
            for collection in COLLECTIONS:
                path = destination / (collection + ".csv")
                stream = os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w", encoding="utf-8", newline="")
                streams[collection] = stream
                fields = ["source_id"] + [c["name"] for c in self.plan(portfolio["editions"][0][collection]["plan"])["columns"]]
                writers[collection] = csv.DictWriter(stream, fieldnames=fields, lineterminator="\n")
                writers[collection].writeheader()
                files[path.name] = path
            issue_path = destination / "review.jsonl"
            issue_stream = os.fdopen(os.open(issue_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb")
            streams["review"] = issue_stream
            self._summarize(portfolio["editions"], portfolio["selection"],
                issue_sink=lambda issue: issue_stream.write(json_bytes(issue)),
                row_sink=lambda collection, source, row: writers[collection].writerow({"source_id": source, **row}))
            files[issue_path.name] = issue_path
            for stream in streams.values():
                stream.flush()
                os.fsync(stream.fileno())
        finally:
            for stream in streams.values():
                stream.close()
        json_file(destination / "report.json", report)
        files["report.json"] = destination / "report.json"
        groups = report["financialGroups"]
        cells = ["collection", "reportingOrgRef", "hierarchy", "currency", "transactionTypeLabel", "budgetTypeLabel", "budgetStatusLabel",
                 "periodStart", "periodEnd", "valueDate", "count", "amount"]
        headings = ["Collection", "Reporting organisation", "Hierarchy", "Currency", "Transaction type", "Budget type", "Budget status", "Period start", "Period end", "Value date", "Records", "Reported amount"]
        def escape(value):
            return html.escape(str(value), quote=True)
        rows = "".join("<tr>" + "".join("<td>" + escape(g.get(c, "")) + "</td>" for c in cells) + "</tr>" for g in groups)
        metrics = "".join("<dt>" + escape(k) + "</dt><dd>" + escape(v) + "</dd>" for k, v in report["counts"].items())
        meaning = "".join("<p><strong>" + escape(k) + "</strong> " + escape(v) + "</p>" for k, v in report["semantics"].items())
        document = ('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
                    '<title>' + escape(report["name"]) + '</title><style>body{font:15px system-ui,sans-serif;color:#161616;background:white;max-width:1400px;margin:40px auto;padding:0 24px}h1{font-size:28px}dl{display:grid;grid-template-columns:260px 1fr;gap:6px}dd{margin:0;font-variant-numeric:tabular-nums}table{width:100%;border-collapse:collapse;font-size:13px}th,td{border:1px solid #bbb;padding:8px;text-align:left;vertical-align:top}th{background:#eee}code{overflow-wrap:anywhere}.table{overflow:auto}@media print{body{margin:0;padding:0}thead{display:table-header-group}tr{break-inside:avoid}}</style>'
                    '<h1>' + escape(report["name"]) + '</h1><p>Portfolio revision ' + str(report["revision"]) + '</p><p>' + escape(report["notes"]) + '</p>'
                    '<p>Review: ' + escape(report["review"]["status"]) + ' · ' + escape(report["review"]["reviewer"]) + '</p><p>' + escape(report["review"]["note"]) + '</p>'
                    '<h2>Complete selected records</h2><dl>' + metrics + '</dl><h2>Reported finance</h2><div class="table"><table><thead><tr>'
                    + "".join("<th>" + escape(h) + "</th>" for h in headings) + '</tr></thead><tbody>' + rows + '</tbody></table></div>'
                    '<h2>Interpretation</h2>' + meaning + '<h2>Source coverage</h2><pre>' + escape(json.dumps(report["coverage"], indent=2, ensure_ascii=False)) + '</pre>'
                    '<p>Definition SHA-256: <code>' + escape(report["definitionSha256"]) + '</code></p></html>')
        private_write(destination / "report.html", document.encode())
        files["report.html"] = destination / "report.html"
        if comparison_rows is None:
            comparison_rows = [load_json(row["body"]) for row in self.db.execute(
                "SELECT body FROM iati_portfolio_comparisons WHERE portfolio=? AND after_revision<=? ORDER BY before_revision,after_revision,id",
                (portfolio["id"], portfolio["revision"]))]
        comparison_rows = sorted(comparison_rows, key=lambda c: (c["beforeRevision"], c["afterRevision"], c["id"]))
        json_file(destination / "comparisons.json", comparison_rows)
        files["comparisons.json"] = destination / "comparisons.json"
        native_ids = sorted({c["comparison"]["id"] for comp in comparison_rows for c in comp["comparisons"]})
        for ident in native_ids:
            source = self.comparison_file(ident)
            target = destination / ("changes-" + ident + ".jsonl")
            private_write(target, b"")
            with source.open("rb") as inp, target.open("wb") as out:
                shutil.copyfileobj(inp, out, 1048576)
                out.flush()
                os.fsync(out.fileno())
            files[target.name] = target
        return files

    def write_report(self, ident, output, revision=None):
        output = Path(output)
        with self.mutex, self.scratch() as temp:
            portfolio = self.portfolio(ident, revision)
            files = self._report_files(portfolio, temp / "report")
            return {**packet_write(output, {"reports/" + n: p for n, p in files.items()},
                                   REPORT_PACKET, {"portfolio": ident, "revision": portfolio["revision"]}),
                    "portfolio": ident, "revision": portfolio["revision"]}

    def export_portfolio(self, ident, output, revision=None):
        output = Path(output)
        with self.mutex, self.scratch() as temp:
            portfolio = self.portfolio(ident, revision)
            history = [p for p in self.history(ident) if p["revision"] <= portfolio["revision"]]
            sources = {}
            for filename, value in [
                ("portfolio-history.json", history),
                ("requests.json", [dict(r) for r in self.db.execute(
                    "SELECT * FROM iati_requests WHERE portfolio=? AND revision<=? ORDER BY id", (ident, portfolio["revision"]))]),
                ("comparisons.json", [load_json(r["body"]) for r in self.db.execute(
                    "SELECT body FROM iati_portfolio_comparisons WHERE portfolio=? AND after_revision<=? ORDER BY id", (ident, portfolio["revision"]))]),
            ]:
                json_file(temp / filename, value)
                sources[filename] = temp / filename
            builds = sorted({edition[collection]["id"] for p in history for edition in p["editions"] for collection in COLLECTIONS})
            (temp / "packets").mkdir(mode=0o700)
            for build in builds:
                path = temp / "packets" / (build + ".zip")
                super().export_packet(build, path)
                sources["packets/" + path.name] = path
            reports = self._report_files(portfolio, temp / "reports")
            sources.update({"reports/" + n: p for n, p in reports.items()})
            return {**packet_write(output, sources, PACKET, {"portfolio": ident, "revision": portfolio["revision"]}),
                    "portfolio": ident, "revision": portfolio["revision"]}

    def receive_portfolio(self, path):
        with self.mutex, self.scratch() as temp:
            manifest = packet_read(Path(path), temp, PACKET)
            ident = checked_id(manifest.get("portfolio"))
            last = revision_number(manifest.get("revision"))
            for required in ("portfolio-history.json", "requests.json", "comparisons.json",
                             "reports/report.json", "reports/report.html", "reports/activities.csv",
                             "reports/transactions.csv", "reports/budgets.csv", "reports/review.jsonl",
                             "reports/comparisons.json"):
                if required not in manifest["files"]:
                    raise InputError("Complete portfolio packet is missing " + required)
            if set(manifest) != {"schema", "files", "portfolio", "revision"}:
                raise InputError("Unknown portfolio packet manifest field")
            history = load_json((temp / "portfolio-history.json").read_bytes())
            requests = load_json((temp / "requests.json").read_bytes())
            comparisons = load_json((temp / "comparisons.json").read_bytes())
            if not isinstance(history, list) or len(history) != last or not isinstance(requests, list) or not isinstance(comparisons, list):
                raise InputError("Portfolio packet must retain its complete revision sequence")
            builds = set()
            for index, item in enumerate(history, 1):
                if (not isinstance(item, dict) or item.get("schema") != SCHEMA or item.get("id") != ident
                    or item.get("revision") != index or item.get("previousRevision") != (index - 1 if index > 1 else None)
                    or not isinstance(item.get("sources"), list) or not isinstance(item.get("editions"), list)
                    or [e.get("source") for e in item["editions"]] != item["sources"]):
                    raise InputError("Portfolio history identity or source sequence is invalid")
                existing = self.db.execute("SELECT body FROM iati_portfolios WHERE id=? AND revision=?", (ident, index)).fetchone()
                if existing and load_json(existing["body"]) != item:
                    raise InputError("Receiving portfolio conflicts with an existing revision")
                for edition in item["editions"]:
                    for collection in COLLECTIONS:
                        builds.add(checked_id(edition[collection]["id"]))
            expected_packets = {"packets/" + build + ".zip" for build in builds}
            if {name for name in manifest["files"] if name.startswith("packets/")} != expected_packets:
                raise InputError("Packet must retain exactly every referenced original native dataset")
            for build in sorted(builds):
                received = super().import_packet(temp / "packets" / (build + ".zip"))
                if received["build"]["id"] != build:
                    raise InputError("Nested original dataset packet has another identity")
            for item in history:
                definition = {key: item[key] for key in ("name", "notes", "sources", "selection", "review")}
                _, _, _, canonical_definition, plans = self._definition({
                    "requestId": "receive-validation", **definition})
                if definition != canonical_definition or digest(json_bytes(definition)) != item.get("definitionSha256"):
                    raise InputError("Portfolio definition is not canonical")
                if len(item["editions"]) != len(item["sources"]):
                    raise InputError("Portfolio has an incomplete source edition set")
                for edition in item["editions"]:
                    for collection in COLLECTIONS:
                        build = edition[collection]
                        if (stable_build(self.build_view(build["id"])) != stable_build(build) or build["source"] != edition["source"]
                            or self.plan(build["plan"]) != plans[collection]):
                            raise InputError("Portfolio native edition differs from its declared source or selection")
                if self._summarize(item["editions"], item["selection"]) != item.get("report"):
                    raise InputError("Portfolio financial report does not reconstruct")
            expected_report = {**history[-1]["report"], "portfolio": ident, "revision": last,
                               "name": history[-1]["name"], "notes": history[-1]["notes"],
                               "review": history[-1]["review"], "definitionSha256": history[-1]["definitionSha256"]}
            if load_json((temp / "reports" / "report.json").read_bytes()) != expected_report:
                raise InputError("Complete report differs from the received portfolio")
            if (len({r.get("id") for r in requests if isinstance(r, dict)}) != len(requests)
                or len({r.get("id") for r in comparisons if isinstance(r, dict)}) != len(comparisons)):
                raise InputError("Packet repeats a request or comparison identity")
            for request in requests:
                if (not isinstance(request, dict) or set(request) != {"id", "request_sha", "portfolio", "revision"}
                    or not isinstance(request["id"], str) or not REQUEST.fullmatch(request["id"])
                    or request["portfolio"] != ident or type(request["revision"]) is not int or not 1 <= request["revision"] <= last):
                    raise InputError("Received portfolio request identity is invalid")
                checked_id(request["request_sha"])
                existing = self.db.execute("SELECT * FROM iati_requests WHERE id=?", (request["id"],)).fetchone()
                if existing and dict(existing) != request:
                    raise InputError("Received request conflicts with a retained operation")
            for comparison in comparisons:
                if (not isinstance(comparison, dict) or comparison.get("schema") != COMPARE
                    or comparison.get("portfolio") != ident
                    or type(comparison.get("beforeRevision")) is not int
                    or type(comparison.get("afterRevision")) is not int
                    or not 1 <= comparison["beforeRevision"] < comparison["afterRevision"] <= last):
                    raise InputError("Received comparison has invalid portfolio revisions")
                base = {key: value for key, value in comparison.items() if key != "id"}
                if digest(json_bytes(base)) != comparison.get("id"):
                    raise InputError("Received comparison identity is invalid")
                supplied = [p for p in comparison["pairs"] if p["before"] != p["after"]]
                rebuilt = self._compare_revisions(history[comparison["beforeRevision"] - 1],
                                                  history[comparison["afterRevision"] - 1], supplied)
                if rebuilt != comparison:
                    raise InputError("Complete portfolio and native field comparison does not reconstruct")
            # Regenerate every report file from the receiving native datasets and
            # compare complete bytes, including every CSV row and issue record.
            actual_files = self._report_files(history[-1], temp / "reconstructed-report", comparisons)
            expected_names = {name[8:] for name in manifest["files"] if name.startswith("reports/")}
            if set(actual_files) != expected_names or any(
                {"bytes": p.stat().st_size, "sha256": file_digest(p, MAX_PACKET)} != manifest["files"]["reports/" + name]
                for name, p in actual_files.items()):
                raise InputError("Complete receiving report files differ from the packet")
            # Native sources/builds are immutable retryable preparation. Publish the
            # complete domain history in one original SQLite transaction.
            with self.db:
                for item in history:
                    self.db.execute("INSERT OR IGNORE INTO iati_portfolios VALUES(?,?,?)",
                                    (ident, item["revision"], json_bytes(item).decode()))
                for request in requests:
                    self.db.execute("INSERT OR IGNORE INTO iati_requests VALUES(?,?,?,?)",
                                    tuple(request[k] for k in ("id", "request_sha", "portfolio", "revision")))
                for comparison in comparisons:
                    self.db.execute("INSERT OR IGNORE INTO iati_portfolio_comparisons VALUES(?,?,?,?,?)",
                                    (comparison["id"], ident, comparison["beforeRevision"],
                                     comparison["afterRevision"], json_bytes(comparison).decode()))
            return {"portfolio": self.portfolio(ident, last), "reconstructed": True,
                    "historyCount": len(history), "datasetCount": len(builds),
                    "reportFiles": sorted(actual_files),
                    "receivingBuilds": [{"id": b, "engineBlob": self.build_view(b)["engineBlob"],
                        "indexSha256": self.build_view(b)["files"]["rows.sqlite"]["sha256"]} for b in sorted(builds)]}

    def import_packet(self, path):
        with zipfile.ZipFile(path) as archive:
            infos = [info for info in archive.infolist() if info.filename == "manifest.json"]
            if len(infos) != 1 or infos[0].file_size > MAX_METADATA:
                raise InputError("Packet needs one bounded manifest")
            manifest = load_json(archive.read(infos[0]))
        if isinstance(manifest, dict) and manifest.get("schema") == PACKET:
            return self.receive_portfolio(path)
        return super().import_packet(path)
