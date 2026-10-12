"""Commission an existing imported plan through the original target workspace.

These commands compose the maintained intake, request journal, deployment,
review, capture and handover operations. JSON selections keep original typed
values; acknowledgements are always explicit operator input.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import uuid

from .commissioning import is_commissioned
from .storage import checked_id, write_bytes
from .target import TargetError, canonical, guid

EVIDENCE_CLASSES = ("native_receipt", "original_export", "original_screenshot", "operator_statement")
OBJECT_FIELDS = (
    "import_intake_sha256", "commissioning_inventory_sha256",
    "commissioning_comparison_sha256", "comparison_sha256",
    "adoption_review_sha256", "commissioning_probe_sha256", "rebind_sha256",
)


def _identity(value):
    try:
        return checked_id(value)
    except Exception as exc:
        raise argparse.ArgumentTypeError(str(exc)) from exc


def _guid(value):
    try:
        return guid(value)
    except Exception as exc:
        raise argparse.ArgumentTypeError(str(exc)) from exc


def _revision(value):
    try:
        number = int(value)
    except (TypeError, ValueError) as exc:
        raise argparse.ArgumentTypeError("Use the selected deployment's integer revision.") from exc
    if number < 1:
        raise argparse.ArgumentTypeError("Use the selected deployment's positive saved revision.")
    return number


def _readable(value):
    if not value.strip():
        raise argparse.ArgumentTypeError("Provide the operator's complete selected text.")
    return value


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise TargetError("COMMISSIONING_JSON_KEY", "A selected JSON object repeats the key " + key + ".")
        result[key] = value
    return result


def _constant(value):
    raise TargetError("COMMISSIONING_JSON_NUMBER", "Use finite original JSON values; " + value + " is not JSON.")


def read_json(path, kind=None):
    """Read the actual selected file; do not coerce strings, dates or booleans."""
    value = json.loads(Path(path).expanduser().read_text(encoding="utf-8"),
                       object_pairs_hook=_unique_object, parse_constant=_constant)
    if kind is not None and not isinstance(value, kind):
        raise TargetError("COMMISSIONING_JSON_SHAPE", "The selected " + str(path) +
                          " must contain a JSON " + ("array." if kind is list else "object."))
    return value


def _options(command, *, mutate=False, deployment=False, revision=False, reviewer=False):
    if deployment:
        command.add_argument("deployment_id", type=_identity)
    if revision:
        command.add_argument("--expected-revision", required=True, type=_revision,
                             help="The exact saved revision being reviewed or commissioned.")
    if reviewer:
        command.add_argument("--reviewer", required=True, type=_readable)
        command.add_argument("--note", required=True, type=_readable)
    if mutate:
        command.add_argument("--request-id", type=_identity,
                             help="Original 64-character request identity; generated and saved if omitted.")
        command.add_argument("--queue-only", action="store_true",
                             help="Save the original request before executing it with the existing request --resume command.")
    command.add_argument("--output", help="Also retain exact result JSON in this file; an existing different file is preserved.")
    return command


def add_commands(commands):
    group = commands.add_parser("commissioning",
        help="Adopt, review, correct, accept and hand over an existing imported Planner plan.")
    sub = group.add_subparsers(dest="commissioning_command", required=True)

    listing = _options(sub.add_parser("list", help="Read existing-plan adoptions and their correction lineage."))
    listing.add_argument("--cursor", default="")
    listing.add_argument("--limit", type=int, default=25)
    listing.add_argument("--all", action="store_true", help="Continue original deployment pages to completion.")

    inspect = _options(sub.add_parser("inspect", help="Read one exact adoption, source and retained commissioning objects."),
                       deployment=True)
    inspect.add_argument("--section", choices=("all", "deployment", "source", "import", "inventory",
                                              "comparison", "source-comparison", "review", "probe", "rebind"),
                         default="all")

    evidence = _options(sub.add_parser("evidence", help="Retain a complete original import receipt, export, screenshot or statement."))
    evidence.add_argument("file")
    evidence.add_argument("--class", dest="evidence_class", required=True, choices=EVIDENCE_CLASSES)
    evidence.add_argument("--title")
    evidence.add_argument("--format")

    intake = _options(sub.add_parser("intake", help="Read an original project file and selected companions with the existing source engine."),
                      mutate=True)
    intake.add_argument("file")
    intake.add_argument("--label", required=True, type=_readable)
    intake.add_argument("--source-profile-file")
    intake.add_argument("--companions-file",
                        help="JSON array of existing uploaded companion descriptors and original reader profiles.")

    probe = _options(sub.add_parser("probe", help="Read the selected configured target identity and native metadata."), mutate=True)
    probe.add_argument("profile_id", type=_readable)

    adopt = _options(sub.add_parser("adopt", help="Retain original import evidence and observe an existing native project."),
                     mutate=True)
    adopt.add_argument("edition_id", type=_identity)
    adopt.add_argument("--profile", dest="profile_id", required=True, type=_readable)
    adopt.add_argument("--project-id", required=True, type=_guid)
    adopt.add_argument("--evidence-file", required=True,
                       help="JSON array of evidence selections from commissioning evidence.")
    adopt.add_argument("--import-exceptions-file", help="Original exception coordinates and typed values from the selected evidence.")
    adopt.add_argument("--import-settings-file")
    adopt.add_argument("--import-time-file", help="The original selected import-time JSON value.")
    adopt.add_argument("--project-url")
    adopt.add_argument("--label")

    proposal = _options(sub.add_parser("proposal", help="Preview explicit source-to-native identities and exception decisions."),
                        mutate=True, deployment=True, revision=True)
    proposal.add_argument("--row-ids-file", required=True)
    proposal.add_argument("--exception-decisions-file", required=True)
    proposal.add_argument("--mappings-file")

    review = _options(sub.add_parser("review", help="Save the exact proposed adoption review and selected findings."),
                      mutate=True, deployment=True, revision=True, reviewer=True)
    review.add_argument("--proposal-sha256", required=True, type=_identity)
    review.add_argument("--accepted-findings-file", required=True)

    correction = _options(sub.add_parser("correct", help="Prepare task corrections against the actual observed target."),
                          mutate=True, deployment=True, revision=True)
    correction.add_argument("--basis-sha256", required=True, type=_identity)
    correction.add_argument("--edition-id", type=_identity)
    correction.add_argument("--mappings-file")
    correction.add_argument("--selected-fields-file",
                            help="JSON array of selected source_key/target_field corrections; preserve the complete reviewed basis.")

    correction_review = _options(sub.add_parser("review-correction", help="Review the original prepared native correction plan."),
                                 mutate=True, deployment=True, revision=True, reviewer=True)
    correction_review.add_argument("--accepted-findings-file", required=True)

    continuation = _options(sub.add_parser("continue", help="Continue the original reviewed native operation and saved call history."),
                            mutate=True, deployment=True)
    continuation.add_argument("--review-sha256", required=True, type=_identity)
    continuation.add_argument("--retry-rejected", action="store_true",
                              help="Explicitly retry a previously rejected original native call.")

    _options(sub.add_parser("capture", help="Read the current native project using the original complete capture."),
             mutate=True, deployment=True, revision=True)

    accept = _options(sub.add_parser("accept", help="Accept the exact captured source and intended-versus-observed comparisons."),
                      mutate=True, deployment=True, revision=True, reviewer=True)
    accept.add_argument("--comparison-sha256", required=True, type=_identity)
    accept.add_argument("--commissioning-comparison-sha256", required=True, type=_identity)
    accept.add_argument("--accepted-fields-file", required=True,
                        help="JSON array of explicitly accepted non-equal commissioning field IDs.")
    accept.add_argument("--accepted-identities-file", required=True,
                        help="JSON array of explicitly accepted commissioning identity finding IDs.")
    accept.add_argument("--exceptions-file", help="JSON array of retained difference notes.")

    _options(sub.add_parser("handover", help="Create complete commissioning JSON/HTML and original target handover artifacts."),
             mutate=True, deployment=True)

    rebind = _options(sub.add_parser("rebind", help="Observe the same project under another selected principal with a separate reviewed lineage."),
                      mutate=True, deployment=True, revision=True, reviewer=True)
    rebind.add_argument("--profile", dest="profile_id", required=True, type=_readable)

    _options(sub.add_parser("archive", help="Export the original complete portable workspace and all retained commissioning objects."),
             mutate=True)
    return group


def _upload(workspace, path):
    source = Path(path).expanduser().resolve(strict=True)
    before = source.stat()
    if not source.is_file() or before.st_size > 256 * 1024 * 1024:
        raise TargetError("SOURCE_SIZE", "Select one complete original file within the 256 MiB source limit.")
    with open(source, "rb") as stream:
        descriptor = workspace.store.upload_stream(stream, before.st_size, source.name)
    after = source.stat()
    if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != (
            after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns):
        raise TargetError("SOURCE_CHANGED", "The selected source changed during upload; reopen the original file.")
    return descriptor


def _inspect(workspace, args):
    with workspace.store.locked():
        deployment = workspace.deployment(args.deployment_id)
        if not is_commissioned(deployment):
            raise TargetError("COMMISSIONING_SELECTION", "Select an existing-plan adoption or its correction lineage.")
        objects = {name: workspace.store.read(deployment[name])
                   for name in OBJECT_FIELDS if deployment.get(name)}
        source = workspace.portfolio.read_edition(deployment["source_edition_id"])
        value = {"schema": "portfolio.commissioning-cli-inspection.v1",
                 "deployment": deployment, "source": source, "objects": objects}
        workspace_path = workspace.store.root / "workspace.json"
        if workspace_path.exists():
            value["workspace_id"] = checked_id(json.loads(workspace_path.read_text(encoding="utf-8"))["id"])
    if args.section in ("all", "deployment", "source"):
        return value if args.section == "all" else value[args.section]
    key = {"import": "import_intake_sha256", "inventory": "commissioning_inventory_sha256",
           "comparison": "commissioning_comparison_sha256", "source-comparison": "comparison_sha256",
           "review": "adoption_review_sha256", "probe": "commissioning_probe_sha256",
           "rebind": "rebind_sha256"}[args.section]
    if key not in objects:
        raise TargetError("COMMISSIONING_SECTION", "This selected deployment has no saved " + args.section + " yet.")
    return objects[key]


def _list(workspace, args):
    items, pages, scanned, cursor = [], 0, 0, args.cursor
    seen = set()
    while True:
        page = workspace.store.list("deployments", cursor=cursor, limit=args.limit)
        pages += 1
        scanned += len(page["items"])
        items.extend({key: item.get(key) for key in (
            "id", "revision", "state", "created_at", "updated_at", "profile_id",
            "source_edition_id", "project_id", "project_name", "commissioning_origin",
            "commissioning_root_id", "parent_deployment_id", "adoption_review_sha256",
            "commissioning_comparison_sha256", "acceptance_sha256")}
            for item in page["items"] if is_commissioned(item))
        cursor = page["next_cursor"]
        if not args.all or not cursor:
            return {"schema": "portfolio.commissioning-list.v1", "items": items,
                    "next_cursor": cursor, "complete": page["complete"],
                    "source_pages_read": pages, "source_deployments_read": scanned}
        if cursor in seen:
            raise TargetError("COMMISSIONING_CURSOR", "The original deployment cursor repeated during this read.")
        seen.add(cursor)


def _selections(args):
    name = args.commissioning_command
    value = {}
    if name not in ("intake", "probe", "adopt", "archive"):
        value["deployment_id"] = args.deployment_id
    if hasattr(args, "expected_revision"):
        value["expected_revision"] = args.expected_revision
    if hasattr(args, "reviewer"):
        value.update(reviewer=args.reviewer, note=args.note)
    for attribute in ("profile_id", "edition_id", "project_id", "project_url", "label",
                      "proposal_sha256", "basis_sha256", "review_sha256",
                      "comparison_sha256", "commissioning_comparison_sha256"):
        selected = getattr(args, attribute, None)
        if selected is not None:
            value[attribute] = selected
    for attribute, key, shape in (
        ("evidence_file", "evidence", list),
        ("import_exceptions_file", "import_exceptions", list),
        ("import_settings_file", "import_settings", dict),
        ("import_time_file", "import_time", None),
        ("row_ids_file", "row_ids", dict),
        ("exception_decisions_file", "exception_decisions", list),
        ("mappings_file", "mappings", dict),
        ("selected_fields_file", "selected_fields", list),
        ("accepted_findings_file", "accepted_findings", list),
        ("accepted_fields_file", "accepted_commissioning_fields", list),
        ("accepted_identities_file", "accepted_identity_findings", list),
        ("exceptions_file", "exceptions", list),
        ("source_profile_file", "profile", dict),
        ("companions_file", "companions", list),
    ):
        path = getattr(args, attribute, None)
        if path is not None:
            value[key] = read_json(path, shape)
    if getattr(args, "retry_rejected", False):
        value["retry_rejected"] = True
    return value


def run_command(workspace, args):
    name = args.commissioning_command
    if name == "list":
        result = _list(workspace, args)
    elif name == "inspect":
        result = _inspect(workspace, args)
    elif name == "evidence":
        result = {"source": _upload(workspace, args.file), "class": args.evidence_class}
        if args.title is not None:
            result["title"] = args.title
        if args.format is not None:
            result["format"] = args.format
    else:
        value = _selections(args)
        if name == "intake":
            value["source"] = _upload(workspace, args.file)
        kind = {"intake": "intake", "probe": "probe", "adopt": "adopt_existing",
                "proposal": "prepare_adoption_review", "review": "review_adoption",
                "correct": "prepare_observed_correction", "review-correction": "review",
                "continue": "continue", "capture": "capture_target", "accept": "accept",
                "handover": "commissioning_handover", "rebind": "rebind_imported_target",
                "archive": "archive"}[name]
        identity = args.request_id or hashlib.sha256(uuid.uuid4().bytes).hexdigest()
        request = workspace.request(identity, kind, value)
        if not args.queue_only:
            workspace.run(request["id"])
        result = workspace.request_result(request["id"])
    if args.output:
        destination = Path(args.output).expanduser().resolve()
        destination.parent.mkdir(parents=True, exist_ok=True)
        write_bytes(destination, canonical(result) + b"\n", immutable=True)
    return result
