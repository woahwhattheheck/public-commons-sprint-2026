"""Retain editable source tables inside the original native planning revision.

Only the original model computes budgets, cash and capacity. This module retains
the exact portable authoring text, validates its source bytes and registers its
browser dependencies on the same listener.
"""
from __future__ import annotations

from copy import deepcopy
import hashlib
import json
import re

BOOK_SCHEMA = "stellar-forge.planning-source-tables.v1"
STORAGE_SCHEMA = BOOK_SCHEMA + ".retained"
PROJECT_SCHEMA = "stellar-forge.source-table-project.v1"
MAX_BYTES = 32 * 1024 * 1024
ROLES = {"packages", "milestones", "contributors", "assignments"}
HASH = re.compile(r"[a-f0-9]{64}\Z")


def fail(message):
    # Imported only on invocation, after the original model has finished loading.
    from model import Problem
    raise Problem(message, 422, "INVALID_SOURCE_TABLES")


def require(value, message):
    if not value:
        fail(message)


def ordinary(value, label, maximum, required=False):
    require(isinstance(value, str) and len(value) <= maximum and "\x00" not in value,
            f"{label}: retain ordinary text up to {maximum} characters.")
    require(not required or value.strip(), f"{label}: enter a value.")
    return value


def encoded(value):
    try:
        return value.encode("utf-8")
    except (UnicodeError, AttributeError):
        fail("Retain the original valid UTF-8 source text.")


def checked_hash(value, raw, label):
    require(isinstance(value, str) and HASH.fullmatch(value) and
            hashlib.sha256(raw).hexdigest() == value, f"{label}: source bytes differ from the retained identity.")


def validate_source_tables(value):
    """Preserve exact JSON text; native canonical JSON may reorder object keys.

    The existing Source Tables review ID includes the original mapping's JSON
    spelling. Storing the complete portable text preserves that format through
    native SQLite, every revision, full ZIP export and submission receiving.
    """
    require(isinstance(value, dict) and value.get("schema") == STORAGE_SCHEMA and
            set(value) == {"schema", "text"}, "Use the complete retained planning source-table document.")
    raw = encoded(value.get("text"))
    require(0 < len(raw) <= MAX_BYTES, "The source-table document must fit the original 32 MiB input allowance.")
    try:
        book = json.loads(raw, parse_constant=lambda _value: (_ for _ in ()).throw(ValueError()))
    except (ValueError, UnicodeError):
        fail("Use a readable complete planning source-table document.")
    require(isinstance(book, dict) and book.get("schema") == BOOK_SCHEMA,
            "Retain the original planning source-table schema.")
    require(re.fullmatch(r"table-plan-[a-f0-9-]{36}", str(book.get("id", ""))),
            "Retain the source-table project identity.")
    ordinary(book.get("name"), "Source project name", 200, True)
    baseline = book.get("baseline")
    require(isinstance(baseline, dict) and re.fullmatch(r"plan-[a-f0-9]{32}", str(baseline.get("id", ""))) and
            isinstance(baseline.get("revision"), int) and not isinstance(baseline.get("revision"), bool) and
            baseline["revision"] > 0 and HASH.fullmatch(str(baseline.get("contentSha256", ""))) and
            isinstance(baseline.get("scenario"), dict) and isinstance(baseline.get("planning"), dict),
            "Retain the complete original saved-plan comparison baseline.")
    require("sourceTables" not in baseline["planning"], "Keep the original comparison baseline free of nested source projects.")
    project = book.get("project")
    require(isinstance(project, dict) and project.get("schema") == PROJECT_SCHEMA and
            isinstance(project.get("documents"), list) and len(project["documents"]) <= 4,
            "Retain the complete Source Tables project.")
    documents = {}
    for document in project["documents"]:
        require(isinstance(document, dict) and isinstance(document.get("id"), str) and
                document["id"] not in documents and isinstance(document.get("editions"), list) and
                document["editions"] and isinstance(document.get("reviews"), list),
                "Retain each source table once with its editions and reviews.")
        documents[document["id"]] = document
        editions = {}
        for edition in document["editions"]:
            require(isinstance(edition, dict), "Retain the complete source edition.")
            source = encoded(edition.get("sourceText"))
            checked_hash(edition.get("sha256"), source, "Source edition")
            require(edition.get("id") == "e-" + edition["sha256"] and edition.get("bytes") == len(source) and
                    edition["id"] not in editions, "Retain the complete original source bytes and edition identity.")
            ordinary(edition.get("filename"), "Original source filename", 500)
            editions[edition["id"]] = edition
        require(document.get("selectedEditionId") in editions, "Retain the selected source edition.")
        review_ids = set()
        for review in document["reviews"]:
            require(isinstance(review, dict) and review.get("editionId") in editions and
                    isinstance(review.get("id"), str) and review["id"] not in review_ids and
                    isinstance(review.get("mapping"), dict) and isinstance(review.get("sourceRecords"), list),
                    "Retain the source, mapping and row positions of every table review.")
            review_ids.add(review["id"])
            output = encoded(review.get("dataText"))
            checked_hash(review.get("outputSha256"), output, "Reviewed table")
            require(review.get("dataBytes") == len(output) and
                    review.get("sourceSha256") == editions[review["editionId"]]["sha256"],
                    "Retain the original reviewed table and selected source identity.")
        require(document.get("selectedReviewId") is None or document["selectedReviewId"] in review_ids,
                "Retain the selected table review.")
        require(document.get("baselineReviewId") is None or document["baselineReviewId"] in review_ids,
                "Retain the table comparison review.")
    bindings = book.get("bindings")
    require(isinstance(bindings, list) and len(bindings) <= 4, "Retain the planning table bindings.")
    roles, bound = set(), set()
    for binding in bindings:
        require(isinstance(binding, dict) and binding.get("role") in ROLES and binding["role"] not in roles and
                binding.get("documentId") in documents and binding["documentId"] not in bound and
                binding.get("mode") in ("merge", "replace") and isinstance(binding.get("fields"), dict) and
                isinstance(binding.get("excludedRows"), list), "Retain one explicit source binding for each planning role.")
        roles.add(binding["role"])
        bound.add(binding["documentId"])
    require(bound == set(documents), "Assign every retained source table to its planning role.")
    require(book.get("orphanPolicy") in ("preserve", "remove-unreferenced"),
            "Retain the explicit choice for dependent assignments and payment settings.")
    require(isinstance(book.get("settings"), dict) and isinstance(book.get("reviews"), list),
            "Retain the current settings and source-import reviews.")
    review_ids = set()
    for review in book["reviews"]:
        require(isinstance(review, dict) and HASH.fullmatch(str(review.get("id", ""))) and
                review["id"] not in review_ids and isinstance(review.get("base"), dict) and
                isinstance(review.get("sourceRows"), list) and isinstance(review.get("changes"), list),
                "Retain the complete original source-import review.")
        review_ids.add(review["id"])
    require(book.get("appliedReviewId") is None or book["appliedReviewId"] in review_ids,
            "Retain the selected applied review.")
    from source_workbooks import validate_workbook_materials, WorkbookInputError, error_body
    try:
        validate_workbook_materials(book)
    except WorkbookInputError as exc:
        fail(error_body(exc)["message"])
    return deepcopy(value)


def register_static(routes):
    """Use the selected release's complete existing browser implementation."""
    routes.update({
        "/source-workbooks.mjs": ("source-workbooks.mjs", "text/javascript; charset=utf-8"),
        "/source-workbook-export.mjs": ("source-workbook-export.mjs", "text/javascript; charset=utf-8"),
        "/source-workbook-handover.md": ("WORKBOOK_HANDOVER.md", "text/markdown; charset=utf-8"),
        "/stellar-forge/developer-site/dist/grant-plan-source.mjs": ("../../../../stellar-forge/developer-site/dist/grant-plan-source.mjs", "text/javascript; charset=utf-8"),
        "/stellar-forge/developer-site/dist/grant-plan-core.mjs": ("../../../../stellar-forge/developer-site/dist/grant-plan-core.mjs", "text/javascript; charset=utf-8"),
        "/source-tables.mjs": ("source-tables.mjs", "text/javascript; charset=utf-8"),
        "/source-tables-core.mjs": ("source-tables-core.mjs", "text/javascript; charset=utf-8"),
        "/source-tables.css": ("source-tables.css", "text/css; charset=utf-8"),
        "/source-tables-guide.md": ("SOURCE_TABLES.md", "text/markdown; charset=utf-8"),
        "/stellar-forge/developer-site/dist/source-document-tables.mjs": ("../../../../stellar-forge/developer-site/dist/source-document-tables.mjs", "text/javascript; charset=utf-8"),
        "/stellar-forge/developer-site/dist/source-table-intake.mjs": ("../../../../stellar-forge/developer-site/dist/source-table-intake.mjs", "text/javascript; charset=utf-8"),
        "/stellar-forge/developer-site/dist/source-table-workspace.mjs": ("../../../../stellar-forge/developer-site/dist/source-table-workspace.mjs", "text/javascript; charset=utf-8"),
        "/stellar-forge/developer-site/dist/onboarding.mjs": ("../../../../stellar-forge/developer-site/dist/onboarding.mjs", "text/javascript; charset=utf-8"),
        "/stellar-forge/developer-site/dist/offer.mjs": ("../../../../stellar-forge/developer-site/dist/offer.mjs", "text/javascript; charset=utf-8"),
    })
