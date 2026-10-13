"""Original Implementation revisions, attachments and report editions in a Workspace archive."""
from __future__ import annotations

from contextlib import ExitStack, contextmanager
import hashlib
from pathlib import Path, PurePosixPath
import re

from .implementation import ImplementationStore, _file_lock, _same_json
from .implementation_schema import (
    COLLECTIONS, ID_RE, MAX_JSON_BYTES, ImplementationError,
    canonical_bytes, document_digest, load_json, validate_plan,
)

SCHEMA = "upstate.implementation-receiving/v1"
ROOT = "implementation/plans"
HEX = re.compile(r"[0-9a-f]{64}")


def _ordinary(path):
    if path.is_symlink() or not path.is_file():
        raise ImplementationError("The retained implementation file must be ordinary: " + str(path))
    return path


def _json(path):
    with _ordinary(Path(path)).open("rb") as handle:
        return load_json(handle.read(MAX_JSON_BYTES + 65537), max_bytes=MAX_JSON_BYTES + 65536)


def _identity(path):
    path = _ordinary(Path(path))
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return {"bytes": path.stat().st_size, "sha256": digest.hexdigest()}


def _relative(value):
    if not isinstance(value, str) or "\\" in value or "\0" in value:
        raise ImplementationError("Invalid retained implementation path.")
    path = PurePosixPath(value)
    if (path.is_absolute() or not path.parts or path.as_posix() != value
            or any(part in (".", "..") for part in path.parts)):
        raise ImplementationError("Implementation files must stay in their original Workspace.")
    return path


@contextmanager
def locked_implementation(workspace_root):
    """Hold the plan bank and all saved plan locks in deterministic order."""
    bank = Path(workspace_root) / "implementation"
    if bank.is_symlink():
        raise ImplementationError("The implementation bank must be an ordinary directory.")
    bank.mkdir(parents=True, exist_ok=True)
    with ExitStack() as stack:
        stack.enter_context(_file_lock(bank / ".plans.lock", blocking=False))
        plans = bank / "plans"
        if plans.exists():
            if plans.is_symlink() or not plans.is_dir():
                raise ImplementationError("The plan bank must be an ordinary directory.")
            for directory in sorted(plans.iterdir()):
                if not ID_RE.fullmatch(directory.name):
                    continue
                if directory.is_symlink() or not directory.is_dir():
                    raise ImplementationError("A saved plan must be an ordinary directory.")
                stack.enter_context(_file_lock(directory / ".lock", blocking=False))
        yield


def report_edition(store, directory, *, members=None):
    """Validate one complete original report against its saved plan revision."""
    directory = Path(directory)
    if directory.is_symlink() or not directory.is_dir():
        raise ImplementationError("The report edition must be an ordinary directory.")
    manifest_path = directory / "manifest.json"
    manifest = _json(manifest_path)
    if manifest.get("schema") != "upstate.implementation-report/v1":
        raise ImplementationError("Unrecognized original implementation report.")
    plan = store.get(manifest.get("plan_id"), manifest.get("revision"))
    if document_digest(plan) != manifest.get("document_digest"):
        raise ImplementationError("The report differs from its saved native revision.")
    files = manifest.get("files")
    if not isinstance(files, list) or not files:
        raise ImplementationError("The report lacks its original member inventory.")
    names = []
    for item in files:
        if not isinstance(item, dict):
            raise ImplementationError("Invalid original report member.")
        name = _relative(item.get("name")).as_posix()
        if "/" in name or name == "manifest.json" or name in names:
            raise ImplementationError("Report member names must be unique original filenames.")
        path = _ordinary(directory / name)
        expected = {"bytes": item.get("size_bytes"), "sha256": item.get("sha256")}
        if members is None:
            actual = _identity(path)
        else:
            relative = path.relative_to(store.root).as_posix()
            retained = members.get("workspace/" + relative)
            actual = ({key: retained.get(key) for key in ("bytes", "sha256")}
                      if isinstance(retained, dict) else None)
        if actual != expected:
            raise ImplementationError("An original implementation report member differs: " + name)
        names.append(name)
    if not {"plan.json", "summary.json", "report.html"}.issubset(names):
        raise ImplementationError("The original report lacks its saved plan, summary or HTML.")
    document = validate_plan(_json(directory / "plan.json"))
    if not _same_json(document, plan):
        raise ImplementationError("The report plan differs from its original saved revision.")
    summary = _json(directory / "summary.json")
    if summary.get("as_of") != manifest.get("as_of"):
        raise ImplementationError("The report summary uses another observation date.")
    identity = _identity(manifest_path)
    return {
        "id": identity["sha256"], "plan_id": plan["id"], "revision": plan["revision"],
        "as_of": manifest["as_of"], "document_digest": manifest["document_digest"],
        "directory": str(directory), "members": names + ["manifest.json"],
        "files": len(names) + 1, "manifest_sha256": identity["sha256"],
    }


def verify_implementation(workspace_root, members=None):
    """Reopen existing native history without altering source or plan records.

    members, when supplied, is the already verified Workspace archive inventory.
    An imported JSON document can describe a local original that was never
    attached here. It remains visibly unavailable; a native attach_file event
    requires its original managed bytes.
    """
    root = Path(workspace_root)
    bank = root / ROOT
    empty = {"schema": SCHEMA, "plans": [], "plan_count": 0, "revision_count": 0, "report_count": 0}
    if not bank.exists():
        return empty
    if bank.is_symlink() or not bank.is_dir():
        raise ImplementationError("The retained plan bank must be an ordinary directory.")
    store = ImplementationStore(root)
    rows = []
    for directory in sorted(bank.iterdir()):
        if not ID_RE.fullmatch(directory.name):
            continue
        if directory.is_symlink() or not directory.is_dir():
            raise ImplementationError("The retained plan must be an ordinary directory.")
        paths = store._revision_paths(directory)
        if not paths:
            continue
        history = store.history(directory.name)
        frozen = {"candidates": {}, "source_links": {}}
        protected = {
            "candidates": ("source", "modeled_benefits", "area_ha"),
            "source_links": ("kind", "reference", "snapshot", "source_digest",
                             "source_id", "source_schema", "field_mapping", "sha256", "size_bytes"),
        }
        attachments, missing = {}, {}
        previous_links, created_at = {}, None
        for path in paths:
            record = store._read_record(path)
            plan, event = record["plan"], record["event"]
            if created_at is not None and created_at != plan["created_at"]:
                raise ImplementationError("The native plan changed its original creation time.")
            created_at = plan["created_at"]
            for collection, fields in protected.items():
                for value in plan[collection]:
                    selected = {key: value.get(key) for key in fields}
                    prior = frozen[collection].get(value["id"])
                    if prior is not None and not _same_json(prior, selected):
                        raise ImplementationError("A native plan source ID changed its original snapshot.")
                    frozen[collection][value["id"]] = selected
            for value in plan["source_links"]:
                if value.get("kind") != "local_file" or not value.get("reference"):
                    continue
                reference = value["reference"]
                managed = reference.startswith(ROOT + "/" + plan["id"] + "/attachments/")
                required = event.get("operation") == "attach_file" and value["id"] not in previous_links
                if not managed:
                    if required:
                        raise ImplementationError("A native attachment left its saved plan bank.")
                    missing[value["id"]] = {key: value.get(key) for key in ("id", "label", "reference")}
                    continue
                relative = _relative(reference)
                actual_path = root.joinpath(*relative.parts)
                if not actual_path.exists():
                    if required:
                        raise ImplementationError("The archive lacks an original native attachment.")
                    missing[value["id"]] = {key: value.get(key) for key in ("id", "label", "reference")}
                    continue
                _ordinary(actual_path)
                wanted = {"bytes": value.get("size_bytes"), "sha256": value.get("sha256")}
                if members is None:
                    observed = _identity(actual_path)
                else:
                    item = members.get("workspace/" + reference)
                    observed = ({key: item.get(key) for key in ("bytes", "sha256")}
                                if isinstance(item, dict) else None)
                if observed != wanted:
                    raise ImplementationError("The original native attachment bytes differ: " + reference)
                attachments[value["id"]] = wanted
                missing.pop(value["id"], None)
            previous_links = {value["id"]: value for value in plan["source_links"]}
        reports = []
        report_root = directory / "reports"
        if report_root.is_symlink():
            raise ImplementationError("The native report bank must be an ordinary directory.")
        if report_root.exists():
            for folder in sorted(report_root.iterdir()):
                if not HEX.fullmatch(folder.name):
                    continue
                report = report_edition(store, folder, members=members)
                if report["id"] != folder.name or report["plan_id"] != directory.name:
                    raise ImplementationError("A retained report edition identifies another source.")
                reports.append({
                    key: report[key] for key in ("id", "revision", "as_of", "files")
                } | {"manifest": (folder / "manifest.json").relative_to(root).as_posix()})
        rows.append({
            "id": plan["id"], "title": plan["title"], "revision": plan["revision"],
            "document_digest": document_digest(plan), "revision_count": len(history),
            "record_counts": {collection: len(plan[collection]) for collection in COLLECTIONS},
            "attachment_count": len(attachments), "unavailable_attachments": list(missing.values()),
            "reports": reports,
        })
    return {
        "schema": SCHEMA, "plans": rows, "plan_count": len(rows),
        "revision_count": sum(row["revision_count"] for row in rows),
        "report_count": sum(len(row["reports"]) for row in rows),
    }
