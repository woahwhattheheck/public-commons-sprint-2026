"""Read immutable saved scientific report editions inside their Workspace.

The native report desk and customer-review preparation share this one retained
edition contract. Original output files, ordered source binding and rendering
identity are verified together before another workflow consumes the report.
"""
from __future__ import annotations

from contextlib import contextmanager
import hashlib
import os
from pathlib import Path
import tempfile
import zipfile

from .common import atomic_json, describe_file, digest, held, identifier, read_json, relative_file, verify_file
from . import observed_context, portable_fs as _fs

KIND = "scientific-report-editions"
SCHEMA = "upstate.scientific-report-edition/v1"


def directory(workspace, key):
    key = identifier(key)
    root = _fs.native_path(workspace.root).resolve()
    selected = root / KIND / key
    if selected.resolve().is_relative_to(root) is False:
        raise ValueError("Keep the saved report inside its original Workspace")
    return selected


def record(workspace, key):
    key = identifier(key)
    selected = directory(workspace, key)
    value = read_json(selected / "edition.json")
    if (value.get("schema") != SCHEMA or value.get("id") != key
            or value.get("project_id") != workspace.project["id"]
            or digest(value.get("render_identity")) != key):
        raise ValueError("The saved report edition identity changed")
    return value, selected


def inspect(workspace, key):
    key = identifier(key)
    value, selected = record(workspace, key)
    result = read_json(selected / "operation.json")
    identity = value["render_identity"]
    if (result.get("state") != "complete"
            or result.get("operation_id") != "observed-report-" + key[:20]
            or any(result.get(name) != item for name, item in identity.items())
            or result.get("files") != value.get("files")
            or read_json(selected / "selection.json") != identity):
        raise ValueError("The completed report differs from its saved selection")
    if not observed_context.same_retained_binding(
            observed_context.bind(workspace, identity["selection"]), identity["binding"]):
        raise ValueError("The saved report's original scientific source edition changed")
    for item in result["files"].values():
        verify_file(selected, item)
    if value.get("capture_origin") is not None:
        from .scientific_report_capture import verify_origin
        verify_origin(workspace, value, selected)
    return value, selected, result


def files(value, selected):
    selected = _fs.native_path(selected)
    members = dict(value["files"])
    for role, name in (("operation", "operation.json"), ("edition", "edition.json")):
        if role in members:
            raise ValueError("Original report output uses a reserved saved-edition role")
        members[role] = describe_file(selected, selected / name)
    return members


class PreviewChanged(ValueError):
    """The selected native source edition differs from its reviewed preview."""


def preview(workspace, payload):
    """Prepare the same ordered-source preview used by the SourceReports queue."""
    from . import observed_report_render as renderer
    result = renderer.prepare(workspace, payload.get("sources"), title=payload.get("title"),
                              contact=payload.get("contact"))
    key = digest(result["render_identity"])
    return {**result, "id": key, "existing": (directory(workspace, key) / "edition.json").is_file()}



def validate_request(workspace, payload, identity):
    """Match an original report request without binding it to today's renderer."""
    supplied = payload.get("sources")
    if not isinstance(supplied, list) or not supplied:
        raise ValueError("Choose one or more retained scientific report sources")
    choices = observed_context.source_choices({"observed_context_sources": supplied})
    if choices != observed_context.source_choices(identity["selection"]):
        raise PreviewChanged("The retained report belongs to another ordered source selection.")
    titles = []
    for choice in choices:
        _, entry = workspace.source_file(choice["source_collection_id"], choice["source_id"])
        titles.append(entry["title"])
    title = payload.get("title")
    if title is not None and (not isinstance(title, str) or not title.strip()):
        raise ValueError("Enter a nonempty report title")
    resolved = title.strip() if title is not None else (
        titles[0] if len(titles) == 1 else "Observed science: " + "; ".join(titles))
    contact = payload.get("contact")
    if contact is None:
        contact = {}
    if (not isinstance(contact, dict)
            or any(not isinstance(contact.get(name, ""), str)
                   for name in ("name", "organization", "email"))):
        raise ValueError("Report contact details must be text")
    if identity.get("title") != resolved or identity.get("contact") != contact:
        raise PreviewChanged("The retained report belongs to another title or contact.")
    if not observed_context.same_retained_binding(
            observed_context.bind(workspace, identity["selection"]), identity.get("binding")):
        raise PreviewChanged("The retained report's original scientific source edition changed.")
    return choices


def _save_edition(workspace, identity, result):
    """Publish the edition from the original completed native operation."""
    key = digest(identity)
    selected = directory(workspace, key)
    value = {"schema": SCHEMA, "id": key, "project_id": workspace.project["id"],
             "title": identity["title"], "render_identity": identity,
             **{name: result[name] for name in (
                 "state", "operation_id", "source_count", "section_count",
                 "figure_count", "sources", "files")}}
    if (selected / "edition.json").is_file():
        previous = read_json(selected / "edition.json")
        if previous.get("capture_origin") is not None:
            original = dict(previous)
            original.pop("capture_origin")
            if original != value:
                raise ValueError("The completed report differs from its adopted original edition.")
            value = previous
    atomic_json(selected / "edition.json", value, immutable=True)
    inspect(workspace, key)
    return {"scientific_report_edition_id": key, "title": value["title"],
            "state": "complete", "source_count": value["source_count"],
            "operation_id": value["operation_id"]}


def render_prepared(workspace, prepared):
    """Complete a retained original preview through the existing native renderer.

    An original preview can retain its source-host path after Workspace transfer.
    Its project belongs to the caller's retained operation; source bindings and
    installed rendering bodies are checked by the same original rendering engine.
    """
    from . import observed_report_render as renderer
    identity = prepared["render_identity"]
    key = digest(identity)
    if (prepared.get("schema") != "upstate.observed-report-preview/v1"
            or prepared.get("id") != key
            or prepared.get("operation_id") != "observed-report-" + key[:20]
            or any(prepared.get(name) != identity.get(name)
                   for name in ("title", "selection", "binding", "workspace"))):
        raise ValueError("Use the retained original scientific report preview")
    choices = observed_context.source_choices(identity["selection"])
    if (prepared.get("source_count") != len(choices)
            or [{"source_collection_id": row["source_collection_id"], "source_id": row["source_id"]}
                for row in prepared.get("sources", [])] != choices):
        raise ValueError("The original report preview changed its ordered source selection")
    selected = directory(workspace, key)
    # The original renderer owns report locking, native file reuse, original
    # source retention, figure drawing and its installed-code identity checks.
    with held(workspace.root / ".workspace.lock"):
        result = renderer.render(workspace, prepared, selected)
        return _save_edition(workspace, identity, result)


def render(workspace, payload):
    """Reopen completed original output, or render the explicitly reviewed preview."""
    key = payload.get("preview_id")
    if key is not None:
        selected = directory(workspace, key)
        # Rendering publishes operation.json before edition.json and the queue's
        # completion record. Reconcile that exact completed effect first, even
        # when installed formatting source has advanced since this request.
        if (selected / "operation.json").is_file():
            with held(workspace.root / ".workspace.lock"):
                identity = read_json(selected / "selection.json")
                result = read_json(selected / "operation.json")
                if (identity.get("schema") != "upstate.observed-report-native/v1"
                        or digest(identity) != key
                        or result.get("state") != "complete"
                        or result.get("operation_id") != "observed-report-" + key[:20]
                        or any(result.get(name) != value for name, value in identity.items())):
                    raise ValueError("The retained completed report differs from its original preview")
                choices = validate_request(workspace, payload, identity)
                if (result.get("source_count") != len(choices)
                        or [{"source_collection_id": row["source_collection_id"],
                             "source_id": row["source_id"]} for row in result.get("sources", [])]
                        != choices):
                    raise ValueError("The completed report changed its ordered original sources")
                for item in result["files"].values():
                    verify_file(selected, item)
                return _save_edition(workspace, identity, result)
    prepared = preview(workspace, payload)
    if payload.get("preview_id") != prepared["id"]:
        raise PreviewChanged("Preview this exact ordered study selection before preparing its report.")
    return render_prepared(workspace, prepared)


@contextmanager
def _original_reader(path):
    """Keep a retained native report bound to one regular-file identity."""
    path = _fs.native_path(path)
    signature = lambda item: (item.st_dev, item.st_ino, item.st_size,
                              item.st_mtime_ns, item.st_ctime_ns)
    with os.fdopen(_fs.open_file(path, os.O_RDONLY), "rb") as source:
        before = signature(_fs.fd_stat(source.fileno()))
        yield source
        if (before != signature(_fs.fd_stat(source.fileno()))
                or before != signature(_fs.path_stat(path))):
            raise ValueError("A saved scientific report changed while it was read")


def _verify_archive(path, members):
    """Recover an already-published archive before its receipt was committed."""
    with _original_reader(path) as source, zipfile.ZipFile(source) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)) or set(names) != set(members):
            raise ValueError("The existing report archive retains different original files")
        for name, item in members.items():
            if archive.getinfo(name).file_size != item["bytes"]:
                raise ValueError("The existing report archive member differs: " + name)
            count, checksum = 0, hashlib.sha256()
            with archive.open(name) as member:
                while chunk := member.read(1024 * 1024):
                    count += len(chunk)
                    checksum.update(chunk)
            if count != item["bytes"] or checksum.hexdigest() != item["sha256"]:
                raise ValueError("The existing report archive member differs: " + name)


def export(workspace, key):
    """Retain the complete original report ZIP for native and web consumers."""
    record, directory, _ = inspect(workspace, identifier(key))
    directory = _fs.native_path(directory)
    destination = directory / "report-files.zip"
    receipt = directory / "report-files.json"
    report_files = files(record, directory)
    members = {item["path"]: item for item in report_files.values()}
    identity = {name: {field: item[field] for field in ("bytes", "sha256")}
                for name, item in sorted(members.items())}
    with held(workspace.root / ".workspace.lock"), held(directory / ".export.lock"):
        if receipt.exists():
            prior = read_json(receipt)
            if prior.get("members") != identity:
                raise ValueError("The saved report archive belongs to another edition")
            verify_file(directory, prior["file"])
        else:
            if destination.exists() or destination.is_symlink():
                _verify_archive(destination, members)
            else:
                fd, temporary_name = tempfile.mkstemp(prefix=".report-files-", suffix=".zip", dir=directory)
                temporary = Path(temporary_name)
                try:
                    with os.fdopen(fd, "w+b") as completed:
                        with zipfile.ZipFile(completed, "w", compression=zipfile.ZIP_DEFLATED,
                                             allowZip64=True) as archive:
                            for name, item in sorted(members.items()):
                                path = relative_file(directory, name)
                                info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
                                info.compress_type = zipfile.ZIP_DEFLATED
                                info.external_attr = 0o100600 << 16
                                info.file_size = item["bytes"]
                                count, checksum = 0, hashlib.sha256()
                                with _original_reader(path) as source, archive.open(
                                        info, "w", force_zip64=item["bytes"] >= zipfile.ZIP64_LIMIT) as target:
                                    while chunk := source.read(1024 * 1024):
                                        count += len(chunk)
                                        checksum.update(chunk)
                                        target.write(chunk)
                                if count != item["bytes"] or checksum.hexdigest() != item["sha256"]:
                                    raise ValueError("A saved scientific report file changed: " + name)
                        completed.flush()
                        os.fsync(completed.fileno())
                    try:
                        _fs.publish_file(temporary, destination)
                    except FileExistsError:
                        _verify_archive(destination, members)
                    _fs.sync_directory(directory)
                finally:
                    temporary.unlink(missing_ok=True)
            atomic_json(receipt, {"members": identity,
                                 "file": describe_file(directory, destination)}, immutable=True)
        item = read_json(receipt)["file"]
    return {"scientific_report_edition_id": key, "state": "complete",
            "title": record["title"], "directory": str(directory), "file": item}
