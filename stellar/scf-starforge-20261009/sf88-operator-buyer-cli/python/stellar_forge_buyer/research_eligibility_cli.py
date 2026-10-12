"""CLI for full Research eligibility programmes and original customer receiving."""
from __future__ import annotations
from pathlib import Path

from .research_workspace import ResearchWorkspace
from .research_eligibility import ACTIONS, SECTIONS, EXPORT_SECTIONS
from .research_eligibility_delivery import EligibilityDelivery
from .storage import parse, read


def _json_file(file):
    value = parse(read(Path(file), 32 * 1024 * 1024))
    if not isinstance(value, dict):
        raise ValueError("Input must contain one complete JSON object.")
    return value


def _selection(parser, *, required_review=False):
    parser.add_argument("--review-id", required=required_review)
    parser.add_argument("--work-set-id")
    parser.add_argument("--revision", type=int)


def add_eligibility_commands(commands):
    page = commands.add_parser("eligibility-read", help="Read an original revision-pinned review section.")
    page.add_argument("dossier_id")
    _selection(page)
    page.add_argument("--section", choices=SECTIONS, default="overview")
    page.add_argument("--offset", type=int, default=0)
    page.add_argument("--limit", type=int, default=100)
    page.add_argument("--all", action="store_true", help="Read all subsequent pages at the first selected revision.")

    prepare = commands.add_parser("eligibility-prepare", help="Prepare and save a complete original action without sending it.")
    prepare.add_argument("dossier_id")
    prepare.add_argument("--action", required=True, choices=ACTIONS)
    prepare.add_argument("--data", required=True, help="Complete action data JSON.")
    prepare.add_argument("--request-id", required=True)
    prepare.add_argument("--actor-id", required=True)
    prepare.add_argument("--actor-name", required=True)
    prepare.add_argument("--output", required=True)
    _selection(prepare)

    submit = commands.add_parser("eligibility-submit", help="Journal and submit the exact saved request.")
    submit.add_argument("dossier_id")
    submit.add_argument("--input", required=True, help="Prepared envelope or complete original request JSON.")
    submit.add_argument("--resume", action="store_true")

    for name in ("eligibility-recover", "eligibility-saved"):
        child = commands.add_parser(name, help="Open or recover the same original saved operation.")
        child.add_argument("dossier_id")
        child.add_argument("request_id")

    export = commands.add_parser("eligibility-export", help="Download the selected original review JSON or CSV table.")
    export.add_argument("dossier_id")
    export.add_argument("file")
    export.add_argument("--format", choices=("json", "csv"), default="json")
    export.add_argument("--section", choices=EXPORT_SECTIONS, default="queue")
    export.add_argument("--expected-sha256")
    _selection(export, required_review=True)

    delivery = commands.add_parser("eligibility-delivery-build", help="Export the full review, reports, source and portable history.")
    delivery.add_argument("dossier_id")
    delivery.add_argument("--delivery", required=True)
    _selection(delivery, required_review=True)
    delivery.add_argument("--archive")
    delivery.add_argument("--receive-directory")

    for name in ("eligibility-delivery-verify", "eligibility-delivery-receive", "eligibility-delivery-archive"):
        child = commands.add_parser(name)
        child.add_argument("--delivery", required=True)
        if name == "eligibility-delivery-receive":
            child.add_argument("--into", required=True)
        if name == "eligibility-delivery-archive":
            child.add_argument("file")

    receive = commands.add_parser("eligibility-delivery-open", help="Open a SHA-bound complete customer ZIP using immutable safe members.")
    receive.add_argument("file")
    receive.add_argument("--expected-sha256", required=True)
    receive.add_argument("--into", required=True)


def _receiver(delivery, arguments, destination):
    if not arguments.checkout:
        raise ValueError("--checkout is required for the original portable receiver.")
    return delivery.receive(destination, checkout=arguments.checkout, node=arguments.node,
                            timeout=arguments.timeout)


def run_eligibility_command(arguments):
    name = arguments.command
    if name == "eligibility-delivery-open":
        delivery = EligibilityDelivery.from_archive(arguments.file, arguments.into,
                                                     expected_sha256=arguments.expected_sha256)
        return {"directory": str(delivery.directory), "manifest": delivery.verify()}
    if name in {"eligibility-delivery-verify", "eligibility-delivery-receive", "eligibility-delivery-archive"}:
        delivery = EligibilityDelivery(arguments.delivery)
        if name == "eligibility-delivery-receive":
            return _receiver(delivery, arguments, arguments.into)
        if name == "eligibility-delivery-archive":
            return delivery.archive(arguments.file)
        return delivery.verify()
    if not arguments.checkout or not arguments.connection:
        raise ValueError("--checkout and --connection are required for the original Research workspace.")
    with ResearchWorkspace(checkout=arguments.checkout, node=arguments.node,
            connection_file=arguments.connection, directory=arguments.directory,
            timeout=arguments.timeout, request_timeout_ms=arguments.request_timeout_ms) as workspace:
        eligibility = workspace.eligibility(arguments.dossier_id)
        if name == "eligibility-read":
            options = {"review_id": arguments.review_id, "work_set_id": arguments.work_set_id,
                       "revision": arguments.revision, "section": arguments.section,
                       "offset": arguments.offset, "limit": arguments.limit}
            first = eligibility.read(**options)
            if not arguments.all:
                return first
            items, page = list(first["items"]), first
            while page["nextOffset"] is not None:
                options.update(revision=first["dossier"]["revision"], offset=page["nextOffset"])
                page = eligibility.read(**options)
                if page["total"] != first["total"]:
                    raise ValueError("Original revision-pinned section total changed.")
                items.extend(page["items"])
            return {"schema": "stellar-forge.research-eligibility-collection.v1",
                    "selection": {key: first[key] for key in
                        ("dossier", "reviewId", "workSetId", "section", "overview", "protocols", "workSets")},
                    "offset": first["offset"], "total": first["total"], "items": items}
        if name == "eligibility-prepare":
            if arguments.work_set_id is not None:
                raise ValueError("Place workSetId in the exact action data JSON.")
            prepared = eligibility.prepare(arguments.action, _json_file(arguments.data),
                request_id=arguments.request_id,
                actor={"id": arguments.actor_id, "name": arguments.actor_name},
                review_id=arguments.review_id, expected_revision=arguments.revision)
            return eligibility.save_prepared(prepared, arguments.output)
        if name == "eligibility-submit":
            value = _json_file(arguments.input)
            if value.get("schema") == "stellar-forge.research-eligibility-prepared.v1":
                return eligibility.submit_prepared(value, resume=arguments.resume)
            return eligibility.submit(value, resume=arguments.resume)
        if name == "eligibility-recover":
            return eligibility.recover(arguments.request_id)
        if name == "eligibility-saved":
            return eligibility.saved_request(arguments.request_id)
        if name == "eligibility-export":
            return eligibility.export(arguments.file, format=arguments.format,
                section=arguments.section, review_id=arguments.review_id,
                work_set_id=arguments.work_set_id, revision=arguments.revision,
                expected_sha256=arguments.expected_sha256).native
        if name == "eligibility-delivery-build":
            delivery = eligibility.delivery(arguments.delivery, review_id=arguments.review_id,
                work_set_id=arguments.work_set_id, revision=arguments.revision)
            result = {"directory": str(delivery.directory), "manifest": delivery.export(eligibility)}
            if arguments.receive_directory:
                result["receiving"] = _receiver(delivery, arguments, arguments.receive_directory)
            if arguments.archive:
                result["archive"] = delivery.archive(arguments.archive)
            return result
        raise ValueError("Unknown eligibility command.")
