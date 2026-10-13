"""Open and export reports from original Workspace source entries.

The source catalogue reads retained metadata only. A preview resolves one member
through the original verified file transport; portable export checks every member
while streaming it into a new archive. Scientific inputs and source kinds stay
under the existing Workspace.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import tempfile
import threading
from urllib.parse import quote
import zipfile

from model.common import atomic_json, digest, file_digest, read_json
from source_report_editions import ScientificReportEditions


def member_name(value):
    if (not isinstance(value, str) or not value or "\\" in value
            or re.search(r"[\x00-\x1f\x7f]", value)):
        raise ValueError("Choose an original relative source member.")
    path = PurePosixPath(value)
    if (path.is_absolute() or path.as_posix() != value
            or any(part in ("", ".", "..") or ":" in part for part in value.split("/"))):
        raise ValueError("Source member paths must remain in their original edition.")
    return value


def entry_key(source_id):
    return hashlib.sha256(str(source_id).encode("utf-8")).hexdigest()


def inventory(entry):
    """Preserve Workspace view_path, including cross-date source companions."""
    result = {}
    for descriptor in [entry["body"], *entry.get("companions", [])]:
        name = member_name(descriptor.get("view_path") or descriptor.get("filename"))
        if (not isinstance(descriptor.get("bytes"), int) or isinstance(descriptor["bytes"], bool)
                or descriptor["bytes"] < 0
                or not re.fullmatch(r"[0-9a-f]{64}", descriptor.get("sha256", ""))):
            raise ValueError("Retained source member identity is incomplete.")
        if name in result and any(result[name][key] != descriptor[key] for key in ("bytes", "sha256")):
            raise ValueError("Two source members claim the same original view path.")
        result.setdefault(name, descriptor)
    names = set(result)
    for name in names:
        if any(parent.as_posix() in names for parent in PurePosixPath(name).parents
               if parent.as_posix() != "."):
            raise ValueError("A source member conflicts with a parent directory.")
    return result


def html_members(entry):
    primary = member_name(entry["body"].get("view_path") or entry["body"]["filename"])
    return [name for name in inventory(entry)
            if PurePosixPath(name).suffix.lower() in (".html", ".htm")
            and (name == primary or re.search(r"(^open[_-]|report|review|^index\.)",
                                              PurePosixPath(name).name, re.IGNORECASE))]


def document_policy(body):
    """Allow only original inline script bodies, inside an opaque-origin sandbox."""
    text = body.decode("utf-8-sig")
    scripts = re.findall(r"<script\b[^>]*>([\s\S]*?)</script\s*>", text, flags=re.IGNORECASE)
    hashes = sorted({
        "'sha256-" + base64.b64encode(hashlib.sha256(
            source.replace("\r\n", "\n").replace("\r", "\n").encode("utf-8")).digest()).decode("ascii") + "'"
        for source in scripts
    })
    return (
        "default-src 'none'; script-src " + (" ".join(hashes) or "'none'") + "; "
        "style-src 'self' 'unsafe-inline'; img-src 'self' data:; "
        "connect-src 'none'; object-src 'none'; frame-src 'none'; "
        "base-uri 'none'; form-action 'none'; frame-ancestors 'self'; "
        "sandbox allow-scripts allow-downloads allow-modals allow-popups allow-popups-to-escape-sandbox"
    )


# These are ordinary source manifests shipped with the installed application.
# Additional editions use the existing --source-manifest or --source-root options.
BUNDLED_REPORT_MANIFESTS = (
    "results/assessment-association-review-20261013/sources.json",
    "results/assessment-source-scope-review-20261013/sources.json",
    "results/assessment-association-review-20261013/observed-sources.json",
    "results/assessment-source-scope-review-20261013/observed-sources.json",
    "results/native-assessment-delivery-20261013/sources.json",
    "results/native-assessment-microbial-delivery-20261013/sources.json",
    "source/station-assessment-context/native159-source-context-20261013/sources-complete.json",
    "source/station-assessment-context/native159-source-context-20261013/sources-all-editions.json",
    "source/water_context/sources-20261013.json",
    "source/rl18151-lake-phosphorus-20261013/sources.json",
    "point_source_history.sources.json",
    "point_source_load_volume.sources.json",
    "point_source_scientific.sources.json",
)


def unique_report_entries(entries, *, retained=False):
    """Prefer the original document when a recipe retains its same HTML.

    Deduplication is confined to one source collection and uses the complete
    original source path plus bytes and SHA. All typed entries remain registered.
    """
    prepared = []
    for position, entry in enumerate(entries):
        if retained:
            members = inventory(entry)
            primary = member_name(entry["body"].get("view_path") or entry["body"]["filename"])
            names = html_members(entry)
        else:
            members = {member_name(row["path"]): row
                       for row in [entry, *entry.get("companions", [])]}
            primary = member_name(entry["path"])
            names = [name for name in members
                     if PurePosixPath(name).suffix.lower() in (".html", ".htm")
                     and (name == primary or re.search(
                         r"(^open[_-]|report|review|^index\.)",
                         PurePosixPath(name).name, re.IGNORECASE))]
        if not names:
            continue
        rank = (primary not in names, entry.get("role") == "OBSERVED_CONTEXT", position)
        prepared.append((rank, position, entry, names, members))
    selected, seen = [], set()
    for unused, position, entry, names, members in sorted(prepared, key=lambda row: row[0]):
        identities = {
            (members[name].get("source_path", name), members[name].get("bytes"),
             members[name].get("sha256"))
            for name in names
        }
        # Missing optional raw-manifest identity fields cannot establish sameness.
        bound = all(size is not None and sha is not None for unused_path, size, sha in identities)
        if bound and identities.issubset(seen):
            continue
        if bound:
            seen.update(identities)
        selected.append((position, entry, names))
    return [(entry, names) for unused, entry, names in sorted(selected, key=lambda row: row[0])]


def manifest_reports(value):
    """Describe each original preview once without reading source bodies."""
    return [{
        "source_id": row["id"], "title": row["title"],
        "kind": row["kind"], "role": row.get("role"),
        "vintage": row["vintage"], "documents": names,
    } for row, names in unique_report_entries(value["entries"])]


def manifest_readiness(path, value):
    """Check installed member metadata; Workspace import verifies original bytes."""
    root = path.parent.resolve()
    members, problems = {}, []
    for row in value["entries"]:
        for item in [row, *row.get("companions", [])]:
            name = member_name(item["path"])
            prior = members.setdefault(name, dict(item))
            for key in ("bytes", "sha256"):
                incoming = item.get(key)
                if incoming is None:
                    continue
                if prior.get(key) is not None and prior[key] != incoming:
                    problems.append({"member": name, "reason": "Conflicting declared source " + key})
                else:
                    prior[key] = incoming
    for name, item in members.items():
        try:
            target = (root / name).resolve(strict=True)
            if not target.is_relative_to(root) or not target.is_file():
                raise ValueError("Source member is outside its edition or is not a file")
            expected = item.get("bytes")
            if expected is not None and (
                    not isinstance(expected, int) or isinstance(expected, bool)
                    or expected < 0 or target.stat().st_size != expected):
                raise ValueError("Installed file size differs from its declared original")
        except (OSError, ValueError) as error:
            problems.append({"member": name, "reason": str(error)})
    return {"ready": not problems, "member_count": len(members), "problems": problems}



class SourceReports:
    def __init__(self, operator, fault, source_roots=()):
        self.operator, self.Fault = operator, fault
        self.scientific = ScientificReportEditions(operator, fault)
        self._archive_lock = threading.RLock()
        self._source_roots = tuple(source_roots)
        self._managed_registered_ids = set()
        self._available_editions = []
        self._discovery_issues = []
        self.refresh_registered()

    def _manifest_candidates(self, registered):
        """Use selected directories only; never traverse a scientific Workspace."""
        candidates, seen = [], set()

        def add(path, origin, *, required=False):
            path = Path(path).expanduser()
            try:
                resolved = path.resolve(strict=required)
            except OSError as error:
                self._discovery_issues.append({"manifest": path.name, "reason": str(error)})
                return
            if resolved in seen or (not required and not resolved.is_file()):
                return
            seen.add(resolved)
            candidates.append((resolved, origin))

        for row in registered.values():
            add(row["path"], "Registered source", required=True)
        application = Path(__file__).resolve().parents[1]
        for relative in BUNDLED_REPORT_MANIFESTS:
            add(application / relative, "Included with this application")
        for root_value in self._source_roots:
            root = Path(root_value).expanduser()
            if root.is_file():
                add(root, "Configured source")
                continue
            if not root.is_dir():
                self._discovery_issues.append({
                    "manifest": root.name, "reason": "Configured source directory is unavailable"
                })
                continue
            for relative in BUNDLED_REPORT_MANIFESTS:
                add(root / relative, "Configured source")
            # Accept manifest files directly inside the explicitly selected edition.
            # No recursive search or source-body read is needed.
            for pattern in ("sources*.json", "*.sources.json", "*-sources.json", "source-manifest.json"):
                for path in sorted(root.glob(pattern)):
                    add(path, "Configured source")
        return candidates

    def refresh_registered(self):
        """Populate the original operator registry, keeping explicit registrations first."""
        with self._archive_lock, self.operator.lock:
            current = self.operator.registered
            registered = {key: row for key, row in current.items()
                          if key not in self._managed_registered_ids}
            explicit_by_path = {str(Path(row["path"]).resolve()): row
                                for row in registered.values()}
            managed, available = set(), []
            self._discovery_issues = []
            for path, origin in self._manifest_candidates(registered):
                try:
                    raw = path.read_bytes()
                    value = json.loads(raw)
                    if not isinstance(value, dict) or value.get("schema") != "upstate.sources/v1":
                        continue
                    summary = self.operator._manifest_summary(value)
                    report_rows = manifest_reports(value)
                    regional = any(row.get("role") == "SOURCE_WATER_CONTEXT"
                                   for row in value["entries"])
                    if not report_rows and not regional:
                        continue
                    sha = hashlib.sha256(raw).hexdigest()
                    ready = manifest_readiness(path, value)
                    explicit = explicit_by_path.get(str(path))
                    if explicit is not None:
                        key = explicit["id"]
                        if explicit["sha256"] != sha:
                            ready["ready"] = False
                            ready["problems"].append({
                                "member": path.name,
                                "reason": "Registered manifest changed; restart with its new edition"
                            })
                    else:
                        key = digest({"path": str(path), "sha256": sha})
                        if ready["ready"]:
                            existing = registered.get(key)
                            record = {
                                "id": key, "path": str(path), "sha256": sha,
                                "title": summary["title"], "entries": len(value["entries"])
                            }
                            if existing is not None and any(existing.get(field) != record[field]
                                    for field in ("id", "path", "sha256")):
                                raise ValueError("Registered source ID has a different identity")
                            registered.setdefault(key, record)
                            managed.add(key)
                    available.append({
                        "registered_id": key if ready["ready"] else None,
                        "manifest_sha256": sha, "manifest_name": path.name,
                        "title": summary["title"], "origin": origin,
                        "entry_count": len(value["entries"]), "reports": report_rows,
                        "source_ids": [row["id"] for row in value["entries"]],
                        "regional_context": regional,
                        "vintages": list(dict.fromkeys(str(row["vintage"]) for row in value["entries"])),
                        **ready,
                    })
                except (OSError, ValueError, TypeError, KeyError, self.Fault) as error:
                    self._discovery_issues.append({"manifest": path.name, "reason": str(error)})
            # Replace the dictionary atomically, retaining the original explicit order.
            self.operator.registered = registered
            self._managed_registered_ids = managed
            self._available_editions = available


    def _entry(self, workspace, collection_id, selected_key):
        if not re.fullmatch(r"[0-9a-f]{64}", str(collection_id or "")):
            raise self.Fault("SOURCE_REPORT_EDITION", "Choose a retained source edition.")
        if not re.fullmatch(r"[0-9a-f]{64}", str(selected_key or "")):
            raise self.Fault("SOURCE_REPORT_ENTRY", "Choose a retained report source.")
        collection = self.operator.ws(workspace).retained_item("sources", collection_id)
        matches = [row for row in collection["entries"] if entry_key(row["id"]) == selected_key]
        if len(matches) != 1 or not html_members(matches[0]):
            raise self.Fault("SOURCE_REPORT_ENTRY", "This source entry has no retained HTML report.", 404)
        return collection, matches[0], inventory(matches[0])

    @staticmethod
    def _url(workspace, collection, key, name):
        identifiers = [workspace, collection, key]
        return "/api/file/source-reports/" + "/".join(quote(str(x), safe="") for x in identifiers) + "/" + quote(name, safe="/")

    def _row(self, workspace, collection, entry):
        members = inventory(entry)
        html = html_members(entry)
        key = entry_key(entry["id"])
        metadata = entry.get("metadata") if isinstance(entry.get("metadata"), dict) else {}
        related = entry.get("related_source_ids") or metadata.get("related_source_ids", [])
        return {
            "collection_id": collection["id"], "entry_key": key, "source_id": entry["id"],
            "collection_title": collection.get("title") or collection.get("scope") or collection["id"],
            "title": entry["title"], "kind": entry["kind"], "role": entry.get("role"),
            "uri": entry["uri"], "vintage": entry["vintage"],
            "captured_at": collection.get("captured_at"), "description": entry.get("description", ""),
            "body_sha256": entry["body"]["sha256"], "member_count": len(members),
            "html": [{"path": name, "bytes": members[name]["bytes"], "sha256": members[name]["sha256"],
                      "url": self._url(workspace, collection["id"], key, name)} for name in html],
            "scientific_reports": [
                {"source_collection_id": collection["id"], "source_id": candidate["id"],
                 "title": candidate["title"], "vintage": candidate["vintage"]}
                for candidate in collection.get("entries", [])
                if candidate.get("role") == "OBSERVED_CONTEXT"
                and isinstance(candidate.get("metadata"), dict)
                and isinstance(candidate["metadata"].get("related_source_ids"), list)
                and entry["id"] in candidate["metadata"]["related_source_ids"]
            ],
            "related_source_ids": related if isinstance(related, list) else [],
            "source_relationships": metadata.get("source_relationships", []),
        }

    def catalog(self, workspace, *, refresh=False):
        if refresh:
            self.refresh_registered()
        reports = []
        collections = self.operator.ws(workspace).sources()
        for collection in collections:
            for entry, unused in unique_report_entries(collection.get("entries", []), retained=True):
                reports.append(self._row(workspace, collection, entry))
        editions = []
        for original in self._available_editions:
            retained = [row for row in collections
                        if row.get("original_manifest", {}).get("sha256")
                        == original["manifest_sha256"]]
            retained_ids = {row["id"] for row in retained}
            editions.append({
                **original,
                "retained_collections": [{"id": row["id"], "title": row.get("title", row["id"])}
                                         for row in retained],
                "retained_reports": [
                    {"collection_id": row["collection_id"], "entry_key": row["entry_key"],
                     "title": row["title"], "source_id": row["source_id"]}
                    for row in reports if row["collection_id"] in retained_ids
                ],
            })
        return {"workspace_key": workspace, "reports": reports,
                "available_editions": editions, "discovery_issues": self._discovery_issues}

    def detail(self, workspace, payload):
        collection, entry, members = self._entry(
            workspace, payload.get("collection_id"), payload.get("entry_key"))
        row = self._row(workspace, collection, entry)
        row["members"] = [{
            "path": name, "bytes": body["bytes"], "sha256": body["sha256"],
            "primary": body is entry["body"],
            "url": self._url(workspace, collection["id"], row["entry_key"], name),
        } for name, body in members.items()]
        row["original_manifest"] = self.operator._ticket(
            workspace, self.operator.ws(workspace).root / collection["original_manifest"]["object"],
            collection["original_manifest"], "Original source edition manifest")
        row["related_sources"] = [
            {"id": other["id"], "title": other["title"], "kind": other["kind"], "role": other.get("role")}
            for other in collection["entries"] if other["id"] in row["related_source_ids"]
        ]
        return {"workspace_key": workspace, "report": row}

    def _path(self, workspace, descriptor):
        root = self.operator.ws(workspace).root.resolve()
        path = (root / member_name(descriptor["object"])).resolve(strict=True)
        if not path.is_relative_to(root) or not path.is_file():
            raise self.Fault("SOURCE_REPORT_FILE", "The original retained member is absent.", 404)
        return path

    def member(self, workspace, collection_id, selected_key, name):
        _, _, members = self._entry(workspace, collection_id, selected_key)
        name = member_name(name)
        if name not in members:
            raise self.Fault("SOURCE_REPORT_MEMBER", "Choose a file retained with this report.", 404)
        descriptor = members[name]
        path = self._path(workspace, descriptor)
        policy = None
        if PurePosixPath(name).suffix.lower() in (".html", ".htm"):
            body = path.read_bytes()
            if len(body) != descriptor["bytes"] or hashlib.sha256(body).hexdigest() != descriptor["sha256"]:
                raise self.Fault("SOURCE_REPORT_CHANGED", "The retained report bytes changed.", 409)
            policy = document_policy(body)
        ticket = self.operator._ticket(workspace, path, descriptor, name)
        return ticket, policy

    def archive(self, workspace, payload):
        collection, entry, members = self._entry(
            workspace, payload.get("collection_id"), payload.get("entry_key"))
        ws = self.operator.ws(workspace)
        original = collection["original_manifest"]
        manifest_path = self._path(workspace, original)
        original_body = manifest_path.read_bytes()
        if len(original_body) != original["bytes"] or hashlib.sha256(original_body).hexdigest() != original["sha256"]:
            raise self.Fault("SOURCE_REPORT_CHANGED", "The original source manifest changed.", 409)
        original_manifest = json.loads(original_body)
        selected = [row for row in original_manifest["entries"] if row["id"] == entry["id"]]
        if len(selected) != 1:
            raise self.Fault("SOURCE_REPORT_MANIFEST", "The original manifest does not identify this report.", 409)
        # Export the complete original collection, so related scientific source
        # IDs remain registered after reimport. Restore source_path here; member
        # preview uses each entry's independently normalized view_path instead.
        archive_members = {}
        retained_entries = {row["id"]: row for row in collection["entries"]}
        if set(retained_entries) != {row["id"] for row in original_manifest["entries"]}:
            raise self.Fault("SOURCE_REPORT_MANIFEST", "The retained source edition differs from its original manifest.", 409)
        for original_entry in original_manifest["entries"]:
            retained_entry = retained_entries[original_entry["id"]]
            declared = [original_entry, *original_entry.get("companions", [])]
            retained = [retained_entry["body"], *retained_entry.get("companions", [])]
            if len(declared) != len(retained):
                raise self.Fault("SOURCE_REPORT_MANIFEST", "The original companion inventory changed.", 409)
            for original_row, descriptor in zip(declared, retained):
                name = member_name(original_row["path"])
                if descriptor.get("source_path", name) != name:
                    raise self.Fault("SOURCE_REPORT_MANIFEST", "The retained source path differs from its original manifest.", 409)
                for key in ("bytes", "sha256"):
                    if key in original_row and original_row[key] != descriptor[key]:
                        raise self.Fault("SOURCE_REPORT_MANIFEST", "The original manifest identity differs: " + name, 409)
                if name in archive_members and any(archive_members[name][key] != descriptor[key] for key in ("bytes", "sha256")):
                    raise self.Fault("SOURCE_REPORT_MANIFEST", "Source entries conflict at an original path: " + name, 409)
                archive_members.setdefault(name, descriptor)
        for name in archive_members:
            if any(parent.as_posix() in archive_members for parent in PurePosixPath(name).parents
                   if parent.as_posix() != "."):
                raise self.Fault("SOURCE_REPORT_MANIFEST", "A source member conflicts with its parent directory.")
        occupied = {name.split("/", 1)[0].casefold() for name in archive_members}
        manifest_name = "sources.json"
        if manifest_name.casefold() in occupied:
            manifest_name = "report-sources-" + original["sha256"][:16] + ".json"
            while manifest_name.casefold() in occupied:
                manifest_name = "report-" + manifest_name
        # The manifest itself remains byte-exact; its original relative paths
        # resolve beside this top-level filename without adding another wrapper.
        manifest_body = original_body
        selection = {
            "collection_id": collection["id"],
            "original_manifest_sha256": original["sha256"],
            "manifest_member": manifest_name,
            "members": [{"path": name, "bytes": row["bytes"], "sha256": row["sha256"]}
                        for name, row in sorted(archive_members.items())],
        }
        identity = digest(selection)
        folder = self.operator.root / "outputs" / "source-reports"
        folder.mkdir(parents=True, exist_ok=True, mode=0o700)
        destination, metadata = folder / (identity + ".zip"), folder / (identity + ".json")
        with self._archive_lock:
            if not destination.exists() or not metadata.exists():
                fd, temporary_name = tempfile.mkstemp(prefix=identity + ".", suffix=".zip", dir=folder)
                os.close(fd)
                temporary = Path(temporary_name)
                try:
                    with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED,
                                         compresslevel=6, allowZip64=True) as archive:
                        for name, descriptor in archive_members.items():
                            path = self._path(workspace, descriptor)
                            info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
                            info.compress_type = zipfile.ZIP_DEFLATED
                            info.external_attr = 0o100600 << 16
                            info.file_size = descriptor["bytes"]
                            sha, count = hashlib.sha256(), 0
                            with path.open("rb") as source, archive.open(info, "w", force_zip64=descriptor["bytes"] >= zipfile.ZIP64_LIMIT) as output:
                                while block := source.read(1024 * 1024):
                                    sha.update(block)
                                    count += len(block)
                                    output.write(block)
                            if count != descriptor["bytes"] or sha.hexdigest() != descriptor["sha256"]:
                                raise self.Fault("SOURCE_REPORT_CHANGED", "A retained report companion changed: " + name, 409)
                        for name, body in ((manifest_name, manifest_body),):
                            info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
                            info.compress_type = zipfile.ZIP_DEFLATED
                            info.external_attr = 0o100600 << 16
                            archive.writestr(info, body)
                    record = {"selection": selection, "manifest_member": manifest_name,
                              "bytes": temporary.stat().st_size, "sha256": file_digest(temporary),
                              "filename": "retained-report-" + identity[:16] + ".zip"}
                    os.replace(temporary, destination)
                    atomic_json(metadata, record)
                finally:
                    temporary.unlink(missing_ok=True)
            record = read_json(metadata)
            if record.get("selection") != selection:
                raise self.Fault("SOURCE_REPORT_ARCHIVE", "The retained portable report selection changed.", 409)
        return {"workspace_key": workspace, "source_id": entry["id"],
                "manifest_member": record["manifest_member"],
                "download": self.operator._ticket(workspace, destination, record, "Report and complete original source edition")}

    def read(self, workspace, operation, payload):
        if operation.startswith("scientific-"):
            return self.scientific.read(workspace, operation, payload)
        if operation == "catalog":
            return self.catalog(workspace, refresh=str(payload.get("refresh", "")).lower() in {"1", "true"})
        if operation == "detail":
            return self.detail(workspace, payload)
        if operation == "archive":
            return self.archive(workspace, payload)
        raise self.Fault("SOURCE_REPORT_OPERATION", "Choose an original source report operation.", 404)

    def invoke(self, task):
        return self.scientific.invoke(task)

    def state(self, workspace):
        return self.scientific.state(workspace)

    def verify_workspace(self, workspace):
        return self.scientific.verify_workspace(workspace)

    def decorate_task(self, task):
        return self.scientific.decorate_task(task)

    def scientific_member(self, workspace, key, name):
        ticket, path = self.scientific.member(workspace, key, name)
        policy = document_policy(path.read_bytes()) if path.suffix.lower() in (".html", ".htm") else None
        return ticket, policy

    def briefing_member(self, workspace, key, name):
        ticket, path = self.scientific.briefing_member(workspace, key, name)
        policy = document_policy(path.read_bytes()) if path.suffix.lower() in (".html", ".htm") else None
        return ticket, policy
