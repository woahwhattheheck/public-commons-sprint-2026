"""Read-only multi-case agenda routes, shared with the original staff authorization."""
from __future__ import annotations

import json
import re

import operations_agenda as agenda

ROUTE = re.compile(r"/api/operations/delivery-agenda(?:/export\.(ics|csv|json))?\Z")


def _unique_pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            agenda.domain.fail("Supply each selected case version once.", "INVALID_AGENDA_VERSIONS")
        result[key] = value
    return result


def selection(query):
    if set(query) - {"caseId", "asOfDate", "expectedVersions"}:
        agenda.domain.fail("Use selected case IDs, one date and their original version map.",
                           "INVALID_DELIVERY_AGENDA")
    for key in ("asOfDate", "expectedVersions"):
        if key in query and len(query[key]) != 1:
            agenda.domain.fail("Supply " + key + " once.", "INVALID_DELIVERY_AGENDA")
    versions = None
    if "expectedVersions" in query:
        try:
            versions = json.loads(query["expectedVersions"][0], object_pairs_hook=_unique_pairs)
        except (ValueError, TypeError) as exc:
            agenda.domain.fail("Use a JSON object mapping every selected case ID to its version.",
                               "INVALID_AGENDA_VERSIONS")
    if "expectedVersions" in query and not isinstance(versions, dict):
        agenda.domain.fail("Use a JSON object mapping every selected case ID to its version.",
                           "INVALID_AGENDA_VERSIONS")
    identities, versions = agenda.selected_cases(query.get("caseId", []), versions)
    return identities, query.get("asOfDate", [None])[0], versions


def read(handler, path, query, operations):
    match = ROUTE.fullmatch(path)
    if not match:
        return False
    identities, as_of, versions = selection(query)
    report = operations.delivery_agenda(identities, as_of, versions)
    format = match[1]
    if format is None:
        handler.send(200, report)
    else:
        handler.send(200, agenda.export_bytes(report, format), agenda.content_type(format),
                     agenda.filename(report, format))
    return True
