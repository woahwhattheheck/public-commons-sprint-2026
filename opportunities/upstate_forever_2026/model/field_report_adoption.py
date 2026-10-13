"""Adopt already-rendered field reports into their original native Workspace.

This operation retains the five existing presentation editions unchanged. Native
report storage verifies each complete packet against its original saved plan.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from types import SimpleNamespace

from . import field_report_presentation as presentation
from .common import atomic_bytes, canonical, digest, identifier, read_json
from .implementation import ImplementationStore, _file_lock
from .implementation_schema import ImplementationError
from .portable_implementation import report_edition
from .simulated_fieldwork import inspect_campaign

SCHEMA = "upstate.field-report-adoption/v1"
REQUEST_SCHEMA = "upstate.field-report-adoption-request/v1"
RECEIPT_SCHEMA = "ecosystems.actual-attachment-presentation-successors/v1"


def _ordinary(path, *, directory=False, missing=False):
    path = Path(path).expanduser().absolute()
    current = Path(path.anchor)
    for part in path.parts[1:]:
        if part in (".", ".."):
            raise ImplementationError("Use an ordinary exact source or adoption path.")
        current = current / part
        if current.is_symlink():
            raise ImplementationError("An adoption source or destination became a file alias.")
    if not path.exists():
        if missing:
            return path
        raise ImplementationError("The original adoption member is unavailable: " + str(path))
    if not (path.is_dir() if directory else path.is_file()):
        raise ImplementationError("The adoption member has the wrong file type: " + str(path))
    return path


def _same(left, right, message):
    if canonical(left) != canonical(right):
        raise ImplementationError(message)


def _put(path, value):
    path = _ordinary(path, missing=True)
    atomic_bytes(path, canonical(value) + b"\n", immutable=True)


def _identity(workspace, field_operation_id, receipt_body):
    return {
        "schema": REQUEST_SCHEMA,
        "project_id": workspace.project["id"],
        "field_operation_id": identifier(field_operation_id),
        "receipt_sha256": hashlib.sha256(receipt_body).hexdigest(),
        "receipt_bytes": len(receipt_body),
    }


def _directory(workspace, operation_id, *, create=False):
    operation_id = identifier(operation_id)
    path = _ordinary(Path(workspace.root) / "implementation" / "field-presentations" / operation_id,
                     directory=True, missing=create)
    if create:
        path.mkdir(parents=True, exist_ok=True)
        _ordinary(path, directory=True)
    return path


def _campaign(workspace, field_operation_id):
    value = inspect_campaign(workspace, identifier(field_operation_id))
    if value.get("phase") != "closeout" or value.get("original_project_id") != workspace.project["id"]:
        raise ImplementationError("Adopt reports for this original completed field campaign.")
    expected = [("qc", row["report_id"]) for row in value["qc_reports"]]
    expected += [("actions", row["action_report_id"]) for row in value["action_reports"]]
    if len(expected) != 5 or len(set(expected)) != 5:
        raise ImplementationError("Retain the original two QC and three action editions.")
    return value, expected


def _receipt_selection(receipt, campaign, expected):
    if not isinstance(receipt, dict) or receipt.get("schema") != RECEIPT_SCHEMA:
        raise ImplementationError("Use the original actual presentation-successor receipt.")
    if not isinstance(receipt.get("reports"), list):
        raise ImplementationError("The actual presentation receipt lacks its complete report list.")
    by_key = {}
    for row in receipt["reports"]:
        if not isinstance(row, dict):
            raise ImplementationError("An original presentation receipt entry is invalid.")
        name = row.get("id")
        if name == "handback_index":
            continue
        if not isinstance(name, str):
            raise ImplementationError("The actual report label is missing.")
        if name.startswith("qc_reports-"):
            kind = "qc"
        elif name.startswith("action_reports-"):
            kind = "actions"
        else:
            raise ImplementationError("Keep unrelated presentation families outside this five-report adoption.")
        key = (kind, identifier(row.get("original_report_id")))
        selected = identifier(row.get("new_report_id"))
        if key not in expected or key in by_key or selected == key[1]:
            raise ImplementationError("The receipt must name each original field report exactly once.")
        if row.get("plan_id") != campaign["plan_id"]:
            raise ImplementationError("The actual presentation belongs to another original field plan.")
        by_key[key] = row
    if set(by_key) != set(expected) or len({row["new_report_id"] for row in by_key.values()}) != 5:
        raise ImplementationError("Use all five distinct presentation editions from the original receipt.")
    selection = {
        "schema": presentation.SELECTION_SCHEMA, "field_operation_id": campaign["operation_id"],
        "reports": [{"kind": kind, "original_report_id": original,
                     "presentation_report_id": by_key[(kind, original)]["new_report_id"]}
                    for kind, original in expected],
    }
    return by_key, selection


def _source_context(receipt, override):
    original = Path(receipt.get("owned_field_context", ""))
    if not original.is_absolute() or ".." in original.parts:
        raise ImplementationError("The original receipt lacks its exact retained field-report context.")
    context = _ordinary(override if override is not None else original, directory=True)
    return original, context


def _preflight(workspace, campaign, expected, receipt, source_context):
    """Read and verify ALL five source/destination pairs before any native copy."""
    by_key, selection = _receipt_selection(receipt, campaign, expected)
    old_root, root = _source_context(receipt, source_context)
    source_workspace = SimpleNamespace(root=root)
    destination = ImplementationStore(workspace)
    pairs, paths = [], {}
    for kind, original_id in expected:
        row = by_key[(kind, original_id)]
        selected_id = row["new_report_id"]
        recorded = Path(row.get("directory", ""))
        wanted = Path("implementation") / "plans" / campaign["plan_id"] / "reports" / selected_id
        if (not recorded.is_absolute() or ".." in recorded.parts
                or not recorded.is_relative_to(old_root)
                or recorded.relative_to(old_root) != wanted):
            raise ImplementationError("The original report path differs from its recorded native edition.")
        source = _ordinary(root / wanted, directory=True)
        pair = presentation._inspect_pair(source_workspace, campaign["plan_id"], kind, original_id, selected_id)
        module, _, _, _ = presentation.KINDS[kind]
        _same(module.inspect(source_workspace, campaign["plan_id"], original_id),
              module.inspect(workspace, campaign["plan_id"], original_id),
              "The source context differs from the destination's original native report.")
        # This also validates complete original plan.json against the destination
        # revision bank; no copied context can introduce another plan or sample.
        edition = report_edition(destination, source)
        if (edition["id"] != selected_id or edition["revision"] != row.get("revision")
                or pair["revision"] != edition["revision"]):
            raise ImplementationError("The receipt differs from its actual complete native presentation.")
        pairs.append(pair)
        paths[(kind, original_id)] = source
    return selection, pairs, paths


def _read_request(workspace, operation_id, directory):
    request = read_json(_ordinary(directory / "request.json"))
    if not isinstance(request, dict) or request.get("schema") != REQUEST_SCHEMA:
        raise ImplementationError("Choose the original retained field adoption.")
    identity = {key: request.get(key) for key in
                ("schema", "project_id", "field_operation_id", "receipt_sha256", "receipt_bytes")}
    if digest(identity) != operation_id or identity["project_id"] != workspace.project["id"]:
        raise ImplementationError("The adoption request belongs to another original project.")
    body = _ordinary(directory / "receipt.json").read_bytes()
    _same(_identity(workspace, identity["field_operation_id"], body), identity,
          "The original presentation receipt changed.")
    receipt = json.loads(body)
    campaign, expected = _campaign(workspace, identity["field_operation_id"])
    _, selection = _receipt_selection(receipt, campaign, expected)
    _same(request.get("selection"), selection, "The retained original report choice changed.")
    if request.get("plan_id") != campaign["plan_id"] or not isinstance(request.get("reports"), list):
        raise ImplementationError("The original adoption plan or full report inventory changed.")
    keys = [(row.get("kind"), row.get("original_report_id")) for row in request["reports"]]
    if keys != expected:
        raise ImplementationError("The retained adoption report order or membership changed.")
    for row, chosen in zip(request["reports"], selection["reports"]):
        if (row.get("plan_id") != campaign["plan_id"]
                or row.get("presentation_report_id") != chosen["presentation_report_id"]):
            raise ImplementationError("The retained original-to-presentation pair changed.")
    return request, receipt, campaign, expected


def _retained(workspace, request):
    store = ImplementationStore(workspace)
    completed, missing = [], []
    for frozen in request["reports"]:
        kind, original_id, selected_id = frozen["kind"], frozen["original_report_id"], frozen["presentation_report_id"]
        # Always check the original report; later unrelated current-plan edits
        # do not substitute for its immutable saved revision.
        module = presentation.KINDS[kind][0]
        original = module.inspect(workspace, request["plan_id"], original_id)
        _same(original["files"], frozen["original_files"], "An original field report changed after adoption admission.")
        target = _ordinary(store.root / "implementation" / "plans" / request["plan_id"] / "reports" / selected_id,
                           directory=True, missing=True)
        if not target.exists():
            missing.append({"kind": kind, "original_report_id": original_id, "presentation_report_id": selected_id})
            continue
        actual = presentation._inspect_pair(workspace, request["plan_id"], kind, original_id, selected_id)
        _same(actual, frozen, "A retained presentation differs from the original admitted source.")
        completed.append(selected_id)
    return completed, missing


def _result(workspace, operation_id, directory, request):
    chosen = presentation.inspect_selection(workspace, request["field_operation_id"], request["selection"])
    _same(chosen["reports"], request["reports"], "The completed adoption differs from its original all-five admission.")
    return {
        "schema": SCHEMA, "status": "complete", "operation_id": operation_id,
        "project_id": workspace.project["id"], "field_operation_id": request["field_operation_id"],
        "plan_id": request["plan_id"], "receipt_sha256": request["receipt_sha256"],
        "directory": directory.relative_to(Path(workspace.root).resolve()).as_posix(),
        "presentation": chosen,
    }


def inspect_adoption(workspace, operation_id):
    """Reopen from the received Workspace; original external paths are unnecessary."""
    operation_id = identifier(operation_id)
    directory = _directory(workspace, operation_id)
    with _file_lock(directory / ".lock"):
        request, _, _, _ = _read_request(workspace, operation_id, directory)
        retained, missing = _retained(workspace, request)
        finished = _ordinary(directory / "completed.json", missing=True)
        if finished.exists():
            result = _result(workspace, operation_id, directory, request)
            _same(read_json(finished), result, "The original completed adoption receipt changed.")
            return result
        return {
            "schema": SCHEMA, "status": "partially_retained" if missing else "retained_pending_completion",
            "operation_id": operation_id, "project_id": workspace.project["id"],
            "field_operation_id": request["field_operation_id"], "plan_id": request["plan_id"],
            "receipt_sha256": request["receipt_sha256"],
            "directory": directory.relative_to(Path(workspace.root).resolve()).as_posix(),
            "retained_report_ids": retained, "missing_reports": missing,
        }


def adopt_presentations(workspace, field_operation_id, receipt_path, *, source_context=None):
    """Preflight and retain the five already-produced native report successors."""
    receipt_body = _ordinary(receipt_path).read_bytes()
    receipt = json.loads(receipt_body)
    identity = _identity(workspace, field_operation_id, receipt_body)
    operation_id = digest(identity)
    directory = _directory(workspace, operation_id, create=True)
    with _file_lock(directory / ".lock"):
        request_path = _ordinary(directory / "request.json", missing=True)
        paths = None
        if request_path.exists():
            request, retained_receipt, campaign, expected = _read_request(workspace, operation_id, directory)
            _same(retained_receipt, receipt, "Resume with the original complete presentation receipt.")
            _, missing = _retained(workspace, request)
            if missing:
                selection, pairs, paths = _preflight(workspace, campaign, expected, receipt, source_context)
                _same({"selection": selection, "reports": pairs},
                      {"selection": request["selection"], "reports": request["reports"]},
                      "The remaining presentation sources differ from the admitted original edition.")
        else:
            campaign, expected = _campaign(workspace, field_operation_id)
            selection, pairs, paths = _preflight(workspace, campaign, expected, receipt, source_context)
            request = {**identity, "plan_id": campaign["plan_id"], "selection": selection, "reports": pairs}
            # Exact original receipt then request commit BEFORE the first native
            # report mutation. An interrupted initialization reuses these bytes.
            atomic_bytes(_ordinary(directory / "receipt.json", missing=True), receipt_body, immutable=True)
            _put(request_path, request)
        store = ImplementationStore(workspace)
        for frozen in request["reports"]:
            kind, original_id, selected_id = frozen["kind"], frozen["original_report_id"], frozen["presentation_report_id"]
            target = _ordinary(store.root / "implementation" / "plans" / request["plan_id"] / "reports" / selected_id,
                               directory=True, missing=True)
            if not target.exists():
                if paths is None:
                    raise ImplementationError("The original report source is required to finish this partial adoption.")
                source = paths[(kind, original_id)]
                copied = store.retain_report(source)
                if copied["id"] != selected_id:
                    raise ImplementationError("Native report retention returned another presentation edition.")
            actual = presentation._inspect_pair(workspace, request["plan_id"], kind, original_id, selected_id)
            _same(actual, frozen, "A copied presentation differs from its original admitted source.")
            _put(directory / ("retained-" + selected_id + ".json"),
                 {"kind": kind, "original_report_id": original_id, "presentation_report_id": selected_id,
                  "manifest_sha256": actual["presentation_manifest_sha256"]})
        result = _result(workspace, operation_id, directory, request)
        _put(directory / "completed.json", result)
        return result



ARCHIVE_SCHEMA = "upstate.field-report-adoption-archive/v1"


def _archive_file(workspace, relative):
    """Hash one ordinary retained member without loading report attachments."""
    root = _ordinary(workspace.root, directory=True).resolve(strict=True)
    name = Path(relative)
    if (name.is_absolute() or not name.parts or name.as_posix() != str(relative)
            or any(part in ("", ".", "..") for part in name.parts)):
        raise ImplementationError("Use the exact Workspace-relative adoption member.")
    path = _ordinary(root / name)
    before = path.stat()
    checksum = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            checksum.update(chunk)
    after = _ordinary(path).stat()
    fields = ("st_dev", "st_ino", "st_mode", "st_size", "st_mtime_ns")
    if any(getattr(before, key) != getattr(after, key) for key in fields):
        raise ImplementationError("An adopted archive member changed while reading: " + str(relative))
    return {"path": name.as_posix(), "bytes": after.st_size, "sha256": checksum.hexdigest()}


def archive_binding(workspace, operation_id):
    """Bind the complete adopted five reports and original journal for export.

    This separate value keeps the original adoption result and presentation IDs
    unchanged. It can be reconstructed from an independently received Workspace.
    """
    operation_id = identifier(operation_id)
    directory = _directory(workspace, operation_id)
    with _file_lock(directory / ".lock"):
        request, _, _, _ = _read_request(workspace, operation_id, directory)
        _, missing = _retained(workspace, request)
        if missing:
            raise ImplementationError("Finish all five selected native report copies before exporting the adoption.")
        result = _result(workspace, operation_id, directory, request)
        completed = read_json(_ordinary(directory / "completed.json"))
        _same(completed, result, "Retain the original completed adoption before selecting its archive.")
        selected = {}
        root = Path(workspace.root).resolve(strict=True)

        def include(relative, expected=None):
            row = _archive_file(workspace, relative)
            if expected is not None and any(row[key] != expected.get(key) for key in ("path", "bytes", "sha256")):
                raise ImplementationError("A selected report differs from its retained file identity: " + relative)
            if relative in selected:
                _same(selected[relative], row, "Conflicting adopted archive member: " + relative)
            selected[relative] = row

        for name in ("receipt.json", "request.json", "completed.json"):
            include((directory / name).relative_to(root).as_posix())
        for pair in request["reports"]:
            selected_id = pair["presentation_report_id"]
            journal = directory / ("retained-" + selected_id + ".json")
            _same(read_json(_ordinary(journal)), {
                "kind": pair["kind"], "original_report_id": pair["original_report_id"],
                "presentation_report_id": selected_id,
                "manifest_sha256": pair["presentation_manifest_sha256"],
            }, "The original per-report adoption record changed.")
            include(journal.relative_to(root).as_posix())
            # Include the original historical revision even after later plan
            # edits. Native report receiving validates plan.json against it.
            include("implementation/plans/" + request["plan_id"] +
                    "/revisions/" + f"{pair['revision']:016d}.json")
            for field in ("original_files", "presentation_files"):
                for item in pair[field]:
                    include(item["path"], item)
            # Native inventories may keep manifest metadata separate from their
            # displayed file list; both manifests are explicit required members.
            for id_key, hash_key in (
                    ("original_report_id", "original_manifest_sha256"),
                    ("presentation_report_id", "presentation_manifest_sha256")):
                relative = ("implementation/plans/" + request["plan_id"] +
                            "/reports/" + pair[id_key] + "/manifest.json")
                include(relative)
                if selected[relative]["sha256"] != pair[hash_key]:
                    raise ImplementationError("An adopted native manifest changed: " + relative)
        files = [selected[name] for name in sorted(selected)]
        # Reinspect the complete scientific/source relation, then recheck every
        # selected byte identity before the caller chooses an archive filename.
        _same(_result(workspace, operation_id, directory, request), result,
              "The selected presentation changed while binding its archive.")
        for row in files:
            _same(_archive_file(workspace, row["path"]), row,
                  "An adoption archive member changed during inspection.")
        return {
            "schema": ARCHIVE_SCHEMA, "operation_id": operation_id,
            "project_id": result["project_id"], "field_operation_id": result["field_operation_id"],
            "plan_id": result["plan_id"], "receipt_sha256": result["receipt_sha256"],
            "presentation_id": result["presentation"]["presentation_id"],
            "reports": result["presentation"]["selection"]["reports"],
            "retained_files": files,
        }


def retained_files(workspace, operation_id):
    """Return complete verified Workspace-relative members for this adoption."""
    return archive_binding(workspace, operation_id)["retained_files"]


def attach_to_archive(workspace, operation_id, archive_selection):
    """Add the explicit adoption to an existing archive selection unchanged."""
    if not isinstance(archive_selection, dict):
        raise ImplementationError("Supply the complete original project archive selection.")
    selected = json.loads(canonical(archive_selection))
    binding = archive_binding(workspace, operation_id)
    key = "field_report_adoption"
    if key in selected:
        _same(selected[key], binding,
              "Keep the earlier archive selection; explicitly select a new edition for another adoption.")
    selected[key] = binding
    return selected


def main(argv=None):
    import argparse
    from .workspace import Workspace
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    adopt = commands.add_parser("adopt", help="Retain the five actual existing presentation reports")
    adopt.add_argument("--workspace", required=True, type=Path)
    adopt.add_argument("--field-operation", required=True)
    adopt.add_argument("--receipt", required=True, type=Path)
    adopt.add_argument("--source-context", type=Path,
                       help="Explicit relocated copy of the original complete field-report context")
    adopt.add_argument("--output", type=Path,
                       help="New portable presentation selection outside the native Workspace")
    inspect = commands.add_parser("inspect", help="Reopen the original adoption in a received Workspace")
    inspect.add_argument("--workspace", required=True, type=Path)
    inspect.add_argument("--operation", required=True)
    binding = commands.add_parser("archive-binding", help="Inspect complete adopted report and journal members")
    binding.add_argument("--workspace", required=True, type=Path)
    binding.add_argument("--operation", required=True)
    args = parser.parse_args(argv)
    workspace = Workspace(args.workspace)
    if args.command == "adopt":
        result = adopt_presentations(workspace, args.field_operation, args.receipt, source_context=args.source_context)
        if args.output:
            presentation.capture(workspace, args.field_operation, result["presentation"], args.output)
    elif args.command == "archive-binding":
        result = archive_binding(workspace, args.operation)
    else:
        result = inspect_adoption(workspace, args.operation)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
