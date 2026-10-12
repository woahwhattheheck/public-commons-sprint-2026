"""Operate the original study-extraction and publication engines from Python.

The existing ResearchWorkspace owns authentication, native child lifetime,
retained request identity, response recovery and complete file publication.
"""
from __future__ import annotations

from copy import deepcopy
import re

from .errors import StateError
from .research_workspace import _json, _request_id

EXTRACTION_SECTIONS = (
    "overview", "forms", "formEditions", "resultSets", "extractions", "submissions", "results",
    "resolutions", "impact", "operations", "occurrences", "studies",
)
PUBLICATION_SECTIONS = (
    "overview", "tables", "table-editions", "results", "publications", "rows",
    "impact", "reviews", "withdrawals", "operations", "comparison",
)
EXTRACTION_ACTIONS = (
    "create-form", "revise-form", "create-result-set", "save-extraction",
    "submit-extraction", "resolve-result", "review-impact",
)
PUBLICATION_ACTIONS = (
    "create-table", "revise-table", "publish-table", "review-impact", "withdraw-publication",
)
_FORMATS = ("json", "csv", "md", "html")
_MUTATIONS = ("extraction-review", "extraction-publication-review")
_INPUT_LIMIT = 16 * 1024 * 1024


def _need(value, code):
    if not value:
        raise StateError(code)


def _id(value):
    _need(isinstance(value, str) and 0 < len(value) <= 180 and
          not any(ord(char) < 32 or ord(char) == 127 for char in value),
          "EXTRACTION_ID_REQUIRED")
    return value


def _revision(value):
    _need(type(value) is int and 1 <= value <= 99999999,
          "EXTRACTION_REVISION_REQUIRED")
    return value


def _page(section, sections, revision, offset, limit, selection):
    _need(section in sections, "EXTRACTION_SECTION_INVALID")
    _need(type(offset) is int and offset >= 0 and type(limit) is int and 1 <= limit <= 100,
          "EXTRACTION_PAGE_INVALID")
    _need(offset == 0 or revision is not None, "EXTRACTION_PAGE_REVISION_REQUIRED")
    options = {"section": section, "offset": offset, "limit": limit}
    if revision is not None:
        options["revision"] = _revision(revision)
    for name, value in selection.items():
        if value is not None:
            options[name] = _id(value)
    return options


def _request(request, *, publication=False):
    # Action-specific values belong to the original domain parser. This guard
    # only keeps the transport envelope exact and forbids implicit retry edits.
    _need(isinstance(request, dict) and set(request).issubset({
        "requestId", "expectedRevision", "actor", "action", "data", "projection"
    }) and {"requestId", "expectedRevision", "actor", "action", "data"}.issubset(request),
          "EXTRACTION_REQUEST_INVALID")
    _request_id(request["requestId"])
    _need(re.fullmatch(r"[A-Za-z0-9_-]{8,100}", request["requestId"]) is not None,
          "EXTRACTION_REQUEST_ID_REQUIRED")
    _revision(request["expectedRevision"])
    actor = request["actor"]
    _need(isinstance(actor, dict) and set(actor) == {"id", "name"} and
          isinstance(actor["name"], str) and 0 < len(actor["name"]) <= 200,
          "EXTRACTION_ACTOR_REQUIRED")
    _id(actor["id"])
    actions = PUBLICATION_ACTIONS if publication else EXTRACTION_ACTIONS
    _need(request["action"] in actions and isinstance(request["data"], dict),
          "EXTRACTION_ACTION_INVALID")
    _need(request.get("projection", "metadata") == "metadata",
          "EXTRACTION_METADATA_PROJECTION_REQUIRED")
    result = {key: deepcopy(request[key]) for key in
              ("requestId", "expectedRevision", "actor", "action", "data")}
    _need(len(_json(result)) <= _INPUT_LIMIT, "EXTRACTION_REQUEST_TOO_LARGE")
    return result


class ResearchExtraction:
    """Borrow one existing Research client and its saved dossier identity."""

    def __init__(self, workspace, dossier_id):
        self.workspace, self.dossier_id = workspace, _id(dossier_id)

    def read(self, *, revision=None, form_id=None, result_set_id=None,
             section="overview", offset=0, limit=30, cancel_event=None):
        options = _page(section, EXTRACTION_SECTIONS, revision, offset, limit,
                        {"formId": form_id, "resultSetId": result_set_id})
        return self.workspace._read("extraction", {
            "dossierId": self.dossier_id, "options": options}, cancel_event=cancel_event)

    def iter_records(self, *, section, revision=None, form_id=None,
                     result_set_id=None, limit=100, cancel_event=None):
        """Read every row from one immutable dossier revision."""
        _need(section != "overview", "EXTRACTION_ROWS_SECTION_REQUIRED")
        offset = 0
        while True:
            page = self.read(section=section, revision=revision, form_id=form_id,
                result_set_id=result_set_id, offset=offset, limit=limit, cancel_event=cancel_event)
            revision, rows, next_offset = self._rows(page, revision, offset, section)
            yield from rows
            if next_offset is None:
                return
            offset = next_offset

    def source_values(self, occurrence_id, pointers, *, revision, file_name=None, cancel_event=None):
        """Read source-bound original Decimal/string/null values without conversion."""
        _revision(revision)
        _need(isinstance(pointers, list) and 1 <= len(pointers) <= 512 and
              all(isinstance(pointer, str) for pointer in pointers) and len(set(pointers)) == len(pointers),
              "EXTRACTION_POINTERS_REQUIRED")
        value = {"dossierId": self.dossier_id, "options": {
            "revision": revision, "occurrenceId": _id(occurrence_id),
            "pointers": deepcopy(pointers)}}
        if file_name is not None:
            _need(isinstance(file_name, str) and 0 < len(file_name) <= 2048,
                  "EXTRACTION_FILE_NAME_INVALID")
            value["options"]["fileName"] = file_name
        _need(len(_json(value)) <= _INPUT_LIMIT, "EXTRACTION_REQUEST_TOO_LARGE")
        return self.workspace._read("extraction-source-values", value, cancel_event=cancel_event)

    def review(self, request, *, resume=False, cancel_event=None):
        """Retain the whole native request before its original atomic mutation."""
        normalized = _request(request)
        return self.workspace._write("extraction-review", {
            "dossierId": self.dossier_id, "body": normalized},
            request_id=normalized["requestId"], replay_safe=True, resume=resume,
            cancel_event=cancel_event)

    def publications(self, *, revision=None, table_id=None, publication_id=None,
                     section="overview", offset=0, limit=30, from_publication_id=None,
                     to_publication_id=None, current_only=False, change_type="all", cancel_event=None):
        options = _page(section, PUBLICATION_SECTIONS, revision, offset, limit,
                        {"tableId": table_id, "publicationId": publication_id,
                         "fromPublicationId": from_publication_id, "toPublicationId": to_publication_id})
        _need(type(current_only) is bool and change_type in
              ("all", "added", "removed", "changed", "unchanged"),
              "EXTRACTION_PUBLICATION_SELECTION_INVALID")
        if section == "comparison":
            _need(from_publication_id is not None and to_publication_id is not None,
                  "EXTRACTION_COMPARISON_SELECTION_REQUIRED")
        options.update(currentOnly=current_only, changeType=change_type)
        return self.workspace._read("extraction-publications", {
            "dossierId": self.dossier_id, "options": options}, cancel_event=cancel_event)

    def iter_publications(self, *, section, revision=None, table_id=None,
                          publication_id=None, limit=100, from_publication_id=None,
                          to_publication_id=None, current_only=False, change_type="all", cancel_event=None):
        """Read all selected publication rows without mixing source revisions."""
        _need(section != "overview", "EXTRACTION_ROWS_SECTION_REQUIRED")
        offset = 0
        while True:
            page = self.publications(section=section, revision=revision, table_id=table_id,
                publication_id=publication_id, offset=offset, limit=limit,
                from_publication_id=from_publication_id, to_publication_id=to_publication_id,
                current_only=current_only, change_type=change_type, cancel_event=cancel_event)
            revision, rows, next_offset = self._rows(page, revision, offset, section)
            yield from rows
            if next_offset is None:
                return
            offset = next_offset

    def _rows(self, page, revision, offset, section):
        _need(isinstance(page, dict) and page.get("dossierId") == self.dossier_id and
              type(page.get("revision")) is int,
              "EXTRACTION_PAGE_SOURCE_CHANGED")
        selected = page["revision"]
        _revision(selected)
        _need(revision is None or revision == selected, "EXTRACTION_PAGE_REVISION_CHANGED")
        _need(page.get("section") == section and page.get("offset") == offset and
              isinstance(page.get("items"), list), "EXTRACTION_PAGE_CHANGED")
        next_offset = page.get("nextOffset")
        _need(next_offset is None or type(next_offset) is int and
              next_offset == offset + len(page["items"]) and next_offset > offset,
              "EXTRACTION_PAGE_CURSOR_CHANGED")
        return selected, page["items"], next_offset

    def review_publication(self, request, *, resume=False, cancel_event=None):
        normalized = _request(request, publication=True)
        return self.workspace._write("extraction-publication-review", {
            "dossierId": self.dossier_id, "body": normalized},
            request_id=normalized["requestId"], replay_safe=True, resume=resume,
            cancel_event=cancel_event)

    def saved_request(self, request_id):
        record = self.workspace.call_record(request_id)
        saved = record["request"]
        _need(saved["action"] in _MUTATIONS and
              saved["input"].get("dossierId") == self.dossier_id,
              "EXTRACTION_CALL_SELECTION_CHANGED")
        return record

    def recover(self, request_id, *, cancel_event=None):
        """Reuse the selected saved request and expected revision after interruption."""
        self.saved_request(request_id)
        return self.workspace.resume(request_id, cancel_event=cancel_event)

    def export(self, file, *, revision, form_id=None, result_set_id=None,
               format="json", expected_sha256=None):
        """Download the original complete extraction report at one revision."""
        _need(format in ("json", "md", "html"), "EXTRACTION_EXPORT_FORMAT_INVALID")
        options = {"revision": _revision(revision), "format": format}
        for name, value in (("formId", form_id), ("resultSetId", result_set_id)):
            if value is not None:
                options[name] = _id(value)
        return self.workspace._download("extraction-export", {
            "dossierId": self.dossier_id, "options": options},
            file=file, expected_sha256=expected_sha256)

    def export_publication(self, file, *, revision, table_id=None, publication_id=None,
                           format="json", against_publication_id=None, expected_sha256=None):
        _need(format in _FORMATS, "EXTRACTION_EXPORT_FORMAT_INVALID")
        options = {"revision": _revision(revision), "format": format}
        for name, value in (("tableId", table_id), ("publicationId", publication_id),
                            ("againstPublicationId", against_publication_id)):
            if value is not None:
                options[name] = _id(value)
        return self.workspace._download("extraction-publication-export", {
            "dossierId": self.dossier_id, "options": options},
            file=file, expected_sha256=expected_sha256)

    def export_portable(self, file, *, revision, format="json.gz", expected_sha256=None):
        """Use the original full dossier archive, including all extraction history."""
        _need(format in ("json", "json.gz"), "EXTRACTION_PORTABLE_FORMAT_INVALID")
        return self.workspace.export_dossier(self.dossier_id, file, format=format,
            revision=_revision(revision), expected_sha256=expected_sha256)
