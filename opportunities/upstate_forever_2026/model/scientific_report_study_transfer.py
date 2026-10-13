"""Selected original scientific-report editions and their typed source history.

The report identity, order and bytes are retained. This resolver never renders a
report, rewrites its original Workspace path, or materializes source-view links.
The maintained source-lineage resolvers decide which editable studies accompany
each exact source collection.
"""
from __future__ import annotations

from copy import deepcopy
from pathlib import Path, PurePosixPath

from .common import digest, identifier, read_json
from . import observed_context

KIND = "scientific-report-editions"
SCHEMA = "upstate.scientific-report-edition/v1"
RECEIPT_SCHEMA = "upstate.study-scientific-report-edition/v1"
ROOT_KINDS = (KIND,)
DOCUMENTS = {KIND: "edition.json"}
LOCKS = {KIND: ".observed-report.lock"}
LABELS = {KIND: "Saved scientific reports"}


def _relative(value):
    if not isinstance(value, str) or "\\" in value or "\0" in value:
        raise ValueError("A saved scientific report needs an original relative member path.")
    path = PurePosixPath(value)
    if (path.is_absolute() or not path.parts or ".." in path.parts
            or path.as_posix() != value or any(":" in part for part in path.parts)):
        raise ValueError("A saved scientific report member must remain in its original directory.")
    return value


def _source(closure, choice, expected_source):
    """Validate a source binding through CAS objects without creating view links."""
    collection_id = identifier(choice["source_collection_id"])
    value = closure.read("sources/" + collection_id + ".json")
    if value.get("schema") != "upstate.sources/v1" or digest(value) != collection_id:
        raise ValueError("A scientific report's original source collection changed.")
    entries = [entry for entry in value.get("entries", [])
               if entry.get("id") == choice["source_id"]]
    if len(entries) != 1 or entries[0].get("kind") != "document":
        raise ValueError("The saved scientific report needs its exact original source document.")
    entry = entries[0]
    original_source = {
        **choice, "title": entry["title"], "vintage": entry["vintage"],
        "uri": entry["uri"], "body_bytes": entry["body"]["bytes"],
        "body_sha256": entry["body"]["sha256"],
    }
    if any(expected_source.get(name) != value for name, value in original_source.items()):
        raise ValueError("The saved report source roster differs from its original source edition.")
    members = {}
    for item in [entry["body"], *entry.get("companions", [])]:
        name = _relative(item.get("view_path", item["filename"]))
        if name in members:
            raise ValueError("A scientific report source repeats an original member path.")
        closure.add_file(item["object"], item)
        members[name] = item
    recipe = closure.read(entry["body"]["object"])
    if recipe.get("schema") != observed_context.SCHEMA:
        raise ValueError("The original scientific report document has another schema.")
    for item in recipe.get("inputs", []):
        name = _relative(item["path"])
        original = members.get(name)
        if original is None or any(original.get(field) != item.get(field)
                                   for field in ("bytes", "sha256")):
            raise ValueError("The scientific report lost an original source input: " + name)
    closure.need("sources", collection_id, "Ordered scientific report source " + entry["id"])
    # These producer contracts apply only to explicitly ordered saved-edition
    # sources. Older archive selections keep their original dependency semantics.
    from . import monitoring_study_transfer, study_report_transfer, receiving_water_report_transfer
    from . import native_process_study_transfer
    monitoring_study_transfer.include_source(closure, collection_id, entry)
    study_report_transfer.include_calibration(closure, collection_id, entry)
    receiving_water_report_transfer.include_source(closure, collection_id, entry)
    native_process_study_transfer.include_source(closure, collection_id, entry)
    return {
        "schema": "upstate.observed-report-binding/v1", "edition": observed_context.EDITION,
        "source_collection_id": collection_id, "source_id": entry["id"],
        "body_sha256": entry["body"]["sha256"],
        "member_sha256": {name: members[name]["sha256"] for name in sorted(members)},
    }


def _record(workspace, key, record):
    identifier(key)
    identity = record.get("render_identity")
    if (record.get("schema") != SCHEMA or record.get("id") != key
            or record.get("project_id") != workspace.project["id"]
            or not isinstance(identity, dict) or digest(identity) != key
            or identity.get("schema") != "upstate.observed-report-native/v1"
            or record.get("state") != "complete"
            or record.get("operation_id") != "observed-report-" + key[:20]):
        raise ValueError("The saved scientific report differs from its original completed edition.")
    return identity


def include(closure, key, record):
    """Retain one completed original edition and its ordered source dependencies."""
    identity = _record(closure.workspace, key, record)
    prefix = KIND + "/" + key + "/"
    result = closure.read(prefix + "operation.json")
    selection_record = closure.read(prefix + "selection.json")
    if (selection_record != identity or result.get("state") != "complete"
            or result.get("operation_id") != record["operation_id"]
            or any(result.get(name) != value for name, value in identity.items())
            or any(record.get(name) != result.get(name) for name in
                   ("state", "operation_id", "source_count", "section_count",
                    "figure_count", "sources", "files"))):
        raise ValueError("The completed scientific report differs from its retained edition.")
    selection = identity.get("selection")
    if not isinstance(selection, dict):
        raise ValueError("The saved scientific report needs its original ordered selection.")
    choices = observed_context.source_choices(selection)
    if not choices or len(choices) != record.get("source_count"):
        raise ValueError("The saved scientific report changed its ordered source count.")
    sources = record.get("sources")
    if (not isinstance(sources, list) or
            [{name: row.get(name) for name in ("source_collection_id", "source_id")}
             for row in sources] != choices):
        raise ValueError("The saved scientific report changed its ordered source roster.")
    bindings = [_source(closure, choice, source) for choice, source in zip(choices, sources)]
    binding = observed_context._binding([{"binding": item} for item in bindings])
    if identity.get("binding") != binding or selection.get("observed_context_binding") != binding:
        raise ValueError("The scientific report source bindings differ from the saved edition.")
    files = record.get("files")
    if not isinstance(files, dict) or not files:
        raise ValueError("The saved scientific report has no retained output files.")
    if any(role in files for role in ("operation", "edition")):
        raise ValueError("A saved scientific report uses a reserved output role.")
    retained = {}

    def member(name, expected=None):
        name = _relative(name)
        relative = prefix + name
        closure.add_file(relative, expected)
        previous = retained.get(relative)
        if previous is not None and expected is not None and any(
                previous.get(field) != expected.get(field) for field in ("bytes", "sha256")):
            raise ValueError("Scientific report roles disagree about an original output.")
        item = closure.files[relative]
        if item.get("sha256") is None:
            closure.read(relative)
            item = closure.files[relative]
        retained[relative] = {"path": relative, "bytes": item["bytes"], "sha256": item["sha256"]}

    for descriptor in files.values():
        if not isinstance(descriptor, dict):
            raise ValueError("A scientific report output needs its original file descriptor.")
        member(descriptor["path"], descriptor)
    for name in ("edition.json", "operation.json", "selection.json"):
        member(name)
    if (files.get("selection") or {}).get("path") != "selection.json":
        raise ValueError("The saved scientific report lacks its original selection artifact.")

    archive = None
    receipt_name = prefix + "report-files.json"
    if (closure.root / receipt_name).exists() or (closure.root / receipt_name).is_symlink():
        archived = closure.read(receipt_name)
        expected_members = {}
        for descriptor in files.values():
            name = _relative(descriptor["path"])
            expected_members[name] = {field: descriptor[field] for field in ("bytes", "sha256")}
        for name in ("edition.json", "operation.json"):
            expected_members[name] = {field: retained[prefix + name][field]
                                      for field in ("bytes", "sha256")}
        descriptor = archived.get("file")
        if (archived.get("members") != expected_members or not isinstance(descriptor, dict)
                or descriptor.get("path") != "report-files.zip"):
            raise ValueError("The saved report ZIP differs from its original report files.")
        member("report-files.json")
        member("report-files.zip", descriptor)
        archive = deepcopy(retained[prefix + "report-files.zip"])
    retained_row = {
        "schema": RECEIPT_SCHEMA, "id": key, "project_id": closure.workspace.project["id"],
        "operation_id": record["operation_id"], "title": record["title"],
        "record_sha256": retained[prefix + "edition.json"]["sha256"],
        "operation_sha256": retained[prefix + "operation.json"]["sha256"],
        "render_identity_sha256": digest(identity),
        "source_choices": deepcopy(choices), "sources": deepcopy(sources),
        "source_binding": deepcopy(binding),
        "source_count": record["source_count"], "section_count": record["section_count"],
        "figure_count": record["figure_count"],
        "members": [retained[name] for name in sorted(retained)],
        "report_archive": archive,
    }
    previous = closure.scientific_report_records.get(key)
    if previous is not None and previous != retained_row:
        raise ValueError("The selected scientific report changed during transfer preparation.")
    closure.scientific_report_records[key] = retained_row
    closure.nodes[(KIND, key)].update(
        title=record["title"], state="complete", source_count=record["source_count"],
        section_count=record["section_count"], figure_count=record["figure_count"],
        ordered_source_choices=deepcopy(choices),
    )


def visit(closure, kind, key, value):
    if kind != KIND:
        return False
    include(closure, key, value)
    return True


def receipt(closure):
    return [deepcopy(row) for unused, row in sorted(closure.scientific_report_records.items())]


def verify_receipt(closure, captured):
    """Check retained bytes while permitting later report ZIP creation."""
    actual = {row["id"]: row for row in receipt(closure)}
    for original in captured:
        current = actual.get(original["id"])
        if current is None or any(
                current.get(name) != value for name, value in original.items()
                if name not in ("members", "report_archive")):
            raise ValueError("The received study lost an original scientific report edition.")
        members = {row["path"]: row for row in current["members"]}
        if any(members.get(row["path"]) != row for row in original["members"]):
            raise ValueError("The received scientific report lost an exact original output file.")
        if original.get("report_archive") is not None and current.get("report_archive") != original["report_archive"]:
            raise ValueError("The received scientific report lost its retained report ZIP.")


def catalogue(workspace):
    """Read saved edition metadata; preview validates the selected complete files."""
    root = Path(workspace.root).resolve()
    rows = []
    for path in sorted((root / KIND).glob("*/edition.json")):
        key = path.parent.name
        try:
            identifier(key)
            if path.is_symlink() or path.parent.is_symlink() or not path.resolve().is_relative_to(root):
                raise ValueError("Keep the saved scientific edition inside its original Workspace.")
            record = read_json(path)
            identity = _record(workspace, key, record)
            row = {"kind": KIND, "id": key, "title": record["title"], "state": "complete",
                   "updated_at": "", "selection": deepcopy(identity["selection"]),
                   "counts": {name: record[name] for name in
                              ("source_count", "section_count", "figure_count")}}
        except (OSError, ValueError, KeyError, TypeError) as error:
            row = {"kind": KIND, "id": key, "title": key[:12], "state": "unreadable",
                   "updated_at": "", "error": {"type": type(error).__name__, "message": str(error)}}
        rows.append(row)
    return rows
