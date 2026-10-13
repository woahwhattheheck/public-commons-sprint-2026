"""Read-only discovery of complete original saved operating workflows.

All entries point to an existing retained edition or source. Original desks
continue to verify and open the selected document through their own readers.
"""
from __future__ import annotations

from copy import deepcopy
import json

import operations_domain as domain
import operations_account_reconciliation as reconciliation
import operations_funding as funding
import operations_statements as statements_model
import award_terms

SCHEMA = "stellar-forge.sf47-operating-workflows.v1"
POPULATIONS = (
    ("statements", "statements", "Account statements"),
    ("reconciliations", "account-reconciliation", "Account reconciliation editions"),
    ("funding", "funding", "Cost funding editions"),
    ("awardTerms", "award-terms", "Issuer terms editions"),
    ("cohortDelivery", "cohort-delivery", "Cohort delivery comparisons"),
    ("procedures", "procedures", "Operating procedures"),
)
ALL_SECTIONS = frozenset(row[1] for row in POPULATIONS)


def visible_sections(role):
    """Mirror the original host's visibility for these six existing sections."""
    if role in ("owner", "lead"):
        return ALL_SECTIONS
    if role == "finance":
        return frozenset(("statements", "account-reconciliation"))
    return frozenset()


def _source_summary(metadata):
    return {key: deepcopy(value) for key, value in metadata.items()
            if key in ("id", "filename", "kind", "mediaType", "bytes", "sha256",
                       "observedAt", "sourceUrl", "createdAt", "recordedBy")}


def _object(value):
    return value if isinstance(value, dict) else {}


def _source_document(raw):
    def invalid_constant(value):
        raise ValueError("A saved workflow must use standard JSON values.")

    try:
        value = json.loads(bytes(raw), parse_constant=invalid_constant)
        return value if isinstance(value, dict) else None
    except (UnicodeError, ValueError, TypeError):
        return None


def read_index(operations, program_id, expected_version, allowed_sections=None):
    context = operations._context(program_id)
    expected = domain.integer(expected_version, "Reviewed case version", 1, 10000000)
    if expected != context["program"]["version"]:
        domain.fail("The case changed. Reload its current saved work.", "OPERATIONS_CONFLICT", 409)
    allowed = ALL_SECTIONS if allowed_sections is None else ALL_SECTIONS.intersection(allowed_sections)
    entries = []
    populations = [{"key": key, "section": section, "label": label, "count": 0}
                   for key, section, label in POPULATIONS if section in allowed]
    counts = {row["key"]: row for row in populations}

    def add(collection, ident, revision, label, kind_label, summary, selection):
        population = counts.get(collection)
        if population is None:
            return
        key = collection + ":" + ident + (":r" + str(revision) if revision is not None else "")
        entries.append({"key": key, "collection": collection, "id": ident, "revision": revision,
                        "section": population["section"], "kindLabel": kind_label,
                        "label": str(label or ident), "summary": deepcopy(summary),
                        "selection": deepcopy(selection)})
        population["count"] += 1

    # Summary discovery reads the saved review, never reparses the bank file or
    # recomputes a historical cash projection. The original desk does that when
    # opening the selected complete edition.
    if "statements" in allowed:
        for metadata in reversed(list(context["sources"].values())):
            marker = metadata.get("statement")
            if (not isinstance(marker, dict) or marker.get("schema") != statements_model.SCHEMA
                    or marker.get("role") not in ("CSV", "ORIGINAL")):
                continue
            row = {"sourceId": metadata["id"], "source": _source_summary(metadata)}
            label = metadata.get("filename") or metadata["id"]
            review_id = marker.get("reviewSourceId")
            review_metadata = context["sources"].get(review_id) if isinstance(review_id, str) else None
            try:
                if review_metadata is None:
                    raise ValueError("Missing original statement review")
                _metadata, raw = operations.source(program_id, review_id)
                review = _source_document(raw)
                if (not review or review.get("sourceId") != metadata["id"]
                        or _object(_object(review.get("preview")).get("source")).get("sha256") != metadata["sha256"]):
                    raise ValueError("Different original statement review")
                row = reconciliation.statement_summary(
                    {"source": metadata, "reviewSource": review_metadata, "review": review})
                label = (row["accountLabel"] or row["accountId"]) + " · " + label
            except (KeyError, TypeError, ValueError, AttributeError):
                row["reviewRequired"] = "Open this original statement in its desk to review the saved interpretation."
            add("statements", metadata["id"], None, label, "Received account statement", row,
                {"kind": "statement-original", "sourceId": metadata["id"]})

    if "account-reconciliation" in allowed:
        for metadata in reversed(reconciliation.source_candidates(context)):
            match = reconciliation.SOURCE_PATTERN.fullmatch(metadata["filename"])
            ident, revision = "reconciliation-" + match.group(1), int(match.group(2))
            row = {"id": ident, "revision": revision, "sourceId": metadata["id"],
                   "source": _source_summary(metadata)}
            label = metadata["filename"]
            try:
                _metadata, raw = operations.source(program_id, metadata["id"])
                record = _source_document(raw)
                if (not record or record.get("schema") != reconciliation.EDITION_SCHEMA
                        or record.get("caseId") != program_id or record.get("id") != ident
                        or record.get("revision") != revision):
                    raise ValueError("Different original reconciliation edition")
                row = reconciliation.edition_summary({"source": metadata, "record": record})
                label = row["name"]
            except (KeyError, TypeError, ValueError, AttributeError):
                row["reviewRequired"] = "Open this original reconciliation in its desk to review the saved edition."
            add("reconciliations", ident, revision, label, "Saved account reconciliation", row,
                {"kind": "account-reconciliation", "reconciliationId": ident, "revision": revision})

    if "funding" in allowed:
        for value in reversed(funding.records(operations, program_id)):
            row = funding.summary(value)
            add("funding", row["sourceId"], row["revision"], row["title"],
                "Saved cost funding", row, {"kind": "cost-funding", "revision": row["revision"]})

    if "award-terms" in allowed:
        for value in reversed(award_terms.records(operations, program_id)):
            row = award_terms.summary(value)
            add("awardTerms", row["id"], row["revision"], row["title"],
                "Saved issuer terms", row,
                {"kind": "award-terms", "id": row["id"], "revision": row["revision"]})

    if allowed.intersection(("cohort-delivery", "procedures")):
        for metadata in sorted(context["sources"].values(), key=lambda row: row["id"]):
            filename = metadata.get("filename", "")
            if metadata.get("mediaType") != "application/json" or not isinstance(filename, str):
                continue
            cohort_candidate = "cohort-delivery" in allowed and filename.startswith("sf47-cohort-delivery-")
            procedure_candidate = ("procedures" in allowed and filename.startswith("grant-procedure-")
                                   and filename.endswith(".json"))
            if not cohort_candidate and not procedure_candidate:
                continue
            _metadata, raw = operations.source(program_id, metadata["id"])
            document = _source_document(raw)
            if cohort_candidate:
                collection, kind, kind_label = "cohortDelivery", "cohort-delivery", "Saved cohort comparison"
                schema = "stellar-forge.sf47-cohort-delivery-comparison.v1"
            else:
                collection, kind, kind_label = "procedures", "grant-procedure", "Saved operating procedure"
                schema = "stellar-forge.sf47-grant-procedure.v1"
            summary = {"sourceId": metadata["id"], "source": _source_summary(metadata)}
            label = filename
            if not document or document.get("schema") != schema:
                summary["reviewRequired"] = "Open this original source in its desk to review the saved document."
            elif cohort_candidate:
                original = _object(document.get("source"))
                if original.get("programId") != program_id:
                    summary["reviewRequired"] = "This retained comparison identifies a different original case."
                else:
                    recording = _object(_object(document.get("input")).get("recording"))
                    label = document.get("title") or filename
                    summary.update({"schema": schema, "engineVersion": document.get("engineVersion"),
                                    "editionId": recording.get("editionId"),
                                    "createdAt": recording.get("createdAt"), "actor": recording.get("actor"),
                                    "reviewId": original.get("reviewId"), "reviewVersion": original.get("reviewVersion"),
                                    "plannedWindow": deepcopy(original.get("plannedWindow")),
                                    "observedWindow": deepcopy(original.get("observedWindow")),
                                    "nativeMode": original.get("nativeMode"),
                                    "summary": deepcopy(_object(document.get("summary")))})
            else:
                original = _object(document.get("case"))
                if original.get("id") != program_id:
                    summary["reviewRequired"] = "This retained procedure identifies a different original case."
                else:
                    summary.update({key: deepcopy(document.get(key))
                                    for key in ("schema", "editionId", "createdAt", "actor", "note",
                                                "selectedRevision", "parent")})
                    summary["case"] = deepcopy(original)
                    label = document.get("note") or document.get("editionId") or filename
            add(collection, metadata["id"], None, label, kind_label, summary,
                {"kind": kind, "sourceId": metadata["id"]})

    return {"schema": SCHEMA,
            "case": {"id": context["program"]["id"], "version": context["program"]["version"]},
            "populations": populations, "entries": entries}
