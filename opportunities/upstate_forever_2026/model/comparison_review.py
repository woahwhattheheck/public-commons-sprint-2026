"""Capture immutable workbench editions as ordinary customer-review sources.

Customer decisions, response history and engineering handbacks remain owned by
the maintained model.reviews and model.review_handback implementations.
"""
from __future__ import annotations

import html
import json
import os
import re
from pathlib import Path
import shutil
import sys
import tempfile

from .common import atomic_json, describe_file, digest, file_digest, held, identifier, now, read_json
from . import reviews

SELECTION_SCHEMA = "upstate.comparison-review-selection/v1"
SPECIFICATION_SCHEMA = "upstate.comparison-review-specification/v1"
KIND = "comparison-reviews"
SOURCE_ID = "saved-comparison-edition"
ROLE = "SAVED_COMPARISON_REVIEW"
ARCHIVE = "editable-comparison.zip"
REQUIREMENTS = (
    ("comparison.purpose", "Decision purpose and selected alternatives",
     "Review the stated decision purpose, exact saved comparison edition and original alternatives."),
    ("comparison.science", "Original scientific selection",
     "Trace the retained experiment, model selection, parameter cases, baseline and alternative run IDs to the captured native records."),
    ("comparison.coverage", "Paired spatial support and unfinished results",
     "Review the actual units, matching grid-cell support, missing outcomes and unfinished cases before interpreting an alternative."),
    ("comparison.costs", "Costs, selected objectives and budget",
     "Review the explicit saved intervention estimates, unknown costs, chosen outcomes, budget ceiling and compatible comparison groups."),
    ("comparison.findings", "Findings and requested changes",
     "Record the actual customer decision, questions and requested changes against these retained files and requirements."),
    ("comparison.reopen", "Editable comparison and original project",
     "Open the captured report and restore its complete editable comparison archive. Use the full Workspace transfer to resume this original review and its response history."),
)


def _text(value, field, *, maximum, required=False):
    if not isinstance(value, str) or "\0" in value or len(value) > maximum:
        raise ValueError(field + " must be text within " + str(maximum) + " characters")
    result = value.strip()
    if required and not result:
        raise ValueError("State " + field)
    return result


def normalize(value):
    if (not isinstance(value, dict) or value.get("schema") != SELECTION_SCHEMA
            or set(value) - {"schema", "record_id", "title", "purpose", "notes"}):
        raise ValueError("Choose an " + SELECTION_SCHEMA + " selection")
    notes = value.get("notes", [])
    if not isinstance(notes, list):
        raise ValueError("Review notes must be a list of text values")
    return {
        "schema": SELECTION_SCHEMA, "record_id": identifier(value.get("record_id")),
        "title": _text(value.get("title"), "review title", maximum=300, required=True),
        "purpose": _text(value.get("purpose"), "review purpose", maximum=20000, required=True),
        "notes": [_text(item, "review note", maximum=20000) for item in notes],
    }


def _runtime():
    package = Path(__file__).resolve().parents[1] / "integrations" / "eco13_scenario_lab"
    if str(package) not in sys.path:
        sys.path.insert(0, str(package))
    from eco_scenario_lab import store
    from eco_scenario_lab.engine import verify_plan
    if Path(store.__file__).resolve().parent != (package / "eco_scenario_lab").resolve():
        raise ValueError("Use the installed application's original comparison package")
    return store, verify_plan


def _directory(root, relative, *, create=False):
    relative = reviews._relative(relative)
    path = Path(root).resolve()
    for part in Path(relative).parts:
        path = path / part
        if path.is_symlink():
            raise ValueError("A comparison review directory cannot be a symbolic link")
        if create:
            path.mkdir(exist_ok=True)
        if path.exists() and not path.is_dir():
            raise ValueError("A comparison review path must be a directory")
    return path


def _verify(root, descriptor):
    path = reviews._regular(root, descriptor["path"])
    if path.stat().st_size != descriptor["bytes"] or file_digest(path) != descriptor["sha256"]:
        raise ValueError("A captured comparison member changed: " + descriptor["path"])
    return path


def edition(workspace, record_id):
    """Read the saved edition and verify its original native receiving plan."""
    record_id = identifier(record_id)
    scope = _directory(workspace.root, "eco13/records/" + record_id)
    record = read_json(reviews._regular(scope, "record.json"))
    if (record.get("schema") != "upstate.eco13-record/v1" or record.get("id") != record_id
            or digest({key: value for key, value in record.items() if key != "record_sha256"})
            != record.get("record_sha256")):
        raise ValueError("The saved comparison record differs from its original identity")
    if not {"html", "comparisons", "selection", "plan", "state", "context"}.issubset(record.get("files", {})):
        raise ValueError("The saved comparison needs its complete report and original context")
    for descriptor in record["files"].values():
        _verify(scope, descriptor)
    _, verify_plan = _runtime()
    plan, state = verify_plan(scope / "comparison")
    if (plan.get("mode") != "adopted-upstate-experiment"
            or plan["plan_sha256"] != record["plan_sha256"]
            or plan["source_manifest"]["original_experiment_id"] != record["original_experiment_id"]
            or plan["source_manifest"]["original_workspace_id"] != record["source_workspace_id"]):
        raise ValueError("The saved comparison differs from its original experiment selection")
    comparison = read_json(_verify(scope, record["files"]["comparisons"]))
    selected = read_json(_verify(scope, record["files"]["selection"]))
    if (comparison.get("plan_sha256") != record["plan_sha256"]
            or selected.get("plan_sha256") != record["plan_sha256"]):
        raise ValueError("The saved report or planning choices belong to a different edition")
    return scope, record, comparison, selected


def _guide(specification):
    e = lambda value: html.escape(str(value), quote=True)
    record = specification["edition"]
    files = specification["files"]
    links = "".join("<li><a href='" + e(item["path"]) + "'>" + e(item["label"]) + "</a></li>" for item in files)
    checks = "".join("<li><strong>" + e(item["title"]) + ".</strong> " + e(item["detail"]) + "</li>"
                     for item in specification["requirements"])
    notes = "".join("<li>" + e(note) + "</li>" for note in specification["selection"]["notes"])
    return (
        "<!doctype html><html lang='en'><meta charset='utf-8'>"
        "<meta name='viewport' content='width=device-width, initial-scale=1'>"
        "<title>" + e(specification["selection"]["title"]) + "</title>"
        "<style>body{max-width:980px;margin:32px auto;padding:0 24px;font:16px/1.6 system-ui;color:#202020;background:white}"
        "h1,h2{line-height:1.25}code{overflow-wrap:anywhere}dt{font-weight:600}dd{margin:0 0 12px}"
        "a{color:#202020}aside{border:1px solid #bbb;padding:16px}li{margin:8px 0}@media print{body{margin:0}}</style>"
        "<main><p>Saved comparison review</p><h1>" + e(specification["selection"]["title"]) + "</h1>"
        "<p>" + e(specification["selection"]["purpose"]) + "</p>"
        "<aside><strong>Needs expert review.</strong> Interpret native quantities, paired spatial coverage and "
        "cost assumptions for the stated decision purpose. The customer records decisions in the original review desk.</aside>"
        "<h2>Exact saved edition</h2><dl><dt>Title and state</dt><dd>" + e(record["title"]) + " / " + e(record["status"])
        + "</dd><dt>Comparison edition</dt><dd><code>" + e(record["id"]) + "</code></dd>"
        "<dt>Original experiment</dt><dd><code>" + e(record["original_experiment_id"]) + "</code></dd>"
        "<dt>Original scientific Workspace</dt><dd><code>" + e(record["source_workspace_id"]) + "</code></dd>"
        "<dt>Receiving review project</dt><dd><code>" + e(specification["project_id"]) + "</code></dd>"
        "<dt>Original receiving plan</dt><dd><code>" + e(record["plan_sha256"]) + "</code></dd></dl>"
        "<h2>Open the retained report and complete originals</h2><ul>" + links + "</ul>"
        "<p>The report preserves every paired outcome, parameter effect and unfinished case, together with "
        "the saved cost, objective and budget choices. Its complete editable archive includes the original "
        "native files and receiving plan.</p><h2>Review questions</h2><ol>" + checks + "</ol>"
        "<h2>Changes and engineering handback</h2><p>Return the original review response from Customer reviews. "
        "The engineer saves a revised comparison edition, creates its separate review and maps requested items "
        "to the actual replacement files in Engineering handbacks. Every customer's original decision remains attached "
        "to its selected review.</p><h2>Reopen</h2><p>Extract the complete review desk to keep the linked report "
        "and companion paths. Download editable-comparison.zip and use Scenario workbench → Receive archive, "
        "or use Reopen editable comparison beside the retained review in its original restored Workspace. "
        "A comparison archive retains scientific source identities; the complete Workspace transfer retains "
        "the original customer reviews, responses and engineering history.</p>"
        + ("<h2>Selected review notes</h2><ul>" + notes + "</ul>" if notes else "")
        + "</main></html>\n"
    )


def _capture(workspace, selection, directory, created_at):
    scope, record, comparison, selected = edition(workspace, selection["record_id"])
    files = []
    def retain(path, relative, descriptor, label):
        target = directory / reviews._relative(relative)
        reviews._copy_file(path, target, descriptor)
        item = describe_file(directory, target)
        item["label"] = label
        files.append(item)
    record_path = reviews._regular(scope, "record.json")
    retain(record_path, "edition/record.json", describe_file(scope, record_path), "Exact saved comparison edition")
    for key, descriptor in record["files"].items():
        retain(_verify(scope, descriptor), "edition/" + descriptor["path"], descriptor,
               descriptor.get("label") or key)
    store, _ = _runtime()
    store.export_workspace(scope / "comparison", directory / ARCHIVE)
    files.append({**describe_file(directory, directory / ARCHIVE),
                  "label": "Complete editable comparison with original native files"})
    # Recheck the pinned source after copying and archive creation.
    _, after, _, _ = edition(workspace, selection["record_id"])
    if after != record:
        raise ValueError("The selected comparison edition changed during capture")
    specification = {
        "schema": SPECIFICATION_SCHEMA, "project_id": workspace.project["id"],
        "selection": selection, "captured_at": created_at, "edition": record,
        "saved_planning_choices": selected,
        "interpretation": comparison.get("interpretation"),
        "requirements": [{"id": key, "title": title, "detail": detail}
                         for key, title, detail in REQUIREMENTS],
        "files": files,
    }
    atomic_json(directory / "specification.json", specification, immutable=True)
    (directory / "index.html").write_text(_guide(specification), encoding="utf-8")
    companions = [describe_file(directory, directory / item["path"]) for item in files]
    companions.append(describe_file(directory, directory / "index.html"))
    manifest = {
        "schema": "upstate.sources/v1", "title": selection["title"], "captured_at": created_at,
        "scope": {"project_id": workspace.project["id"], "comparison_record_id": record["id"],
                  "record_sha256": record["record_sha256"], "plan_sha256": record["plan_sha256"],
                  "original_workspace_id": record["source_workspace_id"],
                  "original_experiment_id": record["original_experiment_id"]},
        "notes": ["Exact saved comparison and editable archive; customer decisions use the original review response."],
        "entries": [{
            "id": SOURCE_ID, "title": selection["title"], "kind": "document",
            "uri": "urn:upstate:comparison-review:" + record["record_sha256"],
            "vintage": created_at, "path": "specification.json",
            "sha256": file_digest(directory / "specification.json"), "companions": companions,
            "metadata": {"role": ROLE, "comparison_record_id": record["id"],
                         "guide_file": "index.html", "archive_file": ARCHIVE,
                         "original_workspace_id": record["source_workspace_id"],
                         "original_experiment_id": record["original_experiment_id"],
                         "plan_sha256": record["plan_sha256"]},
        }],
    }
    atomic_json(directory / "sources.json", manifest, immutable=True)
    return specification


def _captured(workspace, collection_id):
    """Verify the complete source edition independently of its old working path."""
    primary, entry = workspace.source_file(identifier(collection_id), SOURCE_ID)
    if entry.get("metadata", {}).get("role") != ROLE:
        raise ValueError("Select an original saved-comparison review source")
    specification = read_json(primary)
    if (specification.get("schema") != SPECIFICATION_SCHEMA
            or specification.get("project_id") != workspace.project["id"]):
        raise ValueError("The captured comparison review belongs to another original project")
    selection = normalize(specification["selection"])
    record = specification["edition"]
    if (record.get("id") != selection["record_id"]
            or digest({key: value for key, value in record.items() if key != "record_sha256"})
            != record.get("record_sha256")):
        raise ValueError("The captured comparison edition identity changed")
    declared = {item["path"]: item for item in specification["files"]}
    if len(declared) != len(specification["files"]) or ARCHIVE not in declared:
        raise ValueError("The comparison capture has an incomplete file inventory")
    bodies = {item.get("view_path", item["filename"]): item for item in entry.get("companions", [])}
    if set(bodies) != set(declared) | {"index.html"}:
        raise ValueError("The source companions differ from the complete comparison capture")
    for relative, descriptor in declared.items():
        original = bodies[relative]
        if original["bytes"] != descriptor["bytes"] or original["sha256"] != descriptor["sha256"]:
            raise ValueError("A comparison review companion differs from its selected original")
        _verify(primary.parent, descriptor)
    return primary.parent, specification


def detail(workspace, capture_id):
    record = workspace._get(KIND, identifier(capture_id))
    if record["project_id"] != workspace.project["id"]:
        raise ValueError("The comparison capture belongs to another original project")
    _, specification = _captured(workspace, record["source_collection_id"])
    if (specification["selection"] != record["selection"]
            or specification["edition"]["record_sha256"] != record["record_sha256"]):
        raise ValueError("The comparison capture and retained review selection differ")
    packet = reviews.show_review(workspace, record["review_id"], previews=False)
    if packet["review"]["selection"]["source_collection_ids"] != [record["source_collection_id"]]:
        raise ValueError("The original review selects a different comparison source edition")
    return {
        "capture_id": record["id"], "record_id": record["selection"]["record_id"],
        "source_collection_id": record["source_collection_id"], "review_id": record["review_id"],
        "title": record["selection"]["title"], "purpose": record["selection"]["purpose"],
        "created_at": record["created_at"], "original_workspace_id": record["original_workspace_id"],
        "original_experiment_id": record["original_experiment_id"], "plan_sha256": record["plan_sha256"],
        "latest_response_id": packet["latest_response_id"],
        "responses": len(packet["responses"]),
        "disposition": packet["responses"][-1]["response"]["disposition"] if packet["responses"] else "in-review",
    }


def completed(workspace, value, operation_id):
    selection = normalize(value)
    directory = _directory(workspace.root, "comparison-review-packages/" + identifier(operation_id))
    marker = directory / "operation.json"
    if not marker.exists():
        return None
    operation = read_json(reviews._regular(directory, "operation.json"))
    if operation.get("selection") != selection or operation.get("project_id") != workspace.project["id"]:
        raise ValueError("This comparison-review operation belongs to another original selection")
    return detail(workspace, operation["capture_id"]) if operation.get("capture_id") else None



def _release_capture(workspace, directory, selection, capture_id):
    """Remove only this committed operation's redundant private capture copy."""
    operation = read_json(reviews._regular(directory, "operation.json"))
    if (operation.get("project_id") != workspace.project["id"]
            or operation.get("selection") != selection or operation.get("capture_id") != capture_id):
        raise ValueError("Capture cleanup needs the completed original review operation")
    capture = directory / "capture"
    if capture.is_symlink() or (capture.exists() and not capture.is_dir()):
        raise ValueError("The committed capture staging path is not its original directory")
    if capture.exists():
        shutil.rmtree(capture)


def create(workspace, value, *, operation_id=None, created_at=None):
    selection = normalize(value)
    operation_id = identifier(operation_id) if operation_id else digest({
        "project_id": workspace.project["id"], "selection": selection})
    family = _directory(workspace.root, "comparison-review-packages", create=True)
    with held(family / (operation_id + ".lock")):
        existing = completed(workspace, selection, operation_id)
        if existing is not None:
            with held(workspace.root / ".workspace.lock", blocking=False):
                _release_capture(workspace, family / operation_id, selection, existing["capture_id"])
            return existing
        with held(workspace.root / ".workspace.lock", blocking=False):
            directory = _directory(family, operation_id, create=True)
            marker = directory / "operation.json"
            if marker.exists():
                operation = read_json(reviews._regular(directory, "operation.json"))
                if operation["selection"] != selection or operation["project_id"] != workspace.project["id"]:
                    raise ValueError("The retained operation selects a different comparison")
            else:
                operation = {"schema": "upstate.comparison-review-operation/v1",
                             "project_id": workspace.project["id"], "selection": selection,
                             "operation_id": operation_id, "created_at": created_at or now()}
                atomic_json(marker, operation, immutable=True)
            for candidate in directory.iterdir():
                if re.fullmatch(r"\.capture-[a-z0-9_]{8}", candidate.name):
                    if candidate.is_symlink() or not candidate.is_dir():
                        raise ValueError("An interrupted capture is not its original private directory")
                    shutil.rmtree(candidate)
            capture = directory / "capture"
            if capture.is_symlink():
                raise ValueError("The original comparison capture cannot be an alias")
            if not capture.exists():
                pending = Path(tempfile.mkdtemp(prefix=".capture-", dir=directory))
                try:
                    _capture(workspace, selection, pending, operation["created_at"])
                    pending.rename(capture)
                finally:
                    if pending.exists():
                        shutil.rmtree(pending)
            # Native import verifies every source member and stores complete bytes.
            collection = workspace.import_sources(reviews._regular(capture, "sources.json"))
            _, specification = _captured(workspace, collection["id"])
            if specification["selection"] != selection:
                raise ValueError("The retained capture differs from the selected comparison")
        original = reviews.create_review(workspace, {
            "schema": reviews.SELECTION_SCHEMA, "title": selection["title"], "purpose": selection["purpose"],
            "source_collection_ids": [collection["id"]], "run_ids": [], "delivery_ids": [], "spatial_export_ids": [],
            "requirements": specification["requirements"], "notes": selection["notes"],
        }, created_at=operation["created_at"])
        edition_record = specification["edition"]
        with held(workspace.root / ".workspace.lock", blocking=False):
            record = workspace._save(KIND, {
                "project_id": workspace.project["id"], "selection": selection,
                "operation_id": operation_id, "created_at": operation["created_at"],
                "source_collection_id": collection["id"], "review_id": original["id"],
                "record_sha256": edition_record["record_sha256"],
                "plan_sha256": edition_record["plan_sha256"],
                "original_workspace_id": edition_record["source_workspace_id"],
                "original_experiment_id": edition_record["original_experiment_id"],
            })
            atomic_json(marker, {**operation, "capture_id": record["id"]})
        # Source import owns independent canonical bytes; verify the committed
        # review before releasing this operation's duplicate archive and copies.
        result = detail(workspace, record["id"])
        with held(workspace.root / ".workspace.lock", blocking=False):
            _release_capture(workspace, directory, selection, record["id"])
        return result


def _summary(workspace, record):
    review = workspace._get("reviews", record["review_id"])
    if (record["project_id"] != workspace.project["id"]
            or review["project"]["id"] != workspace.project["id"]
            or review["selection"]["source_collection_ids"] != [record["source_collection_id"]]):
        raise ValueError("The saved comparison review belongs to another original selection")
    responses = reviews.history(workspace, review["id"])
    return {
        "capture_id": record["id"], "record_id": record["selection"]["record_id"],
        "source_collection_id": record["source_collection_id"], "review_id": review["id"],
        "title": record["selection"]["title"], "purpose": record["selection"]["purpose"],
        "created_at": record["created_at"], "original_workspace_id": record["original_workspace_id"],
        "original_experiment_id": record["original_experiment_id"], "plan_sha256": record["plan_sha256"],
        "latest_response_id": responses[-1]["id"] if responses else None,
        "responses": len(responses),
        "disposition": responses[-1]["response"]["disposition"] if responses else "in-review",
    }


def summary(workspace, capture_id):
    return _summary(workspace, workspace._get(KIND, identifier(capture_id)))


def catalog(workspace, *, record_id=None):
    if record_id is not None:
        identifier(record_id)
    rows = []
    for record in workspace._list(KIND):
        if record_id is not None and record["selection"]["record_id"] != record_id:
            continue
        rows.append(_summary(workspace, record))
    return sorted(rows, key=lambda row: (row["created_at"], row["capture_id"]), reverse=True)


def archive_for_review(workspace, review_id, source_collection_id):
    packet = reviews.show_review(workspace, identifier(review_id), previews=False)
    source_collection_id = identifier(source_collection_id)
    if source_collection_id not in packet["review"]["selection"]["source_collection_ids"]:
        raise ValueError("Select the captured comparison source retained by this original review")
    root, specification = _captured(workspace, source_collection_id)
    descriptor = next(item for item in specification["files"] if item["path"] == ARCHIVE)
    archive = _verify(root, descriptor)
    return archive, {**descriptor, "review_id": review_id,
                     "source_collection_id": source_collection_id,
                     "original_record_id": specification["edition"]["id"]}


def verify_all(workspace):
    rows = [detail(workspace, record["id"]) for record in workspace._list(KIND)]
    return {"comparison_reviews": len(rows), "captures": rows}


def main(argv=None):
    import argparse
    from .workspace import Workspace
    parser = argparse.ArgumentParser(description="Capture and reopen saved comparisons through original Customer reviews")
    parser.add_argument("--workspace", required=True)
    sub = parser.add_subparsers(dest="command", required=True)
    capture = sub.add_parser("create")
    capture.add_argument("--selection", required=True)
    capture.add_argument("--operation-id")
    listing = sub.add_parser("list")
    listing.add_argument("--record-id")
    show = sub.add_parser("show")
    show.add_argument("capture_id")
    reopen = sub.add_parser("archive")
    reopen.add_argument("--review-id", required=True)
    reopen.add_argument("--source-collection-id", required=True)
    args = parser.parse_args(argv)
    workspace = Workspace(Path(args.workspace))
    if args.command == "create":
        result = create(workspace, read_json(args.selection), operation_id=args.operation_id)
    elif args.command == "list":
        result = catalog(workspace, record_id=args.record_id)
    elif args.command == "show":
        result = detail(workspace, args.capture_id)
    else:
        path, descriptor = archive_for_review(workspace, args.review_id, args.source_collection_id)
        result = {"archive_path": str(path), **descriptor}
    print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
