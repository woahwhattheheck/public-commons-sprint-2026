"""Public native implementation API and durable per-plan storage."""
from __future__ import annotations

import copy
import datetime as dt
import hashlib
import os
from pathlib import Path
import re
import shutil
import tempfile
from contextlib import contextmanager

from .implementation_schema import (
    SCHEMA, REVISION_SCHEMA, SAFE_INTEGER, MAX_JSON_BYTES, ID_RE, REVISION_RE,
    COLLECTIONS, ImplementationError, ValidationError, RevisionConflict, utc_now,
    load_json, read_document, canonical_bytes, document_digest, json_text,
    make_plan, validate_plan, ProjectCalendar, schedule_plan, summarize_plan,
    _safe_id, _integer, _timestamp,
)
from .implementation_reporting import render_report_html, report_csv


def _source_references(row):
    """Exact maintained file/source associations, without interpreting arbitrary text."""
    if not isinstance(row, dict):
        return set()
    refs = []
    for key in ("source_link_id", "audit_source_link_id", "source_ref", "custody_ref"):
        if isinstance(row.get(key), str):
            refs.append(row[key])
    for key in ("evidence_refs", "source_link_ids"):
        if isinstance(row.get(key), list):
            refs.extend(row[key])
    for key in ("original_source", "lab_source"):
        source = row.get(key)
        if isinstance(source, dict):
            for field in ("source_link_id", "audit_source_link_id", "source_ref"):
                if isinstance(source.get(field), str):
                    refs.append(source[field])
    response = row.get("form_response")
    if isinstance(response, dict):
        template, answers = response.get("template", {}), response.get("answers", {})
        fields = template.get("fields", []) if isinstance(template, dict) else []
        if isinstance(fields, list) and isinstance(answers, dict):
            for field in fields:
                if not isinstance(field, dict):
                    continue
                answer = answers.get(field.get("key"))
                if field.get("type") == "attachment_ref" and isinstance(answer, str):
                    refs.append(answer)
                elif field.get("type") == "attachment_refs":
                    if isinstance(answer, list):
                        refs.extend(answer)
                    elif isinstance(answer, dict) and isinstance(answer.get("references"), list):
                        refs.extend(answer["references"])
    return {ref for ref in refs if isinstance(ref, str)}


def _same_json(left, right) -> bool:
    """JSON value equality: equal int/float values, distinct booleans."""
    if isinstance(left, bool) or isinstance(right, bool):
        return type(left) is type(right) and left == right
    if isinstance(left, (int, float)) and isinstance(right, (int, float)):
        return left == right
    if type(left) is not type(right):
        return False
    if isinstance(left, dict):
        return (left.keys() == right.keys()
                and all(_same_json(left[key], right[key]) for key in left))
    if isinstance(left, list):
        return (len(left) == len(right)
                and all(_same_json(a, b) for a, b in zip(left, right)))
    return left == right


def _fsync_directory(directory: Path) -> None:
    if os.name != "nt":
        descriptor = os.open(directory, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)


def _atomic_bytes(path: Path, content: bytes, *, replace: bool = False) -> Path:
    """Publish fully flushed bytes, using an exclusive link unless replace is requested."""
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_symlink():
        raise ImplementationError(f"Refusing to write through symlink: {path}")
    descriptor, temporary_name = tempfile.mkstemp(prefix=".pending-", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        if replace:
            os.replace(temporary, path)
        else:
            # Same-filesystem hard link is atomic and cannot overwrite a concurrent create.
            os.link(temporary, path)
            temporary.unlink()
        _fsync_directory(path.parent)
        return path
    finally:
        if temporary.exists():
            temporary.unlink()


def _safe_output(path: str | Path, content: str, overwrite: bool) -> str:
    path = Path(path).expanduser().absolute()
    try:
        _atomic_bytes(path, content.encode("utf-8"), replace=overwrite)
    except FileExistsError as exc:
        raise ImplementationError(
            f"Output already exists: {path}. Choose another path or explicitly enable overwrite."
        ) from exc
    return str(path)


@contextmanager
def _file_lock(lock_path, *, blocking=True):
    """Use the same advisory lock for native writes and portable capture."""
    lock_path = Path(lock_path)
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    if lock_path.is_symlink():
        raise ImplementationError("Plan lock path must not be a symlink.")
    flags = os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(lock_path, flags, 0o600)
    handle = os.fdopen(descriptor, "r+b", buffering=0)
    try:
        if os.name == "nt":
            import msvcrt
            if os.fstat(descriptor).st_size == 0:
                handle.write(b"\0")
                handle.flush()
            handle.seek(0)
            msvcrt.locking(descriptor, msvcrt.LK_LOCK if blocking else msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(descriptor, fcntl.LOCK_EX | (0 if blocking else fcntl.LOCK_NB))
        try:
            yield
        finally:
            if os.name == "nt":
                handle.seek(0)
                msvcrt.locking(descriptor, msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(descriptor, fcntl.LOCK_UN)
    finally:
        handle.close()


class ImplementationStore:
    """A process-safe local store. OS advisory locks release automatically on exit.

    Each immutable revisions/<revision>.json atomically commits both the whole
    document and its event. The highest committed revision is authoritative;
    there is no mutable HEAD file that can lag behind its history.
    """
    def __init__(self, workspace_or_path):
        # pathlib paths also expose .root ("/" or a drive), not a Workspace directory.
        root = (workspace_or_path if isinstance(workspace_or_path, (str, os.PathLike))
                else getattr(workspace_or_path, "root", workspace_or_path))
        self.root = Path(root).expanduser().resolve()
        self.base = self.root / "implementation" / "plans"
        self.base.mkdir(parents=True, exist_ok=True)
        if self.base.resolve() != self.base:
            raise ImplementationError("Implementation storage must not traverse a symlink.")
        _fsync_directory(self.base.parent)

    def _directory(self, plan_id: str, *, create: bool = False) -> Path:
        _safe_id(plan_id, "plan_id")
        directory = self.base / plan_id
        if directory.is_symlink():
            raise ImplementationError(f"Plan directory is a symlink: {directory}")
        if create:
            # Backup holds this bank lock before enumerating per-plan locks.
            # Release it before waiting for the selected plan's own lock.
            with _file_lock(self.base.parent / ".plans.lock"):
                directory.mkdir(exist_ok=True)
                _fsync_directory(self.base)
        if not directory.is_dir():
            raise ImplementationError(f"Plan does not exist: {plan_id}")
        return directory

    @contextmanager
    def _locked(self, plan_id: str, *, create: bool = False):
        directory = self._directory(plan_id, create=create)
        with _file_lock(directory / ".lock"):
            yield directory

    def _revision_paths(self, directory: Path) -> list[Path]:
        revisions = directory / "revisions"
        if revisions.is_symlink():
            raise ImplementationError("Revision directory must not be a symlink.")
        if not revisions.exists():
            return []
        return sorted(
            (entry for entry in revisions.iterdir() if REVISION_RE.fullmatch(entry.name)),
            key=lambda entry: int(entry.stem),
        )

    def _read_record(self, path: Path) -> dict:
        if path.is_symlink() or not path.is_file():
            raise ImplementationError(f"Revision is not a regular file: {path}")
        with path.open("rb") as handle:
            record = load_json(
                handle.read(MAX_JSON_BYTES + 65537),
                max_bytes=MAX_JSON_BYTES + 65536,
            )
        if record.get("schema") != REVISION_SCHEMA:
            raise ImplementationError(f"Unrecognized revision record: {path}")
        plan = validate_plan(record.get("plan"))
        event = record.get("event")
        if not isinstance(event, dict):
            raise ImplementationError(f"Revision event is missing: {path}")
        if (str(plan["revision"]).zfill(16) != path.stem or
                plan["id"] != path.parent.parent.name or
                event.get("document_digest") != document_digest(plan) or
                event.get("revision") != plan["revision"]):
            raise ImplementationError(f"Revision integrity mismatch: {path}")
        return record

    def _current_record(self, directory: Path) -> dict | None:
        paths = self._revision_paths(directory)
        return self._read_record(paths[-1]) if paths else None

    def _touch(self, plan: dict) -> None:
        now = dt.datetime.now(dt.timezone.utc)
        latest = max(now, _timestamp(plan["created_at"]), _timestamp(plan["updated_at"]))
        plan["updated_at"] = latest.isoformat(timespec="microseconds").replace("+00:00", "Z")

    def _check_frozen_sources(self, previous: dict, incoming: dict) -> None:
        protected = {
            "candidates": ("source", "modeled_benefits", "area_ha"),
            "source_links": ("kind", "reference", "snapshot", "source_digest",
                             "source_id", "source_schema", "field_mapping",
                             "sha256", "size_bytes"),
        }
        fresh = {}
        for collection, fields in protected.items():
            old_rows = {row["id"]: row for row in previous[collection]}
            new_rows = {row["id"]: row for row in incoming[collection]}
            for row_id in old_rows.keys() & new_rows.keys():
                if any(not _same_json(new_rows[row_id].get(key), old_rows[row_id].get(key)) for key in fields):
                    raise ImplementationError(
                        f"{collection} ID {row_id!r} has a frozen source snapshot or binding. "
                        "Use a new ID for a new source selection."
                    )
            fresh[collection] = {
                row_id: row for row_id, row in new_rows.items() if row_id not in old_rows
            }
        # A deleted ID cannot later be recycled for a different original snapshot.
        if any(fresh.values()):
            for path in self._revision_paths(self._directory(previous["id"])):
                historic = self._read_record(path)["plan"]
                for collection, fields in protected.items():
                    for old in historic[collection]:
                        proposed = fresh[collection].get(old["id"])
                        if proposed is not None and any(
                                not _same_json(proposed.get(key), old.get(key)) for key in fields):
                            raise ImplementationError(
                                f"{collection} ID {old['id']!r} already names a historical source. "
                                "Use a new ID for the new source selection."
                            )
        removed_sources = ({row["id"] for row in previous["source_links"]} -
                           {row["id"] for row in incoming["source_links"]})
        if removed_sources:
            collections = [(name, incoming[name]) for name in COLLECTIONS]
            for name in ("field12_lab_imports", "field12_site_visit_imports"):
                collections.append((name, incoming.get(name, [])))
            for collection, rows in collections:
                if not isinstance(rows, list):
                    continue
                for index, row in enumerate(rows):
                    dangling = sorted(_source_references(row) & removed_sources)
                    if dangling:
                        row_id = row.get("id", str(index)) if isinstance(row, dict) else str(index)
                        raise ImplementationError(
                            f"{collection} ID {row_id!r} still refers to removed source links: " +
                            ", ".join(dangling) + ". Remove those associations before deleting the source."
                        )
        if incoming["created_at"] != previous["created_at"]:
            raise ImplementationError("created_at is immutable for an existing plan.")

    def _commit(self, directory: Path, document: dict, *, previous: dict | None,
                revision: int, operation: str, actor: str = "",
                source_document_digest: str | None = None,
                source_revision: int | None = None,
                preserve_timestamp: bool = False) -> dict:
        if not _integer(revision, 1):
            raise ImplementationError("Revision number is outside the safe integer range.")
        if not isinstance(actor, str) or len(actor) > 1024:
            raise ImplementationError("actor must be a string of at most 1024 characters.")
        plan = copy.deepcopy(document)
        plan["revision"] = revision
        if not preserve_timestamp:
            self._touch(plan)
        plan = validate_plan(plan)
        event = dict(
            revision=revision, previous_revision=previous["revision"] if previous else 0,
            operation=operation, actor=actor, committed_at=utc_now(),
            document_digest=document_digest(plan),
            previous_document_digest=document_digest(previous) if previous else None,
        )
        if source_document_digest is not None:
            event["source_document_digest"] = source_document_digest
            event["source_revision"] = source_revision
        record = dict(schema=REVISION_SCHEMA, event=event, plan=plan)
        revisions = directory / "revisions"
        if revisions.is_symlink():
            raise ImplementationError("Revision directory must not be a symlink.")
        revisions.mkdir(exist_ok=True)
        _fsync_directory(directory)
        path = revisions / f"{revision:016d}.json"
        try:
            _atomic_bytes(path, canonical_bytes(record))
        except FileExistsError as exc:
            current = self._current_record(directory)
            raise RevisionConflict(
                plan["id"], event["previous_revision"],
                current["plan"]["revision"] if current else 0,
            ) from exc
        return plan

    def get(self, plan_id: str, revision: int | None = None) -> dict:
        directory = self._directory(plan_id)
        if revision is None:
            record = self._current_record(directory)
            if record is None:
                raise ImplementationError(f"Plan has no committed revision: {plan_id}")
        else:
            if not _integer(revision, 1):
                raise ImplementationError("revision must be a positive safe integer.")
            path = directory / "revisions" / f"{revision:016d}.json"
            if not path.exists():
                raise ImplementationError(f"Revision {revision} does not exist for {plan_id}.")
            record = self._read_record(path)
        return record["plan"]

    def list_plans(self) -> list[dict]:
        result = []
        for entry in sorted(self.base.iterdir(), key=lambda item: item.name.lower()):
            if not entry.is_dir() or not ID_RE.fullmatch(entry.name):
                continue
            record = self._current_record(self._directory(entry.name))
            if record:
                plan = record["plan"]
                result.append({
                    key: plan[key] for key in
                    ("id", "revision", "title", "start_date", "created_at", "updated_at")
                })
        return result

    def create(self, document: dict, actor: str = "") -> dict:
        plan = validate_plan(document)
        with self._locked(plan["id"], create=True) as directory:
            current = self._current_record(directory)
            if current:
                raise RevisionConflict(plan["id"], 0, current["plan"]["revision"])
            return self._commit(
                directory, plan, previous=None, revision=1, operation="create", actor=actor,
            )

    def save(self, document: dict, expected_revision: int, actor: str = "") -> dict:
        plan = validate_plan(document)
        if not _integer(expected_revision, 1):
            raise ImplementationError("expected_revision must be a positive safe integer.")
        if plan["revision"] != expected_revision:
            raise ImplementationError("Document revision must equal expected_revision.")
        with self._locked(plan["id"]) as directory:
            record = self._current_record(directory)
            if not record:
                raise ImplementationError(f"Plan has no committed revision: {plan['id']}")
            current = record["plan"]
            if current["revision"] != expected_revision:
                raise RevisionConflict(plan["id"], expected_revision, current["revision"])
            self._check_frozen_sources(current, plan)
            if document_digest(plan) == document_digest(current):
                return current
            return self._commit(
                directory, plan, previous=current, revision=current["revision"] + 1,
                operation="save", actor=actor,
            )

    def _preserve_conflict(self, directory: Path, incoming: dict, *,
                           current: dict, actor: str, reason: str) -> str:
        digest = document_digest(incoming)
        conflicts = directory / "conflicts"
        if conflicts.is_symlink():
            raise ImplementationError("Conflict directory must not be a symlink.")
        conflicts.mkdir(exist_ok=True)
        path = conflicts / f"{digest}-r{incoming['revision']}.json"
        value = dict(
            schema="upstate.implementation-conflict/v1",
            incoming=incoming, source_document_digest=digest,
            source_revision=incoming["revision"],
            current_revision=current["revision"],
            current_document_digest=document_digest(current),
            received_at=utc_now(), actor=actor, reason=reason,
        )
        try:
            _atomic_bytes(path, canonical_bytes(value))
        except FileExistsError:
            # The digest/revision key makes this the same incoming document.
            with path.open("rb") as handle:
                previous = load_json(handle.read(MAX_JSON_BYTES + 65537),
                                     max_bytes=MAX_JSON_BYTES + 65536)
            if (previous.get("source_document_digest") != digest or
                    previous.get("incoming") != incoming):
                raise ImplementationError(f"Conflict file integrity mismatch: {path}")
        return str(path)

    def import_document(self, document: dict, expected_revision: int | None = None,
                        actor: str = "") -> dict:
        incoming = validate_plan(document)
        if expected_revision is not None and not _integer(expected_revision):
            raise ImplementationError("expected_revision must be a nonnegative safe integer.")
        digest = document_digest(incoming)
        with self._locked(incoming["id"], create=True) as directory:
            record = self._current_record(directory)
            current = record["plan"] if record else None
            if current is None:
                if expected_revision not in (None, 0):
                    raise RevisionConflict(incoming["id"], expected_revision, 0)
                plan = self._commit(
                    directory, incoming, previous=None,
                    revision=max(1, incoming["revision"]), operation="import",
                    actor=actor, source_document_digest=digest,
                    source_revision=incoming["revision"], preserve_timestamp=True,
                )
                return dict(status="created", plan=plan,
                            source_document_digest=digest,
                            source_revision=incoming["revision"],
                            applied_revision=plan["revision"])
            if digest == document_digest(current):
                return dict(status="unchanged", plan=current,
                            source_document_digest=digest,
                            source_revision=incoming["revision"],
                            applied_revision=current["revision"])
            for path in self._revision_paths(directory):
                event = self._read_record(path)["event"]
                if (event.get("source_document_digest") == digest and
                        event.get("source_revision") == incoming["revision"]):
                    return dict(status="duplicate", plan=current,
                                source_document_digest=digest,
                                source_revision=incoming["revision"],
                                applied_revision=event["revision"])
            stale = incoming["revision"] != current["revision"]
            explicit_mismatch = (expected_revision is not None and
                                 expected_revision != current["revision"])
            if stale or explicit_mismatch:
                conflict_ref = self._preserve_conflict(
                    directory, incoming, current=current, actor=actor,
                    reason="Incoming document was edited from a different base revision.",
                )
                raise RevisionConflict(incoming["id"],
                                       expected_revision if explicit_mismatch else incoming["revision"],
                                       current["revision"], conflict_ref)
            try:
                self._check_frozen_sources(current, incoming)
            except ImplementationError as exc:
                conflict_ref = self._preserve_conflict(
                    directory, incoming, current=current, actor=actor, reason=str(exc),
                )
                raise ImplementationError(str(exc) + f" Incoming content preserved at {conflict_ref}.") from exc
            plan = self._commit(
                directory, incoming, previous=current, revision=current["revision"] + 1,
                operation="import", actor=actor, source_document_digest=digest,
                source_revision=incoming["revision"],
            )
            return dict(status="imported", plan=plan, source_document_digest=digest,
                        source_revision=incoming["revision"], applied_revision=plan["revision"])

    def history(self, plan_id: str) -> list[dict]:
        directory = self._directory(plan_id)
        history = []
        previous_revision, previous_digest = 0, None
        for path in self._revision_paths(directory):
            record = self._read_record(path)
            event = record["event"]
            if (event.get("previous_revision") != previous_revision or
                    event.get("previous_document_digest") != previous_digest):
                raise ImplementationError(f"Broken revision chain at {path}")
            history.append(dict(event, revision_ref=str(path)))
            previous_revision = event["revision"]
            previous_digest = event["document_digest"]
        return history

    def add_records(self, plan_id: str, collection: str, records: list[dict],
                    expected_revision: int, actor: str = "") -> dict:
        """Append new original IDs; an identical existing record is idempotent."""
        if collection not in COLLECTIONS:
            raise ImplementationError(f"Unknown record collection: {collection}")
        if not isinstance(records, list) or any(not isinstance(row, dict) for row in records):
            raise ImplementationError("records must be an array of objects.")
        plan = self.get(plan_id)
        if plan["revision"] != expected_revision:
            raise RevisionConflict(plan_id, expected_revision, plan["revision"])
        index = {row["id"]: row for row in plan[collection]}
        for row in records:
            _safe_id(row.get("id"))
            old = index.get(row["id"])
            if old is not None and not _same_json(old, row):
                raise ImplementationError(
                    f"{collection} ID {row['id']!r} already exists with different content. "
                    "Edit the current exported plan and import it with its current revision."
                )
            if old is None:
                plan[collection].append(copy.deepcopy(row))
                index[row["id"]] = row
        return self.save(plan, expected_revision, actor)

    def attach_file(self, plan_id: str, path: str | Path, expected_revision: int,
                    actor: str = "", label: str = "") -> dict:
        source = Path(path).expanduser().resolve(strict=True)
        if not source.is_file():
            raise ImplementationError(f"Attachment is not a file: {source}")
        if not isinstance(label, str):
            raise ImplementationError("Attachment label must be a string.")
        with self._locked(plan_id) as directory:
            record = self._current_record(directory)
            if not record:
                raise ImplementationError(f"Plan has no committed revision: {plan_id}")
            current = record["plan"]
            if current["revision"] != expected_revision:
                raise RevisionConflict(plan_id, expected_revision, current["revision"])
            attachments = directory / "attachments"
            if attachments.is_symlink():
                raise ImplementationError("Attachment directory must not be a symlink.")
            attachments.mkdir(exist_ok=True)
            descriptor, temporary_name = tempfile.mkstemp(prefix=".pending-", dir=attachments)
            temporary = Path(temporary_name)
            digest = hashlib.sha256()
            byte_count = 0
            try:
                with source.open("rb") as source_handle, os.fdopen(descriptor, "wb") as destination:
                    while True:
                        chunk = source_handle.read(1024 * 1024)
                        if not chunk:
                            break
                        byte_count += len(chunk)
                        digest.update(chunk)
                        destination.write(chunk)
                    destination.flush()
                    os.fsync(destination.fileno())
                sha256 = digest.hexdigest()
                original_name = source.name
                filename = re.sub(r"[^A-Za-z0-9_.-]", "_", original_name)[:120].lstrip(".") or "attachment"
                destination_path = attachments / (sha256 + "-" + filename)
                if destination_path.is_symlink():
                    raise ImplementationError(f"Attachment destination is a symlink: {destination_path}")
                try:
                    os.link(temporary, destination_path)
                except FileExistsError:
                    check = hashlib.sha256()
                    with destination_path.open("rb") as existing:
                        for chunk in iter(lambda: existing.read(1024 * 1024), b""):
                            check.update(chunk)
                    if check.hexdigest() != sha256:
                        raise ImplementationError(f"Attachment integrity mismatch: {destination_path}")
                _fsync_directory(attachments)
                source_id = "file_" + sha256[:24]
                existing_link = next(
                    (row for row in current["source_links"] if row["id"] == source_id), None
                )
                if existing_link:
                    if existing_link.get("sha256") != sha256:
                        raise ImplementationError(f"Source ID collision: {source_id}")
                    actual_path = (self.root / existing_link["reference"]).resolve()
                    if not actual_path.is_relative_to(attachments.resolve()):
                        raise ImplementationError("Recorded attachment is outside the plan attachment bank.")
                    if not actual_path.is_file():
                        raise ImplementationError(f"Recorded attachment is missing: {actual_path}")
                    return dict(plan=current, source_link=existing_link, file_ref=str(actual_path))
                link = dict(
                    id=source_id, kind="local_file", label=label or original_name,
                    reference=destination_path.relative_to(self.root).as_posix(),
                    sha256=sha256, size_bytes=byte_count, original_filename=original_name,
                )
                plan = copy.deepcopy(current)
                plan["source_links"].append(link)
                saved = self._commit(
                    directory, plan, previous=current, revision=current["revision"] + 1,
                    operation="attach_file", actor=actor,
                )
                return dict(plan=saved, source_link=link, file_ref=str(destination_path))
            finally:
                if temporary.exists():
                    temporary.unlink()

    def export_json(self, plan_id: str, path: str | Path,
                    revision: int | None = None, *, overwrite: bool = False) -> str:
        # Canonical compact JSON stays importable under the same size limit.
        document = self.get(plan_id, revision)
        return _safe_output(path, canonical_bytes(document).decode("utf-8") + "\n", overwrite)

    def report(self, plan_id: str, out_dir: str | Path, as_of: str | None = None,
               *, revision: int | None = None) -> dict:
        """Create a complete report package for the selected revision in a new directory."""
        document = self.get(plan_id, revision)
        parent = Path(out_dir).expanduser().absolute()
        parent.parent.mkdir(parents=True, exist_ok=True)
        if parent.exists() or parent.is_symlink():
            raise ImplementationError(f"Report directory already exists: {parent}")
        staging = Path(tempfile.mkdtemp(prefix=".report-", dir=parent.parent))
        try:
            summary = summarize_plan(document, as_of)
            filenames = ["plan.json", "summary.json", "report.html"]
            _atomic_bytes(staging / "plan.json", canonical_bytes(document) + b"\n")
            _atomic_bytes(staging / "summary.json", canonical_bytes(summary) + b"\n")
            _atomic_bytes(staging / "report.html",
                          render_report_html(document, summary["as_of"]).encode("utf-8"))
            for table in ("tasks", "budget", "visits", "observations", "sites", "monitoring_plans", "activities"):
                filename = table + ".csv"
                filenames.append(filename)
                _atomic_bytes(staging / filename,
                              report_csv(document, table, summary["as_of"]).encode("utf-8-sig"))
            manifest = dict(
                schema="upstate.implementation-report/v1", plan_id=plan_id,
                revision=document["revision"], as_of=summary["as_of"],
                document_digest=document_digest(document),
                files=[dict(name=filename,
                            sha256=hashlib.sha256((staging / filename).read_bytes()).hexdigest(),
                            size_bytes=(staging / filename).stat().st_size)
                       for filename in filenames],
            )
            _atomic_bytes(staging / "manifest.json", canonical_bytes(manifest) + b"\n")
            # Reserve the requested output name atomically, then fill the owned directory.
            # If interrupted, manifest.json is absent until the final move below.
            parent.mkdir()
            for filename in filenames:
                os.replace(staging / filename, parent / filename)
            os.replace(staging / "manifest.json", parent / "manifest.json")
            _fsync_directory(parent)
            _fsync_directory(parent.parent)
            return dict(
                plan_id=plan_id, revision=document["revision"], as_of=summary["as_of"],
                directory=str(parent), files={
                    filename: str(parent / filename)
                    for filename in filenames + ["manifest.json"]
                },
            )
        finally:
            shutil.rmtree(staging, ignore_errors=True)

    def retain_report(self, directory: str | Path) -> dict:
        """Copy a complete original report edition into its saved plan bank."""
        from .portable_implementation import report_edition
        original = Path(directory).expanduser().resolve(strict=True)
        inspected = report_edition(self, original)
        with self._locked(inspected["plan_id"]) as plan_directory:
            reports = plan_directory / "reports"
            if reports.is_symlink():
                raise ImplementationError("The report bank must be an ordinary directory.")
            reports.mkdir(exist_ok=True)
            target = reports / inspected["id"]
            if target.exists():
                retained = report_edition(self, target)
                if retained != {**inspected, "directory": str(target)}:
                    raise ImplementationError("A retained report edition differs from its original.")
                return retained
            staging = Path(tempfile.mkdtemp(prefix=".pending-report-", dir=reports))
            try:
                for name in inspected["members"]:
                    source = original / name
                    destination = staging / name
                    with source.open("rb") as incoming, destination.open("xb") as outgoing:
                        shutil.copyfileobj(incoming, outgoing, 1024 * 1024)
                        outgoing.flush()
                        os.fsync(outgoing.fileno())
                copied = report_edition(self, staging)
                if copied != {**inspected, "directory": str(staging)}:
                    raise ImplementationError("Report bytes changed during original capture.")
                os.rename(staging, target)
                staging = None
                _fsync_directory(reports)
                return {**inspected, "directory": str(target)}
            finally:
                if staging is not None:
                    shutil.rmtree(staging, ignore_errors=True)

    def list_reports(self, plan_id: str) -> list[dict]:
        from .portable_implementation import report_edition
        directory = self._directory(plan_id) / "reports"
        if not directory.exists():
            return []
        if directory.is_symlink():
            raise ImplementationError("The report bank must be an ordinary directory.")
        rows = []
        for folder in sorted(directory.iterdir()):
            if re.fullmatch(r"[0-9a-f]{64}", folder.name):
                rows.append(report_edition(self, folder))
        return rows
